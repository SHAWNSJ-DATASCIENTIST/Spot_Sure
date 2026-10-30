// Shapes returned by the SpotSure API (see api/src/routes).

export interface Money {
  amountMinor: number;
  currency: string;
}

export interface Address {
  line: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
}

export interface Booking {
  id: string;
  /** Present only when the viewer made the booking. */
  userId?: string;
  spaceId: string;
  spaceName: string;
  bayId: string;
  bayLabel: string;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  area?: { locality: string | null; city: string | null };
  cancelledBy?: "driver" | "owner" | null;
  price: { hourlyAmountMinor: number; totalAmountMinor: number; currency: string };
  /** Separate from `status`: a confirmed booking is not a paid one. No provider is integrated yet. */
  payment?: { status: PaymentStatus };
  /** Exact address and entry instructions: only for the booker, once confirmed. */
  privateAccess?: { address: string; entryInstructions: string | null } | null;
  createdAt: string;
}

export type BookingStatus = "pending" | "confirmed" | "active" | "completed" | "cancelled" | "expired";

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  pending: "Requested",
  confirmed: "Confirmed",
  active: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Expired",
};

export type PaymentStatus = "not_collected" | "pending" | "paid" | "failed" | "refunded";

/** Only "paid" may ever say paid, and only the server sets it (from a verified provider event). */
export const PAYMENT_STATUS_TEXT: Record<PaymentStatus, string> = {
  not_collected: "Not handled by SpotSure during the pilot. Nothing has been charged.",
  pending: "Payment started but not yet confirmed by the payment provider.",
  paid: "Paid through SpotSure.",
  failed: "The payment didn't go through.",
  refunded: "Refunded.",
};

export interface Availability {
  timezone: string;
  weekly: { day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"; opens: string; closes: string }[];
}

export type ListingStatus = "draft" | "pending_verification" | "published" | "unpublished" | "archived";
export type ParkingType = "private_driveway" | "covered" | "open" | "garage" | "commercial" | "other";
export type VehicleClass = "motorcycle" | "car" | "suv" | "van" | "light_truck";
export type OwnerAction = "submit" | "withdraw" | "publish" | "unpublish" | "archive" | "restore";

export const PARKING_TYPE_LABEL: Record<ParkingType, string> = {
  private_driveway: "Private driveway",
  covered: "Covered parking",
  open: "Open parking",
  garage: "Garage",
  commercial: "Commercial parking",
  other: "Other",
};
export const VEHICLE_LABEL: Record<VehicleClass, string> = {
  motorcycle: "Motorcycle / scooter",
  car: "Car",
  suv: "SUV",
  van: "Van",
  light_truck: "Light truck",
};
export const STATUS_LABEL: Record<ListingStatus, string> = {
  draft: "Draft",
  pending_verification: "In review",
  published: "Published",
  unpublished: "Unpublished",
  archived: "Archived",
};

interface ListingCommon {
  id: string;
  name: string;
  description: string | null;
  parkingType: ParkingType;
  vehicleTypes: VehicleClass[];
  maxDimensionsCm: { height: number | null; length: number | null; width: number | null };
  capacity: number;
  hourlyPrice: Money;
  dailyPrice: Money | null;
  bookingMinutes: { min: number; max: number | null };
  availability: Availability | null;
  parkingRules: string | null;
  accessibilityInfo: string | null;
  restrictions: string | null;
}

/** The full listing, as only its owner sees it. */
export interface OwnerListing extends ListingCommon {
  societyId: string | null;
  address: Address & { locality: string | null };
  location: { latitude: number; longitude: number } | null;
  bays: { id: string; label: string; status: string }[];
  entryInstructions: string | null;
  photos: { id: string; url: string; isCover: boolean; contentType: string; byteSize: number }[];
  status: ListingStatus;
  verified: boolean;
  verifiedAt: string | null;
  lastReview: { status: string; notes: string | null; at: string | null } | null;
  publiclyVisible: boolean;
  bookability: { bookable: boolean; reasons: string[] };
  createdAt: string;
  updatedAt: string;
}

/** What drivers see: no street address, exact location or entry instructions. */
export interface PublicListing extends ListingCommon {
  area: { locality: string | null; city: string | null; region: string | null; countryCode: string };
  approximateLocation: { latitude: number; longitude: number } | null;
  photos: { id: string; url: string; isCover: boolean }[];
}

export interface OwnerListingSummary {
  id: string;
  name: string;
  parkingType: ParkingType;
  address: { line: string | null; locality: string | null; city: string | null; region: string | null };
  hourlyPrice: Money;
  capacity: number;
  status: ListingStatus;
  verified: boolean;
  coverPhotoUrl: string | null;
  updatedAt: string;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Society {
  id: string;
  name: string;
  address: Address;
  location: { latitude: number; longitude: number } | null;
  accessRules: { visitorHours?: string; requiresGuardApproval?: boolean; residentsOnly?: boolean; notes?: string };
  createdAt: string;
  updatedAt: string;
}

export interface SocietySpaceSummary {
  id: string;
  name: string;
  status: ListingStatus;
  bayCount: number;
}

/** Bookings that still lie ahead and hold or may hold a bay. */
export function isUpcoming(b: Booking, now = Date.now()): boolean {
  return new Date(b.endsAt).getTime() > now && ["pending", "confirmed", "active"].includes(b.status);
}
