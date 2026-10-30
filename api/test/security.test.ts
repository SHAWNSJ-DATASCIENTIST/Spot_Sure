import { and, eq } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDb, type DbHandle } from "../src/db/client.js";
import { bookings, parkingBays, users } from "../src/db/schema.js";
import { localParts } from "../src/domain/booking.js";
import { buildIntegrations } from "../src/integrations/index.js";
import { resetTestDatabase, testDatabaseUrl, testEnv } from "./helpers.js";

// Security hardening regressions: endpoints added since the original auth
// sweep, booking confirmation integrity, mass assignment and safe errors.

const url = testDatabaseUrl;
const ORIGIN = "http://localhost:5173";
const PASSWORD = "correct horse battery";
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const allWeek = { timezone: "Asia/Kolkata", weekly: DAYS.map((day) => ({ day, opens: "06:00", closes: "23:00" })) };
const ZERO = "00000000-0000-4000-8000-000000000000";

function ist(daysAhead: number, hhmm: string): string {
  const { date } = localParts(new Date(Date.now() + daysAhead * 86_400_000), "Asia/Kolkata");
  return `${date}T${hhmm}:00+05:30`;
}

describe.skipIf(!url)("security hardening", () => {
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
  const req = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", p: string, cookie?: string, payload?: unknown) =>
    app.inject({
      method,
      url: `/api/v1${p}`,
      headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });

  async function register(role: "driver" | "parking_owner") {
    const res = await req("POST", "/auth/register", undefined, {
      fullName: `Secure ${role} ${++n}`,
      email: `secure${n}@test.invalid`,
      password: PASSWORD,
      passwordConfirmation: PASSWORD,
      role,
    });
    expect(res.statusCode).toBe(201);
    return { id: res.json().data.id as string, cookie: cookieOf(res) };
  }

  async function liveListing(capacity = 1) {
    const owner = await register("parking_owner");
    const created = await req("POST", "/parking-spaces", owner.cookie, {
      name: `Secure garage ${n}`,
      parkingType: "garage",
      addressLine: "3 Hidden Street",
      locality: "Altinho",
      city: "Panaji",
      vehicleTypes: ["car"],
      capacity,
      hourlyPriceMinor: 4000,
      entryInstructions: "Gate code 4321",
      maxBookingMinutes: 720,
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().data.id as string;
    await req("PUT", `/parking-spaces/${id}/availability`, owner.cookie, allWeek);
    await req("POST", `/parking-spaces/${id}/actions`, owner.cookie, { action: "submit" });
    const staff = await register("driver");
    await handle.db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, staff.id));
    expect((await req("POST", `/admin/parking-spaces/${id}/review`, staff.cookie, { decision: "approve" })).statusCode).toBe(200);
    return { owner, id, staff };
  }

  const request = async (cookie: string, spaceId: string, from = ist(2, "10:00"), to = ist(2, "12:00")) => {
    const res = await req("POST", "/bookings", cookie, { spaceId, startsAt: from, endsAt: to });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data as { id: string; bayLabel: string };
  };

  it("answers 401 on every endpoint added since the original sweep", async () => {
    const cases: [Parameters<typeof req>[0], string, unknown?][] = [
      ["GET", "/me/space-bookings"],
      ["GET", "/me/societies"],
      ["GET", `/me/parking-spaces/${ZERO}`],
      ["GET", `/parking-spaces/${ZERO}/preview`],
      ["POST", "/bookings", { spaceId: ZERO, startsAt: ist(2, "10:00"), endsAt: ist(2, "12:00") }],
      ["POST", `/bookings/${ZERO}/confirm`],
      ["POST", `/bookings/${ZERO}/decline`],
      ["POST", `/bookings/${ZERO}/cancel`],
      ["POST", `/bookings/${ZERO}/checkout`],
      ["POST", `/parking-spaces/${ZERO}/actions`, { action: "submit" }],
      ["PUT", `/parking-spaces/${ZERO}/availability`, allWeek],
      ["DELETE", `/parking-spaces/${ZERO}/photos/${ZERO}`],
      ["PUT", `/parking-spaces/${ZERO}/photos/${ZERO}/cover`],
      ["GET", "/admin/parking-spaces"],
      ["POST", `/admin/parking-spaces/${ZERO}/review`, { decision: "approve" }],
      ["PUT", `/admin/societies/${ZERO}/admins/${ZERO}`],
      ["DELETE", `/admin/societies/${ZERO}/admins/${ZERO}`],
      ["GET", "/me/notifications"],
      ["GET", "/me/notifications/unread-count"],
      ["POST", `/me/notifications/${ZERO}/read`],
      ["POST", "/me/notifications/read-all"],
    ];
    for (const [method, path, body] of cases) {
      const res = await req(method, path, undefined, body);
      expect(res.statusCode, `${method} ${path}`).toBe(401);
      expect(res.json().error.code).toBe("unauthenticated");
    }
  });

  it("keeps admin endpoints to platform staff, whatever role the caller has", async () => {
    const { id } = await liveListing();
    for (const role of ["driver", "parking_owner"] as const) {
      const u = await register(role);
      expect((await req("GET", "/admin/parking-spaces", u.cookie)).statusCode).toBe(403);
      expect((await req("POST", `/admin/parking-spaces/${id}/review`, u.cookie, { decision: "reject", notes: "x" })).statusCode).toBe(403);
      expect((await req("POST", "/admin/societies", u.cookie, { name: "Self-made" })).statusCode).toBe(403);
      expect((await req("PUT", `/admin/societies/${ZERO}/admins/${u.id}`, u.cookie)).statusCode).toBe(403);
    }
  });

  it("won't let another driver or owner act on a booking by changing its id", async () => {
    const { owner, id } = await liveListing();
    const driver = await register("driver");
    const b = await request(driver.cookie, id);
    const otherDriver = await register("driver");
    const otherOwner = await register("parking_owner");
    for (const action of ["confirm", "decline", "cancel", "checkout"]) {
      expect((await req("POST", `/bookings/${b.id}/${action}`, otherDriver.cookie)).statusCode, action).toBe(404);
      expect((await req("POST", `/bookings/${b.id}/${action}`, otherOwner.cookie)).statusCode, action).toBe(404);
    }
    // The booker can't answer their own request.
    expect((await req("POST", `/bookings/${b.id}/confirm`, driver.cookie)).statusCode).toBe(403);
    const [row] = await handle.db.select({ s: bookings.status }).from(bookings).where(eq(bookings.id, b.id));
    expect(row!.s).toBe("pending");
    expect((await req("POST", `/bookings/${b.id}/confirm`, owner.cookie)).statusCode).toBe(200);
  });

  it("refuses to confirm a request once the listing can't take bookings, but still allows declining", async () => {
    const { owner, id } = await liveListing();
    const driver = await register("driver");
    const a = await request(driver.cookie, id, ist(3, "10:00"), ist(3, "11:00"));
    const b = await request(driver.cookie, id, ist(4, "10:00"), ist(4, "11:00"));
    expect((await req("POST", `/parking-spaces/${id}/actions`, owner.cookie, { action: "unpublish" })).statusCode).toBe(200);
    const res = await req("POST", `/bookings/${a.id}/confirm`, owner.cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("not_bookable");
    expect((await req("POST", `/bookings/${b.id}/decline`, owner.cookie)).statusCode).toBe(200);

    // Moving the space sends it back to review: still no confirmations.
    expect((await req("POST", `/parking-spaces/${id}/actions`, owner.cookie, { action: "publish" })).statusCode).toBe(200);
    expect((await req("PATCH", `/parking-spaces/${id}`, owner.cookie, { addressLine: "99 Elsewhere Road" })).json().data.status).toBe("pending_verification");
    expect((await req("POST", `/bookings/${a.id}/confirm`, owner.cookie)).json().error.code).toBe("not_bookable");
    const [row] = await handle.db.select({ s: bookings.status }).from(bookings).where(eq(bookings.id, a.id));
    expect(row!.s).toBe("pending");
  });

  it("never confirms onto a bay that is no longer active", async () => {
    const two = await liveListing(2);
    const driver = await register("driver");
    const b = await request(driver.cookie, two.id);
    expect(b.bayLabel).toBe("B1");
    await handle.db.update(parkingBays).set({ status: "maintenance" }).where(and(eq(parkingBays.spaceId, two.id), eq(parkingBays.label, "B1")));
    const ok = await req("POST", `/bookings/${b.id}/confirm`, two.owner.cookie);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.bayLabel).toBe("B2");

    const one = await liveListing(1);
    const c = await request(driver.cookie, one.id);
    await handle.db.update(parkingBays).set({ status: "maintenance" }).where(eq(parkingBays.spaceId, one.id));
    expect((await req("POST", `/bookings/${c.id}/confirm`, one.owner.cookie)).statusCode).toBe(409);
    const [row] = await handle.db.select({ s: bookings.status }).from(bookings).where(eq(bookings.id, c.id));
    expect(row!.s).toBe("pending");
  });

  it("can't leave a confirmed booking on a bay retired by a simultaneous capacity cut", async () => {
    for (let round = 0; round < 8; round++) {
      const { owner, id } = await liveListing(2);
      const d1 = await register("driver");
      const d2 = await register("driver");
      const first = await request(d1.cookie, id);
      const second = await request(d2.cookie, id);
      expect((await req("POST", `/bookings/${first.id}/confirm`, owner.cookie)).statusCode).toBe(200);
      // Confirming the second request needs bay B2; cutting capacity to 1 retires B2.
      const [confirm, cut] = await Promise.all([
        req("POST", `/bookings/${second.id}/confirm`, owner.cookie),
        req("PATCH", `/parking-spaces/${id}`, owner.cookie, { capacity: 1 }),
      ]);
      expect([confirm.statusCode, cut.statusCode].sort()).toEqual([200, 409]);
      const held = await handle.db
        .select({ status: parkingBays.status })
        .from(bookings)
        .innerJoin(parkingBays, eq(parkingBays.id, bookings.bayId))
        .where(and(eq(bookings.spaceId, id), eq(bookings.status, "confirmed")));
      expect(held.every((h) => h.status === "active")).toBe(true);
    }
  });

  it("ignores privileged listing fields sent by an owner", async () => {
    const owner = await register("parking_owner");
    const other = await register("parking_owner");
    const draft = (await req("POST", "/parking-spaces", owner.cookie, { name: "Mine", hourlyPriceMinor: 100 })).json().data.id;
    for (const body of [{ status: "published" }, { verifiedAt: new Date().toISOString() }, { ownerId: other.id }, { currency: "USD" }]) {
      expect((await req("PATCH", `/parking-spaces/${draft}`, owner.cookie, body)).statusCode, JSON.stringify(body)).toBe(400);
      expect((await req("POST", "/parking-spaces", owner.cookie, { name: "Sneaky", hourlyPriceMinor: 100, ...body })).statusCode).toBe(400);
    }
    // And another owner can't touch it at all.
    expect((await req("PATCH", `/parking-spaces/${draft}`, other.cookie, { name: "Taken" })).statusCode).toBe(403);
  });

  it("exposes no occupancy or payment ingestion an outsider could forge", async () => {
    for (const p of ["/occupancy-events", `/parking-spaces/${ZERO}/occupancy`, "/devices/events", "/payments/webhook", "/webhooks/dodo"]) {
      expect((await req("POST", p, undefined, { observation: "available", status: "paid" })).statusCode, p).toBe(404);
    }
  });

  it("runs discovery and the booking flow without calling any optional integration", async () => {
    // Every integration method records the call and fails, as a down or
    // misconfigured TigerGraph/Firebase/YOLO/Web3 service would.
    const env = testEnv({ DATABASE_URL: url!, AUTH_RATE_LIMIT_MAX: "1000", RATE_LIMIT_MAX: "100000", BOOKING_RATE_LIMIT_MAX: "1000", TIGERGRAPH_HOST: "https://graph.invalid", TIGERGRAPH_GRAPH: "spotsure", TIGERGRAPH_SECRET: "test-only" });
    const real = buildIntegrations(env);
    const calls: string[] = [];
    const trapped = Object.fromEntries(
      (["firebase", "yolo", "tigergraph", "web3"] as const).map((svc) => [
        svc,
        new Proxy(real[svc] as unknown as Record<string | symbol, unknown>, {
          get: (target, key) =>
            typeof target[key] === "function"
              ? () => {
                  calls.push(`${svc}.${String(key)}`);
                  throw new Error("integration unavailable");
                }
              : target[key],
        }),
      ]),
    );
    const isolated = await buildApp({ env, db: createDb(url!, { max: 5 }), integrations: { ...real, ...trapped } as typeof real, version: "test" });
    try {
      const { owner, id } = await liveListing();
      const driver = await register("driver");
      const hit = (method: "GET" | "POST", p: string, cookie?: string, payload?: unknown) =>
        isolated.inject({ method, url: `/api/v1${p}`, headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) }, ...(payload ? { payload: payload as object } : {}) });
      expect((await hit("GET", "/parking-spaces?q=Altinho")).statusCode).toBe(200);
      expect((await hit("GET", `/parking-spaces/${id}`)).statusCode).toBe(200);
      const made = await hit("POST", "/bookings", driver.cookie, { spaceId: id, startsAt: ist(6, "10:00"), endsAt: ist(6, "11:00") });
      expect(made.statusCode, made.body).toBe(201);
      expect((await hit("POST", `/bookings/${made.json().data.id}/confirm`, owner.cookie)).statusCode).toBe(200);
      const ready = await hit("GET", "/ready");
      // Configured is reported as configured, never as connected.
      expect(ready.json().integrations.tigergraph).toBe("configured_not_implemented");
      expect(calls).toEqual([]);
    } finally {
      await isolated.close();
    }
  });

  it("returns safe errors: no stack traces, SQL or internals", async () => {
    const driver = await register("driver");
    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/bookings",
      headers: { origin: ORIGIN, cookie: driver.cookie, "content-type": "application/json" },
      payload: "{not json",
    });
    expect(bad.statusCode).toBe(400);
    const big = await app.inject({
      method: "POST",
      url: "/api/v1/bookings",
      headers: { origin: ORIGIN, cookie: driver.cookie, "content-type": "application/json" },
      payload: JSON.stringify({ pad: "x".repeat(1_100_000) }),
    });
    expect(big.statusCode).toBe(413);
    const badId = await req("GET", "/bookings/not-a-uuid", driver.cookie);
    expect(badId.statusCode).toBe(400);
    for (const res of [bad, big, badId]) {
      expect(res.body).not.toMatch(/at \w+ \(|node_modules|select |insert |postgres|stack/i);
      expect(res.json().error.requestId).toBeTruthy();
    }
  });
});
