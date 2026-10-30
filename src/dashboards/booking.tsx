import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError, type User } from "../app/api";
import { formatMoney, formatRange, todayIn, zonedToIso } from "../app/format";
import { Link, navigate } from "../app/router";
import { BOOKING_STATUS_LABEL, PAYMENT_STATUS_TEXT, type Booking, type PublicListing } from "../app/types";
import { useApi } from "../app/useApi";
import { FormAlert, usePageTitle } from "../pages/Field";
import { Async, ConfirmDialog, EmptyState, PageHeader, Section, StatusBadge } from "../ui/ui";

// Pilot booking flow: a driver requests a slot, the owner confirms or
// declines. Payments are not integrated, so nothing here takes or shows a
// payment; the price is the amount the request was made at.

export function BookingStatusBadge({ status }: { status: Booking["status"] }) {
  return <StatusBadge status={status} label={BOOKING_STATUS_LABEL[status]} />;
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const WEEKDAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const STEP = 15;

/** Start and end options for a date, from the listing's own opening windows. */
export function slotOptions(listing: PublicListing, date: string) {
  if (!listing.availability || !date) return [];
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const day = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return listing.availability.weekly
    .filter((w) => w.day === day)
    .map((w) => ({ opens: toMin(w.opens), closes: toMin(w.closes) }));
}

export interface Quote {
  problems: string[];
  available: boolean;
  freeSpaces: number;
  price: {
    minutes: number;
    billableHours: number;
    hourlyPriceMinor: number;
    hourlyTotalMinor: number;
    dailyCapMinor: number | null;
    dailyCapApplied: boolean;
    totalMinor: number;
    currency: string;
  } | null;
}

/** Live server quote for the chosen window: price breakdown and whether a space is free. */
function useQuote(spaceId: string, startsAt: string | null, endsAt: string | null) {
  const [state, setState] = useState<{ status: "idle" | "loading" } | { status: "ready"; quote: Quote } | { status: "error"; message: string }>({
    status: "idle",
  });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!startsAt || !endsAt) {
      setState({ status: "idle" });
      return;
    }
    let live = true;
    setState({ status: "loading" });
    const qs = new URLSearchParams({ startsAt, endsAt });
    api<{ data: Quote }>(`/parking-spaces/${spaceId}/quote?${qs}`)
      .then(({ data }) => live && setState({ status: "ready", quote: data }))
      .catch((err) => live && setState({ status: "error", message: err instanceof ApiError ? err.message : "Couldn't check this time." }));
    return () => {
      live = false;
    };
  }, [spaceId, startsAt, endsAt, nonce]);
  return { ...state, retry: () => setNonce((n) => n + 1) };
}

