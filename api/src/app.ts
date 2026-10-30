import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAuth } from "./auth/plugin.js";
import type { Env } from "./config/env.js";
import type { DbHandle } from "./db/client.js";
import { registerErrorHandling } from "./http/errors.js";
import type { Integrations } from "./integrations/index.js";
import { accountRoutes } from "./routes/account.js";
import { authRoutes } from "./routes/auth.js";
import { parkingSpaceRoutes } from "./routes/parkingSpaces.js";
import { societyRoutes } from "./routes/societies.js";
import { notificationRoutes } from "./routes/notifications.js";
import { systemRoutes } from "./routes/system.js";
import { buildPhotoStorage, type PhotoStorage } from "./storage/photos.js";

export interface AppDeps {
  env: Env;
  db: DbHandle;
  integrations: Integrations;
  version: string;
  photoStorage: PhotoStorage;
}

export async function buildApp(input: Omit<AppDeps, "photoStorage"> & { photoStorage?: PhotoStorage }): Promise<FastifyInstance> {
  const deps: AppDeps = { ...input, photoStorage: input.photoStorage ?? buildPhotoStorage(input.env) };
  const { env } = deps;
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Never log credentials or session material.
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]', "*.password", "*.passwordConfirmation", "*.passwordHash", "*.token"],
        censor: "[redacted]",
      },
    },
    bodyLimit: 1_048_576,
    // Drop clients that take too long to send a request (slow-loris). Long
    // enough for a 5 MB photo upload on a slow mobile link.
    requestTimeout: 60_000,
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: false,
    trustProxy: env.TRUST_PROXY,
  });

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
    if (req.url.startsWith("/api/")) {
      // API responses can carry personal data; never let shared caches keep them.
      reply.header("cache-control", "no-store");
    } else if (req.url.startsWith("/assets/")) {
      // Vite emits content-hashed file names, so these never change.
      reply.header("cache-control", "public, max-age=31536000, immutable");
    } else {
      // The app shell and other web files: always revalidate, so deploys show up.
      reply.header("cache-control", "no-cache");
    }
  });

  registerErrorHandling(app, { spa: Boolean(env.WEB_DIST_DIR) });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        // The web app loads its fonts from Google Fonts; everything else is same-origin.
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:"],
      },
    },
  });
  if (env.WEB_DIST_DIR) {
    // Cache headers are set in the onSend hook above, not by the plugin.
    await app.register(fastifyStatic, { root: path.resolve(env.WEB_DIST_DIR), wildcard: false, index: "index.html", cacheControl: false });
  }
  await app.register(cors, { origin: env.CORS_ORIGINS, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], credentials: true });
  await app.register(rateLimit, { max: env.RATE_LIMIT_MAX, timeWindow: env.RATE_LIMIT_WINDOW_MS });
  await registerAuth(app, { env, db: deps.db.db });

  await app.register(
    async (v1) => {
      await systemRoutes(v1, deps);
      await authRoutes(v1, deps);
      await accountRoutes(v1, deps);
      await notificationRoutes(v1, deps);
      await parkingSpaceRoutes(v1, deps);
      await societyRoutes(v1, deps);
    },
    { prefix: "/api/v1" },
  );

  app.addHook("onClose", async () => {
    await deps.db.close();
  });

  return app;
}
