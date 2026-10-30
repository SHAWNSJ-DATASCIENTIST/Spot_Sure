import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { societyAdmins, users } from "../db/schema.js";

export type User = typeof users.$inferSelect;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(db: Database, email: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(sql`lower(${users.email})`, normaliseEmail(email)) });
}

export async function getUser(db: Database, id: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

/** Returns undefined when the email is already registered. */
export async function insertUser(
  db: Database,
  input: { displayName: string; email: string; passwordHash: string; role: User["role"] },
): Promise<User | undefined> {
  const [row] = await db
    .insert(users)
    .values({ ...input, email: normaliseEmail(input.email), status: "active" })
    .onConflictDoNothing()
    .returning();
  return row;
}

export async function updateUser(
  db: Database,
  id: string,
  patch: Partial<Pick<User, "displayName" | "phone">>,
): Promise<User> {
  const [row] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
  return row!;
}

export async function administeredSocietyIds(db: Database, userId: string): Promise<string[]> {
  const rows = await db.select({ id: societyAdmins.societyId }).from(societyAdmins).where(eq(societyAdmins.userId, userId));
  return rows.map((r) => r.id);
}

/** The only shape in which a user leaves the API. Never includes the password hash. */
export function presentUser(u: User, extra: { administeredSocietyIds: string[] }) {
  return {
    id: u.id,
    fullName: u.displayName,
    email: u.email,
    phone: u.phone,
    role: u.role,
    status: u.status,
    emailVerified: u.emailVerifiedAt !== null,
    isPlatformAdmin: u.isPlatformAdmin,
    administeredSocietyIds: extra.administeredSocietyIds,
    createdAt: u.createdAt.toISOString(),
  };
}
