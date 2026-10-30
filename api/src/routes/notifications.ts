import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { requireAuth } from "../auth/plugin.js";
import { decodeCursor, NOTIFICATION_PAGE_DEFAULT, NOTIFICATION_PAGE_MAX } from "../domain/notification.js";
import { AppError, NotFoundError } from "../http/errors.js";
import { parse } from "../http/validate.js";
import {
  ensureReminders,
  listNotifications,
  markAllRead,
  markRead,
  presentNotification,
  unreadCount,
} from "../repositories/notifications.js";

const listQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(NOTIFICATION_PAGE_MAX).default(NOTIFICATION_PAGE_DEFAULT),
    cursor: z.string().max(200).optional(),
    unread: z.enum(["true", "false"]).optional(),
  })
  .strict();

const idParams = z.object({ id: z.uuid() });

// The recipient is always the signed-in user; no route accepts a user id.
// Another user's notification id answers 404, the same as a missing one.
export async function notificationRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const db = deps.db.db;

  app.get("/me/notifications", async (req) => {
    const auth = requireAuth(req);
    const q = parse(listQuery, req.query);
    const before = q.cursor ? decodeCursor(q.cursor) : undefined;
    if (before === null) throw new AppError(400, "invalid_cursor", "That page link is no longer valid; reload the list");
    await ensureReminders(db, auth.id);
    const { page, nextCursor } = await listNotifications(db, auth.id, { limit: q.limit, before, unreadOnly: q.unread === "true" });
    return { data: page.map(presentNotification), nextCursor, unreadCount: await unreadCount(db, auth.id) };
  });

  // Cheap poll for the shell's badge; also where due reminders appear.
  app.get("/me/notifications/unread-count", async (req) => {
    const auth = requireAuth(req);
    await ensureReminders(db, auth.id);
    return { data: { unreadCount: await unreadCount(db, auth.id) } };
  });

  app.post("/me/notifications/:id/read", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const row = await markRead(db, auth.id, id);
    if (!row) throw new NotFoundError("Notification");
    return { data: presentNotification(row), unreadCount: await unreadCount(db, auth.id) };
  });

  app.post("/me/notifications/read-all", async (req) => {
    const auth = requireAuth(req);
    const marked = await markAllRead(db, auth.id);
    return { data: { marked, unreadCount: 0 } };
  });
}
