// Booking lifecycle and request rules. Routes and repositories call these;
// nothing else decides transitions, prices or whether a time fits a listing.
//
// Pilot model (no payment provider is integrated): a driver *requests* a slot
// (pending), the space owner confirms or declines it. Only confirmed/active
// bookings hold a bay; Postgres enforces that two of them can never overlap.

export const BOOKING_STATUSES = ["pending", "confirmed", "active", "completed", "cancelled", "expired"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

const transitions: Record<BookingStatus, readonly BookingStatus[]> = {
  pending: ["confirmed", "cancelled", "expired"],
  confirmed: ["active", "cancelled", "completed"],
  active: ["completed"],
  completed: [],
  cancelled: [],
  expired: [],
};

/** Statuses that hold a bay; the DB forbids two overlapping ones per bay. */
export const BAY_HOLDING_STATUSES: readonly BookingStatus[] = ["confirmed", "active"];

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return transitions[from].includes(to);
}

export type BookingAction = "confirm" | "decline" | "cancel";
export type Party = "driver" | "owner";

/**
 * Which party may do what, from which status. Returns the target status or a
 * reason. Time checks (nothing changes after the booking has started) are
 * applied separately by the caller with the current clock.
 */
export function bookingAction(
  status: BookingStatus,
  action: BookingAction,
  party: Party,
): { ok: true; to: BookingStatus } | { ok: false; reason: string } {
  if (action === "confirm" || action === "decline") {
    if (party !== "owner") return { ok: false, reason: "Only the space owner can respond to a request" };
    if (status !== "pending") return { ok: false, reason: `This booking is ${status}, not waiting for a response` };
    return { ok: true, to: action === "confirm" ? "confirmed" : "cancelled" };
  }
  if (status !== "pending" && status !== "confirmed") return { ok: false, reason: `A ${status} booking can't be cancelled` };
  return { ok: true, to: "cancelled" };
}

/**
 * Price in minor units for [startsAt, endsAt): per started hour, capped at the
 * daily price when one is set. Always computed on the server and snapshotted.
 */
export function quoteTotalMinor(hourlyPriceMinor: number, startsAt: Date, endsAt: Date, dailyPriceMinor?: number | null): number {
  return priceBreakdown(hourlyPriceMinor, startsAt, endsAt, dailyPriceMinor).totalMinor;
}

/** The itemised price shown before a request and snapshotted on the booking. */
export function priceBreakdown(hourlyPriceMinor: number, startsAt: Date, endsAt: Date, dailyPriceMinor?: number | null) {
  const ms = endsAt.getTime() - startsAt.getTime();
  if (!(ms > 0)) throw new RangeError("endsAt must be after startsAt");
  const billableHours = Math.ceil(ms / 3_600_000);
  const hourlyTotalMinor = billableHours * hourlyPriceMinor;
  const dailyCapMinor = dailyPriceMinor == null ? null : Math.ceil(ms / 86_400_000) * dailyPriceMinor;
  const capped = dailyCapMinor !== null && dailyCapMinor < hourlyTotalMinor;
  return {
    minutes: ms / 60_000,
    billableHours,
    hourlyPriceMinor,
    hourlyTotalMinor,
    dailyCapMinor,
    dailyCapApplied: capped,
    totalMinor: capped ? dailyCapMinor! : hourlyTotalMinor,
    currency: "INR" as const,
  };
}

/** Basic window checks that don't depend on a listing (used by search filters). */
export function windowProblems(startsAt: Date, endsAt: Date, now = new Date()): string[] {
  const problems: string[] = [];
  if (!(endsAt.getTime() > startsAt.getTime())) return ["The end must be after the start"];
  if (startsAt.getTime() < now.getTime()) problems.push("The start time has already passed");
  if (startsAt.getTime() > now.getTime() + MAX_DAYS_AHEAD * 86_400_000) problems.push(`Bookings can be made up to ${MAX_DAYS_AHEAD} days ahead`);
  if (startsAt.getTime() % (SLOT_MINUTES * 60_000) !== 0 || endsAt.getTime() % (SLOT_MINUTES * 60_000) !== 0) {
    problems.push(`Times must be on ${SLOT_MINUTES}-minute steps`);
  }
  return problems;
}

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
type Day = (typeof DAY_KEYS)[number];

/** Wall-clock date, weekday and minutes-after-midnight of an instant in a time zone. */
export function localParts(at: Date, timeZone: string): { date: string; day: Day; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const day = get("weekday").toLowerCase().slice(0, 3) as Day;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export interface RequestRules {
  timezone: string;
  weekly: { day: string; opens: string; closes: string }[];
  minBookingMinutes: number;
  maxBookingMinutes: number | null;
}

export const SLOT_MINUTES = 15;
export const MAX_DAYS_AHEAD = 60;

/** Everything wrong with a requested time range, as user-facing messages (empty = acceptable). */
export function requestProblems(startsAt: Date, endsAt: Date, rules: RequestRules, now = new Date()): string[] {
  const minutes = (endsAt.getTime() - startsAt.getTime()) / 60_000;
  if (!(minutes > 0)) return ["The end must be after the start"];
  const problems = windowProblems(startsAt, endsAt, now);
  if (minutes < rules.minBookingMinutes) problems.push(`This space needs at least ${rules.minBookingMinutes} minutes`);
  if (rules.maxBookingMinutes != null && minutes > rules.maxBookingMinutes) {
    problems.push(`This space allows at most ${rules.maxBookingMinutes} minutes`);
  }
  // The whole stay must sit inside one opening window on one local day.
  const s = localParts(startsAt, rules.timezone);
  const e = localParts(endsAt, rules.timezone);
  const endMinutes = e.date === s.date ? e.minutes : e.minutes === 0 && minutes <= 1440 ? 1440 : -1;
  const fits =
    endMinutes > 0 &&
    rules.weekly.some((w) => w.day === s.day && toMinutes(w.opens) <= s.minutes && endMinutes <= toMinutes(w.closes));
  if (!fits) problems.push("That time isn't within the space's opening hours");
  return problems;
}
