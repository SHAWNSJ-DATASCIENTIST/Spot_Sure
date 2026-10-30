CREATE TYPE "public"."booking_party" AS ENUM('driver', 'owner');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancelled_by" "booking_party";--> statement-breakpoint
CREATE INDEX "bookings_space_time_idx" ON "bookings" USING btree ("space_id","starts_at");