import { describe, expect, it } from "vitest";
import { canTransition, quoteTotalMinor } from "../src/domain/booking.js";

describe("booking status transitions", () => {
  it("allows the forward lifecycle", () => {
    expect(canTransition("pending", "confirmed")).toBe(true);
    expect(canTransition("confirmed", "active")).toBe(true);
    expect(canTransition("active", "completed")).toBe(true);
  });

  it("blocks skipping steps and leaving terminal states", () => {
    expect(canTransition("pending", "active")).toBe(false);
    expect(canTransition("active", "cancelled")).toBe(false);
    expect(canTransition("completed", "active")).toBe(false);
    expect(canTransition("cancelled", "confirmed")).toBe(false);
  });
});

describe("quoteTotalMinor", () => {
  const t0 = new Date("2026-10-01T10:00:00Z");
  it("bills per started hour", () => {
    expect(quoteTotalMinor(5000, t0, new Date("2026-10-01T11:00:00Z"))).toBe(5000);
    expect(quoteTotalMinor(5000, t0, new Date("2026-10-01T11:01:00Z"))).toBe(10000);
  });
  it("rejects empty or inverted ranges", () => {
    expect(() => quoteTotalMinor(5000, t0, t0)).toThrow(RangeError);
  });
});
