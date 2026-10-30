import { and, asc, count, desc, eq, gt, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client.js";
import {
  bookings,
  parkingBays,
  parkingSpaceHours,
  parkingSpacePhotos,
  parkingSpaces,
  parkingSpaceVehicleTypes,
  users,
  verificationRecords,
} from "../db/schema.js";
import type { Availability } from "../domain/availability.js";
import {
  approximateLocation,
  bookability,
  isPubliclyVisible,
  LOCATION_FIELDS,
  type ListingFacts,
  type ListingStatus,
  type VehicleClass,
} from "../domain/listing.js";
import { AppError } from "../http/errors.js";
import { listingMessage } from "../domain/notification.js";
import { lockSpaceBays } from "./bookings.js";
import { notify } from "./notifications.js";

export type Space = typeof parkingSpaces.$inferSelect;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Db = Database | Tx;

/** Editable listing columns (never ownerId, status or verification). */
export type ListingInput = Partial<
  Pick<
    Space,
    | "name"
    | "description"
    | "parkingType"
    | "addressLine"
    | "locality"
    | "city"
    | "region"
    | "postalCode"
    | "latitude"
    | "longitude"
    | "maxHeightCm"
    | "maxLengthCm"
    | "maxWidthCm"
    | "hourlyPriceMinor"
    | "dailyPriceMinor"
    | "minBookingMinutes"
    | "maxBookingMinutes"
    | "entryInstructions"
    | "parkingRules"
    | "accessibilityInfo"
    | "restrictions"
  >
>;

export interface Photo {
  id: string;
  contentType: string;
  byteSize: number;
  isCover: boolean;
  position: number;
  storageKey: string;
}

export interface ListingDetail {
  space: Space;
  vehicleTypes: VehicleClass[];
  hours: Availability["weekly"];
  bays: { id: string; label: string; status: "active" | "maintenance" | "retired" }[];
  photos: Photo[];
  ownerActive: boolean;
}

const hhmm = (t: string) => t.slice(0, 5);
const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function factsOf(d: ListingDetail): ListingFacts {
  return {
    status: d.space.status,
    verified: d.space.verifiedAt !== null,
    name: d.space.name,
    city: d.space.city,
    locality: d.space.locality,
    addressLine: d.space.addressLine,
    vehicleTypes: d.vehicleTypes,
    activeBays: d.bays.filter((b) => b.status === "active").length,
    hoursWindows: d.hours.length,
    ownerActive: d.ownerActive,
  };
}

export async function getListingDetail(db: Db, id: string): Promise<ListingDetail | undefined> {
  return (await getListingDetails(db, [id])).get(id);
}

/** Loads several listings with their relations in five queries, whatever the count. */
export async function getListingDetails(db: Db, ids: string[]): Promise<Map<string, ListingDetail>> {
  const out = new Map<string, ListingDetail>();
  if (!ids.length) return out;
  const [spaces, vehicleRows, hourRows, bayRows, photoRows] = await Promise.all([
    db.select().from(parkingSpaces).where(inArray(parkingSpaces.id, ids)),
    db.select().from(parkingSpaceVehicleTypes).where(inArray(parkingSpaceVehicleTypes.spaceId, ids)),
    db.select().from(parkingSpaceHours).where(inArray(parkingSpaceHours.spaceId, ids)),
    db.select().from(parkingBays).where(inArray(parkingBays.spaceId, ids)).orderBy(asc(parkingBays.createdAt)),
    db
      .select()
      .from(parkingSpacePhotos)
      .where(inArray(parkingSpacePhotos.spaceId, ids))
      .orderBy(desc(parkingSpacePhotos.isCover), asc(parkingSpacePhotos.position), asc(parkingSpacePhotos.createdAt)),
  ]);
  const ownerIds = [...new Set(spaces.map((s) => s.ownerId))];
  const owners = ownerIds.length
    ? await db.select({ id: users.id, status: users.status }).from(users).where(inArray(users.id, ownerIds))
    : [];
  const activeOwners = new Set(owners.filter((o) => o.status === "active").map((o) => o.id));
  for (const space of spaces) {
    const id = space.id;
    out.set(id, {
      space,
      ownerActive: activeOwners.has(space.ownerId),
      vehicleTypes: vehicleRows.filter((r) => r.spaceId === id).map((r) => r.vehicleClass).sort(),
      hours: hourRows
        .filter((h) => h.spaceId === id)
        .map((h) => ({ day: h.day, opens: hhmm(h.opens), closes: hhmm(h.closes) }))
        .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || a.opens.localeCompare(b.opens)),
      bays: bayRows.filter((b) => b.spaceId === id).map((b) => ({ id: b.id, label: b.label, status: b.status })),
      photos: photoRows
        .filter((p) => p.spaceId === id)
        .map((p) => ({
          id: p.id,
          contentType: p.contentType,
          byteSize: p.byteSize,
          isCover: p.isCover,
          position: p.position,
          storageKey: p.storageKey,
        })),
    });
  }
  return out;
}

