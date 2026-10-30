// Notification wording and rules. Messages carry only what the recipient may
// already see: the listing title and the booked time. Never the address,
// entry instructions, payment details or the other party's identity.

export type NotificationType =
  | "booking_requested"
  | "booking_request_received"
  | "booking_confirmed"
  | "booking_declined"
  | "booking_cancelled"
  | "booking_expired"
  | "booking_reminder"
  | "listing_approved"
  | "listing_changes_requested";

/** A booking reminder appears this long before the start. */
export const REMINDER_LEAD_MINUTES = 120;

export const NOTIFICATION_PAGE_MAX = 50;
export const NOTIFICATION_PAGE_DEFAULT = 20;

/** "Tue 3 Nov, 10:00–12:00 IST" in the listing's own time zone. */
export function whenText(startsAt: Date, endsAt: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" });
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const zone =
    new Intl.DateTimeFormat("en-IN", { timeZone, timeZoneName: "short" }).formatToParts(startsAt).find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  const sameDay = day.format(startsAt) === day.format(endsAt);
  const end = sameDay ? time.format(endsAt) : `${day.format(endsAt)}, ${time.format(endsAt)}`;
  return `${day.format(startsAt)}, ${time.format(startsAt)}–${end} ${zone}`;
}

export interface BookingFacts {
  spaceName: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
}

const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function bookingMessage(type: NotificationType, b: BookingFacts, by?: "driver" | "owner"): string {
  const name = clip(b.spaceName);
  const when = whenText(b.startsAt, b.endsAt, b.timezone);
  switch (type) {
    case "booking_requested":
      return `Your request for ${name} (${when}) was sent. The owner will confirm or decline it.`;
    case "booking_request_received":
      return `New booking request for ${name} (${when}). Confirm or decline it before it starts.`;
    case "booking_confirmed":
      return `The owner confirmed your booking at ${name} (${when}). The address and entry details are on the booking.`;
    case "booking_declined":
      return `The owner declined your request for ${name} (${when}).`;
    case "booking_cancelled":
      return `The ${by ?? "other party"} cancelled the booking at ${name} (${when}).`;
    case "booking_expired":
      return `Your request for ${name} (${when}) expired without a response from the owner.`;
    case "booking_reminder":
      return `Reminder: your booking at ${name} starts soon (${when}).`;
    default:
      throw new Error(`Not a booking notification: ${type}`);
  }
}

export function listingMessage(type: "listing_approved" | "listing_changes_requested", spaceName: string): string {
  const name = clip(spaceName);
  return type === "listing_approved"
    ? `${name} was approved and is now published.`
    : `${name} needs changes before it can be published. Open it to see the reviewer's note.`;
}

/** Opaque keyset cursor over (createdAt, id), newest first. */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [iso, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const createdAt = new Date(iso ?? "");
  if (!id || Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/.test(id)) return null;
  return { createdAt, id };
}
