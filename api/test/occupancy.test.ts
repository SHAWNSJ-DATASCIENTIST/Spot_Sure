import { describe, expect, it } from "vitest";
import { occupancyEventInputSchema } from "../src/domain/occupancy.js";

const spaceId = "6f1c3c1e-0f7a-4c55-9a51-2c2f0b6e8a11";
const deviceId = "0d5b2f8e-3a9e-4f6a-8d39-7b1e6c2a9f40";
const videoJobId = "a4e2c9b7-1d3f-4e8a-9c6b-5f2d8e1a7c30";

describe("occupancy event contract", () => {
  it("accepts a hardware observation tied to a device", () => {
    const r = occupancyEventInputSchema.parse({
      source: "hardware",
      deviceId,
      spaceId,
      observation: "occupied",
      observedAt: "2026-10-01T10:00:00Z",
    });
    expect(r.observedAt).toBeInstanceOf(Date);
    expect(r.provenance).toEqual({});
  });

  it("requires a device for hardware and a job for video", () => {
    const common = { spaceId, observation: "available", observedAt: "2026-10-01T10:00:00Z" };
    expect(occupancyEventInputSchema.safeParse({ ...common, source: "hardware" }).success).toBe(false);
    expect(occupancyEventInputSchema.safeParse({ ...common, source: "video" }).success).toBe(false);
    expect(occupancyEventInputSchema.safeParse({ ...common, source: "video", videoJobId, confidence: 0.82 }).success).toBe(
      true,
    );
  });

  it("rejects unknown sources and observations", () => {
    const base = { spaceId, deviceId, observedAt: "2026-10-01T10:00:00Z" };
    expect(occupancyEventInputSchema.safeParse({ ...base, source: "drone", observation: "occupied" }).success).toBe(false);
    // "booked" is a booking status, not a physical observation.
    expect(occupancyEventInputSchema.safeParse({ ...base, source: "hardware", observation: "booked" }).success).toBe(
      false,
    );
  });

  it("bounds confidence to 0..1 and disallows it for manual checks", () => {
    const base = { spaceId, videoJobId, source: "video", observation: "occupied", observedAt: "2026-10-01T10:00:00Z" };
    expect(occupancyEventInputSchema.safeParse({ ...base, confidence: 1.2 }).success).toBe(false);
    expect(occupancyEventInputSchema.safeParse({ ...base, confidence: -0.1 }).success).toBe(false);
    expect(
      occupancyEventInputSchema.safeParse({
        spaceId,
        source: "manual",
        observation: "occupied",
        observedAt: "2026-10-01T10:00:00Z",
        confidence: 0.9,
      }).success,
    ).toBe(false);
  });

  it("rejects observations from the future and non-UUID references", () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    expect(
      occupancyEventInputSchema.safeParse({ source: "hardware", deviceId, spaceId, observation: "occupied", observedAt: future })
        .success,
    ).toBe(false);
    expect(
      occupancyEventInputSchema.safeParse({
        source: "hardware",
        deviceId: "dev-1",
        spaceId,
        observation: "occupied",
        observedAt: "2026-10-01T10:00:00Z",
      }).success,
    ).toBe(false);
  });
});
