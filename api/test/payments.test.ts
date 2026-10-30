import { eq } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDb, type DbHandle } from "../src/db/client.js";
import { bookings, users } from "../src/db/schema.js";
import { BOOKING_STATUSES, localParts } from "../src/domain/booking.js";
import {
  accessGranted,
  amountDueMinor,
  canTransitionPayment,
  checkoutProblem,
  liveChargesEnabled,
  PAYMENT_STATUSES,
} from "../src/domain/payment.js";
import { buildIntegrations } from "../src/integrations/index.js";
import { EnvValidationError } from "../src/config/env.js";
import { resetTestDatabase, testDatabaseUrl, testEnv } from "./helpers.js";

// Payment readiness: payment state is separate from booking state, no provider
// is integrated, live charges are off, and nothing can mark a booking paid.

const url = testDatabaseUrl;
const ORIGIN = "http://localhost:5173";
const PASSWORD = "correct horse battery";
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const allWeek = { timezone: "Asia/Kolkata", weekly: DAYS.map((day) => ({ day, opens: "06:00", closes: "23:00" })) };

function ist(daysAhead: number, hhmm: string): string {
  const { date } = localParts(new Date(Date.now() + daysAhead * 86_400_000), "Asia/Kolkata");
  return `${date}T${hhmm}:00+05:30`;
}

describe("payment domain rules", () => {
  it("allows only provider-driven payment transitions", () => {
    expect(canTransitionPayment("not_collected", "pending")).toBe(true);
    expect(canTransitionPayment("pending", "paid")).toBe(true);
    expect(canTransitionPayment("pending", "failed")).toBe(true);
    expect(canTransitionPayment("failed", "pending")).toBe(true);
    expect(canTransitionPayment("paid", "refunded")).toBe(true);
    // No skipping straight to paid, no un-refunding, no refunding an unpaid booking.
    expect(canTransitionPayment("not_collected", "paid")).toBe(false);
    expect(canTransitionPayment("failed", "paid")).toBe(false);
    expect(canTransitionPayment("refunded", "paid")).toBe(false);
    expect(canTransitionPayment("not_collected", "refunded")).toBe(false);
    expect(canTransitionPayment("pending", "refunded")).toBe(false);
  });

  it("takes the amount from the booking's snapshot only", () => {
    expect(amountDueMinor({ totalPriceMinor: 8000, currency: "INR" })).toEqual({ amountMinor: 8000, currency: "INR" });
    expect(() => amountDueMinor({ totalPriceMinor: -1, currency: "INR" })).toThrow(RangeError);
    expect(() => amountDueMinor({ totalPriceMinor: 10.5, currency: "INR" })).toThrow(RangeError);
  });

  it("keeps live charges off and refuses every checkout without a provider", () => {
    expect(liveChargesEnabled("none")).toBe(false);
    for (const b of BOOKING_STATUSES) {
      for (const p of PAYMENT_STATUSES) expect(checkoutProblem("none", b, p)?.code).toBe("payments_disabled");
    }
  });

  it("treats confirmed and paid as different things", () => {
    // Requests and ended bookings never unlock access, paid or not.
    for (const b of ["pending", "cancelled", "expired", "completed"] as const) {
      for (const p of PAYMENT_STATUSES) {
        expect(accessGranted(b, p, false)).toBe(false);
        expect(accessGranted(b, p, true)).toBe(false);
      }
    }
    // Pilot (payment not required): confirmation alone unlocks access.
    expect(accessGranted("confirmed", "not_collected", false)).toBe(true);
    // When payment is required, only a verified paid status does.
    for (const p of ["not_collected", "pending", "failed", "refunded"] as const) expect(accessGranted("confirmed", p, true)).toBe(false);
    expect(accessGranted("confirmed", "paid", true)).toBe(true);
  });

  it("refuses to boot with a payment provider that isn't integrated", () => {
    expect(testEnv().PAYMENTS_PROVIDER).toBe("none");
    expect(testEnv({ PAYMENTS_PROVIDER: "" }).PAYMENTS_PROVIDER).toBe("none");
    for (const name of ["dodo", "cake_wallet", "stripe"]) {
      expect(() => testEnv({ PAYMENTS_PROVIDER: name })).toThrow(EnvValidationError);
    }
  });
});

