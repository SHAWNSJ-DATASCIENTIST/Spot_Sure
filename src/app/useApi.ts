import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

export type Remote<T> =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; data: T };

/**
 * Loads `{ data }` from a GET endpoint through the shared API client (same
 * origin, session cookie). `path: null` skips the request entirely.
 */
export function useApi<T>(path: string | null): Remote<T> & { reload: () => void } {
  const [state, setState] = useState<Remote<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!path) return;
    let live = true;
    // A reload of the same path keeps showing current data until fresh data
    // arrives, so pages (and their success messages) don't unmount mid-save.
    const samePath = lastPath.current === path;
    lastPath.current = path;
    setState((s) => (samePath && s.status === "ready" ? s : { status: "loading" }));
    api<{ data: T }>(path)
      .then(({ data }) => live && setState({ status: "ready", data }))
      .catch((err) => {
        if (!live) return;
        setState({
          status: "error",
          error: err instanceof ApiError ? err : new ApiError(0, "unknown_error", "Something went wrong."),
        });
      });
    return () => {
      live = false;
    };
  }, [path, nonce]);

  return { ...state, reload };
}
