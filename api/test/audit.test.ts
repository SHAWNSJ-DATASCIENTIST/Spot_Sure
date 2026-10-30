import { eq } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDb, type DbHandle } from "../src/db/client.js";
import { bookings, users } from "../src/db/schema.js";
import { localParts } from "../src/domain/booking.js";
import { buildIntegrations } from "../src/integrations/index.js";
import { resetTestDatabase, testDatabaseUrl, testEnv } from "./helpers.js";

// Regressions for defects found in the launch audit (Prompt 08), plus the
// full primary journey end to end against real PostgreSQL.

const url = testDatabaseUrl;
const ORIGIN = "http://localhost:5173";
const PASSWORD = "correct horse battery";
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const ist = (daysAhead: number, hhmm: string) =>
  `${localParts(new Date(Date.now() + daysAhead * 86_400_000), "Asia/Kolkata").date}T${hhmm}:00+05:30`;

describe.skipIf(!url)("launch audit", () => {
  let handle: DbHandle;
  let app: FastifyInstance;
  let n = 0;

  beforeAll(async () => {
    handle = createDb(url!, { max: 3 });
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
    app.inject({ method, url: `/api/v1${p}`, headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) }, ...(payload !== undefined ? { payload: payload as object } : {}) });

  async function register(role: "driver" | "parking_owner", name = `Audit ${role} ${++n}`) {
    const email = `audit${++n}@test.invalid`;
    const res = await req("POST", "/auth/register", undefined, { fullName: name, email, password: PASSWORD, passwordConfirmation: PASSWORD, role });
    expect(res.statusCode, res.body).toBe(201);
    return { id: res.json().data.id as string, cookie: cookieOf(res), email };
  }

  async function staff() {
    const s = await register("driver");
    await handle.db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, s.id));
    return s;
  }

  async function liveListing(ownerCookie: string, capacity = 1) {
    const created = await req("POST", "/parking-spaces", ownerCookie, {
      name: `Audit Listing ${++n}`,
      parkingType: "garage",
      addressLine: "1 Private Lane",
      locality: "Altinho",
      city: "Panaji",
      vehicleTypes: ["car"],
      capacity,
      hourlyPriceMinor: 4000,
      entryInstructions: "Gate 9",
    });
    const id = created.json().data.id as string;
    await req("PUT", `/parking-spaces/${id}/availability`, ownerCookie, {
      timezone: "Asia/Kolkata",
      weekly: DAYS.map((day) => ({ day, opens: "06:00", closes: "23:00" })),
    });
    await req("POST", `/parking-spaces/${id}/actions`, ownerCookie, { action: "submit" });
    const s = await staff();
    expect((await req("POST", `/admin/parking-spaces/${id}/review`, s.cookie, { decision: "approve" })).statusCode).toBe(200);
    return id;
  }

  it("answers a duplicate unique value with 409, not a 500", async () => {
    const a = await register("driver");
    const b = await register("driver");
    expect((await req("PATCH", "/users/me", a.cookie, { phone: "+91 98765 00001" })).statusCode).toBe(200);
    const dup = await req("PATCH", "/users/me", b.cookie, { phone: "+91 98765 00001" });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe("conflict");
    expect(dup.body).not.toContain("users_phone_key");
  });

  it("hides and stops booking listings whose owner is no longer active", async () => {
    const owner = await register("parking_owner");
    const id = await liveListing(owner.cookie);
    const driver = await register("driver");
    expect((await req("GET", `/parking-spaces/${id}`)).statusCode).toBe(200);

    await handle.db.update(users).set({ status: "suspended" }).where(eq(users.id, owner.id));
    expect((await req("GET", `/parking-spaces/${id}`)).statusCode).toBe(404);
    const list = (await req("GET", "/parking-spaces?pageSize=24")).json().data.map((x: { id: string }) => x.id);
    expect(list).not.toContain(id);
    expect((await req("GET", `/parking-spaces/${id}/quote?startsAt=${encodeURIComponent(ist(2, "10:00"))}&endsAt=${encodeURIComponent(ist(2, "11:00"))}`)).statusCode).toBe(404);
    expect((await req("POST", "/bookings", driver.cookie, { spaceId: id, startsAt: ist(2, "10:00"), endsAt: ist(2, "11:00") })).statusCode).toBe(404);

    await handle.db.update(users).set({ status: "active" }).where(eq(users.id, owner.id));
    expect((await req("GET", `/parking-spaces/${id}`)).statusCode).toBe(200);
  });

  it("accepts only one of several simultaneous overlapping requests from the same driver", async () => {
    const owner = await register("parking_owner");
    const id = await liveListing(owner.cookie, 5);
    const driver = await register("driver");
    const results = await Promise.all(
      Array.from({ length: 5 }, () => req("POST", "/bookings", driver.cookie, { spaceId: id, startsAt: ist(3, "10:00"), endsAt: ist(3, "12:00") })),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await handle.db.select().from(bookings).where(eq(bookings.spaceId, id))).toHaveLength(1);
  });

  it("runs the primary journey end to end", async () => {
    // 1. Register and sign in.
    const owner = await register("parking_owner", "Journey Owner");
    const d1 = await register("driver", "Journey Driver One");
    const d2 = await register("driver", "Journey Driver Two");
    const login = await req("POST", "/auth/login", undefined, { email: d1.email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    const d1Cookie = cookieOf(login);

    // 2–3. Owner creates and publishes (via staff review) a one-space listing.
    const id = await liveListing(owner.cookie, 1);

    // 4. Drivers discover it with filters and an availability window.
    const window = `startsAt=${encodeURIComponent(ist(4, "09:00"))}&endsAt=${encodeURIComponent(ist(4, "11:00"))}`;
    const found = (await req("GET", `/parking-spaces?q=altinho&vehicle=car&${window}`)).json().data.map((x: { id: string }) => x.id);
    expect(found).toContain(id);
    const detail = await req("GET", `/parking-spaces/${id}`);
    expect(detail.body).not.toContain("1 Private Lane");
    const quote = (await req("GET", `/parking-spaces/${id}/quote?${window}`)).json().data;
    expect(quote).toMatchObject({ available: true, price: { totalMinor: 8000 } });

    // 5. Both drivers request overlapping slots (requests don't hold the space).
    const r1 = await req("POST", "/bookings", d1Cookie, { spaceId: id, startsAt: ist(4, "09:00"), endsAt: ist(4, "11:00") });
    const r2 = await req("POST", "/bookings", d2.cookie, { spaceId: id, startsAt: ist(4, "10:00"), endsAt: ist(4, "12:00") });
    expect([r1.statusCode, r2.statusCode]).toEqual([201, 201]);
    expect(r1.json().data).toMatchObject({ status: "pending", price: { totalAmountMinor: 8000 }, payment: { status: "not_collected" } });

    // 6. The owner confirms both at once: exactly one wins on the single space.
    const confirms = await Promise.all([r1, r2].map((r) => req("POST", `/bookings/${r.json().data.id}/confirm`, owner.cookie)));
    expect(confirms.map((c) => c.statusCode).sort()).toEqual([200, 409]);
    const winner = confirms.findIndex((c) => c.statusCode === 200);
    const [winnerCookie, loserCookie] = winner === 0 ? [d1Cookie, d2.cookie] : [d2.cookie, d1Cookie];
    const [winnerBooking, loserBooking] = winner === 0 ? [r1, r2] : [r2, r1];

    // The slot is no longer offered.
    expect((await req("GET", `/parking-spaces?${window}`)).json().data.map((x: { id: string }) => x.id)).not.toContain(id);

    // 7. Each party sees the right records, and only theirs.
    const mine = (await req("GET", `/bookings/${winnerBooking.json().data.id}`, winnerCookie)).json().data;
    expect(mine).toMatchObject({ status: "confirmed", privateAccess: { entryInstructions: "Gate 9" } });
    expect((await req("GET", `/bookings/${winnerBooking.json().data.id}`, loserCookie)).statusCode).toBe(404);
    const ownerView = (await req("GET", "/me/space-bookings", owner.cookie)).json().data;
    expect(ownerView).toHaveLength(2);
    expect(JSON.stringify(ownerView)).not.toMatch(/Journey Driver|userId/);

    // 8. Cancellation and errors.
    expect((await req("POST", `/bookings/${loserBooking.json().data.id}/decline`, owner.cookie)).json().data).toMatchObject({ status: "cancelled", cancelledBy: "owner" });
    expect((await req("POST", `/bookings/${winnerBooking.json().data.id}/confirm`, loserCookie)).statusCode).toBe(404);
    expect((await req("POST", `/bookings/${winnerBooking.json().data.id}/cancel`, winnerCookie)).json().data).toMatchObject({ status: "cancelled", cancelledBy: "driver" });
    expect((await req("POST", `/bookings/${winnerBooking.json().data.id}/cancel`, winnerCookie)).statusCode).toBe(409);
    // The space is free again.
    expect((await req("GET", `/parking-spaces/${id}/quote?${window}`)).json().data.available).toBe(true);
  });
});
