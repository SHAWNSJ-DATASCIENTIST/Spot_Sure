import { randomUUID } from "node:crypto";
import { and, asc, count, eq, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { requireAuth } from "../auth/plugin.js";
import { assertOwnsSpace, assertPlatformAdmin, assertRole } from "../auth/policies.js";
import { parkingSpacePhotos } from "../db/schema.js";
import { availabilitySchema } from "../domain/availability.js";
import { priceBreakdown, requestProblems, windowProblems } from "../domain/booking.js";
import { ImageError, prepareListingImage } from "../domain/images.js";
import {
  applyOwnerAction,
  bookability,
  completenessIssues,
  isPubliclyVisible,
  LISTING_STATUSES,
  MAX_CAPACITY,
  MAX_PHOTOS,
  OWNER_ACTIONS,
  PARKING_TYPES,
  TransitionError,
  VEHICLE_CLASSES,
} from "../domain/listing.js";
import { AppError, NotFoundError } from "../http/errors.js";
import { isoInstant, parse } from "../http/validate.js";
import { freeBays, listBookingsForSpace, presentBooking } from "../repositories/bookings.js";
import {
  createListing,
  factsOf,
  getListingDetail,
  latestReviewNote,
  listListingsForReview,
  listOwnerListings,
  presentOwnerListing,
  presentOwnerSummary,
  presentPublicListing,
  replaceHours,
  searchPublicListings,
  reviewListing,
  setStatus,
  upcomingBookingCount,
  updateListing,
  type ListingDetail,
} from "../repositories/listings.js";
import { photoKey, StorageNotConfiguredError } from "../storage/photos.js";

// ---------- validation ----------

/** Optional free text: trimmed, empty string stored as null. */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const listingFields = {
  name: z.string().trim().min(3, "Give the listing a title of at least 3 characters").max(120),
  description: optText(2000),
  parkingType: z.enum(PARKING_TYPES),
  addressLine: optText(200),
  locality: optText(100),
  city: optText(100),
  region: optText(100),
  // Spaces and dashes are dropped first: dictation tends to read "403 001".
  postalCode: z
    .string()
    .trim()
    .transform((v) => (/^[\d\s-]+\.?$/.test(v) ? v.replace(/[\s.-]/g, "") : v))
    .pipe(z.string().regex(/^\d{6}$/, "Use a 6-digit PIN code"))
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  maxHeightCm: z.number().int().min(100, "At least 100 cm").max(600, "At most 600 cm").nullable().optional(),
  maxLengthCm: z.number().int().min(150, "At least 150 cm").max(2000, "At most 2000 cm").nullable().optional(),
  maxWidthCm: z.number().int().min(80, "At least 80 cm").max(400, "At most 400 cm").nullable().optional(),
  hourlyPriceMinor: z.number().int("Use whole paise").min(0, "Price can't be negative").max(10_000_000),
  dailyPriceMinor: z.number().int("Use whole paise").min(0, "Price can't be negative").max(100_000_000).nullable().optional(),
  minBookingMinutes: z.number().int().min(15, "At least 15 minutes").max(43_200),
  maxBookingMinutes: z.number().int().min(15).max(43_200, "At most 30 days").nullable().optional(),
  entryInstructions: optText(2000),
  parkingRules: optText(2000),
  accessibilityInfo: optText(1000),
  restrictions: optText(1000),
  vehicleTypes: z.array(z.enum(VEHICLE_CLASSES)).max(VEHICLE_CLASSES.length),
  capacity: z.number().int("Whole spaces only").min(1, "At least 1 space").max(MAX_CAPACITY, `At most ${MAX_CAPACITY} spaces`),
};

// ownerId, status, currency and verification are never accepted from clients.
const createBody = z
  .object(listingFields)
  .partial()
  .required({ name: true, hourlyPriceMinor: true })
  .strict();
const patchBody = z.object(listingFields).partial().strict();
type ListingBody = z.infer<typeof patchBody>;

/** Rules that span fields, checked against the merged (existing + incoming) values. */
function crossFieldIssues(merged: {
  latitude?: number | null;
  longitude?: number | null;
  minBookingMinutes?: number;
  maxBookingMinutes?: number | null;
}): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if ((merged.latitude == null) !== (merged.longitude == null)) {
    issues.push({ path: "longitude", message: "Give both latitude and longitude, or neither" });
  }
  if (merged.maxBookingMinutes != null && merged.maxBookingMinutes < (merged.minBookingMinutes ?? 60)) {
    issues.push({ path: "maxBookingMinutes", message: "Must be at least the minimum booking time" });
  }
  return issues;
}

