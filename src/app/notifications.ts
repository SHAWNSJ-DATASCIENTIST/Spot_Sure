import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

// In-app notifications: the shell's unread badge and the list page share
// this. The API only ever returns the signed-in user's own notifications.

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

export interface AppNotification {
  id: string;
  type: NotificationType;
  message: string;
  link: { kind: "booking" | "listing"; id: string } | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  data: AppNotification[];
  nextCursor: string | null;
  unreadCount: number;
}

/** Fired after the user reads notifications, so the badge updates at once. */
export const NOTIFICATIONS_CHANGED = "spotsure:notifications-changed";

export const POLL_MS = 60_000;

/** Where a notification leads. The destination page checks access again. */
export function notificationHref(n: AppNotification): string | null {
  if (!n.link) return null;
  return n.link.kind === "booking" ? `/app/bookings/${n.link.id}` : `/app/owner/spaces/${n.link.id}`;
}

export function announceChanged(unreadCount: number) {
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED, { detail: unreadCount }));
}

/**
 * Unread count for the badge: fetched on mount and whenever `refreshKey`
 * changes, then polled while the tab is visible. A failed poll keeps the
 * last value rather than showing a wrong one.
 */
export function useUnreadCount(refreshKey: unknown): number | null {
  const [count, setCount] = useState<number | null>(null);
  const load = useCallback(() => {
    api<{ data: { unreadCount: number } }>("/me/notifications/unread-count")
      .then(({ data }) => setCount(data.unreadCount))
      .catch(() => {});
  }, []);

  useEffect(load, [load, refreshKey]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    const onChanged = (e: Event) => {
      const n = (e as CustomEvent<unknown>).detail;
      if (typeof n === "number") setCount(n);
      else load();
    };
    window.addEventListener(NOTIFICATIONS_CHANGED, onChanged);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_CHANGED, onChanged);
    };
  }, [load]);
  return count;
}
