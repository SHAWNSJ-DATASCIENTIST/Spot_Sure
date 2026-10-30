import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

// Argon2id with the OWASP-recommended baseline (19 MiB, 2 passes, 1 lane).
const ARGON2ID = 2; // @node-rs/argon2 Algorithm.Argon2id (const enum, not importable under isolatedModules)
const params = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

// A short deny-list of the most common passwords that satisfy the length rule.
// Keep in sync with src/auth/validation.ts in the frontend.
const COMMON = new Set([
  "1234567890",
  "12345678910",
  "123456789012",
  "0123456789",
  "qwertyuiop",
  "password12",
  "password123",
  "password1234",
  "iloveyou12",
  "1q2w3e4r5t",
  "qwerty1234",
  "qwerty12345",
  "abcdefghij",
  "spotsure123",
  "letmein123",
  "welcome123",
  "admin12345",
]);

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Password must be at most ${PASSWORD_MAX} characters`)
  .refine((p) => !COMMON.has(p.toLowerCase()), "This password is too common")
  .refine((p) => new Set(p).size >= 4, "Password needs more variety of characters");

export function hashPassword(password: string): Promise<string> {
  return hash(password, params);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Verified against when no account matches, so a login attempt for an unknown
// email costs the same time as one for a real account.
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hash("spotsure-timing-equaliser", params);
  await verifyPassword(await dummyHash, password);
}
