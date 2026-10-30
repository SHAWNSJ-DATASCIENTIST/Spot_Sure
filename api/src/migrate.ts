// Applies pending migrations from ../drizzle to DATABASE_URL, then exits.
//   development: npm run db:migrate        (tsx, via scripts/migrate.ts)
//   production:  npm run db:migrate:prod   (node dist/migrate.js; no dev dependencies needed)
import "dotenv/config";
import { EnvValidationError, loadEnv } from "./config/env.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";

let env;
try {
  env = loadEnv();
} catch (err) {
  if (!(err instanceof EnvValidationError)) throw err;
  console.error(err.message);
  process.exit(1);
}
// No statement timeout: a migration may legitimately run longer than a request.
const handle = createDb(env.DATABASE_URL, { max: 1, statementTimeoutMs: 0 });
try {
  await runMigrations(handle.db);
  console.log("Migrations applied.");
} finally {
  await handle.close();
}
