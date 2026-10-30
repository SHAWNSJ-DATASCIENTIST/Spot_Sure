import type { OccupancyEventInput } from "../domain/occupancy.js";

/**
 * Server-side ingestion of Wi-Fi bay-sensor events written to Firebase.
 * Implementations translate raw device payloads into the normalised
 * occupancy contract; storage and dedupe happen in the occupancy repository.
 */
export interface HardwareEventSource {
  readonly name: "firebase";
  /** Translate one raw device payload. Returns null for payloads to drop (e.g. heartbeats). */
  normalise(raw: unknown): OccupancyEventInput | null;
  /** Begin streaming new events to the handler; resolves to an unsubscribe function. */
  subscribe(handler: (event: OccupancyEventInput) => Promise<void>): Promise<() => Promise<void>>;
}
