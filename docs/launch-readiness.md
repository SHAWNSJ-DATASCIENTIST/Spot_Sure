# Launch readiness (2026-10-29)

Recommendation: **controlled pilot** (invited owners and drivers, staff
reviewing every listing, no payments). Not a public launch. Not yet deployed:
see [deployment.md](deployment.md).

## MVP journey: status

| Step | Status | Evidence |
| --- | --- | --- |
| Register, sign in, sign out | Works | API tests, browser |
| Owner creates/edits a listing, hours, photos | Works | API + UI tests, browser |
| Staff review → listing published | Works (staff via CLI grant) | API tests, browser |
| Driver discovers a listing and its details | Works: server-side search, type/vehicle/price filters, availability window, sort, paging; list only (no map provider configured) | API + UI tests, browser |
| Driver requests a time range | Works (request-only), with a live server quote: itemised price and whether a space is free | API + UI tests, browser |
| Availability checked, no overlapping confirmed bookings | Works, DB-enforced | concurrent-confirm test |
| Owner confirms/declines; either cancels | Works | API + UI tests, browser |
| Both see their records and statuses | Works | API tests, browser |

## Launch audit fixes (Prompt 08)

Each was reproduced by a failing test first (`api/test/audit.test.ts`):

1. Duplicate unique values (e.g. a phone number already in use) returned
   **500**; database constraint errors now map to 409/400 without leaking
   constraint names.
2. Listings of a **suspended or deactivated owner stayed public and
   bookable**; visibility, search, quotes and requests now require an active owner.
3. **Simultaneous duplicate requests** from one driver for one listing could
   all succeed (3 of 5 in the test); requests are now serialised per
   driver+listing with a transaction-scoped advisory lock.
4. The deploy **smoke test still used the retired `?limit=` parameter** and
   would have failed a healthy deployment; fixed and re-run (7/7).
5. Production startup now warns when `TRUST_PROXY`, `WEB_DIST_DIR` or
   `PHOTO_STORAGE_DIR` is unset.

The primary journey (register → list → review → discover → request →
concurrent confirm → view → decline/cancel) runs end to end as one API test
against real PostgreSQL.

## Remaining issues

Critical: none known in the pilot scope.

Major:

1. Not deployed; real TLS, host and managed Postgres untested (procedure in deployment.md).
2. No email, SMS or push delivery: no verification, password reset or off-app booking alerts. Booking and listing events appear as **in-app notifications only** (bell in the app header), so owners and drivers must open SpotSure to see them.
3. Dev-only dependency advisories (vitest 2 / vite 5 / drizzle-kit's esbuild). Not shipped to production; upgrade after launch.
4. Photo storage is local disk; one instance only (or a shared volume) until an object-storage driver exists.
5. Owners can't see who booked (privacy default). Fine for small pilots; needs a decision (e.g. share first name / vehicle) before scale.

Minor: no map (no provider configured; coordinates are never fabricated), no booking-time vehicle choice, no listing photos in the staff review view, staff must be granted by CLI.

## Final verification (Prompt 16, 2026-10-29)

Recommendation: **READY FOR STAGING.** Not deployed; no hosting, managed
database, domain or backups exist yet (see docs/deployment.md).

Verified on this machine:

- Browser, dev build: driver registers, discovers, sees a listing's price,
  hours, limits and time zone (address private), is shown "No space is free"
  with submit disabled for a taken slot, requests a free one (server price
  ₹80), sees it in My bookings and Notifications at 375 px with no horizontal
  scroll. API restarted: booking and session persisted. Owner signs in, finds
  the request in Booking activity, confirms through a keyboard-operable dialog
  (focus starts on Cancel), payment stays "not handled". Owner creates a draft
  with "₹50" and "403 001" (stored 5000 paise, `403001`), validation summary
  and focus on first invalid field. Owner opening the driver dashboard gets
  "Access denied".
- Production build against a fresh database: 9 migrations, smoke 7/7, core
  journey 35/35 (Prompt 15).
- Suites: web 87/87, API 162/162; type checks and builds pass; `npm audit`
  0 vulnerabilities (production, high+; and critical, all deps).

Fixed in this phase: driver first-use text said "Booking opens in a later
release" although booking requests work (regression test in
`dashboards.test.tsx`); landing-page honesty now covered by
`src/data/content.test.ts`.

