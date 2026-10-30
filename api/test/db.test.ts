import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDb, type DbHandle } from "../src/db/client.js";
import { bookings, hardwareDevices, parkingBays, users } from "../src/db/schema.js";
import { buildIntegrations } from "../src/integrations/index.js";
import { recordOccupancyEvent } from "../src/repositories/occupancyEvents.js";
import { createParkingSpace, getParkingSpace } from "../src/repositories/parkingSpaces.js";
import { resetTestDatabase, testDatabaseUrl, testEnv } from "./helpers.js";

// Runs against a real PostgreSQL database. Skipped (and reported as skipped)
// when TEST_DATABASE_URL is not set; see api/README.md for setup.

const url = testDatabaseUrl;

describe.skipIf(!url)("database (PostgreSQL)", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = createDb(url!, { max: 5 });
    await resetTestDatabase(handle);
  });

  afterAll(async () => {
    await handle?.close();
  });

  // Fixtures are clearly labelled test data, not customers or real readings.
  async function fixtureOwner(tag: string) {
    const [u] = await handle.db
      .insert(users)
      .values({ displayName: `Test owner ${tag}`, email: `owner-${tag}@test.invalid`, status: "active" })
      .returning();
    return u!;
  }

  async function fixtureSpaceWithBay(tag: string) {
    const owner = await fixtureOwner(tag);
    const space = await createParkingSpace(handle.db, {
      ownerId: owner.id,
      name: `Test space ${tag}`,
      hourlyPriceMinor: 4000,
      status: "published",
      verifiedAt: new Date(),
    });
    const [bay] = await handle.db.insert(parkingBays).values({ spaceId: space.id, label: "B1" }).returning();
    return { owner, space, bay: bay! };
  }

  it("applies all migrations and reports ready", async () => {
    const env = testEnv({ DATABASE_URL: url! });
    const app = await buildApp({
      env,
      db: createDb(url!, { max: 1 }),
      integrations: buildIntegrations(env),
      version: "test",
    });
    const res = await app.inject("/api/v1/ready");
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().checks).toEqual({
      database: { ok: true },
      migrations: { ok: true, detail: "9/9 applied" },
    });
  });

  it("creates a record and reads it back through a fresh connection pool", async () => {
    const { space } = await fixtureSpaceWithBay("roundtrip");

    const other = createDb(url!, { max: 1 });
    try {
      const fetched = await getParkingSpace(other.db, space.id);
      expect(fetched).toMatchObject({ id: space.id, name: "Test space roundtrip", hourlyPriceMinor: 4000, currency: "INR" });
    } finally {
      await other.close();
    }
  });

  it("serves active listings over the API and hides drafts", async () => {
    const { space } = await fixtureSpaceWithBay("api");
    const owner = await fixtureOwner("draft");
    const draft = await createParkingSpace(handle.db, { ownerId: owner.id, name: "Test draft", hourlyPriceMinor: 1 });

    const env = testEnv({ DATABASE_URL: url! });
    const app = await buildApp({ env, db: createDb(url!, { max: 1 }), integrations: buildIntegrations(env), version: "t" });
    try {
      const one = await app.inject(`/api/v1/parking-spaces/${space.id}`);
      expect(one.statusCode).toBe(200);
      expect(one.json().data).toMatchObject({ id: space.id, hourlyPrice: { amountMinor: 4000, currency: "INR" } });
      expect(one.body).not.toContain("owner-api@test.invalid");

      expect((await app.inject(`/api/v1/parking-spaces/${draft.id}`)).statusCode).toBe(404);
      const list = await app.inject("/api/v1/parking-spaces?pageSize=24");
      const ids = list.json().data.map((s: { id: string }) => s.id);
      expect(ids).toContain(space.id);
      expect(ids).not.toContain(draft.id);
    } finally {
      await app.close();
    }
  });

  it("enforces schema constraints in the database itself", async () => {
    const owner = await fixtureOwner("checks");
    await expect(
      createParkingSpace(handle.db, { ownerId: owner.id, name: "x", hourlyPriceMinor: -1 }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      handle.db.insert(users).values({ displayName: "dup", email: "OWNER-CHECKS@test.invalid" }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  describe("booking overlap prevention", () => {
    async function book(ctx: Awaited<ReturnType<typeof fixtureSpaceWithBay>>, start: string, end: string, status: "pending" | "confirmed" | "cancelled" = "confirmed") {
      return handle.db
        .insert(bookings)
        .values({
          userId: ctx.owner.id,
          spaceId: ctx.space.id,
          bayId: ctx.bay.id,
          startsAt: new Date(start),
          endsAt: new Date(end),
          status,
          hourlyPriceMinorSnapshot: 4000,
          totalPriceMinor: 8000,
          currency: "INR",
        })
        .returning();
    }

    it("rejects overlapping confirmed bookings on the same bay", async () => {
      const ctx = await fixtureSpaceWithBay("overlap");
      await book(ctx, "2026-11-01T10:00:00Z", "2026-11-01T12:00:00Z");
      await expect(book(ctx, "2026-11-01T11:00:00Z", "2026-11-01T13:00:00Z")).rejects.toMatchObject({
        cause: { code: "23P01" },
      });
      // Back-to-back is fine ([) ranges); pending/cancelled do not hold the bay.
      await expect(book(ctx, "2026-11-01T12:00:00Z", "2026-11-01T13:00:00Z")).resolves.toHaveLength(1);
      await expect(book(ctx, "2026-11-01T10:30:00Z", "2026-11-01T11:30:00Z", "pending")).resolves.toHaveLength(1);
      await expect(book(ctx, "2026-11-01T10:30:00Z", "2026-11-01T11:30:00Z", "cancelled")).resolves.toHaveLength(1);
    });

    it("lets exactly one of several concurrent overlapping confirmations win", async () => {
      const ctx = await fixtureSpaceWithBay("race");
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => book(ctx, "2026-11-02T10:00:00Z", "2026-11-02T11:00:00Z")),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(4);
    });

    it("rejects inverted time ranges", async () => {
      const ctx = await fixtureSpaceWithBay("inverted");
      await expect(book(ctx, "2026-11-03T12:00:00Z", "2026-11-03T10:00:00Z")).rejects.toMatchObject({
        cause: { code: "23514" },
      });
    });
  });

  describe("occupancy events", () => {
    it("stores an observation and deduplicates redelivery", async () => {
      const ctx = await fixtureSpaceWithBay("occ");
      const [device] = await handle.db
        .insert(hardwareDevices)
        .values({ externalId: "test-device-occ", type: "wifi_bay_sensor", spaceId: ctx.space.id, bayId: ctx.bay.id })
        .returning();
      const input = {
        source: "hardware" as const,
        deviceId: device!.id,
        spaceId: ctx.space.id,
        bayId: ctx.bay.id,
        observation: "occupied" as const,
        observedAt: new Date("2026-10-01T10:00:00Z"),
        sourceEventId: "test-evt-1",
        provenance: { fixture: true },
      };
      const first = await recordOccupancyEvent(handle.db, input);
      const again = await recordOccupancyEvent(handle.db, input);
      expect(first.duplicate).toBe(false);
      expect(first.event.processingStatus).toBe("validated");
      expect(again.duplicate).toBe(true);
      expect(again.event.id).toBe(first.event.id);
    });

    it("rejects a bay that belongs to a different space", async () => {
      const a = await fixtureSpaceWithBay("occ-a");
      const b = await fixtureSpaceWithBay("occ-b");
      await expect(
        recordOccupancyEvent(handle.db, {
          source: "manual",
          spaceId: a.space.id,
          bayId: b.bay.id,
          observation: "available",
          observedAt: new Date(),
          provenance: {},
        }),
      ).rejects.toMatchObject({ statusCode: 422, code: "bay_space_mismatch" });
    });
  });
});