describe.skipIf(!url)("payment state over HTTP", () => {
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
      fullName: `Payment ${role} ${++n}`,
      email: `payment${n}@test.invalid`,
      password: PASSWORD,
      passwordConfirmation: PASSWORD,
      role,
    });
    expect(res.statusCode).toBe(201);
    return { id: res.json().data.id as string, cookie: cookieOf(res) };
  }

  /** A confirmed booking on a fresh verified listing, plus everyone involved. */
  async function confirmedBooking() {
    const owner = await register("parking_owner");
    const created = await req("POST", "/parking-spaces", owner.cookie, {
      name: `Payable ${n}`,
      parkingType: "garage",
      addressLine: "9 Private Road",
      locality: "Altinho",
      city: "Panaji",
      vehicleTypes: ["car"],
      capacity: 1,
      hourlyPriceMinor: 4000,
      entryInstructions: "Gate code 9876",
      maxBookingMinutes: 720,
    });
    expect(created.statusCode, created.body).toBe(201);
    const spaceId = created.json().data.id as string;
    await req("PUT", `/parking-spaces/${spaceId}/availability`, owner.cookie, allWeek);
    await req("POST", `/parking-spaces/${spaceId}/actions`, owner.cookie, { action: "submit" });
    const staff = await register("driver");
    await handle.db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, staff.id));
    expect((await req("POST", `/admin/parking-spaces/${spaceId}/review`, staff.cookie, { decision: "approve" })).statusCode).toBe(200);
    const driver = await register("driver");
    const made = await req("POST", "/bookings", driver.cookie, { spaceId, startsAt: ist(2, "10:00"), endsAt: ist(2, "12:00") });
    expect(made.statusCode, made.body).toBe(201);
    const id = made.json().data.id as string;
    expect((await req("POST", `/bookings/${id}/confirm`, owner.cookie)).statusCode).toBe(200);
    return { owner, driver, id };
  }

  const paymentRow = async (id: string) =>
    (await handle.db.select({ s: bookings.paymentStatus, p: bookings.paymentProvider, r: bookings.paymentProviderRef }).from(bookings).where(eq(bookings.id, id)))[0]!;

  it("confirms a booking without marking it paid", async () => {
    const { driver, id } = await confirmedBooking();
    const res = await req("GET", `/bookings/${id}`, driver.cookie);
    expect(res.json().data).toMatchObject({ status: "confirmed", payment: { status: "not_collected" } });
    // Provider fields are never exposed.
    expect(res.body).not.toContain("paymentProvider");
    expect(await paymentRow(id)).toEqual({ s: "not_collected", p: null, r: null });
  });

  it("answers every checkout with payments_disabled and writes nothing, however often it's tried", async () => {
    const { driver, id } = await confirmedBooking();
    const before = await handle.db.select().from(bookings).where(eq(bookings.id, id));
    const tries = await Promise.all(Array.from({ length: 5 }, () => req("POST", `/bookings/${id}/checkout`, driver.cookie)));
    for (const res of tries) {
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("payments_disabled");
      expect(res.body).not.toMatch(/success|paid"/i);
    }
    // Client-supplied amounts or statuses change nothing either.
    expect((await req("POST", `/bookings/${id}/checkout`, driver.cookie, { amountMinor: 1, status: "paid" })).statusCode).toBe(503);
    expect(await handle.db.select().from(bookings).where(eq(bookings.id, id))).toEqual(before);
  });

  it("lets only the booker reach checkout", async () => {
    const { owner, id } = await confirmedBooking();
    const stranger = await register("driver");
    expect((await req("POST", `/bookings/${id}/checkout`, owner.cookie)).statusCode).toBe(403);
    expect((await req("POST", `/bookings/${id}/checkout`, stranger.cookie)).statusCode).toBe(404);
    expect((await req("POST", `/bookings/${id}/checkout`)).statusCode).toBe(401);
  });

  it("gives no client or webhook-shaped route a way to set payment state", async () => {
    const { owner, driver, id } = await confirmedBooking();
    for (const cookie of [driver.cookie, owner.cookie]) {
      await req("PATCH", `/bookings/${id}`, cookie, { payment: { status: "paid" }, paymentStatus: "paid" });
      await req("POST", `/bookings/${id}/pay`, cookie, { status: "paid" });
      await req("POST", `/bookings/${id}/refund`, cookie);
    }
    // No webhook receiver exists until a provider is integrated and verified.
    for (const p of ["/payments/webhook", "/webhooks/dodo", "/webhooks/payments"]) {
      const res = await req("POST", p, undefined, { type: "payment.succeeded", data: { booking_id: id } });
      expect(res.statusCode, p).toBe(404);
    }
    expect((await paymentRow(id)).s).toBe("not_collected");
  });

  it("keeps payment state untouched when a booking is cancelled", async () => {
    const { driver, id } = await confirmedBooking();
    const res = await req("POST", `/bookings/${id}/cancel`, driver.cookie);
    expect(res.json().data).toMatchObject({ status: "cancelled", payment: { status: "not_collected" }, privateAccess: null });
    expect((await req("POST", `/bookings/${id}/checkout`, driver.cookie)).statusCode).toBe(503);
  });

  it("refuses at the database level any non-collected status without a provider reference", async () => {
    const { id } = await confirmedBooking();
    for (const s of ["pending", "paid", "failed", "refunded"] as const) {
      await expect(handle.db.update(bookings).set({ paymentStatus: s }).where(eq(bookings.id, id))).rejects.toThrow();
    }
    expect((await paymentRow(id)).s).toBe("not_collected");
  });

  it("can't record one provider reference against two bookings", async () => {
    const a = await confirmedBooking();
    const b = await confirmedBooking();
    const ref = { paymentStatus: "paid" as const, paymentProvider: "test", paymentProviderRef: "ref_1" };
    await handle.db.update(bookings).set(ref).where(eq(bookings.id, a.id));
    await expect(handle.db.update(bookings).set(ref).where(eq(bookings.id, b.id))).rejects.toThrow();
  });

  it("reports live charges as off in readiness", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/ready" });
    expect(res.json().payments).toEqual({ provider: "none", liveCharges: false });
  });
});
