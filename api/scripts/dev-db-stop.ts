// Stops the server started by `npm run db:dev` if it was left running without
// its parent process (e.g. the terminal was closed). Fast shutdown: active
// connections are disconnected, data is flushed cleanly.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".pgdata");
if (!existsSync(path.join(dataDir, "postmaster.pid"))) {
  console.log("Dev database is not running.");
  process.exit(0);
}
// Platform packages are named e.g. windows-x64, darwin-arm64, linux-x64.
const platform = process.platform === "win32" ? "windows" : process.platform;
const { pg_ctl } = (await import(`@embedded-postgres/${platform}-${process.arch}`)) as { pg_ctl: string };
execFileSync(pg_ctl, ["stop", "-D", dataDir, "-m", "fast"], { stdio: "inherit" });
