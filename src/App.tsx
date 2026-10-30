import { useEffect } from "react";
import { Close } from "./components/Close";
import { Cursor } from "./components/Cursor";
import { Marquee } from "./components/Marquee";
import { Nav } from "./components/Nav";
import { Pipeline } from "./components/Pipeline";
import { Platform } from "./components/Platform";
import { PortalHero } from "./components/PortalHero";
import { Roadmap } from "./components/Roadmap";
import { ScanSequence } from "./components/ScanSequence";
import { Statement } from "./components/Statement";
import { useReducedMotion } from "./hooks/useReducedMotion";
import { useReveal } from "./hooks/useReveal";

export function App() {
  const reduced = useReducedMotion();
  const animate = !reduced;

  // Reveal rules are scoped to .motion-ok, so the no-JS and reduced-motion
  // renders are the finished page.
  useEffect(() => {
    document.documentElement.classList.toggle("motion-ok", animate);
  }, [animate]);
  useReveal(animate);

  return (
    <>
      <a className="skip-link" href="#how">
        Skip to content
      </a>
      <Cursor enabled={animate} />
      <Nav />
      <main>
        <PortalHero animate={animate} />
        <Statement animate={animate} />
        <ScanSequence animate={animate} />
        <Marquee animate={animate} />
        <Platform reducedMotion={reduced} />
        <Pipeline animate={animate} />
        <Roadmap />
      </main>
      <Close />
    </>
  );
}