export function BookingRequestForm({
  listing,
  preset = {},
}: {
  listing: PublicListing;
  /** Prefill from a discovery search (date/from/until), when it fits this listing. */
  preset?: { date?: string; from?: string; until?: string };
}) {
  const tz = listing.availability?.timezone ?? "Asia/Kolkata";
  const [date, setDate] = useState(preset.date ?? todayIn(tz, 1));
  const [start, setStart] = useState(preset.from ?? "");
  const [end, setEnd] = useState(preset.until ?? "");
  const [error, setError] = useState<{ message: string; details: string[] }>();
  const [busy, setBusy] = useState(false);
  const windows = slotOptions(listing, date);
  const { min, max } = listing.bookingMinutes;

  const starts = useMemo(() => {
    const out: number[] = [];
    for (const w of windows) for (let s = w.opens; s + min <= w.closes; s += STEP) out.push(s);
    return out;
  }, [windows, min]);
  const startM = start ? toMin(start) : null;
  const window = startM == null ? null : windows.find((w) => w.opens <= startM && startM < w.closes);
  const ends = useMemo(() => {
    if (startM == null || !window) return [];
    const out: number[] = [];
    for (let e = startM + min; e <= window.closes && (max == null || e - startM <= max); e += STEP) out.push(e);
    return out;
  }, [startM, window, min, max]);
  const valid = Boolean(start && end && ends.includes(toMin(end)) && starts.includes(toMin(start)));
  const quote = useQuote(
    listing.id,
    valid ? zonedToIso(date, start, tz) : null,
    valid ? zonedToIso(date, end, tz) : null,
  );
  const canSubmit = quote.status === "ready" && quote.quote.available && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!start || !end) {
      setError({ message: "Choose a start and end time.", details: [] });
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const body = { spaceId: listing.id, startsAt: zonedToIso(date, start, tz), endsAt: zonedToIso(date, end, tz) };
      const { data } = await api<{ data: Booking }>("/bookings", { method: "POST", body });
      navigate(`/app/bookings/${data.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? { message: err.status === 429 ? "Too many requests. Try again later." : err.message, details: err.details.slice(1).map((d) => d.message) }
          : { message: "Couldn't send the request. Please try again.", details: [] },
      );
      setBusy(false);
    }
  }

  if (!listing.availability) return <p className="muted-text">This space has no opening hours yet, so it can't be requested.</p>;

  return (
    <form className="booking-form" onSubmit={submit} noValidate aria-busy={busy}>
      {error && (
        <FormAlert>
          {error.message}
          {error.details.length > 0 && (
            <ul className="plain-list">
              {error.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </FormAlert>
      )}
      <div className="form-grid">
        <div className="field">
          <label className="field__label" htmlFor="booking-date">
            Date
          </label>
          <input
            id="booking-date"
            className="field__input"
            type="date"
            min={todayIn(tz)}
            max={todayIn(tz, 60)}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setStart("");
              setEnd("");
            }}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="booking-start">
            From
          </label>
          <select
            id="booking-start"
            className="select"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              setEnd("");
            }}
            disabled={!starts.length}
          >
            <option value="">{starts.length ? "Choose" : "Closed this day"}</option>
            {starts.map((s) => (
              <option key={s} value={toHhmm(s)}>
                {toHhmm(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="booking-end">
            Until
          </label>
          <select id="booking-end" className="select" value={end} onChange={(e) => setEnd(e.target.value)} disabled={!ends.length}>
            <option value="">Choose</option>
            {ends.map((m) => (
              <option key={m} value={toHhmm(m)}>
                {toHhmm(m)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="muted-text">Times are in {tz}.</p>
      <div className="quote" aria-live="polite">
        {quote.status === "idle" && <p className="muted-text">Choose a date and times to see the price and availability.</p>}
        {quote.status === "loading" && <p className="muted-text" role="status">Checking price and availability…</p>}
        {quote.status === "error" && (
          <p className="error-state__body">
            {quote.message}{" "}
            <button type="button" className="btn-plain" onClick={quote.retry}>
              Try again
            </button>
          </p>
        )}
        {quote.status === "ready" && quote.quote.price && (
          <>
            <dl className="quote__lines">
              <dt>
                {quote.quote.price.billableHours} h × {formatMoney(quote.quote.price.hourlyPriceMinor, quote.quote.price.currency)}
              </dt>
              <dd>{formatMoney(quote.quote.price.hourlyTotalMinor, quote.quote.price.currency)}</dd>
              {quote.quote.price.dailyCapApplied && (
                <>
                  <dt>Capped at the daily price</dt>
                  <dd>{formatMoney(quote.quote.price.dailyCapMinor!, quote.quote.price.currency)}</dd>
                </>
              )}
              <dt className="quote__total">Total</dt>
              <dd className="quote__total">{formatMoney(quote.quote.price.totalMinor, quote.quote.price.currency)}</dd>
            </dl>
            {quote.quote.problems.length > 0 ? (
              <ul className="field__error plain-list">
                {quote.quote.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : quote.quote.available ? (
              <p className="form-success">A space is free at this time. The owner still has to confirm your request.</p>
            ) : (
              <p className="field__error">No space is free at that time. Try another time.</p>
            )}
          </>
        )}
      </div>
      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={!canSubmit}>
          {busy ? "Sending…" : "Request booking"}
        </button>
      </div>
      <p className="dev-note">
        Pilot: this sends a request to the owner, who confirms or declines it. SpotSure doesn't take payment yet and nothing is
        charged.
      </p>
    </form>
  );
}

type Act = "confirm" | "decline" | "cancel";
const ACT: Record<Act, { label: string; title: string; body: string; confirmLabel: string; tone: "primary" | "plain" | "danger" }> = {
  confirm: { label: "Confirm booking", title: "Confirm this booking?", body: "The space will be held for the driver for this time.", confirmLabel: "Confirm", tone: "primary" },
  decline: { label: "Decline", title: "Decline this request?", body: "The driver will see the request as cancelled by you.", confirmLabel: "Decline request", tone: "danger" },
  cancel: { label: "Cancel booking", title: "Cancel this booking?", body: "This can't be undone. The space will be released.", confirmLabel: "Cancel booking", tone: "danger" },
};

export function BookingDetail({ id, user }: { id: string; user: User }) {
  usePageTitle("Booking");
  const booking = useApi<Booking>(`/bookings/${id}`);
  const [pending, setPending] = useState<Act | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const isOwner = user.role === "parking_owner";
  const back = isOwner
    ? { href: "/app/owner/bookings", label: "Booking activity" }
    : { href: "/app/driver/bookings", label: "My bookings" };

  if (booking.status === "error" && booking.error.status === 404) {
    return (
      <>
        <PageHeader title="Booking not found" breadcrumbs={[back]} />
        <Section title="Booking">
          <EmptyState title="We couldn't find this booking" body="It may not exist, or it isn't one you can see." />
        </Section>
      </>
    );
  }

  async function run(act: Act) {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/bookings/${id}/${act}`, { method: "POST" });
      setPending(null);
      booking.reload();
    } catch (err) {
      setPending(null);
      setError(err instanceof ApiError ? err.message : "That didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const b = booking.status === "ready" ? booking.data : null;
  const upcoming = b ? new Date(b.startsAt).getTime() > Date.now() : false;
  const acts: Act[] = !b || !upcoming
    ? []
    : b.userId
      ? b.status === "pending" || b.status === "confirmed"
        ? ["cancel"]
        : []
      : b.status === "pending"
        ? ["confirm", "decline"]
        : b.status === "confirmed"
          ? ["cancel"]
          : [];

  return (
    <>
      <PageHeader
        title={b ? b.spaceName : "Booking"}
        breadcrumbs={[back]}
        actions={acts.map((a) => (
          <button
            key={a}
            type="button"
            className={ACT[a].tone === "danger" ? "btn-danger" : ACT[a].tone === "primary" ? "btn-primary" : "btn-plain"}
            disabled={busy}
            onClick={() => setPending(a)}
          >
            {ACT[a].label}
          </button>
        ))}
      />
      {error && <FormAlert>{error}</FormAlert>}
      <Section title="Booking details">
        <Async remote={booking}>
          {(x) => (
            <dl className="facts">
              <dt>Status</dt>
              <dd>
                <BookingStatusBadge status={x.status} />
                {x.status === "cancelled" && x.cancelledBy && ` by the ${x.cancelledBy}`}
                {x.status === "pending" && (x.userId ? " · waiting for the owner" : " · waiting for you")}
              </dd>
              <dt>Space</dt>
              <dd>
                {x.spaceName}
                {x.area && [x.area.locality, x.area.city].some(Boolean) && ` · ${[x.area.locality, x.area.city].filter(Boolean).join(", ")}`}
              </dd>
              <dt>Bay</dt>
              <dd>{x.bayLabel}</dd>
              <dt>When</dt>
              <dd>{formatRange(x.startsAt, x.endsAt)}</dd>
              <dt>Price</dt>
              <dd>
                {formatMoney(x.price.totalAmountMinor, x.price.currency)} ({formatMoney(x.price.hourlyAmountMinor, x.price.currency)}/hr at
                request time)
              </dd>
              <dt>Payment</dt>
              <dd>{PAYMENT_STATUS_TEXT[x.payment?.status ?? "not_collected"]}</dd>
              {x.privateAccess && (
                <>
                  <dt>Address</dt>
                  <dd>{x.privateAccess.address}</dd>
                  <dt>Entry</dt>
                  <dd className="pre-line">{x.privateAccess.entryInstructions ?? "No instructions given."}</dd>
                </>
              )}
            </dl>
          )}
        </Async>
        {b && !b.userId && <p className="muted-text">For privacy, drivers' details aren't shared with owners in the pilot.</p>}
        {b && b.userId && b.status === "pending" && (
          <p className="muted-text">The exact address and entry instructions appear here once the owner confirms.</p>
        )}
      </Section>
      {!isOwner && (
        <p>
          <Link href="/app/discover" className="text-link">
            Find more parking
          </Link>
        </p>
      )}
      <ConfirmDialog
        open={pending !== null}
        title={pending ? ACT[pending].title : ""}
        body={pending ? ACT[pending].body : ""}
        confirmLabel={pending ? ACT[pending].confirmLabel : ""}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && run(pending)}
      />
    </>
  );
}

