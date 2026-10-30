import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useAuth } from "../app/auth";
import { Link } from "../app/router";
import { navLinks } from "../data/content";
import { Button } from "./Button";
import { Wordmark } from "./Wordmark";
import "./Nav.css";

export function Nav() {
  const [open, setOpen] = useState(false);
  const { state } = useAuth();
  const account =
    state.status === "signed-in" ? { href: "/app", label: "Your account" } : { href: "/sign-in", label: "Sign in" };
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    sheetRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
        return;
      }
      // keep Tab inside the bar + sheet while the menu covers the page
      if (e.key !== "Tab") return;
      const items = [toggleRef.current, ...(sheetRef.current?.querySelectorAll<HTMLElement>("a, button") ?? [])].filter(
        Boolean,
      ) as HTMLElement[];
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const onResize = () => window.innerWidth > 860 && setOpen(false);
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header className={`nav ${open ? "nav--open" : ""}`}>
      <div className="nav__bar">
        <a href="#top" className="nav__brand" aria-label="SpotSure, back to top" onClick={close}>
          <Wordmark />
        </a>
        <nav aria-label="Primary" className="nav__links">
          {navLinks.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
          <Link href={account.href}>{account.label}</Link>
        </nav>
        <Button href="/app/discover" className="nav__cta">
          Find parking
        </Button>
        <button
          ref={toggleRef}
          type="button"
          className="nav__toggle"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          <span />
          <span />
        </button>
      </div>
      <div ref={sheetRef} id="mobile-menu" className="nav__sheet" hidden={!open}>
        <nav aria-label="Mobile">
          {navLinks.map((l, i) => (
            <a key={l.href} href={l.href} onClick={close} style={{ "--i": i } as CSSProperties}>
              <span className="nav__sheet-num">0{i + 1}</span>
              {l.label}
            </a>
          ))}
          <Link href={account.href} onClick={close} style={{ "--i": navLinks.length } as CSSProperties}>
            <span className="nav__sheet-num">0{navLinks.length + 1}</span>
            {account.label}
          </Link>
        </nav>
        <Button href="/app/discover" onClick={close}>
          Find parking
        </Button>
      </div>
    </header>
  );
}
