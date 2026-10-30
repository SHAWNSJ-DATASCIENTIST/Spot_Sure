import { useEffect, useRef } from "react";
import "./Cursor.css";

/**
 * A dot + trailing ring cursor for fine pointers, plus magnetic pull on any
 * element marked `data-magnetic`. Purely decorative: the native cursor still
 * works, and nothing renders on touch or under reduced motion.
 */
export function Cursor({ enabled }: { enabled: boolean }) {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled || !window.matchMedia("(pointer: fine)").matches) return;
    const dot = dotRef.current!;
    const ring = ringRef.current!;
    document.documentElement.classList.add("has-cursor");

    let x = -100;
    let y = -100;
    let rx = x;
    let ry = y;
    let raf = 0;
    let magnet: HTMLElement | null = null;

    const loop = () => {
      rx += (x - rx) * 0.18;
      ry += (y - ry) * 0.18;
      dot.style.transform = `translate(${x}px, ${y}px)`;
      ring.style.transform = `translate(${rx}px, ${ry}px)`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const release = () => {
      if (!magnet) return;
      magnet.style.transform = "";
      magnet = null;
    };

    const onMove = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      const target = e.target as Element | null;
      const hot = target?.closest("a, button, [role='group'][tabindex]");
      ring.classList.toggle("cursor__ring--hot", !!hot);
      ring.classList.toggle("cursor__ring--grab", !!target?.closest(".sleeve--top"));

      const m = target?.closest<HTMLElement>("[data-magnetic]") ?? null;
      if (m !== magnet) release();
      if (m) {
        magnet = m;
        const r = m.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        m.style.transform = `translate(${dx * 0.28}px, ${dy * 0.38}px)`;
      }
    };
    const onLeave = () => {
      x = y = -100;
      release();
    };
    const onDown = () => ring.classList.add("cursor__ring--down");
    const onUp = () => ring.classList.remove("cursor__ring--down");

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    return () => {
      cancelAnimationFrame(raf);
      release();
      document.documentElement.classList.remove("has-cursor");
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <div className="cursor" aria-hidden="true">
      <div ref={ringRef} className="cursor__ring" />
      <div ref={dotRef} className="cursor__dot" />
    </div>
  );
}
