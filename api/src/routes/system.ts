import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import { getMigrationStatus } from "../db/status.js";
import { liveChargesEnabled } from "../domain/payment.js";

const startedAt = new Date();

export async function systemRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get("/", async () => ({
    name: "spotsure-api",
    version: deps.version,
    apiVersion: "v1",
  }));

  // Liveness: the process is up and serving. Deliberately does not touch the DB,
  // so an orchestrator does not restart a healthy process during a DB outage.
  app.get("/health", async () => ({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    startedAt: startedAt.toISOString(),
  }));

  // Readiness: can this instance serve real traffic right now?
  app.get("/ready", async (_req, reply) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      await deps.db.ping();
      checks.database = { ok: true };
    } catch {
      checks.database = { ok: false, detail: "unreachable" };
    }

    if (checks.database.ok) {
      try {
        const m = await getMigrationStatus(deps.db.db);
        checks.migrations =
          m.applied >= m.expected
            ? { ok: true, detail: `${m.applied}/${m.expected} applied` }
            : { ok: false, detail: `${m.applied}/${m.expected} applied; run npm run db:migrate` };
      } catch {
        checks.migrations = { ok: false, detail: "could not read migration state" };
      }
    } else {
      checks.migrations = { ok: false, detail: "skipped: database unreachable" };
    }

    const ready = Object.values(checks).every((c) => c.ok);
    return reply.status(ready ? 200 : 503).send({
      status: ready ? "ready" : "not_ready",
      checks,
      // Optional integrations do not gate readiness; reported for visibility.
      integrations: deps.integrations.status(),
      payments: { provider: deps.env.PAYMENTS_PROVIDER, liveCharges: liveChargesEnabled(deps.env.PAYMENTS_PROVIDER) },
    });
  });
}
