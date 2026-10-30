// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../app/api";
import type { PublicListing } from "../app/types";
import { Root } from "../Root";
import { EMPTY_DRAFT, photoProblem, validateDraft } from "./listings";
import { listing } from "../test/fixtures";

// Listing management against a fake API: validation, request shapes, and the
// key owner workflows. Server-side rules are tested in api/test/listings.test.ts.

type Reply = { status: number; body?: unknown };
interface Call {
  method: string;
  url: string;
  body?: unknown;
}

function mockApi(routes: Record<string, Reply | ((body: unknown) => Reply)>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
      calls.push({ method, url, body });
      const r = routes[`${method} ${url}`];
      const reply = typeof r === "function" ? r(body) : (r ?? { status: 404, body: { error: { code: "not_found", message: "Not found" } } });
      return new Response(reply.status === 204 ? null : JSON.stringify(reply.body ?? {}), {
        status: reply.status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

const owner: User = {
  id: "22222222-2222-4222-8222-222222222222",
  fullName: "Omar Owner",
  email: "omar@test.invalid",
  phone: null,
  role: "parking_owner",
  status: "active",
  emailVerified: false,
  isPlatformAdmin: false,
  administeredSocietyIds: [],
  createdAt: "2026-10-01T00:00:00.000Z",
};
const me = (u: User) => ({ status: 200, body: { data: u } });
const ID = listing().id;

function open(path: string) {
  window.history.replaceState(null, "", path);
  return render(<Root />);
}
const fill = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("validateDraft", () => {
  const ok = { ...EMPTY_DRAFT, name: "Valid listing", price: "40" };

  it("converts a valid draft into API units", () => {
    const { errors, body } = validateDraft({ ...ok, price: "40.50", dailyPrice: "300", capacity: "3", maxHeightCm: "210", latitude: "15.49", longitude: "73.82" });
    expect(errors).toEqual({});
    expect(body).toMatchObject({ hourlyPriceMinor: 4050, dailyPriceMinor: 30000, capacity: 3, maxHeightCm: 210, latitude: 15.49, longitude: 73.82 });
    expect(body).not.toHaveProperty("ownerId");
    expect(body).not.toHaveProperty("status");
  });

  it("flags invalid fields with readable messages", () => {
    const { errors } = validateDraft({
      ...EMPTY_DRAFT,
      name: "ab",
      price: "-5",
      dailyPrice: "abc",
      capacity: "0",
      postalCode: "12345",
      latitude: "15.4",
      maxHeightCm: "50",
      vehicleTypes: [],
      minBookingMinutes: "240",
      maxBookingMinutes: "60",
    });
    expect(Object.keys(errors).sort()).toEqual(
      ["capacity", "dailyPrice", "longitude", "maxBookingMinutes", "maxHeightCm", "name", "postalCode", "price", "vehicleTypes"].sort(),
    );
  });

  it("accepts dictated prices and PIN codes, and flags over-long text instead of cutting it", () => {
    const long = "word ".repeat(450); // 2250 characters, as a long dictation might produce
    const { errors, body } = validateDraft({ ...ok, price: "₹40.", dailyPrice: "300 rupees", postalCode: "403 001", description: long });
    expect(body).toMatchObject({ hourlyPriceMinor: 4000, dailyPriceMinor: 30000, postalCode: "403001" });
    expect(errors).toEqual({ description: "At most 2000 characters" });
    expect(validateDraft({ ...ok, name: "x".repeat(121) }).errors.name).toBe("At most 120 characters");
  });
});

describe("dictated text in the listing form", () => {
  it("keeps every character of long text and shows a live count near the limit", async () => {
    mockApi({ "GET /api/v1/auth/me": me(owner), "GET /api/v1/me/notifications/unread-count": { status: 200, body: { data: { unreadCount: 0 } } } });
    open("/app/owner/spaces/new");
    const description = await screen.findByLabelText("Description");
    const long = "a".repeat(2050);
    fireEvent.change(description, { target: { value: long } });
    expect((description as HTMLTextAreaElement).value).toHaveLength(2050);
    expect(screen.getByText(/2050 \/ 2000 characters/)).toBeTruthy();
    const pin = screen.getByLabelText("PIN code") as HTMLInputElement;
    fireEvent.change(pin, { target: { value: "403 001" } });
    expect(pin.value).toBe("403 001");
  });
});

describe("photoProblem", () => {
  it("accepts JPEG/PNG up to 5 MB only", () => {
    expect(photoProblem({ type: "image/jpeg", size: 1000 })).toBeUndefined();
    expect(photoProblem({ type: "image/gif", size: 1000 })).toMatch(/JPEG or PNG/);
    expect(photoProblem({ type: "image/png", size: 6_000_000 })).toMatch(/5 MB/);
  });
});

describe("create listing", () => {
  it("validates on the client before sending anything", async () => {
    const calls = mockApi({ "GET /api/v1/auth/me": me(owner) });
    open("/app/owner/spaces/new");
    fireEvent.click(await screen.findByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Please fix the highlighted fields.")).toBeTruthy();
    expect(screen.getByText("Give the listing a title of at least 3 characters")).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(document.activeElement?.id).toBe("listing-name");
  });

  it("posts the draft in API units and opens the new listing", async () => {
    const calls = mockApi({
      "GET /api/v1/auth/me": me(owner),
      "POST /api/v1/parking-spaces": { status: 201, body: { data: listing({ status: "draft" }) } },
      [`GET /api/v1/me/parking-spaces/${ID}`]: { status: 200, body: { data: listing({ status: "draft" }) } },
      [`GET /api/v1/parking-spaces/${ID}/bookings`]: { status: 200, body: { data: [] } },
    });
    open("/app/owner/spaces/new");
    await screen.findByRole("button", { name: "Save draft" });
    fill("Listing title", "Riverside Driveway");
    fill("Hourly price (₹)", "45.50");
    fill("Number of spaces", "2");
    fireEvent.click(screen.getByLabelText("SUV"));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(window.location.pathname).toBe(`/app/owner/spaces/${ID}`));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({ name: "Riverside Driveway", hourlyPriceMinor: 4550, capacity: 2, vehicleTypes: ["car", "suv"] });
  });

  it("shows the server's field errors on the right fields", async () => {
    mockApi({
      "GET /api/v1/auth/me": me(owner),
      "POST /api/v1/parking-spaces": {
        status: 400,
        body: { error: { code: "validation_failed", message: "Request validation failed", details: [{ path: "hourlyPriceMinor", message: "Price is too high" }] } },
      },
    });
    open("/app/owner/spaces/new");
    await screen.findByRole("button", { name: "Save draft" });
    fill("Listing title", "Expensive");
    fill("Hourly price (₹)", "99999");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Price is too high")).toBeTruthy();
    expect(screen.getByLabelText("Hourly price (₹)").getAttribute("aria-invalid")).toBe("true");
  });
});

describe("listing list", () => {
  const summary = { id: ID, name: "Owner Lot", parkingType: "garage", address: { line: null, locality: "Altinho", city: "Panaji", region: "Goa" }, hourlyPrice: { amountMinor: 4000, currency: "INR" }, capacity: 2, status: "draft", verified: false, coverPhotoUrl: null, updatedAt: "2026-10-01T00:00:00.000Z" };
  const page = (n: number) => ({ status: 200, body: { data: [{ ...summary, id: `${ID.slice(0, -1)}${n}`, name: `Lot ${n}` }], page: { page: n, pageSize: 10, total: 11, totalPages: 2 } } });

  it("drives search, status filter and pagination through the URL and API", async () => {
    const calls = mockApi({
      "GET /api/v1/auth/me": me(owner),
      "GET /api/v1/me/parking-spaces?page=1&pageSize=10": page(1),
      "GET /api/v1/me/parking-spaces?page=2&pageSize=10": page(2),
      "GET /api/v1/me/parking-spaces?page=1&pageSize=10&status=draft": page(1),
      "GET /api/v1/me/parking-spaces?page=1&pageSize=10&status=draft&q=alt": page(1),
    });
    open("/app/owner/spaces");
    expect(await screen.findByText("Page 1 of 2 · 11 listings")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("link", { name: "Lot 2" })).toBeTruthy();
    expect(window.location.search).toBe("?page=2");

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "draft" } });
    await waitFor(() => expect(window.location.search).toBe("?status=draft"));
    fill("Search", "alt");
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(calls.map((c) => c.url)).toContain("/api/v1/me/parking-spaces?page=1&pageSize=10&status=draft&q=alt"));
  });
});