Blocked, not passed: Socket scan (CLI "Auth Error", no token), gitleaks
locally (blocked; runs in CI), hosted smoke test, TLS, backups, graceful
shutdown signal test on Windows.

## Sponsor technologies (Prompt 14)

Checked 2026-10-29 against each vendor's public site/docs and this repo.

| Sponsor | Intended role | Status | What exists (files) | Evidence | Missing / next step |
| --- | --- | --- | --- | --- | --- |
| Wispr Flow | Voice input for search, listing text, notes | **Not applicable as an API. Compatibility done.** | `src/app/format.ts` (`parseMoneyToMinor`, `compactDigits`, `normaliseSearch`), `src/dashboards/listings.tsx`, `src/dashboards/discover.tsx`, `api/src/routes/parkingSpaces.ts` (search text, PIN normalisation) | Unit and HTTP tests (mock-free): `src/app/format.test.ts`, `listings.test.tsx`, `api/test/discovery.test.ts`, `api/test/listings.test.ts` | Wispr Flow is system-wide dictation (Mac, Windows, iPhone, Android) that "types wherever your cursor is"; its site and developer page document no API/SDK. SpotSure never records audio. Not tested with the Wispr app itself. |
| TigerGraph | Explainable trust signals over users, listings, bookings, devices | **Not implemented; blocked on access.** | `api/src/integrations/tigergraph.ts` (interface only), `integrations/index.ts` (throws `integration_not_configured`; reports `configured_not_implemented` when env is set) | `api/test/http.test.ts` (refuses results unconfigured); `api/test/security.test.ts` (discovery and booking never call any integration, even when TigerGraph env is set) | A TigerGraph instance (host, graph, secret: `TIGERGRAPH_HOST`, `TIGERGRAPH_GRAPH`, `TIGERGRAPH_SECRET`), a schema, a server-side REST client with timeouts, and a staff-only review surface. Signals must stay advisory. |
| Cake Wallet | Optional wallet compatibility | **Not applicable to the current architecture.** | None (by design) | n/a | Open-source self-custody consumer wallet; no merchant/payment API or verification interface documented. Never collect seed phrases, keys or tx hashes as "proof". |
| Socket.dev | Supply-chain scanning | **Blocked by external access.** CI job ready. | `.github/workflows/ci.yml` job `socket` (`npx socket@1.11.1 ci`) | Verified 2026-10-29: CLI without a token exits 1 "Auth Error". Never scanned. | Socket org, GitHub App, `SOCKET_CLI_API_TOKEN` secret. `npm audit` gates and gitleaks run meanwhile. |
| Dodo Payments | Booking checkout | **Blocked; live charges disabled.** Payment state and checkout contract ready. | `api/src/domain/payment.ts`, `bookings.payment_status` (migration 0007), `POST /bookings/:id/checkout` (503) | `api/test/payments.test.ts` | Merchant approval, marketplace/owner-payout model, then client + Standard Webhooks receiver (see "Payments"). |

None of these is shown in the UI as working. The landing page's trust graph
card says "Planned" and "not connected yet"; no sponsor logos are displayed.

## Integrations: honest status

