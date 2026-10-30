import { eq } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDb, type DbHandle } from "../src/db/client.js";
import { users } from "../src/db/schema.js";
import { localParts } from "../src/domain/booking.js";
import { buildIntegrations } from "../src/integrations/index.js";
import { resetTestDatabase, testDatabaseUrl, testEnv } from "./helpers.js";

// Driver-facing discovery: server-side search, filters, sorting, paging, the
// availability window, quotes, and that only public data ever leaves.

const url = testDatabaseUrl;
const ORIGIN = "http://localhost:5173";
const PASSWORD = "correct horse battery";
const ALL = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** A date (IST) at least two days ahead falling on `weekday`. */
function nextDay(weekday: string): string {
  for (let d = 2; d < 10; d++) {
    const p = localParts(new Date(Date.now() + d * 86_400_000), "Asia/Kolkata");
    if (p.day === weekday) return p.date;
  }
  throw new Error("unreachable");
}
const at = (date: string, hhmm: string) => `${date}T${hhmm}:00+05:30`;

describe.skipIf(!url)("parking discovery", () => {
  let handle: DbHandle;
  let app: FastifyInstance;
  let n = 0;
  const ids: Record<string, string> = {};
  let ownerCookie = "";
  let driverCookie = "";
  const WED = nextDay("wed");

  const cookieOf = (res: LightMyRequestResponse) => `ss_session=${res.cookies.find((c) => c.name === "ss_session")!.value}`;
  const req = (method: "GET" | "POST" | "PUT" | "PATCH", p: string, cookie?: string, payload?: unknown) =>
    app.inject({ method, url: `/api/v1${p}`, headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const search = (qs: string) => req("GET", `/parking-spaces${qs ? `?${qs}` : ""}`);
  const names = (res: LightMyRequestResponse) => (res.json().data as { name: string }[]).map((x) => x.name);

  async function register(role: "driver" | "parking_owner") {
    const res = await req("POST", "/auth/register", undefined, {
      fullName: `Discovery ${role} ${++n}`,
      email: `discovery${n}@test.invalid`,
      password: PASSWORD,
      passwordConfirmation: PASSWORD,
      role,
    });
    return { id: res.json().data.id as string, cookie: cookieOf(res) };
  }

  async function listing(key: string, body: object, weekly: { day: string; opens: string; closes: string }[], publish = true) {
    const res = await req("POST", "/parking-spaces", ownerCookie, {
      addressLine: `${key} Secret Street`,
      entryInstructions: `Code for ${key}`,
      vehicleTypes: ["car"],
      capacity: 1,
      ...body,
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = res.json().data.id as string;
    ids[key] = id;
    await req("PUT", `/parking-spaces/${id}/availability`, ownerCookie, { timezone: "Asia/Kolkata", weekly });
    if (publish) {
      await req("POST", `/parking-spaces/${id}/actions`, ownerCookie, { action: "submit" });
      const ok = await req("POST", `/admin/parking-spaces/${id}/review`, staffCookie, { decision: "approve" });
      expect(ok.statusCode, ok.body).toBe(200);
    }
    return id;
  }
  let staffCookie = "";

  beforeAll(async () => {
    handle = createDb(url!, { max: 3 });
    await resetTestDatabase(handle);
    const env = testEnv({ DATABASE_URL: url!, AUTH_RATE_LIMIT_MAX: "1000", RATE_LIMIT_MAX: "100000", BOOKING_RATE_LIMIT_MAX: "1000" });
    app = await buildApp({ env, db: createDb(url!, { max: 5 }), integrations: buildIntegrations(env), version: "test" });
    ownerCookie = (await register("parking_owner")).cookie;
    driverCookie = (await register("driver")).cookie;
    // Privileges are read live per request, so the registration session works once flagged.
    const staff = await register("driver");
    await handle.db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, staff.id));
    staffCookie = staff.cookie;

    const week = (opens: string, closes: string, days = ALL) => days.map((day) => ({ day, opens, closes }));
    await listing("A", { name: "Altinho Garage", parkingType: "garage", locality: "Altinho", city: "Panaji", hourlyPriceMinor: 3000, maxBookingMinutes: 240 }, week("08:00", "20:00"));
    await listing("B", { name: "Borda Open Lot", parkingType: "open", locality: "Borda", city: "Margao", vehicleTypes: ["motorcycle", "car"], capacity: 2, hourlyPriceMinor: 2000, dailyPriceMinor: 5000 }, week("06:00", "22:00"));
    await listing("C", { name: "Fontainhas Covered Bay", parkingType: "covered", locality: "Fontainhas", city: "Panaji", vehicleTypes: ["suv", "car"], hourlyPriceMinor: 6000 }, week("10:00", "18:00", ["sat", "sun"]));
    await listing("D", { name: "Draft Panaji Spot", locality: "Altinho", city: "Panaji", hourlyPriceMinor: 100 }, week("08:00", "20:00"), false);
    const e = await listing("E", { name: "Unpublished Panaji Spot", locality: "Altinho", city: "Panaji", hourlyPriceMinor: 100 }, week("08:00", "20:00"));
    await req("POST", `/parking-spaces/${e}/actions`, ownerCookie, { action: "unpublish" });
    const f = await listing("F", { name: "Archived Panaji Spot", locality: "Altinho", city: "Panaji", hourlyPriceMinor: 100 }, week("08:00", "20:00"));
    await req("POST", `/parking-spaces/${f}/actions`, ownerCookie, { action: "archive" });
  });

  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  it("lists only published, verified listings, with no private details", async () => {
    const res = await search("");
    expect(res.statusCode).toBe(200);
    expect(names(res).sort()).toEqual(["Altinho Garage", "Borda Open Lot", "Fontainhas Covered Bay"]);
    expect(res.json().page).toEqual({ page: 1, pageSize: 12, total: 3, totalPages: 1 });
    for (const secret of ["Secret Street", "Code for", "ownerId", "bays", "storageKey"]) expect(res.body).not.toContain(secret);
    for (const hidden of ["D", "E", "F"]) expect((await req("GET", `/parking-spaces/${ids[hidden]}`)).statusCode).toBe(404);
  });

  it("searches public text only: title, locality, city, state", async () => {
    expect(names(await search("q=panaji")).sort()).toEqual(["Altinho Garage", "Fontainhas Covered Bay"]);
    expect(names(await search("q=FONTAIN"))).toEqual(["Fontainhas Covered Bay"]);
    expect(names(await search("q=secret%20street"))).toEqual([]);
    expect(names(await search("q=%25"))).toEqual([]);
  });

  it("matches dictated search text: trailing punctuation and extra spaces are ignored", async () => {
    expect(names(await search(`q=${encodeURIComponent("Fontainhas.")}`))).toEqual(["Fontainhas Covered Bay"]);
    expect(names(await search(`q=${encodeURIComponent("  altinho   garage! ")}`))).toEqual(["Altinho Garage"]);
    expect((await search(`q=${encodeURIComponent("x".repeat(101))}`)).statusCode).toBe(400);
    expect((await search(`q=${encodeURIComponent("x".repeat(100) + ".")}`)).statusCode).toBe(200);
  });

  it("filters by type, vehicle and price", async () => {
    expect(names(await search("type=garage"))).toEqual(["Altinho Garage"]);
    expect(names(await search("vehicle=suv"))).toEqual(["Fontainhas Covered Bay"]);
    expect(names(await search("vehicle=motorcycle"))).toEqual(["Borda Open Lot"]);
    expect(names(await search("priceMin=25&priceMax=50"))).toEqual(["Altinho Garage"]);
    expect(names(await search("priceMax=20"))).toEqual(["Borda Open Lot"]);
    expect(names(await search("q=panaji&vehicle=car&priceMax=40"))).toEqual(["Altinho Garage"]);
  });

  it("sorts and paginates on the server", async () => {
    expect(names(await search("sort=price_asc"))).toEqual(["Borda Open Lot", "Altinho Garage", "Fontainhas Covered Bay"]);
    expect(names(await search("sort=price_desc"))).toEqual(["Fontainhas Covered Bay", "Altinho Garage", "Borda Open Lot"]);
    expect(names(await search("sort=name"))).toEqual(["Altinho Garage", "Borda Open Lot", "Fontainhas Covered Bay"]);
    const p1 = await search("sort=price_asc&pageSize=2&page=1");
    expect(names(p1)).toEqual(["Borda Open Lot", "Altinho Garage"]);
    expect(p1.json().page).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(names(await search("sort=price_asc&pageSize=2&page=2"))).toEqual(["Fontainhas Covered Bay"]);
    expect(names(await search("page=9"))).toEqual([]);
  });

  it("rejects invalid query parameters", async () => {
    for (const qs of [
      "pageSize=100",
      "page=0",
      "sort=cheapest",
      "type=castle",
      "vehicle=tank",
      "priceMin=abc",
      "priceMin=50&priceMax=10",
      `startsAt=${encodeURIComponent(at(WED, "10:00"))}`,
      `startsAt=${encodeURIComponent(at(WED, "12:00"))}&endsAt=${encodeURIComponent(at(WED, "10:00"))}`,
      `startsAt=${encodeURIComponent(at(WED, "10:07"))}&endsAt=${encodeURIComponent(at(WED, "12:00"))}`,
      "startsAt=2020-01-01T10:00:00Z&endsAt=2020-01-01T12:00:00Z",
      "ownerId=00000000-0000-4000-8000-000000000000",
    ]) {
      expect((await search(qs)).statusCode, qs).toBe(400);
    }
  });

  it("filters by an availability window: hours, booking rules and a free space", async () => {
    const win = (from: string, to: string) => `startsAt=${encodeURIComponent(at(WED, from))}&endsAt=${encodeURIComponent(at(WED, to))}`;
    // Wednesday: C is weekends only.
    expect(names(await search(`${win("10:00", "12:00")}&sort=name`))).toEqual(["Altinho Garage", "Borda Open Lot"]);
    // Before A opens; B opens at 06:00.
    expect(names(await search(win("06:00", "08:00")))).toEqual(["Borda Open Lot"]);
    // Longer than A's 4-hour maximum.
    expect(names(await search(win("09:00", "15:00")))).toEqual(["Borda Open Lot"]);

    // Once A's only space is confirmed for that window, A drops out.
    const b = await req("POST", "/bookings", driverCookie, { spaceId: ids.A, startsAt: at(WED, "10:00"), endsAt: at(WED, "12:00") });
    expect(b.statusCode, b.body).toBe(201);
    await req("POST", `/bookings/${b.json().data.id}/confirm`, ownerCookie);
    expect(names(await search(`${win("11:00", "13:00")}&sort=name`))).toEqual(["Borda Open Lot"]);
    expect(names(await search(`${win("13:00", "14:00")}&sort=name`))).toEqual(["Altinho Garage", "Borda Open Lot"]);
  });

  it("quotes a window with an itemised server price and current availability", async () => {
    const quote = (key: string, from: string, to: string) =>
      req("GET", `/parking-spaces/${ids[key]}/quote?startsAt=${encodeURIComponent(at(WED, from))}&endsAt=${encodeURIComponent(at(WED, to))}`);
    const ok = (await quote("A", "14:00", "15:30")).json().data;
    expect(ok).toMatchObject({ available: true, freeSpaces: 1, problems: [] });
    expect(ok.price).toMatchObject({ billableHours: 2, hourlyPriceMinor: 3000, totalMinor: 6000, dailyCapApplied: false, currency: "INR" });

    const capped = (await quote("B", "07:00", "21:00")).json().data;
    expect(capped.price).toMatchObject({ billableHours: 14, hourlyTotalMinor: 28000, dailyCapMinor: 5000, dailyCapApplied: true, totalMinor: 5000 });

    const closed = (await quote("C", "10:00", "12:00")).json().data;
    expect(closed).toMatchObject({ available: false, problems: ["That time isn't within the space's opening hours"] });

    // A's single space is confirmed 10:00–12:00 from the previous test.
    const taken = (await quote("A", "10:30", "11:30")).json().data;
    expect(taken).toMatchObject({ available: false, freeSpaces: 0, problems: [] });

    expect((await quote("D", "10:00", "12:00")).statusCode).toBe(404);
    expect((await req("GET", `/parking-spaces/${ids.A}/quote?startsAt=soon`)).statusCode).toBe(400);
  });

  it("never lets a client mark a booking as paid", async () => {
    const res = await req("POST", "/bookings", driverCookie, { spaceId: ids.B, startsAt: at(WED, "15:00"), endsAt: at(WED, "16:00") });
    const booking = res.json().data;
    expect(booking.payment).toEqual({ status: "not_collected" });
    for (const [method, path, body] of [
      ["POST", `/bookings/${booking.id}/pay`, {}],
      ["PATCH", `/bookings/${booking.id}`, { status: "confirmed", payment: { status: "paid" } }],
      ["PUT", `/bookings/${booking.id}`, { status: "confirmed" }],
    ] as const) {
      expect((await req(method, path, driverCookie, body)).statusCode, `${method} ${path}`).toBe(404);
    }
    const again = (await req("GET", `/bookings/${booking.id}`, driverCookie)).json().data;
    expect(again).toMatchObject({ status: "pending", payment: { status: "not_collected" } });
  });
});
