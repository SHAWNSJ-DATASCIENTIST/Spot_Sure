# SpotSure architecture

Status as of 2026-10-29: the landing page, the backend foundation, and
authentication with role-based access control exist. No external integration
(Firebase, YOLO, TigerGraph, Web3, email delivery) is connected yet.

## Layout

```
/            Vite + React landing page (unchanged; `npm run dev`)
/api         Backend service: Fastify + TypeScript + PostgreSQL (Drizzle)
/docs        This document
docker-compose.yml   Local Postgres only (optional; see api/README.md)
```

The repo was a single Vite app, so the API lives in its own `api/` package with
its own `package.json`, lockfile and toolchain rather than converting the repo to
a monorepo. The frontend's dependencies, scripts and lockfile are untouched. If
shared types become worth it later, an npm workspace can be introduced then.

## Why these choices

| Concern | Choice | Reason |
| --- | --- | --- |
| HTTP framework | Fastify 5 | TypeScript-first, built-in structured logging (pino) with redaction, plugin encapsulation for versioned prefixes, `inject()` for fast in-process tests. |
| Validation | Zod 4 | One schema gives runtime validation and static types; already the natural fit for env, request and event contracts. |
| Database | PostgreSQL 17 | Relational integrity for bookings, and native range exclusion constraints (`EXCLUDE USING gist`) to make double-booking impossible at the storage layer. |
| Data access | Drizzle ORM + node-postgres | SQL-shaped, typed, no code-gen step or engine binary; migrations are plain SQL files that can carry hand-written constraints. |
| Local DB | `embedded-postgres` or Docker Compose | Docker is optional: `npm run db:dev` runs real Postgres binaries with no daemon. Both use the same port and credentials. |
| Tests | Vitest | Same runner as the frontend. |

## Backend layers

```
routes/        HTTP only: parse + validate input, call repositories, shape output
domain/        Pure rules and contracts (occupancy event schema, booking transitions)
repositories/  All SQL; one module per aggregate
db/            Schema, connection pool, migrations, migration status
integrations/  Typed boundaries to external systems; no network code yet
http/          Error types, error handler, validation helper
config/        Environment schema
```

`buildApp(deps)` takes the env, DB handle and integrations as arguments, so tests
build the app against an unreachable DB or a real test DB without globals.

## API conventions

- Base path `/api/v1`. Breaking changes go to `/api/v2`.
- Success: `{ "data": ... }` (lists add `"page": { "limit", "nextAfter" }`, keyset by id).
- Error: `{ "error": { "code", "message", "details"?, "requestId" } }`. 5xx never includes internals.
- Every response carries `x-request-id`; log lines carry the same `reqId`.
- Money is integer minor units plus ISO currency (`{ amountMinor: 4000, currency: "INR" }`).
- Timestamps are ISO 8601 UTC.