async function setVehicleTypes(tx: Db, spaceId: string, types: VehicleClass[]): Promise<void> {
  await tx.delete(parkingSpaceVehicleTypes).where(eq(parkingSpaceVehicleTypes.spaceId, spaceId));
  if (types.length) {
    await tx.insert(parkingSpaceVehicleTypes).values([...new Set(types)].map((vehicleClass) => ({ spaceId, vehicleClass })));
  }
}

/**
 * Makes the number of non-retired bays equal `capacity`. Bays are never
 * deleted (bookings and devices reference them): extra bays are retired, and
 * retired bays are reactivated before new ones are created, so ids stay stable.
 * A bay with upcoming bookings can't be retired.
 */
async function setCapacity(tx: Tx, spaceId: string, capacity: number): Promise<void> {
  // Same lock confirmBooking takes, so the "upcoming bookings" check below
  // can't miss a confirmation committing at the same moment.
  await lockSpaceBays(tx, spaceId);
  const bays = await tx.select().from(parkingBays).where(eq(parkingBays.spaceId, spaceId));
  const num = (label: string) => Number(/^B(\d+)$/.exec(label)?.[1] ?? 0);
  const live = bays.filter((b) => b.status !== "retired").sort((a, b) => num(a.label) - num(b.label));
  const retired = bays.filter((b) => b.status === "retired").sort((a, b) => num(a.label) - num(b.label));

  if (capacity > live.length) {
    let needed = capacity - live.length;
    const revive = retired.slice(0, needed);
    if (revive.length) {
      await tx.update(parkingBays).set({ status: "active" }).where(inArray(parkingBays.id, revive.map((b) => b.id)));
      needed -= revive.length;
    }
    let next = Math.max(0, ...bays.map((b) => num(b.label))) + 1;
    if (needed > 0) {
      await tx.insert(parkingBays).values(Array.from({ length: needed }, () => ({ spaceId, label: `B${next++}` })));
    }
  } else if (capacity < live.length) {
    const toRetire = live.slice(capacity).map((b) => b.id);
    const [busy] = await tx
      .select({ n: count() })
      .from(bookings)
      .where(
        and(
          inArray(bookings.bayId, toRetire),
          inArray(bookings.status, ["pending", "confirmed", "active"]),
          gt(bookings.endsAt, new Date()),
        ),
      );
    if (busy!.n > 0) {
      throw new AppError(409, "capacity_in_use", "Some of the spaces you're removing have upcoming bookings");
    }
    await tx.update(parkingBays).set({ status: "retired" }).where(inArray(parkingBays.id, toRetire));
  }
}

export async function createListing(
  db: Database,
  ownerId: string,
  input: ListingInput & { name: string; hourlyPriceMinor: number },
  extra: { vehicleTypes: VehicleClass[]; capacity: number },
): Promise<ListingDetail> {
  const id = await db.transaction(async (tx) => {
    const [space] = await tx.insert(parkingSpaces).values({ ...input, ownerId, status: "draft", currency: "INR" }).returning();
    await setVehicleTypes(tx, space!.id, extra.vehicleTypes);
    await setCapacity(tx, space!.id, extra.capacity);
    return space!.id;
  });
  return (await getListingDetail(db, id))!;
}

/**
 * Applies an owner edit. Changing where the space is (or what kind it is)
 * invalidates its verification: a published listing goes back to review.
 */
export async function updateListing(
  db: Database,
  id: string,
  input: ListingInput,
  extra: { vehicleTypes?: VehicleClass[]; capacity?: number },
): Promise<ListingDetail> {
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(parkingSpaces).where(eq(parkingSpaces.id, id)).for("update");
    const patch: Partial<Space> = { ...input };
    const moved = LOCATION_FIELDS.some((f) => f in input && input[f] !== current![f]);
    if (moved && current!.verifiedAt) {
      patch.verifiedAt = null;
      if (current!.status === "published") patch.status = "pending_verification";
    }
    if (Object.keys(patch).length) await tx.update(parkingSpaces).set(patch).where(eq(parkingSpaces.id, id));
    if (extra.vehicleTypes) await setVehicleTypes(tx, id, extra.vehicleTypes);
    if (extra.capacity !== undefined) await setCapacity(tx, id, extra.capacity);
  });
  return (await getListingDetail(db, id))!;
}

