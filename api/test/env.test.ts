import { describe, expect, it } from "vitest";
import { EnvValidationError, loadEnv, sessionCookieSecure } from "../src/config/env.js";

describe("loadEnv", () => {
  it("applies defaults for optional settings", () => {
    const env = loadEnv({ DATABASE_URL: "postgres://u:p@localhost:5433/db" });
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:5173"]);
    expect(env.YOLO_SERVICE_URL).toBeUndefined();
  });

  it("requires DATABASE_URL", () => {
    expect(() => loadEnv({})).toThrow(EnvValidationError);
  });

  it("rejects non-postgres database URLs", () => {
    expect(() => loadEnv({ DATABASE_URL: "mysql://u:p@localhost/db" })).toThrow(/DATABASE_URL/);
  });

  it("rejects out-of-range ports and bad CORS origins", () => {
    expect(() => loadEnv({ DATABASE_URL: "postgres://localhost/db", PORT: "70000" })).toThrow(/PORT/);
    expect(() => loadEnv({ DATABASE_URL: "postgres://localhost/db", CORS_ORIGINS: "not a url" })).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it("parses a comma-separated CORS list and treats blank integration vars as unset", () => {
    const env = loadEnv({
      DATABASE_URL: "postgres://localhost/db",
      CORS_ORIGINS: "http://localhost:5173, https://spotsure.example",
      YOLO_SERVICE_URL: "",
      TIGERGRAPH_SECRET: "  ",
      WEB3_CHAIN_ID: "",
    });
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:5173", "https://spotsure.example"]);
    expect(env.YOLO_SERVICE_URL).toBeUndefined();
    expect(env.TIGERGRAPH_SECRET).toBeUndefined();
    expect(env.WEB3_CHAIN_ID).toBeUndefined();
    expect(loadEnv({ DATABASE_URL: "postgres://localhost/db", WEB3_CHAIN_ID: "137" }).WEB3_CHAIN_ID).toBe(137);
  });

  it("keeps session cookies Secure in production", () => {
    const base = { DATABASE_URL: "postgres://localhost/db", NODE_ENV: "production", CORS_ORIGINS: "https://spotsure.example" };
    expect(() => loadEnv({ ...base, SESSION_COOKIE_SECURE: "false" })).toThrow(/SESSION_COOKIE_SECURE/);
    expect(sessionCookieSecure(loadEnv(base))).toBe(true);
    expect(sessionCookieSecure(loadEnv({ DATABASE_URL: "postgres://localhost/db" }))).toBe(false);
  });

  it("refuses localhost or plain-http origins in production (they are the CSRF allow-list)", () => {
    const prod = { DATABASE_URL: "postgres://localhost/db", NODE_ENV: "production" };
    expect(() => loadEnv(prod)).toThrow(/CORS_ORIGINS/); // the localhost default
    expect(() => loadEnv({ ...prod, CORS_ORIGINS: "http://spotsure.example" })).toThrow(/CORS_ORIGINS/);
    expect(() => loadEnv({ ...prod, CORS_ORIGINS: "https://spotsure.example,http://localhost:5173" })).toThrow(/CORS_ORIGINS/);
    expect(loadEnv({ ...prod, CORS_ORIGINS: "https://spotsure.example" }).CORS_ORIGINS).toEqual(["https://spotsure.example"]);
  });

  it("never includes secret values in the error message", () => {
    try {
      loadEnv({ DATABASE_URL: "postgres://localhost/db", TIGERGRAPH_HOST: "super-secret-value" });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain("TIGERGRAPH_HOST");
      expect((err as Error).message).not.toContain("super-secret-value");
    }
  });
});
