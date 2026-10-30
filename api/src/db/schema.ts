import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Concepts that must never be conflated (see docs/architecture.md):
//   occupancy_observation -> what a sensor/camera physically saw
//   booking_status        -> the commercial reservation lifecycle
//   verification_status   -> whether an entity/claim has been checked
//   confidence            -> ML model confidence for one observation only
// Access authorisation and trust/fraud risk are not stored here yet; they are
// derived later and get their own tables when they exist.

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const userStatus = pgEnum("user_status", ["pending", "active", "suspended", "deactivated"]);
// Primary account type, chosen at registration from a server-side allow-list.
// Society administration and platform administration are separate grants
// (society_admins, users.is_platform_admin), never values of this column.
export const userRole = pgEnum("user_role", ["driver", "parking_owner"]);
// published = visible to drivers; it still needs verification and active bays
// to be bookable (see domain/listing.ts). Archived listings keep their history.
export const listingStatus = pgEnum("listing_status", [
  "draft",
  "pending_verification",
  "published",
  "unpublished",
  "archived",
]);
export const parkingType = pgEnum("parking_type", [
  "private_driveway",
  "covered",
  "open",
  "garage",
  "commercial",
  "other",
]);
export const vehicleClass = pgEnum("vehicle_class", ["motorcycle", "car", "suv", "van", "light_truck"]);
export const weekday = pgEnum("weekday", ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export const bayStatus = pgEnum("bay_status", ["active", "maintenance", "retired"]);
export const bookingStatus = pgEnum("booking_status", [
  "pending",
  "confirmed",
  "active",
  "completed",
  "cancelled",
  "expired",
]);
export const bookingParty = pgEnum("booking_party", ["driver", "owner"]);
// Separate from booking_status: confirmed is not paid. See domain/payment.ts.
export const paymentStatus = pgEnum("payment_status", ["not_collected", "pending", "paid", "failed", "refunded"]);
export const occupancySource = pgEnum("occupancy_source", ["hardware", "video", "manual"]);
export const occupancyObservation = pgEnum("occupancy_observation", ["available", "occupied", "unknown"]);
export const eventProcessingStatus = pgEnum("event_processing_status", [
  "received",
  "validated",
  "rejected",
  "duplicate",
]);
export const deviceType = pgEnum("device_type", ["wifi_bay_sensor", "camera", "gateway"]);
export const deviceStatus = pgEnum("device_status", ["provisioned", "online", "offline", "faulty", "retired"]);
export const videoSourceType = pgEnum("video_source_type", ["cctv_stream", "uploaded_recording"]);
export const jobStatus = pgEnum("job_status", ["queued", "processing", "completed", "failed", "cancelled"]);
export const verifiedEntityType = pgEnum("verified_entity_type", [
  "user",
  "parking_space",
  "parking_bay",
  "society",
  "hardware_device",
  "booking",
]);
export const verificationMethod = pgEnum("verification_method", [
  "document_review",
  "site_visit",
  "hardware_reading",
  "video_analysis",
  "manual_review",
]);
export const verificationStatus = pgEnum("verification_status", ["pending", "verified", "rejected", "expired"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    status: userStatus("status").notNull().default("pending"),
    role: userRole("role").notNull().default("driver"),
    // Argon2id PHC string. Null for accounts without a password (none yet).
    passwordHash: text("password_hash"),
    // Null until a verification email has actually been confirmed.
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    // Internal staff only. No API can set this; see scripts/grant-platform-admin.ts.
    isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    // Case-insensitive uniqueness; email is optional (phone-only sign-up).
    uniqueIndex("users_email_lower_key").on(sql`lower(${t.email})`),
    uniqueIndex("users_phone_key").on(t.phone),
  ],
);

export const societies = pgTable("societies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  addressLine: text("address_line"),
  city: text("city"),
  region: text("region"),
  postalCode: text("postal_code"),
  countryCode: text("country_code").notNull().default("IN"),
  latitude: numeric("latitude", { precision: 9, scale: 6, mode: "number" }),
  longitude: numeric("longitude", { precision: 9, scale: 6, mode: "number" }),
  // e.g. { visitorHours: "08:00-22:00", requiresGuardApproval: true }
  accessRules: jsonb("access_rules").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const parkingSpaces = pgTable(
  "parking_spaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    societyId: uuid("society_id").references(() => societies.id, { onDelete: "set null" }),
    // Listing title (column kept as "name").
    name: text("name").notNull(),
    description: text("description"),
    parkingType: parkingType("parking_type").notNull().default("other"),
    // Exact street address: owner (and, later, confirmed bookers) only, never public.
    addressLine: text("address_line"),
    locality: text("locality"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    countryCode: text("country_code").notNull().default("IN"),
    latitude: numeric("latitude", { precision: 9, scale: 6, mode: "number" }),
    longitude: numeric("longitude", { precision: 9, scale: 6, mode: "number" }),
    // Vehicle size limits in centimetres; null = no stated limit.
    maxHeightCm: smallint("max_height_cm"),
    maxLengthCm: smallint("max_length_cm"),
    maxWidthCm: smallint("max_width_cm"),
    // Money is stored in minor units (paise) to avoid float rounding.
    hourlyPriceMinor: integer("hourly_price_minor").notNull(),
    dailyPriceMinor: integer("daily_price_minor"),
    currency: text("currency").notNull().default("INR"),
    minBookingMinutes: integer("min_booking_minutes").notNull().default(60),
    maxBookingMinutes: integer("max_booking_minutes"),
    // IANA zone the weekly hours (parking_space_hours) are expressed in.
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    // Private: shown to the owner (and, later, confirmed bookers), never publicly.
    entryInstructions: text("entry_instructions"),
    parkingRules: text("parking_rules"),
    accessibilityInfo: text("accessibility_info"),
    restrictions: text("restrictions"),
    status: listingStatus("status").notNull().default("draft"),
    // Set when platform staff approve the listing; cleared when its location changes.
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("parking_spaces_owner_idx").on(t.ownerId),
    index("parking_spaces_status_idx").on(t.status),
    check("parking_spaces_price_nonneg", sql`${t.hourlyPriceMinor} >= 0`),
    check("parking_spaces_daily_price_nonneg", sql`${t.dailyPriceMinor} is null or ${t.dailyPriceMinor} >= 0`),
    check("parking_spaces_lat_range", sql`${t.latitude} between -90 and 90`),
    check("parking_spaces_lng_range", sql`${t.longitude} between -180 and 180`),
    check("parking_spaces_currency_iso", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "parking_spaces_booking_minutes",
      sql`${t.minBookingMinutes} between 15 and 43200 and (${t.maxBookingMinutes} is null or ${t.maxBookingMinutes} between ${t.minBookingMinutes} and 43200)`,
    ),
    check(
      "parking_spaces_dimensions",
      sql`(${t.maxHeightCm} is null or ${t.maxHeightCm} between 100 and 600) and (${t.maxLengthCm} is null or ${t.maxLengthCm} between 150 and 2000) and (${t.maxWidthCm} is null or ${t.maxWidthCm} between 80 and 400)`,
    ),
  ],
);

export const parkingSpaceVehicleTypes = pgTable(
  "parking_space_vehicle_types",
  {
    spaceId: uuid("space_id")
      .notNull()
      .references(() => parkingSpaces.id, { onDelete: "cascade" }),
    vehicleClass: vehicleClass("vehicle_class").notNull(),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.vehicleClass] })],
);

