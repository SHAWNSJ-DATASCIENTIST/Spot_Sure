import { useCallback, useRef } from "react";
import { useScrollProgress } from "../hooks/useScrollProgress";
import "./Marquee.css";

const WORDS = ["Bay sensors", "YOLO vision", "Occupancy fusion", "Trust graph", "Book & enter", "Audit proofs"];

function Row({ outline }: { outline?: boolean }) {
  // Content is doubled so the -50% loop is seamless.
  const items = [...WORDS, ...WORDS];
  return (
    <div className={`marquee__row ${outline ? "marquee__row--outline" : ""}`}>
      <div className="marquee__track">
        {items.map((w, i) => (
          <span key={i} className="marquee__item">
            {w}
            <span className="marquee__dot" />
          </span>
        ))}
      </div>
    </div>
  );
}

/** Two counter-running bands of the platform layers; they lean with scroll. */
export function Marquee({ animate }: { animate: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const onFrame = useCallback((p: number) => {
    ref.current?.style.setProperty("--shift", (p - 0.5).toFixed(4));
  }, []);
  useScrollProgress(ref, onFrame, animate, "through");

  return (
    <section ref={ref} className="marquee" aria-label="SpotSure layers">
      <p className="sr-only">{WORDS.join(", ")}</p>
      <div aria-hidden="true">
        <Row />
        <Row outline />
      </div>
    </section>
  );
}
