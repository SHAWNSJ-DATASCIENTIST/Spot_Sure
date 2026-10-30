import { eq } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDb, type DbHandle } from "../src/db/client.js";
import { bookings, sessions, users } from "../src/db/schema.js";
import { buildIntegrations } from "../src/integrations/index.js";
import { resetTestDatabase, testDatabaseUrl, testEnv } from "./helpers.js";

// Security tests for authentication and authorisation, against real
// PostgreSQL. All accounts use the reserved .invalid TLD.

const url = testDatabaseUrl;
const ORIGIN = "http://localhost:5173";
const PASSWORD = "correct horse battery";

describe.skipIf(!url)("auth and access control", () => {
  let handle: DbHandle;
  let app: FastifyInstance;

  async function makeApp(overrides: Record<string, string> = {}) {
    const env = testEnv({ DATABASE_URL: url!, AUTH_RATE_LIMIT_MAX: "1000", RATE_LIMIT_MAX: "10000", ...overrides });
    return buildApp({ env, db: createDb(url!, { max: 3 }), integrations: buildIntegrations(env), version: "test" });
  }

  beforeAll(async () => {
    handle = createDb(url!, { max: 3 });
    await resetTestDatabase(handle);
    app = await makeApp();
  });

  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  function sessionCookie(res: LightMyRequestResponse): string {
    const c = res.cookies.find((x) => x.name === "ss_session");
    if (!c?.value) throw new Error(`no session cookie (status ${res.statusCode}: ${res.body})`);
    return `ss_session=${c.value}`;
  }

  function post(path: string, payload: unknown, cookie?: string, extraHeaders: Record<string, string> = {}) {
    return app.inject({
      method: "POST",
      url: `/api/v1${path}`,
      payload: payload as object,
      headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}), ...extraHeaders },
    });
  }
  function patch(path: string, payload: unknown, cookie?: string) {
    return app.inject({ method: "PATCH", url: `/api/v1${path}`, payload: payload as object, headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } });
  }
  function get(path: string, cookie?: string) {
    return app.inject({ method: "GET", url: `/api/v1${path}`, headers: cookie ? { cookie } : {} });
  }

  let n = 0;
  async function register(role: "driver" | "parking_owner" = "driver", extra: Record<string, unknown> = {}) {
    const email = `user${++n}-${role}@test.invalid`;
    const res = await post("/auth/register", {
      fullName: `Test ${role} ${n}`,
      email,
      password: PASSWORD,
      passwordConfirmation: PASSWORD,
      role,
      ...extra,
    });
    expect(res.statusCode, res.body).toBe(201);
    return { email, cookie: sessionCookie(res), user: res.json().data as { id: string; role: string } };
  }

  describe("registration", () => {
    it("creates an active, unverified account, signs it in and hides secrets", async () => {
      const res = await post("/auth/register", {
        fullName: "  Asha Driver ",
        email: "  Asha.Driver@Test.INVALID ",
        password: PASSWORD,
        passwordConfirmation: PASSWORD,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json().data;
      expect(body).toMatchObject({
        fullName: "Asha Driver",
        email: "asha.driver@test.invalid",
        role: "driver",
        status: "active",
        emailVerified: false,
        isPlatformAdmin: false,
        administeredSocietyIds: [],
      });
      expect(Object.keys(body)).not.toContain("passwordHash");
      expect(res.body).not.toContain("argon2");
      expect(res.body).not.toContain(PASSWORD);

      const cookie = res.cookies.find((c) => c.name === "ss_session")!;
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.sameSite).toBe("Lax");
      expect(cookie.path).toBe("/");
      expect(res.headers["cache-control"]).toBe("no-store");
    });

    it("stores an Argon2id hash, never the plaintext password", async () => {
      const row = await handle.db.query.users.findFirst({ where: eq(users.email, "asha.driver@test.invalid") });
      expect(row!.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
      expect(row!.passwordHash).not.toContain(PASSWORD);
    });

    it("rejects invalid input with field-level messages", async () => {
      const res = await post("/auth/register", {
        fullName: "A",
        email: "not-an-email",
        password: "short",
        passwordConfirmation: "different",
      });
      expect(res.statusCode).toBe(400);
      const paths = res.json().error.details.map((d: { path: string }) => d.path);
      expect(paths).toEqual(expect.arrayContaining(["fullName", "email", "password"]));

      const mismatch = await post("/auth/register", {
        fullName: "Test Mismatch",
        email: "mismatch@test.invalid",
        password: PASSWORD,
        passwordConfirmation: `${PASSWORD}!`,
      });
      expect(mismatch.statusCode).toBe(400);
      expect(mismatch.json().error.details).toEqual([{ path: "passwordConfirmation", message: "Passwords do not match" }]);

      const common = await post("/auth/register", {
        fullName: "Test Common",
        email: "common@test.invalid",
        password: "password123",
        passwordConfirmation: "password123",
      });
      expect(common.statusCode).toBe(400);
    });

    it("refuses duplicate emails case-insensitively without confirming the account exists", async () => {
      const res = await post("/auth/register", {
        fullName: "Someone Else",
        email: "ASHA.DRIVER@test.invalid",
        password: PASSWORD,
        passwordConfirmation: PASSWORD,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("registration_unavailable");
      expect(res.json().error.message).not.toMatch(/exist|taken|registered/i);
      expect(res.cookies).toHaveLength(0);
    });

    it("rejects any attempt to self-assign privileged roles or flags", async () => {
      for (const extra of [
        { role: "society_admin" },
        { role: "platform_admin" },
        { isPlatformAdmin: true },
        { status: "active" },
        { emailVerifiedAt: new Date().toISOString() },
        { id: "00000000-0000-4000-8000-000000000000" },
      ]) {
        const res = await post("/auth/register", {
          fullName: "Sneaky User",
          email: `sneaky-${Object.keys(extra)[0]}@test.invalid`,
          password: PASSWORD,
          passwordConfirmation: PASSWORD,
          ...extra,
        });
        expect(res.statusCode, JSON.stringify(extra)).toBe(400);
      }
      const created = await handle.db.select().from(users).where(eq(users.isPlatformAdmin, true));
      expect(created).toHaveLength(0);
    });

    it("cannot gain privileges by editing the profile", async () => {
      const { cookie } = await register();
      for (const body of [{ role: "parking_owner" }, { isPlatformAdmin: true }, { email: "x@test.invalid" }]) {
        expect((await patch("/users/me", body, cookie)).statusCode).toBe(400);
      }
      const ok = await patch("/users/me", { fullName: "Renamed Driver" }, cookie);
      expect(ok.statusCode).toBe(200);
      expect(ok.json().data).toMatchObject({ fullName: "Renamed Driver", role: "driver", isPlatformAdmin: false });
    });
  });

  describe("login and logout", () => {
    it("signs in with correct credentials, case-insensitive email", async () => {
      const res = await post("/auth/login", { email: "Asha.Driver@test.invalid", password: PASSWORD });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.email).toBe("asha.driver@test.invalid");
      expect(res.body).not.toContain("argon2");
      const me = await get("/auth/me", sessionCookie(res));
      expect(me.statusCode).toBe(200);
      expect(me.json().data.email).toBe("asha.driver@test.invalid");
    });

    it("gives the same answer for a wrong password and an unknown email", async () => {
      const wrong = await post("/auth/login", { email: "asha.driver@test.invalid", password: "wrong password!!" });
      const unknown = await post("/auth/login", { email: "nobody@test.invalid", password: "wrong password!!" });
      expect(wrong.statusCode).toBe(401);
      expect(unknown.statusCode).toBe(401);
      const strip = (r: LightMyRequestResponse) => ({ ...r.json().error, requestId: undefined });
      expect(strip(wrong)).toEqual(strip(unknown));
      expect(wrong.cookies).toHaveLength(0);
    });

    it("logout deletes the server-side session so the old cookie stops working", async () => {
      const { cookie, user } = await register();
      expect((await get("/auth/me", cookie)).statusCode).toBe(200);

      const out = await post("/auth/logout", {}, cookie);
      expect(out.statusCode).toBe(204);
      const cleared = out.cookies.find((c) => c.name === "ss_session")!;
      expect(cleared.value).toBe("");

      expect((await get("/auth/me", cookie)).statusCode).toBe(401);
      expect(await handle.db.select().from(sessions).where(eq(sessions.userId, user.id))).toHaveLength(0);
    });

    it("stores only a hash of the session token", async () => {
      const { cookie, user } = await register();
      const token = cookie.split("=")[1]!;
      const [row] = await handle.db.select().from(sessions).where(eq(sessions.userId, user.id));
      expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row!.tokenHash).not.toBe(token);
    });

    it("rejects expired sessions and sessions of suspended accounts", async () => {
      const a = await register();
      await handle.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, a.user.id));
      expect((await get("/auth/me", a.cookie)).statusCode).toBe(401);

      const b = await register();
      await handle.db.update(users).set({ status: "suspended" }).where(eq(users.id, b.user.id));
      expect((await get("/auth/me", b.cookie)).statusCode).toBe(401);
      const login = await post("/auth/login", { email: b.email, password: PASSWORD });
      expect(login.statusCode).toBe(403);
      expect(login.cookies).toHaveLength(0);
    });

    it("ignores forged or garbage session cookies", async () => {
      expect((await get("/auth/me", "ss_session=forged-token")).statusCode).toBe(401);
    });
  });

  describe("unauthenticated access", () => {
    it("returns 401 on every protected endpoint", async () => {
      const id = "00000000-0000-4000-8000-000000000000";
      const cases = [
        get("/auth/me"),
        get("/me/bookings"),
        get("/me/parking-spaces"),
        get(`/bookings/${id}`),
        get(`/societies/${id}`),
        get(`/parking-spaces/${id}/bookings`),
        patch("/users/me", { fullName: "Nobody Here" }),
        post("/parking-spaces", { name: "Nope", hourlyPriceMinor: 100 }),
        patch(`/parking-spaces/${id}`, { name: "Nope" }),
        patch(`/societies/${id}`, { name: "Nope" }),
        post("/admin/societies", { name: "Nope" }),
      ];
      for (const res of await Promise.all(cases)) {
        expect(res.statusCode, res.raw.req.url).toBe(401);
        expect(res.json().error.code).toBe("unauthenticated");
      }
    });
  });

  describe("authorisation", () => {
    async function createSpace(cookie: string, name: string) {
      const res = await post("/parking-spaces", { name, hourlyPriceMinor: 5000 }, cookie);
      expect(res.statusCode, res.body).toBe(201);
      return res.json().data as { id: string; status: string };
    }

    it("only parking owners can list spaces, always as the session user and as a draft", async () => {
      const driver = await register("driver");
      expect((await post("/parking-spaces", { name: "Driver Space", hourlyPriceMinor: 1 }, driver.cookie)).statusCode).toBe(403);

      const owner = await register("parking_owner");
      const other = await register("parking_owner");
      const forged = await post("/parking-spaces", { name: "Forged", hourlyPriceMinor: 1, ownerId: other.user.id }, owner.cookie);
      expect(forged.statusCode).toBe(400);
      for (const status of ["published", "active"]) {
        const withStatus = await post("/parking-spaces", { name: "Live", hourlyPriceMinor: 1, status }, owner.cookie);
        expect(withStatus.statusCode).toBe(400);
      }

      const space = await createSpace(owner.cookie, "Test Owner Space");
      expect(space.status).toBe("draft");
      const mine = await get("/me/parking-spaces", owner.cookie);
      expect(mine.json().data.map((s: { id: string }) => s.id)).toEqual([space.id]);
      // Drafts are invisible publicly and to other users; the owner reads them via /me.
      expect((await get(`/parking-spaces/${space.id}`)).statusCode).toBe(404);
      expect((await get(`/parking-spaces/${space.id}`, other.cookie)).statusCode).toBe(404);
      expect((await get(`/me/parking-spaces/${space.id}`, other.cookie)).statusCode).toBe(403);
      expect((await get(`/me/parking-spaces/${space.id}`, owner.cookie)).statusCode).toBe(200);
    });

    it("an owner cannot modify or read bookings of another owner's space", async () => {
      const a = await register("parking_owner");
      const b = await register("parking_owner");
      const space = await createSpace(a.cookie, "Owner A Space");

      const res = await patch(`/parking-spaces/${space.id}`, { name: "Hijacked", hourlyPriceMinor: 0 }, b.cookie);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("forbidden");
      expect((await get(`/parking-spaces/${space.id}/bookings`, b.cookie)).statusCode).toBe(403);

      const archive = await post(`/parking-spaces/${space.id}/actions`, { action: "archive" }, b.cookie);
      expect(archive.statusCode).toBe(403);

      const unchanged = await get(`/me/parking-spaces/${space.id}`, a.cookie);
      expect(unchanged.json().data).toMatchObject({ name: "Owner A Space", hourlyPrice: { amountMinor: 5000 }, status: "draft" });

      // Status can't be set by editing; it only changes through lifecycle actions.
      expect((await patch(`/parking-spaces/${space.id}`, { status: "published" }, a.cookie)).statusCode).toBe(400);
      const ok = await patch(`/parking-spaces/${space.id}`, { name: "Owner A Space, renamed" }, a.cookie);
      expect(ok.statusCode).toBe(200);
      expect(ok.json().data.name).toBe("Owner A Space, renamed");
    });

    it("a driver cannot see another driver's booking by changing the id", async () => {
      const owner = await register("parking_owner");
      const space = await createSpace(owner.cookie, "Booked Space");
      // New listings get their bays from capacity (default 1).
      const bay = (await get(`/me/parking-spaces/${space.id}`, owner.cookie)).json().data.bays[0] as { id: string };
      const d1 = await register("driver");
      const d2 = await register("driver");
      const [booking] = await handle.db
        .insert(bookings)
        .values({
          userId: d1.user.id,
          spaceId: space.id,
          bayId: bay!.id,
          startsAt: new Date("2026-12-01T10:00:00Z"),
          endsAt: new Date("2026-12-01T11:00:00Z"),
          status: "pending",
          hourlyPriceMinorSnapshot: 5000,
          totalPriceMinor: 5000,
          currency: "INR",
        })
        .returning();

      expect((await get(`/bookings/${booking!.id}`, d1.cookie)).statusCode).toBe(200);
      const peek = await get(`/bookings/${booking!.id}`, d2.cookie);
      expect(peek.statusCode).toBe(404);
      expect(peek.body).not.toContain(d1.user.id);
      // The owner of the booked space may see it too.
      expect((await get(`/bookings/${booking!.id}`, owner.cookie)).statusCode).toBe(200);

      expect((await get("/me/bookings", d1.cookie)).json().data).toHaveLength(1);
      expect((await get("/me/bookings", d2.cookie)).json().data).toHaveLength(0);
      const forOwner = await get(`/parking-spaces/${space.id}/bookings`, owner.cookie);
      expect(forOwner.json().data.map((b: { id: string }) => b.id)).toEqual([booking!.id]);
    });

    it("society admins manage only societies they are assigned to; platform admin is separate", async () => {
      const staff = await register();
      await handle.db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, staff.user.id));

      const s1 = (await post("/admin/societies", { name: "Test Society One" }, staff.cookie)).json().data;
      const s2 = (await post("/admin/societies", { name: "Test Society Two" }, staff.cookie)).json().data;
      const admin = await register();

      // Not yet assigned anywhere.
      expect((await get(`/societies/${s1.id}`, admin.cookie)).statusCode).toBe(403);

      const grant = await app.inject({
        method: "PUT",
        url: `/api/v1/admin/societies/${s1.id}/admins/${admin.user.id}`,
        headers: { origin: ORIGIN, cookie: staff.cookie },
      });
      expect(grant.statusCode).toBe(204);
      expect((await get("/auth/me", admin.cookie)).json().data.administeredSocietyIds).toEqual([s1.id]);

      const ok = await patch(`/societies/${s1.id}`, { accessRules: { visitorHours: "08:00-22:00" } }, admin.cookie);
      expect(ok.statusCode).toBe(200);
      expect(ok.json().data.accessRules).toEqual({ visitorHours: "08:00-22:00" });

      const denied = await patch(`/societies/${s2.id}`, { name: "Taken Over" }, admin.cookie);
      expect(denied.statusCode).toBe(403);
      expect((await get(`/societies/${s2.id}`, admin.cookie)).statusCode).toBe(403);

      // A society admin is not a platform admin: cannot create societies or grant admins, including to themselves.
      expect((await post("/admin/societies", { name: "Rogue Society" }, admin.cookie)).statusCode).toBe(403);
      const selfGrant = await app.inject({
        method: "PUT",
        url: `/api/v1/admin/societies/${s2.id}/admins/${admin.user.id}`,
        headers: { origin: ORIGIN, cookie: admin.cookie },
      });
      expect(selfGrant.statusCode).toBe(403);
    });
  });

  describe("CSRF and transport protections", () => {
    it("rejects state-changing requests from disallowed origins", async () => {
      const evil = await post("/auth/login", { email: "asha.driver@test.invalid", password: PASSWORD }, undefined, {
        origin: "https://evil.example",
      });
      expect(evil.statusCode).toBe(403);
      expect(evil.json().error.code).toBe("origin_not_allowed");

      const crossSite = await app.inject({
        method: "POST",
        url: "/api/v1/auth/logout",
        headers: { "sec-fetch-site": "cross-site" },
      });
      expect(crossSite.statusCode).toBe(403);
    });

    it("does not accept form-encoded bodies, which browsers can send cross-site without preflight", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
        payload: "email=asha.driver%40test.invalid&password=x",
      });
      expect(res.statusCode).toBe(415);
    });

    it("rate limits login attempts per client", async () => {
      const limited = await makeApp({ AUTH_RATE_LIMIT_MAX: "3" });
      try {
        const attempt = () =>
          limited.inject({
            method: "POST",
            url: "/api/v1/auth/login",
            headers: { origin: ORIGIN },
            payload: { email: "nobody@test.invalid", password: "whatever-it-is" },
          });
        for (let i = 0; i < 3; i++) expect((await attempt()).statusCode).toBe(401);
        const blocked = await attempt();
        expect(blocked.statusCode).toBe(429);
        expect(blocked.json().error.code).toBe("rate_limited");
      } finally {
        await limited.close();
      }
    });
  });

  describe("session hardening", () => {
    it("lets exactly one of several concurrent registrations for the same email succeed", async () => {
      const attempts = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          post("/auth/register", {
            fullName: `Racer ${i + 1}`,
            email: i % 2 ? "RACE@test.invalid" : "race@test.invalid",
            password: PASSWORD,
            passwordConfirmation: PASSWORD,
          }),
        ),
      );
      expect(attempts.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409, 409]);
      expect(await handle.db.select().from(users).where(eq(users.email, "race@test.invalid"))).toHaveLength(1);
    });

    it("rotates the session on sign-in: the previously presented token is revoked", async () => {
      const { email, cookie: before } = await register();
      const login = await post("/auth/login", { email, password: PASSWORD }, before);
      const after = sessionCookie(login);
      expect(after).not.toBe(before);
      expect((await get("/auth/me", before)).statusCode).toBe(401);
      expect((await get("/auth/me", after)).statusCode).toBe(200);
    });

    it("does not carry another account's session across a sign-in", async () => {
      const a = await register();
      const b = await register();
      const login = await post("/auth/login", { email: b.email, password: PASSWORD }, a.cookie);
      expect(login.json().data.id).toBe(b.user.id);
      expect((await get("/auth/me", a.cookie)).statusCode).toBe(401);
    });

    it("uses Secure, __Host- prefixed cookies in production", async () => {
      const prod = await makeApp({ NODE_ENV: "production", CORS_ORIGINS: "https://spotsure.example" });
      try {
        const res = await prod.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          headers: { origin: "https://spotsure.example" },
          payload: {
            fullName: "Prod Cookie",
            email: "prod-cookie@test.invalid",
            password: PASSWORD,
            passwordConfirmation: PASSWORD,
          },
        });
        expect(res.statusCode).toBe(201);
        const c = res.cookies.find((x) => x.name === "__Host-ss_session")!;
        expect(c).toMatchObject({ secure: true, httpOnly: true, sameSite: "Lax", path: "/" });
        expect(c.domain).toBeUndefined();
        expect(res.cookies.find((x) => x.name === "ss_session")).toBeUndefined();
      } finally {
        await prod.close();
      }
    });
  });

  describe("owner availability", () => {
    const weekly = {
      timezone: "Asia/Kolkata",
      weekly: [
        { day: "mon", opens: "08:00", closes: "12:00" },
        { day: "mon", opens: "14:00", closes: "20:00" },
        { day: "sat", opens: "09:00", closes: "18:00" },
      ],
    };
    const put = (id: string, body: unknown, cookie: string) =>
      app.inject({
        method: "PUT",
        url: `/api/v1/parking-spaces/${id}/availability`,
        payload: JSON.stringify(body),
        headers: { origin: ORIGIN, cookie, "content-type": "application/json" },
      });

    it("lets only the owner set and clear weekly hours", async () => {
      const owner = await register("parking_owner");
      const other = await register("parking_owner");
      const driver = await register("driver");
      const space = (await post("/parking-spaces", { name: "Hours Space", hourlyPriceMinor: 2000 }, owner.cookie)).json().data;

      expect((await put(space.id, weekly, other.cookie)).statusCode).toBe(403);
      expect((await put(space.id, weekly, driver.cookie)).statusCode).toBe(403);

      const ok = await put(space.id, weekly, owner.cookie);
      expect(ok.statusCode).toBe(200);
      expect(ok.json().data.availability).toEqual(weekly);

      const cleared = await put(space.id, null, owner.cookie);
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json().data.availability).toBeNull();
    });

    it("rejects invalid hours", async () => {
      const owner = await register("parking_owner");
      const space = (await post("/parking-spaces", { name: "Bad Hours", hourlyPriceMinor: 2000 }, owner.cookie)).json().data;
      for (const bad of [
        { timezone: "Mars/Olympus", weekly: [] },
        { timezone: "Asia/Kolkata", weekly: [{ day: "mon", opens: "18:00", closes: "09:00" }] },
        { timezone: "Asia/Kolkata", weekly: [{ day: "mon", opens: "08:00", closes: "12:00" }, { day: "mon", opens: "11:00", closes: "13:00" }] },
        { timezone: "Asia/Kolkata", weekly: [{ day: "funday", opens: "08:00", closes: "12:00" }] },
        { ...weekly, ownerId: "00000000-0000-4000-8000-000000000000" },
      ]) {
        expect((await put(space.id, bad, owner.cookie)).statusCode, JSON.stringify(bad)).toBe(400);
      }
    });
  });
});
