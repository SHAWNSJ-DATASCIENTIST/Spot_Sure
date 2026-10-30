// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../app/api";
import type { AppNotification } from "../app/notifications";
import { Root } from "../Root";

// The notification badge and page, against a fake API.

type Reply = { status: number; body?: unknown; delayMs?: number };
interface Call {
  method: string;
  url: string;
}

function mockApi(routes: Record<string, Reply | Reply[]>): Call[] {
  const calls: Call[] = [];
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ method, url });
      const q = queues.get(`${method} ${url}`);
      const reply: Reply = q ? (q.length > 1 ? q.shift()! : q[0]!) : { status: 404, body: { error: { code: "not_found", message: "Not found" } } };
      if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
      return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

const driver: User = {
  id: "11111111-1111-4111-8111-111111111111",
  fullName: "Dana Driver",
  email: "dana@test.invalid",
  phone: null,
  role: "driver",
  status: "active",
  emailVerified: false,
  isPlatformAdmin: false,
  administeredSocietyIds: [],
  createdAt: "2026-10-01T00:00:00.000Z",
};

const BOOKING = "44444444-4444-4444-8444-444444444444";
const N1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const N2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

function notice(over: Partial<AppNotification> = {}): AppNotification {
  return {
    id: N1,
    type: "booking_confirmed",
    message: "The owner confirmed your booking at Test Lot (Tue 1 Dec, 10:00–12:00 IST).",
    link: { kind: "booking", id: BOOKING },
    read: false,
    readAt: null,
    createdAt: "2026-10-28T10:00:00.000Z",
    ...over,
  };
}

const me: Reply = { status: 200, body: { data: driver } };
const count = (n: number): Reply => ({ status: 200, body: { data: { unreadCount: n } } });
const pageOf = (data: AppNotification[], unreadCount: number, nextCursor: string | null = null, delayMs?: number): Reply => ({
  status: 200,
  body: { data, nextCursor, unreadCount },
  delayMs,
});
const LIST = "GET /api/v1/me/notifications?limit=20";

function open(path: string) {
  window.history.replaceState(null, "", path);
  return render(<Root />);
}

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("notification badge", () => {
  it("shows the unread count in the shell, with an accessible label", async () => {
    mockApi({ "GET /api/v1/auth/me": me, "GET /api/v1/me/notifications/unread-count": count(3), "GET /api/v1/me/bookings": { status: 200, body: { data: [] } } });
    open("/app/driver");
    const bell = await screen.findByRole("link", { name: "Notifications, 3 unread" });
    expect(bell.getAttribute("href")).toBe("/app/notifications");
    expect(within(bell).getByText("3")).toBeTruthy();
  });

  it("shows no count when nothing is unread or the count can't be loaded", async () => {
    mockApi({ "GET /api/v1/auth/me": me, "GET /api/v1/me/notifications/unread-count": count(0), "GET /api/v1/me/bookings": { status: 200, body: { data: [] } } });
    open("/app/driver");
    const bell = await screen.findByRole("link", { name: "Notifications" });
    expect(bell.querySelector(".bell__count")).toBeNull();
    cleanup();
    mockApi({ "GET /api/v1/auth/me": me, "GET /api/v1/me/notifications/unread-count": { status: 500 }, "GET /api/v1/me/bookings": { status: 200, body: { data: [] } } });
    open("/app/driver");
    expect((await screen.findByRole("link", { name: "Notifications" })).querySelector(".bell__count")).toBeNull();
  });
});

