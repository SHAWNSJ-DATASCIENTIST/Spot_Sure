import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "../app/api";
import { compactDigits, formatMoney, formatRange, parseMoneyToMinor } from "../app/format";
import { Link, navigate, useLocation } from "../app/router";
import {
  PARKING_TYPE_LABEL,
  STATUS_LABEL,
  VEHICLE_LABEL,
  type Availability,
  type Booking,
  type ListingStatus,
  type OwnerAction,
  type OwnerListing,
  type OwnerListingSummary,
  type PageMeta,
  type ParkingType,
  type PublicListing,
  type VehicleClass,
} from "../app/types";
import { useApi, type Remote } from "../app/useApi";
import { Field, FormAlert, usePageTitle } from "../pages/Field";
import {
  Async,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  RecordList,
  Section,
  Skeleton,
  StatusBadge,
  type Column,
} from "../ui/ui";
import "./listings.css";

// ---------- shared bits ----------

export function ListingStatusBadge({ status }: { status: ListingStatus }) {
  return <StatusBadge status={status} label={STATUS_LABEL[status]} />;
}

const NewListing = () => (
  <Link href="/app/owner/spaces/new" className="btn-primary">
    New listing
  </Link>
);

const ownerCrumbs = [
  { href: "/app/owner", label: "Overview" },
  { href: "/app/owner/spaces", label: "My spaces" },
];

function place(a: { line?: string | null; locality: string | null; city: string | null; region: string | null }): string {
  return [a.line, a.locality, a.city, a.region].filter(Boolean).join(", ") || "No address yet";
}

