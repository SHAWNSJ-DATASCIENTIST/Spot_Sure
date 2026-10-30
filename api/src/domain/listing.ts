// Listing lifecycle and visibility rules. Routes call these; nothing else
// decides status transitions or what drivers may see.
//
//   draft ──submit──▶ pending_verification ──(staff approve)──▶ published
//     ▲                    │ withdraw / (staff reject)              │ unpublish
//     └────────────────────┘                                        ▼
//   any ──archive──▶ archived ──restore──▶ draft | unpublished    unpublished ──publish──▶ published
//
// Status alone never makes a listing bookable: see bookability().

export const LISTING_STATUSES = ["draft", "pending_verification", "published", "unpublished", "archived"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const PARKING_TYPES = ["private_driveway", "covered", "open", "garage", "commercial", "other"] as const;
export const VEHICLE_CLASSES = ["motorcycle", "car", "suv", "van", "light_truck"] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export const OWNER_ACTIONS = ["submit", "withdraw", "publish", "unpublish", "archive", "restore"] as const;
export type OwnerAction = (typeof OWNER_ACTIONS)[number];

export const MAX_CAPACITY = 500;
export const MAX_PHOTOS = 10;

export class TransitionError extends Error {
  constructor(
    public readonly code: "invalid_transition" | "needs_verification" | "incomplete_listing",
    message: string,
    public readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

export interface ListingFacts {
  status: ListingStatus;
  verified: boolean;
  name: string;
  city: string | null;
  locality: string | null;
  addressLine: string | null;
  vehicleTypes: readonly VehicleClass[];
  activeBays: number;
  hoursWindows: number;
  /** The owner's account is active (not suspended or deactivated). */
  ownerActive: boolean;
}

/** What an owner must fill in before staff can review a listing. */
export function completenessIssues(l: ListingFacts): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (!l.addressLine) issues.push({ path: "addressLine", message: "Add the street address" });
  if (!l.locality) issues.push({ path: "locality", message: "Add the locality or neighbourhood" });
  if (!l.city) issues.push({ path: "city", message: "Add the city" });
  if (!l.vehicleTypes.length) issues.push({ path: "vehicleTypes", message: "Choose at least one vehicle type" });
  if (l.activeBays < 1) issues.push({ path: "capacity", message: "Capacity must be at least 1" });
  if (l.hoursWindows < 1) issues.push({ path: "hours", message: "Set opening hours" });
  return issues;
}

/** The status an owner action leads to, or a TransitionError explaining why not. */
export function applyOwnerAction(l: ListingFacts, action: OwnerAction): ListingStatus {
  const bad = () => new TransitionError("invalid_transition", `Can't ${action} a listing that is ${l.status.replace("_", " ")}`);
  switch (action) {
    case "submit": {
      // From unpublished too: a listing that lost its verification (moved, or
      // migrated from the old "paused" status) must be able to go back to review.
      if (l.status !== "draft" && l.status !== "unpublished") throw bad();
      const issues = completenessIssues(l);
      if (issues.length) throw new TransitionError("incomplete_listing", "Complete the listing before submitting it", issues);
      // A listing already verified (e.g. restored from the archive) goes straight back out.
      return l.verified ? "published" : "pending_verification";
    }
    case "withdraw":
      if (l.status !== "pending_verification") throw bad();
      return "draft";
    case "publish":
      if (l.status !== "unpublished") throw bad();
      if (!l.verified) {
        throw new TransitionError("needs_verification", "This listing needs to be verified again. Submit it for review.");
      }
      return "published";
    case "unpublish":
      if (l.status !== "published") throw bad();
      return "unpublished";
    case "archive":
      if (l.status === "archived") throw bad();
      return "archived";
    case "restore":
      if (l.status !== "archived") throw bad();
      return l.verified ? "unpublished" : "draft";
  }
}

/** Drivers can see a listing only when it is published, verified and its owner is active. */
export function isPubliclyVisible(l: Pick<ListingFacts, "status" | "verified" | "ownerActive">): boolean {
  return l.status === "published" && l.verified && l.ownerActive;
}

/**
 * Whether the future booking engine may accept bookings. Kept separate from
 * status so that flipping a status can never make a listing bookable on its own.
 */
export function bookability(l: ListingFacts): { bookable: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (l.status !== "published") reasons.push("Not published");
  if (!l.verified) reasons.push("Not verified by SpotSure");
  if (l.activeBays < 1) reasons.push("No active spaces");
  if (l.hoursWindows < 1) reasons.push("No opening hours");
  if (!l.ownerActive) reasons.push("The owner's account isn't active");
  return { bookable: reasons.length === 0, reasons };
}

/** Fields whose change invalidates a previous verification. */
export const LOCATION_FIELDS = [
  "addressLine",
  "locality",
  "city",
  "region",
  "postalCode",
  "latitude",
  "longitude",
  "parkingType",
] as const;

/** Rounds coordinates for public display (~1 km), so private addresses can't be pinpointed. */
export function approximateLocation(lat: number | null, lng: number | null): { latitude: number; longitude: number } | null {
  if (lat == null || lng == null) return null;
  return { latitude: Math.round(lat * 100) / 100, longitude: Math.round(lng * 100) / 100 };
}
