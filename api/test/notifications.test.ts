import { and, eq } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDb, type DbHandle } from "../src/db/client.js";
import { bookings, notifications, users } from "../src/db/schema.js";
import { localParts } from "../src/domain/booking.js";
import { bookingMessage, decodeCursor, encodeCursor, whenText } from "../src/domain/notification.js";
import { buildIntegrations } from "../src/integrations/index.js";
import { settlePastBookings } from "../src/repositories/bookings.js";
import { ensureReminders, notify } from "../src/repositories/notifications.js";
import { resetTestDatabase, testDatabaseUrl, testEnv } from "./helpers.js";

// In-app notifications: written with the business event that causes them,
// visible only to their recipient, deduplicated, paginated.

const url = testDatabaseUrl;
const ORIGIN = "http://localhost:5173";
const PASSWORD = "correct horse battery";
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const allWeek = { timezone: "Asia/Kolkata", weekly: DAYS.map((day) => ({ day, opens: "06:00", closes: "23:00" })) };

function ist(daysAhead: number, hhmm: string): string {
  const { date } = localParts(new Date(Date.now() + daysAhead * 86_400_000), "Asia/Kolkata");
  return `${date}T${hhmm}:00+05:30`;
}

describe("notification wording", () => {
  it("states the time in the listing's own time zone", () => {
    const s = new Date("2026-12-01T04:30:00Z");
    expect(whenText(s, new Date("2026-12-01T06:30:00Z"), "Asia/Kolkata")).toBe("Tue 1 Dec, 10:00–12:00 IST");
  });
  it("carries only the listing title and time", () => {
    const m = bookingMessage("booking_cancelled", { spaceName: "Garage", startsAt: new Date("2026-12-01T04:30:00Z"), endsAt: new Date("2026-12-01T06:30:00Z"), timezone: "Asia/Kolkata" }, "driver");
    expect(m).toBe("The driver cancelled the booking at Garage (Tue 1 Dec, 10:00–12:00 IST).");
  });
  it("round-trips cursors and rejects tampered ones", () => {
    const at = new Date("2026-12-01T04:30:00.123Z");
    const id = "00000000-0000-4000-8000-000000000001";
    expect(decodeCursor(encodeCursor(at, id))).toEqual({ createdAt: at, id });
    expect(decodeCursor("garbage")).toBeNull();
    expect(decodeCursor(Buffer.from("not-a-date|x").toString("base64url"))).toBeNull();
  });
});

