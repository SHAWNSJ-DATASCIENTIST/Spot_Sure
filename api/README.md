# SpotSure API

Fastify + TypeScript + PostgreSQL (Drizzle). Design and conventions:
[docs/architecture.md](../docs/architecture.md).

## Setup

Requires Node 20+. Commands run from `api/`.

```
npm install
cp .env.example .env          # safe local defaults; no real secrets
```

Start PostgreSQL 17 on `localhost:5433` (pick one):

```
npm run db:dev                # real Postgres binaries, no Docker; data in api/.pgdata
docker compose up -d db       # from the repo root, if Docker is running
```

Both create the `spotsure` and `spotsure_test` databases with user/password
`spotsure`/`spotsure`. Stop the embedded one with Ctrl+C, or `npm run db:stop`
if its terminal was closed.

```
npm run db:migrate            # apply drizzle/*.sql
npm run dev                   # http://127.0.0.1:4000/api/v1 (watch mode)
```

## Scripts

| Script | What it does |
| --- | --- |
| `dev` | Run the API with reload |
| `build` / `start` | Compile to `dist/` / run the compiled server |
| `typecheck` | Type-check src, scripts and tests |
| `test` | All tests. DB tests run when `TEST_DATABASE_URL` is set (it is in `.env.example`) and are reported as skipped otherwise. They drop and recreate the schema of that database, so its name must end in `_test`. |
| `db:generate` | Generate a migration from `src/db/schema.ts` changes |
| `db:migrate` | Apply pending migrations to `DATABASE_URL` |
| `db:dev` / `db:stop` | Run / stop the embedded dev Postgres |
| `admin:grant -- <email> [--revoke]` | Grant or revoke internal platform-admin access (no HTTP endpoint can) |

## Environment

See `.env.example`. `DATABASE_URL` is the only required value. Integration
variables stay blank until a real configuration exists; blank means "not
configured". Never put secrets in `VITE_*` variables or commit `.env`.

| Variable | Default | Notes |
| --- | --- | --- |
| `CORS_ORIGINS` | `http://localhost:5173` | Must include the site's own origin: also used for the CSRF Origin check |
| `AUTH_RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_WINDOW_MS` | 10 / 900000 | Per-IP limit on login + register |
| `SESSION_TTL_HOURS` | 168 | Session lifetime |
| `SESSION_COOKIE_SECURE` | on in production | Cannot be false in production |
| `TRUST_PROXY` | false | Set true behind a reverse proxy |
| `PHOTO_STORAGE_DIR` | unset | Directory for listing photos (local disk). Unset = uploads return 503. `.env.example` uses `./.storage/photos` (git-ignored) |
| `PHOTO_MAX_BYTES` | 5000000 | Max upload size per photo |

## Migrations

`drizzle/0000_foundation.sql`, `0002_auth_and_roles.sql` and
`0003_space_availability.sql` are generated from the schema.
`drizzle/0001_booking_no_overlap.sql` is hand-written (btree_gist + the booking
exclusion constraint), because Drizzle cannot express `EXCLUDE` constraints.
`0004_listing_registry.sql` and `0005_hours_from_json.sql` are generated, then
hand-edited to map old listing statuses explicitly and to copy JSON opening
hours into `parking_space_hours` before the column is dropped.
Never edit an applied migration; add a new one.

`drizzle-kit generate` asks interactive questions when a column is dropped and
others are added in the same change; in non-interactive shells split such a
change into two migrations (add, then drop).

## Trying auth locally

With the DB, API (`npm run dev`) and frontend (`npm run dev` at the root) running,
open http://localhost:5173/register. The Vite dev server proxies `/api` to this
API, so the session cookie is first-party.
