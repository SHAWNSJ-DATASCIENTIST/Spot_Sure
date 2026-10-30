import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { Capability } from "../data/content";
import { shouldThrow } from "../lib/motion";
import { CardArt } from "./CardArt";
import "./CardDeck.css";

const THROW_MS = 460;
const VISIBLE = 4;

interface Drag {
  id: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
}

/** Run after the browser has painted the current styles. The timeout covers
 *  background tabs, where rAF is paused and the deck would otherwise lock. */
const nextFrame = (fn: () => void) => {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  requestAnimationFrame(() => requestAnimationFrame(run));
  window.setTimeout(run, 80);
};

/**
 * A physical stack of capability sleeves. Drag the top card past ~10% of the
 * deck width to throw it; arrow keys and the step buttons do the same, so the
 * deck never needs a mouse.
 */
export function CardDeck({ cards, reducedMotion }: { cards: Capability[]; reducedMotion: boolean }) {
  const [order, setOrder] = useState(() => cards.map((_, i) => i));
  const deckRef = useRef<HTMLDivElement>(null);
  const cardEls = useRef<(HTMLElement | null)[]>([]);
  const drag = useRef<Drag | null>(null);
  const busy = useRef(false);
  const [dragging, setDragging] = useState(false);

  const top = order[0];
  const width = () => deckRef.current?.offsetWidth ?? 400;

  const finish = (fn: () => void, ms: number) => {
    if (reducedMotion) return fn();
    window.setTimeout(fn, ms);
  };

  /** Throw the top card out in `dir` (1 = right, -1 = left) and re-stack. */
  const throwTop = (dir: 1 | -1, dy = 0) => {
    const el = cardEls.current[top];
    if (!el || busy.current) return;
    busy.current = true;
    const w = width();
    el.style.transition = reducedMotion ? "none" : `transform ${THROW_MS}ms var(--ease-out), opacity ${THROW_MS}ms linear`;
    el.style.transform = `translate(${dir * w * 1.15}px, ${dy - 70}px) rotate(${dir * 26}deg) scale(1.02)`;
    el.style.opacity = "0";
    finish(() => {
      el.style.transition = "none";
      el.style.transform = "";
      setOrder((o) => [...o.slice(1), o[0]]);
      nextFrame(() => {
        el.style.transition = "";
        el.style.opacity = "";
        busy.current = false;
      });
    }, THROW_MS);
  };

  /** Bring the last-thrown card back from the left onto the top. */
  const recall = () => {
    if (busy.current) return;
    const last = order[order.length - 1];
    const el = cardEls.current[last];
    if (!el) return;
    busy.current = true;
    const w = width();
    el.style.transition = "none";
    el.style.transform = `translate(${-w * 1.15}px, -70px) rotate(-26deg)`;
    el.style.opacity = "0";
    setOrder((o) => [o[o.length - 1], ...o.slice(0, -1)]);
    nextFrame(() => {
      el.style.transition = reducedMotion ? "none" : "";
      el.style.transform = "";
      el.style.opacity = "";
      finish(() => {
        el.style.transition = "";
        busy.current = false;
      }, THROW_MS);
    });
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (busy.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // pointer already released; the drag still works without capture
    }
    e.currentTarget.style.transition = "none";
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 };
    setDragging(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    d.dx = e.clientX - d.x0;
    d.dy = e.clientY - d.y0;
    e.currentTarget.style.transform = `translate(${d.dx}px, ${d.dy * 0.6}px) rotate(${d.dx * 0.05}deg) scale(1.02)`;
  };

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    const el = e.currentTarget;
    if (shouldThrow(d.dx, width())) {
      throwTop(d.dx > 0 ? 1 : -1, d.dy * 0.6);
    } else {
      el.style.transition = "";
      el.style.transform = "";
    }
  };

  /** A cancelled gesture (scroll takeover, lost capture) never throws. */
  const onPointerCancel = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    e.currentTarget.style.transition = "";
    e.currentTarget.style.transform = "";
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (drag.current) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      throwTop(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      recall();
    }
  };

  const current = cards[top];

  return (
    <div className="deck-wrap">
      <div
        ref={deckRef}
        className={`deck ${dragging ? "deck--dragging" : ""}`}
        tabIndex={0}
        role="group"
        aria-roledescription="card deck"
        aria-label="SpotSure capabilities. Use left and right arrow keys to flip through."
        onKeyDown={onKeyDown}
      >
        {cards.map((card, i) => {
          const pos = order.indexOf(i);
          const isTop = pos === 0;
          return (
            <article
              key={card.code}
              ref={(el) => (cardEls.current[i] = el)}
              className={`sleeve ${isTop ? "sleeve--top" : ""} ${pos >= VISIBLE ? "sleeve--hidden" : ""}`}
              style={{ "--pos": Math.min(pos, VISIBLE - 1), zIndex: cards.length - pos } as CSSProperties}
              aria-hidden={!isTop}
              onPointerDown={isTop ? onPointerDown : undefined}
              onPointerMove={isTop ? onPointerMove : undefined}
              onPointerUp={isTop ? onPointerUp : undefined}
              onPointerCancel={isTop ? onPointerCancel : undefined}
              onLostPointerCapture={isTop ? onPointerCancel : undefined}
            >
              <div className="sleeve__art">
                <CardArt kind={card.art} />
              </div>
              <header className="sleeve__head">
                <span className={`sleeve__status sleeve__status--${card.status === "Planned" ? "planned" : "dev"}`}>
                  <span className="sleeve__status-dot" aria-hidden="true" />
                  {card.status}
                </span>
                <span className="sleeve__code">{card.code}</span>
              </header>
              <footer className="sleeve__foot">
                <h3 className="sleeve__title">{card.title}</h3>
                <p className="sleeve__meta">
                  {card.layer} · {card.stack}
                </p>
              </footer>
            </article>
          );
        })}
      </div>

      <p className="deck__summary" aria-live="polite">
        <span className="sr-only">
          Card {top + 1} of {cards.length}:{" "}
        </span>
        {current.summary}
      </p>

      <div className="deck__controls">
        <button type="button" className="deck__step" onClick={recall} aria-label="Previous card">
          ←
        </button>
        <p className="deck__hint">Drag a sleeve aside, or use ← →</p>
        <ol className="deck__dots" aria-hidden="true">
          {cards.map((c, i) => (
            <li key={c.code} className={i === top ? "is-active" : ""} />
          ))}
        </ol>
        <button type="button" className="deck__step" onClick={() => throwTop(1)} aria-label="Next card">
          →
        </button>
      </div>
    </div>
  );
}