// ---------- booking list filters ----------

export type BookingView = "all" | "requests" | "confirmed" | "past";
const VIEWS: { value: BookingView; label: string }[] = [
  { value: "all", label: "All" },
  { value: "requests", label: "Requests" },
  { value: "confirmed", label: "Confirmed" },
  { value: "past", label: "Past & cancelled" },
];

export function filterBookings(rows: Booking[], view: BookingView): Booking[] {
  switch (view) {
    case "requests":
      return rows.filter((b) => b.status === "pending");
    case "confirmed":
      return rows.filter((b) => b.status === "confirmed" || b.status === "active");
    case "past":
      return rows.filter((b) => ["completed", "cancelled", "expired"].includes(b.status));
    default:
      return rows;
  }
}

/** Segmented filter with counts; a radio group so it works with arrow keys. */
export function BookingViewFilter({ value, onChange, rows }: { value: BookingView; onChange: (v: BookingView) => void; rows: Booking[] }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Show bookings">
      {VIEWS.map((v) => (
        <label key={v.value} className={`segmented__item ${value === v.value ? "is-on" : ""}`}>
          <input type="radio" name="booking-view" value={v.value} checked={value === v.value} onChange={() => onChange(v.value)} />
          {v.label} <span className="segmented__count">{filterBookings(rows, v.value).length}</span>
        </label>
      ))}
    </div>
  );
}
