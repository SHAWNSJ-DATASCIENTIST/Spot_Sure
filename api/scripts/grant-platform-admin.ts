// Grants (or with --revoke, removes) internal platform-admin access for an
// existing account. Deliberately a CLI run by someone with database access:
// no HTTP endpoint can make anyone a platform admin.
//   npm run admin:grant -- someone@example.com [--revoke]
import "dotenv/config";
import { eq } from "drizzle-orm";
import { EnvValidationError, loadEnv } from "../src/config/env.js";
import { createDb } from "../src/db/client.js";
import { users } from "../src/db/schema.js";
import { findUserByEmail } from "../src/repositories/users.js";
import { deleteAllSessions } from "../src/auth/sessions.js";

const email = process.argv[2];
const revoke = process.argv.includes("--revoke");
if (!email || email.startsWith("--")) {
  console.error("Usage: npm run admin:grant -- <email> [--revoke]");
  process.exit(1);
}

let env;
try {
  env = loadEnv();
} catch (err) {
  if (!(err instanceof EnvValidationError)) throw err;
  console.error(err.message);
  process.exit(1);
}

const handle = createDb(env.DATABASE_URL, { max: 1 });
try {
  const user = await findUserByEmail(handle.db, email);
  if (!user) {
    console.error("No account with that email.");
    process.exitCode = 1;
  } else {
    await handle.db.update(users).set({ isPlatformAdmin: !revoke }).where(eq(users.id, user.id));
    // Privileges are read live on every request, but any privilege change still
    // ends existing sessions so the user re-authenticates into the new role.
    await deleteAllSessions(handle.db, user.id);
    console.log(`${revoke ? "Revoked" : "Granted"} platform admin for ${user.id}.`);
  }
} finally {
  await handle.close();
}