// Weekly opening windows, in parking_spaces.timezone.
export const parkingSpaceHours = pgTable(
  "parking_space_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => parkingSpaces.id, { onDelete: "cascade" }),
    day: weekday("day").notNull(),
    opens: time("opens").notNull(),
    closes: time("closes").notNull(),
  },
  (t) => [
    index("parking_space_hours_space_idx").on(t.spaceId),
    uniqueIndex("parking_space_hours_window_key").on(t.spaceId, t.day, t.opens),
    check("parking_space_hours_order", sql`${t.closes} > ${t.opens}`),
  ],
);

// Image bytes live in object storage; only a server-generated key is stored here.
export const parkingSpacePhotos = pgTable(
  "parking_space_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => parkingSpaces.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    position: integer("position").notNull().default(0),
    isCover: boolean("is_cover").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("parking_space_photos_space_idx").on(t.spaceId),
    uniqueIndex("parking_space_photos_storage_key").on(t.storageKey),
    // At most one cover image per listing.
    uniqueIndex("parking_space_photos_one_cover").on(t.spaceId).where(sql`${t.isCover}`),
    check("parking_space_photos_type", sql`${t.contentType} in ('image/jpeg', 'image/png')`),
  ],
);

// A space has one or more bays; bookings and occupancy are per bay.
export const parkingBays = pgTable(
  "parking_bays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => parkingSpaces.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    status: bayStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [uniqueIndex("parking_bays_space_label_key").on(t.spaceId, t.label)],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => parkingSpaces.id, { onDelete: "restrict" }),
    bayId: uuid("bay_id")
      .notNull()
      .references(() => parkingBays.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: bookingStatus("status").notNull().default("pending"),
    // Price snapshot taken at booking time; later listing price changes must
    // not alter what the user agreed to pay.
    hourlyPriceMinorSnapshot: integer("hourly_price_minor_snapshot").notNull(),
    totalPriceMinor: integer("total_price_minor").notNull(),
    currency: text("currency").notNull(),
    // Who ended the booking, when status is cancelled.
    cancelledBy: bookingParty("cancelled_by"),
    // No provider is integrated and no route writes these, so every booking
    // stays "not_collected". Any other status needs a provider reference (DB check).
    paymentStatus: paymentStatus("payment_status").notNull().default("not_collected"),
    paymentProvider: text("payment_provider"),
    paymentProviderRef: text("payment_provider_ref"),
    ...timestamps,
  },
  (t) => [
    index("bookings_user_idx").on(t.userId),
    index("bookings_bay_idx").on(t.bayId),
    index("bookings_space_time_idx").on(t.spaceId, t.startsAt),
    check("bookings_time_order", sql`${t.endsAt} > ${t.startsAt}`),
    check("bookings_price_nonneg", sql`${t.totalPriceMinor} >= 0 and ${t.hourlyPriceMinorSnapshot} >= 0`),
    check(
      "bookings_payment_reference",
      sql`${t.paymentStatus} = 'not_collected' or (${t.paymentProvider} is not null and ${t.paymentProviderRef} is not null)`,
    ),
    uniqueIndex("bookings_payment_provider_ref_key").on(t.paymentProvider, t.paymentProviderRef),
    // The no-overlap EXCLUDE constraint lives in a hand-written migration
    // (drizzle cannot express it): see drizzle/0001_booking_no_overlap.sql.
  ],
);

