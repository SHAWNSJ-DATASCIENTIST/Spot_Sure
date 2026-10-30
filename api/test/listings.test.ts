import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDb, type DbHandle } from "../src/db/client.js";
import { bookings, parkingBays, users, verificationRecords } from "../src/db/schema.js";
import { buildIntegrations } from "../src/integrations/index.js";
import { LocalDiskStorage } from "../src/storage/photos.js";
import { resetTestDatabase, testDatabaseUrl, testEnv } from "./helpers.js";

// Parking listing registry: validation, ownership, lifecycle and verification,
// public visibility, capacity/bays, opening hours and photos, against real
// PostgreSQL and a temporary photo directory.

const url = testDatabaseUrl;
const ORIGIN = "http://localhost:5173";
const PASSWORD = "correct horse battery";

// ---------- image fixtures (real file structures, no image library) ----------

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function makePng(width: number, height: number, text?: string): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    ...(text ? [pngChunk("tEXt", Buffer.from(`Comment\0${text}`, "latin1"))] : []),
    pngChunk("IDAT", Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeJpeg(width: number, height: number, exif?: string): Buffer {
  const seg = (marker: number, data: Buffer) => {
    const head = Buffer.from([0xff, marker, 0, 0]);
    head.writeUInt16BE(data.length + 2, 2);
    return Buffer.concat([head, data]);
  };
  const sof = Buffer.alloc(15);
  sof.writeUInt8(8, 0);
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof.writeUInt8(3, 5);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
    ...(exif ? [seg(0xe1, Buffer.from(`Exif\0\0${exif}`, "latin1"))] : []),
    seg(0xc0, sof),
    seg(0xda, Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0x56, 0xff, 0xd9]),
  ]);
}

const completeListing = {
  name: "Shady Driveway",
  description: "Covered driveway next to the park.",
  parkingType: "private_driveway",
  addressLine: "14 Test Street",
  locality: "Altinho",
  city: "Panaji",
  region: "Goa",
  postalCode: "403001",
  latitude: 15.497234,
  longitude: 73.826712,
  vehicleTypes: ["car", "motorcycle"],
  maxHeightCm: 210,
  capacity: 2,
  hourlyPriceMinor: 4000,
  dailyPriceMinor: 30000,
  minBookingMinutes: 60,
  maxBookingMinutes: 720,
  entryInstructions: "Gate code 4821. Park on the left.",
  parkingRules: "No overnight parking.",
  accessibilityInfo: "Step-free access from the street.",
  restrictions: "No vehicles taller than 2.1 m.",
};
const hours = { timezone: "Asia/Kolkata", weekly: [{ day: "mon", opens: "08:00", closes: "20:00" }] };