function assertCrossField(merged: Parameters<typeof crossFieldIssues>[0]) {
  const issues = crossFieldIssues(merged);
  if (issues.length) throw new AppError(400, "validation_failed", "Request validation failed", issues);
}

function split(body: ListingBody) {
  const { vehicleTypes, capacity, ...columns } = body;
  return { columns, extra: { vehicleTypes, capacity } };
}

/** Free text as typed or dictated: single spaces, no trailing sentence punctuation ("Panaji." finds Panaji). */
const searchText = z
  .string()
  .max(200)
  .transform((v) => v.trim().replace(/\s+/g, " ").replace(/[.,!?;:]+$/, "").trim())
  .pipe(z.string().max(100))
  .optional();

const idParams = z.object({ id: z.uuid() });
const photoParams = z.object({ id: z.uuid(), photoId: z.uuid() });
/** Rupee amount in a query string ("40", "40.5") → paise. */
const rupees = z
  .string()
  .regex(/^\d{1,7}(\.\d{1,2})?$/, "Use a rupee amount like 40 or 40.50")
  .transform((v) => Math.round(Number(v) * 100));

const publicSearchQuery = z
  .object({
    q: searchText,
    type: z.enum(PARKING_TYPES).optional(),
    vehicle: z.enum(VEHICLE_CLASSES).optional(),
    priceMin: rupees.optional(),
    priceMax: rupees.optional(),
    startsAt: isoInstant.optional(),
    endsAt: isoInstant.optional(),
    sort: z.enum(["price_asc", "price_desc", "newest", "name"]).default("newest"),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(24).default(12),
  })
  .strict()
  .refine((s) => s.priceMin === undefined || s.priceMax === undefined || s.priceMin <= s.priceMax, {
    path: ["priceMax"],
    message: "Maximum price must be at least the minimum",
  })
  .refine((s) => (s.startsAt === undefined) === (s.endsAt === undefined), {
    path: ["endsAt"],
    message: "Give both a start and an end time, or neither",
  });