export const hardwareDevices = pgTable(
  "hardware_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Identifier the device reports itself as (e.g. MAC or Firebase node key).
    externalId: text("external_id").notNull(),
    type: deviceType("type").notNull(),
    spaceId: uuid("space_id").references(() => parkingSpaces.id, { onDelete: "set null" }),
    bayId: uuid("bay_id").references(() => parkingBays.id, { onDelete: "set null" }),
    status: deviceStatus("status").notNull().default("provisioned"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    // Non-secret configuration only (firmware version, sampling interval).
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [uniqueIndex("hardware_devices_external_id_key").on(t.externalId)],
);

export const videoAnalysisJobs = pgTable(
  "video_analysis_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceType: videoSourceType("source_type").notNull(),
    // Opaque storage key or stream id, never a URL with embedded credentials.
    sourceRef: text("source_ref").notNull(),
    spaceId: uuid("space_id").references(() => parkingSpaces.id, { onDelete: "set null" }),
    status: jobStatus("status").notNull().default("queued"),
    // Only populated from a real model run; null until the job completes.
    detectionSummary: jsonb("detection_summary").$type<Record<string, unknown>>(),
    processingMetadata: jsonb("processing_metadata").$type<Record<string, unknown>>().notNull().default({}),
    errorMessage: text("error_message"),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("video_analysis_jobs_status_idx").on(t.status),
    check(
      "video_analysis_jobs_summary_only_when_completed",
      sql`${t.detectionSummary} is null or ${t.status} = 'completed'`,
    ),
  ],
);

