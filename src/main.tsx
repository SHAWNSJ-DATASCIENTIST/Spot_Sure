import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Global styles first so component CSS cascades after (and overrides) them.
import "./styles/global.css";
import { Root } from "./Root";
import { prefersReducedMotion } from "./hooks/useReducedMotion";

// Set before first paint so revealed content never flashes in then hides.
if (!prefersReducedMotion()) document.documentElement.classList.add("motion-ok");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
