import { useState, type FormEvent } from "react";
import type { User } from "../app/api";
import { formatMoney, normaliseSearch, parseMoneyToMinor, todayIn, zonedToIso } from "../app/format";
import { Link, navigate, useLocation } from "../app/router";
import { PARKING_TYPE_LABEL, VEHICLE_LABEL, type ParkingType, type PublicListing, type VehicleClass } from "../app/types";
import { useApi } from "../app/useApi";
import { usePageTitle } from "../pages/Field";
import { Async, EmptyState, PageHeader, Section } from "../ui/ui";
import { BookingRequestForm } from "./booking";
import { PublicListingView, usePaged } from "./listings";

// Discovery runs entirely on the server: search text, filters, sort and the
// optional availability window become query parameters, and the URL is the
// source of truth so results can be shared and the back button works.
// No map provider is configured, so this is list-based by design.

const TZ = "Asia/Kolkata"; // Every current listing is in India; the API checks each listing's own zone.
const SORTS = { newest: "Newest", price_asc: "Price: low to high", price_desc: "Price: high to low", name: "Name" } as const;

interface Filters {
  q: string;
  type: "" | ParkingType;
  vehicle: "" | VehicleClass;
  priceMin: string;
  priceMax: string;
  date: string;
  from: string;
  until: string;
  sort: keyof typeof SORTS;
}

function readFilters(s: URLSearchParams): Filters {
  return {
    q: s.get("q") ?? "",
    type: (s.get("type") ?? "") as Filters["type"],
    vehicle: (s.get("vehicle") ?? "") as Filters["vehicle"],
    priceMin: s.get("priceMin") ?? "",
    priceMax: s.get("priceMax") ?? "",
    date: s.get("date") ?? "",
    from: s.get("from") ?? "",
    until: s.get("until") ?? "",
    sort: (s.get("sort") as Filters["sort"]) || "newest",
  };
}

/** Client-side checks with the same rules as the API, so obvious mistakes never round-trip. */
export function filterProblems(f: Filters): Partial<Record<keyof Filters, string>> {
  const p: Partial<Record<keyof Filters, string>> = {};
  const bad = (v: string) => Boolean(v.trim()) && Number.isNaN(parseMoneyToMinor(v));
  if (bad(f.priceMin)) p.priceMin = "Use a rupee amount, e.g. 40";
  if (bad(f.priceMax)) p.priceMax = "Use a rupee amount, e.g. 120";
  if (!p.priceMin && !p.priceMax && f.priceMin.trim() && f.priceMax.trim() && parseMoneyToMinor(f.priceMax) < parseMoneyToMinor(f.priceMin)) {
    p.priceMax = "Must be at least the minimum";
  }
  const anyTime = f.date || f.from || f.until;
  if (anyTime && !(f.date && f.from && f.until)) p.until = "Choose a date, start and end to check availability";
  if (f.date && f.from && f.until && f.until <= f.from) p.until = "End must be after the start";
  return p;
}

/** The API query for a set of filters (prices stay in rupees; times become UTC instants). */
export function searchQuery(f: Filters, page: number): string {
  const p = new URLSearchParams({ sort: f.sort, page: String(page), pageSize: "12" });
  const q = normaliseSearch(f.q);
  if (q) p.set("q", q);
  if (f.type) p.set("type", f.type);
  if (f.vehicle) p.set("vehicle", f.vehicle);
  // The API takes plain rupee amounts; "₹40" or "40 rupees" becomes "40".
  const rupees = (v: string) => String(parseMoneyToMinor(v) / 100);
  if (f.priceMin.trim()) p.set("priceMin", rupees(f.priceMin));
  if (f.priceMax.trim()) p.set("priceMax", rupees(f.priceMax));
  if (f.date && f.from && f.until) {
    p.set("startsAt", zonedToIso(f.date, f.from, TZ));
    p.set("endsAt", zonedToIso(f.date, f.until, TZ));
  }
  return p.toString();
}

const QUARTERS = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);