describe("notifications page", () => {
  it("shows a loading state, then the list with unread ones marked", async () => {
    mockApi({
      "GET /api/v1/auth/me": me,
      "GET /api/v1/me/notifications/unread-count": count(1),
      [LIST]: pageOf([notice(), notice({ id: N2, type: "booking_requested", message: "Your request was sent.", read: true, readAt: "2026-10-28T09:00:00.000Z" })], 1, null, 30),
    });
    open("/app/notifications");
    expect(await screen.findByText("Loading notifications…")).toBeTruthy();
    expect(await screen.findByText("1 unread")).toBeTruthy();
    const items = screen.getAllByRole("listitem").filter((li) => li.classList.contains("notice"));
    expect(items).toHaveLength(2);
    expect(items[0]!.classList.contains("notice--unread")).toBe(true);
    expect(within(items[0]!).getByText("Unread:")).toBeTruthy();
    expect(items[1]!.classList.contains("notice--unread")).toBe(false);
    expect(within(items[1]!).queryByRole("button", { name: "Mark as read" })).toBeNull();
  });

  it("explains the empty state without claiming email or SMS", async () => {
    mockApi({ "GET /api/v1/auth/me": me, "GET /api/v1/me/notifications/unread-count": count(0), [LIST]: pageOf([], 0) });
    open("/app/notifications");
    expect(await screen.findByText("No notifications yet")).toBeTruthy();
    expect(screen.getByText(/doesn't send email or SMS yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark all as read" })).toBeNull();
  });

  it("shows an error with retry", async () => {
    mockApi({
      "GET /api/v1/auth/me": me,
      "GET /api/v1/me/notifications/unread-count": count(1),
      [LIST]: [{ status: 500, body: { error: { code: "internal_error", message: "Internal server error" } } }, pageOf([notice()], 1)],
    });
    open("/app/notifications");
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText(notice().message)).toBeTruthy();
  });

  it("marks one as read and updates the badge", async () => {
    const calls = mockApi({
      "GET /api/v1/auth/me": me,
      "GET /api/v1/me/notifications/unread-count": count(1),
      [LIST]: pageOf([notice()], 1),
      [`POST /api/v1/me/notifications/${N1}/read`]: { status: 200, body: { data: notice({ read: true, readAt: "2026-10-28T11:00:00.000Z" }), unreadCount: 0 } },
    });
    open("/app/notifications");
    expect(await screen.findByRole("link", { name: "Notifications, 1 unread" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Mark as read" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Mark as read" })).toBeNull());
    expect(calls.some((c) => c.method === "POST" && c.url === `/api/v1/me/notifications/${N1}/read`)).toBe(true);
    expect(screen.getByRole("link", { name: "Notifications" })).toBeTruthy();
    expect(screen.getByText("All notifications")).toBeTruthy();
  });

  it("marks everything read at once", async () => {
    mockApi({
      "GET /api/v1/auth/me": me,
      "GET /api/v1/me/notifications/unread-count": count(2),
      [LIST]: pageOf([notice(), notice({ id: N2 })], 2),
      "POST /api/v1/me/notifications/read-all": { status: 200, body: { data: { marked: 2, unreadCount: 0 } } },
    });
    open("/app/notifications");
    fireEvent.click(await screen.findByRole("button", { name: "Mark all as read" }));
    await waitFor(() => expect(screen.queryAllByRole("button", { name: "Mark as read" })).toHaveLength(0));
    expect(screen.getByRole("link", { name: "Notifications" })).toBeTruthy();
  });

  it("opening a notification marks it read and goes to the booking", async () => {
    const calls = mockApi({
      "GET /api/v1/auth/me": me,
      "GET /api/v1/me/notifications/unread-count": count(1),
      [LIST]: pageOf([notice()], 1),
      [`POST /api/v1/me/notifications/${N1}/read`]: { status: 200, body: { data: notice({ read: true }), unreadCount: 0 } },
      [`GET /api/v1/bookings/${BOOKING}`]: { status: 404, body: { error: { code: "not_found", message: "Booking not found" } } },
    });
    open("/app/notifications");
    fireEvent.click(await screen.findByRole("link", { name: notice().message }));
    await waitFor(() => expect(window.location.pathname).toBe(`/app/bookings/${BOOKING}`));
    const seq = calls.map((c) => `${c.method} ${c.url}`);
    expect(seq.indexOf(`POST /api/v1/me/notifications/${N1}/read`)).toBeLessThan(seq.indexOf(`GET /api/v1/bookings/${BOOKING}`));
  });

  it("loads older notifications with the cursor", async () => {
    mockApi({
      "GET /api/v1/auth/me": me,
      "GET /api/v1/me/notifications/unread-count": count(0),
      [LIST]: pageOf([notice({ read: true })], 0, "CUR1"),
      "GET /api/v1/me/notifications?limit=20&cursor=CUR1": pageOf([notice({ id: N2, message: "Older one", read: true })], 0),
    });
    open("/app/notifications");
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Older one")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});