Implemented endpoints:

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1` | Name, version, API version |
| GET | `/api/v1/health` | Liveness. Does not touch the DB on purpose. |
| GET | `/api/v1/ready` | 200 only if the DB answers and all shipped migrations are applied; else 503. Reports integration state without gating on it. |
| GET | `/api/v1/parking-spaces` | Public discovery over published **and verified** listings only, public shape. `q` (title/locality/city/state; never the street address), `type`, `vehicle`, `priceMin`/`priceMax` (₹/hr), optional `startsAt`+`endsAt` window (only listings open, within booking rules and with a free space then), `sort` (`newest`, `price_asc`, `price_desc`, `name`), `page`, `pageSize` ≤ 24. All filtering and paging in SQL; unknown params → 400. |
| GET | `/api/v1/parking-spaces/:id/quote` | Public. `startsAt`, `endsAt` → `{ problems, available, freeSpaces, price }` with the itemised server price. Advisory; the request re-checks everything. |
| GET | `/api/v1/parking-spaces/:id` | Public shape, same eligibility; one 404 for everything else (drafts included, even for their owner). |
| GET | `/api/v1/listing-photos/:photoId` | Photo bytes. Public if the listing is publicly visible, otherwise its owner only (404). |
| POST | `/api/v1/auth/register` | Rate limited. Creates a driver or parking-owner account and signs it in. |
| POST | `/api/v1/auth/login` | Rate limited. Generic 401 for any bad credential. |
| POST | `/api/v1/auth/logout` | Deletes the server-side session and clears the cookie. Idempotent. |
| GET | `/api/v1/auth/me` | Signed-in user's public profile. |
| PATCH | `/api/v1/users/me` | Own name/phone only. |
| GET | `/api/v1/me/bookings` | Own bookings, with space name and bay label. |
| GET | `/api/v1/me/space-bookings` | Bookings on any space the user owns. No booker identity. |
| GET | `/api/v1/me/societies` | Societies the user is explicitly assigned to administer. |
| GET | `/api/v1/bookings/:id` | Booker or owner of the booked space; 404 for anyone else. The owner's view omits the booker's id; the booker's view adds the exact address and entry instructions once confirmed. |
| POST | `/api/v1/bookings` | Drivers, rate limited. `{ spaceId, startsAt, endsAt }` only; price, status and identity are server-side. Creates a `pending` request. |
| POST | `/api/v1/bookings/:id/confirm` · `/decline` | Owner of the booked space, while pending and before start. |
| POST | `/api/v1/bookings/:id/cancel` | Booker or space owner, while pending/confirmed and before start. |
| POST | `/api/v1/parking-spaces` | Parking owners, rate limited. Owner = session user; always a `draft`. Only `name` and `hourlyPriceMinor` required. |
| GET | `/api/v1/me/parking-spaces` | Own listing summaries. `status`, `q` (title/locality/city), `page`, `pageSize` ≤ 50; returns `page.total`. |
| GET | `/api/v1/me/parking-spaces/:id` | Full owner view: everything incl. entry instructions, bays, photos, verification, last review note, bookability. |
| GET | `/api/v1/parking-spaces/:id/preview` | Owner only: exactly the public shape, whatever the status. |
| PATCH | `/api/v1/parking-spaces/:id` | Owner only. Listing fields, `vehicleTypes`, `capacity`. No status/owner/verification. 409 when archived. |
| POST | `/api/v1/parking-spaces/:id/actions` | Owner only. `{ action: submit \| withdraw \| publish \| unpublish \| archive \| restore }`. |
| PUT | `/api/v1/parking-spaces/:id/availability` | Owner only. `{ timezone, weekly: [{ day, opens, closes }] }`, or `null` to clear. |
| POST | `/api/v1/parking-spaces/:id/photos` | Owner only, rate limited. Raw JPEG/PNG body (≤ `PHOTO_MAX_BYTES`). |
| DELETE | `/api/v1/parking-spaces/:id/photos/:photoId` | Owner only. Next photo becomes cover. |
| PUT | `/api/v1/parking-spaces/:id/photos/:photoId/cover` | Owner only. |
| GET | `/api/v1/parking-spaces/:id/bookings` | Owner of that space only. |
| GET | `/api/v1/admin/parking-spaces` | Platform staff: listings waiting for review. |
| POST | `/api/v1/admin/parking-spaces/:id/review` | Platform staff, never the listing's owner. `{ decision: approve \| reject, notes }` (notes required to reject). |
| GET / PATCH | `/api/v1/societies/:id` | Admins of that society (or platform admins). |
| GET | `/api/v1/societies/:id/parking-spaces` | Same access. Listing summaries (name, status, bay count) without owner identity. |
| POST | `/api/v1/admin/societies` | Platform admins only. |
| PUT / DELETE | `/api/v1/admin/societies/:id/admins/:userId` | Platform admins only: grant/revoke society admin. |

## Authentication and authorisation

**Strategy: server-side sessions in an HttpOnly cookie.** The frontend and API
share an origin (Vite proxies `/api` in development; production should serve
both behind one origin), so a first-party cookie is the simplest secure option:
nothing for JavaScript to steal or store, and logout is a real server-side
revocation. JWTs would add key management and make revocation harder for no
benefit here.

- Passwords: Argon2id (`@node-rs/argon2`, m=19 MiB, t=2, p=1). 10–128 chars, a
  common-password deny-list, not equal to the email. Plaintext is never stored or logged.
- Emails are trimmed and lower-cased; uniqueness is enforced by a unique index on `lower(email)`.
- Sessions: 32 random bytes in the cookie; only its SHA-256 is stored in
  `sessions`. Fixed lifetime `SESSION_TTL_HOURS` (default 7 days, no sliding
  renewal yet). Logout deletes the row. Sessions of non-active users stop working
  immediately. Rows survive API and database restarts (verified), so a restart
  does not sign anyone out.
- Rotation: sign-in and registration revoke whatever session token the browser
  presented before issuing a new one, so no pre-existing (planted or stale)
  token survives authentication. Granting or revoking platform admin ends all
  of that user's sessions.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`; in production `Secure` with the
  `__Host-` prefix (startup refuses `SESSION_COOKIE_SECURE=false` in production).
