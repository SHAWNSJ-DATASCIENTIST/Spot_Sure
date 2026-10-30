// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../app/api";
import type { Booking, Society } from "../app/types";
import { listing } from "../test/fixtures";
import { Root } from "../Root";

// Renders the real app against a fake API. Every request goes through the
// shared client, so these tests also check what is requested and how.

/** delayMs simulates network latency, so intermediate loading states really render. */
type Reply = { status: number; body?: unknown; delayMs?: number };
type Routes = Record<string, Reply | Reply[]>;

interface Call {
  method: string;
  url: string;
  credentials?: RequestCredentials;
}

function mockApi(routes: Routes): Call[] {
  const calls: Call[] = [];
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ method, url, credentials: init.credentials });
      const q = queues.get(`${method} ${url}`);
      const reply: Reply = q ? (q.length > 1 ? q.shift()! : q[0]!) : { status: 404, body: { error: { code: "not_found", message: "Not found" } } };
      if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
      return new Response(reply.status === 204 ? null : JSON.stringify(reply.body ?? {}), {
        status: reply.status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

function user(over: Partial<User>): User {
  return {
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
    ...over,
  };
}

const driver = user({});
const owner = user({ id: "22222222-2222-4222-8222-222222222222", fullName: "Omar Owner", role: "parking_owner" });
const SOCIETY_ID = "33333333-3333-4333-8333-333333333333";
const societyAdmin = user({ fullName: "Sita Admin", administeredSocietyIds: [SOCIETY_ID] });

const me = (u: User | null): Reply => (u ? { status: 200, body: { data: u } } : { status: 401, body: { error: { code: "unauthenticated", message: "Sign in required" } } });

function booking(over: Partial<Booking> = {}): Booking {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    spaceId: "55555555-5555-4555-8555-555555555555",
    spaceName: "Test Lot",
    bayId: "66666666-6666-4666-8666-666666666666",
    bayLabel: "B1",
    startsAt: "2099-01-01T10:00:00.000Z",
    endsAt: "2099-01-01T12:00:00.000Z",
    status: "confirmed",
    price: { hourlyAmountMinor: 5000, totalAmountMinor: 10000, currency: "INR" },
    createdAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

const total = (n: number): Reply => ({ status: 200, body: { data: [], page: { page: 1, pageSize: 1, total: n, totalPages: n } } });
const ownerCounts = (all: number, published: number, review: number): Routes => ({
  "GET /api/v1/me/parking-spaces?pageSize=1": total(all),
  "GET /api/v1/me/parking-spaces?pageSize=1&status=published": total(published),
  "GET /api/v1/me/parking-spaces?pageSize=1&status=pending_verification": total(review),
});

function open(path: string) {
  window.history.replaceState(null, "", path);
  return render(<Root />);
}

const urls = (calls: Call[]) => calls.map((c) => `${c.method} ${c.url}`);

// jsdom has no scrolling; navigate() scrolls to top.
beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("route protection", () => {
  it("sends signed-out visitors to sign in, preserving where they were going", async () => {
    mockApi({ "GET /api/v1/auth/me": me(null) });
    open("/app/owner/bookings");
    expect(await screen.findByText("Sign in to continue.")).toBeTruthy();
    expect(window.location.pathname).toBe("/sign-in");
    expect(new URLSearchParams(window.location.search).get("next")).toBe("/app/owner/bookings");
  });

  it("preselects the owner account type from an owner sign-up link", async () => {
    mockApi({ "GET /api/v1/auth/me": me(null) });
    open("/register?role=parking_owner");
    const owner = (await screen.findByRole("radio", { name: /I have parking to list/ })) as HTMLInputElement;
    expect(owner.checked).toBe(true);
    cleanup();
    mockApi({ "GET /api/v1/auth/me": me(null) });
    open("/register?role=platform_admin");
    expect(((await screen.findByRole("radio", { name: /I need parking/ })) as HTMLInputElement).checked).toBe(true);
  });

  it("lands each role on its own dashboard from /app", async () => {
    mockApi({ "GET /api/v1/auth/me": me(driver), "GET /api/v1/me/bookings": { status: 200, body: { data: [] } } });
    open("/app");
    expect(await screen.findByRole("heading", { level: 1, name: "Hello, Dana." })).toBeTruthy();
    expect(window.location.pathname).toBe("/app/driver");
    cleanup();

    mockApi({
      "GET /api/v1/auth/me": me(owner),
      ...ownerCounts(0, 0, 0),
      "GET /api/v1/me/space-bookings": { status: 200, body: { data: [] } },
    });
    open("/app");
    expect(await screen.findByRole("heading", { level: 1, name: "Your parking." })).toBeTruthy();
    expect(window.location.pathname).toBe("/app/owner");
  });

  it("refuses a driver the owner dashboard without requesting owner data", async () => {
    const calls = mockApi({ "GET /api/v1/auth/me": me(driver) });
    open("/app/owner");
    expect(await screen.findByText("You don't have access to this.")).toBeTruthy();
    expect(screen.getByText("This dashboard is for parking owner accounts.")).toBeTruthy();
    expect(urls(calls).some((u) => u.startsWith("GET /api/v1/me/parking-spaces"))).toBe(false);
    expect(urls(calls)).not.toContain("GET /api/v1/me/space-bookings");
    expect(screen.queryByRole("link", { name: "My spaces" })).toBeNull();
  });

  it("refuses an owner the driver dashboard without requesting driver data", async () => {
    const calls = mockApi({ "GET /api/v1/auth/me": me(owner) });
    open("/app/driver/bookings");
    expect(await screen.findByText("This dashboard is for driver accounts.")).toBeTruthy();
    expect(urls(calls)).not.toContain("GET /api/v1/me/bookings");
  });

  it("refuses the society area to users without an assignment", async () => {
    mockApi({ "GET /api/v1/auth/me": me(driver) });
    open("/app/society");
    expect(await screen.findByText(/administrators of a society/)).toBeTruthy();
  });
});

describe("driver dashboard", () => {
  it("shows the driver's own bookings, fetched with the session cookie", async () => {
    const calls = mockApi({
      "GET /api/v1/auth/me": me(driver),
      "GET /api/v1/me/bookings": { status: 200, body: { data: [booking()] } },
    });
    open("/app/driver");
    expect(await screen.findByRole("link", { name: "Test Lot" })).toBeTruthy();
    expect(screen.getByText("₹100.00")).toBeTruthy();
    const req = calls.find((c) => c.url === "/api/v1/me/bookings")!;
    expect(req.credentials).toBe("same-origin");
    // Identity comes from the session, never a user id in the URL.
    expect(calls.every((c) => !c.url.includes(driver.id))).toBe(true);
  });

  it("never counts a pending request as a confirmed booking", async () => {
    mockApi({
      "GET /api/v1/auth/me": me(driver),
      "GET /api/v1/me/bookings": {
        status: 200,
        body: { data: [booking({ status: "pending" }), booking({ id: "45454545-4545-4545-8545-454545454545", status: "pending" }), booking({ id: "46464646-4646-4646-8646-464646464646" })] },
      },
    });
    open("/app/driver");
    await screen.findByText("Awaiting owner");
    const card = (label: string) =>
      [...document.querySelectorAll(".summary-card")].find((c) => c.querySelector(".summary-card__label")!.textContent === label)!
        .querySelector(".summary-card__value")!.textContent;
    expect(card("Awaiting owner")).toBe("2");
    expect(card("Confirmed")).toBe("1");
  });

  it("shows a first-use state when there are no bookings", async () => {
    mockApi({ "GET /api/v1/auth/me": me(driver), "GET /api/v1/me/bookings": { status: 200, body: { data: [] } } });
    open("/app/driver");
    expect(await screen.findByText("No bookings yet")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Find parking" }).length).toBeGreaterThan(0);
    // Booking requests work; the first-use text must not say they're unavailable.
    expect(screen.getByText(/send a request; the owner confirms or declines it/)).toBeTruthy();
    expect(screen.queryByText(/later release/)).toBeNull();
  });

  it("shows an error with retry when loading fails", async () => {
    mockApi({
      "GET /api/v1/auth/me": me(driver),
      "GET /api/v1/me/bookings": [
        { status: 500, body: { error: { code: "internal_error", message: "Internal server error" } } },
        { status: 200, body: { data: [booking()] } },
      ],
    });
    open("/app/driver/bookings");
    expect(await screen.findByText("This couldn't be loaded.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Test Lot" })).toBeTruthy();
  });

  it("signs out when the server says the session has ended", async () => {
    mockApi({
      "GET /api/v1/auth/me": me(driver),
      "GET /api/v1/me/bookings": { status: 401, body: { error: { code: "unauthenticated", message: "Sign in required" } } },
    });
    open("/app/driver");
    expect(await screen.findByText("Your session has ended. Sign in again to continue.")).toBeTruthy();
  });
});

describe("owner dashboard", () => {
  it("summarises the owner's listings from exact API totals, plus booking activity", async () => {
    mockApi({
      "GET /api/v1/auth/me": me(owner),
      ...ownerCounts(12, 7, 2),
      "GET /api/v1/me/space-bookings": { status: 200, body: { data: [booking({ spaceName: "Owner Lot" })] } },
    });
    open("/app/owner");
    await screen.findByText("Listings");
    const card = (label: string) => screen.getByText(label).parentElement!.querySelector(".summary-card__value")!.textContent;
    expect(card("Listings")).toBe("12");
    expect(card("Published")).toBe("7");
    expect(card("In review")).toBe("2");
    await waitFor(() => expect(card("Confirmed upcoming")).toBe("1"));
  });

  it("shows a first-use state with a create action when nothing is listed", async () => {
    mockApi({
      "GET /api/v1/auth/me": me(owner),
      ...ownerCounts(0, 0, 0),
      "GET /api/v1/me/space-bookings": { status: 200, body: { data: [] } },
    });
    open("/app/owner");
    expect(await screen.findByText("You haven't listed a space yet")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "New listing" })[0]!.getAttribute("href")).toBe("/app/owner/spaces/new");
  });

  it("shows 'not yours' when the API refuses another owner's listing", async () => {
    mockApi({
      "GET /api/v1/auth/me": me(owner),
      "GET /api/v1/me/parking-spaces/99999999-9999-4999-8999-999999999999": { status: 403, body: { error: { code: "forbidden", message: "No" } } },
    });
    open("/app/owner/spaces/99999999-9999-4999-8999-999999999999");
    expect(await screen.findByText("This listing isn't one of yours")).toBeTruthy();
  });

  it("keeps the page and its confirmation on screen after saving", async () => {
    const id = listing().id;
    const calls = mockApi({
      "GET /api/v1/auth/me": me(owner),
      [`GET /api/v1/me/parking-spaces/${id}`]: [
        { status: 200, body: { data: listing() } },
        { status: 200, body: { data: listing() }, delayMs: 40 },
      ],
      [`GET /api/v1/parking-spaces/${id}/bookings`]: { status: 200, body: { data: [] } },
      [`PATCH /api/v1/parking-spaces/${id}`]: { status: 200, body: { data: listing() } },
    });
    open(`/app/owner/spaces/${id}`);
    fireEvent.click(await screen.findByRole("button", { name: "Save changes" }));
    // Wait for the post-save refetch to finish, then the message must still be there.
    await waitFor(() => expect(urls(calls).filter((u) => u === `GET /api/v1/me/parking-spaces/${id}`)).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.getByText("Saved.")).toBeTruthy();
  });

  it("asks for confirmation before archiving a listing", async () => {
    const id = listing().id;
    const calls = mockApi({
      "GET /api/v1/auth/me": me(owner),
      [`GET /api/v1/me/parking-spaces/${id}`]: { status: 200, body: { data: listing() } },
      [`GET /api/v1/parking-spaces/${id}/bookings`]: { status: 200, body: { data: [] } },
      [`POST /api/v1/parking-spaces/${id}/actions`]: { status: 200, body: { data: listing({ status: "archived" }) } },
    });
    open(`/app/owner/spaces/${id}`);
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    expect(urls(calls)).not.toContain(`POST /api/v1/parking-spaces/${id}/actions`);
    fireEvent.click(screen.getByRole("button", { name: "Archive listing" }));
    await waitFor(() => expect(urls(calls)).toContain(`POST /api/v1/parking-spaces/${id}/actions`));
  });
});

describe("society dashboard", () => {
  const society: Society = {
    id: SOCIETY_ID,
    name: "Test Heights",
    address: { line: null, city: "Panaji", region: null, postalCode: null, countryCode: "IN" },
    location: null,
    accessRules: {},
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };

  it("lists only the societies assigned to the admin", async () => {
    mockApi({ "GET /api/v1/auth/me": me(societyAdmin), "GET /api/v1/me/societies": { status: 200, body: { data: [society] } } });
    open("/app/society");
    expect(await screen.findByRole("link", { name: "Test Heights" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Societies" })).toBeTruthy();
  });

  it("shows access denied when the API refuses a society", async () => {
    mockApi({
      "GET /api/v1/auth/me": me(societyAdmin),
      "GET /api/v1/societies/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa": { status: 403, body: { error: { code: "forbidden", message: "No" } } },
    });
    open("/app/society/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(await screen.findByText("You're not an administrator of this society.")).toBeTruthy();
  });
});

describe("logout", () => {
  it("calls the real logout endpoint from the account menu", async () => {
    const calls = mockApi({
      "GET /api/v1/auth/me": me(driver),
      "GET /api/v1/me/bookings": { status: 200, body: { data: [] } },
      "POST /api/v1/auth/logout": { status: 204 },
    });
    open("/app/driver");
    fireEvent.click(await screen.findByRole("button", { name: /account menu/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByText("You've been signed out.")).toBeTruthy();
    expect(urls(calls)).toContain("POST /api/v1/auth/logout");
    expect(window.location.pathname).toBe("/sign-in");
  });
});
