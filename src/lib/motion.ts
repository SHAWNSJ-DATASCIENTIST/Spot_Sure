export const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));

/** Map `v` from [start, end] onto [0, 1], clamped. */
export const segment = (v: number, start: number, end: number) => clamp((v - start) / (end - start));

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Every value the portal hero needs, derived purely from scroll progress
 * (0 = hero top at viewport top, 1 = sticky stage about to release).
 * Pure so it plays identically in reverse and can be unit-tested.
 */
export function portalFrame(progress: number) {
  const p = clamp(progress);
  const open = easeInOutCubic(segment(p, 0.04, 0.62));
  const title = easeInOutCubic(segment(p, 0, 0.72));
  const settle = easeOutCubic(segment(p, 0, 0.85));
  return {
    open, // panels: 0 closed → 1 cleared
    title, // wordmark: scale up, tracking tightens, halves split
    imageScale: 1.16 - 0.16 * settle,
    wash: 0.32 * segment(p, 0.25, 0.9),
    dots: easeOutCubic(segment(p, 0.08, 0.7)),
    meta: 1 - segment(p, 0.75, 1),
  };
}

/** Deck: should a drag of `dx` px on a deck `width` px wide throw the card? */
export const shouldThrow = (dx: number, width: number) => Math.abs(dx) > width * 0.1;
