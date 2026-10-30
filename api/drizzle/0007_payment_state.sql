CREATE TYPE "public"."payment_status" AS ENUM('not_collected', 'pending', 'paid', 'failed', 'refunded');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "payment_status" "payment_status" DEFAULT 'not_collected' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "payment_provider" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "payment_provider_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_payment_provider_ref_key" ON "bookings" USING btree ("payment_provider","payment_provider_ref");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_payment_reference" CHECK ("bookings"."payment_status" = 'not_collected' or ("bookings"."payment_provider" is not null and "bookings"."payment_provider_ref" is not null));