function ListingCard({ l, windowQs }: { l: PublicListing; windowQs: string }) {
  const cover = l.photos.find((p) => p.isCover) ?? l.photos[0];
  return (
    <li className="discover-card">
      <div className="discover-card__media">
        {cover ? <img src={cover.url} alt="" loading="lazy" /> : <span aria-hidden="true">No photo</span>}
      </div>
      <div className="discover-card__body">
        <Link href={`/app/discover/${l.id}${windowQs ? `?${windowQs}` : ""}`} className="discover-card__title">
          {l.name}
        </Link>
        <p className="listing-card__meta">{[l.area.locality, l.area.city].filter(Boolean).join(", ") || "Area not set"}</p>
        <p className="listing-card__meta">
          {PARKING_TYPE_LABEL[l.parkingType]} · {l.capacity} {l.capacity === 1 ? "space" : "spaces"}
        </p>
        <p className="listing-card__meta">{l.vehicleTypes.map((v) => VEHICLE_LABEL[v]).join(", ") || "Vehicles not specified"}</p>
        <p className="discover-card__price">
          {formatMoney(l.hourlyPrice.amountMinor, l.hourlyPrice.currency)}
          <span>/hr</span>
          {l.dailyPrice && <span> · {formatMoney(l.dailyPrice.amountMinor, l.dailyPrice.currency)}/day</span>}
        </p>
      </div>
    </li>
  );
}