describe("listing lifecycle", () => {
  it("confirms before submitting, and lists what's missing when the API refuses", async () => {
    const calls = mockApi({
      "GET /api/v1/auth/me": me(owner),
      [`GET /api/v1/me/parking-spaces/${ID}`]: { status: 200, body: { data: listing({ status: "draft", verified: false }) } },
      [`GET /api/v1/parking-spaces/${ID}/bookings`]: { status: 200, body: { data: [] } },
      [`POST /api/v1/parking-spaces/${ID}/actions`]: {
        status: 422,
        body: { error: { code: "incomplete_listing", message: "Complete the listing before submitting it", details: [{ path: "hours", message: "Set opening hours" }] } },
      },
    });
    open(`/app/owner/spaces/${ID}`);
    fireEvent.click(await screen.findByRole("button", { name: "Submit for review" }));
    const dialog = screen.getAllByRole("dialog", { hidden: true }).find((d) => d.hasAttribute("open"))!;
    expect(within(dialog).getByText("Submit for review?")).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit", hidden: true }));
    expect(await screen.findByText("Set opening hours")).toBeTruthy();
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ action: "submit" });
  });

  it("warns that a location change sends a verified listing back to review", async () => {
    const calls = mockApi({
      "GET /api/v1/auth/me": me(owner),
      [`GET /api/v1/me/parking-spaces/${ID}`]: { status: 200, body: { data: listing() } },
      [`GET /api/v1/parking-spaces/${ID}/bookings`]: { status: 200, body: { data: [] } },
      [`PATCH /api/v1/parking-spaces/${ID}`]: { status: 200, body: { data: listing({ status: "pending_verification", verified: false }) } },
    });
    open(`/app/owner/spaces/${ID}`);
    await screen.findByRole("button", { name: "Save changes" });
    fill("City", "Margao");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByText("Send this listing back to review?")).toBeTruthy();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save and re-submit", hidden: true }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toMatchObject({ city: "Margao" }));
  });

  it("previews exactly the public view, labelled as not live yet", async () => {
    const pub: PublicListing = {
      id: ID,
      name: "Owner Lot",
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
    };
    mockApi({
      "GET /api/v1/auth/me": me(owner),
      [`GET /api/v1/me/parking-spaces/${ID}`]: { status: 200, body: { data: listing({ status: "draft", publiclyVisible: false, entryInstructions: "Gate code 1234" }) } },
      [`GET /api/v1/parking-spaces/${ID}/bookings`]: { status: 200, body: { data: [] } },
      [`GET /api/v1/parking-spaces/${ID}/preview`]: { status: 200, body: { data: pub } },
    });
    open(`/app/owner/spaces/${ID}`);
    fireEvent.click(await screen.findByRole("tab", { name: "Preview" }));
    const preview = await screen.findByRole("article", { name: "Owner Lot listing" });
    expect(within(preview).getByText("Altinho, Panaji, Goa")).toBeTruthy();
    expect(preview.textContent).not.toContain("1 Test Road");
    expect(preview.textContent).not.toContain("Gate code");
    expect(screen.getByText(/Preview only/)).toBeTruthy();
  });

  it("rejects unsupported photos before uploading", async () => {
    const calls = mockApi({
      "GET /api/v1/auth/me": me(owner),
      [`GET /api/v1/me/parking-spaces/${ID}`]: { status: 200, body: { data: listing({ status: "draft" }) } },
      [`GET /api/v1/parking-spaces/${ID}/bookings`]: { status: 200, body: { data: [] } },
    });
    open(`/app/owner/spaces/${ID}`);
    fireEvent.click(await screen.findByRole("tab", { name: /Photos/ }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(["GIF89a"], "map.gif", { type: "image/gif" })] } });
    expect(await screen.findByText("map.gif: Use a JPEG or PNG image")).toBeTruthy();
    expect(calls.some((c) => c.url.endsWith("/photos"))).toBe(false);
  });
});

describe("staff review", () => {
  it("is refused to non-staff without requesting the queue", async () => {
    const calls = mockApi({ "GET /api/v1/auth/me": me(owner) });
    open("/app/staff/listings");
    expect(await screen.findByText("This area is for SpotSure staff.")).toBeTruthy();
    expect(calls.some((c) => c.url.includes("/admin/"))).toBe(false);
  });

  it("lets staff approve a submission", async () => {
    const staff: User = { ...owner, id: "99999999-9999-4999-8999-999999999990", role: "driver", isPlatformAdmin: true };
    const calls = mockApi({
      "GET /api/v1/auth/me": me(staff),
      "GET /api/v1/admin/parking-spaces": {
        status: 200,
        body: { data: [{ id: ID, name: "Owner Lot", parkingType: "garage", address: { line: "1 Test Road", locality: "Altinho", city: "Panaji", region: "Goa", postalCode: "403001" }, photoCount: 2, submittedAt: "2026-10-01T00:00:00.000Z" }] },
      },
      [`POST /api/v1/admin/parking-spaces/${ID}/review`]: { status: 200, body: { data: { id: ID, status: "published" } } },
    });
    open("/app/staff/listings");
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toEqual({ decision: "approve" }));
  });
});