export async function replaceHours(db: Database, id: string, availability: Availability | null): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(parkingSpaceHours).where(eq(parkingSpaceHours.spaceId, id));
    if (availability) {
      await tx.update(parkingSpaces).set({ timezone: availability.timezone }).where(eq(parkingSpaces.id, id));
      if (availability.weekly.length) {
        await tx.insert(parkingSpaceHours).values(availability.weekly.map((w) => ({ spaceId: id, ...w })));
      }
    }
  });
}

export async function setStatus(db: Database, id: string, status: ListingStatus): Promise<void> {
  await db.update(parkingSpaces).set({ status }).where(eq(parkingSpaces.id, id));
}

/** Upcoming bookings that still hold a bay; archiving with these would strand them. */
export async function upcomingBookingCount(db: Database, spaceId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(bookings)
    .where(
      and(eq(bookings.spaceId, spaceId), inArray(bookings.status, ["pending", "confirmed", "active"]), gt(bookings.endsAt, new Date())),
    );
  return row!.n;
}

export interface OwnerListFilter {
  status?: ListingStatus;
  q?: string;
  page: number;
  pageSize: number;
}

export async function listOwnerListings(db: Database, ownerId: string, f: OwnerListFilter) {
  const where: SQL[] = [eq(parkingSpaces.ownerId, ownerId)];
  if (f.status) where.push(eq(parkingSpaces.status, f.status));
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(parkingSpaces.name, like), ilike(parkingSpaces.city, like), ilike(parkingSpaces.locality, like))!);
  }
  const cond = and(...where);
  const [{ total }] = (await db.select({ total: count() }).from(parkingSpaces).where(cond)) as [{ total: number }];
  const rows = await db
    .select()
    .from(parkingSpaces)
    .where(cond)
    .orderBy(desc(parkingSpaces.updatedAt), asc(parkingSpaces.id))
    .limit(f.pageSize)
    .offset((f.page - 1) * f.pageSize);
  const ids = rows.map((r) => r.id);
  const [bayRows, coverRows] = ids.length
    ? await Promise.all([
        db
          .select({ spaceId: parkingBays.spaceId, n: count() })
          .from(parkingBays)
          .where(and(inArray(parkingBays.spaceId, ids), ne(parkingBays.status, "retired")))
          .groupBy(parkingBays.spaceId),
        db
          .select({ spaceId: parkingSpacePhotos.spaceId, id: parkingSpacePhotos.id })
          .from(parkingSpacePhotos)
          .where(and(inArray(parkingSpacePhotos.spaceId, ids), eq(parkingSpacePhotos.isCover, true))),
      ])
    : [[], []];
  const bays = new Map(bayRows.map((r) => [r.spaceId, r.n]));
  const covers = new Map(coverRows.map((r) => [r.spaceId, r.id]));
  return {
    total,
    rows: rows.map((s) => ({ space: s, capacity: bays.get(s.id) ?? 0, coverPhotoId: covers.get(s.id) ?? null })),
  };
}

export interface PublicSearch {
  q?: string;
  parkingType?: Space["parkingType"];
  vehicle?: VehicleClass;
  priceMinMinor?: number;
  priceMaxMinor?: number;
  /** When both are set, only listings bookable for this exact window (hours, rules, a free bay). */
  startsAt?: Date;
  endsAt?: Date;
  sort: "price_asc" | "price_desc" | "newest" | "name";
  page: number;
  pageSize: number;
}

/**
 * Discovery search over published, verified listings only. All filtering,
 * counting and paging happens in SQL; then one batched load for the page.
 * Free text matches public fields only (title, locality, city, state): the
 * private street address is never searchable.
 */
