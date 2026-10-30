import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { societyAdmins } from "../db/schema.js";
import { AppError } from "../http/errors.js";
import type { AuthUser } from "./sessions.js";

// Server-side authorisation rules. Routes call these after loading the
// resource, so every check is made against stored ownership, never against
// ids or roles supplied in the request.
//
// Status conventions: 401 not signed in; 403 signed in but not allowed to act
// on a resource whose existence is not private (listings, societies); 404 for
// private resources the user may not see (bookings), so ids cannot be probed.

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do this") {
    super(403, "forbidden", message);
  }
}

export function assertRole(user: AuthUser, role: AuthUser["role"]): void {
  if (user.role !== role) throw new ForbiddenError(`Requires the ${role.replace("_", " ")} role`);
}

export function assertPlatformAdmin(user: AuthUser): void {
  if (!user.isPlatformAdmin) throw new ForbiddenError();
}

export function assertOwnsSpace(user: AuthUser, space: { ownerId: string }): void {
  if (space.ownerId !== user.id) throw new ForbiddenError("You can only manage parking spaces you own");
}

/** The booker and the owner of the booked space may see a booking. */
export function canViewBooking(user: AuthUser, booking: { userId: string }, spaceOwnerId: string): boolean {
  return booking.userId === user.id || spaceOwnerId === user.id;
}

export async function isSocietyAdmin(db: Database, user: AuthUser, societyId: string): Promise<boolean> {
  const row = await db.query.societyAdmins.findFirst({
    where: and(eq(societyAdmins.societyId, societyId), eq(societyAdmins.userId, user.id)),
    columns: { userId: true },
  });
  return Boolean(row);
}

/** Society admins of this society, or platform admins. */
export async function assertCanAdministerSociety(db: Database, user: AuthUser, societyId: string): Promise<void> {
  if (user.isPlatformAdmin) return;
  if (!(await isSocietyAdmin(db, user, societyId))) {
    throw new ForbiddenError("You are not an administrator of this society");
  }
}