export const parkingOccupancyEvents = pgTable(
  "parking_occupancy_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => parkingSpaces.id, { onDelete: "cascade" }),
    bayId: uuid("bay_id").references(() => parkingBays.id, { onDelete: "cascade" }),
    source: occupancySource("source").notNull(),
    observation: occupancyObservation("observation").notNull(),
    confidence: real("confidence"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    deviceId: uuid("device_id").references(() => hardwareDevices.id, { onDelete: "set null" }),
    videoJobId: uuid("video_job_id").references(() => videoAnalysisJobs.id, { onDelete: "set null" }),
    // Producer-assigned id used for idempotent ingestion.
    sourceEventId: text("source_event_id"),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
    processingStatus: eventProcessingStatus("processing_status").notNull().default("received"),
  },
  (t) => [
    index("occupancy_events_bay_time_idx").on(t.bayId, t.observedAt),
    index("occupancy_events_space_time_idx").on(t.spaceId, t.observedAt),
    uniqueIndex("occupancy_events_source_dedupe_key").on(t.source, t.sourceEventId),
    check("occupancy_events_confidence_range", sql`${t.confidence} is null or (${t.confidence} >= 0 and ${t.confidence} <= 1)`),
    check(
      "occupancy_events_source_reference",
      sql`(${t.source} <> 'hardware' or ${t.deviceId} is not null) and (${t.source} <> 'video' or ${t.videoJobId} is not null)`,
    ),
  ],
);

export const verificationRecords = pgTable(
  "verification_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: verifiedEntityType("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    method: verificationMethod("method").notNull(),
    status: verificationStatus("status").notNull().default("pending"),
    // Pointer to private storage, not the evidence itself.
    evidenceRef: text("evidence_ref"),
    verifiedBy: uuid("verified_by").references(() => users.id, { onDelete: "set null" }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("verification_records_entity_idx").on(t.entityType, t.entityId)],
);

// Server-side browser sessions. Only a SHA-256 of the cookie token is stored,
// so a database leak does not yield usable session cookies.
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("sessions_token_hash_key").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

// Explicit, per-society administrator grants. Assigned by platform admins only.
export const societyAdmins = pgTable(
  "society_admins",
  {
    societyId: uuid("society_id")
      .notNull()
      .references(() => societies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.societyId, t.userId] }), index("society_admins_user_idx").on(t.userId)],
);

// In-app notifications. Written in the same transaction as the business event
// that causes them, so a failed or rolled-back action never notifies anyone.
// The message is display text only: never addresses, entry instructions,
// payment data, tokens or the other party's identity.
export const notificationType = pgEnum("notification_type", [
  "booking_requested",
  "booking_request_received",
  "booking_confirmed",
  "booking_declined",
  "booking_cancelled",
  "booking_expired",
  "booking_reminder",
  "listing_approved",
  "listing_changes_requested",
]);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationType("type").notNull(),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
    spaceId: uuid("space_id").references(() => parkingSpaces.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    // One notification per recipient per event, so retries never duplicate.
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notifications_recipient_dedupe_key").on(t.recipientId, t.dedupeKey),
    index("notifications_recipient_created_idx").on(t.recipientId, t.createdAt, t.id),
    index("notifications_recipient_unread_idx").on(t.recipientId).where(sql`${t.readAt} is null`),
    check("notifications_message_length", sql`char_length(${t.message}) between 1 and 300`),
  ],
);
