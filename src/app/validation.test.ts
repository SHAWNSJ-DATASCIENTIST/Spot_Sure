import { describe, expect, it } from "vitest";
import { emailError, fullNameError, normaliseEmail, passwordError } from "./validation";
import { safeNext } from "./router";

describe("client validation", () => {
  it("normalises and checks email", () => {
    expect(normaliseEmail("  Asha@Example.COM ")).toBe("asha@example.com");
    expect(emailError("")).toBe("Enter your email address");
    expect(emailError("nope")).toBe("Enter a valid email address");
    expect(emailError("a@b.co")).toBeUndefined();
  });

  it("mirrors the server password policy", () => {
    expect(passwordError("short")).toMatch(/at least 10/);
    expect(passwordError("password123")).toMatch(/too common/);
    expect(passwordError("aaaaaaaaaaaa")).toMatch(/variety/);
    expect(passwordError("asha@example.com", "Asha@Example.com")).toMatch(/not be your email/);
    expect(passwordError("correct horse battery")).toBeUndefined();
  });

  it("requires a name", () => {
    expect(fullNameError(" a ")).toBeDefined();
    expect(fullNameError("Asha Rao")).toBeUndefined();
  });
});

describe("safeNext", () => {
  it("only allows same-site paths", () => {
    expect(safeNext("/app")).toBe("/app");
    expect(safeNext("//evil.example")).toBe("/app");
    expect(safeNext("/\\evil.example")).toBe("/app");
    expect(safeNext("/bookings?x=1")).toBe("/bookings?x=1");
    expect(safeNext("https://evil.example")).toBe("/app");
    expect(safeNext(null)).toBe("/app");
  });
});
