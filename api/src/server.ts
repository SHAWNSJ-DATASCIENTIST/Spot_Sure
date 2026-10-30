import "dotenv/config";
import { readFileSync } from "node:fs";
import { buildApp } from "./app.js";
import { EnvValidationError, loadEnv } from "./config/env.js";
import { createDb } from "./db/client.js";
import { buildIntegrations } from "./integrations/index.js";

let env;
try {
  env = loadEnv();
} catch (err) {
  if (err instanceof EnvValidationError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const db = createDb(env.DATABASE_URL, { max: env.DATABASE_POOL_MAX });
const app = await buildApp({ env, db, integrations: buildIntegrations(env), version });

// Legal but usually wrong in production: say so loudly at startup.
if (env.NODE_ENV === "production") {
  if (!env.TRUST_PROXY) {
    app.log.warn(
      "TRUST_PROXY is false: behind a proxy every client shares one IP, so rate limits (incl. login) apply to all users together",
    );
  }
  if (!env.WEB_DIST_DIR) app.log.warn("WEB_DIST_DIR is not set: only the API is served, not the web app");
  if (!env.PHOTO_STORAGE_DIR) app.log.warn("PHOTO_STORAGE_DIR is not set: listing photo uploads will answer 503");
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Shutting down");
  // Stops accepting connections, drains in-flight requests, then closes the DB pool (onClose hook).
  const force = setTimeout(() => {
    app.log.error("Shutdown timed out; exiting");
    process.exit(1);
  }, 10_000);
  force.unref();
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "Error during shutdown");
    process.exit(1);
  }
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (err) {
  app.log.error({ err }, "Failed to start");
  await db.close();
  process.exit(1);
}
