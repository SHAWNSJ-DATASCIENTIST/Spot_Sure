import type { FastifyError, FastifyInstance } from "fastify";
import { z } from "zod";

// Every error response has this shape:
//   { "error": { "code": "...", "message": "...", "details"?: ..., "requestId": "..." } }

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, "not_found", `${resource} not found`);
  }
}

export class ValidationError extends AppError {
  constructor(issues: z.core.$ZodIssue[]) {
    super(
      400,
      "validation_failed",
      "Request validation failed",
      issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
}

/** Raised when code reaches an integration that has no real configuration. */
export class IntegrationNotConfiguredError extends AppError {
  constructor(integration: string) {
    super(503, "integration_not_configured", `${integration} integration is not configured`);
  }
}

const PG_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  "23505": { status: 409, code: "conflict", message: "That value is already in use" },
  "23P01": { status: 409, code: "slot_taken", message: "That time is already booked" },
  "23503": { status: 409, code: "conflict", message: "This refers to something that no longer exists" },
  "23514": { status: 400, code: "invalid_value", message: "A value is outside the allowed range" },
  "22001": { status: 400, code: "invalid_value", message: "A value is too long" },
  // statement_timeout / lock wait cancelled (see db/client.ts)
  "57014": { status: 503, code: "busy", message: "The service is busy; try again in a moment" },
};

/** The database can't be reached at all (down, restarting, network). */
function isDatabaseUnreachable(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } };
  const codes = [e.code, e.cause?.code];
  const messages = [e.message, e.cause?.message].filter((m): m is string => typeof m === "string");
  return (
    codes.some((c) => c === "ECONNREFUSED" || c === "ETIMEDOUT" || c === "ENOTFOUND" || c === "57P01" || c === "57P03") ||
    messages.some((m) => /timeout exceeded when trying to connect|Connection terminated/i.test(m))
  );
}

/** Postgres SQLSTATE, whether pg threw directly or drizzle wrapped it. */
function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  const code = typeof e.cause?.code === "string" ? e.cause.code : typeof e.code === "string" ? e.code : undefined;
  return code && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

export function registerErrorHandling(app: FastifyInstance, opts: { spa?: boolean } = {}): void {
  app.setNotFoundHandler((req, reply) => {
    // Client-side routes (/app/…, /sign-in) get the SPA shell when the web
    // build is served; anything under /api stays a JSON 404.
    if (opts.spa && (req.method === "GET" || req.method === "HEAD") && !req.url.startsWith("/api/")) {
      return reply.sendFile("index.html");
    }
    reply.status(404).send({
      error: { code: "route_not_found", message: `No route for ${req.method} ${req.url.split("?")[0]}`, requestId: req.id },
    });
  });

  app.setErrorHandler((err: FastifyError | AppError | Error, req, reply) => {
    if (err instanceof AppError) {
      if (err.statusCode >= 500) req.log.error({ err }, err.message);
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details, requestId: req.id },
      });
    }

    const fe = err as FastifyError;
    const status = fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 600 ? fe.statusCode : 500;

    if (status === 429) {
      return reply.status(429).send({
        error: { code: "rate_limited", message: "Too many requests", requestId: req.id },
      });
    }
    if (status < 500) {
      // Fastify-level client errors: malformed JSON, body too large, bad content type.
      return reply.status(status).send({
        error: { code: fe.code ? fe.code.toLowerCase() : "bad_request", message: fe.message, requestId: req.id },
      });
    }

    // Database constraints are the last line of defence; when one fires, say
    // what kind of problem it was without exposing constraint or table names.
    const pg = PG_ERRORS[pgCode(err) ?? ""];
    if (pg) {
      req.log.warn({ pgCode: pgCode(err) }, "Database constraint rejected a request");
      return reply.status(pg.status).send({ error: { code: pg.code, message: pg.message, requestId: req.id } });
    }

    if (isDatabaseUnreachable(err)) {
      req.log.error({ err }, "Database unavailable");
      return reply.status(503).send({
        error: { code: "service_unavailable", message: "SpotSure is temporarily unavailable; try again shortly", requestId: req.id },
      });
    }

    req.log.error({ err }, "Unhandled error");
    // Never leak internals (SQL, stack traces) to clients.
    return reply.status(500).send({
      error: { code: "internal_error", message: "Internal server error", requestId: req.id },
    });
  });
}
