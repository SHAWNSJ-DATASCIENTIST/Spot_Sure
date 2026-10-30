import { useEffect, useRef, useState } from "react";
import { pipeline } from "../data/content";
import { CardArt } from "./CardArt";
import "./Pipeline.css";

export function Pipeline({ animate }: { animate: boolean }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);

  // The preview chases the pointer and leans into its horizontal velocity.
  useEffect(() => {
    const el = previewRef.current;
    if (!el || !animate || !window.matchMedia("(pointer: fine)").matches) return;
    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let raf = 0;
    const loop = () => {
      const vx = tx - x;
      x += vx * 0.14;
      y += (ty - y) * 0.14;
      const tilt = Math.max(-14, Math.min(14, vx * 0.08));
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${tilt}deg)`;
      raf = Math.abs(vx) + Math.abs(ty - y) > 0.1 ? requestAnimationFrame(loop) : 0;
    };
    const onMove = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      if (!raf) raf = requestAnimationFrame(loop);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [animate]);

  return (
    <section id="pipeline" className="section pipeline">
      <div className="wrap">
        <p className="label reveal">
          <span className="label__num">04</span> — Pipeline
        </p>
        <h2 className="display h2 reveal reveal--wipe">{pipeline.length} stages. One verdict per bay.</h2>
        <ol className="rows" onPointerLeave={() => setActive(null)}>
          {pipeline.map((row, i) => (
            <li key={row.name} className="rows__item reveal" onPointerEnter={() => setActive(i)}>
              <span className="rows__tag">
                <span className="rows__index">{String(i + 1).padStart(2, "0")}</span>
                {row.tag}
              </span>
              <span className="rows__name display">{row.name}</span>
              <span className="rows__detail">{row.detail}</span>
            </li>
          ))}
        </ol>
      </div>

      {animate && (
        <div ref={previewRef} className={`rows__preview ${active !== null ? "is-on" : ""}`} aria-hidden="true">
          {pipeline.map((row, i) => (
            <div key={row.name} className={`rows__preview-art ${i === active ? "is-current" : ""}`}>
              <CardArt kind={row.art} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
