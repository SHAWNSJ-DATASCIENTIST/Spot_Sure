CREATE TYPE "public"."bay_status" AS ENUM('active', 'maintenance', 'retired');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('pending', 'confirmed', 'active', 'completed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."device_status" AS ENUM('provisioned', 'online', 'offline', 'faulty', 'retired');--> statement-breakpoint
CREATE TYPE "public"."device_type" AS ENUM('wifi_bay_sensor', 'camera', 'gateway');--> statement-breakpoint
CREATE TYPE "public"."event_processing_status" AS ENUM('received', 'validated', 'rejected', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'processing', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('draft', 'active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."occupancy_observation" AS ENUM('available', 'occupied', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."occupancy_source" AS ENUM('hardware', 'video', 'manual');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'active', 'suspended', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."verification_method" AS ENUM('document_review', 'site_visit', 'hardware_reading', 'video_analysis', 'manual_review');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'verified', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."verified_entity_type" AS ENUM('user', 'parking_space', 'parking_bay', 'society', 'hardware_device', 'booking');--> statement-breakpoint
CREATE TYPE "public"."video_source_type" AS ENUM('cctv_stream', 'uploaded_recording');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"bay_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "booking_status" DEFAULT 'pending' NOT NULL,
	"hourly_price_minor_snapshot" integer NOT NULL,
	"total_price_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_time_order" CHECK ("bookings"."ends_at" > "bookings"."starts_at"),
	CONSTRAINT "bookings_price_nonneg" CHECK ("bookings"."total_price_minor" >= 0 and "bookings"."hourly_price_minor_snapshot" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hardware_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"type" "device_type" NOT NULL,
	"space_id" uuid,
	"bay_id" uuid,
	"status" "device_status" DEFAULT 'provisioned' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parking_bays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"label" text NOT NULL,
	"status" "bay_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parking_occupancy_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"bay_id" uuid,
	"source" "occupancy_source" NOT NULL,
	"observation" "occupancy_observation" NOT NULL,
	"confidence" real,
	"observed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" uuid,
	"video_job_id" uuid,
	"source_event_id" text,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processing_status" "event_processing_status" DEFAULT 'received' NOT NULL,
	CONSTRAINT "occupancy_events_confidence_range" CHECK ("parking_occupancy_events"."confidence" is null or ("parking_occupancy_events"."confidence" >= 0 and "parking_occupancy_events"."confidence" <= 1)),
	CONSTRAINT "occupancy_events_source_reference" CHECK (("parking_occupancy_events"."source" <> 'hardware' or "parking_occupancy_events"."device_id" is not null) and ("parking_occupancy_events"."source" <> 'video' or "parking_occupancy_events"."video_job_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "parking_spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"society_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"address_line" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"country_code" text DEFAULT 'IN' NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"hourly_price_minor" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" "listing_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parking_spaces_price_nonneg" CHECK ("parking_spaces"."hourly_price_minor" >= 0),
	CONSTRAINT "parking_spaces_lat_range" CHECK ("parking_spaces"."latitude" between -90 and 90),
	CONSTRAINT "parking_spaces_lng_range" CHECK ("parking_spaces"."longitude" between -180 and 180),
	CONSTRAINT "parking_spaces_currency_iso" CHECK ("parking_spaces"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "societies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address_line" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"country_code" text DEFAULT 'IN' NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"access_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"phone" text,
	"status" "user_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "verified_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"method" "verification_method" NOT NULL,
	"status" "verification_status" DEFAULT 'pending' NOT NULL,
	"evidence_ref" text,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_analysis_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" "video_source_type" NOT NULL,
	"source_ref" text NOT NULL,
	"space_id" uuid,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"detection_summary" jsonb,
	"processing_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_analysis_jobs_summary_only_when_completed" CHECK ("video_analysis_jobs"."detection_summary" is null or "video_analysis_jobs"."status" = 'completed')
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_space_id_parking_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."parking_spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_bay_id_parking_bays_id_fk" FOREIGN KEY ("bay_id") REFERENCES "public"."parking_bays"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hardware_devices" ADD CONSTRAINT "hardware_devices_space_id_parking_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."parking_spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hardware_devices" ADD CONSTRAINT "hardware_devices_bay_id_parking_bays_id_fk" FOREIGN KEY ("bay_id") REFERENCES "public"."parking_bays"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_bays" ADD CONSTRAINT "parking_bays_space_id_parking_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."parking_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_occupancy_events" ADD CONSTRAINT "parking_occupancy_events_space_id_parking_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."parking_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_occupancy_events" ADD CONSTRAINT "parking_occupancy_events_bay_id_parking_bays_id_fk" FOREIGN KEY ("bay_id") REFERENCES "public"."parking_bays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_occupancy_events" ADD CONSTRAINT "parking_occupancy_events_device_id_hardware_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."hardware_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_occupancy_events" ADD CONSTRAINT "parking_occupancy_events_video_job_id_video_analysis_jobs_id_fk" FOREIGN KEY ("video_job_id") REFERENCES "public"."video_analysis_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD CONSTRAINT "parking_spaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD CONSTRAINT "parking_spaces_society_id_societies_id_fk" FOREIGN KEY ("society_id") REFERENCES "public"."societies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_records" ADD CONSTRAINT "verification_records_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_analysis_jobs" ADD CONSTRAINT "video_analysis_jobs_space_id_parking_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."parking_spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_user_idx" ON "bookings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bookings_bay_idx" ON "bookings" USING btree ("bay_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hardware_devices_external_id_key" ON "hardware_devices" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "parking_bays_space_label_key" ON "parking_bays" USING btree ("space_id","label");--> statement-breakpoint
CREATE INDEX "occupancy_events_bay_time_idx" ON "parking_occupancy_events" USING btree ("bay_id","observed_at");--> statement-breakpoint
CREATE INDEX "occupancy_events_space_time_idx" ON "parking_occupancy_events" USING btree ("space_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "occupancy_events_source_dedupe_key" ON "parking_occupancy_events" USING btree ("source","source_event_id");--> statement-breakpoint
CREATE INDEX "parking_spaces_owner_idx" ON "parking_spaces" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "parking_spaces_status_idx" ON "parking_spaces" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_key" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "verification_records_entity_idx" ON "verification_records" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "video_analysis_jobs_status_idx" ON "video_analysis_jobs" USING btree ("status");