const duration = (m: number) => (m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? "" : "s"}` : m % 60 === 0 ? `${m / 60} h` : `${m} min`);

// ---------- owner listing list ----------

/** Like useApi, for endpoints that return `{ data, page }`. */
export function usePaged<T>(path: string): Remote<{ rows: T[]; page: PageMeta }> & { reload: () => void } {
  const [state, setState] = useState<Remote<{ rows: T[]; page: PageMeta }>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    api<{ data: T[]; page: PageMeta }>(path)
      .then((r) => live && setState({ status: "ready", data: { rows: r.data, page: r.page } }))
      .catch((err) => {
        if (live) setState({ status: "error", error: err instanceof ApiError ? err : new ApiError(0, "unknown_error", "Something went wrong.") });
      });
    return () => {
      live = false;
    };
  }, [path, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

const STATUS_FILTERS: ("" | ListingStatus)[] = ["", "draft", "pending_verification", "published", "unpublished", "archived"];

export function OwnerListings() {
  usePageTitle("My spaces");
  const { search } = useLocation();
  const [q, setQ] = useState(search.get("q") ?? "");
  const status = (search.get("status") ?? "") as "" | ListingStatus;
  const page = Math.max(1, Number(search.get("page")) || 1);
  const params = new URLSearchParams({ page: String(page), pageSize: "10" });
  if (status) params.set("status", status);
  if (search.get("q")) params.set("q", search.get("q")!);
  const list = usePaged<OwnerListingSummary>(`/me/parking-spaces?${params}`);

  function go(next: { q?: string; status?: string; page?: number }) {
    const p = new URLSearchParams();
    const nq = next.q ?? search.get("q") ?? "";
    const ns = next.status ?? status;
    if (nq) p.set("q", nq);
    if (ns) p.set("status", ns);
    if ((next.page ?? 1) > 1) p.set("page", String(next.page));
    navigate(`/app/owner/spaces${p.toString() ? `?${p}` : ""}`, { replace: true });
  }

  const filtered = Boolean(status || search.get("q"));

  return (
    <>
      <PageHeader title="My spaces" breadcrumbs={[{ href: "/app/owner", label: "Overview" }]} actions={<NewListing />} />
      <form
        className="filters"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go({ q: q.trim(), page: 1 });
        }}
      >
        <div className="filters__search">
          <label className="field__label" htmlFor="listing-search">
            Search
          </label>
          <input
            id="listing-search"
            className="field__input"
            type="search"
            placeholder="Title, locality or city"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="filters__status">
          <label className="field__label" htmlFor="listing-status">
            Status
          </label>
          <select
            id="listing-status"
            className="select"
            value={status}
            onChange={(e) => go({ status: e.target.value, page: 1 })}
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s ? STATUS_LABEL[s] : "All statuses"}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-plain">
          Search
        </button>
      </form>
      <Section title="Listings">
        <Async remote={list} skeletonLines={5}>
          {({ rows, page: meta }) =>
            rows.length ? (
              <>
                <ul className="listing-cards">
                  {rows.map((l) => (
                    <li key={l.id} className="listing-card">
                      <div className="listing-card__media" aria-hidden="true">
                        {l.coverPhotoUrl ? <img src={l.coverPhotoUrl} alt="" loading="lazy" /> : <span>No photo</span>}
                      </div>
                      <div className="listing-card__body">
                        <div className="listing-card__top">
                          <Link href={`/app/owner/spaces/${l.id}`} className="listing-card__title">
                            {l.name}
                          </Link>
                          <ListingStatusBadge status={l.status} />
                        </div>
                        <p className="listing-card__meta">{place(l.address)}</p>
                        <p className="listing-card__meta">
                          {PARKING_TYPE_LABEL[l.parkingType]} · {l.capacity} {l.capacity === 1 ? "space" : "spaces"} ·{" "}
                          {formatMoney(l.hourlyPrice.amountMinor, l.hourlyPrice.currency)}/hr
                          {l.verified ? " · Verified" : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
                {meta.totalPages > 1 && (
                  <nav className="pager" aria-label="Pagination">
                    <button type="button" className="btn-plain" disabled={page <= 1} onClick={() => go({ page: page - 1 })}>
                      Previous
                    </button>
                    <span aria-live="polite">
                      Page {meta.page} of {meta.totalPages} · {meta.total} listings
                    </span>
                    <button
                      type="button"
                      className="btn-plain"
                      disabled={page >= meta.totalPages}
                      onClick={() => go({ page: page + 1 })}
                    >
                      Next
                    </button>
                  </nav>
                )}
              </>
            ) : filtered ? (
              <EmptyState title="No listings match" body="Try a different search or status." />
            ) : (
              <EmptyState title="No listings yet" body="Create your first listing to get started." action={<NewListing />} />
            )
          }
        </Async>
      </Section>
    </>
  );
}

// ---------- listing form ----------

interface Draft {
  name: string;
  parkingType: ParkingType;
  description: string;
  addressLine: string;
  locality: string;
  city: string;
  region: string;
  postalCode: string;
  latitude: string;
  longitude: string;
  vehicleTypes: VehicleClass[];
  capacity: string;
  maxHeightCm: string;
  maxLengthCm: string;
  maxWidthCm: string;
  price: string;
  dailyPrice: string;
  minBookingMinutes: string;
  maxBookingMinutes: string;
  entryInstructions: string;
  parkingRules: string;
  accessibilityInfo: string;
  restrictions: string;
}
type DraftKey = keyof Draft;
type Errors = Partial<Record<DraftKey, string>>;

const EMPTY: Draft = {
  name: "",
  parkingType: "private_driveway",
  description: "",
  addressLine: "",
  locality: "",
  city: "",
  region: "",
  postalCode: "",
  latitude: "",
  longitude: "",
  vehicleTypes: ["car"],
  capacity: "1",
  maxHeightCm: "",
  maxLengthCm: "",
  maxWidthCm: "",
  price: "",
  dailyPrice: "",
  minBookingMinutes: "60",
  maxBookingMinutes: "",
  entryInstructions: "",
  parkingRules: "",
  accessibilityInfo: "",
  restrictions: "",
};

const s = (v: string | number | null | undefined) => (v == null ? "" : String(v));

function draftOf(l: OwnerListing): Draft {
  return {
    name: l.name,
    parkingType: l.parkingType,
    description: s(l.description),
    addressLine: s(l.address.line),
    locality: s(l.address.locality),
    city: s(l.address.city),
    region: s(l.address.region),
    postalCode: s(l.address.postalCode),
    latitude: s(l.location?.latitude),
    longitude: s(l.location?.longitude),
    vehicleTypes: l.vehicleTypes,
    capacity: String(l.capacity),
    maxHeightCm: s(l.maxDimensionsCm.height),
    maxLengthCm: s(l.maxDimensionsCm.length),
    maxWidthCm: s(l.maxDimensionsCm.width),
    price: String(l.hourlyPrice.amountMinor / 100),
    dailyPrice: l.dailyPrice ? String(l.dailyPrice.amountMinor / 100) : "",
    minBookingMinutes: String(l.bookingMinutes.min),
    maxBookingMinutes: s(l.bookingMinutes.max),
    entryInstructions: s(l.entryInstructions),
    parkingRules: s(l.parkingRules),
    accessibilityInfo: s(l.accessibilityInfo),
    restrictions: s(l.restrictions),
  };
}

const MIN_OPTIONS = [15, 30, 60, 120, 180, 240, 360, 720, 1440];
const MAX_OPTIONS = [60, 120, 240, 480, 720, 1440, 2880, 10080, 43200];

function intIn(v: string, lo: number, hi: number): number | null | "bad" {
  if (!v.trim()) return null;
  if (!/^\d+$/.test(v.trim())) return "bad";
  const n = Number(v);
  return n < lo || n > hi ? "bad" : n;
}

/** Mirrors the API's rules for fast feedback; the API re-validates everything. */
export function validateDraft(d: Draft): { errors: Errors; body: Record<string, unknown> } {
  const errors: Errors = {};
  const body: Record<string, unknown> = {};
  const text = (k: DraftKey, max: number) => {
    const v = (d[k] as string).trim();
    if (v.length > max) errors[k] = `At most ${max} characters`;
    return v || null;
  };

  const name = d.name.trim();
  if (name.length < 3) errors.name = "Give the listing a title of at least 3 characters";
  else if (name.length > 120) errors.name = "At most 120 characters";
  body.name = name;
  body.parkingType = d.parkingType;
  body.description = text("description", 2000);
  body.addressLine = text("addressLine", 200);
  body.locality = text("locality", 100);
  body.city = text("city", 100);
  body.region = text("region", 100);
  const pin = compactDigits(d.postalCode);
  if (pin && !/^\d{6}$/.test(pin)) errors.postalCode = "Use a 6-digit PIN code";
  body.postalCode = pin || null;

  const lat = d.latitude.trim();
  const lng = d.longitude.trim();
  if (Boolean(lat) !== Boolean(lng)) errors.longitude = "Give both latitude and longitude, or neither";
  const latN = Number(lat);
  const lngN = Number(lng);
  if (lat && (!Number.isFinite(latN) || latN < -90 || latN > 90)) errors.latitude = "Between -90 and 90";
  if (lng && (!Number.isFinite(lngN) || lngN < -180 || lngN > 180)) errors.longitude = "Between -180 and 180";
  body.latitude = lat ? latN : null;
  body.longitude = lng ? lngN : null;

  if (!d.vehicleTypes.length) errors.vehicleTypes = "Choose at least one vehicle type";
  body.vehicleTypes = d.vehicleTypes;
  const cap = intIn(d.capacity, 1, 500);
  if (cap === null || cap === "bad") errors.capacity = "Enter a whole number of spaces from 1 to 500";
  else body.capacity = cap;
  for (const [k, lo, hi] of [
    ["maxHeightCm", 100, 600],
    ["maxLengthCm", 150, 2000],
    ["maxWidthCm", 80, 400],
  ] as const) {
    const v = intIn(d[k], lo, hi);
    if (v === "bad") errors[k] = `A whole number from ${lo} to ${hi} cm`;
    else body[k] = v;
  }

  const price = parseMoneyToMinor(d.price);
  if (Number.isNaN(price)) errors.price = "Enter an hourly price in rupees, e.g. 40 or 40.50";
  else body.hourlyPriceMinor = price;
  if (d.dailyPrice.trim()) {
    const daily = parseMoneyToMinor(d.dailyPrice);
    if (Number.isNaN(daily)) errors.dailyPrice = "Enter a daily price in rupees, or leave it blank";
    else body.dailyPriceMinor = daily;
  } else body.dailyPriceMinor = null;

  const min = Number(d.minBookingMinutes);
  const max = d.maxBookingMinutes ? Number(d.maxBookingMinutes) : null;
  if (max !== null && max < min) errors.maxBookingMinutes = "Must be at least the minimum booking time";
  body.minBookingMinutes = min;
  body.maxBookingMinutes = max;

  body.entryInstructions = text("entryInstructions", 2000);
  body.parkingRules = text("parkingRules", 2000);
  body.accessibilityInfo = text("accessibilityInfo", 1000);
  body.restrictions = text("restrictions", 1000);
  return { errors, body };
}

const SERVER_FIELD: Record<string, DraftKey> = {
  hourlyPriceMinor: "price",
  dailyPriceMinor: "dailyPrice",
};
const LOCATION_KEYS: DraftKey[] = ["addressLine", "locality", "city", "region", "postalCode", "latitude", "longitude", "parkingType"];

function TextArea({ id, label, hint, value, onChange, error, max }: { id: string; label: string; hint?: ReactNode; value: string; onChange: (v: string) => void; error?: string; max: number }) {
  // Near the limit, show a live count: long dictated text is never cut off silently.
  const counter = value.length > max * 0.9;
  return (
    <div className={`field span-all ${error ? "field--invalid" : ""}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint || counter ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined}
      />
      {(hint || counter) && (
        <p id={`${id}-hint`} className="field__hint">
          {hint}
          {counter && ` ${value.length} / ${max} characters`}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="field__error">
          {error}
        </p>
      )}
    </div>
  );
}