export function Discover() {
  usePageTitle("Find parking");
  const { search } = useLocation();
  const applied = readFilters(search);
  const page = Math.max(1, Number(search.get("page")) || 1);
  const [f, setF] = useState<Filters>(applied);
  const [errors, setErrors] = useState<Partial<Record<keyof Filters, string>>>({});
  const appliedOk = Object.keys(filterProblems(applied)).length === 0;
  const results = usePaged<PublicListing>(`/parking-spaces?${searchQuery(appliedOk ? applied : { ...applied, date: "", from: "", until: "" }, page)}`);
  const windowParams = applied.date && applied.from && applied.until ? `date=${applied.date}&from=${applied.from}&until=${applied.until}` : "";
  const filtered =
    page > 1 || Boolean(applied.q || applied.type || applied.vehicle || applied.priceMin || applied.priceMax || windowParams);
  const ownerSignupUrl = `${window.location.origin}/register?role=parking_owner`;

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));

  function go(next: Filters, nextPage = 1) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v && !(k === "sort" && v === "newest")) p.set(k, v);
    if (nextPage > 1) p.set("page", String(nextPage));
    navigate(`/app/discover${p.toString() ? `?${p}` : ""}`, { replace: true });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const found = filterProblems(f);
    setErrors(found);
    if (Object.keys(found).length) return;
    go(f);
  }

  const clear = () => {
    const empty = readFilters(new URLSearchParams());
    setF(empty);
    setErrors({});
    go(empty);
  };

  const err = (k: keyof Filters) =>
    errors[k] ? (
      <p id={`f-${k}-error`} className="field__error">
        {errors[k]}
      </p>
    ) : null;
  const described = (k: keyof Filters) => (errors[k] ? { "aria-invalid": true, "aria-describedby": `f-${k}-error` } : {});

  return (
    <>
      <PageHeader title="Find parking" eyebrow="Discovery" />
      <form className="discover-filters" role="search" aria-label="Find parking" onSubmit={submit} noValidate>
        <div className="field discover-filters__q">
          <label className="field__label" htmlFor="f-q">
            Search
          </label>
          <input id="f-q" className="field__input" type="search" placeholder="Locality, city or name" value={f.q} onChange={(e) => set("q", e.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="f-type">
            Parking type
          </label>
          <select id="f-type" className="select" value={f.type} onChange={(e) => set("type", e.target.value as Filters["type"])}>
            <option value="">Any type</option>
            {Object.entries(PARKING_TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="f-vehicle">
            Your vehicle
          </label>
          <select id="f-vehicle" className="select" value={f.vehicle} onChange={(e) => set("vehicle", e.target.value as Filters["vehicle"])}>
            <option value="">Any vehicle</option>
            {Object.entries(VEHICLE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="f-priceMin">
            Min ₹/hr
          </label>
          <input id="f-priceMin" className="field__input" inputMode="decimal" value={f.priceMin} onChange={(e) => set("priceMin", e.target.value)} {...described("priceMin")} />
          {err("priceMin")}
        </div>
        <div className="field">
          <label className="field__label" htmlFor="f-priceMax">
            Max ₹/hr
          </label>
          <input id="f-priceMax" className="field__input" inputMode="decimal" value={f.priceMax} onChange={(e) => set("priceMax", e.target.value)} {...described("priceMax")} />
          {err("priceMax")}
        </div>
        <fieldset className="discover-filters__when">
          <legend className="field__label">Available on (optional)</legend>
          <div className="discover-filters__when-row">
            <input aria-label="Date" className="field__input" type="date" min={todayIn(TZ)} max={todayIn(TZ, 60)} value={f.date} onChange={(e) => set("date", e.target.value)} />
            <select aria-label="From" className="select" value={f.from} onChange={(e) => set("from", e.target.value)}>
              <option value="">From</option>
              {QUARTERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select aria-label="Until" className="select" value={f.until} onChange={(e) => set("until", e.target.value)} {...described("until")}>
              <option value="">Until</option>
              {QUARTERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {err("until")}
        </fieldset>
        <div className="field">
          <label className="field__label" htmlFor="f-sort">
            Sort by
          </label>
          <select id="f-sort" className="select" value={f.sort} onChange={(e) => set("sort", e.target.value as Filters["sort"])}>
            {Object.entries(SORTS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="form-actions discover-filters__actions">
          <button type="submit" className="btn-primary">
            Search
          </button>
          <button type="button" className="btn-plain" onClick={clear}>
            Clear
          </button>
        </div>
      </form>
      <p className="muted-text">
        Showing verified listings. {windowParams ? "Filtered to spaces open and free for your time." : ""} A map view isn't
        available yet.
      </p>
      <Section title="Results">
        <Async remote={results} skeletonLines={5}>
          {({ rows, page: meta }) =>
            rows.length ? (
              <>
                <p className="muted-text" aria-live="polite">
                  {meta.total} {meta.total === 1 ? "listing" : "listings"}
                </p>
                <ul className="discover-grid">
                  {rows.map((l) => (
                    <ListingCard key={l.id} l={l} windowQs={windowParams} />
                  ))}
                </ul>
                {meta.totalPages > 1 && (
                  <nav className="pager" aria-label="Pagination">
                    <button type="button" className="btn-plain" disabled={page <= 1} onClick={() => go(applied, page - 1)}>
                      Previous
                    </button>
                    <span>
                      Page {meta.page} of {meta.totalPages}
                    </span>
                    <button type="button" className="btn-plain" disabled={page >= meta.totalPages} onClick={() => go(applied, page + 1)}>
                      Next
                    </button>
                  </nav>
                )}
              </>
            ) : !filtered ? (
              // No supply at all: say so plainly and point owners at sign-up, never invent listings.
              <EmptyState
                title="No parking is listed yet"
                body={
                  <>
                    SpotSure is onboarding its first parking owners in the pilot. Verified spaces appear here as soon as they're
                    approved. Know someone with a driveway or garage to list? They can join as an owner at{" "}
                    <span className="mono">{ownerSignupUrl}</span>.
                  </>
                }
              />
            ) : (
              <EmptyState
                title="No parking matches"
                body={windowParams ? "Nothing is open and free for that time. Try another time or fewer filters." : "Try a different search or fewer filters."}
                action={
                  <button type="button" className="btn-plain" onClick={clear}>
                    Clear filters
                  </button>
                }
              />
            )
          }
        </Async>
      </Section>
    </>
  );
}

export function DiscoverListing({ id, user }: { id: string; user: User }) {
  usePageTitle("Listing");
  const { search } = useLocation();
  const listing = useApi<PublicListing>(`/parking-spaces/${id}`);
  const crumbs = [{ href: "/app/discover", label: "Find parking" }];
  if (listing.status === "error" && listing.error.status === 404) {
    return (
      <>
        <PageHeader title="Listing not available" breadcrumbs={crumbs} />
        <EmptyState title="This listing isn't available" body="It may have been unpublished or removed." />
      </>
    );
  }
  const preset = { date: search.get("date") ?? undefined, from: search.get("from") ?? undefined, until: search.get("until") ?? undefined };
  return (
    <>
      <PageHeader title={listing.status === "ready" ? listing.data.name : "Listing"} breadcrumbs={crumbs} />
      <div className="discover-detail">
        <Section title="Listing">
          <Async remote={listing}>{(l) => <PublicListingView listing={l} />}</Async>
        </Section>
        {listing.status === "ready" && (
          <Section title="Request a booking">
            {user.role === "driver" ? (
              <BookingRequestForm listing={listing.data} preset={preset} />
            ) : (
              <p className="muted-text">Booking requests are made from driver accounts.</p>
            )}
          </Section>
        )}
      </div>
    </>
  );
}