describe.skipIf(!url)("notifications over HTTP", () => {
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
      fullName: `Notified ${role} ${++n}`,
      email: `notified${n}@test.invalid`,
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

  async function submittedListing(capacity = 1) {
    const owner = await register("parking_owner");
    const created = await req("POST", "/parking-spaces", owner.cookie, {
      name: `Notify garage ${n}`,
      parkingType: "garage",
      addressLine: "11 Secret Lane",
      locality: "Altinho",
      city: "Panaji",
      vehicleTypes: ["car"],
      capacity,
      hourlyPriceMinor: 4000,
      entryInstructions: "Gate code 5555",
      maxBookingMinutes: 720,
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().data.id as string;
    await req("PUT", `/parking-spaces/${id}/availability`, owner.cookie, allWeek);
    await req("POST", `/parking-spaces/${id}/actions`, owner.cookie, { action: "submit" });
    return { owner, id };
  }

  async function liveListing(capacity = 1) {
    const l = await submittedListing(capacity);
    expect((await req("POST", `/admin/parking-spaces/${l.id}/review`, (await staff()).cookie, { decision: "approve" })).statusCode).toBe(200);
    return l;
  }

  const list = async (cookie: string, q = "") => {
    const res = await req("GET", `/me/notifications${q}`, cookie);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { data: { id: string; type: string; message: string; link: { kind: string; id: string } | null; read: boolean }[]; nextCursor: string | null; unreadCount: number };
  };
  const types = async (cookie: string) => (await list(cookie)).data.map((x) => x.type);
  const request = (cookie: string, spaceId: string, from = ist(2, "10:00"), to = ist(2, "12:00")) =>
    req("POST", "/bookings", cookie, { spaceId, startsAt: from, endsAt: to });

  it("tells the driver and the owner about a new request, without private details", async () => {
    const { owner, id } = await liveListing();
    const driver = await register("driver");
    const made = await request(driver.cookie, id);
    expect(made.statusCode).toBe(201);
    const bookingId = made.json().data.id;

    const d = await list(driver.cookie);
    expect(d.data).toHaveLength(1);
    expect(d.data[0]).toMatchObject({ type: "booking_requested", read: false, link: { kind: "booking", id: bookingId } });
    expect(d.unreadCount).toBe(1);

    const o = await list(owner.cookie);
    expect(o.data.map((x) => x.type)).toEqual(["booking_request_received", "listing_approved"]);
    expect(o.data[0]!.link).toEqual({ kind: "booking", id: bookingId });
    for (const body of [JSON.stringify(d), JSON.stringify(o)]) {
      expect(body).not.toContain("11 Secret Lane");
      expect(body).not.toContain("Gate code");
      expect(body).not.toContain("Notified driver");
      expect(body).not.toContain("@test.invalid");
    }
  });

  it("writes nothing for requests that fail", async () => {
    const { owner, id } = await liveListing();
    const driver = await register("driver");
    expect((await request(driver.cookie, id)).statusCode).toBe(201);
    // Duplicate, invalid time and non-driver attempts all fail.
    expect((await request(driver.cookie, id)).statusCode).toBe(409);
    expect((await request(driver.cookie, id, ist(2, "04:00"), ist(2, "06:00"))).statusCode).toBe(400);
    expect((await request(owner.cookie, id)).statusCode).toBe(403);
    expect(await types(driver.cookie)).toEqual(["booking_requested"]);
    expect(await types(owner.cookie)).toEqual(["booking_request_received", "listing_approved"]);
  });

  it("notifies on confirm once, even when the confirm is retried", async () => {
    const { owner, id } = await liveListing();
    const driver = await register("driver");
    const bookingId = (await request(driver.cookie, id)).json().data.id;
    expect((await req("POST", `/bookings/${bookingId}/confirm`, owner.cookie)).statusCode).toBe(200);
    expect((await req("POST", `/bookings/${bookingId}/confirm`, owner.cookie)).statusCode).toBe(409);
    expect(await types(driver.cookie)).toEqual(["booking_confirmed", "booking_requested"]);
    // The owner isn't told about their own action.
    expect(await types(owner.cookie)).toEqual(["booking_request_received", "listing_approved"]);
  });

  it("tells the driver about a decline and the other party about a cancellation", async () => {
    const { owner, id } = await liveListing(2);
    const driver = await register("driver");
    const a = (await request(driver.cookie, id, ist(3, "10:00"), ist(3, "11:00"))).json().data.id;
    const b = (await request(driver.cookie, id, ist(4, "10:00"), ist(4, "11:00"))).json().data.id;
    expect((await req("POST", `/bookings/${a}/decline`, owner.cookie)).statusCode).toBe(200);
    expect((await req("POST", `/bookings/${b}/confirm`, owner.cookie)).statusCode).toBe(200);
    expect((await req("POST", `/bookings/${b}/cancel`, driver.cookie)).statusCode).toBe(200);
    // A second cancel fails and notifies nobody.
    expect((await req("POST", `/bookings/${b}/cancel`, driver.cookie)).statusCode).toBe(409);

    const d = (await list(driver.cookie)).data;
    expect(d.find((x) => x.link?.id === a && x.type === "booking_declined")).toBeTruthy();
    expect(d.filter((x) => x.type === "booking_cancelled")).toHaveLength(0);
    const o = (await list(owner.cookie)).data.filter((x) => x.type === "booking_cancelled");
    expect(o).toHaveLength(1);
    expect(o[0]!.message).toMatch(/^The driver cancelled the booking at /);
  });

  it("keeps each user's notifications to themselves", async () => {
    const { owner, id } = await liveListing();
    const driver = await register("driver");
    await request(driver.cookie, id);
    const mine = (await list(driver.cookie)).data[0]!;
    const other = await register("driver");

    expect((await list(other.cookie)).data).toEqual([]);
    expect((await req("POST", `/me/notifications/${mine.id}/read`, other.cookie)).statusCode).toBe(404);
    expect((await req("POST", `/me/notifications/${mine.id}/read`, owner.cookie)).statusCode).toBe(404);
    expect((await req("POST", "/me/notifications/00000000-0000-4000-8000-000000000000/read", other.cookie)).statusCode).toBe(404);
    expect((await req("POST", "/me/notifications/read-all", other.cookie)).json().data.marked).toBe(0);
    expect((await list(driver.cookie)).data[0]!.read).toBe(false);
    // No route takes a recipient from the client.
    expect((await req("GET", `/me/notifications?userId=${driver.id}`, other.cookie)).statusCode).toBe(400);
    // The booking link still goes through the booking's own access check.
    expect((await req("GET", `/bookings/${mine.link!.id}`, other.cookie)).statusCode).toBe(404);
    expect((await req("GET", "/me/notifications")).statusCode).toBe(401);
    expect((await req("POST", `/me/notifications/${mine.id}/read`)).statusCode).toBe(401);
  });

  it("marks notifications read one at a time or all at once", async () => {
    const { owner, id } = await liveListing(3);
    const driver = await register("driver");
    for (const day of [2, 3, 4]) await request(driver.cookie, id, ist(day, "10:00"), ist(day, "11:00"));
    const before = await list(owner.cookie);
    expect(before.unreadCount).toBe(4);
    const first = before.data[0]!;
    const res = await req("POST", `/me/notifications/${first.id}/read`, owner.cookie);
    expect(res.json()).toMatchObject({ data: { id: first.id, read: true }, unreadCount: 3 });
    // Marking again is harmless.
    expect((await req("POST", `/me/notifications/${first.id}/read`, owner.cookie)).json().unreadCount).toBe(3);
    expect((await req("GET", "/me/notifications/unread-count", owner.cookie)).json().data.unreadCount).toBe(3);
    expect((await list(owner.cookie, "?unread=true")).data).toHaveLength(3);
    expect((await req("POST", "/me/notifications/read-all", owner.cookie)).json().data.marked).toBe(3);
    const after = await list(owner.cookie);
    expect(after.unreadCount).toBe(0);
    expect(after.data.every((x) => x.read)).toBe(true);
  });

  it("pages newest first without gaps or repeats, within limits", async () => {
    const user = await register("driver");
    for (let i = 0; i < 25; i++) {
      await notify(handle.db, [{ recipientId: user.id, type: "booking_reminder", message: `Message ${i}`, dedupeKey: `test:${i}` }]);
    }
    const seen: { message: string; createdAt: string }[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await list(user.cookie, `?limit=10${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...(page.data as unknown as { message: string; createdAt: string }[]));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    // Every row exactly once, newest first (rows from the same millisecond tie-break on id).
    expect(new Set(seen.map((x) => x.message)).size).toBe(25);
    expect(seen.map((x) => x.message).sort()).toEqual(Array.from({ length: 25 }, (_, i) => `Message ${i}`).sort());
    expect(seen.every((x, i) => i === 0 || x.createdAt <= seen[i - 1]!.createdAt)).toBe(true);
    expect((await req("GET", "/me/notifications?limit=51", user.cookie)).statusCode).toBe(400);
    expect((await req("GET", "/me/notifications?limit=0", user.cookie)).statusCode).toBe(400);
    expect((await req("GET", "/me/notifications?cursor=nonsense", user.cookie)).statusCode).toBe(400);
    expect((await list(user.cookie)).data).toHaveLength(20);
  });

  it("drops repeated events", async () => {
    const user = await register("driver");
    const row = { recipientId: user.id, type: "booking_confirmed" as const, message: "Once", dedupeKey: "booking:x:booking_confirmed" };
    await notify(handle.db, [row]);
    await notify(handle.db, [row]);
    await Promise.all([notify(handle.db, [row]), notify(handle.db, [row])]);
    expect((await list(user.cookie)).data).toHaveLength(1);
  });

  it("reminds the driver once before a confirmed booking, never for a cancelled one", async () => {
    const { owner, id } = await liveListing(2);
    const driver = await register("driver");
    const kept = (await request(driver.cookie, id, ist(5, "10:00"), ist(5, "11:00"))).json().data;
    const dropped = (await request(driver.cookie, id, ist(5, "10:00"), ist(5, "11:00"))).json();
    expect(dropped.error?.code).toBe("duplicate_request");
    const other = (await request(driver.cookie, id, ist(5, "14:00"), ist(5, "15:00"))).json().data;
    await req("POST", `/bookings/${kept.id}/confirm`, owner.cookie);
    await req("POST", `/bookings/${other.id}/confirm`, owner.cookie);
    await req("POST", `/bookings/${other.id}/cancel`, driver.cookie);

    const start = new Date(kept.startsAt).getTime();
    await ensureReminders(handle.db, driver.id, new Date(start - 3 * 3_600_000)); // too early
    await ensureReminders(handle.db, driver.id, new Date(start - 60 * 60_000));
    await ensureReminders(handle.db, driver.id, new Date(start - 30 * 60_000));
    // The cancelled booking's window.
    await ensureReminders(handle.db, driver.id, new Date(new Date(other.startsAt).getTime() - 60 * 60_000));
    const reminders = (await list(driver.cookie)).data.filter((x) => x.type === "booking_reminder");
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.link!.id).toBe(kept.id);
    expect(reminders[0]!.message).toContain("10:00–11:00 IST");
  });

  it("tells the driver when a request expires unanswered", async () => {
    const { id } = await liveListing();
    const driver = await register("driver");
    const b = (await request(driver.cookie, id)).json().data;
    await settlePastBookings(handle.db, new Date(new Date(b.startsAt).getTime() + 60_000));
    await settlePastBookings(handle.db, new Date(new Date(b.startsAt).getTime() + 120_000));
    const [row] = await handle.db.select({ s: bookings.status }).from(bookings).where(eq(bookings.id, b.id));
    expect(row!.s).toBe("expired");
    expect((await types(driver.cookie)).filter((t) => t === "booking_expired")).toHaveLength(1);
  });

  it("tells the owner when a listing needs changes, keeping the reviewer's note on the listing", async () => {
    const { owner, id } = await submittedListing();
    const reviewer = await staff();
    expect((await req("POST", `/admin/parking-spaces/${id}/review`, reviewer.cookie, { decision: "reject", notes: "Photo shows the wrong gate" })).statusCode).toBe(200);
    const o = (await list(owner.cookie)).data;
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ type: "listing_changes_requested", link: { kind: "listing", id } });
    expect(o[0]!.message).not.toContain("wrong gate");
    // A failed review (not pending any more) notifies nobody.
    expect((await req("POST", `/admin/parking-spaces/${id}/review`, reviewer.cookie, { decision: "approve" })).statusCode).toBe(409);
    expect((await list(owner.cookie)).data).toHaveLength(1);
    const rows = await handle.db.select().from(notifications).where(and(eq(notifications.recipientId, reviewer.id)));
    expect(rows).toEqual([]);
  });
});