const quoteQuery = z.object({ startsAt: isoInstant, endsAt: isoInstant }).strict();
const ownerListQuery = z
  .object({
    status: z.enum(LISTING_STATUSES).optional(),
    q: searchText,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();
const actionBody = z.object({ action: z.enum(OWNER_ACTIONS) }).strict();
const reviewBody = z
  .object({ decision: z.enum(["approve", "reject"]), notes: z.string().trim().max(1000).optional() })
  .strict()
  .refine((b) => b.decision === "approve" || (b.notes && b.notes.length > 0), {
    path: ["notes"],
    message: "Explain what the owner needs to fix",
  });

export async function parkingSpaceRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const db = deps.db.db;
  const storage = deps.photoStorage;
  const writeLimit = { rateLimit: { max: 60, timeWindow: 60 * 60_000 } };

  // Raw image bodies for photo uploads; any other type is rejected with 415.
  app.addContentTypeParser(
    ["image/jpeg", "image/png"],
    { parseAs: "buffer", bodyLimit: deps.env.PHOTO_MAX_BYTES },
    (_req, body, done) => done(null, body),
  );

  /** Loads a listing the signed-in user owns, or fails with 404/403. */
  async function loadOwned(req: Parameters<typeof requireAuth>[0], id: string): Promise<ListingDetail> {
    const auth = requireAuth(req);
    const detail = await getListingDetail(db, id);
    if (!detail) throw new NotFoundError("Parking space");
    assertOwnsSpace(auth, detail.space);
    return detail;
  }

  const ownerView = async (d: ListingDetail) => presentOwnerListing(d, await latestReviewNote(db, d.space.id));

  // ---------- public ----------

  app.get("/parking-spaces", async (req) => {
    const s = parse(publicSearchQuery, req.query);
    let window: { startsAt: Date; endsAt: Date } | undefined;
    if (s.startsAt && s.endsAt) {
      window = { startsAt: new Date(s.startsAt), endsAt: new Date(s.endsAt) };
      const problems = windowProblems(window.startsAt, window.endsAt);
      if (problems.length) {
        throw new AppError(400, "validation_failed", problems[0]!, problems.map((message) => ({ path: "startsAt", message })));
      }
    }
    const { total, rows } = await searchPublicListings(db, {
      q: s.q || undefined,
      parkingType: s.type,
      vehicle: s.vehicle,
      priceMinMinor: s.priceMin,
      priceMaxMinor: s.priceMax,
      ...window,
      sort: s.sort,
      page: s.page,
      pageSize: s.pageSize,
    });
    return {
      data: rows.map(presentPublicListing),
      page: { page: s.page, pageSize: s.pageSize, total, totalPages: Math.max(1, Math.ceil(total / s.pageSize)) },
    };
  });

  // What a request for this window would cost and whether a space is free
  // right now. Advisory: the booking request re-checks everything.
  app.get("/parking-spaces/:id/quote", async (req) => {
    const { id } = parse(idParams, req.params);
    const q = parse(quoteQuery, req.query);
    const detail = await getListingDetail(db, id);
    if (!detail || !isPubliclyVisible(factsOf(detail))) throw new NotFoundError("Parking space");
    const startsAt = new Date(q.startsAt);
    const endsAt = new Date(q.endsAt);
    const problems = requestProblems(startsAt, endsAt, {
      timezone: detail.space.timezone,
      weekly: detail.hours,
      minBookingMinutes: detail.space.minBookingMinutes,
      maxBookingMinutes: detail.space.maxBookingMinutes,
    });
    const bookable = bookability(factsOf(detail));
    if (!bookable.bookable) problems.push(...bookable.reasons);
    const free = problems.length ? [] : await freeBays(db, id, startsAt, endsAt);
    return {
      data: {
        problems,
        available: problems.length === 0 && free.length > 0,
        // Free spaces at this moment; a pending request does not reserve one.
        freeSpaces: free.length,
        price: endsAt > startsAt ? priceBreakdown(detail.space.hourlyPriceMinor, startsAt, endsAt, detail.space.dailyPriceMinor) : null,
      },
    };
  });

  app.get("/parking-spaces/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    const detail = await getListingDetail(db, id);
    // One 404 for missing, draft, unverified, unpublished and archived alike.
    if (!detail || !isPubliclyVisible(factsOf(detail))) throw new NotFoundError("Parking space");
    return { data: presentPublicListing(detail) };
  });

  app.get("/listing-photos/:photoId", async (req, reply) => {
    const { photoId } = parse(z.object({ photoId: z.uuid() }), req.params);
    const photo = await db.query.parkingSpacePhotos.findFirst({ where: eq(parkingSpacePhotos.id, photoId) });
    const detail = photo ? await getListingDetail(db, photo.spaceId) : undefined;
    const allowed = detail && (isPubliclyVisible(factsOf(detail)) || req.auth?.id === detail.space.ownerId);
    if (!photo || !allowed) throw new NotFoundError("Photo");
    const bytes = await storage.read(photo.storageKey);
    return reply.type(photo.contentType).header("content-disposition", "inline").send(bytes);
  });

  // ---------- owner ----------

  app.post("/parking-spaces", { config: writeLimit }, async (req, reply) => {
    const auth = requireAuth(req);
    assertRole(auth, "parking_owner");
    const body = parse(createBody, req.body);
    assertCrossField(body);
    const { columns, extra } = split(body);
    const detail = await createListing(db, auth.id, { ...columns, name: body.name, hourlyPriceMinor: body.hourlyPriceMinor }, {
      vehicleTypes: extra.vehicleTypes ?? [],
      capacity: extra.capacity ?? 1,
    });
    return reply.status(201).send({ data: await ownerView(detail) });
  });

  app.get("/me/parking-spaces", async (req) => {
    const auth = requireAuth(req);
    const f = parse(ownerListQuery, req.query);
    const { total, rows } = await listOwnerListings(db, auth.id, { ...f, q: f.q || undefined });
    return {
      data: rows.map(presentOwnerSummary),
      page: { page: f.page, pageSize: f.pageSize, total, totalPages: Math.max(1, Math.ceil(total / f.pageSize)) },
    };
  });

  app.get("/me/parking-spaces/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    return { data: await ownerView(await loadOwned(req, id)) };
  });

  // Exactly what drivers would see once the listing is live.
  app.get("/parking-spaces/:id/preview", async (req) => {
    const { id } = parse(idParams, req.params);
    return { data: presentPublicListing(await loadOwned(req, id)) };
  });

  app.patch("/parking-spaces/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(patchBody, req.body);
    const current = await loadOwned(req, id);
    if (current.space.status === "archived") {
      throw new AppError(409, "listing_archived", "Restore the listing before editing it");
    }
    assertCrossField({ ...current.space, ...body });
    const { columns, extra } = split(body);
    return { data: await ownerView(await updateListing(db, id, columns, extra)) };
  });

  app.post("/parking-spaces/:id/actions", async (req) => {
    const { id } = parse(idParams, req.params);
    const { action } = parse(actionBody, req.body);
    const detail = await loadOwned(req, id);
    let next;
    try {
      next = applyOwnerAction(factsOf(detail), action);
    } catch (err) {
      if (err instanceof TransitionError) {
        throw new AppError(err.code === "incomplete_listing" ? 422 : 409, err.code, err.message, err.issues.length ? err.issues : undefined);
      }
      throw err;
    }
    if (action === "archive" && (await upcomingBookingCount(db, id)) > 0) {
      throw new AppError(409, "listing_has_bookings", "This listing has upcoming bookings, so it can't be archived yet");
    }
    await setStatus(db, id, next);
    return { data: await ownerView((await getListingDetail(db, id))!) };
  });

  // Replaces the weekly hours; null clears them.
  app.put("/parking-spaces/:id/availability", async (req) => {
    const { id } = parse(idParams, req.params);
    const availability = parse(availabilitySchema.nullable(), req.body);
    await loadOwned(req, id);
    await replaceHours(db, id, availability);
    return { data: await ownerView((await getListingDetail(db, id))!) };
  });

  app.get("/parking-spaces/:id/bookings", async (req) => {
    const { id } = parse(idParams, req.params);
    await loadOwned(req, id);
    return { data: (await listBookingsForSpace(db, id)).map((r) => presentBooking(r, "owner")) };
  });

  // ---------- photos ----------

  app.post("/parking-spaces/:id/photos", { config: writeLimit }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const detail = await loadOwned(req, id);
    if (storage.driver === "unconfigured") throw new StorageNotConfiguredError();
    if (!Buffer.isBuffer(req.body)) {
      throw new AppError(415, "unsupported_media_type", "Send the image bytes with Content-Type image/jpeg or image/png");
    }
    if (detail.photos.length >= MAX_PHOTOS) {
      throw new AppError(409, "too_many_photos", `A listing can have at most ${MAX_PHOTOS} photos`);
    }
    let image;
    try {
      image = prepareListingImage(req.body);
    } catch (err) {
      if (err instanceof ImageError) throw new AppError(400, err.code, err.message);
      throw err;
    }
    const photoId = randomUUID();
    const key = photoKey(id, photoId, image.type);
    await storage.put(key, image.data);
    try {
      await db.insert(parkingSpacePhotos).values({
        id: photoId,
        spaceId: id,
        storageKey: key,
        contentType: image.type,
        byteSize: image.data.length,
        position: detail.photos.length,
        isCover: detail.photos.length === 0,
      });
    } catch (err) {
      await storage.remove(key).catch(() => {});
      throw err;
    }
    return reply.status(201).send({ data: await ownerView((await getListingDetail(db, id))!) });
  });

  app.delete("/parking-spaces/:id/photos/:photoId", async (req) => {
    const { id, photoId } = parse(photoParams, req.params);
    const detail = await loadOwned(req, id);
    const photo = detail.photos.find((p) => p.id === photoId);
    if (!photo) throw new NotFoundError("Photo");
    await db.transaction(async (tx) => {
      await tx.delete(parkingSpacePhotos).where(eq(parkingSpacePhotos.id, photoId));
      if (photo.isCover) {
        const [next] = await tx
          .select({ id: parkingSpacePhotos.id })
          .from(parkingSpacePhotos)
          .where(eq(parkingSpacePhotos.spaceId, id))
          .orderBy(asc(parkingSpacePhotos.position))
          .limit(1);
        if (next) await tx.update(parkingSpacePhotos).set({ isCover: true }).where(eq(parkingSpacePhotos.id, next.id));
      }
    });
    // The row is gone either way; a leftover file is unreachable and harmless.
    await storage.remove(photo.storageKey).catch((err) => req.log.warn({ err }, "Photo file removal failed"));
    return { data: await ownerView((await getListingDetail(db, id))!) };
  });

  app.put("/parking-spaces/:id/photos/:photoId/cover", async (req) => {
    const { id, photoId } = parse(photoParams, req.params);
    const detail = await loadOwned(req, id);
    if (!detail.photos.some((p) => p.id === photoId)) throw new NotFoundError("Photo");
    await db.transaction(async (tx) => {
      await tx
        .update(parkingSpacePhotos)
        .set({ isCover: false })
        .where(and(eq(parkingSpacePhotos.spaceId, id), ne(parkingSpacePhotos.id, photoId)));
      await tx.update(parkingSpacePhotos).set({ isCover: true }).where(eq(parkingSpacePhotos.id, photoId));
    });
    return { data: await ownerView((await getListingDetail(db, id))!) };
  });

  // ---------- platform staff review ----------

  app.get("/admin/parking-spaces", async (req) => {
    const auth = requireAuth(req);
    assertPlatformAdmin(auth);
    const rows = await listListingsForReview(db);
    const counts = await Promise.all(
      rows.map(async (s) => (await db.select({ n: count() }).from(parkingSpacePhotos).where(eq(parkingSpacePhotos.spaceId, s.id)))[0]!.n),
    );
    return {
      data: rows.map((s, i) => ({
        id: s.id,
        name: s.name,
        parkingType: s.parkingType,
        address: { line: s.addressLine, locality: s.locality, city: s.city, region: s.region, postalCode: s.postalCode },
        photoCount: counts[i],
        submittedAt: s.updatedAt.toISOString(),
      })),
    };
  });

  app.post("/admin/parking-spaces/:id/review", async (req) => {
    const auth = requireAuth(req);
    assertPlatformAdmin(auth);
    const { id } = parse(idParams, req.params);
    const body = parse(reviewBody, req.body);
    const detail = await getListingDetail(db, id);
    if (!detail) throw new NotFoundError("Parking space");
    if (detail.space.ownerId === auth.id) {
      throw new AppError(403, "forbidden", "You can't review your own listing");
    }
    if (detail.space.status !== "pending_verification") {
      throw new AppError(409, "not_pending", "Only listings waiting for review can be reviewed");
    }
    // Listings migrated into review never passed the submit checklist, so
    // approval re-checks it rather than trusting the status.
    const missing = completenessIssues(factsOf(detail));
    if (body.decision === "approve" && missing.length) {
      throw new AppError(409, "incomplete_listing", "This listing is missing required details; reject it with a note instead", missing);
    }
    await reviewListing(db, id, auth.id, body.decision, body.notes);
    return { data: { id, status: body.decision === "approve" ? "published" : "draft" } };
  });
}
