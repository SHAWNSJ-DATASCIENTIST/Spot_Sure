import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import { useScrollProgress } from "../hooks/useScrollProgress";
import { portalFrame } from "../lib/motion";
import { ParkingAerial } from "./ParkingAerial";
import "./PortalHero.css";

/** Letters as spans so the intro can stagger them; the word stays one label. */
function Letters({ word, offset }: { word: string; offset: number }) {
  return (
    <>
      {[...word].map((ch, i) => (
        <span key={i} className="portal__char" style={{ "--c": offset + i } as CSSProperties} aria-hidden="true">
          {ch}
        </span>
      ))}
    </>
  );
}

/**
 * Portal hero: two panels part to uncover a full-bleed night render while the
 * wordmark grows, tightens and splits. Every value is written as a CSS custom
 * property from scroll position, so the portal closes again on scroll-up.
 */
export function PortalHero({ animate }: { animate: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const onFrame = useCallback((progress: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const f = portalFrame(progress);
    stage.style.setProperty("--open", f.open.toFixed(4));
    stage.style.setProperty("--title", f.title.toFixed(4));
    stage.style.setProperty("--img", f.imageScale.toFixed(4));
    stage.style.setProperty("--wash", f.wash.toFixed(4));
    stage.style.setProperty("--dots", f.dots.toFixed(4));
    stage.style.setProperty("--meta", f.meta.toFixed(4));
  }, []);

  useScrollProgress(sectionRef, onFrame, animate);

  // Pointer parallax on the render: eased toward the pointer, fine pointers only.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !animate || !window.matchMedia("(pointer: fine)").matches) return;
    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let raf = 0;
    const tick = () => {
      x += (tx - x) * 0.08;
      y += (ty - y) * 0.08;
      stage.style.setProperty("--mx", x.toFixed(4));
      stage.style.setProperty("--my", y.toFixed(4));
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.001 ? requestAnimationFrame(tick) : 0;
    };
    const onMove = (e: PointerEvent) => {
      tx = e.clientX / window.innerWidth - 0.5;
      ty = e.clientY / window.innerHeight - 0.5;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [animate]);

  return (
    <section ref={sectionRef} id="top" className={`portal ${animate ? "portal--live" : ""}`} aria-label="SpotSure">
      <div ref={stageRef} className="portal__stage">
        <div className="portal__image">
          <ParkingAerial animated={animate} />
        </div>
        <div className="portal__wash" aria-hidden="true" />
        <div className="portal__veil" aria-hidden="true" />

        <div className="portal__panel portal__panel--l" aria-hidden="true" />
        <div className="portal__panel portal__panel--r" aria-hidden="true" />
        <span className="portal__seam" aria-hidden="true" />

        <span className="portal__dot portal__dot--a" aria-hidden="true" />
        <span className="portal__dot portal__dot--b" aria-hidden="true" />

        <h1 className="portal__title" aria-label="SpotSure">
          <span className="portal__half portal__half--l">
            <Letters word="Spot" offset={0} />
          </span>
          <span className="portal__half portal__half--r">
            <Letters word="Sure" offset={4} />
          </span>
        </h1>

        <div className="portal__meta portal__meta--top">
          <p>Smart parking intelligence</p>
          <p className="portal__meta-r">Hardware · Vision · Trust</p>
        </div>
        <div className="portal__meta portal__meta--bottom">
          <p className="portal__scroll">
            <span className="portal__scroll-line" aria-hidden="true" />
            Scroll to open
          </p>
          <p className="portal__meta-r">Illustrative render — not a live feed</p>
        </div>
      </div>
    </section>
  );
}
