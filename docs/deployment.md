# Deploying SpotSure (controlled pilot)

Status: **not deployed.** Nothing in this repository has been deployed to a
live URL. This document is the procedure; every step below that could be run
locally was run (see "Verified locally").

## Shape

One Node 22 process serves both the API (`/api/v1/*`) and the built web app
(everything else) from **one HTTPS origin**. That is required: sessions are
first-party `__Host-` cookies and the CSRF check compares `Origin` with
`CORS_ORIGINS`. PostgreSQL 17 (managed) holds all data. Photos are on a
persistent disk volume.

```
browser ──HTTPS──▶ TLS proxy / platform router ──HTTP──▶ node api/dist/server.js ──▶ PostgreSQL
                                                         └─ WEB_DIST_DIR (static)   └─ PHOTO_STORAGE_DIR (volume)
```

Any host that runs a long-lived Node process with a persistent volume works
(a VM with Caddy/nginx, Render, Railway, Fly.io). Serverless functions do not
(photos on local disk, long-lived DB pool).

## Required environment (production)

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` (turns on Secure `__Host-` cookies; startup refuses insecure settings) |
| `HOST` / `PORT` | `0.0.0.0` / platform port |
| `DATABASE_URL` | Managed Postgres URL, with `?sslmode=require` if the provider needs TLS |
| `CORS_ORIGINS` | The site's own origin, e.g. `https://spotsure.example` (https only; startup refuses localhost/http) |
| `TRUST_PROXY` | `true` behind a proxy/platform router, so rate limits see real client IPs |
| `WEB_DIST_DIR` | Absolute path to the repo's `dist/` after `npm run build` |
| `PHOTO_STORAGE_DIR` | Absolute path on a **persistent** volume. Leave unset to disable uploads (503) |
| `LOG_LEVEL` | `info` |

Optional: `SESSION_TTL_HOURS`, `AUTH_RATE_LIMIT_*`, `BOOKING_RATE_LIMIT_MAX`,
`RATE_LIMIT_*`, `PHOTO_MAX_BYTES`, `DATABASE_POOL_MAX`. Leave every integration
variable blank (Firebase, YOLO, TigerGraph, Web3): none is implemented.
`PAYMENTS_PROVIDER` must stay `none` (any other value stops startup).
There is no public/`VITE_` frontend configuration: the web app reads no
environment variables and calls the API on its own origin.

Startup refuses (exit 1, naming the variable, never its value): missing
`DATABASE_URL`, non-https or localhost `CORS_ORIGINS` in production,
`SESSION_COOKIE_SECURE=false` in production, any `PAYMENTS_PROVIDER` but
`none`. It warns when `TRUST_PROXY`, `WEB_DIST_DIR` or `PHOTO_STORAGE_DIR` is
unset in production.

Secrets (`DATABASE_URL`) go in the platform's secret store, never in the repo.

## Steps

```bash
# 1. Build (CI or the host). Root = web app, api/ = server.
npm ci && npm --prefix api ci
npm run build:all            # vite build -> dist/, tsc -> api/dist/

# 2. Back up, then migrate (forward-only; see "Migrations" below).
#    db:migrate:prod runs the compiled dist/migrate.js: no dev dependencies needed,
#    so it works as a platform "release command" on a pruned image.
pg_dump "$DATABASE_URL" -Fc -f pre-deploy.dump
npm --prefix api run db:migrate:prod

# 3. Start
NODE_ENV=production node api/dist/server.js

# 4. Smoke test the live URL (read-only, creates no data). Needs dev deps (tsx):
#    run it from CI or an operator machine, not the pruned server image.
SMOKE_BASE_URL=https://spotsure.example npm --prefix api run smoke

# 5. Create the first staff reviewer (after they register in the app).
#    Operator machine with DATABASE_URL set; also uses tsx.
npm --prefix api run admin:grant -- staff@example.com
```

## Timeouts and failure behaviour

- HTTP: `requestTimeout` 60 s (enough for a 5 MB photo on a slow link) cuts
  slow-loris clients; body limit 1 MB (photos: `PHOTO_MAX_BYTES`).
- Postgres: connect timeout 5 s; `statement_timeout` 15 s and
  `idle_in_transaction_session_timeout` 30 s per connection, so a runaway
  query or lock wait can't pin a connection. Migrations run without the
  statement timeout.
