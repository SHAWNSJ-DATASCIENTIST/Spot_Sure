// Runs a real PostgreSQL 17 server for local development without Docker,
// using the binaries shipped by the embedded-postgres package. Data persists
// in api/.pgdata across restarts. Creates the `spotsure` and `spotsure_test`
// databases on first run. Stop with Ctrl+C.
//
// Prefer `docker compose up -d db` when Docker is available; both listen on
// the same port with the same credentials, so DATABASE_URL is identical.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const port = Number(process.env.DEV_DB_PORT ?? 5433);
const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".pgdata");
const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));

const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  port,
  user: "spotsure",
  password: "spotsure",
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
});

if (fresh) await server.initialise();
await server.start();

const admin = new pg.Client({ connectionString: `postgres://spotsure:spotsure@localhost:${port}/postgres` });
await admin.connect();
for (const name of ["spotsure", "spotsure_test"]) {
  const { rowCount } = await admin.query("select 1 from pg_database where datname = $1", [name]);
  if (!rowCount) await admin.query(`create database ${name}`);
}
await admin.end();

console.log(`PostgreSQL ready on localhost:${port} (data: ${dataDir})`);
console.log(`  DATABASE_URL=postgres://spotsure:spotsure@localhost:${port}/spotsure`);
console.log(`  TEST_DATABASE_URL=postgres://spotsure:spotsure@localhost:${port}/spotsure_test`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.stop();
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
