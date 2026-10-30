import type { User } from "./api";

// Signed-in route table. Access rules here drive navigation only; the API
// enforces the same rules (and more) on every request.

export type RouteName =
  | "home"
  | "driver"
  | "driverBookings"
  | "booking"
  | "discover"
  | "discoverListing"
  | "staffReview"
  | "owner"
  | "ownerSpaces"
  | "ownerSpaceNew"
  | "ownerSpace"
  | "ownerBookings"
  | "society"
  | "societyDetail"
  | "profile"
  | "notifications"
  | "notFound";

export type Area = "driver" | "owner" | "society" | "staff" | "any";

const UUID = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";

const TABLE: { name: RouteName; pattern: RegExp; area: Area }[] = [
  { name: "home", pattern: /^\/app$/, area: "any" },
  { name: "driver", pattern: /^\/app\/driver$/, area: "driver" },
  { name: "driverBookings", pattern: /^\/app\/driver\/bookings$/, area: "driver" },
  // Bookers and owners of the booked space can both open a booking; the API decides.
  { name: "booking", pattern: new RegExp(`^/app/bookings/${UUID}$`), area: "any" },
  { name: "discover", pattern: /^\/app\/discover$/, area: "any" },
  { name: "discoverListing", pattern: new RegExp(`^/app/discover/${UUID}$`), area: "any" },
  { name: "staffReview", pattern: /^\/app\/staff\/listings$/, area: "staff" },
  { name: "owner", pattern: /^\/app\/owner$/, area: "owner" },
  { name: "ownerSpaces", pattern: /^\/app\/owner\/spaces$/, area: "owner" },
  { name: "ownerSpaceNew", pattern: /^\/app\/owner\/spaces\/new$/, area: "owner" },
  { name: "ownerSpace", pattern: new RegExp(`^/app/owner/spaces/${UUID}$`), area: "owner" },
  { name: "ownerBookings", pattern: /^\/app\/owner\/bookings$/, area: "owner" },
  { name: "society", pattern: /^\/app\/society$/, area: "society" },
  { name: "societyDetail", pattern: new RegExp(`^/app/society/${UUID}$`), area: "society" },
  { name: "profile", pattern: /^\/app\/profile$/, area: "any" },
  { name: "notifications", pattern: /^\/app\/notifications$/, area: "any" },
];

export interface AppRoute {
  name: RouteName;
  area: Area;
  id?: string;
}

/** Null when the path is outside the signed-in app. */
export function matchAppRoute(pathname: string): AppRoute | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path !== "/app" && !path.startsWith("/app/")) return null;
  for (const r of TABLE) {
    const m = r.pattern.exec(path);
    if (m) return { name: r.name, area: r.area, id: m[1] };
  }
  return { name: "notFound", area: "any" };
}

export function isSocietyAdmin(user: User): boolean {
  return user.administeredSocietyIds.length > 0;
}

export function canAccess(area: Area, user: User): boolean {
  switch (area) {
    case "driver":
      return user.role === "driver";
    case "owner":
      return user.role === "parking_owner";
    case "society":
      return isSocietyAdmin(user);
    case "staff":
      return user.isPlatformAdmin;
    case "any":
      return true;
  }
}

/** The dashboard a user lands on, from their server-verified role. */
export function homeFor(user: User): string {
  return user.role === "parking_owner" ? "/app/owner" : "/app/driver";
}

export interface NavItem {
  href: string;
  label: string;
  routes: RouteName[];
}

export function navFor(user: User): NavItem[] {
  const items: NavItem[] =
    user.role === "parking_owner"
      ? [
          { href: "/app/owner", label: "Overview", routes: ["owner"] },
          { href: "/app/owner/spaces", label: "My spaces", routes: ["ownerSpaces", "ownerSpaceNew", "ownerSpace"] },
          { href: "/app/owner/bookings", label: "Booking activity", routes: ["ownerBookings"] },
        ]
      : [
          { href: "/app/driver", label: "Overview", routes: ["driver"] },
          { href: "/app/driver/bookings", label: "My bookings", routes: ["driverBookings", "booking"] },
        ];
  items.push({ href: "/app/discover", label: "Find parking", routes: ["discover", "discoverListing"] });
  if (isSocietyAdmin(user)) items.push({ href: "/app/society", label: "Societies", routes: ["society", "societyDetail"] });
  if (user.isPlatformAdmin) items.push({ href: "/app/staff/listings", label: "Listing review", routes: ["staffReview"] });
  return items;
}
