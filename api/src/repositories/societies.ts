import { and, asc, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { parkingBays, parkingSpaces, societies, societyAdmins } from "../db/schema.js";

export type Society = typeof societies.$inferSelect;
export type NewSociety = typeof societies.$inferInsert;

export async function getSociety(db: Database, id: string): Promise<Society | undefined> {
  return db.query.societies.findFirst({ where: eq(societies.id, id) });
}

export async function listSocietiesForAdmin(db: Database, userId: string): Promise<Society[]> {
  const rows = await db
    .select({ society: societies })
    .from(societyAdmins)
    .innerJoin(societies, eq(societies.id, societyAdmins.societyId))
    .where(eq(societyAdmins.userId, userId))
    .orderBy(asc(societies.name));
  return rows.map((r) => r.society);
}

/** Listing summaries inside a society, without owner identity or contact details. */
export async function listSocietySpaceSummaries(db: Database, societyId: string) {
  const rows = await db
    .select({ id: parkingSpaces.id, name: parkingSpaces.name, status: parkingSpaces.status, bayId: parkingBays.id })
    .from(parkingSpaces)
    .leftJoin(parkingBays, eq(parkingBays.spaceId, parkingSpaces.id))
    .where(eq(parkingSpaces.societyId, societyId))
    .orderBy(asc(parkingSpaces.name));
  const byId = new Map<string, { id: string; name: string; status: string; bayCount: number }>();
  for (const r of rows) {
    const s = byId.get(r.id) ?? { id: r.id, name: r.name, status: r.status, bayCount: 0 };
    if (r.bayId) s.bayCount++;
    byId.set(r.id, s);
  }
  return [...byId.values()];
}

export async function createSociety(db: Database, input: NewSociety): Promise<Society> {
  const [row] = await db.insert(societies).values(input).returning();
  return row!;
}

export async function updateSociety(
  db: Database,
  id: string,
  patch: Partial<Pick<Society, "name" | "accessRules">>,
): Promise<Society> {
  const [row] = await db.update(societies).set(patch).where(eq(societies.id, id)).returning();
  return row!;
}

export async function grantSocietyAdmin(db: Database, societyId: string, userId: string, grantedBy: string): Promise<void> {
  await db.insert(societyAdmins).values({ societyId, userId, grantedBy }).onConflictDoNothing();
}

export async function revokeSocietyAdmin(db: Database, societyId: string, userId: string): Promise<void> {
  await db.delete(societyAdmins).where(and(eq(societyAdmins.societyId, societyId), eq(societyAdmins.userId, userId)));
}

export function presentSociety(s: Society) {
  return {
    id: s.id,
    name: s.name,
    address: { line: s.addressLine, city: s.city, region: s.region, postalCode: s.postalCode, countryCode: s.countryCode },
    location: s.latitude != null && s.longitude != null ? { latitude: s.latitude, longitude: s.longitude } : null,
    accessRules: s.accessRules,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
