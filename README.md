# SpotSure — landing page
 
Smart parking intelligence: live bay hardware (Firebase), YOLO computer vision on CCTV and mobile video, occupancy fusion, and a TigerGraph trust graph, with a marketplace and Web3 audit proofs planned.

```
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build to dist/
npm test           # vitest: scroll-motion maths and deck throw threshold
```

## Backend

The API lives in [`api/`](api/README.md) (Fastify + PostgreSQL); architecture and
conventions are in [docs/architecture.md](docs/architecture.md). Quick start:

```
npm --prefix api install
cp api/.env.example api/.env
npm run db:dev                      # Postgres on :5433 (or: docker compose up -d db)
npm --prefix api run db:migrate
npm run api:dev                     # http://127.0.0.1:4000/api/v1/health
npm run api:test
```

## Structure

| Path | Role |
| --- | --- |
| `src/data/content.ts` | All copy: capabilities (deck + roadmap), pipeline rows, bay states, nav links |
| `src/styles/tokens.css` | Colour, type, spacing and motion tokens (dark theme) |
| `src/styles/global.css` | Reset, shared type (`.label`, `.display`, `.h2`, `.lede`), one-shot reveal rules |
| `src/lib/motion.ts` | Pure scroll-to-frame maths for the portal hero (unit-tested) |
| `src/hooks/useScrollProgress.ts` | rAF-throttled scroll progress (`pin` for sticky spans, `through` for drift) |
| `src/hooks/useReveal.ts` | IntersectionObserver entry reveals that fire once |
| `src/components/PortalHero.*` | Panels part, image settles, wordmark grows + tightens + splits — all scroll-bound |
| `src/components/ScanSequence.*` | Pinned, scroll-scrubbed walkthrough of one bay being verified |
| `src/components/Marquee.*` | Counter-running layer bands that lean with scroll |
| `src/components/Cursor.*` | Dot + ring cursor and magnetic pull on `[data-magnetic]` (fine pointers only) |
| `src/components/CardDeck.*` | Throwable capability deck: drag, arrow keys, step buttons |
| `src/components/ParkingAerial.tsx` | Seeded SVG night render: detection overlays, moving cars, lamp flicker, vision sweep (illustrative) |

## Motion rules

- Everything in the portal is bound to scroll position, so it reverses when scrolling up.
- Entry reveals fire once and are scoped to `html.motion-ok`, which is only set when `prefers-reduced-motion` is not `reduce`. With reduced motion or no JS the page renders finished, with the portal open.

## Evidence rules

Nothing on the page is a live reading, booking, payment, blockchain record or AI result. The hero and deck art are illustrations and are labelled as such. Each capability's status is either "In development" or "Planned". Update `content.ts` when that changes.
