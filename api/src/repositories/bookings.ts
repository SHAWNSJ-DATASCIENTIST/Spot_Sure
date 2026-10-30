import { and, desc, eq, gt, inArray, lt, lte, ne, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { bookings, parkingBays, parkingSpaces } from "../db/schema.js";
import type { BookingStatus, Party } from "../domain/booking.js";
import { accessGranted } from "../domain/payment.js";
import { AppError } from "../http/errors.js";
import { bookingFacts, bookingNotice, notify } from "./notifications.js";

export type Booking = typeof bookings.$inferSelect;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** A booking with the place it is for (and private access details, used only for the booker). */
export interface BookingRow {
  booking: Booking;
  spaceName: string;
  bayLabel: string;
  spaceOwnerId: string;
  place: { line: string | null; locality: string | null; city: string | null; region: string | null };
  entryInstructions: string | null;
}

const placed = {
  booking: bookings,
  spaceName: parkingSpaces.name,
  bayLabel: parkingBays.label,
  spaceOwnerId: parkingSpaces.ownerId,
  place: {
    line: parkingSpaces.addressLine,
    locality: parkingSpaces.locality,
    city: parkingSpaces.city,
    region: parkingSpaces.region,
  },
  entryInstructions: parkingSpaces.entryInstructions,
};

function selectPlaced(db: Database | Tx) {
  return db
    .select(placed)
    .from(bookings)
    .innerJoin(parkingSpaces, eq(parkingSpaces.id, bookings.spaceId))
    .innerJoin(parkingBays, eq(parkingBays.id, bookings.bayId));
}

/**
 * Moves bookings whose time has passed to their terminal state: unanswered
 * requests expire, held bookings complete. Run before reads and actions so
 * nobody sees (or acts on) a stale state; cheap thanks to the status filter.
 */
export async function settlePastBookings(db: Database | Tx, now = new Date()): Promise<void> {
  // Expiry and the driver's notice commit together (a savepoint inside a caller's transaction).
  await db.transaction(async (tx) => {
    const expired = await tx
      .update(bookings)
      .set({ status: "expired" })
      .where(and(eq(bookings.status, "pending"), lte(bookings.startsAt, now)))
      .returning({ id: bookings.id });
    for (const { id } of expired) {
      const facts = await bookingFacts(tx, id);
      if (facts) await notify(tx, [bookingNotice(facts, facts.driverId, "booking_expired")]);
    }
  });
  await db
    .update(bookings)
    .set({ status: "completed" })
    .where(and(inArray(bookings.status, ["confirmed", "active"]), lte(bookings.endsAt, now)));
}

/** Bookings the user made. */
export async function listBookingsForUser(db: Database, userId: string, limit = 100): Promise<BookingRow[]> {
  await settlePastBookings(db);
  return selectPlaced(db).where(eq(bookings.userId, userId)).orderBy(desc(bookings.startsAt)).limit(limit);
}

/** Bookings on one space. */
export async function listBookingsForSpace(db: Database, spaceId: string, limit = 100): Promise<BookingRow[]> {
  await settlePastBookings(db);
  return selectPlaced(db).where(eq(bookings.spaceId, spaceId)).orderBy(desc(bookings.startsAt)).limit(limit);
}

/** Bookings on any space the user owns. */
export async function listBookingsForOwner(db: Database, ownerId: string, limit = 200): Promise<BookingRow[]> {
  await settlePastBookings(db);
  return selectPlaced(db).where(eq(parkingSpaces.ownerId, ownerId)).orderBy(desc(bookings.startsAt)).limit(limit);
}

export async function getBookingRow(db: Database | Tx, id: string): Promise<BookingRow | undefined> {
  const [row] = await selectPlaced(db).where(eq(bookings.id, id)).limit(1);
  return row;
}

/** Active bays of a space with no bay-holding booking overlapping [start, end). */
export async function freeBays(db: Database | Tx, spaceId: string, start: Date, end: Date, excludeBayId?: string): Promise<string[]> {
  const rows = await db
    .select({ id: parkingBays.id })
    .from(parkingBays)
    .where(
      and(
        eq(parkingBays.spaceId, spaceId),
        eq(parkingBays.status, "active"),
        excludeBayId ? ne(parkingBays.id, excludeBayId) : undefined,
        sql`not exists (
          select 1 from ${bookings} b
          where b.bay_id = ${parkingBays.id}
            and b.status in ('confirmed', 'active')
            and b.starts_at < ${end} and b.ends_at > ${start}
        )`,
      ),
    )
    .orderBy(parkingBays.label);
  return rows.map((r) => r.id);
}

/**
 * Records a driver's request. It doesn't hold a bay (only the owner's
 * confirmation does), but a request is refused when no bay is free right now
 * or when the same driver already has an overlapping request on this space.
 */
export async function createBookingRequest(
  db: Database,
  input: { userId: string; spaceId: string; startsAt: Date; endsAt: Date; hourlyPriceMinor: number; totalPriceMinor: number },
): Promise<string> {
  return db.transaction(async (tx) => {
    // Serialise this driver's requests for this listing, so two simultaneous
    // submissions can't both pass the duplicate check below. Released at commit.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`booking-request:${input.userId}:${input.spaceId}`}, 0))`);
    await settlePastBookings(tx);
    const [dup] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.userId, input.userId),
          eq(bookings.spaceId, input.spaceId),
          inArray(bookings.status, ["pending", "confirmed", "active"]),
          lt(bookings.startsAt, input.endsAt),
          gt(bookings.endsAt, input.startsAt),
        ),
      )
      .limit(1);
    if (dup) throw new AppError(409, "duplicate_request", "You already have a booking or request for this space at that time");
    const [bayId] = await freeBays(tx, input.spaceId, input.startsAt, input.endsAt);
    if (!bayId) throw new AppError(409, "no_space_available", "No space is free at that time");
    const [row] = await tx
      .insert(bookings)
      .values({
        userId: input.userId,
        spaceId: input.spaceId,
        bayId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        status: "pending",
        hourlyPriceMinorSnapshot: input.hourlyPriceMinor,
        totalPriceMinor: input.totalPriceMinor,
        currency: "INR",
      })
      .returning({ id: bookings.id });
    const facts = (await bookingFacts(tx, row!.id))!;
    await notify(tx, [
      bookingNotice(facts, facts.driverId, "booking_requested"),
      bookingNotice(facts, facts.ownerId, "booking_request_received"),
    ]);
    return row!.id;
  });
}

const isOverlapViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === "23P01" || e.cause?.code === "23P01";
};

/**
 * Serialises changes to a space's set of bays (capacity edits) against
 * confirmations on it, so a bay can't be retired while a booking is being
 * confirmed onto it. Released at commit.
 */
export async function lockSpaceBays(tx: Tx, spaceId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`space-bays:${spaceId}`}, 0))`);
}

/**
 * Owner confirms a pending request. Only bays that are active and free right
 * now qualify (the requested bay first, if it still does); a bay retired or
 * put under maintenance since the request is never used. The bay is claimed
 * by the UPDATE itself, so the database's exclusion constraint decides any
 * race: if another confirmation took the bay first, the next candidate is
 * tried in its own savepoint; if none is free the request stays pending (409).
 */
export async function confirmBooking(db: Database, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, id)).for("update");
    if (!b || b.status !== "pending") throw new AppError(409, "invalid_transition", "This booking isn't waiting for a response");
    await lockSpaceBays(tx, b.spaceId);
    const free = await freeBays(tx, b.spaceId, b.startsAt, b.endsAt);
    const candidates = free.includes(b.bayId) ? [b.bayId, ...free.filter((x) => x !== b.bayId)] : free;
    for (const bayId of candidates) {
      try {
        await tx.transaction(async (sp) => {
          await sp.update(bookings).set({ status: "confirmed", bayId }).where(eq(bookings.id, id));
        });
        const facts = (await bookingFacts(tx, id))!;
        await notify(tx, [bookingNotice(facts, facts.driverId, "booking_confirmed")]);
        return;
      } catch (err) {
        if (!isOverlapViolation(err)) throw err;
      }
    }
    throw new AppError(409, "slot_taken", "Every space is already booked at that time");
  });
}

/**
 * Ends a booking (owner declines a request, or either party cancels) if it is
 * still in an expected status, and tells the other party in the same
 * transaction. Nothing is notified when the change doesn't happen.
 */
export async function endBooking(db: Database, id: string, from: BookingStatus[], by: Party, kind: "decline" | "cancel"): Promise<void> {
  await db.transaction(async (tx) => {
    const res = await tx
      .update(bookings)
      .set({ status: "cancelled", cancelledBy: by })
      .where(and(eq(bookings.id, id), inArray(bookings.status, from)))
      .returning({ id: bookings.id });
    if (!res.length) throw new AppError(409, "invalid_transition", "This booking changed in the meantime; reload and try again");
    const facts = (await bookingFacts(tx, id))!;
    const other = by === "owner" ? facts.driverId : facts.ownerId;
    await notify(tx, [bookingNotice(facts, other, kind === "decline" ? "booking_declined" : "booking_cancelled", by)]);
  });
}

/**
 * The booker sees their own booking in full, and the exact address and entry
 * instructions once it is confirmed. A space owner sees the booking without
 * the booker's identity: they need the slot, not the customer.
 */
export function presentBooking(row: BookingRow, view: "booker" | "owner") {
  const b = row.booking;
  // Payment isn't required during the pilot: SpotSure can't collect it.
  const access = view === "booker" && accessGranted(b.status, b.paymentStatus, false);
  return {
    id: b.id,
    ...(view === "booker" ? { userId: b.userId } : {}),
    spaceId: b.spaceId,
    spaceName: row.spaceName,
    area: { locality: row.place.locality, city: row.place.city },
    bayId: b.bayId,
    bayLabel: row.bayLabel,
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    status: b.status,
    cancelledBy: b.cancelledBy,
    price: { hourlyAmountMinor: b.hourlyPriceMinorSnapshot, totalAmountMinor: b.totalPriceMinor, currency: b.currency },
    // Separate from status: confirmed is not paid. Provider references stay server-side.
    payment: { status: b.paymentStatus },
    privateAccess: access
      ? { address: [row.place.line, row.place.locality, row.place.city, row.place.region].filter(Boolean).join(", "), entryInstructions: row.entryInstructions }
      : null,
    createdAt: b.createdAt.toISOString(),
  };
}