export async function searchPublicListings(db: Database, s: PublicSearch): Promise<{ total: number; rows: ListingDetail[] }> {
  const where: SQL[] = [
    eq(parkingSpaces.status, "published"),
    sql`${parkingSpaces.verifiedAt} is not null`,
    sql`exists (select 1 from ${users} o where o.id = ${parkingSpaces.ownerId} and o.status = 'active')`,
  ];
  if (s.q) {
    const like = `%${s.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(
      or(
        ilike(parkingSpaces.name, like),
        ilike(parkingSpaces.locality, like),
        ilike(parkingSpaces.city, like),
        ilike(parkingSpaces.region, like),
      )!,
    );
  }
  if (s.parkingType) where.push(eq(parkingSpaces.parkingType, s.parkingType));
  if (s.vehicle) {
    where.push(
      sql`exists (select 1 from ${parkingSpaceVehicleTypes} v where v.space_id = ${parkingSpaces.id} and v.vehicle_class = ${s.vehicle})`,
    );
  }
  if (s.priceMinMinor !== undefined) where.push(sql`${parkingSpaces.hourlyPriceMinor} >= ${s.priceMinMinor}`);
  if (s.priceMaxMinor !== undefined) where.push(sql`${parkingSpaces.hourlyPriceMinor} <= ${s.priceMaxMinor}`);
  if (s.startsAt && s.endsAt) {
    const start = s.startsAt.toISOString();
    const end = s.endsAt.toISOString();
    const minutes = (s.endsAt.getTime() - s.startsAt.getTime()) / 60_000;
    // Same rules as a booking request, evaluated in each listing's own time zone.
    where.push(sql`${minutes} >= ${parkingSpaces.minBookingMinutes}`);
    where.push(sql`(${parkingSpaces.maxBookingMinutes} is null or ${minutes} <= ${parkingSpaces.maxBookingMinutes})`);
    where.push(sql`exists (
      select 1 from ${parkingSpaceHours} h
      where h.space_id = ${parkingSpaces.id}
        and h.day::text = to_char(${start}::timestamptz at time zone ${parkingSpaces.timezone}, 'fmdy')
        and (${end}::timestamptz at time zone ${parkingSpaces.timezone})::date
            = (${start}::timestamptz at time zone ${parkingSpaces.timezone})::date
        and h.opens <= (${start}::timestamptz at time zone ${parkingSpaces.timezone})::time
        and h.closes >= (${end}::timestamptz at time zone ${parkingSpaces.timezone})::time
    )`);
    where.push(sql`exists (
      select 1 from ${parkingBays} bay
      where bay.space_id = ${parkingSpaces.id} and bay.status = 'active'
        and not exists (
          select 1 from ${bookings} b
          where b.bay_id = bay.id and b.status in ('confirmed', 'active')
            and b.starts_at < ${end}::timestamptz and b.ends_at > ${start}::timestamptz
        )
    )`);
  }
  const cond = and(...where);
  const order = {
    price_asc: [asc(parkingSpaces.hourlyPriceMinor), asc(parkingSpaces.id)],
    price_desc: [desc(parkingSpaces.hourlyPriceMinor), asc(parkingSpaces.id)],
    newest: [desc(parkingSpaces.verifiedAt), asc(parkingSpaces.id)],
    name: [asc(parkingSpaces.name), asc(parkingSpaces.id)],
  }[s.sort];
  const [{ total }] = (await db.select({ total: count() }).from(parkingSpaces).where(cond)) as [{ total: number }];
  const ids = (
    await db
      .select({ id: parkingSpaces.id })
      .from(parkingSpaces)
      .where(cond)
      .orderBy(...order)
      .limit(s.pageSize)
      .offset((s.page - 1) * s.pageSize)
  ).map((r) => r.id);
  const details = await getListingDetails(db, ids);
  return { total, rows: ids.map((id) => details.get(id)!).filter(Boolean) };
}

export async function listListingsForReview(db: Database): Promise<Space[]> {
  return db.select().from(parkingSpaces).where(eq(parkingSpaces.status, "pending_verification")).orderBy(asc(parkingSpaces.updatedAt));
}

/** Records a staff review decision and applies it to the listing. */
export async function reviewListing(
  db: Database,
  id: string,
  reviewerId: string,
  decision: "approve" | "reject",
  notes: string | undefined,
): Promise<void> {
  await db.transaction(async (tx) => {
    const now = new Date();
    const [record] = await tx.insert(verificationRecords).values({
      entityType: "parking_space",
      entityId: id,
      method: "manual_review",
      status: decision === "approve" ? "verified" : "rejected",
      verifiedBy: reviewerId,
      verifiedAt: now,
      notes,
    }).returning({ id: verificationRecords.id });
    const [space] = await tx
      .update(parkingSpaces)
      .set(decision === "approve" ? { status: "published", verifiedAt: now } : { status: "draft", verifiedAt: null })
      .where(eq(parkingSpaces.id, id))
      .returning({ ownerId: parkingSpaces.ownerId, name: parkingSpaces.name });
    // The reviewer's note stays on the listing page (owner-only), not in the notification.
    const type = decision === "approve" ? "listing_approved" : "listing_changes_requested";
    await notify(tx, [
      { recipientId: space!.ownerId, type, spaceId: id, message: listingMessage(type, space!.name), dedupeKey: `listing:${id}:review:${record!.id}` },
    ]);
  });
}

export interface ReviewNote {
  status: "pending" | "verified" | "rejected" | "expired";
  notes: string | null;
  at: Date | null;
}

export async function latestReviewNote(db: Database, spaceId: string): Promise<ReviewNote | null> {
  const [row] = await db
    .select({ status: verificationRecords.status, notes: verificationRecords.notes, at: verificationRecords.verifiedAt })
    .from(verificationRecords)
    .where(and(eq(verificationRecords.entityType, "parking_space"), eq(verificationRecords.entityId, spaceId)))
    .orderBy(desc(verificationRecords.createdAt))
    .limit(1);
  return row ?? null;
}

// ---------- presentation ----------

const photoUrl = (id: string) => `/api/v1/listing-photos/${id}`;
const money = (minor: number | null) => (minor == null ? null : { amountMinor: minor, currency: "INR" });

/** Everything about the listing, for its owner only. */
export function presentOwnerListing(d: ListingDetail, review: ReviewNote | null = null) {
  const s = d.space;
  const facts = factsOf(d);
  return {
    id: s.id,
    societyId: s.societyId,
    name: s.name,
    description: s.description,
    parkingType: s.parkingType,
    address: {
      line: s.addressLine,
      locality: s.locality,
      city: s.city,
      region: s.region,
      postalCode: s.postalCode,
      countryCode: s.countryCode,
    },
    location: s.latitude != null && s.longitude != null ? { latitude: s.latitude, longitude: s.longitude } : null,
    vehicleTypes: d.vehicleTypes,
    maxDimensionsCm: { height: s.maxHeightCm, length: s.maxLengthCm, width: s.maxWidthCm },
    capacity: facts.activeBays,
    bays: d.bays.filter((b) => b.status !== "retired"),
    hourlyPrice: money(s.hourlyPriceMinor)!,
    dailyPrice: money(s.dailyPriceMinor),
    bookingMinutes: { min: s.minBookingMinutes, max: s.maxBookingMinutes },
    availability: d.hours.length ? { timezone: s.timezone, weekly: d.hours } : null,
    entryInstructions: s.entryInstructions,
    parkingRules: s.parkingRules,
    accessibilityInfo: s.accessibilityInfo,
    restrictions: s.restrictions,
    photos: d.photos.map((p) => ({ id: p.id, url: photoUrl(p.id), isCover: p.isCover, contentType: p.contentType, byteSize: p.byteSize })),
    status: s.status,
    verified: facts.verified,
    verifiedAt: s.verifiedAt?.toISOString() ?? null,
    lastReview: review ? { status: review.status, notes: review.notes, at: review.at?.toISOString() ?? null } : null,
    publiclyVisible: isPubliclyVisible(facts),
    bookability: bookability(facts),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/**
 * What drivers see. No owner identity, street address, exact coordinates,
 * entry instructions, society link or internal bay/device identifiers.
 */
export function presentPublicListing(d: ListingDetail) {
  const s = d.space;
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    parkingType: s.parkingType,
    area: { locality: s.locality, city: s.city, region: s.region, countryCode: s.countryCode },
    approximateLocation: approximateLocation(s.latitude, s.longitude),
    vehicleTypes: d.vehicleTypes,
    maxDimensionsCm: { height: s.maxHeightCm, length: s.maxLengthCm, width: s.maxWidthCm },
    capacity: d.bays.filter((b) => b.status === "active").length,
    hourlyPrice: money(s.hourlyPriceMinor)!,
    dailyPrice: money(s.dailyPriceMinor),
    bookingMinutes: { min: s.minBookingMinutes, max: s.maxBookingMinutes },
    availability: d.hours.length ? { timezone: s.timezone, weekly: d.hours } : null,
    parkingRules: s.parkingRules,
    accessibilityInfo: s.accessibilityInfo,
    restrictions: s.restrictions,
    photos: d.photos.map((p) => ({ id: p.id, url: photoUrl(p.id), isCover: p.isCover })),
  };
}

export function presentOwnerSummary(r: { space: Space; capacity: number; coverPhotoId: string | null }) {
  const s = r.space;
  return {
    id: s.id,
    name: s.name,
    parkingType: s.parkingType,
    address: { line: s.addressLine, locality: s.locality, city: s.city, region: s.region },
    hourlyPrice: money(s.hourlyPriceMinor)!,
    capacity: r.capacity,
    status: s.status,
    verified: s.verifiedAt !== null,
    coverPhotoUrl: r.coverPhotoId ? photoUrl(r.coverPhotoId) : null,
    updatedAt: s.updatedAt.toISOString(),
  };
}
