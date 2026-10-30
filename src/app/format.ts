// Display formatting. Money arrives in minor units with an ISO currency.

export function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(amountMinor / 100);
}

const dateTime = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });
const time = new Intl.DateTimeFormat("en-IN", { timeStyle: "short" });

export function formatRange(startsAt: string, endsAt: string): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  return s.toDateString() === e.toDateString()
    ? `${dateTime.format(s)} – ${time.format(e)}`
    : `${dateTime.format(s)} – ${dateTime.format(e)}`;
}

export function formatPlace(address: { line: string | null; city: string | null; region: string | null }): string {
  return [address.line, address.city, address.region].filter(Boolean).join(", ") || "No address yet";
}

/** Milliseconds a time zone is ahead of UTC at a given instant. */
function zoneOffset(at: number, timeZone: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(at));
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - Math.floor(at / 60_000) * 60_000;
}

/** "2026-12-01" + "10:00" wall time in `timeZone` → ISO instant (UTC). */
export function zonedToIso(date: string, hhmm: string, timeZone: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let utc = wall - zoneOffset(wall, timeZone);
  utc = wall - zoneOffset(utc, timeZone); // second pass settles DST edges
  return new Date(utc).toISOString();
}

/** Today's date (YYYY-MM-DD) in a time zone. */
export function todayIn(timeZone: string, plusDays = 0): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(Date.now() + plusDays * 86_400_000),
  );
  return p;
}

/** Same rule as the API: per started hour, capped by the daily price. Display only. */
export function estimateTotalMinor(hourly: number, minutes: number, daily: number | null): number {
  const byHour = Math.ceil(minutes / 60) * hourly;
  return daily == null ? byHour : Math.min(byHour, Math.ceil(minutes / 1440) * daily);
}

/**
 * Parses a rupee amount typed or dictated by a person into paise; NaN when
 * invalid. Accepts "40", "40.5", "₹40", "Rs. 40", "40 rupees", "1,200" and a
 * trailing full stop (dictation tools add one), nothing vaguer.
 */
export function parseMoneyToMinor(input: string): number {
  const t = input
    .trim()
    .toLowerCase()
    .replace(/^(₹|rs\.?|inr)\s*/, "")
    .replace(/\s*(rupees?|rs\.?|inr)$/, "")
    .replace(/\.$/, "")
    .replace(/,(?=\d{2,3}(\D|$))/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100);
}

/** Digits of a code dictated or typed with spaces or dashes ("403 001", "403-001"). */
export function compactDigits(input: string): string {
  const t = input.trim().replace(/\.$/, "");
  return /^[\d\s-]+$/.test(t) ? t.replace(/[\s-]/g, "") : t;
}

/** Free-text search as typed or dictated: single spaces, no trailing sentence punctuation. */
export function normaliseSearch(input: string): string {
  return input.trim().replace(/\s+/g, " ").replace(/[.,!?;:]+$/, "").trim();
}
