import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { parkingBays, parkingOccupancyEvents } from "../db/schema.js";
import type { OccupancyEventInput } from "../domain/occupancy.js";
import { AppError } from "../http/errors.js";

export type OccupancyEvent = typeof parkingOccupancyEvents.$inferSelect;

/**
 * Stores one already-validated observation. Redelivery of the same
 * (source, sourceEventId) is idempotent: the original row is returned with
 * duplicate=true rather than storing a second copy.
 */
export async function recordOccupancyEvent(
  db: Database,
  input: OccupancyEventInput,
): Promise<{ event: OccupancyEvent; duplicate: boolean }> {
  if (input.bayId) {
    const bay = await db.query.parkingBays.findFirst({
      where: and(eq(parkingBays.id, input.bayId), eq(parkingBays.spaceId, input.spaceId)),
      columns: { id: true },
    });
    if (!bay) throw new AppError(422, "bay_space_mismatch", "bayId does not belong to spaceId");
  }

  const [inserted] = await db
    .insert(parkingOccupancyEvents)
    .values({
      spaceId: input.spaceId,
      bayId: input.bayId,
      source: input.source,
      observation: input.observation,
      confidence: input.confidence,
      observedAt: input.observedAt,
      deviceId: input.source === "hardware" ? input.deviceId : undefined,
      videoJobId: input.source === "video" ? input.videoJobId : undefined,
      sourceEventId: input.sourceEventId,
      provenance: input.provenance,
      processingStatus: "validated",
    })
    .onConflictDoNothing({ target: [parkingOccupancyEvents.source, parkingOccupancyEvents.sourceEventId] })
    .returning();

  if (inserted) return { event: inserted, duplicate: false };

  const existing = await db.query.parkingOccupancyEvents.findFirst({
    where: and(
      eq(parkingOccupancyEvents.source, input.source),
      eq(parkingOccupancyEvents.sourceEventId, input.sourceEventId!),
    ),
  });
  return { event: existing!, duplicate: true };
}
