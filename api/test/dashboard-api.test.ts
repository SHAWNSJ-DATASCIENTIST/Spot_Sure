import { eq } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDb, type DbHandle } from "../src/db/client.js";
import { bookings, parkingBays, parkingSpaces, users } from "../src/db/schema.js";
import { buildIntegrations } from "../src/integrations/index.js";
import { resetTestDatabase, testDatabaseUrl, testEnv } from "./helpers.js";

// Read endpoints behind the dashboards: each must be scoped to the session
// user and must not leak other people's identity.

const url = testDatabaseUrl;
const ORIGIN = "http://localhost:5173";
const PASSWORD = "correct horse battery";

describe.skipIf(!url)("dashboard read endpoints", () => {
  let handle: DbHandle;
  let app: FastifyInstance;
  let n = 0;

  beforeAll(async () => {
    handle = createDb(url!, { max: 3 });
    await resetTestDatabase(handle);
    const env = testEnv({ DATABASE_URL: url!, AUTH_RATE_LIMIT_MAX: "1000", RATE_LIMIT_MAX: "10000" });
    app = await buildApp({ env, db: createDb(url!, { max: 3 }), integrations: buildIntegrations(env), version: "test" });
  });

  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  const cookieOf = (res: LightMyRequestResponse) => `ss_session=${res.cookies.find((c) => c.name === "ss_session")!.value}`;
  const get = (path: string, cookie?: string) => app.inject({ url: `/api/v1${path}`, headers: cookie ? { cookie } : {} });

  async function register(role: "driver" | "parking_owner") {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { origin: ORIGIN },
      payload: { fullName: `Dash ${role} ${++n}`, email: `dash${n}@test.invalid`, password: PASSWORD, passwordConfirmation: PASSWORD, role },
    });
    expect(res.statusCode).toBe(201);
    return { id: res.json().data.id as string, cookie: cookieOf(res) };
  }

  async function spaceWithBooking(ownerId: string, driverId: string, name: string) {
    const [space] = await handle.db.insert(parkingSpaces).values({ ownerId, name, hourlyPriceMinor: 4000, status: "published", verifiedAt: new Date() }).returning();
    const [bay] = await handle.db.insert(parkingBays).values({ spaceId: space!.id, label: "A1" }).returning();
    await handle.db.insert(parkingBays).values({ spaceId: space!.id, label: "A2" });
    const [booking] = await handle.db
      .insert(bookings)
      .values({
        userId: driverId,
        spaceId: space!.id,
        bayId: bay!.id,
        startsAt: new Date("2026-12-05T09:00:00Z"),
        endsAt: new Date("2026-12-05T11:00:00Z"),
        status: "confirmed",
        hourlyPriceMinorSnapshot: 4000,
        totalPriceMinor: 8000,
        currency: "INR",
      })
      .returning();
    return { space: space!, booking: booking! };
  }

  it("shows drivers their bookings with place names, and owners the same bookings without the booker", async () => {
    const owner = await register("parking_owner");
    const otherOwner = await register("parking_owner");
    const driver = await register("driver");
    const { space, booking } = await spaceWithBooking(owner.id, driver.id, "Dash Space");

    const mine = (await get("/me/bookings", driver.cookie)).json().data;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: booking.id, spaceName: "Dash Space", bayLabel: "A1", userId: driver.id });

    const activity = await get("/me/space-bookings", owner.cookie);
    expect(activity.statusCode).toBe(200);
    expect(activity.json().data).toHaveLength(1);
    expect(activity.json().data[0]).toMatchObject({ id: booking.id, spaceId: space.id, spaceName: "Dash Space" });
    expect(activity.json().data[0]).not.toHaveProperty("userId");
    expect(activity.body).not.toContain(driver.id);

    const perSpace = await get(`/parking-spaces/${space.id}/bookings`, owner.cookie);
    expect(perSpace.body).not.toContain(driver.id);

    const ownerDetail = await get(`/bookings/${booking.id}`, owner.cookie);
    expect(ownerDetail.json().data).not.toHaveProperty("userId");
    expect((await get(`/bookings/${booking.id}`, driver.cookie)).json().data.userId).toBe(driver.id);

    // Other accounts see nothing of it.
    expect((await get("/me/space-bookings", otherOwner.cookie)).json().data).toEqual([]);
    expect((await get("/me/space-bookings", driver.cookie)).json().data).toEqual([]);
    expect((await get("/me/bookings", otherOwner.cookie)).json().data).toEqual([]);
  });

  it("reports capacity (bay count) on the owner's own listings", async () => {
    const owner = await register("parking_owner");
    const driver = await register("driver");
    const { space } = await spaceWithBooking(owner.id, driver.id, "Capacity Space");
    const list = (await get("/me/parking-spaces", owner.cookie)).json().data;
    expect(list).toEqual([expect.objectContaining({ id: space.id, capacity: 2 })]);
    expect((await get(`/me/parking-spaces/${space.id}`, owner.cookie)).json().data.capacity).toBe(2);
  });

  it("lists only societies explicitly assigned to the user", async () => {
    const staff = await register("driver");
    await handle.db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, staff.id));
    const create = (name: string) =>
      app.inject({ method: "POST", url: "/api/v1/admin/societies", headers: { origin: ORIGIN, cookie: staff.cookie }, payload: { name } });
    const s1 = (await create("Assigned Society")).json().data;
    const s2 = (await create("Other Society")).json().data;
    const admin = await register("driver");
    await app.inject({
      method: "PUT",
      url: `/api/v1/admin/societies/${s1.id}/admins/${admin.id}`,
      headers: { origin: ORIGIN, cookie: staff.cookie },
    });

    const mine = (await get("/me/societies", admin.cookie)).json().data;
    expect(mine.map((s: { id: string }) => s.id)).toEqual([s1.id]);
    // Platform staff are not society admins by default.
    expect((await get("/me/societies", staff.cookie)).json().data).toEqual([]);

    // Space summaries inside a society, scoped the same way and without owner identity.
    const owner = await register("parking_owner");
    const driver = await register("driver");
    const { space } = await spaceWithBooking(owner.id, driver.id, "Society Space");
    await handle.db.update(parkingSpaces).set({ societyId: s1.id }).where(eq(parkingSpaces.id, space.id));
    const summaries = await get(`/societies/${s1.id}/parking-spaces`, admin.cookie);
    expect(summaries.statusCode).toBe(200);
    expect(summaries.json().data).toEqual([{ id: space.id, name: "Society Space", status: "published", bayCount: 2 }]);
    expect(summaries.body).not.toContain(owner.id);

    expect((await get(`/societies/${s2.id}/parking-spaces`, admin.cookie)).statusCode).toBe(403);
    expect((await get(`/societies/${s1.id}/parking-spaces`, owner.cookie)).statusCode).toBe(403);
  });

  it("requires a session for every dashboard read", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    for (const path of ["/me/space-bookings", "/me/societies", `/societies/${id}/parking-spaces`]) {
      expect((await get(path)).statusCode, path).toBe(401);
    }
  });
});
