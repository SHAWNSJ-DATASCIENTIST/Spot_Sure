import { RefObject, useEffect } from "react";

/**
 * - "pin": 0 when the element's top reaches the viewport top, 1 when its
 *   bottom reaches the viewport bottom (the span a sticky child stays pinned).
 * - "through": 0 when the element's top enters at the bottom of the viewport,
 *   1 when its bottom leaves at the top.
 */
export type ProgressMode = "pin" | "through";

/**
 * Calls `onFrame(progress)` once per animation frame in which the page has
 * scrolled or resized. Bound to position, never time, so it reverses on
 * scroll-up. Progress is unclamped; callers clamp as needed.
 */
export function useScrollProgress(
  ref: RefObject<HTMLElement>,
  onFrame: (progress: number) => void,
  enabled = true,
  mode: ProgressMode = "pin",
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      if (mode === "pin") {
        const travel = rect.height - vh;
        onFrame(travel > 0 ? -rect.top / travel : 0);
      } else {
        onFrame((vh - rect.top) / (vh + rect.height));
      }
    };
    const request = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request);
    return () => {
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", request);
      cancelAnimationFrame(raf);
    };
  }, [ref, onFrame, enabled, mode]);
}
