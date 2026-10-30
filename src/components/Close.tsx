import type { CSSProperties } from "react";
import { navLinks } from "../data/content";
import { Button } from "./Button";
import "./Close.css";

export function Close() {
  return (
    <footer className="close" id="contact">
      <div className="wrap">
        <div className="close__top">
          <div>
            <p className="label reveal">
              <span className="label__num">06</span> — Next
            </p>
            <h2 className="display close__title reveal reveal--wipe">
              Know it’s free <span className="accent">before</span> you drive there.
            </h2>
            <p className="fine close__fine reveal">
              SpotSure is in active development. Every reading, detection and booking shown on this page is
              illustrative.
            </p>
          </div>
          <div className="close__actions reveal">
            <Button href="#platform">Explore the platform</Button>
            <Button href="#top" variant="ghost">
              Back to the portal
            </Button>
          </div>
        </div>

        <div className="close__strip">
          <span>© {new Date().getFullYear()} SpotSure</span>
          <nav aria-label="Footer" className="close__links">
            {navLinks.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ))}
          </nav>
          <span>Pilot: verified listings · booking requests</span>
        </div>
      </div>

      <p className="close__mark reveal" aria-hidden="true">
        {[..."SpotSure"].map((ch, i) => (
          <span key={i} className="close__char" style={{ "--c": i } as CSSProperties}>
            {ch}
          </span>
        ))}
      </p>
    </footer>
  );
}