| Integration | Status |
| --- | --- |
| Socket.dev | CI job wired; blocks on Socket policy violations once `SOCKET_CLI_API_TOKEN` is set, warns visibly without it. **No token: verified the CLI refuses to scan ("Auth Error"); never run.** |
| Dodo Payments | **Not integrated. Live charges disabled.** No SDK, keys, checkout session or webhook receiver. See "Payments" below. |
| Cake Wallet | **Not integrated, and not a payment processor.** Consumer wallet; no merchant API is used. |
| TigerGraph | **Not integrated.** Interface + ids-only sync contract documented; no client, no trust scores. |
| Wispr Flow | **Compatibility, not an API integration** (none is documented). Dictated text is handled: see "Sponsor technologies" below. |
| Firebase hardware ingestion | **Not integrated.** Schema and normalised event contract only. |
| YOLO / CCTV video | **Not integrated.** Job schema and interface only; no detections. |
| Web3 audit proofs | **Not integrated.** Interface only; nothing on-chain. |
| Email / SMS / push / WhatsApp | **Not integrated.** No provider configured; nothing is sent outside the app. |

## Payments

**Live charges are disabled.** `PAYMENTS_PROVIDER` accepts only `none`; any
other value stops the API at boot. `GET /ready` reports
`payments: { provider: "none", liveCharges: false }`.

What exists (tested in `api/test/payments.test.ts`):

- Payment state stored per booking, separate from booking state:
  `bookings.payment_status` = `not_collected | pending | paid | failed | refunded`
  (default `not_collected`). Confirmed ≠ paid.
- Allowed payment transitions in `api/src/domain/payment.ts`
  (`not_collected→pending`, `pending→paid|failed`, `failed→pending`, `paid→refunded`).
  No route writes them; a DB check refuses any status other than
  `not_collected` without `payment_provider` + `payment_provider_ref`, and a
  unique index stops one provider reference being attached to two bookings.
- `POST /bookings/:id/checkout`: booker-only (owner 403, others 404); always
  `503 payments_disabled`, writes nothing. The charge amount, once enabled, is
  the booking's snapshotted `total_price_minor` (`amountDueMinor`).
- Access to the address/entry instructions goes through `accessGranted()`:
  confirmed booking required; "paid" additionally required once payment is
  mandatory. In the pilot payment isn't required, because it can't be collected.
- The UI shows the server's payment status text; a booking is never labelled
  paid unless the server says `paid`. The booking form says before submit that
  nothing is charged.

Not built, deliberately: webhook receiver, provider client, refunds, payouts.
No payment history, transactions or revenue are shown anywhere.

### To activate Dodo Payments (all required before `PAYMENTS_PROVIDER` gains a value)

1. Merchant account approved for this business (India-based parking
   marketplace, physical service) — eligibility not verified.
2. Confirm the marketplace model: Dodo's webhook docs describe no split
   payments or payouts to third parties (owners). Either Dodo confirms a
   supported way to pay owners, or SpotSure collects as sole merchant and pays
   owners out separately (legal/tax review needed).
3. Confirm supported payment methods/currency for INR customers.
4. Server-side: create the checkout from the booking's snapshot amount; store
   the provider payment id in `payment_provider_ref`.
5. Webhook receiver: Dodo follows Standard Webhooks (`webhook-id`,
   `webhook-signature`, `webhook-timestamp`; HMAC-SHA256 over
   `id.timestamp.body`; reject stale timestamps). Verify on the raw body, dedupe
   on `webhook-id` (retries up to 8 times; events may arrive out of order), and
   apply only transitions `canTransitionPayment` allows. Confirm the exact event
   names (`payment.succeeded`, `payment.failed`, refund events) in Dodo's event catalog.
6. Cancellation of a paid booking must start a refund (not built).
7. Secrets (`DODO_*` API key, webhook secret) server-side only; test mode end to
   end before live keys.

### Cake Wallet

A self-custody consumer wallet, not a merchant processor. SpotSure has no
verified integration and the launch flow doesn't depend on it. Future use
(optional wallet linking for on-chain proofs) must never store seed phrases or
private keys.

## Notifications (in-app only)

Operational channel: **in-app only**. Stored in `notifications`
(`api/src/repositories/notifications.ts`), tested in
`api/test/notifications.test.ts` and `src/dashboards/notifications.test.tsx`.

