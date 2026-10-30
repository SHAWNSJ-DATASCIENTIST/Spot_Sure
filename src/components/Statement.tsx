import { useCallback, useRef, type CSSProperties } from "react";
import { bayStates } from "../data/content";
import { useScrollProgress } from "../hooks/useScrollProgress";
import { clamp, segment } from "../lib/motion";
import { ParkingAerial } from "./ParkingAerial";
import "./Statement.css";

const PLAIN = "A bay is only marked free when the sensor and the camera".split(" ");
const ACCENT = "both agree.".split(" ");
const WORD_COUNT = PLAIN.length + ACCENT.length;

export function Statement({ animate }: { animate: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);

  const onFrame = useCallback((p: number) => {
    const el = sectionRef.current;
    if (!el) return;
    el.style.setProperty("--drift", clamp(p).toFixed(4));
    // words light up one by one while the statement crosses the viewport
    el.style.setProperty("--read", segment(p, 0.12, 0.52).toFixed(4));
  }, []);
  useScrollProgress(sectionRef, onFrame, animate, "through");

  const word = (w: string, i: number) => (
    <span key={i} className="statement__word" style={{ "--w": i } as CSSProperties}>
      {w}{" "}
    </span>
  );

  return (
    <section
      ref={sectionRef}
      id="how"
      className={`statement section ${animate ? "statement--live" : ""}`}
      style={{ "--n": WORD_COUNT } as CSSProperties}
    >
      <div className="statement__orb" aria-hidden="true">
        <ParkingAerial />
      </div>

      <div className="wrap statement__inner">
        <p className="label reveal">
          <span className="label__num">01</span> — How it decides
        </p>

        <p className="statement__text display">
          {PLAIN.map(word)}
          <span className="accent">{ACCENT.map((w, i) => word(w, PLAIN.length + i))}</span>
        </p>

        <span className="statement__index display reveal" aria-hidden="true">
          01
        </span>

        <ul className="statement__states" aria-label="Bay states">
          {bayStates.map((s, i) => (
            <li key={s.name} className={`statement__state reveal state--${s.name.toLowerCase()}`} style={{ "--i": i } as CSSProperties}>
              <span className="statement__state-name">
                <span className="statement__dot" aria-hidden="true" />
                {s.name}
              </span>
              <span className="statement__state-rule">{s.rule}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
