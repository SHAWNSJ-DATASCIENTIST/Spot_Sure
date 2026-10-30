-- Hand-edited: move weekly hours out of the availability JSON column into the
-- relational parking_space_hours table (and the zone into parking_spaces.timezone)
-- before dropping the column, so no owner-entered hours are lost.
UPDATE "parking_spaces"
SET "timezone" = "availability"->>'timezone'
WHERE "availability" IS NOT NULL AND coalesce("availability"->>'timezone', '') <> '';--> statement-breakpoint
INSERT INTO "parking_space_hours" ("space_id", "day", "opens", "closes")
SELECT s."id", (w->>'day')::"weekday", (w->>'opens')::time, (w->>'closes')::time
FROM "parking_spaces" s, jsonb_array_elements(s."availability"->'weekly') AS w
WHERE s."availability" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "parking_spaces" DROP COLUMN "availability";
