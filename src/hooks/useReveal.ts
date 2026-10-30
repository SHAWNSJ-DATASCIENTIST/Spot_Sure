import { useEffect } from "react";

/**
 * One-shot entry reveals. Elements with `.reveal` get `.is-in` the first time
 * they enter the viewport and never lose it. The hiding rule in CSS is scoped
 * to `html.motion-ok`, so no-JS and reduced-motion renders show everything.
 *
 * Two special cases: a wiped heading is fully clipped while hidden, so it
 * watches its parent; the footer wordmark sits at the page's bottom edge, so
 * it is watched without the usual bottom inset.
 */
export function useReveal(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const watchers = new Map<Element, HTMLElement[]>();
    const reveal = (entries: IntersectionObserverEntry[], io: IntersectionObserver) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        watchers.get(entry.target)?.forEach((el) => el.classList.add("is-in"));
        io.unobserve(entry.target);
      }
    };
    const main = new IntersectionObserver(reveal, { rootMargin: "0px 0px -10% 0px", threshold: 0.08 });
    const edge = new IntersectionObserver(reveal, { threshold: 0.2 });

    document.querySelectorAll<HTMLElement>(".reveal:not(.is-in)").forEach((el) => {
      const target = (el.classList.contains("reveal--wipe") && el.parentElement) || el;
      if (!watchers.has(target)) (el.classList.contains("close__mark") ? edge : main).observe(target);
      watchers.set(target, [...(watchers.get(target) ?? []), el]);
    });
    return () => {
      main.disconnect();
      edge.disconnect();
    };
  }, [enabled]);
}
