import { and, desc, eq, gt, isNull, lte, or, lt, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { bookings, notifications, parkingSpaces } from "../db/schema.js";
import {
  bookingMessage,
  encodeCursor,
  REMINDER_LEAD_MINUTES,
  type BookingFacts,
  type NotificationType,
} from "../domain/notification.js";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Notification = typeof notifications.$inferSelect;

export interface NewNotification {
  recipientId: string;
  type: NotificationType;
  bookingId?: string;
  spaceId?: string;
  message: string;
  dedupeKey: string;
}

/**
 * Records notifications; call it inside the transaction of the event that
 * caused them. A repeated event (retry, double submit) hits the unique
 * (recipient, dedupe key) index and is skipped rather than duplicated.
 */
export async function notify(db: Database | Tx, rows: NewNotification[]): Promise<void> {
  if (!rows.length) return;
  // createdAt from the app clock (millisecond precision) so keyset cursors,
  // which round-trip through JS Dates, compare exactly.
  const createdAt = new Date();
  await db
    .insert(notifications)
    .values(rows.map((r) => ({ ...r, createdAt })))
    .onConflictDoNothing({ target: [notifications.recipientId, notifications.dedupeKey] });
}

/** What a booking notification needs to say, read inside the caller's transaction. */
export async function bookingFacts(
  db: Database | Tx,
  bookingId: string,
): Promise<(BookingFacts & { bookingId: string; driverId: string; ownerId: string; spaceId: string }) | undefined> {
  const [row] = await db
    .select({
      bookingId: bookings.id,
      driverId: bookings.userId,
      ownerId: parkingSpaces.ownerId,
      spaceId: bookings.spaceId,
      spaceName: parkingSpaces.name,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      timezone: parkingSpaces.timezone,
    })
    .from(bookings)
    .innerJoin(parkingSpaces, eq(parkingSpaces.id, bookings.spaceId))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return row;
}

/** A booking notification for one party, keyed so the same event can only notify once. */
export function bookingNotice(
  facts: BookingFacts & { bookingId: string; spaceId: string },
  recipientId: string,
  type: NotificationType,
  by?: "driver" | "owner",
): NewNotification {
  return {
    recipientId,
    type,
    bookingId: facts.bookingId,
    spaceId: facts.spaceId,
    message: bookingMessage(type, facts, by),
    dedupeKey: `booking:${facts.bookingId}:${type}`,
  };
}

/**
 * Creates "starts soon" reminders for the user's confirmed bookings that start
 * within the lead time. There is no background scheduler: this runs whenever
 * the user loads notifications (the app polls while open), and the dedupe key
 * makes it safe to run any number of times. Cancelled bookings never qualify.
 */
export async function ensureReminders(db: Database, userId: string, now = new Date()): Promise<void> {
  const soon = new Date(now.getTime() + REMINDER_LEAD_MINUTES * 60_000);
  const due = await db
    .select({
      bookingId: bookings.id,
      spaceId: bookings.spaceId,
      spaceName: parkingSpaces.name,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      timezone: parkingSpaces.timezone,
    })
    .from(bookings)
    .innerJoin(parkingSpaces, eq(parkingSpaces.id, bookings.spaceId))
    .where(and(eq(bookings.userId, userId), eq(bookings.status, "confirmed"), gt(bookings.startsAt, now), lte(bookings.startsAt, soon)));
  await notify(
    db,
    due.map((b) => bookingNotice(b, userId, "booking_reminder")),
  );
}

export async function listNotifications(
  db: Database,
  recipientId: string,
  opts: { limit: number; before?: { createdAt: Date; id: string }; unreadOnly?: boolean },
) {
  const b = opts.before;
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        opts.unreadOnly ? isNull(notifications.readAt) : undefined,
        b ? or(lt(notifications.createdAt, b.createdAt), and(eq(notifications.createdAt, b.createdAt), lt(notifications.id, b.id))) : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(opts.limit + 1);
  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  return { page, nextCursor: rows.length > opts.limit && last ? encodeCursor(last.createdAt, last.id) : null };
}

export async function unreadCount(db: Database, recipientId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.recipientId, recipientId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

/** Marks one of the recipient's own notifications read. False when it isn't theirs (or doesn't exist). */
export async function markRead(db: Database, recipientId: string, id: string): Promise<Notification | undefined> {
  const [row] = await db
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(and(eq(notifications.id, id), eq(notifications.recipientId, recipientId)))
    .returning();
  return row;
}

export async function markAllRead(db: Database, recipientId: string): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.recipientId, recipientId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return rows.length;
}

/** Only references and display text; the destination pages enforce access again. */
export function presentNotification(n: Notification) {
  return {
    id: n.id,
    type: n.type,
    message: n.message,
    link: n.bookingId
      ? { kind: "booking" as const, id: n.bookingId }
      : n.spaceId
        ? { kind: "listing" as const, id: n.spaceId }
        : null,
    read: n.readAt !== null,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}