export function ListingForm({
  initial,
  verified,
  submitLabel,
  onSave,
}: {
  initial: Draft;
  /** When true, location edits send the listing back to review; the owner is warned first. */
  verified: boolean;
  submitLabel: string;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [d, setD] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmMove, setConfirmMove] = useState<Record<string, unknown> | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const set = <K extends DraftKey>(k: K, v: Draft[K]) => {
    setSaved(false);
    setD((x) => ({ ...x, [k]: v }));
  };
  const bind = (k: DraftKey) => ({
    id: `listing-${k}`,
    value: d[k] as string,
    error: errors[k],
    onChange: (e: { target: { value: string } }) => set(k, e.target.value),
  });

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setFormError(undefined);
    try {
      await onSave(body);
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.details.length) {
        const mapped: Errors = {};
        for (const det of err.details) {
          const key = (SERVER_FIELD[det.path] ?? det.path) as DraftKey;
          if (key in EMPTY) mapped[key] ??= det.message;
        }
        setErrors(mapped);
        setFormError("Please fix the highlighted fields.");
      } else {
        setFormError(err instanceof ApiError ? err.message : "Couldn't save. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const { errors: found, body } = validateDraft(d);
    setErrors(found);
    setSaved(false);
    const first = Object.keys(found)[0];
    if (first) {
      setFormError("Please fix the highlighted fields.");
      formRef.current?.querySelector<HTMLElement>(`#listing-${first}`)?.focus();
      return;
    }
    if (verified && LOCATION_KEYS.some((k) => String(d[k]) !== String(initial[k]))) {
      setConfirmMove(body);
      return;
    }
    void save(body);
  }

  const toggleVehicle = (v: VehicleClass) =>
    set("vehicleTypes", d.vehicleTypes.includes(v) ? d.vehicleTypes.filter((x) => x !== v) : [...d.vehicleTypes, v]);

  return (
    <form ref={formRef} onSubmit={submit} noValidate aria-busy={busy} className="listing-form">
      {formError && <FormAlert>{formError}</FormAlert>}

      <fieldset className="form-section">
        <legend className="form-section__title">Basics</legend>
        <div className="form-grid">
          <div className="span-all">
            <Field label="Listing title" required {...bind("name")} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="listing-parkingType">
              Parking type
            </label>
            <select id="listing-parkingType" className="select" value={d.parkingType} onChange={(e) => set("parkingType", e.target.value as ParkingType)}>
              {Object.entries(PARKING_TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <TextArea id="listing-description" label="Description" max={2000} value={d.description} error={errors.description} onChange={(v) => set("description", v)} />
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend className="form-section__title">Location</legend>
        <p className="muted-text">Drivers see only the locality and city until they book. The street address stays private.</p>
        <div className="form-grid">
          <div className="span-all">
            <Field label="Street address" autoComplete="street-address" {...bind("addressLine")} />
          </div>
          <Field label="Locality / neighbourhood" {...bind("locality")} />
          <Field label="City" autoComplete="address-level2" {...bind("city")} />
          <Field label="State" autoComplete="address-level1" {...bind("region")} />
          <Field label="PIN code" inputMode="numeric" autoComplete="postal-code" {...bind("postalCode")} />
          <Field label="Latitude" inputMode="decimal" hint="Optional" {...bind("latitude")} />
          <Field label="Longitude" inputMode="decimal" hint="Optional" {...bind("longitude")} />
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend className="form-section__title">Vehicles and capacity</legend>
        <div className="form-grid">
          <fieldset className={`span-all chips ${errors.vehicleTypes ? "field--invalid" : ""}`} aria-describedby={errors.vehicleTypes ? "listing-vehicleTypes-error" : undefined}>
            <legend className="field__label">Vehicles that fit</legend>
            <div className="chips__row" id="listing-vehicleTypes" tabIndex={-1}>
              {(Object.keys(VEHICLE_LABEL) as VehicleClass[]).map((v) => (
                <label key={v} className={`chip ${d.vehicleTypes.includes(v) ? "is-on" : ""}`}>
                  <input type="checkbox" checked={d.vehicleTypes.includes(v)} onChange={() => toggleVehicle(v)} />
                  {VEHICLE_LABEL[v]}
                </label>
              ))}
            </div>
            {errors.vehicleTypes && (
              <p id="listing-vehicleTypes-error" className="field__error">
                {errors.vehicleTypes}
              </p>
            )}
          </fieldset>
          <Field label="Number of spaces" inputMode="numeric" hint="Each space can be booked separately." {...bind("capacity")} />
          <Field label="Max vehicle height (cm)" inputMode="numeric" hint="Optional" {...bind("maxHeightCm")} />
          <Field label="Max vehicle length (cm)" inputMode="numeric" hint="Optional" {...bind("maxLengthCm")} />
          <Field label="Max vehicle width (cm)" inputMode="numeric" hint="Optional" {...bind("maxWidthCm")} />
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend className="form-section__title">Pricing and booking length</legend>
        <div className="form-grid">
          <Field label="Hourly price (₹)" inputMode="decimal" required {...bind("price")} />
          <Field label="Daily price (₹)" inputMode="decimal" hint="Optional" {...bind("dailyPrice")} />
          <div className="field">
            <label className="field__label" htmlFor="listing-minBookingMinutes">
              Shortest booking
            </label>
            <select id="listing-minBookingMinutes" className="select" value={d.minBookingMinutes} onChange={(e) => set("minBookingMinutes", e.target.value)}>
              {MIN_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {duration(m)}
                </option>
              ))}
            </select>
          </div>
          <div className={`field ${errors.maxBookingMinutes ? "field--invalid" : ""}`}>
            <label className="field__label" htmlFor="listing-maxBookingMinutes">
              Longest booking
            </label>
            <select
              id="listing-maxBookingMinutes"
              className="select"
              value={d.maxBookingMinutes}
              onChange={(e) => set("maxBookingMinutes", e.target.value)}
              aria-describedby={errors.maxBookingMinutes ? "listing-maxBookingMinutes-error" : undefined}
            >
              <option value="">No limit</option>
              {MAX_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {duration(m)}
                </option>
              ))}
            </select>
            {errors.maxBookingMinutes && (
              <p id="listing-maxBookingMinutes-error" className="field__error">
                {errors.maxBookingMinutes}
              </p>
            )}
          </div>
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend className="form-section__title">Access and rules</legend>
        <div className="form-grid">
          <TextArea
            id="listing-entryInstructions"
            label="Entry instructions"
            hint="Private. Never shown publicly; meant for confirmed bookings once booking launches."
            max={2000}
            value={d.entryInstructions}
            error={errors.entryInstructions}
            onChange={(v) => set("entryInstructions", v)}
          />
          <TextArea id="listing-parkingRules" label="Parking rules" max={2000} value={d.parkingRules} error={errors.parkingRules} onChange={(v) => set("parkingRules", v)} />
          <TextArea id="listing-accessibilityInfo" label="Accessibility" max={1000} value={d.accessibilityInfo} error={errors.accessibilityInfo} onChange={(v) => set("accessibilityInfo", v)} />
          <TextArea id="listing-restrictions" label="Restrictions" max={1000} value={d.restrictions} error={errors.restrictions} onChange={(v) => set("restrictions", v)} />
        </div>
      </fieldset>

      <div className="form-actions listing-form__actions">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
        {saved && (
          <span className="form-success" role="status">
            Saved.
          </span>
        )}
      </div>

      <ConfirmDialog
        open={confirmMove !== null}
        title="Send this listing back to review?"
        body="You changed where the space is or what kind it is. SpotSure will need to verify it again, and it won't be visible to drivers until then."
        confirmLabel="Save and re-submit"
        busy={busy}
        onCancel={() => setConfirmMove(null)}
        onConfirm={() => {
          const body = confirmMove!;
          setConfirmMove(null);
          void save(body);
        }}
      />
    </form>
  );
}

