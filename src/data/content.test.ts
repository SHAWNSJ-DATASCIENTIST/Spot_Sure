import { describe, expect, it } from "vitest";
import { capabilities, pipeline } from "./content";

// Landing-page honesty: nothing unbuilt may read as live.

describe("landing capability claims", () => {
  it("marks the trust graph as planned and not connected", () => {
    const trust = capabilities.find((c) => c.title === "Trust graph")!;
    expect(trust.status).toBe("Planned");
    expect(trust.stack).toMatch(/not connected/);
    expect(trust.summary).toMatch(/No trust or fraud signals exist yet/);
    expect(pipeline.find((p) => p.tag === "Trust")!.detail).toMatch(/planned/);
  });

  it("never claims payments, fraud detection or audit proofs are live", () => {
    const text = JSON.stringify(capabilities);
    expect(text).not.toMatch(/fraud detection/i);
    expect(capabilities.find((c) => c.title === "Audit proofs")!.status).toBe("Planned");
    expect(capabilities.find((c) => c.code === "SS-05")!.summary).toMatch(/Payments and QR entry\/exit are planned/);
  });
});
