import { eq } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDb, type DbHandle } from "../src/db/client.js";
import { bookings, users } from "../src/db/schema.js";
import { localParts, quoteTotalMinor, requestProblems } from "../src/domain/booking.js";
import { buildIntegrations } from "../src/integrations/index.js";
import { resetTestDatabase, testDatabaseUrl, testEnv } from "./helpers.js";

// Booking requests (pilot, no payments): validation, server-side pricing,
// owner confirmation with database-enforced no-overlap, and lifecycle rules.

const url = testDatabaseUrl;
const ORIGIN = "http://localhost:5173";
const PASSWORD = "correct horse battery";
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const allWeek = { timezone: "Asia/Kolkata", weekly: DAYS.map((day) => ({ day, opens: "06:00", closes: "23:00" })) };

/** An ISO instant at HH:MM India time, `daysAhead` days from now. */
function ist(daysAhead: number, hhmm: string): string {
  const { date } = localParts(new Date(Date.now() + daysAhead * 86_400_000), "Asia/Kolkata");
  return `${date}T${hhmm}:00+05:30`;
}

describe("domain rules", () => {
  const rules = { timezone: "Asia/Kolkata", weekly: allWeek.weekly, minBookingMinutes: 60, maxBookingMinutes: 480 };
  it("accepts a slot inside opening hours", () => {
    expect(requestProblems(new Date(ist(2, "10:00")), new Date(ist(2, "12:00")), rules)).toEqual([]);
  });
  it("explains every problem with a request", () => {
    expect(requestProblems(new Date(ist(2, "05:00")), new Date(ist(2, "07:00")), rules)).toContain("That time isn't within the space's opening hours");
    expect(requestProblems(new Date(ist(2, "10:00")), new Date(ist(2, "10:30")), rules)).toContain("This space needs at least 60 minutes");
    expect(requestProblems(new Date(ist(2, "10:10")), new Date(ist(2, "12:00")), rules)).toContain("Times must be on 15-minute steps");
    expect(requestProblems(new Date(ist(-1, "10:00")), new Date(ist(-1, "12:00")), rules)).toContain("The start time has already passed");
    expect(requestProblems(new Date(ist(90, "10:00")), new Date(ist(90, "12:00")), rules)).toContain("Bookings can be made up to 60 days ahead");
    expect(requestProblems(new Date(ist(2, "08:00")), new Date(ist(2, "18:00")), rules)).toContain("This space allows at most 480 minutes");
  });
  it("prices per started hour, capped by the daily price", () => {
    const s = new Date("2026-12-01T04:30:00Z");
    expect(quoteTotalMinor(4000, s, new Date("2026-12-01T06:30:00Z"))).toBe(8000);
    expect(quoteTotalMinor(4000, s, new Date("2026-12-01T06:45:00Z"))).toBe(12000);
    expect(quoteTotalMinor(4000, s, new Date("2026-12-01T14:30:00Z"), 30000)).toBe(30000);
  });
});