- Database down/restarting → `503 service_unavailable`; cancelled query →
  `503 busy`; neither exposes hosts, SQL or driver messages (tested).
- SIGTERM/SIGINT: stop accepting connections, drain in-flight requests, close
  the pool; forced exit after 10 s. (Implemented in `api/src/server.ts`; not
  exercised on Windows during local verification.)

## Backups (not configured: nothing is backed up today)

- Database: enable the managed provider's automated daily backups with
  point-in-time recovery (≥ 7 days), plus the manual `pg_dump` before every
  migration (step 2). Test a restore into a scratch database before the pilot.
- Photos: snapshot the `PHOTO_STORAGE_DIR` volume daily. Retention: photos are
  deleted from disk when the owner removes them; archived listings keep theirs.
  No CCTV/video is stored (feature not built).

## CI/CD

`.github/workflows/ci.yml` runs on PRs and `main`: frozen installs, `npm
audit` gates, type checks, all tests (API against Postgres 17), builds,
gitleaks, Socket (when its token exists). There is **no deploy job**: no
hosting provider or credentials are configured, and deploys should stay
manual (steps above) until one is chosen. When adding one, deploy only from
`main` after CI passes, with a platform deploy token in the CI secret store
and `permissions: contents: read`; run `db:migrate:prod` as the release step.

Platform health checks: liveness `GET /api/v1/health`, readiness
`GET /api/v1/ready` (503 until the DB answers and all migrations are applied).

## Migrations

Nine migrations, applied in order by `db:migrate` inside one transaction.
`0004` changes the listing status enum: listings that were `active` become
`pending_verification` (they need staff approval again) and `paused` become
`unpublished`; `0005` moves JSON opening hours into a table, then drops the
column. Both were verified against real data. **Take a `pg_dump` first**; there
are no down-migrations.

## Rollback

1. Redeploy the previous build (keep the last release's `dist/` and `api/dist/`).
2. If the release ran migrations the old build can't read, restore the
   pre-deploy dump: `pg_restore --clean --if-exists -d "$DATABASE_URL" pre-deploy.dump`.
   This discards writes made after the dump, so do it only with the owner's
   approval and announce the window.
3. Photos are additive files; nothing to roll back.

## Logging

Structured JSON (pino) to stdout. Logged: method, URL, status, request id,
user id on sign-in. Never logged: request bodies, cookies, `authorization`,
passwords, session tokens (redacted by configuration and checked in tests).
Every response carries `x-request-id` for correlation.

## Verified locally, production mode (2026-10-29, Prompt 15)

On this machine, not a hosted environment:

- Fresh database `spotsure_fresh` created empty; `node dist/migrate.js` run
  twice (idempotent): 9 migrations; exclusion constraint
  `bookings_no_overlap_per_bay`, `bookings_payment_reference`, notification
  dedupe and session/email unique indexes present.
- Startup refused 4 unsafe configs (missing DB URL, localhost CORS, insecure
  cookie, `PAYMENTS_PROVIDER=dodo`).
- `NODE_ENV=production node api/dist/server.js` (single origin, built `dist/`,
  `TRUST_PROXY=true`, photo volume): smoke script 7/7; `/ready` 200 with only
  status fields; HSTS, CSP, nosniff, frame and referrer headers present.
- Core journey (35 checks, throwaway accounts): register/login with
  `__Host-` cookie, staff grant, listing create + photo + review, discovery,
  booking request with server price, tampered price refused, overlapping
  confirmation refused (409), decline, notifications for every party without
  private details, payment `not_collected` and checkout 503, integrations
  `not_configured`, cross-user reads/cancels/notification access refused,
  logout revokes the session.
- 175 production log lines contained no passwords, tokens, emails or
  addresses.

## Verified locally (earlier)

- `npm run build:all`, type checks and all test suites (see the launch report).
- API serving the built web app from one origin, with SPA fallback, cache
  headers and CSP (tested).
- `NODE_ENV=production` start with a https `CORS_ORIGINS`, then the smoke
  script against it.
- Full browser journey (register → list → review → book → confirm) against the
  single-origin build.

Not verifiable here: real TLS/HSTS, the hosting platform, managed Postgres
networking, backups. Those are checked by step 4 on the real host.