export function OwnerListingNew() {
  usePageTitle("New listing");
  return (
    <>
      <PageHeader title="New listing" breadcrumbs={ownerCrumbs} />
      <p className="dev-note">
        Listings are saved as drafts. Add opening hours and photos next, then submit the listing for review. Drivers only see it after
        SpotSure has verified it.
      </p>
      <ListingForm
        initial={EMPTY}
        verified={false}
        submitLabel="Save draft"
        onSave={async (body) => {
          const { data } = await api<{ data: OwnerListing }>("/parking-spaces", { method: "POST", body });
          navigate(`/app/owner/spaces/${data.id}`, { replace: true });
        }}
      />
    </>
  );
}

// ---------- opening hours ----------

const DAY_LABEL: Record<Availability["weekly"][number]["day"], string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

function HoursEditor({ listing, onSaved }: { listing: OwnerListing; onSaved: () => void }) {
  const [tz, setTz] = useState(listing.availability?.timezone ?? "Asia/Kolkata");
  const [rows, setRows] = useState<Availability["weekly"]>(listing.availability?.weekly ?? []);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);
  const update = (i: number, patch: Partial<Availability["weekly"][number]>) =>
    setRows((r) => r.map((w, k) => (k === i ? { ...w, ...patch } : w)));

  async function save(body: Availability | null) {
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      await api(`/parking-spaces/${listing.id}/availability`, { method: "PUT", body });
      setStatus(body ? "Hours saved." : "Hours cleared.");
      if (!body) setRows([]);
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError && err.details.length
          ? err.details.map((d) => d.message).join(". ")
          : err instanceof ApiError
            ? err.message
            : "Couldn't save hours.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hours">
      {error && <FormAlert>{error}</FormAlert>}
      <Field label="Time zone" value={tz} onChange={(e) => setTz(e.target.value)} hint="IANA name, e.g. Asia/Kolkata" />
      {rows.length === 0 && <p className="muted-text">No opening hours set. Add a window for each period the space is open.</p>}
      <ul className="hours__list">
        {rows.map((w, i) => (
          <li key={i} className="hours__row">
            <div className="field">
              <label className="field__label" htmlFor={`day-${i}`}>
                Day
              </label>
              <select id={`day-${i}`} className="select" value={w.day} onChange={(e) => update(i, { day: e.target.value as typeof w.day })}>
                {Object.entries(DAY_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <Field label="Opens" type="time" value={w.opens} onChange={(e) => update(i, { opens: e.target.value })} />
            <Field label="Closes" type="time" value={w.closes} onChange={(e) => update(i, { closes: e.target.value })} />
            <button
              type="button"
              className="btn-plain hours__remove"
              onClick={() => setRows((r) => r.filter((_, k) => k !== i))}
              aria-label={`Remove ${DAY_LABEL[w.day]} ${w.opens}–${w.closes}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="form-actions">
        <button type="button" className="btn-plain" onClick={() => setRows((r) => [...r, { day: "mon", opens: "09:00", closes: "18:00" }])}>
          Add window
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => save({ timezone: tz.trim(), weekly: rows })}>
          {busy ? "Saving…" : "Save hours"}
        </button>
        {listing.availability && (
          <button type="button" className="btn-plain" disabled={busy} onClick={() => save(null)}>
            Clear hours
          </button>
        )}
        {status && (
          <span className="form-success" role="status">
            {status}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- photos ----------

const PHOTO_TYPES = ["image/jpeg", "image/png"];
const PHOTO_MAX_BYTES = 5_000_000;
const MAX_PHOTOS = 10;

export function photoProblem(file: { type: string; size: number }): string | undefined {
  if (!PHOTO_TYPES.includes(file.type)) return "Use a JPEG or PNG image";
  if (file.size > PHOTO_MAX_BYTES) return "Images can be at most 5 MB";
}

function PhotoManager({ listing, onChange }: { listing: OwnerListing; onChange: () => void }) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [removing, setRemoving] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const room = MAX_PHOTOS - listing.photos.length;

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(undefined);
    const list = [...files].slice(0, room);
    const bad = list.map((f) => [f.name, photoProblem(f)] as const).find(([, p]) => p);
    if (bad) {
      setError(`${bad[0]}: ${bad[1]}`);
      return;
    }
    try {
      for (let i = 0; i < list.length; i++) {
        setBusy(`Uploading ${i + 1} of ${list.length}…`);
        await api(`/parking-spaces/${listing.id}/photos`, { method: "POST", file: list[i] });
      }
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
      onChange();
    } finally {
      setBusy(undefined);
      if (input.current) input.current.value = "";
    }
  }

  async function act(path: string, method: string, label: string) {
    setBusy(label);
    setError(undefined);
    try {
      await api(path, { method });
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work.");
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="photos">
      {error && <FormAlert>{error}</FormAlert>}
      {listing.photos.length ? (
        <ul className="photos__grid">
          {listing.photos.map((p, i) => (
            <li key={p.id} className={`photos__item ${p.isCover ? "is-cover" : ""}`}>
              <img src={p.url} alt={`Photo ${i + 1} of ${listing.name}${p.isCover ? " (cover)" : ""}`} loading="lazy" />
              <div className="photos__actions">
                {p.isCover ? (
                  <span className="photos__cover">Cover</span>
                ) : (
                  <button
                    type="button"
                    className="btn-plain"
                    disabled={Boolean(busy)}
                    onClick={() => act(`/parking-spaces/${listing.id}/photos/${p.id}/cover`, "PUT", "Updating cover…")}
                  >
                    Make cover
                  </button>
                )}
                <button type="button" className="btn-plain" disabled={Boolean(busy)} onClick={() => setRemoving(p.id)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted-text">No photos yet. Clear photos of the entrance and the space help review and drivers.</p>
      )}
      <div className="form-actions">
        <label className={`btn-plain photos__pick ${room <= 0 || busy ? "is-disabled" : ""}`}>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png"
            multiple
            disabled={room <= 0 || Boolean(busy)}
            onChange={(e) => upload(e.target.files)}
          />
          Add photos
        </label>
        <span className="muted-text" role="status">
          {busy ?? `JPEG or PNG, up to 5 MB each. ${room} of ${MAX_PHOTOS} left. Location data is removed on upload.`}
        </span>
      </div>
      <ConfirmDialog
        open={removing !== null}
        title="Remove this photo?"
        body="It will be deleted from the listing. This can't be undone."
        confirmLabel="Remove photo"
        busy={Boolean(busy)}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const id = removing!;
          setRemoving(null);
          void act(`/parking-spaces/${listing.id}/photos/${id}`, "DELETE", "Removing…");
        }}
      />
    </div>
  );
}

// ---------- public view (preview + discovery) ----------

export function PublicListingView({ listing }: { listing: PublicListing }) {
  const cover = listing.photos.find((p) => p.isCover) ?? listing.photos[0];
  const rest = listing.photos.filter((p) => p !== cover);
  return (
    <article className="public-listing" aria-label={`${listing.name} listing`}>
      {cover ? (
        <div className="public-listing__gallery">
          <img className="public-listing__cover" src={cover.url} alt={`${listing.name}, cover photo`} />
          {rest.length > 0 && (
            <ul className="public-listing__thumbs">
              {rest.map((p, i) => (
                <li key={p.id}>
                  <img src={p.url} alt={`${listing.name}, photo ${i + 2}`} loading="lazy" />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="public-listing__nophoto">No photos yet</div>
      )}
      <div className="public-listing__head">
        <p className="label">{PARKING_TYPE_LABEL[listing.parkingType]}</p>
        <h2 className="public-listing__title">{listing.name}</h2>
        <p className="muted-text">{[listing.area.locality, listing.area.city, listing.area.region].filter(Boolean).join(", ") || "Area not set"}</p>
      </div>
      <dl className="facts">
        <dt>Price</dt>
        <dd>
          {formatMoney(listing.hourlyPrice.amountMinor, listing.hourlyPrice.currency)}/hr
          {listing.dailyPrice && ` · ${formatMoney(listing.dailyPrice.amountMinor, listing.dailyPrice.currency)}/day`}
        </dd>
        <dt>Spaces</dt>
        <dd>{listing.capacity}</dd>
        <dt>Vehicles</dt>
        <dd>{listing.vehicleTypes.length ? listing.vehicleTypes.map((v) => VEHICLE_LABEL[v]).join(", ") : "Not specified"}</dd>
        {(listing.maxDimensionsCm.height || listing.maxDimensionsCm.length || listing.maxDimensionsCm.width) && (
          <>
            <dt>Size limits</dt>
            <dd>
              {[
                listing.maxDimensionsCm.height && `height ${listing.maxDimensionsCm.height} cm`,
                listing.maxDimensionsCm.length && `length ${listing.maxDimensionsCm.length} cm`,
                listing.maxDimensionsCm.width && `width ${listing.maxDimensionsCm.width} cm`,
              ]
                .filter(Boolean)
                .join(", ")}
            </dd>
          </>
        )}
        <dt>Booking length</dt>
        <dd>
          {duration(listing.bookingMinutes.min)} minimum
          {listing.bookingMinutes.max ? `, ${duration(listing.bookingMinutes.max)} maximum` : ", no maximum"}
        </dd>
        <dt>Opening hours</dt>
        <dd>
          {listing.availability ? (
            <ul className="plain-list">
              {listing.availability.weekly.map((w, i) => (
                <li key={i}>
                  {DAY_LABEL[w.day]} {w.opens}–{w.closes}
                </li>
              ))}
              <li className="muted-text">Times in {listing.availability.timezone}</li>
            </ul>
          ) : (
            "Not set"
          )}
        </dd>
      </dl>
      {listing.description && <p className="public-listing__text">{listing.description}</p>}
      {(
        [
          ["Parking rules", listing.parkingRules],
          ["Accessibility", listing.accessibilityInfo],
          ["Restrictions", listing.restrictions],
        ] as const
      )
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k} className="public-listing__block">
            <h3 className="section-card__title">{k}</h3>
            <p className="public-listing__text">{v}</p>
          </div>
        ))}
      <p className="muted-text">The exact address and entry instructions aren't shown publicly.</p>
    </article>
  );
}

// ---------- listing detail (owner) ----------

const STATUS_HELP: Record<ListingStatus, string> = {
  draft: "Only you can see this draft. Complete it, then submit it for review.",
  pending_verification: "SpotSure is reviewing this listing. It isn't visible to drivers yet.",
  published: "Drivers can see this listing.",
  unpublished: "Hidden from drivers. Publish it again whenever you're ready.",
  archived: "Archived listings are hidden and can't be edited. Past bookings are kept.",
};

interface ActionSpec {
  action: OwnerAction;
  label: string;
  tone: "primary" | "plain" | "danger";
  confirm?: { title: string; body: string; confirmLabel: string };
}

function actionsFor(l: OwnerListing): ActionSpec[] {
  const archive: ActionSpec = {
    action: "archive",
    label: "Archive",
    tone: "danger",
    confirm: {
      title: "Archive this listing?",
      body: "It will be hidden from drivers and locked for editing. Past bookings are kept. You can restore it later.",
      confirmLabel: "Archive listing",
    },
  };
  const submit: ActionSpec = {
    action: "submit",
    label: "Submit for review",
    tone: "primary",
    confirm: {
      title: "Submit for review?",
      body: "SpotSure staff will check the listing details and photos. It becomes visible to drivers once approved.",
      confirmLabel: "Submit",
    },
  };
  switch (l.status) {
    case "draft":
      return [submit, archive];
    case "pending_verification":
      return [{ action: "withdraw", label: "Withdraw submission", tone: "plain" }, archive];
    case "published":
      return [
        {
          action: "unpublish",
          label: "Unpublish",
          tone: "plain",
          confirm: { title: "Unpublish this listing?", body: "Drivers will no longer see it. You can publish it again later.", confirmLabel: "Unpublish" },
        },
        archive,
      ];
    case "unpublished":
      return [l.verified ? { action: "publish", label: "Publish", tone: "primary" } : submit, archive];
    case "archived":
      return [{ action: "restore", label: "Restore", tone: "plain" }];
  }
}

export function OwnerListingDetail({ id }: { id: string }) {
  usePageTitle("Listing");
  const listing = useApi<OwnerListing>(`/me/parking-spaces/${id}`);
  const bookings = useApi<Booking[]>(listing.status === "ready" ? `/parking-spaces/${id}/bookings` : null);
  const [tab, setTab] = useState<"details" | "hours" | "photos" | "preview" | "bookings">("details");
  const preview = useApi<PublicListing>(tab === "preview" ? `/parking-spaces/${id}/preview` : null);
  const [pending, setPending] = useState<ActionSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<{ message: string; issues: string[] }>();

  if (listing.status === "error" && (listing.error.status === 403 || listing.error.status === 404)) {
    return (
      <>
        <PageHeader title="Listing not found" breadcrumbs={ownerCrumbs} />
        <Section title="Listing">
          <EmptyState title="This listing isn't one of yours" body="It may have been removed, or it belongs to another owner." />
        </Section>
      </>
    );
  }
  if (listing.status !== "ready") {
    return (
      <>
        <PageHeader title="Listing" breadcrumbs={ownerCrumbs} />
        <Section title="Listing">
          <Async remote={listing}>{() => null}</Async>
        </Section>
      </>
    );
  }
  const l = listing.data;

  async function run(spec: ActionSpec) {
    setBusy(true);
    setActionError(undefined);
    try {
      await api(`/parking-spaces/${id}/actions`, { method: "POST", body: { action: spec.action } });
      setPending(null);
      listing.reload();
    } catch (err) {
      setPending(null);
      setActionError(
        err instanceof ApiError
          ? { message: err.message, issues: err.details.map((d) => d.message) }
          : { message: "That didn't work. Please try again.", issues: [] },
      );
    } finally {
      setBusy(false);
    }
  }

  const tabs = [
    ["details", "Details"],
    ["hours", "Opening hours"],
    ["photos", `Photos (${l.photos.length})`],
    ["preview", "Preview"],
    ["bookings", "Bookings"],
  ] as const;

  return (
    <>
      <PageHeader
        title={l.name}
        breadcrumbs={ownerCrumbs}
        actions={actionsFor(l).map((a) => (
          <button
            key={a.action}
            type="button"
            className={a.tone === "danger" ? "btn-danger" : a.tone === "primary" ? "btn-primary" : "btn-plain"}
            disabled={busy}
            onClick={() => (a.confirm ? setPending(a) : run(a))}
          >
            {a.label}
          </button>
        ))}
      />
      {actionError && (
        <FormAlert>
          {actionError.message}
          {actionError.issues.length > 0 && (
            <ul className="plain-list">
              {actionError.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
        </FormAlert>
      )}

      <Section title="Status">
        <div className="status-panel">
          <div className="status-panel__row">
            <ListingStatusBadge status={l.status} />
            {l.verified ? <StatusBadge status="verified" label="Verified" /> : <StatusBadge status="unverified" label="Not verified" />}
          </div>
          <p>{STATUS_HELP[l.status]}</p>
          {l.lastReview?.status === "rejected" && l.lastReview.notes && (
            <p className="status-panel__review">
              <strong>Review feedback:</strong> {l.lastReview.notes}
            </p>
          )}
          <p className="muted-text">
            Bookable: no. {l.bookability.reasons.join(" · ")}.
          </p>
        </div>
      </Section>

      <div className="tabs" role="tablist" aria-label="Listing sections">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            tabIndex={tab === key ? 0 : -1}
            className="tabs__tab"
            onClick={() => setTab(key)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              const i = tabs.findIndex(([k]) => k === tab);
              const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]![0];
              setTab(next);
              document.getElementById(`tab-${next}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tab-panel">
        {tab === "details" &&
          (l.status === "archived" ? (
            <EmptyState title="This listing is archived" body="Restore it to make changes." />
          ) : (
            <ListingForm
              initial={draftOf(l)}
              verified={l.verified && l.status !== "draft"}
              submitLabel="Save changes"
              onSave={async (body) => {
                await api(`/parking-spaces/${id}`, { method: "PATCH", body });
                listing.reload();
              }}
            />
          ))}
        {tab === "hours" && (
          <Section title="Opening hours">
            <HoursEditor listing={l} onSaved={listing.reload} />
          </Section>
        )}
        {tab === "photos" && (
          <Section title="Photos">
            <PhotoManager listing={l} onChange={listing.reload} />
          </Section>
        )}
        {tab === "preview" && (
          <Section title="What drivers will see">
            {!l.publiclyVisible && <p className="dev-note">Preview only: drivers can't see this listing until it's verified and published.</p>}
            <Async remote={preview}>{(p) => <PublicListingView listing={p} />}</Async>
          </Section>
        )}
        {tab === "bookings" && (
          <Section title="Bookings on this listing">
            <Async remote={bookings}>
              {(rows) =>
                rows.length ? (
                  <RecordList rows={rows} columns={bookingColumns} caption="Bookings on this listing" />
                ) : (
                  <EmptyState title="No bookings yet" body="Bookings on this listing will appear here." />
                )
              }
            </Async>
          </Section>
        )}
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.confirm?.title ?? ""}
        body={pending?.confirm?.body ?? ""}
        confirmLabel={pending?.confirm?.confirmLabel ?? ""}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && run(pending)}
      />
    </>
  );
}

const bookingColumns: Column<Booking>[] = [
  { header: "Bay", primary: true, cell: (b) => <Link href={`/app/bookings/${b.id}`}>{b.bayLabel}</Link> },
  { header: "When", cell: (b) => formatRange(b.startsAt, b.endsAt) },
  { header: "Status", cell: (b) => <StatusBadge status={b.status} /> },
  { header: "Total", cell: (b) => formatMoney(b.price.totalAmountMinor, b.price.currency) },
];

// ---------- platform staff review ----------

interface ReviewItem {
  id: string;
  name: string;
  parkingType: OwnerListing["parkingType"];
  address: { line: string | null; locality: string | null; city: string | null; region: string | null; postalCode: string | null };
  photoCount: number;
  submittedAt: string;
}

function ReviewRow({ item, onDone }: { item: ReviewItem; onDone: () => void }) {
  const [notes, setNotes] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/admin/parking-spaces/${item.id}/review`, { method: "POST", body: { decision, notes: notes.trim() || undefined } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? (err.details[0]?.message ?? err.message) : "That didn't work.");
      setBusy(false);
    }
  }
  return (
    <li className="review">
      <div>
        <p className="listing-card__title">{item.name}</p>
        <p className="listing-card__meta">
          {PARKING_TYPE_LABEL[item.parkingType]} · {place(item.address)}
          {item.address.postalCode ? ` ${item.address.postalCode}` : ""}
        </p>
        <p className="listing-card__meta">
          {item.photoCount} photos · submitted {new Date(item.submittedAt).toLocaleString("en-IN")}
        </p>
      </div>
      {error && <FormAlert>{error}</FormAlert>}
      {rejecting && (
        <div className="field">
          <label className="field__label" htmlFor={`notes-${item.id}`}>
            What does the owner need to fix?
          </label>
          <textarea id={`notes-${item.id}`} className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        </div>
      )}
      <div className="form-actions">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => decide("approve")}>
          Approve
        </button>
        {rejecting ? (
          <button type="button" className="btn-danger" disabled={busy} onClick={() => decide("reject")}>
            Send back to owner
          </button>
        ) : (
          <button type="button" className="btn-plain" disabled={busy} onClick={() => setRejecting(true)}>
            Reject…
          </button>
        )}
      </div>
    </li>
  );
}

export function StaffListingReview() {
  usePageTitle("Listing review");
  const queue = useApi<ReviewItem[]>("/admin/parking-spaces");
  return (
    <>
      <PageHeader title="Listing review" eyebrow="Platform staff" />
      <Section title="Waiting for review">
        {queue.status === "loading" ? (
          <Skeleton />
        ) : (
          <Async remote={queue}>
            {(rows) =>
              rows.length ? (
                <ul className="review-list">
                  {rows.map((r) => (
                    <ReviewRow key={r.id} item={r} onDone={queue.reload} />
                  ))}
                </ul>
              ) : (
                <EmptyState title="Nothing to review" body="New submissions will appear here." />
              )
            }
          </Async>
        )}
      </Section>
    </>
  );
}

export { EMPTY as EMPTY_DRAFT };
export type { Draft as ListingDraft };
