import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../app/api";
import { announceChanged, notificationHref, type AppNotification, type NotificationPage } from "../app/notifications";
import { Link, navigate } from "../app/router";
import { usePageTitle } from "../pages/Field";
import { EmptyState, ErrorState, PageHeader, Section, Skeleton } from "../ui/ui";
import "./notifications.css";

const PAGE = 20;

const toError = (err: unknown) => (err instanceof ApiError ? err : new ApiError(0, "unknown_error", "Something went wrong."));

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

type State =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; items: AppNotification[]; nextCursor: string | null; unread: number };

export function Notifications() {
  usePageTitle("Notifications");
  const [state, setState] = useState<State>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();

  const load = useCallback(() => {
    setState({ status: "loading" });
    api<NotificationPage>(`/me/notifications?limit=${PAGE}`)
      .then((p) => {
        setState({ status: "ready", items: p.data, nextCursor: p.nextCursor, unread: p.unreadCount });
        announceChanged(p.unreadCount);
      })
      .catch((err) => setState({ status: "error", error: toError(err) }));
  }, []);
  useEffect(load, [load]);

  async function more() {
    if (state.status !== "ready" || !state.nextCursor) return;
    setBusy(true);
    setActionError(undefined);
    try {
      const p = await api<NotificationPage>(`/me/notifications?limit=${PAGE}&cursor=${encodeURIComponent(state.nextCursor)}`);
      setState({ status: "ready", items: [...state.items, ...p.data], nextCursor: p.nextCursor, unread: p.unreadCount });
    } catch (err) {
      setActionError(toError(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function markRead(n: AppNotification) {
    if (n.read) return;
    setActionError(undefined);
    try {
      const res = await api<{ data: AppNotification; unreadCount: number }>(`/me/notifications/${n.id}/read`, { method: "POST" });
      setState((s) => (s.status === "ready" ? { ...s, unread: res.unreadCount, items: s.items.map((x) => (x.id === n.id ? res.data : x)) } : s));
      announceChanged(res.unreadCount);
    } catch (err) {
      setActionError(toError(err).message);
    }
  }

  async function markAll() {
    setBusy(true);
    setActionError(undefined);
    try {
      await api("/me/notifications/read-all", { method: "POST" });
      setState((s) => (s.status === "ready" ? { ...s, unread: 0, items: s.items.map((x) => ({ ...x, read: true })) } : s));
      announceChanged(0);
    } catch (err) {
      setActionError(toError(err).message);
    } finally {
      setBusy(false);
    }
  }

  const unread = state.status === "ready" ? state.unread : 0;

  return (
    <>
      <PageHeader
        title="Notifications"
        actions={
          unread > 0 ? (
            <button type="button" className="btn-plain" onClick={markAll} disabled={busy}>
              Mark all as read
            </button>
          ) : undefined
        }
      />
      {actionError && (
        <div className="form-alert" role="alert">
          {actionError}
        </div>
      )}
      <Section title={unread > 0 ? `${unread} unread` : "All notifications"}>
        {state.status === "loading" && <Skeleton lines={4} label="Loading notifications" />}
        {state.status === "error" && <ErrorState error={state.error} onRetry={load} />}
        {state.status === "ready" && state.items.length === 0 && (
          <EmptyState
            title="No notifications yet"
            body="Booking requests, confirmations, cancellations and listing reviews will show up here. SpotSure doesn't send email or SMS yet."
          />
        )}
        {state.status === "ready" && state.items.length > 0 && (
          <>
            <ul className="notices">
              {state.items.map((n) => {
                const href = notificationHref(n);
                return (
                  <li key={n.id} className={`notice${n.read ? "" : " notice--unread"}`}>
                    <span className="notice__dot" aria-hidden="true" />
                    <div>
                      <p className="notice__message">
                        {!n.read && <span className="sr-only">Unread: </span>}
                        {href ? (
                          <Link
                            href={href}
                            onClick={async (e) => {
                              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                              e.preventDefault();
                              await markRead(n);
                              navigate(href);
                            }}
                          >
                            {n.message}
                          </Link>
                        ) : (
                          n.message
                        )}
                      </p>
                      <time className="notice__time" dateTime={n.createdAt}>
                        {formatWhen(n.createdAt)}
                      </time>
                    </div>
                    {!n.read && (
                      <button type="button" className="btn-plain notice__read" onClick={() => markRead(n)}>
                        Mark as read
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {state.nextCursor && (
              <div className="form-actions">
                <button type="button" className="btn-plain" onClick={more} disabled={busy}>
                  {busy ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </Section>
    </>
  );
}
