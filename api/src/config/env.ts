import { z } from "zod";
import { PAYMENT_PROVIDERS } from "../domain/payment.js";

// Server-side configuration only. Nothing here may be exposed through Vite
// (no VITE_ prefix): the browser bundle must never see these values.

const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const optionalUrl = optionalString.pipe(z.url().optional());

const optionalBool = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.stringbool().optional(),
);

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z
    .url()
    .refine((v) => /^postgres(ql)?:\/\//.test(v), "DATABASE_URL must be a postgres:// URL"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  // Comma-separated list of allowed browser origins.
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((v) =>
      v
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url())),

  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  // Stricter per-IP limit shared by login and registration.
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60_000),
  // Booking requests per client per hour.
  BOOKING_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(30),

  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24 * 7),
  // Defaults to true in production. Only disable for plain-http local dev.
  SESSION_COOKIE_SECURE: optionalBool,
  // Set when running behind a reverse proxy so client IPs (rate limits) are correct.
  TRUST_PROXY: optionalBool.transform((v) => v ?? false),

  // Built frontend (vite build output). When set, the API also serves the web
  // app from the same origin, which the cookie + CSRF design requires.
  WEB_DIST_DIR: optionalString,

  // Listing photos. Unset directory = uploads refused with 503 (no silent fallback).
  PHOTO_STORAGE_DIR: optionalString,
  PHOTO_MAX_BYTES: z.coerce.number().int().min(100_000).max(20_000_000).default(5_000_000),

  // Live charges. No provider is integrated, so "none" is the only accepted
  // value: setting a provider name here must fail loudly, not look enabled.
  PAYMENTS_PROVIDER: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.enum(PAYMENT_PROVIDERS, { error: "no payment provider is integrated yet; only 'none' is accepted" }).default("none"),
  ),

  // Integrations. All optional: absent means "not configured", never "fake it".
  FIREBASE_PROJECT_ID: optionalString,
  FIREBASE_SERVICE_ACCOUNT_PATH: optionalString,
  YOLO_SERVICE_URL: optionalUrl,
  TIGERGRAPH_HOST: optionalUrl,
  TIGERGRAPH_GRAPH: optionalString,
  TIGERGRAPH_SECRET: optionalString,
  WEB3_RPC_URL: optionalUrl,
  WEB3_CHAIN_ID: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce.number().int().positive().optional(),
  ),
})
  .refine((e) => !(e.NODE_ENV === "production" && e.SESSION_COOKIE_SECURE === false), {
    path: ["SESSION_COOKIE_SECURE"],
    message: "cannot be false in production",
  })
  // CORS_ORIGINS doubles as the CSRF allow-list. The localhost default must
  // never reach production, where it would silently reject every browser write.
  .refine(
    (e) => e.NODE_ENV !== "production" || e.CORS_ORIGINS.every((o) => o.startsWith("https://") && !/localhost|127\.0\.0\.1/.test(o)),
    { path: ["CORS_ORIGINS"], message: "must list the site's https:// origin(s) in production" },
  );

export type Env = z.infer<typeof envSchema>;

export function sessionCookieSecure(env: Env): boolean {
  return env.SESSION_COOKIE_SECURE ?? env.NODE_ENV === "production";
}

export class EnvValidationError extends Error {
  constructor(public readonly issues: { path: string; message: string }[]) {
    // Only variable names and reasons, never the offending values.
    super(`Invalid environment configuration:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`);
    this.name = "EnvValidationError";
  }
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message })),
    );
  }
  return result.data;
}
