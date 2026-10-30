import { useCallback, useRef, useState, type CSSProperties } from "react";
import { useScrollProgress } from "../hooks/useScrollProgress";
import { easeInOutCubic, segment } from "../lib/motion";
import "./ScanSequence.css";

const STEPS = [
  {
    tag: "Hardware",
    title: "The bay sensor reports",
    body: "A Wi-Fi node in the bay notices a vehicle arrive and is built to push that observation to Firebase.",
  },
  {
    tag: "Vision",
    title: "A camera checks the same bay",
    body: "CCTV or a phone-recorded clip is run through YOLO, which draws a box around any vehicle it finds.",
  },
  {
    tag: "Verdict",
    title: "Both agree, so the bay is marked",
    body: "Matching signals give Available or Occupied. If they disagree or one is stale, the bay is flagged Verify.",
  },
];

/**
 * Pinned, scroll-scrubbed walkthrough of one bay being verified. Each step's
 * progress is a CSS custom property, so the illustration plays backwards too.
 */
export function ScanSequence({ animate }: { animate: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(animate ? 0 : 2);

  const onFrame = useCallback((p: number) => {
    const el = stageRef.current;
    if (!el) return;
    const s1 = easeInOutCubic(segment(p, 0.02, 0.3));
    const s2 = easeInOutCubic(segment(p, 0.36, 0.62));
    const s3 = easeInOutCubic(segment(p, 0.7, 0.9));
    el.style.setProperty("--s1", s1.toFixed(4));
    el.style.setProperty("--s2", s2.toFixed(4));
    el.style.setProperty("--s3", s3.toFixed(4));
    el.style.setProperty("--p", Math.min(1, Math.max(0, p)).toFixed(4));
    setStep(p < 0.33 ? 0 : p < 0.66 ? 1 : 2);
  }, []);
  useScrollProgress(sectionRef, onFrame, animate);

  return (
    <section ref={sectionRef} className={`scan ${animate ? "scan--live" : ""}`} aria-labelledby="scan-title">
      <div ref={stageRef} className="scan__stage">
        <div className="wrap scan__grid">
          <div className="scan__copy">
            <p className="label">
              <span className="label__num">02</span> — One bay, two witnesses
            </p>
            <h2 id="scan-title" className="display h2 scan__title">
              How a bay earns the word <span className="accent">free.</span>
            </h2>
            <ol className="scan__steps">
              {STEPS.map((s, i) => (
                <li key={s.title} className={`scan__step ${i === step ? "is-active" : ""} ${i < step ? "is-done" : ""}`}>
                  <span className="scan__step-num">0{i + 1}</span>
                  <div>
                    <span className="scan__step-tag">{s.tag}</span>
                    <h3 className="scan__step-title">{s.title}</h3>
                    <p className="scan__step-body">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="scan__progress" aria-hidden="true">
              <span />
            </div>
          </div>

          <figure className="scan__visual">
            <BayIllustration />
            <figcaption className="scan__caption">Illustrative sequence — not live data</figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}

function BayIllustration() {
  return (
    <svg className="bay" viewBox="0 0 600 600" aria-hidden="true">
      <defs>
        <radialGradient id="bay-lamp" cx="0.3" cy="0.2" r="0.9">
          <stop offset="0" stopColor="#e8913c" stopOpacity="0.28" />
          <stop offset="1" stopColor="#e8913c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="bay-cone" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4f9aa3" stopOpacity="0.35" />
          <stop offset="1" stopColor="#4f9aa3" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width="600" height="600" fill="#0e1114" />
      <rect width="600" height="600" fill="url(#bay-lamp)" />
      {/* neighbouring bays */}
      <g stroke="#ede7dc" strokeOpacity="0.22" strokeWidth="3">
        <line x1="40" y1="70" x2="40" y2="530" />
        <line x1="190" y1="70" x2="190" y2="530" />
        <line x1="410" y1="70" x2="410" y2="530" />
        <line x1="560" y1="70" x2="560" y2="530" />
        <line x1="40" y1="70" x2="560" y2="70" />
      </g>
      <rect x="60" y="130" width="110" height="230" rx="26" fill="#1f2529" />
      <rect x="430" y="170" width="110" height="230" rx="26" fill="#2b3237" />

      {/* the bay under test */}
      <rect className="bay__outline" x="200" y="80" width="200" height="440" fill="none" strokeWidth="3" />

      {/* sensor puck + pulse rings */}
      <g className="bay__sensor" transform="translate(300 470)">
        {[0, 1, 2].map((i) => (
          <circle key={i} className="bay__ring" style={{ "--r": i } as CSSProperties} r="20" fill="none" stroke="#e8913c" strokeWidth="2" />
        ))}
        <circle r="13" fill="#1a1e21" stroke="#e8913c" strokeWidth="2" />
        <circle r="4" fill="#e8913c" />
      </g>

      {/* the arriving car */}
      <g className="bay__car">
        <rect x="232" y="150" width="136" height="250" rx="34" fill="#000" opacity="0.55" transform="translate(6 10)" />
        <rect x="232" y="150" width="136" height="250" rx="34" fill="#c9c2b4" />
        <rect x="248" y="200" width="104" height="50" rx="12" fill="#0a0c0e" opacity="0.9" />
        <rect x="248" y="330" width="104" height="36" rx="10" fill="#0a0c0e" opacity="0.8" />
        <rect x="252" y="258" width="96" height="64" rx="10" fill="#fff" opacity="0.12" />
      </g>

      {/* camera + view cone */}
      <g className="bay__camera">
        <path d="M 560 30 L 210 120 L 390 520 Z" fill="url(#bay-cone)" />
        <rect x="530" y="16" width="44" height="26" rx="5" fill="#1a1e21" stroke="#4f9aa3" strokeWidth="2" />
        <circle cx="540" cy="29" r="5" fill="#4f9aa3" />
      </g>

      {/* detection box, drawn on with stroke-dashoffset */}
      <g className="bay__det">
        <rect className="bay__box" x="220" y="138" width="160" height="276" fill="none" stroke="#4f9aa3" strokeWidth="3" pathLength={1} />
        <g className="bay__tag">
          <rect x="220" y="110" width="88" height="24" fill="#0a0c0e" stroke="#4f9aa3" strokeWidth="1.5" />
          <text x="230" y="127" fill="#4f9aa3" fontFamily="Sora, sans-serif" fontSize="13" letterSpacing="0.06em">
            vehicle
          </text>
        </g>
      </g>

      {/* verdict */}
      <g className="bay__verdict">
        <rect x="190" y="268" width="220" height="64" fill="#0a0c0e" stroke="#ede7dc" strokeOpacity="0.5" />
        <circle cx="222" cy="300" r="7" fill="#4f9aa3" />
        <text x="240" y="309" fill="#ede7dc" fontFamily="Syne, sans-serif" fontWeight="800" fontSize="26" letterSpacing="-0.02em">
          OCCUPIED
        </text>
      </g>
    </svg>
  );
}
