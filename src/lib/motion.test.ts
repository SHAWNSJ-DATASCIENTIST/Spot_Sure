import { describe, expect, it } from "vitest";
import { portalFrame, segment, shouldThrow } from "./motion";

describe("portalFrame", () => {
  it("starts closed and overscaled", () => {
    const f = portalFrame(0);
    expect(f.open).toBe(0);
    expect(f.title).toBe(0);
    expect(f.imageScale).toBeCloseTo(1.16);
    expect(f.wash).toBe(0);
  });

  it("ends fully open and settled", () => {
    const f = portalFrame(1);
    expect(f.open).toBe(1);
    expect(f.title).toBe(1);
    expect(f.imageScale).toBeCloseTo(1);
    expect(f.wash).toBeCloseTo(0.32);
  });

  it("is a pure function of position, so it reverses exactly", () => {
    expect(portalFrame(0.4)).toEqual(portalFrame(0.4));
    expect(portalFrame(0.3).open).toBeLessThan(portalFrame(0.5).open);
  });

  it("clamps out-of-range progress", () => {
    expect(portalFrame(-2)).toEqual(portalFrame(0));
    expect(portalFrame(3)).toEqual(portalFrame(1));
  });
});

describe("helpers", () => {
  it("segment maps and clamps", () => {
    expect(segment(5, 0, 10)).toBe(0.5);
    expect(segment(-1, 0, 10)).toBe(0);
    expect(segment(11, 0, 10)).toBe(1);
  });

  it("throws past a tenth of the deck width in either direction", () => {
    expect(shouldThrow(41, 400)).toBe(true);
    expect(shouldThrow(-41, 400)).toBe(true);
    expect(shouldThrow(39, 400)).toBe(false);
  });
});
