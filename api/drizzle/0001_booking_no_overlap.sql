-- Two bookings that hold a bay (confirmed or active) may never overlap in time
-- for the same bay. Enforced by Postgres itself so concurrent requests cannot
-- both succeed: the second insert/update fails with SQLSTATE 23P01.
-- Ranges are half-open [starts_at, ends_at) so back-to-back bookings are allowed.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap_per_bay"
  EXCLUDE USING gist (
    "bay_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("status" IN ('confirmed', 'active'));
