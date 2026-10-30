import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

// Minimal pathname router: the app has a handful of top-level pages, so a
// routing library would be more than it needs. Hash links on the landing page
// keep working because only pathname changes are routed.

const EVENT = "spotsure:navigate";

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new Event(EVENT));
  window.scrollTo(0, 0);
}

export function useLocation(): { pathname: string; search: URLSearchParams } {
  const read = () => ({ pathname: window.location.pathname, search: new URLSearchParams(window.location.search) });
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const update = () => setLoc(read());
    window.addEventListener("popstate", update);
    window.addEventListener(EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return loc;
}

/** Only same-site paths are allowed as post-login destinations (no open redirects). */
export function safeNext(next: string | null, fallback = "/app"): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...rest} />;
}
