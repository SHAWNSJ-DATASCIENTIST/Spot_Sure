/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin API in development, so the session cookie is first-party.
    proxy: { "/api": { target: "http://127.0.0.1:4000" } },
  },
  // The API in ./api has its own Vitest setup; keep the suites separate.
  test: { include: ["src/**/*.test.{ts,tsx}"] },
});
