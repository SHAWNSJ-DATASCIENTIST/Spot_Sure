// Client-side checks mirror api/src/auth/password.ts and api/src/routes/auth.ts
// for fast feedback. The server re-validates everything; these are not a
// security control.

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

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

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailError(email: string): string | undefined {
  const e = email.trim();
  if (!e) return "Enter your email address";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) return "Enter a valid email address";
}

export function passwordError(password: string, email = ""): string | undefined {
  if (!password) return "Enter a password";
  if (password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters`;
  if (password.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters`;
  if (COMMON.has(password.toLowerCase())) return "This password is too common";
  if (new Set(password).size < 4) return "Password needs more variety of characters";
  if (email && password.toLowerCase() === normaliseEmail(email)) return "Password must not be your email";
}

export function fullNameError(name: string): string | undefined {
  const n = name.trim();
  if (n.length < 2) return "Enter your full name";
  if (n.length > 100) return "Name must be at most 100 characters";
}
