// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../app/api";
import { estimateTotalMinor, zonedToIso } from "../app/format";
import type { Availability, Booking, PublicListing } from "../app/types";
import { Root } from "../Root";

type Reply = { status: number; body?: unknown };
interface Call {
  method: string;
  url: string;
  body?: unknown;
}

function mockApi(routes: Record<string, Reply>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ method, url, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
      const r = routes[`${method} ${url}`] ?? { status: 404, body: { error: { code: "not_found", message: "Not found" } } };
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

const base: User = {
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
const owner: User = { ...base, id: "22222222-2222-4222-8222-222222222222", role: "parking_owner" };
const me = (u: User): Reply => ({ status: 200, body: { data: u } });
const SPACE = "55555555-5555-4555-8555-555555555555";
const BOOKING = "44444444-4444-4444-8444-444444444444";

const allWeek: Availability["weekly"] = (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((day) => ({ day, opens: "08:00", closes: "20:00" }));

const listing: PublicListing = {
  id: SPACE,
  name: "Test Garage",
  description: null,
  parkingType: "garage",
  area: { locality: "Altinho", city: "Panaji", region: "Goa", countryCode: "IN" },
  approximateLocation: null,
  vehicleTypes: ["car"],
  maxDimensionsCm: { height: null, length: null, width: null },
  capacity: 1,
  hourlyPrice: { amountMinor: 4000, currency: "INR" },
  dailyPrice: null,
  bookingMinutes: { min: 60, max: 240 },
  availability: { timezone: "Asia/Kolkata", weekly: allWeek },
  parkingRules: null,
  accessibilityInfo: null,
  restrictions: null,
  photos: [],
};

function booking(over: Partial<Booking> = {}): Booking {
  return {
    id: BOOKING,
    userId: base.id,
    spaceId: SPACE,
    spaceName: "Test Garage",
    area: { locality: "Altinho", city: "Panaji" },
    bayId: "66666666-6666-4666-8666-666666666666",
    bayLabel: "B1",
    startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    endsAt: new Date(Date.now() + 2 * 86_400_000 + 7_200_000).toISOString(),
    status: "pending",
    cancelledBy: null,
    price: { hourlyAmountMinor: 4000, totalAmountMinor: 8000, currency: "INR" },
    payment: { status: "not_collected" },
    privateAccess: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

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

describe("time helpers", () => {
  it("converts listing-local wall time to UTC", () => {
    expect(zonedToIso("2026-12-01", "10:00", "Asia/Kolkata")).toBe("2026-12-01T04:30:00.000Z");
    expect(zonedToIso("2026-07-01", "10:00", "Europe/London")).toBe("2026-07-01T09:00:00.000Z");
  });
  it("estimates with the same rule as the API", () => {
    expect(estimateTotalMinor(4000, 120, null)).toBe(8000);
    expect(estimateTotalMinor(4000, 600, 30000)).toBe(30000);
  });
});

/** Mock key for the server quote of a 2026-12-01 window in India time. */
const quoteKey = (from: string, to: string) =>
  `GET /api/v1/parking-spaces/${SPACE}/quote?${new URLSearchParams({
    startsAt: zonedToIso("2026-12-01", from, "Asia/Kolkata"),
    endsAt: zonedToIso("2026-12-01", to, "Asia/Kolkata"),
  })}`;
const quoteReply = (over: object = {}): Reply => ({
  status: 200,
  body: {
    data: {
      problems: [],
      available: true,
      freeSpaces: 1,
      price: { minutes: 120, billableHours: 2, hourlyPriceMinor: 4000, hourlyTotalMinor: 8000, dailyCapMinor: null, dailyCapApplied: false, totalMinor: 8000, currency: "INR" },
      ...over,
    },
  },
});

async function pick(from: string, to: string) {
  fireEvent.change(await screen.findByLabelText("Date"), { target: { value: "2026-12-01" } });
  fireEvent.change(screen.getByLabelText("From"), { target: { value: from } });
  fireEvent.change(screen.getByLabelText("Until"), { target: { value: to } });
}

describe("requesting a booking", () => {
  it("shows the server's price breakdown, then sends only the listing and times", async () => {
    const calls = mockApi({
      "GET /api/v1/auth/me": me(base),
      [`GET /api/v1/parking-spaces/${SPACE}`]: { status: 200, body: { data: listing } },
      [quoteKey("10:00", "12:00")]: quoteReply(),
      "POST /api/v1/bookings": { status: 201, body: { data: booking() } },
      [`GET /api/v1/bookings/${BOOKING}`]: { status: 200, body: { data: booking() } },
    });
    open(`/app/discover/${SPACE}`);
    await pick("10:00", "12:00");
    expect(await screen.findByText("2 h × ₹40.00")).toBeTruthy();
    expect(screen.getAllByText("₹80.00")).toHaveLength(2);
    expect(screen.getByText(/A space is free at this time/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Request booking" }));
    await waitFor(() => expect(window.location.pathname).toBe(`/app/bookings/${BOOKING}`));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      spaceId: SPACE,
      startsAt: "2026-12-01T04:30:00.000Z",
      endsAt: "2026-12-01T06:30:00.000Z",
    });
  });

  it("only offers times inside opening hours and honours the minimum length", async () => {
    mockApi({
      "GET /api/v1/auth/me": me(base),
      [`GET /api/v1/parking-spaces/${SPACE}`]: { status: 200, body: { data: { ...listing, availability: { timezone: "Asia/Kolkata", weekly: [{ day: "tue", opens: "08:00", closes: "10:00" }] } } } },
    });
    open(`/app/discover/${SPACE}`);
    // 2026-12-01 is a Tuesday.
    fireEvent.change(await screen.findByLabelText("Date"), { target: { value: "2026-12-01" } });
    const starts = [...(screen.getByLabelText("From") as HTMLSelectElement).options].map((o) => o.value).filter(Boolean);
    expect(starts).toEqual(["08:00", "08:15", "08:30", "08:45", "09:00"]);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-12-02" } });
    expect(screen.getByRole("option", { name: "Closed this day" })).toBeTruthy();
  });

  it("shows the server's reason when a request is refused after the quote (a race)", async () => {
    mockApi({
      "GET /api/v1/auth/me": me(base),
      [`GET /api/v1/parking-spaces/${SPACE}`]: { status: 200, body: { data: listing } },
      [quoteKey("10:00", "11:00")]: quoteReply(),
      "POST /api/v1/bookings": { status: 409, body: { error: { code: "no_space_available", message: "No space is free at that time" } } },
    });
    open(`/app/discover/${SPACE}`);
    await pick("10:00", "11:00");
    await screen.findByText(/A space is free at this time/);
    fireEvent.click(screen.getByRole("button", { name: "Request booking" }));
    expect(await screen.findByText("No space is free at that time")).toBeTruthy();
  });

  it("won't submit when the quote says no space is free", async () => {
    const calls = mockApi({
      "GET /api/v1/auth/me": me(base),
      [`GET /api/v1/parking-spaces/${SPACE}`]: { status: 200, body: { data: listing } },
      [quoteKey("10:00", "12:00")]: quoteReply({ available: false, freeSpaces: 0 }),
    });
    open(`/app/discover/${SPACE}`);
    await pick("10:00", "12:00");
    expect(await screen.findByText("No space is free at that time. Try another time.")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Request booking" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("lists the server's problems and the daily cap", async () => {
    mockApi({
      "GET /api/v1/auth/me": me(base),
      [`GET /api/v1/parking-spaces/${SPACE}`]: { status: 200, body: { data: listing } },
      [quoteKey("10:00", "12:00")]: quoteReply({
        available: false,
        problems: ["The start time has already passed"],
        price: { minutes: 120, billableHours: 2, hourlyPriceMinor: 4000, hourlyTotalMinor: 8000, dailyCapMinor: 5000, dailyCapApplied: true, totalMinor: 5000, currency: "INR" },
      }),
    });
    open(`/app/discover/${SPACE}`);
    await pick("10:00", "12:00");
    expect(await screen.findByText("The start time has already passed")).toBeTruthy();
    expect(screen.getByText("Capped at the daily price")).toBeTruthy();
  });

  it("offers a retry when the quote can't be loaded", async () => {
    mockApi({
      "GET /api/v1/auth/me": me(base),
      [`GET /api/v1/parking-spaces/${SPACE}`]: { status: 200, body: { data: listing } },
      [quoteKey("10:00", "12:00")]: { status: 500, body: { error: { code: "internal_error", message: "Internal server error" } } },
    });
    open(`/app/discover/${SPACE}`);
    await pick("10:00", "12:00");
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Request booking" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("doesn't offer the request form to owners", async () => {
    mockApi({ "GET /api/v1/auth/me": me(owner), [`GET /api/v1/parking-spaces/${SPACE}`]: { status: 200, body: { data: listing } } });
    open(`/app/discover/${SPACE}`);
    expect(await screen.findByText("Booking requests are made from driver accounts.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request booking" })).toBeNull();
  });
});

describe("booking actions", () => {
  it("lets the owner confirm a request, after confirming the intent", async () => {
    const ownerView = { ...booking(), userId: undefined };
    const calls = mockApi({
      "GET /api/v1/auth/me": me(owner),
      [`GET /api/v1/bookings/${BOOKING}`]: { status: 200, body: { data: ownerView } },
      [`POST /api/v1/bookings/${BOOKING}/confirm`]: { status: 200, body: { data: { ...ownerView, status: "confirmed" } } },
    });
    open(`/app/bookings/${BOOKING}`);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm booking" }));
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Confirm", hidden: true }));
    await waitFor(() => expect(calls.map((c) => `${c.method} ${c.url}`)).toContain(`POST /api/v1/bookings/${BOOKING}/confirm`));
    expect(screen.getByText(/drivers' details aren't shared/)).toBeTruthy();
  });

  it("gives drivers cancel, never confirm, and shows the address only once confirmed", async () => {
    mockApi({
      "GET /api/v1/auth/me": me(base),
      [`GET /api/v1/bookings/${BOOKING}`]: {
        status: 200,
        body: { data: booking({ status: "confirmed", privateAccess: { address: "7 Private Road, Altinho", entryInstructions: "Gate code 1234" } }) },
      },
    });
    open(`/app/bookings/${BOOKING}`);
    expect(await screen.findByText("7 Private Road, Altinho")).toBeTruthy();
    expect(screen.getByText("Gate code 1234")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel booking" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm booking" })).toBeNull();
    expect(screen.getByText("Not handled by SpotSure during the pilot. Nothing has been charged.")).toBeTruthy();
    expect(screen.queryByText(/paid/i)).toBeNull();
  });

  it("shows the payment status the server reports, not one inferred from the booking status", async () => {
    mockApi({
      "GET /api/v1/auth/me": me(base),
      [`GET /api/v1/bookings/${BOOKING}`]: { status: 200, body: { data: booking({ status: "confirmed", payment: { status: "pending" } }) } },
    });
    open(`/app/bookings/${BOOKING}`);
    expect(await screen.findByText("Payment started but not yet confirmed by the payment provider.")).toBeTruthy();
    expect(screen.queryByText("Paid through SpotSure.")).toBeNull();
  });

  it("offers no actions on a past booking", async () => {
    mockApi({
      "GET /api/v1/auth/me": me(base),
      [`GET /api/v1/bookings/${BOOKING}`]: { status: 200, body: { data: booking({ status: "completed", startsAt: "2026-01-01T04:30:00.000Z", endsAt: "2026-01-01T06:30:00.000Z" }) } },
    });
    open(`/app/bookings/${BOOKING}`);
    expect(await screen.findByText("Completed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel booking" })).toBeNull();
  });
});
