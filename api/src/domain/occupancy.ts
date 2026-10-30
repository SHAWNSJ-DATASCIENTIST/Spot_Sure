import { z } from "zod";

// Normalised contract every occupancy producer (Wi-Fi hardware via Firebase,
// YOLO video analysis, manual verification) is translated into before storage.
//
// An observation says only what was physically seen in a bay. It says nothing
// about whether that vehicle has a booking, is authorised to be there, or is
// trustworthy; those are separate concepts with separate data.

export const OCCUPANCY_SOURCES = ["hardware", "video", "manual"] as const;
export const OCCUPANCY_OBSERVATIONS = ["available", "occupied", "unknown"] as const;
export const EVENT_PROCESSING_STATUSES = ["received", "validated", "rejected", "duplicate"] as const;

export type OccupancySource = (typeof OCCUPANCY_SOURCES)[number];
export type OccupancyObservation = (typeof OCCUPANCY_OBSERVATIONS)[number];

/** How far in the future an observation timestamp may be (clock skew). */
export const MAX_CLOCK_SKEW_MS = 2 * 60_000;

const base = {
  spaceId: z.uuid(),
  bayId: z.uuid().optional(),
  observation: z.enum(OCCUPANCY_OBSERVATIONS),
  /** Model or sensor confidence for this single observation, 0..1. */
  confidence: z.number().min(0).max(1).optional(),
  observedAt: z.coerce.date(),
  /** Producer-assigned id; used to drop duplicate deliveries. */
  sourceEventId: z.string().trim().min(1).max(200).optional(),
  /** Free-form, non-secret context: firmware version, model name, frame index. */
  provenance: z.record(z.string(), z.unknown()).default({}),
};

export const occupancyEventInputSchema = z
  .discriminatedUnion("source", [
    z.object({ ...base, source: z.literal("hardware"), deviceId: z.uuid() }),
    z.object({ ...base, source: z.literal("video"), videoJobId: z.uuid() }),
    // Manual verification by a person; confidence is not meaningful there.
    z.object({ ...base, source: z.literal("manual"), confidence: z.undefined().optional() }),
  ])
  .superRefine((event, ctx) => {
    if (event.observedAt.getTime() > Date.now() + MAX_CLOCK_SKEW_MS) {
      ctx.addIssue({ code: "custom", path: ["observedAt"], message: "observedAt is in the future" });
    }
  });

export type OccupancyEventInput = z.infer<typeof occupancyEventInputSchema>;
