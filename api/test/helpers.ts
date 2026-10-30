import "dotenv/config";
import { sql } from "drizzle-orm";
import { loadEnv, type Env } from "../src/config/env.js";
import type { DbHandle } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: "postgres://u:p@localhost:5433/unused",
    ...overrides,
  });
}

/** A DbHandle with no database behind it, for HTTP-layer tests. */
export function unreachableDb(): DbHandle {
  return {
    db: undefined as never,
    pool: undefined as never,
    ping: async () => {
      throw new Error("connect ECONNREFUSED");
    },
    close: async () => {},
  };
}

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/** Drops and recreates the test schema, then applies all migrations. */
export async function resetTestDatabase(handle: DbHandle): Promise<void> {
  const url = new URL(testDatabaseUrl!);
  if (!url.pathname.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL must point at a database whose name ends in _test; tests drop its schema");
  }
  await handle.db.execute(sql`drop schema if exists public cascade`);
  await handle.db.execute(sql`drop schema if exists drizzle cascade`);
  await handle.db.execute(sql`create schema public`);
  await runMigrations(handle.db);
}
