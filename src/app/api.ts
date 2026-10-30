// Thin client for the SpotSure API. The session lives in an HttpOnly cookie
// that JavaScript cannot read; requests are same-origin (Vite proxies /api in
// development), so the browser attaches it automatically.

export interface FieldIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: FieldIssue[] = [],
  ) {
    super(message);
  }
}

/** Fired when a signed-in request comes back 401: the server ended the session. */
export const SESSION_ENDED_EVENT = "spotsure:session-ended";

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; file?: File } = {},
): Promise<T> {
  let res: Response;
  try {
    // A file is sent as raw bytes with its own type (photo uploads); everything else is JSON.
    const headers = init.file
      ? { "content-type": init.file.type }
      : init.body !== undefined
        ? { "content-type": "application/json" }
        : undefined;
    res = await fetch(`/api/v1${path}`, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers,
      body: init.file ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    });
  } catch {
    throw new ApiError(0, "network_error", "Can't reach SpotSure right now. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error;
    if (res.status === 401 && e?.code === "unauthenticated" && !path.startsWith("/auth/")) {
      window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
    }
    throw new ApiError(res.status, e?.code ?? "unknown_error", e?.message ?? "Something went wrong. Please try again.", e?.details ?? []);
  }
  return json as T;
}

export interface User {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: "driver" | "parking_owner";
  status: string;
  emailVerified: boolean;
  isPlatformAdmin: boolean;
  administeredSocietyIds: string[];
  createdAt: string;
}
