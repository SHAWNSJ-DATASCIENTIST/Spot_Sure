import { describe, expect, it } from "vitest";
import { compactDigits, normaliseSearch, parseMoneyToMinor } from "./format";

// Text arrives typed, pasted or dictated (e.g. Wispr Flow types wherever the
// cursor is). These parsers accept the common spoken forms and nothing vaguer.

describe("parseMoneyToMinor", () => {
  it("accepts plain, symbol, word and grouped rupee amounts", () => {
    expect(parseMoneyToMinor("40")).toBe(4000);
    expect(parseMoneyToMinor("40.5")).toBe(4050);
    expect(parseMoneyToMinor("₹40")).toBe(4000);
    expect(parseMoneyToMinor("Rs. 40")).toBe(4000);
    expect(parseMoneyToMinor("40 rupees")).toBe(4000);
    expect(parseMoneyToMinor("INR 1,200")).toBe(120000);
    expect(parseMoneyToMinor("40.")).toBe(4000);
    expect(parseMoneyToMinor("  60 Rs ")).toBe(6000);
  });
  it("rejects anything ambiguous", () => {
    for (const bad of ["", "forty", "40.555", "-5", "40 dollars", "4,0", "1,20,0", "₹", "12345678"]) {
      expect(parseMoneyToMinor(bad), bad).toBeNaN();
    }
  });
});

describe("compactDigits", () => {
  it("joins digits read out with spaces or dashes", () => {
    expect(compactDigits("403 001")).toBe("403001");
    expect(compactDigits("403-001.")).toBe("403001");
    expect(compactDigits(" 403001 ")).toBe("403001");
  });
  it("leaves non-numeric text alone for validation to reject", () => {
    expect(compactDigits("40300A")).toBe("40300A");
  });
});

describe("normaliseSearch", () => {
  it("drops trailing sentence punctuation and extra spaces", () => {
    expect(normaliseSearch("Panaji.")).toBe("Panaji");
    expect(normaliseSearch("  covered   parking in  Altinho! ")).toBe("covered parking in Altinho");
    expect(normaliseSearch("St. Inez")).toBe("St. Inez");
    expect(normaliseSearch("...")).toBe("");
  });
});
