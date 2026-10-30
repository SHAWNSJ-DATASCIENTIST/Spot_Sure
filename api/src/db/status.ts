import { readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { migrationsFolder } from "./migrate.js";

export interface MigrationStatus {
  expected: number;
  applied: number;
}

/** Compares migrations shipped with the code to those recorded in the DB. */
export async function getMigrationStatus(db: Database): Promise<MigrationStatus> {
  const journal = JSON.parse(await readFile(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")) as {
    entries: unknown[];
  };
  const exists = await db.execute<{ present: boolean }>(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
  );
  let applied = 0;
  if (exists.rows[0]?.present) {
    const res = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    applied = res.rows[0]?.n ?? 0;
  }
  return { expected: journal.entries.length, applied };
}
