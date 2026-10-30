import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDb } from "../src/db/client.js";
import { AppError, IntegrationNotConfiguredError } from "../src/http/errors.js";
import { buildIntegrations } from "../src/integrations/index.js";
import { testEnv, unreachableDb } from "./helpers.js";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function make(envOverrides: Record<string, string> = {}) {
  const env = testEnv(envOverrides);
  app = await buildApp({ env, db: unreachableDb(), integrations: buildIntegrations(env), version: "0.0.0-test" });
  return app;
}

describe("system endpoints", () => {
  it("GET /api/v1/health reports liveness without touching the database", async () => {
    const res = await (await make()).inject("/api/v1/health");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("GET /api/v1 returns API info", async () => {
    const res = await (await make()).inject("/api/v1");
    expect(res.json()).toEqual({ name: "spotsure-api", version: "0.0.0-test", apiVersion: "v1" });
  });

  it("GET /api/v1/ready is 503 when the database is unreachable", async () => {
    const res = await (await make()).inject("/api/v1/ready");
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe("not_ready");
    expect(body.checks.database).toEqual({ ok: false, detail: "unreachable" });
    expect(body.integrations).toEqual({
      firebase: "not_configured",
      yolo: "not_configured",
      tigergraph: "not_configured",
      web3: "not_configured",
    });
  });

  it("never reports a configured integration as connected", async () => {
    const res = await (await make({ YOLO_SERVICE_URL: "http://localhost:9000" })).inject("/api/v1/ready");
    expect(res.json().integrations.yolo).toBe("configured_not_implemented");
  });
});

describe("error responses", () => {
  it("uses the standard shape for unknown routes", async () => {
    const res = await (await make()).inject("/api/v1/nope?x=1");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: "route_not_found", message: "No route for GET /api/v1/nope", requestId: expect.any(String) },
    });
  });

  it("returns 400 with field details for invalid query and path params", async () => {
    const a = await make();
    const bad = await a.inject("/api/v1/parking-spaces?pageSize=500&bogus=1");
    expect(bad.statusCode).toBe(400);
    const err = bad.json().error;
    expect(err.code).toBe("validation_failed");
    expect(err.details.map((d: { path: string }) => d.path).sort()).toEqual(["", "pageSize"].sort());

    const badId = await a.inject("/api/v1/parking-spaces/not-a-uuid");
    expect(badId.statusCode).toBe(400);
    expect(badId.json().error.details[0].path).toBe("id");
  });

  it("returns 400 for malformed JSON bodies", async () => {
    const a = await make();
    a.post("/api/v1/_echo", async (req) => req.body);
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/_echo",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.requestId).toBeTruthy();
  });

  it("hides internal error details behind a generic 500", async () => {
    const a = await make();
    a.get("/api/v1/_boom", async () => {
      throw new Error('relation "secret_table" does not exist');
    });
    const res = await a.inject("/api/v1/_boom");
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatchObject({ code: "internal_error", message: "Internal server error" });
    expect(res.body).not.toContain("secret_table");
  });

  it("maps AppError and unconfigured integrations to their status codes", async () => {
    const a = await make();
    a.get("/api/v1/_conflict", async () => {
      throw new AppError(409, "conflict", "Already exists");
    });
    a.get("/api/v1/_yolo", async () => {
      throw new IntegrationNotConfiguredError("YOLO");
    });
    expect((await a.inject("/api/v1/_conflict")).json().error).toMatchObject({ code: "conflict" });
    const y = await a.inject("/api/v1/_yolo");
    expect(y.statusCode).toBe(503);
    expect(y.json().error.code).toBe("integration_not_configured");
  });

  it("answers 503 without internals when the database is down or a query is cancelled", async () => {
    const env = testEnv();
    // Nothing listens on port 1: every query fails with ECONNREFUSED.
    const down = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
    app = await buildApp({ env, db: down, integrations: buildIntegrations(env), version: "0.0.0-test" });
    app.get("/api/v1/_slow_query", async () => {
      throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    });
    const res = await app.inject("/api/v1/parking-spaces");
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("service_unavailable");
    expect(res.body).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|postgres/i);

    const busy = await app.inject("/api/v1/_slow_query");
    expect(busy.statusCode).toBe(503);
    expect(busy.json().error.code).toBe("busy");
    expect(busy.body).not.toContain("statement timeout");
  });

  it("sets a request timeout so slow clients can't hold connections open", async () => {
    const a = await make();
    await a.ready();
    expect(a.server.requestTimeout).toBe(60_000);
  });

  it("rate limits with a 429 in the standard shape", async () => {
    const a = await make({ RATE_LIMIT_MAX: "2" });
    await a.inject("/api/v1/health");
    await a.inject("/api/v1/health");
    const res = await a.inject("/api/v1/health");
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("rate_limited");
  });
});

describe("integration boundaries", () => {
  it("refuse to produce results when not configured", async () => {
    const i = buildIntegrations(testEnv());
    await expect(async () => i.yolo.submit({ jobId: "j", sourceType: "uploaded_recording", sourceRef: "k" })).rejects.toThrow(
      IntegrationNotConfiguredError,
    );
    await expect(async () => i.tigergraph.assess({ type: "user", id: "u" })).rejects.toThrow(IntegrationNotConfiguredError);
    await expect(async () => i.web3.anchor({ bookingId: "b", commitment: "00" })).rejects.toThrow(
      IntegrationNotConfiguredError,
    );
    expect(() => i.firebase.normalise({})).toThrow(IntegrationNotConfiguredError);
  });
});

describe("serving the web app (WEB_DIST_DIR)", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "spotsure-web-"));
    await mkdir(path.join(dir, "assets"));
    await writeFile(path.join(dir, "index.html"), "<!doctype html><title>SpotSure</title><div id=root></div>");
    await writeFile(path.join(dir, "assets", "index-abc123.js"), "console.log(1)");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("serves the app shell for client routes, hashed assets long-cached, and keeps /api JSON", async () => {
    const a = await make({ WEB_DIST_DIR: dir });
    const home = await a.inject("/");
    expect(home.statusCode).toBe(200);
    expect(home.headers["content-type"]).toMatch(/text\/html/);

    const deep = await a.inject("/app/owner/spaces/new");
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain("<title>SpotSure</title>");
    expect(deep.headers["cache-control"]).toBe("no-cache");

    const asset = await a.inject("/assets/index-abc123.js");
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");

    const api = await a.inject("/api/v1/nope");
    expect(api.statusCode).toBe(404);
    expect(api.json().error.code).toBe("route_not_found");
    expect((await a.inject("/api/v1/health")).headers["cache-control"]).toBe("no-store");

    // Path traversal outside the web root is not served.
    const escape = await a.inject("/..%2f..%2fpackage.json");
    expect(escape.body).not.toContain("spotsure-api");

    const csp = String(home.headers["content-security-policy"]);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("https://fonts.googleapis.com");
    expect(csp).toContain("https://fonts.gstatic.com");
  });

  it("doesn't serve any web files when WEB_DIST_DIR is unset", async () => {
    const a = await make();
    expect((await a.inject("/")).statusCode).toBe(404);
  });
});

describe("CORS", () => {
  it("allows configured origins only", async () => {
    const a = await make({ CORS_ORIGINS: "http://localhost:5173" });
    const ok = await a.inject({ url: "/api/v1/health", headers: { origin: "http://localhost:5173" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const other = await a.inject({ url: "/api/v1/health", headers: { origin: "https://evil.example" } });
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
