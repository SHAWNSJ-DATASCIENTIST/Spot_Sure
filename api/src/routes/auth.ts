import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { burnPasswordCheck, hashPassword, passwordSchema, verifyPassword } from "../auth/password.js";
import { clearSessionCookie, presentedSessionToken, requireAuth, setSessionCookie } from "../auth/plugin.js";
import { createSession, deleteSession, revokeToken } from "../auth/sessions.js";
import { AppError } from "../http/errors.js";
import { parse } from "../http/validate.js";
import { administeredSocietyIds, findUserByEmail, getUser, insertUser, presentUser } from "../repositories/users.js";

const email = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email("Enter a valid email address"))
  .transform((e) => e.toLowerCase());

// strict(): unknown keys such as "isPlatformAdmin" or "status" are rejected
// outright, so identity and privilege can never be set from the request.
const registerBody = z
  .object({
    fullName: z.string().trim().min(2, "Enter your full name").max(100),
    email,
    password: passwordSchema,
    passwordConfirmation: z.string(),
    // Only self-service account types. Society and platform administration
    // are granted separately by platform staff.
    role: z.enum(["driver", "parking_owner"]).default("driver"),
  })
  .strict()
  .refine((b) => b.password === b.passwordConfirmation, {
    path: ["passwordConfirmation"],
    message: "Passwords do not match",
  })
  .refine((b) => b.password.toLowerCase() !== b.email, { path: ["password"], message: "Password must not be your email" });

const loginBody = z
  .object({
    email,
    // No policy checks on login: a length cap only, to bound hashing cost.
    password: z.string().min(1, "Enter your password").max(1024),
  })
  .strict();

const INVALID_CREDENTIALS = () => new AppError(401, "invalid_credentials", "Email or password is incorrect");

export async function authRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const db = deps.db.db;
  const { env } = deps;
  // Session rotation: whatever session the browser presented is revoked before
  // a new one is issued, so identity never carries over a pre-existing token.
  async function issueSession(req: FastifyRequest, reply: FastifyReply, userId: string) {
    const presented = presentedSessionToken(req, env);
    if (presented) await revokeToken(db, presented);
    const session = await createSession(db, userId, env.SESSION_TTL_HOURS);
    setSessionCookie(reply, env, session.token, session.expiresAt);
  }

  const authLimit = { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: env.AUTH_RATE_LIMIT_WINDOW_MS } };

  app.post("/auth/register", { config: authLimit }, async (req, reply) => {
    const body = parse(registerBody, req.body);
    const passwordHash = await hashPassword(body.password);
    const user = await insertUser(db, { displayName: body.fullName, email: body.email, passwordHash, role: body.role });
    if (!user) {
      // Deliberately does not say "already registered". Full enumeration
      // resistance needs email delivery (see docs/architecture.md).
      throw new AppError(409, "registration_unavailable", "We couldn't create an account with these details. If you already have one, sign in instead.");
    }
    await issueSession(req, reply, user.id);
    req.log.info({ userId: user.id }, "User registered");
    return reply.status(201).send({ data: presentUser(user, { administeredSocietyIds: [] }) });
  });

  app.post("/auth/login", { config: authLimit }, async (req, reply) => {
    const body = parse(loginBody, req.body);
    const user = await findUserByEmail(db, body.email);
    if (!user?.passwordHash) {
      await burnPasswordCheck(body.password);
      throw INVALID_CREDENTIALS();
    }
    if (!(await verifyPassword(user.passwordHash, body.password))) throw INVALID_CREDENTIALS();
    if (user.status !== "active") {
      throw new AppError(403, "account_unavailable", "This account is not active. Contact support.");
    }
    await issueSession(req, reply, user.id);
    req.log.info({ userId: user.id }, "User signed in");
    return { data: presentUser(user, { administeredSocietyIds: await administeredSocietyIds(db, user.id) }) };
  });

  app.post("/auth/logout", async (req, reply) => {
    if (req.auth) await deleteSession(db, req.auth.sessionId);
    clearSessionCookie(reply, env);
    return reply.status(204).send();
  });

  app.get("/auth/me", async (req) => {
    const auth = requireAuth(req);
    const user = await getUser(db, auth.id);
    if (!user) throw new AppError(401, "unauthenticated", "Sign in required");
    return { data: presentUser(user, { administeredSocietyIds: await administeredSocietyIds(db, user.id) }) };
  });
}
