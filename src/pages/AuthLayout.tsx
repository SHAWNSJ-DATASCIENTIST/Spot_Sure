import type { ReactNode } from "react";
import { Link } from "../app/router";
import { Wordmark } from "../components/Wordmark";
import "./auth.css";

export function AuthLayout({
  eyebrow,
  title,
  lede,
  children,
  footer,
}: {
  eyebrow: string;
  title: ReactNode;
  lede: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="auth">
      <header className="auth__bar">
        <a href="/" className="auth__brand" aria-label="SpotSure home">
          <Wordmark />
        </a>
      </header>
      <main id="main" className="auth__main">
        <div className="auth__intro">
          <span className="label">
            <span className="label__num">—</span> {eyebrow}
          </span>
          <h1 className="display auth__title">{title}</h1>
          <p className="lede">{lede}</p>
        </div>
        <div className="auth__panel">
          {children}
          <p className="auth__switch">{footer}</p>
        </div>
      </main>
    </div>
  );
}

export { Link };
