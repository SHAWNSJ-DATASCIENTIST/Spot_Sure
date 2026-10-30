import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { User } from "../app/api";
import { useAuth } from "../app/auth";
import { Link, navigate } from "../app/router";
import { useUnreadCount } from "../app/notifications";
import { navFor, type RouteName } from "../app/routes";
import { Wordmark } from "../components/Wordmark";
import "./shell.css";

const ROLE_LABEL: Record<User["role"], string> = { driver: "Driver", parking_owner: "Parking owner" };

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?"
  );
}

function useSignOut() {
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function run() {
    setBusy(true);
    setError(undefined);
    try {
      await signOut();
      navigate("/sign-in?reason=signed-out", { replace: true });
    } catch {
      setError("Couldn't sign out. Check your connection and try again.");
      setBusy(false);
    }
  }
  return { run, busy, error };
}

function UserMenu({ user, signOut }: { user: User; signOut: ReturnType<typeof useSignOut> }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = [...(wrap.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
        next?.focus();
        e.preventDefault();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="user-menu__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="user-menu__avatar" aria-hidden="true">
          {initials(user.fullName)}
        </span>
        <span className="user-menu__name">{user.fullName}</span>
        <span className="sr-only">Account menu</span>
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label="Account" className="user-menu__list">
          <div className="user-menu__who" role="presentation">
            <span>{user.email}</span>
            <span className="user-menu__role">{ROLE_LABEL[user.role]}</span>
          </div>
          <Link href="/app/profile" role="menuitem" onClick={() => setOpen(false)}>
            Profile and settings
          </Link>
          <button type="button" role="menuitem" onClick={signOut.run} disabled={signOut.busy}>
            {signOut.busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}

function NotificationBell({ route }: { route: RouteName }) {
  // Refreshes on every navigation, then polls; null until the first answer.
  const count = useUnreadCount(route);
  const label = count ? `Notifications, ${count} unread` : "Notifications";
  return (
    <Link href="/app/notifications" className="bell" aria-label={label} aria-current={route === "notifications" ? "page" : undefined}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <path
          d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Zm4 4a2 2 0 0 0 4 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      {count ? (
        <span className="bell__count" aria-hidden="true">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}

export function AppShell({ user, route, children }: { user: User; route: RouteName; children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const signOut = useSignOut();
  const nav = navFor(user);
  const drawerButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);

  // Close the drawer on navigation and with Escape; return focus to its toggle.
  useEffect(() => setDrawer(false), [route]);
  useEffect(() => {
    if (!drawer) return;
    sidebar.current?.querySelector<HTMLElement>("a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawer(false);
        drawerButton.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);

  return (
    <div className={`shell ${drawer ? "shell--drawer" : ""}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="shell__top">
        <button
          ref={drawerButton}
          type="button"
          className="shell__menu"
          aria-expanded={drawer}
          aria-controls="app-sidebar"
          aria-label={drawer ? "Close navigation" : "Open navigation"}
          onClick={() => setDrawer((d) => !d)}
        >
          <span />
          <span />
        </button>
        <a href="/" className="shell__brand" aria-label="SpotSure home">
          <Wordmark />
        </a>
        <NotificationBell route={route} />
        <UserMenu user={user} signOut={signOut} />
      </header>

      <nav id="app-sidebar" ref={sidebar} className="shell__side" aria-label="Main">
        <ul>
          {nav.map((item) => (
            <li key={item.href}>
              <Link href={item.href} aria-current={item.routes.includes(route) ? "page" : undefined}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <ul className="shell__side-foot">
          <li>
            <Link href="/app/profile" aria-current={route === "profile" ? "page" : undefined}>
              Profile and settings
            </Link>
          </li>
        </ul>
      </nav>
      {drawer && <div className="shell__scrim" aria-hidden="true" onClick={() => setDrawer(false)} />}

      <main id="main" className="shell__main" tabIndex={-1}>
        {signOut.error && (
          <div className="form-alert" role="alert">
            {signOut.error}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
