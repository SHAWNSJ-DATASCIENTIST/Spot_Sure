// Read-only smoke test for a running SpotSure deployment. Creates no data.
//   SMOKE_BASE_URL=https://spotsure.example npm run smoke
// Exits non-zero on the first failed check.

const base = (process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const origin = process.env.SMOKE_ORIGIN ?? base;
let failed = 0;

async function check(name: string, run: () => Promise<string | true>) {
  try {
    const result = await run();
    if (result === true) console.log(`ok    ${name}`);
    else {
      failed++;
      console.log(`FAIL  ${name}: ${result}`);
    }
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}: ${(err as Error).message}`);
  }
}

await check("health", async () => {
  const r = await fetch(`${base}/api/v1/health`);
  return r.status === 200 || `status ${r.status}`;
});

await check("ready (database + migrations)", async () => {
  const r = await fetch(`${base}/api/v1/ready`);
  const body = (await r.json()) as { status: string; checks: unknown };
  return r.status === 200 || `status ${r.status} ${JSON.stringify(body.checks)}`;
});

await check("web app shell served on a client route", async () => {
  const r = await fetch(`${base}/app/driver`);
  const html = await r.text();
  return (r.status === 200 && html.includes('id="root"')) || `status ${r.status}`;
});

await check("public listings endpoint", async () => {
  const r = await fetch(`${base}/api/v1/parking-spaces?pageSize=1`);
  return r.status === 200 || `status ${r.status}`;
});

await check("auth rejects bad credentials without revealing accounts", async () => {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email: "smoke-test@spotsure.invalid", password: "not-a-real-password" }),
  });
  const body = (await r.json()) as { error?: { code?: string } };
  return (r.status === 401 && body.error?.code === "invalid_credentials") || `status ${r.status} ${body.error?.code}`;
});

await check("cross-site writes are refused", async () => {
  const r = await fetch(`${base}/api/v1/auth/logout`, { method: "POST", headers: { origin: "https://evil.example" } });
  return r.status === 403 || `status ${r.status}`;
});

await check("protected API needs a session", async () => {
  const r = await fetch(`${base}/api/v1/me/bookings`);
  return r.status === 401 || `status ${r.status}`;
});

if (base.startsWith("https://")) {
  await check("HSTS header present", async () => {
    const r = await fetch(`${base}/api/v1/health`);
    return Boolean(r.headers.get("strict-transport-security")) || "missing";
  });
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll smoke checks passed");
process.exit(failed ? 1 : 0);
