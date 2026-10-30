import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sessionCookieSecure, type Env } from "../config/env.js";
import type { Database } from "../db/client.js";
import { AppError } from "../http/errors.js";
import { resolveSession, type AuthUser } from "./sessions.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set from the session cookie for every request; null when signed out. */
    auth: AuthUser | null;
  }
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function sessionCookieName(env: Env): string {
  // __Host- forces Secure, Path=/ and no Domain, so subdomains cannot overwrite it.
  return sessionCookieSecure(env) ? "__Host-ss_session" : "ss_session";
}

export function setSessionCookie(reply: FastifyReply, env: Env, token: string, expiresAt: Date): void {
  reply.setCookie(sessionCookieName(env), token, {
    httpOnly: true,
    secure: sessionCookieSecure(env),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, env: Env): void {
  reply.clearCookie(sessionCookieName(env), { path: "/", secure: sessionCookieSecure(env), sameSite: "lax", httpOnly: true });
}

export async function registerAuth(app: FastifyInstance, deps: { env: Env; db: Database }): Promise<void> {
  const { env, db } = deps;
  await app.register(cookie);
  app.decorateRequest("auth", null);

  // CSRF: cookies are SameSite=Lax and the API only accepts JSON bodies (no
  // form posts), and on top of that every state-changing request coming from a
  // browser must carry an allow-listed Origin. Non-browser clients send no
  // Origin and no ambient cookies, so they are unaffected.
  app.addHook("onRequest", async (req: FastifyRequest) => {
    if (!UNSAFE_METHODS.has(req.method)) return;
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!env.CORS_ORIGINS.includes(origin)) {
        throw new AppError(403, "origin_not_allowed", "Cross-origin request rejected");
      }
    } else if (req.headers["sec-fetch-site"] === "cross-site") {
      throw new AppError(403, "origin_not_allowed", "Cross-origin request rejected");
    }
  });

  app.addHook("onRequest", async (req: FastifyRequest) => {
    const token = presentedSessionToken(req, env);
    req.auth = token ? await resolveSession(db, token) : null;
  });
}

export function presentedSessionToken(req: FastifyRequest, env: Env): string | undefined {
  return req.cookies[sessionCookieName(env)] || undefined;
}

export function requireAuth(req: FastifyRequest): AuthUser {
  if (!req.auth) throw new AppError(401, "unauthenticated", "Sign in required");
  return req.auth;
}