| Event | Recipient |
| --- | --- |
| Booking request sent | Driver (`booking_requested`) and listing owner (`booking_request_received`) |
| Request confirmed / declined | Driver |
| Booking cancelled | The other party (says who cancelled) |
| Request expired unanswered | Driver |
| Starts within 2 hours (confirmed only) | Driver (`booking_reminder`) |
| Listing approved / needs changes | Owner (reviewer's note stays on the listing page) |

- Written in the same database transaction as the event, so failed or
  rolled-back actions notify nobody. A unique `(recipient, dedupe_key)` index
  makes retries and double submits harmless (one notification per event).
- Messages contain only the listing title and the booked time (in the
  listing's time zone). No address, entry instructions, driver identity,
  reviewer notes, payment data or tokens.
- API: `GET /me/notifications?limit=1..50&cursor=&unread=true`,
  `GET /me/notifications/unread-count`, `POST /me/notifications/:id/read`,
  `POST /me/notifications/read-all`. Recipient is always the session user;
  someone else's id answers 404. Links point to the booking or listing, whose
  own endpoints re-check access.
- Payment notifications: none, because no payment processing exists.

**Reminders have no scheduler.** There's no background job; reminders are
created when the user's app asks for notifications (on page load, navigation
and a 60-second poll while the tab is visible). A user who doesn't open
SpotSure in the 2 hours before a booking gets no reminder. Reliable reminders
need a scheduler (e.g. a cron hitting a job endpoint) plus an email/SMS/push
provider; neither is configured.

## Security hardening (Prompt 12)

Reviewed: auth/sessions, CSRF, CORS, headers, error handling, logging, every
route's authorisation, listing/booking/payment/notification integrity, search
queries, photo storage, tracked files for secrets. Not a full audit or pen test.

Fixed:

- **Confirming onto an inactive bay (Medium).** Confirmation tried the
  originally assigned bay without checking it was still active. Now only
  active, free bays qualify (`confirmBooking`).
- **Capacity cut racing a confirmation (Medium).** The "upcoming bookings"
  check before retiring bays could miss a confirmation committing at the same
  moment, leaving a confirmed booking on a retired bay (reproduced
  intermittently with the lock removed). Both now take a per-space advisory
  lock (`lockSpaceBays`).
- **Confirming on a listing that can't take bookings (Medium).** Unpublished,
  archived, back-in-review (e.g. moved) listings or suspended owners could
  still confirm pending requests, revealing an unverified address. Now 409
  `not_bookable`; declining/cancelling still works.

Tests: `api/test/security.test.ts` (401 sweep for later endpoints, admin-only
routes, cross-account booking actions, privileged listing fields, no forgeable
occupancy/payment ingestion, safe errors, the fixes above).

Already in place and tested: server-side session lookup on every request
(hashed tokens, rotation on sign-in, expiry, suspended accounts rejected),
strict request schemas (no client ids/roles/status/prices), ownership checks,
404 for private resources, Origin/Sec-Fetch-Site CSRF check + SameSite=Lax,
`__Host-` Secure cookies in production, helmet headers, 1 MB body limit, rate
limits, generic 500s and constraint errors, log redaction, DB exclusion
constraint against overlapping bookings, server-side pricing.

Not connected, so no attack surface yet: occupancy ingestion (Firebase/YOLO;
no route exists, device auth needed before one is added), TigerGraph (no trust
signals exist or affect bookings), payments (disabled).

Remaining risks:

- Login throttling is per IP only (no per-account lockout); no email
  verification or password reset.
- `TRUST_PROXY=true` must be set behind a reverse proxy, otherwise every user
  shares one rate-limit bucket (the proxy's IP).
- Photo storage is local disk; needs a persistent volume and backups.
- The owner-chosen listing title appears in notifications and pages (rendered
  as text by React, never as HTML).

## Excluded from the pilot

Payments, wallets, live occupancy/availability, sensors, video analysis, trust
scores, on-chain proofs, map search, email/SMS/push notifications, email verification,
password reset, society self-service onboarding.
