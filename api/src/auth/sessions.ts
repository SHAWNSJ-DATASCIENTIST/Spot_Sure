import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { sessions, users } from "../db/schema.js";

export interface AuthUser {
  id: string;
  role: "driver" | "parking_owner";
  isPlatformAdmin: boolean;
  sessionId: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a session and returns the raw token. Only its hash is stored. */
export async function createSession(
  db: Database,
  userId: string,
  ttlHours: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  // Opportunistic cleanup of this user's expired sessions.
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lte(sessions.expiresAt, new Date())));
  return { token, expiresAt };
}

/** Resolves a token to an active user, or null if unknown, expired or the account is not active. */
export async function resolveSession(db: Database, token: string): Promise<AuthUser | null> {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      id: users.id,
      role: users.role,
      isPlatformAdmin: users.isPlatformAdmin,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row || row.status !== "active") return null;
  return { id: row.id, role: row.role, isPlatformAdmin: row.isPlatformAdmin, sessionId: row.sessionId };
}

/**
 * Deletes whatever session a presented cookie token refers to, valid or not.
 * Called before issuing a new session on sign-in, so a token that existed
 * before authentication (planted or stale) is never carried across it.
 */
export async function revokeToken(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function deleteSession(db: Database, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function deleteAllSessions(db: Database, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
