// Payment state, kept separate from the booking lifecycle (domain/booking.ts).
// A confirmed booking is not a paid booking, and a request is neither.
//
// No payment provider is integrated. PAYMENTS_PROVIDER only accepts "none",
// every booking stays "not_collected", checkout answers 503, and no route can
// set any other payment status. The transitions below are the contract a
// provider integration must follow; only verified provider events (signed
// webhooks or a server-side lookup), never the browser, may drive them.

import type { BookingStatus } from "./booking.js";

export const PAYMENT_STATUSES = ["not_collected", "pending", "paid", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_PROVIDERS = ["none"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

const transitions: Record<PaymentStatus, readonly PaymentStatus[]> = {
  not_collected: ["pending"],
  pending: ["paid", "failed"],
  failed: ["pending"],
  paid: ["refunded"],
  refunded: [],
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return transitions[from].includes(to);
}

/** Whether SpotSure can take money at all. False until a provider is integrated and verified. */
export function liveChargesEnabled(provider: PaymentProvider): boolean {
  return provider !== "none";
}

/**
 * The amount a checkout would charge: the price snapshotted on the booking at
 * request time, never a figure from the client or the current listing price.
 */
export function amountDueMinor(booking: { totalPriceMinor: number; currency: string }): { amountMinor: number; currency: string } {
  if (!Number.isInteger(booking.totalPriceMinor) || booking.totalPriceMinor < 0) throw new RangeError("Invalid booking total");
  return { amountMinor: booking.totalPriceMinor, currency: booking.currency };
}

/**
 * Whether a checkout may start for this booking, or why not. Only the booker,
 * only once the owner has confirmed, and never twice for one booking.
 */
export function checkoutProblem(
  provider: PaymentProvider,
  bookingStatus: BookingStatus,
  paymentStatus: PaymentStatus,
): { status: 409 | 503; code: string; message: string } | null {
  if (!liveChargesEnabled(provider)) {
    return { status: 503, code: "payments_disabled", message: "SpotSure doesn't take payments yet. Nothing has been charged." };
  }
  if (bookingStatus !== "confirmed") return { status: 409, code: "not_payable", message: `A ${bookingStatus} booking can't be paid` };
  if (paymentStatus === "pending") return { status: 409, code: "payment_in_progress", message: "A payment for this booking is already in progress" };
  if (paymentStatus === "paid" || paymentStatus === "refunded") {
    return { status: 409, code: "already_paid", message: "This booking has already been paid" };
  }
  return null;
}

/**
 * Whether the booker gets the private address and entry instructions. Always
 * requires a confirmed (or running) booking; when payment is required, also a
 * verified "paid" status. During the pilot payment isn't required, because
 * SpotSure can't collect it.
 */
export function accessGranted(bookingStatus: BookingStatus, paymentStatus: PaymentStatus, paymentRequired: boolean): boolean {
  if (bookingStatus !== "confirmed" && bookingStatus !== "active") return false;
  return !paymentRequired || paymentStatus === "paid";
}
