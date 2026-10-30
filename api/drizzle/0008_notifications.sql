CREATE TYPE "public"."notification_type" AS ENUM('booking_requested', 'booking_request_received', 'booking_confirmed', 'booking_declined', 'booking_cancelled', 'booking_expired', 'booking_reminder', 'listing_approved', 'listing_changes_requested');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"booking_id" uuid,
	"space_id" uuid,
	"message" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_message_length" CHECK (char_length("notifications"."message") between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_space_id_parking_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."parking_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_recipient_dedupe_key" ON "notifications" USING btree ("recipient_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_idx" ON "notifications" USING btree ("recipient_id","created_at","id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_unread_idx" ON "notifications" USING btree ("recipient_id") WHERE "notifications"."read_at" is null;