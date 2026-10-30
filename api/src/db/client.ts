import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  /** Round-trips a trivial query; throws if the database is unreachable. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

export function createDb(connectionString: string, opts: { max?: number; statementTimeoutMs?: number } = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString,
    max: opts.max ?? 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    // A runaway query or a lock wait can't hold a connection (and a request)
    // forever; Postgres cancels it and the API answers 503. Migrations pass 0.
    statement_timeout: opts.statementTimeoutMs ?? 15_000,
    idle_in_transaction_session_timeout: 30_000,
  });
  // An idle client erroring (e.g. DB restart) must not crash the process;
  // the next query will reconnect or surface the error to the caller.
  pool.on("error", () => {});

  let closed = false;
  return {
    db: drizzle(pool, { schema }),
    pool,
    async ping() {
      await pool.query("select 1");
    },
    async close() {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}
