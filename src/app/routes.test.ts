import { describe, expect, it } from "vitest";
import type { User } from "./api";
import { canAccess, homeFor, matchAppRoute, navFor } from "./routes";

const base: User = {
  id: "u1",
  fullName: "Test User",
  email: "t@test.invalid",
  phone: null,
  role: "driver",
  status: "active",
  emailVerified: false,
  isPlatformAdmin: false,
  administeredSocietyIds: [],
  createdAt: "2026-10-01T00:00:00.000Z",
};
const driver = base;
const owner: User = { ...base, role: "parking_owner" };
const societyAdmin: User = { ...base, administeredSocietyIds: ["s1"] };
const staff: User = { ...base, isPlatformAdmin: true };
const ID = "6f1c3c1e-0f7a-4c55-9a51-2c2f0b6e8a11";

describe("matchAppRoute", () => {
  it("matches signed-in routes and ignores the rest of the site", () => {
    expect(matchAppRoute("/")).toBeNull();
    expect(matchAppRoute("/sign-in")).toBeNull();
    expect(matchAppRoute("/application")).toBeNull();
    expect(matchAppRoute("/app")).toMatchObject({ name: "home" });
    expect(matchAppRoute("/app/")).toMatchObject({ name: "home" });
    expect(matchAppRoute("/app/owner/spaces/new")).toMatchObject({ name: "ownerSpaceNew", area: "owner" });
    expect(matchAppRoute(`/app/owner/spaces/${ID}`)).toEqual({ name: "ownerSpace", area: "owner", id: ID });
    expect(matchAppRoute(`/app/society/${ID}`)).toEqual({ name: "societyDetail", area: "society", id: ID });
    expect(matchAppRoute("/app/owner/spaces/not-a-uuid")).toMatchObject({ name: "notFound" });
  });
});

describe("role access", () => {
  it("sends each role to its own dashboard", () => {
    expect(homeFor(driver)).toBe("/app/driver");
    expect(homeFor(owner)).toBe("/app/owner");
    expect(homeFor(societyAdmin)).toBe("/app/driver");
  });

  it("only opens areas the server-verified role allows", () => {
    expect(canAccess("driver", driver)).toBe(true);
    expect(canAccess("owner", driver)).toBe(false);
    expect(canAccess("driver", owner)).toBe(false);
    expect(canAccess("owner", owner)).toBe(true);
    expect(canAccess("society", driver)).toBe(false);
    expect(canAccess("society", societyAdmin)).toBe(true);
    // Platform staff are not society admins by default.
    expect(canAccess("society", staff)).toBe(false);
  });

  it("shows navigation only for usable areas", () => {
    const labels = (u: User) => navFor(u).map((n) => n.label);
    expect(labels(driver)).toEqual(["Overview", "My bookings", "Find parking"]);
    expect(labels(owner)).toEqual(["Overview", "My spaces", "Booking activity", "Find parking"]);
    expect(labels(societyAdmin)).toContain("Societies");
  });
});