describe.skipIf(!url)("booking requests", () => {
  let handle: DbHandle;
  let app: FastifyInstance;
  let n = 0;

  beforeAll(async () => {
    handle = createDb(url!, { max: 5 });
    await resetTestDatabase(handle);
    const env = testEnv({ DATABASE_URL: url!, AUTH_RATE_LIMIT_MAX: "1000", RATE_LIMIT_MAX: "100000", BOOKING_RATE_LIMIT_MAX: "1000" });
    app = await buildApp({ env, db: createDb(url!, { max: 10 }), integrations: buildIntegrations(env), version: "test" });
  });
  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  const cookieOf = (res: LightMyRequestResponse) => `ss_session=${res.cookies.find((c) => c.name === "ss_session")!.value}`;
  const req = (method: "GET" | "POST" | "PATCH" | "PUT", p: string, cookie?: string, payload?: unknown) =>
    app.inject({
      method,
      url: `/api/v1${p}`,
      headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });

  async function register(role: "driver" | "parking_owner") {
    const res = await req("POST", "/auth/register", undefined, {
      fullName: `Booking ${role} ${++n}`,
      email: `booking${n}@test.invalid`,
      password: PASSWORD,
      passwordConfirmation: PASSWORD,
      role,
    });
    expect(res.statusCode).toBe(201);
    return { id: res.json().data.id as string, cookie: cookieOf(res) };
  }

  /** A verified, published listing with `capacity` spaces open 06:00–23:00 every day. */
  async function liveListing(capacity = 1, extra: object = {}) {
    const owner = await register("parking_owner");
    const created = await req("POST", "/parking-spaces", owner.cookie, {
      name: `Bookable ${n}`,
      parkingType: "garage",
      addressLine: "7 Private Road",
      locality: "Altinho",
      city: "Panaji",
      vehicleTypes: ["car"],
      capacity,
      hourlyPriceMinor: 4000,
      entryInstructions: "Gate code 1234",
      maxBookingMinutes: 720,
      ...extra,
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().data.id as string;
    await req("PUT", `/parking-spaces/${id}/availability`, owner.cookie, allWeek);
    await req("POST", `/parking-spaces/${id}/actions`, owner.cookie, { action: "submit" });
    const staff = await register("driver");
    await handle.db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, staff.id));
    const ok = await req("POST", `/admin/parking-spaces/${id}/review`, staff.cookie, { decision: "approve" });
    expect(ok.statusCode, ok.body).toBe(200);
    return { owner, id };
  }

  const request = (cookie: string, spaceId: string, from = ist(2, "10:00"), to = ist(2, "12:00")) =>
    req("POST", "/bookings", cookie, { spaceId, startsAt: from, endsAt: to });

  it("records a pending request with a server-computed price and nothing paid", async () => {
    const { id } = await liveListing();
    const driver = await register("driver");
    const res = await request(driver.cookie, id);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().data).toMatchObject({
      status: "pending",
      price: { hourlyAmountMinor: 4000, totalAmountMinor: 8000, currency: "INR" },
      payment: { status: "not_collected" },
      privateAccess: null,
      area: { locality: "Altinho", city: "Panaji" },
    });
    expect(res.body).not.toContain("7 Private Road");
    expect(res.body).not.toContain("Gate code");
  });

  it("rejects invalid requests and anything the client tries to dictate", async () => {
    const { owner, id } = await liveListing();
    const driver = await register("driver");
    const cases: [string, unknown, number][] = [
      ["outside hours", { spaceId: id, startsAt: ist(2, "04:00"), endsAt: ist(2, "06:00") }, 400],
      ["in the past", { spaceId: id, startsAt: ist(-1, "10:00"), endsAt: ist(-1, "12:00") }, 400],
      ["too short", { spaceId: id, startsAt: ist(2, "10:00"), endsAt: ist(2, "10:30") }, 400],
      ["off-grid", { spaceId: id, startsAt: ist(2, "10:07"), endsAt: ist(2, "12:00") }, 400],
      ["no zone", { spaceId: id, startsAt: "2026-12-01T10:00:00", endsAt: "2026-12-01T12:00:00" }, 400],
      ["client price", { spaceId: id, startsAt: ist(2, "10:00"), endsAt: ist(2, "12:00"), totalPriceMinor: 1 }, 400],
      ["client status", { spaceId: id, startsAt: ist(2, "10:00"), endsAt: ist(2, "12:00"), status: "confirmed" }, 400],
      ["client user", { spaceId: id, startsAt: ist(2, "10:00"), endsAt: ist(2, "12:00"), userId: owner.id }, 400],
      ["paid flag", { spaceId: id, startsAt: ist(2, "10:00"), endsAt: ist(2, "12:00"), paid: true }, 400],
      ["unknown space", { spaceId: "00000000-0000-4000-8000-000000000000", startsAt: ist(2, "10:00"), endsAt: ist(2, "12:00") }, 404],
    ];
    for (const [label, body, status] of cases) {
      expect((await req("POST", "/bookings", driver.cookie, body)).statusCode, label).toBe(status);
    }
    expect((await request(owner.cookie, id)).statusCode).toBe(403);
    expect((await req("POST", "/bookings", undefined, { spaceId: id, startsAt: ist(2, "10:00"), endsAt: ist(2, "12:00") })).statusCode).toBe(401);
  });

  it("won't take requests for listings drivers can't see", async () => {
    const owner = await register("parking_owner");
    const draft = (await req("POST", "/parking-spaces", owner.cookie, { name: "Draft only", hourlyPriceMinor: 100 })).json().data.id;
    const driver = await register("driver");
    expect((await request(driver.cookie, draft)).statusCode).toBe(404);
  });

  it("lets the owner confirm, then reveals the address only to the booker", async () => {
    const { owner, id } = await liveListing();
    const driver = await register("driver");
    const bookingId = (await request(driver.cookie, id)).json().data.id;
    const ownerView = await req("POST", `/bookings/${bookingId}/confirm`, owner.cookie);
    expect(ownerView.statusCode).toBe(200);
    expect(ownerView.json().data).toMatchObject({ status: "confirmed", privateAccess: null });
    expect(ownerView.json().data).not.toHaveProperty("userId");
    const mine = (await req("GET", `/bookings/${bookingId}`, driver.cookie)).json().data;
    expect(mine.privateAccess).toEqual({ address: "7 Private Road, Altinho, Panaji", entryInstructions: "Gate code 1234" });
    const activity = (await req("GET", "/me/space-bookings", owner.cookie)).json().data;
    expect(activity.map((b: { id: string }) => b.id)).toContain(bookingId);
  });

  it("never confirms two overlapping bookings on one bay, even concurrently", async () => {
    const { owner, id } = await liveListing(1);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = await register("driver");
      const r = await request(d.cookie, id, ist(3, "09:00"), ist(3, "11:00"));
      expect(r.statusCode, r.body).toBe(201);
      ids.push(r.json().data.id);
    }
    const results = await Promise.all(ids.map((b) => req("POST", `/bookings/${b}/confirm`, owner.cookie)));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409).every((r) => r.json().error.code === "slot_taken")).toBe(true);
    const rows = await handle.db.select().from(bookings).where(eq(bookings.spaceId, id));
    expect(rows.filter((b) => b.status === "confirmed")).toHaveLength(1);
    expect(rows.filter((b) => b.status === "pending")).toHaveLength(4);
    // With the only bay held, new requests for that time are refused up front.
    const late = await register("driver");
    expect((await request(late.cookie, id, ist(3, "10:00"), ist(3, "12:00"))).json().error.code).toBe("no_space_available");
  });

  it("uses another free bay when the requested one was taken", async () => {
    const { owner, id } = await liveListing(2);
    const a = await register("driver");
    const b = await register("driver");
    const ra = (await request(a.cookie, id, ist(4, "09:00"), ist(4, "11:00"))).json().data;
    const rb = (await request(b.cookie, id, ist(4, "10:00"), ist(4, "12:00"))).json().data;
    expect(ra.bayId).toBe(rb.bayId);
    const results = await Promise.all([ra.id, rb.id].map((x) => req("POST", `/bookings/${x}/confirm`, owner.cookie)));
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    const bays = results.map((r) => r.json().data.bayId);
    expect(new Set(bays).size).toBe(2);
  });

  it("enforces who may do what, and in which state", async () => {
    const { owner, id } = await liveListing(2);
    const driver = await register("driver");
    const stranger = await register("driver");
    const one = (await request(driver.cookie, id, ist(5, "09:00"), ist(5, "10:00"))).json().data.id;
    expect((await req("POST", `/bookings/${one}/confirm`, driver.cookie)).statusCode).toBe(403);
    expect((await req("POST", `/bookings/${one}/cancel`, stranger.cookie)).statusCode).toBe(404);
    expect((await req("GET", `/bookings/${one}`, stranger.cookie)).statusCode).toBe(404);

    const declined = (await req("POST", `/bookings/${one}/decline`, owner.cookie)).json().data;
    expect(declined).toMatchObject({ status: "cancelled", cancelledBy: "owner" });
    expect((await req("POST", `/bookings/${one}/confirm`, owner.cookie)).statusCode).toBe(409);

    const two = (await request(driver.cookie, id, ist(5, "11:00"), ist(5, "12:00"))).json().data.id;
    await req("POST", `/bookings/${two}/confirm`, owner.cookie);
    const cancelled = (await req("POST", `/bookings/${two}/cancel`, driver.cookie)).json().data;
    expect(cancelled).toMatchObject({ status: "cancelled", cancelledBy: "driver", privateAccess: null });
    expect((await req("POST", `/bookings/${two}/cancel`, driver.cookie)).statusCode).toBe(409);
  });

  it("refuses a second overlapping request from the same driver", async () => {
    const { id } = await liveListing(3);
    const driver = await register("driver");
    expect((await request(driver.cookie, id, ist(6, "09:00"), ist(6, "11:00"))).statusCode).toBe(201);
    const again = await request(driver.cookie, id, ist(6, "10:00"), ist(6, "12:00"));
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("duplicate_request");
  });

  it("keeps confirmed bookings when a listing is unpublished, and blocks archiving", async () => {
    const { owner, id } = await liveListing();
    const driver = await register("driver");
    const b = (await request(driver.cookie, id, ist(7, "09:00"), ist(7, "10:00"))).json().data.id;
    await req("POST", `/bookings/${b}/confirm`, owner.cookie);
    expect((await req("POST", `/parking-spaces/${id}/actions`, owner.cookie, { action: "unpublish" })).statusCode).toBe(200);
    expect((await req("GET", `/bookings/${b}`, driver.cookie)).json().data.status).toBe("confirmed");
    const other = await register("driver");
    expect((await request(other.cookie, id, ist(7, "11:00"), ist(7, "12:00"))).statusCode).toBe(404);
    expect((await req("POST", `/parking-spaces/${id}/actions`, owner.cookie, { action: "archive" })).json().error.code).toBe("listing_has_bookings");
  });

  it("expires unanswered requests and completes past bookings when they are read", async () => {
    const { owner, id } = await liveListing(2);
    const driver = await register("driver");
    const pending = (await request(driver.cookie, id, ist(8, "09:00"), ist(8, "10:00"))).json().data.id;
    const held = (await request(driver.cookie, id, ist(8, "11:00"), ist(8, "12:00"))).json().data.id;
    await req("POST", `/bookings/${held}/confirm`, owner.cookie);
    // Move both into the past, as if time had passed.
    const past = (h: number) => new Date(Date.now() - h * 3_600_000);
    await handle.db.update(bookings).set({ startsAt: past(5), endsAt: past(4) }).where(eq(bookings.id, pending));
    await handle.db.update(bookings).set({ startsAt: past(3), endsAt: past(2) }).where(eq(bookings.id, held));
    const mine = (await req("GET", "/me/bookings", driver.cookie)).json().data as { id: string; status: string }[];
    expect(mine.find((x) => x.id === pending)!.status).toBe("expired");
    expect(mine.find((x) => x.id === held)!.status).toBe("completed");
    expect((await req("POST", `/bookings/${pending}/confirm`, owner.cookie)).statusCode).toBe(409);
  });
});
