// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../app/api";
import type { PublicListing } from "../app/types";
import { Root } from "../Root";
import { filterProblems, searchQuery } from "./discover";

type Reply = { status: number; body?: unknown };

function mockApi(handler: (url: string) => Reply): string[] {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      // The shell's notification badge polls on its own; keep it out of each test's handler.
      if (url === "/api/v1/me/notifications/unread-count") {
        return new Response(JSON.stringify({ data: { unreadCount: 0 } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      urls.push(url);
      const r = url === "/api/v1/auth/me" ? { status: 200, body: { data: driver } } : handler(url);
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { "content-type": "application/json" } });
    }),
  );
  return urls;
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

function item(id: string, name: string, over: Partial<PublicListing> = {}): PublicListing {
  return {
    id,
    name,
    description: null,
    parkingType: "garage",
    area: { locality: "Altinho", city: "Panaji", region: "Goa", countryCode: "IN" },
    approximateLocation: null,
    vehicleTypes: ["car"],
    maxDimensionsCm: { height: null, length: null, width: null },
    capacity: 2,
    hourlyPrice: { amountMinor: 4000, currency: "INR" },
    dailyPrice: null,
    bookingMinutes: { min: 60, max: null },
    availability: null,
    parkingRules: null,
    accessibilityInfo: null,
    restrictions: null,
    photos: [],
    ...over,
  };
}

const page = (rows: PublicListing[], meta = { page: 1, pageSize: 12, total: rows.length, totalPages: 1 }): Reply => ({ status: 200, body: { data: rows, page: meta } });
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function open(path: string) {
  window.history.replaceState(null, "", path);
  return render(<Root />);
}
const searches = (urls: string[]) => urls.filter((u) => u.startsWith("/api/v1/parking-spaces?")).map((u) => new URLSearchParams(u.split("?")[1]));

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("query building", () => {
  const empty = { q: "", type: "", vehicle: "", priceMin: "", priceMax: "", date: "", from: "", until: "", sort: "newest" } as const;
  it("maps filters to API parameters, converting the window to UTC", () => {
    const qs = new URLSearchParams(searchQuery({ ...empty, q: " panaji ", type: "garage", vehicle: "suv", priceMax: "60", date: "2026-12-01", from: "10:00", until: "12:00", sort: "price_asc" }, 2));
    expect(Object.fromEntries(qs)).toEqual({
      sort: "price_asc",
      page: "2",
      pageSize: "12",
      q: "panaji",
      type: "garage",
      vehicle: "suv",
      priceMax: "60",
      startsAt: "2026-12-01T04:30:00.000Z",
      endsAt: "2026-12-01T06:30:00.000Z",
    });
  });
  it("flags filter mistakes before any request", () => {
    expect(filterProblems({ ...empty, priceMin: "abc" })).toHaveProperty("priceMin");
    expect(filterProblems({ ...empty, priceMin: "50", priceMax: "10" })).toHaveProperty("priceMax");
    expect(filterProblems({ ...empty, date: "2026-12-01" })).toHaveProperty("until");
    expect(filterProblems({ ...empty, date: "2026-12-01", from: "12:00", until: "10:00" })).toHaveProperty("until");
    expect(filterProblems({ ...empty, date: "2026-12-01", from: "10:00", until: "12:00" })).toEqual({});
  });
});

describe("discovery page", () => {
  it("renders server results as cards with price, area, type and capacity", async () => {
    mockApi(() => page([item(A, "Altinho Garage")]));
    open("/app/discover");
    expect(await screen.findByRole("link", { name: "Altinho Garage" })).toBeTruthy();
    expect(screen.getByText("Altinho, Panaji")).toBeTruthy();
    expect(screen.getByText(/Garage · 2 spaces/)).toBeTruthy();
    expect(screen.getByText("₹40.00")).toBeTruthy();
    expect(screen.getByText("1 listing")).toBeTruthy();
    expect(screen.getByText(/A map view isn't available yet/)).toBeTruthy();
  });

  it("sends filters to the server and keeps them in the URL", async () => {
    const urls = mockApi(() => page([]));
    open("/app/discover");
    await screen.findByText("No parking is listed yet");
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "panaji" } });
    fireEvent.change(screen.getByLabelText("Your vehicle"), { target: { value: "suv" } });
    fireEvent.change(screen.getByLabelText("Max ₹/hr"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "price_asc" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(searches(urls).some((p) => p.get("q") === "panaji")).toBe(true));
    const last = searches(urls).slice(-1)[0]!;
    expect(Object.fromEntries(last)).toMatchObject({ q: "panaji", vehicle: "suv", priceMax: "60", sort: "price_asc" });
    expect(new URLSearchParams(window.location.search).get("vehicle")).toBe("suv");
  });

  it("validates filters on the client without calling the API", async () => {
    const urls = mockApi(() => page([]));
    open("/app/discover");
    await screen.findByText("No parking is listed yet");
    const before = searches(urls).length;
    fireEvent.change(screen.getByLabelText("Min ₹/hr"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Max ₹/hr"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByText("Must be at least the minimum")).toBeTruthy();
    expect(screen.getByLabelText("Max ₹/hr").getAttribute("aria-invalid")).toBe("true");
    expect(searches(urls)).toHaveLength(before);
  });

  it("paginates through server pages", async () => {
    const urls = mockApi((u) =>
      u.includes("page=2")
        ? page([item(A, "Second Page Lot")], { page: 2, pageSize: 12, total: 13, totalPages: 2 })
        : page([item(A, "First Page Lot")], { page: 1, pageSize: 12, total: 13, totalPages: 2 }),
    );
    open("/app/discover");
    expect(await screen.findByText("Page 1 of 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("link", { name: "Second Page Lot" })).toBeTruthy();
    expect(searches(urls).slice(-1)[0]!.get("page")).toBe("2");
  });

  it("shows an error with retry, then the results", async () => {
    let fail = true;
    mockApi(() => {
      if (fail) {
        fail = false;
        return { status: 500, body: { error: { code: "internal_error", message: "Internal server error" } } };
      }
      return page([item(A, "Recovered Lot")]);
    });
    open("/app/discover");
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Recovered Lot" })).toBeTruthy();
  });

  it("tells drivers honestly when nothing is listed, with an owner sign-up path", async () => {
    mockApi(() => page([]));
    open("/app/discover");
    expect(await screen.findByText("No parking is listed yet")).toBeTruthy();
    expect(screen.getByText(`${window.location.origin}/register?role=parking_owner`)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Lot/ })).toBeNull();
  });

  it("uses a 'no matches' state, not the onboarding one, when filters are applied", async () => {
    mockApi(() => page([]));
    open("/app/discover?q=nowhere");
    expect(await screen.findByText("No parking matches")).toBeTruthy();
    expect(screen.queryByText("No parking is listed yet")).toBeNull();
  });

  it("carries an availability window into the listing link and booking form", async () => {
    mockApi(() => page([item(A, "Window Lot")]));
    open("/app/discover?date=2026-12-01&from=10:00&until=12:00");
    const link = await screen.findByRole("link", { name: "Window Lot" });
    expect(link.getAttribute("href")).toBe(`/app/discover/${A}?date=2026-12-01&from=10:00&until=12:00`);
    expect(screen.getByText(/Filtered to spaces open and free for your time/)).toBeTruthy();
  });
});
