import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { requireAuth } from "../auth/plugin.js";
import { assertCanAdministerSociety, assertPlatformAdmin } from "../auth/policies.js";
import { AppError, NotFoundError } from "../http/errors.js";
import { parse } from "../http/validate.js";
import {
  createSociety,
  getSociety,
  listSocietySpaceSummaries,
  grantSocietyAdmin,
  presentSociety,
  revokeSocietyAdmin,
  updateSociety,
} from "../repositories/societies.js";
import { getUser } from "../repositories/users.js";

const idParams = z.object({ id: z.uuid() });
const grantParams = z.object({ id: z.uuid(), userId: z.uuid() });

// Access rules are structured data the society admin edits, not code.
const accessRules = z
  .object({
    visitorHours: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM-HH:MM")
      .optional(),
    requiresGuardApproval: z.boolean().optional(),
    residentsOnly: z.boolean().optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict();

const societyPatch = z.object({ name: z.string().trim().min(2).max(120).optional(), accessRules: accessRules.optional() }).strict();

const societyCreate = z
  .object({
    name: z.string().trim().min(2).max(120),
    addressLine: z.string().trim().max(200).optional(),
    city: z.string().trim().max(100).optional(),
    region: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().max(20).optional(),
    accessRules: accessRules.default({}),
  })
  .strict();

export async function societyRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const db = deps.db.db;

  async function load(id: string) {
    const society = await getSociety(db, id);
    if (!society) throw new NotFoundError("Society");
    return society;
  }

  app.get("/societies/:id", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const society = await load(id);
    await assertCanAdministerSociety(db, auth, id);
    return { data: presentSociety(society) };
  });

  app.get("/societies/:id/parking-spaces", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(idParams, req.params);
    await load(id);
    await assertCanAdministerSociety(db, auth, id);
    return { data: await listSocietySpaceSummaries(db, id) };
  });

  app.patch("/societies/:id", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const body = parse(societyPatch, req.body);
    await load(id);
    await assertCanAdministerSociety(db, auth, id);
    return { data: presentSociety(await updateSociety(db, id, body)) };
  });

  // Platform administration: internal staff only, kept apart from society admin.
  app.post("/admin/societies", async (req, reply) => {
    const auth = requireAuth(req);
    assertPlatformAdmin(auth);
    const body = parse(societyCreate, req.body);
    return reply.status(201).send({ data: presentSociety(await createSociety(db, body)) });
  });

  app.put("/admin/societies/:id/admins/:userId", async (req, reply) => {
    const auth = requireAuth(req);
    assertPlatformAdmin(auth);
    const { id, userId } = parse(grantParams, req.params);
    await load(id);
    if (!(await getUser(db, userId))) throw new AppError(404, "not_found", "User not found");
    await grantSocietyAdmin(db, id, userId, auth.id);
    return reply.status(204).send();
  });

  app.delete("/admin/societies/:id/admins/:userId", async (req, reply) => {
    const auth = requireAuth(req);
    assertPlatformAdmin(auth);
    const { id, userId } = parse(grantParams, req.params);
    await revokeSocietyAdmin(db, id, userId);
    return reply.status(204).send();
  });
}
