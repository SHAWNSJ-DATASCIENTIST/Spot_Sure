import type { OwnerListing } from "../app/types";

// Shared test data. Clearly fake; never real customer records.

export function listing(over: Partial<OwnerListing> = {}): OwnerListing {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    societyId: null,
    name: "Owner Lot",
    description: null,
    parkingType: "private_driveway",
    address: { line: "1 Test Road", locality: "Altinho", city: "Panaji", region: "Goa", postalCode: null, countryCode: "IN" },
    location: null,
    vehicleTypes: ["car"],
    maxDimensionsCm: { height: null, length: null, width: null },
    capacity: 3,
    bays: [],
    hourlyPrice: { amountMinor: 4000, currency: "INR" },
    dailyPrice: null,
    bookingMinutes: { min: 60, max: null },
    availability: null,
    entryInstructions: null,
    parkingRules: null,
    accessibilityInfo: null,
    restrictions: null,
    photos: [],
    status: "published",
    verified: true,
    verifiedAt: "2026-10-01T00:00:00.000Z",
    lastReview: null,
    publiclyVisible: true,
    bookability: { bookable: false, reasons: ["Booking isn't available in SpotSure yet"] },
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}