describe.skipIf(!url)("parking listing registry", () => {
  let handle: DbHandle;
  let app: FastifyInstance;
  let photoDir: string;
  let n = 0;

  beforeAll(async () => {
    handle = createDb(url!, { max: 3 });
    await resetTestDatabase(handle);
    photoDir = await mkdtemp(path.join(os.tmpdir(), "spotsure-photos-"));
    const env = testEnv({ DATABASE_URL: url!, AUTH_RATE_LIMIT_MAX: "1000", RATE_LIMIT_MAX: "10000", PHOTO_MAX_BYTES: "100000" });
    app = await buildApp({
      env,
      db: createDb(url!, { max: 3 }),
      integrations: buildIntegrations(env),
      version: "test",
      photoStorage: new LocalDiskStorage(photoDir),
    });
  });

  afterAll(async () => {
    await app?.close();
    await handle?.close();
    if (photoDir) await rm(photoDir, { recursive: true, force: true });
  });

  const cookieOf = (res: LightMyRequestResponse) => `ss_session=${res.cookies.find((c) => c.name === "ss_session")!.value}`;
  const req = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", p: string, cookie?: string, payload?: unknown) =>
    app.inject({
      method,
      url: `/api/v1${p}`,
      headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
  const upload = (id: string, cookie: string, body: Buffer, type = "image/png") =>
    app.inject({ method: "POST", url: `/api/v1/parking-spaces/${id}/photos`, headers: { origin: ORIGIN, cookie, "content-type": type }, payload: body });

  async function register(role: "driver" | "parking_owner" = "parking_owner") {
    const res = await req("POST", "/auth/register", undefined, {
      fullName: `Listing ${role} ${++n}`,
      email: `listing${n}@test.invalid`,
      password: PASSWORD,
      passwordConfirmation: PASSWORD,
      role,
    });
    expect(res.statusCode).toBe(201);
    return { id: res.json().data.id as string, cookie: cookieOf(res) };
  }

  async function staff() {
    const s = await register("driver");
    await handle.db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, s.id));
    return s;
  }

  async function create(cookie: string, body: object = completeListing) {
    const res = await req("POST", "/parking-spaces", cookie, body);
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data;
  }

  async function publishedListing() {
    const owner = await register();
    const l = await create(owner.cookie);
    expect((await req("PUT", `/parking-spaces/${l.id}/availability`, owner.cookie, hours)).statusCode).toBe(200);
    expect((await req("POST", `/parking-spaces/${l.id}/actions`, owner.cookie, { action: "submit" })).json().data.status).toBe(
      "pending_verification",
    );
    const reviewer = await staff();
    expect((await req("POST", `/admin/parking-spaces/${l.id}/review`, reviewer.cookie, { decision: "approve" })).statusCode).toBe(200);
    return { owner, listing: l, reviewer };
  }

  describe("create and read", () => {
    it("creates a listing with relational vehicle types and one bay per space", async () => {
      const owner = await register();
      const l = await create(owner.cookie);
      expect(l).toMatchObject({
        name: "Shady Driveway",
        parkingType: "private_driveway",
        address: { line: "14 Test Street", locality: "Altinho", city: "Panaji", region: "Goa", postalCode: "403001", countryCode: "IN" },
        location: { latitude: 15.497234, longitude: 73.826712 },
        vehicleTypes: ["car", "motorcycle"],
        maxDimensionsCm: { height: 210, length: null, width: null },
        capacity: 2,
        hourlyPrice: { amountMinor: 4000, currency: "INR" },
        dailyPrice: { amountMinor: 30000, currency: "INR" },
        bookingMinutes: { min: 60, max: 720 },
        status: "draft",
        verified: false,
        publiclyVisible: false,
        bookability: { bookable: false },
      });
      expect(l.bays.map((b: { label: string }) => b.label)).toEqual(["B1", "B2"]);

      const again = await req("GET", `/me/parking-spaces/${l.id}`, owner.cookie);
      expect(again.json().data).toMatchObject({ id: l.id, entryInstructions: "Gate code 4821. Park on the left." });
    });

    it("accepts a PIN code read out with spaces or dashes, and stores the digits", async () => {
      const owner = await register();
      for (const pin of ["403 001", "403-001", "403 001."]) {
        expect((await create(owner.cookie, { name: "Spoken PIN", hourlyPriceMinor: 100, postalCode: pin })).address.postalCode).toBe("403001");
      }
      const bad = await req("POST", "/parking-spaces", owner.cookie, { name: "Bad PIN", hourlyPriceMinor: 100, postalCode: "403 00" });
      expect(bad.statusCode).toBe(400);
    });

    it("saves an incomplete draft with only a title and price", async () => {
      const owner = await register();
      const l = await create(owner.cookie, { name: "Half done", hourlyPriceMinor: 0 });
      expect(l).toMatchObject({ status: "draft", parkingType: "other", capacity: 1, vehicleTypes: [] });
    });
  });

  describe("validation", () => {
    it("rejects missing, malformed and out-of-range fields", async () => {
      const owner = await register();
      const bad: [string, object][] = [
        ["missing title", { hourlyPriceMinor: 100 }],
        ["missing price", { name: "No price" }],
        ["negative price", { name: "Neg", hourlyPriceMinor: -1 }],
        ["fractional paise", { name: "Frac", hourlyPriceMinor: 10.5 }],
        ["negative daily", { name: "Neg daily", hourlyPriceMinor: 1, dailyPriceMinor: -5 }],
        ["zero capacity", { name: "Cap", hourlyPriceMinor: 1, capacity: 0 }],
        ["huge capacity", { name: "Cap", hourlyPriceMinor: 1, capacity: 501 }],
        ["fractional capacity", { name: "Cap", hourlyPriceMinor: 1, capacity: 1.5 }],
        ["latitude out of range", { name: "Geo", hourlyPriceMinor: 1, latitude: 91, longitude: 0 }],
        ["latitude without longitude", { name: "Geo", hourlyPriceMinor: 1, latitude: 15.4 }],
        ["bad PIN", { name: "Pin", hourlyPriceMinor: 1, postalCode: "40300" }],
        ["unknown type", { name: "Type", hourlyPriceMinor: 1, parkingType: "spaceport" }],
        ["unknown vehicle", { name: "Veh", hourlyPriceMinor: 1, vehicleTypes: ["tank"] }],
        ["height too low", { name: "Dim", hourlyPriceMinor: 1, maxHeightCm: 50 }],
        ["max under min", { name: "Dur", hourlyPriceMinor: 1, minBookingMinutes: 120, maxBookingMinutes: 60 }],
        ["min too short", { name: "Dur", hourlyPriceMinor: 1, minBookingMinutes: 5 }],
        ["client owner id", { name: "Own", hourlyPriceMinor: 1, ownerId: owner.id }],
        ["client status", { name: "St", hourlyPriceMinor: 1, status: "published" }],
        ["client currency", { name: "Cur", hourlyPriceMinor: 1, currency: "USD" }],
        ["client verification", { name: "Ver", hourlyPriceMinor: 1, verifiedAt: new Date().toISOString() }],
      ];
      for (const [label, body] of bad) {
        const res = await req("POST", "/parking-spaces", owner.cookie, body);
        expect(res.statusCode, label).toBe(400);
        expect(res.json().error.code, label).toBe("validation_failed");
      }
    });

    it("checks cross-field rules against the stored listing on edit", async () => {
      const owner = await register();
      const l = await create(owner.cookie);
      // Existing max is 720; a min above it must fail even though max isn't in the patch.
      const res = await req("PATCH", `/parking-spaces/${l.id}`, owner.cookie, { minBookingMinutes: 900 });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details).toEqual([{ path: "maxBookingMinutes", message: "Must be at least the minimum booking time" }]);
    });

    it("rejects invalid opening hours", async () => {
      const owner = await register();
      const l = await create(owner.cookie);
      for (const body of [
        { timezone: "Mars/Base", weekly: [] },
        { timezone: "Asia/Kolkata", weekly: [{ day: "mon", opens: "20:00", closes: "08:00" }] },
        { timezone: "Asia/Kolkata", weekly: [{ day: "mon", opens: "08:00", closes: "12:00" }, { day: "mon", opens: "11:00", closes: "14:00" }] },
        { timezone: "Asia/Kolkata", weekly: [{ day: "mon", opens: "8am", closes: "12:00" }] },
      ]) {
        expect((await req("PUT", `/parking-spaces/${l.id}/availability`, owner.cookie, body)).statusCode, JSON.stringify(body)).toBe(400);
      }
      const ok = await req("PUT", `/parking-spaces/${l.id}/availability`, owner.cookie, hours);
      expect(ok.json().data.availability).toEqual(hours);
    });
  });

  describe("capacity and bays", () => {
    it("retires and revives bays instead of deleting them, keeping ids stable", async () => {
      const owner = await register();
      const l = await create(owner.cookie, { ...completeListing, capacity: 3 });
      const ids = l.bays.map((b: { id: string }) => b.id);

      const down = (await req("PATCH", `/parking-spaces/${l.id}`, owner.cookie, { capacity: 1 })).json().data;
      expect(down.capacity).toBe(1);
      expect(down.bays.map((b: { id: string }) => b.id)).toEqual([ids[0]]);
      const all = await handle.db.select().from(parkingBays).where(eq(parkingBays.spaceId, l.id));
      expect(all).toHaveLength(3);

      const up = (await req("PATCH", `/parking-spaces/${l.id}`, owner.cookie, { capacity: 4 })).json().data;
      expect(up.capacity).toBe(4);
      expect(up.bays.map((b: { id: string }) => b.id).slice(0, 3).sort()).toEqual([...ids].sort());
    });

    it("refuses to remove a space that has an upcoming booking", async () => {
      const owner = await register();
      const driver = await register("driver");
      const l = await create(owner.cookie);
      await handle.db.insert(bookings).values({
        userId: driver.id,
        spaceId: l.id,
        bayId: l.bays[1].id,
        startsAt: new Date(Date.now() + 86_400_000),
        endsAt: new Date(Date.now() + 90_000_000),
        status: "confirmed",
        hourlyPriceMinorSnapshot: 4000,
        totalPriceMinor: 4000,
        currency: "INR",
      });
      const res = await req("PATCH", `/parking-spaces/${l.id}`, owner.cookie, { capacity: 1 });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("capacity_in_use");
    });
  });

  describe("lifecycle and verification", () => {
    it("won't submit an incomplete listing, and lists what's missing", async () => {
      const owner = await register();
      const l = await create(owner.cookie, { name: "Bare", hourlyPriceMinor: 100 });
      const res = await req("POST", `/parking-spaces/${l.id}/actions`, owner.cookie, { action: "submit" });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.details.map((d: { path: string }) => d.path).sort()).toEqual(
        ["addressLine", "city", "hours", "locality", "vehicleTypes"].sort(),
      );
    });

    it("needs staff approval before a listing is public, and status changes alone never make it bookable", async () => {
      const owner = await register();
      const l = await create(owner.cookie);
      await req("PUT", `/parking-spaces/${l.id}/availability`, owner.cookie, hours);

      const submitted = (await req("POST", `/parking-spaces/${l.id}/actions`, owner.cookie, { action: "submit" })).json().data;
      expect(submitted).toMatchObject({ status: "pending_verification", publiclyVisible: false, bookability: { bookable: false } });
      expect((await req("GET", `/parking-spaces/${l.id}`)).statusCode).toBe(404);
      // The owner can't jump to published.
      expect((await req("POST", `/parking-spaces/${l.id}/actions`, owner.cookie, { action: "publish" })).statusCode).toBe(409);

      const reviewer = await staff();
      const approve = await req("POST", `/admin/parking-spaces/${l.id}/review`, reviewer.cookie, { decision: "approve" });
      expect(approve.statusCode).toBe(200);
      const live = (await req("GET", `/me/parking-spaces/${l.id}`, owner.cookie)).json().data;
      expect(live).toMatchObject({ status: "published", verified: true, publiclyVisible: true });
      expect(live.bookability).toEqual({ bookable: true, reasons: [] });
      expect((await req("GET", `/parking-spaces/${l.id}`)).statusCode).toBe(200);
      const records = await handle.db.select().from(verificationRecords).where(eq(verificationRecords.entityId, l.id));
      expect(records).toEqual([expect.objectContaining({ entityType: "parking_space", status: "verified", verifiedBy: reviewer.id })]);
    });

    it("unpublishes and republishes without re-review while verified", async () => {
      const { owner, listing } = await publishedListing();
      expect((await req("POST", `/parking-spaces/${listing.id}/actions`, owner.cookie, { action: "unpublish" })).json().data.status).toBe("unpublished");
      expect((await req("GET", `/parking-spaces/${listing.id}`)).statusCode).toBe(404);
      expect((await req("POST", `/parking-spaces/${listing.id}/actions`, owner.cookie, { action: "publish" })).json().data.status).toBe("published");
      expect((await req("GET", `/parking-spaces/${listing.id}`)).statusCode).toBe(200);
    });

    it("lets an unpublished listing that lost verification go back to review", async () => {
      const { owner, listing } = await publishedListing();
      await req("POST", `/parking-spaces/${listing.id}/actions`, owner.cookie, { action: "unpublish" });
      const moved = (await req("PATCH", `/parking-spaces/${listing.id}`, owner.cookie, { city: "Margao" })).json().data;
      expect(moved).toMatchObject({ status: "unpublished", verified: false });
      expect((await req("POST", `/parking-spaces/${listing.id}/actions`, owner.cookie, { action: "publish" })).json().error.code).toBe(
        "needs_verification",
      );
      const resubmitted = await req("POST", `/parking-spaces/${listing.id}/actions`, owner.cookie, { action: "submit" });
      expect(resubmitted.json().data.status).toBe("pending_verification");
    });

    it("sends a published listing back to review when its location changes", async () => {
      const { owner, listing } = await publishedListing();
      // Non-location edits keep it live.
      expect((await req("PATCH", `/parking-spaces/${listing.id}`, owner.cookie, { hourlyPriceMinor: 4500 })).json().data.status).toBe("published");
      const moved = (await req("PATCH", `/parking-spaces/${listing.id}`, owner.cookie, { addressLine: "99 Other Road" })).json().data;
      expect(moved).toMatchObject({ status: "pending_verification", verified: false, publiclyVisible: false });
      expect((await req("GET", `/parking-spaces/${listing.id}`)).statusCode).toBe(404);
    });

    it("archives without deleting history, but not while bookings are upcoming", async () => {
      const { owner, listing } = await publishedListing();
      const driver = await register("driver");
      const [booking] = await handle.db
        .insert(bookings)
        .values({
          userId: driver.id,
          spaceId: listing.id,
          bayId: listing.bays[0].id,
          startsAt: new Date(Date.now() + 86_400_000),
          endsAt: new Date(Date.now() + 90_000_000),
          status: "confirmed",
          hourlyPriceMinorSnapshot: 4000,
          totalPriceMinor: 4000,
          currency: "INR",
        })
        .returning();
      const blocked = await req("POST", `/parking-spaces/${listing.id}/actions`, owner.cookie, { action: "archive" });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error.code).toBe("listing_has_bookings");

      await handle.db.update(bookings).set({ status: "completed" }).where(eq(bookings.id, booking!.id));
      const archived = await req("POST", `/parking-spaces/${listing.id}/actions`, owner.cookie, { action: "archive" });
      expect(archived.json().data.status).toBe("archived");
      expect((await req("GET", `/parking-spaces/${listing.id}`)).statusCode).toBe(404);
      expect((await req("PATCH", `/parking-spaces/${listing.id}`, owner.cookie, { name: "Edit me" })).statusCode).toBe(409);
      // History is intact.
      expect(await handle.db.select().from(bookings).where(eq(bookings.spaceId, listing.id))).toHaveLength(1);
      expect((await req("GET", `/parking-spaces/${listing.id}/bookings`, owner.cookie)).json().data).toHaveLength(1);

      const restored = await req("POST", `/parking-spaces/${listing.id}/actions`, owner.cookie, { action: "restore" });
      expect(restored.json().data.status).toBe("unpublished");
    });

    it("requires a reason to reject, and returns the listing to draft with the note", async () => {
      const owner = await register();
      const l = await create(owner.cookie);
      await req("PUT", `/parking-spaces/${l.id}/availability`, owner.cookie, hours);
      await req("POST", `/parking-spaces/${l.id}/actions`, owner.cookie, { action: "submit" });
      const reviewer = await staff();
      expect((await req("POST", `/admin/parking-spaces/${l.id}/review`, reviewer.cookie, { decision: "reject" })).statusCode).toBe(400);
      await req("POST", `/admin/parking-spaces/${l.id}/review`, reviewer.cookie, { decision: "reject", notes: "Photos don't show the space" });
      const back = (await req("GET", `/me/parking-spaces/${l.id}`, owner.cookie)).json().data;
      expect(back).toMatchObject({ status: "draft", lastReview: { status: "rejected", notes: "Photos don't show the space" } });
    });

    it("won't approve an incomplete listing that reached review without the checklist", async () => {
      const owner = await register();
      const l = await create(owner.cookie, { name: "Migrated, no address", hourlyPriceMinor: 100 });
      // As the 0004 migration does for listings that were public before verification existed.
      await handle.db.execute(sql`update parking_spaces set status = 'pending_verification' where id = ${l.id}`);
      const reviewer = await staff();
      const res = await req("POST", `/admin/parking-spaces/${l.id}/review`, reviewer.cookie, { decision: "approve" });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("incomplete_listing");
      expect((await req("GET", `/parking-spaces/${l.id}`)).statusCode).toBe(404);
      const reject = await req("POST", `/admin/parking-spaces/${l.id}/review`, reviewer.cookie, { decision: "reject", notes: "Add the address" });
      expect(reject.statusCode).toBe(200);
    });

    it("keeps review to platform staff, never the listing's own owner", async () => {
      const owner = await register();
      const l = await create(owner.cookie);
      await req("PUT", `/parking-spaces/${l.id}/availability`, owner.cookie, hours);
      await req("POST", `/parking-spaces/${l.id}/actions`, owner.cookie, { action: "submit" });
      expect((await req("POST", `/admin/parking-spaces/${l.id}/review`, owner.cookie, { decision: "approve" })).statusCode).toBe(403);
      expect((await req("GET", "/admin/parking-spaces", owner.cookie)).statusCode).toBe(403);
      await handle.db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, owner.id));
      const self = await req("POST", `/admin/parking-spaces/${l.id}/review`, owner.cookie, { decision: "approve" });
      expect(self.statusCode).toBe(403);
    });
  });

  describe("ownership and roles", () => {
    it("blocks every owner operation on someone else's listing", async () => {
      const a = await register();
      const b = await register();
      const l = await create(a.cookie);
      const attempts = [
        req("GET", `/me/parking-spaces/${l.id}`, b.cookie),
        req("GET", `/parking-spaces/${l.id}/preview`, b.cookie),
        req("PATCH", `/parking-spaces/${l.id}`, b.cookie, { name: "Mine now" }),
        req("POST", `/parking-spaces/${l.id}/actions`, b.cookie, { action: "archive" }),
        req("PUT", `/parking-spaces/${l.id}/availability`, b.cookie, hours),
        upload(l.id, b.cookie, makePng(400, 300)),
      ];
      for (const res of await Promise.all(attempts)) expect(res.statusCode, res.raw.req.url).toBe(403);
      expect((await req("GET", `/me/parking-spaces/${l.id}`, a.cookie)).json().data.name).toBe("Shady Driveway");
    });

    it("lets only parking owners create listings", async () => {
      const driver = await register("driver");
      expect((await req("POST", "/parking-spaces", driver.cookie, completeListing)).statusCode).toBe(403);
      expect((await req("POST", "/parking-spaces", undefined, completeListing)).statusCode).toBe(401);
    });
  });

  describe("public visibility", () => {
    it("hides private details and approximates location", async () => {
      const { owner, listing } = await publishedListing();
      const pub = await req("GET", `/parking-spaces/${listing.id}`);
      const data = pub.json().data;
      expect(data.approximateLocation).toEqual({ latitude: 15.5, longitude: 73.83 });
      expect(data.area).toEqual({ locality: "Altinho", city: "Panaji", region: "Goa", countryCode: "IN" });
      for (const secret of ["14 Test Street", "Gate code", owner.id, listing.bays[0].id, "15.497234"]) {
        expect(pub.body).not.toContain(secret);
      }
      // The owner's preview shows exactly this public shape.
      const preview = (await req("GET", `/parking-spaces/${listing.id}/preview`, owner.cookie)).json().data;
      expect(preview).toEqual(data);
      const list = (await req("GET", "/parking-spaces?pageSize=24")).json().data;
      expect(list.map((x: { id: string }) => x.id)).toContain(listing.id);
    });

    it("lists only published, verified listings publicly", async () => {
      const owner = await register();
      const draft = await create(owner.cookie, { ...completeListing, name: "Private draft" });
      const list = (await req("GET", "/parking-spaces?pageSize=24")).json().data.map((x: { id: string }) => x.id);
      expect(list).not.toContain(draft.id);
    });
  });

  describe("owner list filters", () => {
    it("filters by status and text and paginates", async () => {
      const owner = await register();
      for (const name of ["Alpha Lot", "Beta Lot", "Gamma Garage"]) await create(owner.cookie, { ...completeListing, name });
      const one = await create(owner.cookie, { ...completeListing, name: "Delta Lot", city: "Margao" });
      await req("POST", `/parking-spaces/${one.id}/actions`, owner.cookie, { action: "archive" });

      const page1 = (await req("GET", "/me/parking-spaces?pageSize=2&page=1", owner.cookie)).json();
      expect(page1.data).toHaveLength(2);
      expect(page1.page).toEqual({ page: 1, pageSize: 2, total: 4, totalPages: 2 });
      const page2 = (await req("GET", "/me/parking-spaces?pageSize=2&page=2", owner.cookie)).json();
      expect(new Set([...page1.data, ...page2.data].map((x: { id: string }) => x.id)).size).toBe(4);

      const lots = (await req("GET", "/me/parking-spaces?q=lot", owner.cookie)).json().data.map((x: { name: string }) => x.name).sort();
      expect(lots).toEqual(["Alpha Lot", "Beta Lot", "Delta Lot"]);
      expect((await req("GET", "/me/parking-spaces?q=margao", owner.cookie)).json().data.map((x: { name: string }) => x.name)).toEqual(["Delta Lot"]);
      expect((await req("GET", "/me/parking-spaces?status=archived", owner.cookie)).json().data.map((x: { name: string }) => x.name)).toEqual(["Delta Lot"]);
      // LIKE wildcards in the search box are literal.
      expect((await req("GET", "/me/parking-spaces?q=%25", owner.cookie)).json().data).toEqual([]);
      expect((await req("GET", "/me/parking-spaces?status=live", owner.cookie)).statusCode).toBe(400);
    });
  });

  describe("photos", () => {
    it("stores validated photos without location metadata and manages the cover", async () => {
      const owner = await register();
      const l = await create(owner.cookie);

      const png = await upload(l.id, owner.cookie, makePng(400, 300, "GPS 15.4972N 73.8267E"));
      expect(png.statusCode, png.body).toBe(201);
      const jpg = await upload(l.id, owner.cookie, makeJpeg(640, 480, "GPSLatitude 15.4972"), "image/jpeg");
      expect(jpg.statusCode, jpg.body).toBe(201);
      const photos = jpg.json().data.photos as { id: string; isCover: boolean; url: string }[];
      expect(photos).toHaveLength(2);
      expect(photos.filter((p) => p.isCover)).toHaveLength(1);
      expect(photos[0]!.isCover).toBe(true);

      // Files on disk carry no metadata text.
      const dir = path.join(photoDir, l.id);
      for (const f of await readdir(dir)) {
        const bytes = await readFile(path.join(dir, f));
        expect(bytes.toString("latin1")).not.toContain("GPS");
      }

      // The owner can fetch a draft's photo; nobody else can.
      expect((await req("GET", photos[1]!.url.replace("/api/v1", ""), owner.cookie)).headers["content-type"]).toBe("image/jpeg");
      expect((await req("GET", photos[1]!.url.replace("/api/v1", ""))).statusCode).toBe(404);

      const cover = await req("PUT", `/parking-spaces/${l.id}/photos/${photos[1]!.id}/cover`, owner.cookie);
      expect(cover.json().data.photos.find((p: { isCover: boolean }) => p.isCover).id).toBe(photos[1]!.id);

      const del = await req("DELETE", `/parking-spaces/${l.id}/photos/${photos[1]!.id}`, owner.cookie);
      const left = del.json().data.photos;
      expect(left).toHaveLength(1);
      expect(left[0].isCover).toBe(true);
      expect(await readdir(dir)).toHaveLength(1);
    });

    it("rejects files that aren't acceptable images", async () => {
      const owner = await register();
      const l = await create(owner.cookie);
      const gif = Buffer.from("GIF89a\x01\x00\x01\x00", "latin1");
      const cases: [string, Buffer, string, number][] = [
        ["GIF sent as PNG", gif, "image/png", 400],
        ["HTML sent as PNG", Buffer.from("<html><script>alert(1)</script></html>"), "image/png", 400],
        ["truncated PNG", makePng(400, 300).subarray(0, 30), "image/png", 400],
        ["too small", makePng(20, 20), "image/png", 400],
        ["too large dimensions", makePng(9000, 300), "image/png", 400],
        ["webp type", makePng(400, 300), "image/webp", 415],
        ["multipart/form", makePng(400, 300), "application/octet-stream", 415],
        ["over size limit", Buffer.concat([makePng(400, 300), Buffer.alloc(120_000)]), "image/png", 413],
      ];
      for (const [label, body, type, status] of cases) {
        expect((await upload(l.id, owner.cookie, body, type)).statusCode, label).toBe(status);
      }
      expect((await req("GET", `/me/parking-spaces/${l.id}`, owner.cookie)).json().data.photos).toEqual([]);
    });

    it("caps photos per listing", async () => {
      const owner = await register();
      const l = await create(owner.cookie);
      for (let i = 0; i < 10; i++) expect((await upload(l.id, owner.cookie, makePng(300, 300))).statusCode).toBe(201);
      const extra = await upload(l.id, owner.cookie, makePng(300, 300));
      expect(extra.statusCode).toBe(409);
      expect(extra.json().error.code).toBe("too_many_photos");
    });

    it("serves photos publicly once the listing is live", async () => {
      const { owner, listing } = await publishedListing();
      const up = await upload(listing.id, owner.cookie, makePng(400, 300));
      const photoUrl = up.json().data.photos[0].url.replace("/api/v1", "");
      const pub = await req("GET", photoUrl);
      expect(pub.statusCode).toBe(200);
      expect(pub.headers["content-type"]).toBe("image/png");
      expect(pub.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("answers 503, not a fake success, when no storage is configured", async () => {
      const env = testEnv({ DATABASE_URL: url!, AUTH_RATE_LIMIT_MAX: "1000" });
      const bare = await buildApp({ env, db: createDb(url!, { max: 1 }), integrations: buildIntegrations(env), version: "t" });
      try {
        const owner = await register();
        const l = await create(owner.cookie);
        const res = await bare.inject({
          method: "POST",
          url: `/api/v1/parking-spaces/${l.id}/photos`,
          headers: { origin: ORIGIN, cookie: owner.cookie, "content-type": "image/png" },
          payload: makePng(400, 300),
        });
        expect(res.statusCode).toBe(503);
        expect(res.json().error.code).toBe("storage_not_configured");
      } finally {
        await bare.close();
      }
    });
  });
});