- CSRF: SameSite=Lax; JSON-only bodies (form posts get 415, so no simple
  cross-site POST is possible); and every POST/PUT/PATCH/DELETE carrying an
  `Origin` must match `CORS_ORIGINS`, while requests marked
  `Sec-Fetch-Site: cross-site` are rejected. `CORS_ORIGINS` must list the site's
  own origin in every environment.
- Enumeration: login returns the same 401 for unknown email and wrong password,
  and burns an equivalent Argon2 verification for unknown emails. Registration of
  a taken email returns a generic 409 that does not say the account exists.
  Fully hiding registration status needs email delivery (send "you already have
  an account" mail instead); that is a known limitation until email is set up.
- Rate limits: login and register share a stricter per-IP limit
  (`AUTH_RATE_LIMIT_MAX` per `AUTH_RATE_LIMIT_WINDOW_MS`, default 10 per 15 min).
  Set `TRUST_PROXY=true` behind a proxy so the limit sees client IPs.
- Email verification: not implemented because no email service exists.
  `emailVerified` is `false` for everyone and the UI says so; nothing is gated on it yet.

### Roles

| Concept | Where | Assigned by |
| --- | --- | --- |
| Driver / parking owner | `users.role` (one primary account type, default `driver`) | The user, at registration, from an allow-list |
| Society administrator | `society_admins (society_id, user_id)` | Platform admins, per society |
| Platform administrator | `users.is_platform_admin` | `npm run admin:grant -- <email>` only; no HTTP endpoint |

Least privilege at registration: the default is `driver`. The only other
self-service choice is `parking_owner`, which grants control solely over spaces
that account itself creates; neither carries any administrative or
cross-account right. Every elevated capability (society admin, platform admin)
is granted by someone else.

One primary role keeps the current stage simple; society administration is a
scoped grant layered on top, so any account can administer specific societies
without becoming a platform admin. Changing a user's primary role is not
exposed yet. Request bodies are validated with strict schemas, so `role`
values other than the two self-service ones, and fields such as
`isPlatformAdmin`, `status`, `ownerId` or `id`, are rejected with 400.

Platform admins can create societies and assign society admins. They do not
automatically gain ownership of other people's parking spaces.

### Enforcement

`requireAuth` (401) and the policies in `api/src/auth/policies.ts` run inside
each handler after the resource is loaded, so checks use stored ownership,
never ids or roles from the request. 403 is used where the resource's
existence is not private (listings, societies); 404 for private resources
(bookings), so ids cannot be probed. The React route guard on `/app` only
improves navigation; it is not a security control.

Auth is independent of every external service: no payment, wallet, graph or
voice provider receives authentication data.

## Signed-in app (frontend)

`src/Root.tsx` routes everything under `/app` through one guard: it restores
the session from `GET /auth/me`, sends signed-out visitors to
`/sign-in?next=…` (same-site paths only), and renders pages inside
`src/shell/AppShell.tsx` (sidebar on wide screens, drawer below 900px, account
menu with profile and sign-out).

| Route | Who | Data |
| --- | --- | --- |
| `/app` | Everyone | Redirects to `/app/driver` or `/app/owner` by server-verified role |
| `/app/driver`, `/app/driver/bookings` | Drivers | `/me/bookings` |
| `/app/bookings/:id` | Booker or space owner | `/bookings/:id` |
| `/app/discover`, `/app/discover/:id` | Everyone | `/parking-spaces` (verified, published listings; search and booking not built) |
| `/app/owner`, `/app/owner/bookings` | Parking owners | Listing totals, `/me/space-bookings` |
| `/app/owner/spaces` | Parking owners | Search, status filter, pagination |
| `/app/owner/spaces/new`, `/app/owner/spaces/:id` | Parking owners | Multi-section form, lifecycle actions, hours, photos, public preview, bookings |
| `/app/staff/listings` | Platform staff | Review queue: approve or reject with a note |
| `/app/society`, `/app/society/:id` | Assigned society admins | `/me/societies`, `/societies/:id`, its space summaries, access rules |
| `/app/profile` | Everyone | `/auth/me`, `PATCH /users/me` |

Role checks in `src/app/routes.ts` only decide what to render and link to;
when a page is refused it makes no request for that role's data. The API
enforces the same rules regardless. Shared UI lives in `src/ui/ui.tsx`
(page header, summary card, status badge, responsive record list, skeleton,
empty, error and access-denied states, confirmation dialog).

## Data model

`users`, `societies`, `parking_spaces`, `parking_bays`, `bookings`,
`hardware_devices`, `video_analysis_jobs`, `parking_occupancy_events`,
`verification_records`, plus `sessions` and `society_admins` for auth
(migration `0002_auth_and_roles`, which also adds `users.role`,
`password_hash`, `email_verified_at` and `is_platform_admin` with safe
defaults). See `api/src/db/schema.ts`.

A **bay** was added beyond the original entity list: bookings and occupancy are
per bay, and a space can have several.

## Parking listings (asset registry)

Migrations `0004_listing_registry` and `0005_hours_from_json` (both partly
hand-edited) add:

- `parking_spaces`: `parking_type`, `locality`, `max_height_cm` /
  `max_length_cm` / `max_width_cm`, `daily_price_minor`,
  `min_booking_minutes` / `max_booking_minutes`, `timezone`,
  `entry_instructions`, `parking_rules`, `accessibility_info`, `restrictions`,
  `verified_at`, with check constraints for prices, durations and dimensions.
- `parking_space_vehicle_types (space_id, vehicle_class)`: relational, not JSON.
- `parking_space_hours (space_id, day, opens, closes)`: replaces the old
  `availability` JSON column. 0005 copies existing JSON hours and time zones
  into it before dropping the column (verified against real data).
- `parking_space_photos`: storage key, sniffed type, size, position, cover flag
  (partial unique index: one cover per listing).
- `listing_status` becomes `draft, pending_verification, published,
  unpublished, archived`. Existing rows are mapped explicitly: `paused` →
  `unpublished`; `active` → `pending_verification`, because those listings were
  public before verification existed and must be approved before drivers see
  them again.

**Lifecycle** (`api/src/domain/listing.ts`): owners `submit` a complete draft
(address, locality, city, ≥1 vehicle type, ≥1 space, opening hours) to
`pending_verification`; platform staff approve (→ `published`, `verified_at`
set, a `verification_records` row written) or reject with a note (→ `draft`).
Staff can't review their own listings, and approval re-checks completeness.
Owners may `unpublish` / `publish` while verified, `archive` (refused while
bookings are upcoming; history is kept) and `restore`. Changing location
fields or parking type clears verification and sends a published listing back
to review. Status is never set through PATCH.

**Public vs owner view**: drivers only ever see published **and** verified
listings, and never the street address, exact coordinates (rounded to ~1 km),
PIN code, entry instructions, owner, society link, bay ids or device ids.

**Bookable** is computed separately (`bookability()`) and is currently always
false, with reasons, because the booking engine doesn't exist yet. No status
change can make a listing bookable on its own.

**Capacity** is the number of non-retired `parking_bays`. Raising it revives
retired bays before creating new ones; lowering it retires bays (never deletes
them) and is refused (409) if a removed bay has upcoming bookings. Bay and
space UUIDs are stable, so hardware devices (`hardware_devices.space_id/bay_id`)
and occupancy events (`parking_occupancy_events.space_id/bay_id`) already
reference them. Occupancy remains separate from booking and authorisation.

### Listing photos

- Upload is a raw JPEG/PNG body to the API (no client-supplied URLs). The type
  is decided from the bytes, dimensions are read from the header
  (200–8000 px), and EXIF/XMP/IPTC/comment segments (JPEG) and
  `eXIf`/text/time chunks (PNG) are removed before storage, so phone GPS data
  isn't published. WebP and others get 415; oversize bodies 413.
- Max 10 per listing; the first becomes the cover.
- Storage is behind `api/src/storage/photos.ts`. `PHOTO_STORAGE_DIR` set →
  local disk under server-generated keys (`<spaceId>/<photoId>.jpg|png`).
  Unset → uploads and reads answer **503 `storage_not_configured`**; nothing
  pretends to work. An S3-compatible driver for production is **not
  implemented**; a multi-instance deployment needs one (or a shared volume).
- Bytes never go in Postgres.

### Booking integrity

- `CHECK (ends_at > starts_at)` and non-negative prices.
- Price snapshot (`hourly_price_minor_snapshot`, `total_price_minor`, `currency`) is
  copied onto the booking so later listing price changes do not alter it.
- `bookings_no_overlap_per_bay`: `EXCLUDE USING gist (bay_id WITH =,
  tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE status IN ('confirmed','active')`.
  Postgres rejects the second of any two overlapping bay-holding bookings with
  SQLSTATE `23P01`, including when they are inserted concurrently (tested with
  5 parallel inserts: exactly 1 succeeds). Pending/cancelled/expired rows do not
  hold the bay; back-to-back bookings are allowed.
- Allowed status transitions live in `api/src/domain/booking.ts`.

### Pilot booking flow (request → owner confirmation, no payments)

1. A driver requests a time range on a published, verified listing. The server
   checks it lies inside one opening window in the listing's time zone, on
   15-minute steps, within min/max length, not in the past and ≤ 60 days ahead;
   prices it (per started hour, capped by the daily price) and stores a
   `pending` booking on a bay that is free at that moment. Pending requests do
   not hold the bay. A driver can't have two overlapping requests on one listing.
2. The space owner confirms or declines. Confirmation is the `UPDATE` that
   claims the bay; the exclusion constraint decides any race (`23P01`), in
   which case other free bays are tried in savepoints, else 409 `slot_taken`
   and the request stays pending. Tested with 5 concurrent confirmations on a
   one-bay listing: exactly one wins.
3. Either party can cancel before the start (`cancelled_by` records who).
   Unanswered requests become `expired` at their start time and held bookings
   `completed` at their end; this happens lazily on every booking read/action
   (`settlePastBookings`), so no scheduler is needed.

Payment state is a separate column (`bookings.payment_status`, rules in
`api/src/domain/payment.ts`): `pending` booking = request only (nothing held,
nothing owed through SpotSure); `confirmed` = confirmed, **unpaid** via
SpotSure. No provider is integrated, so every booking stays `not_collected`;
no endpoint can set another status, checkout answers 503, and the database
refuses any other status without a provider reference (tested). Activation
requirements: docs/launch-readiness.md, "Payments".

Bookings survive unpublishing; archiving a listing is refused while any
pending/confirmed booking is upcoming. Payments are not integrated: every
booking reports `payment.status = "not_collected"` and the UI says nothing is
charged. Occupancy events are never consulted for access or booking state.

### Occupancy

Every producer is normalised to one contract (`api/src/domain/occupancy.ts`):
space, optional bay, `source` (`hardware` | `video` | `manual`), `observation`
(`available` | `occupied` | `unknown`), optional `confidence` 0..1, `observedAt`,
server-set `receivedAt`, device or video-job reference (required by source, and
enforced by a DB check), producer `sourceEventId` for idempotent redelivery,
`provenance`, and `processingStatus`.

These concepts are kept separate and must never stand in for each other:

| Concept | Where | Meaning |
| --- | --- | --- |
| Observed occupancy | `parking_occupancy_events.observation` | What a sensor/camera/person physically saw |
| Model confidence | `parking_occupancy_events.confidence` | Confidence of that one observation |
| Booking status | `bookings.status` | Commercial reservation lifecycle |
| Access authorisation | not yet modelled | Whether a vehicle may enter/stay (QR pass, later) |
| Trust / fraud risk | TigerGraph boundary, not stored | Advisory indicators with explanations |

A vehicle seen in a bay is not evidence that it has a booking or is authorised.

The landing page's Available / Occupied / Verify bay states are the future
*fused* view across sources; they are derived, not stored as events.

## Integration boundaries

`api/src/integrations/` defines interfaces only. `buildIntegrations()` wires each
to a stub that throws `IntegrationNotConfiguredError` (HTTP 503). `/ready` reports
each as `not_configured` or `configured_not_implemented`. There is no "connected"
state until a real client and an integration test exist.

- **Firebase** (`HardwareEventSource`): normalise raw device payloads to the
  occupancy contract, subscribe server-side with a service account (never client
  keys). Dedupe uses the `(source, source_event_id)` unique index.
- **YOLO** (`VideoAnalysisService`): `submit` only queues; `fetchOutcome` returns
  queued/processing/failed/completed. `video_analysis_jobs.detection_summary` may
  only be set when status is `completed` (DB check).
- **TigerGraph** (`TrustGraphService`): upsert vertices/edges, `assess` returns
  indicators with explanations. An empty list means "no indicators found", not "trusted".
- **Web3** (`BookingProofService`): anchors a sha256 commitment of a PII-free
  canonical booking record.

### Keeping personal data off-chain

Only a hash commitment is ever sent on-chain. The canonical record that gets hashed
contains booking id, bay id, time range and price, and excludes names, emails,
phone numbers, licence plates, device credentials and any CCTV footage, frames or
detections. Those stay in Postgres or private object storage under normal access
control and deletion rules. Because only a salted hash is anchored, deleting the
off-chain record makes the on-chain value meaningless rather than revealing.
CCTV and uploaded video are referenced by opaque `source_ref` keys, never by URLs
containing credentials.

## Security notes

- All secrets are server-side env vars validated at startup. Validation errors name
  the variable, never its value. Nothing is exposed via `VITE_` variables.
- Logs redact `authorization`, `cookie`, `set-cookie`, `*.password`, `*.token`.
- Helmet headers, CORS allow-list from `CORS_ORIGINS`, per-IP rate limit
  (`RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS`), 1 MB body limit.
- Graceful shutdown on SIGINT/SIGTERM: stop accepting, drain, close the pool; forced exit after 10 s.

## Sponsor technologies: where each one belongs

None of these is part of authentication. Auth works with all of them absent.

| Sponsor | Responsibility in SpotSure | Stage | Rule for auth data |
| --- | --- | --- | --- |
| Socket.dev | Supply-chain scanning of npm dependencies in CI (below) | Now (advisory, needs token) | Never sees runtime data |
| TigerGraph | Trust graph over users, vehicles, devices, spaces, bookings for fraud signals | Later prompt | Receives entity ids and relationships only |
| Dodo Payments | Booking checkout and owner payouts | Later prompt | Payment state comes from verified provider webhooks, never from the browser saying "paid" |
| Cake Wallet | Optional wallet linking for Web3 booking proofs / crypto payouts | Later prompt | Wallet is never a login method; linking requires an already-signed-in account |
| Wispr Flow | Voice dictation for free-text input (search, listing descriptions, notes) | Compatibility now (no API exists) | Standard labelled inputs; dictated forms ("₹40", "403 001", "Panaji.") parse; long text is never silently truncated; no audio is recorded and no Wispr API is called |

### TigerGraph sync contract (for later)

- Vertex ids are the Postgres UUIDs (`users.id`, `parking_spaces.id`,
  `bookings.id`, `hardware_devices.id`, …). They are stable and never reused,
  so the graph can be rebuilt from the database at any time.
- Never synced: password hashes, session tokens or hashes, emails, phone
  numbers, names, licence plates in clear, CCTV media. Vehicles will be keyed by
  a salted hash of the plate.
- Allowed attributes: role, account status, created-at, listing status,
  booking status and time range, device type.
- Trust results come back as explanations (see `integrations/tigergraph.ts`)
  and never alter roles, sessions or permissions automatically.

## Supply-chain checks (Socket.dev)

Every Socket CLI analysis command (`socket ci`, `socket scan create`,
`socket package score`) needs a Socket API token, and the project has no
Socket account configured. Verified on 2026-10-29: `npx socket@1.11.1 ci`
without a token exits 1 with "Auth Error: You need to provide an API token".
**No Socket scan of this repository has ever run.**

- `.github/workflows/ci.yml` job `socket` runs `npx socket@1.11.1 ci`
  (= `socket scan create --report`) when the `SOCKET_CLI_API_TOKEN` secret
  exists. A report that breaks the Socket org's security policy fails the job
  (it is no longer `continue-on-error`). Without the secret it emits a GitHub
  `::warning::` saying no scan ran. It is a separate job, so the frontend and
  API jobs (including auth tests) run regardless.
- Block/warn thresholds (malware, install scripts, typosquats, network or
  shell access, …) are set in the Socket dashboard's security policy, not in
  this repo.
- To enable: create a Socket org; install the Socket GitHub App on
  `HemangDubey/SpotSure` (PR dependency alerts; needs repo-admin approval);
  create an API token with scan permissions and add it as the Actions secret
  `SOCKET_CLI_API_TOKEN`; optionally make the `Socket.dev dependency scan`
  check required in branch protection. Locally: `npx socket@1.11.1 login`,
  then `npx socket@1.11.1 ci`.

### Other dependency and secret gates (CI)

- `npm audit --omit=dev --audit-level=high` (blocks on high/critical in
  production dependencies) and `npm audit --audit-level=critical` (blocks on
  critical anywhere) for both packages; lower severities are logged only.
- `gitleaks` v8.30.1 (official image pinned by digest) scans the full git
  history with `--redact`. Not yet run in CI; the first run may need a
  reviewed `.gitleaksignore` entry if test fixtures trip a generic rule.
- Installs are `npm ci` (lockfile-frozen). The API's production dependencies
  install and load without dev packages (`npm ci --omit=dev`); `db:migrate`
  uses `tsx`, so the release host installs the full tree as
  docs/deployment.md says.

Known, accepted: `drizzle-kit` (API, dev only) pulls `@esbuild-kit/*` with an
old `esbuild` (GHSA-67mh-4wv8-2f99, moderate). The advisory concerns
esbuild's dev *server*; drizzle-kit only uses it to load its config, never
serves, and the only npm "fix" is a downgrade to drizzle-kit 0.18. Revisit
when drizzle-kit drops `@esbuild-kit`.

