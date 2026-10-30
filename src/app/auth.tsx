import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, SESSION_ENDED_EVENT, type User } from "./api";

type AuthState =
  | { status: "loading"; user: null }
  | { status: "signed-out"; user: null; reason?: "expired" }
  | { status: "signed-in"; user: User };

interface AuthApi {
  state: AuthState;
  signIn(email: string, password: string): Promise<User>;
  register(input: {
    fullName: string;
    email: string;
    password: string;
    passwordConfirmation: string;
    role: User["role"];
  }): Promise<User>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

// Holds only the public profile returned by the server. Whether the user is
// signed in is always decided by the server from the HttpOnly session cookie.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });

  const refresh = useCallback(async () => {
    try {
      const { data } = await api<{ data: User }>("/auth/me");
      setState({ status: "signed-in", user: data });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setState({ status: "signed-out", user: null });
      else setState((s) => (s.status === "loading" ? { status: "signed-out", user: null } : s));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The server can end a session at any time (expiry, logout elsewhere,
  // suspension); any protected request answering 401 drops local state.
  useEffect(() => {
    const ended = () =>
      setState((s) => (s.status === "signed-in" ? { status: "signed-out", user: null, reason: "expired" } : s));
    window.addEventListener(SESSION_ENDED_EVENT, ended);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, ended);
  }, []);

  const value = useMemo<AuthApi>(
    () => ({
      state,
      refresh,
      async signIn(email, password) {
        const { data } = await api<{ data: User }>("/auth/login", { method: "POST", body: { email, password } });
        setState({ status: "signed-in", user: data });
        return data;
      },
      async register(input) {
        const { data } = await api<{ data: User }>("/auth/register", { method: "POST", body: input });
        setState({ status: "signed-in", user: data });
        return data;
      },
      async signOut() {
        await api("/auth/logout", { method: "POST" });
        setState({ status: "signed-out", user: null });
      },
    }),
    [state, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
