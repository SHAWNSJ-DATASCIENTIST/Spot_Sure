CREATE TYPE "public"."parking_type" AS ENUM('private_driveway', 'covered', 'open', 'garage', 'commercial', 'other');--> statement-breakpoint
CREATE TYPE "public"."vehicle_class" AS ENUM('motorcycle', 'car', 'suv', 'van', 'light_truck');--> statement-breakpoint
CREATE TYPE "public"."weekday" AS ENUM('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun');--> statement-breakpoint
CREATE TABLE "parking_space_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"day" "weekday" NOT NULL,
	"opens" time NOT NULL,
	"closes" time NOT NULL,
	CONSTRAINT "parking_space_hours_order" CHECK ("parking_space_hours"."closes" > "parking_space_hours"."opens")
);
--> statement-breakpoint
CREATE TABLE "parking_space_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_cover" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parking_space_photos_type" CHECK ("parking_space_photos"."content_type" in ('image/jpeg', 'image/png'))
);
--> statement-breakpoint
CREATE TABLE "parking_space_vehicle_types" (
	"space_id" uuid NOT NULL,
	"vehicle_class" "vehicle_class" NOT NULL,
	CONSTRAINT "parking_space_vehicle_types_space_id_vehicle_class_pk" PRIMARY KEY("space_id","vehicle_class")
);
--> statement-breakpoint
-- Hand-edited: map old statuses explicitly instead of a plain cast.
--   paused -> unpublished
--   active -> pending_verification: these were public before verification
--             existed, so they must be approved before drivers see them again.
ALTER TABLE "parking_spaces" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "parking_spaces" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."listing_status";--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('draft', 'pending_verification', 'published', 'unpublished', 'archived');--> statement-breakpoint
ALTER TABLE "parking_spaces" ALTER COLUMN "status" SET DATA TYPE "public"."listing_status" USING (CASE "status" WHEN 'active' THEN 'pending_verification' WHEN 'paused' THEN 'unpublished' ELSE "status" END)::"public"."listing_status";--> statement-breakpoint
ALTER TABLE "parking_spaces" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."listing_status";--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD COLUMN "parking_type" "parking_type" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD COLUMN "locality" text;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD COLUMN "max_height_cm" smallint;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD COLUMN "max_length_cm" smallint;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD COLUMN "max_width_cm" smallint;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD COLUMN "daily_price_minor" integer;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD COLUMN "min_booking_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD COLUMN "max_booking_minutes" integer;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD COLUMN "timezone" text DEFAULT 'Asia/Kolkata' NOT NULL;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD COLUMN "entry_instructions" text;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD COLUMN "parking_rules" text;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD COLUMN "accessibility_info" text;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD COLUMN "restrictions" text;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parking_space_hours" ADD CONSTRAINT "parking_space_hours_space_id_parking_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."parking_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_space_photos" ADD CONSTRAINT "parking_space_photos_space_id_parking_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."parking_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_space_vehicle_types" ADD CONSTRAINT "parking_space_vehicle_types_space_id_parking_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."parking_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parking_space_hours_space_idx" ON "parking_space_hours" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "parking_space_hours_window_key" ON "parking_space_hours" USING btree ("space_id","day","opens");--> statement-breakpoint
CREATE INDEX "parking_space_photos_space_idx" ON "parking_space_photos" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "parking_space_photos_storage_key" ON "parking_space_photos" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "parking_space_photos_one_cover" ON "parking_space_photos" USING btree ("space_id") WHERE "parking_space_photos"."is_cover";--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD CONSTRAINT "parking_spaces_daily_price_nonneg" CHECK ("parking_spaces"."daily_price_minor" is null or "parking_spaces"."daily_price_minor" >= 0);--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD CONSTRAINT "parking_spaces_booking_minutes" CHECK ("parking_spaces"."min_booking_minutes" between 15 and 43200 and ("parking_spaces"."max_booking_minutes" is null or "parking_spaces"."max_booking_minutes" between "parking_spaces"."min_booking_minutes" and 43200));--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD CONSTRAINT "parking_spaces_dimensions" CHECK (("parking_spaces"."max_height_cm" is null or "parking_spaces"."max_height_cm" between 100 and 600) and ("parking_spaces"."max_length_cm" is null or "parking_spaces"."max_length_cm" between 150 and 2000) and ("parking_spaces"."max_width_cm" is null or "parking_spaces"."max_width_cm" between 80 and 400));