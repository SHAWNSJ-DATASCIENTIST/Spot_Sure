import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { parkingSpaces } from "../db/schema.js";

// Low-level row access. Listing behaviour (validation, lifecycle, bays, hours,
// photos, presentation) lives in repositories/listings.ts.

export type ParkingSpace = typeof parkingSpaces.$inferSelect;
export type NewParkingSpace = typeof parkingSpaces.$inferInsert;

export async function createParkingSpace(db: Database, input: NewParkingSpace): Promise<ParkingSpace> {
  const [row] = await db.insert(parkingSpaces).values(input).returning();
  return row!;
}

export async function getParkingSpace(db: Database, id: string): Promise<ParkingSpace | undefined> {
  return db.query.parkingSpaces.findFirst({ where: eq(parkingSpaces.id, id) });
}
