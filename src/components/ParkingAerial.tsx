import { memo, useId } from "react";
import "./ParkingAerial.css";

/**
 * Illustrative night-time aerial render of a parking deck with detection
 * overlays, sodium lamps, cars moving down the aisle and a vision sweep.
 * Deterministic (seeded) so it renders identically every time. This is an
 * illustration of what SpotSure's vision layer annotates — not live output.
 */

const W = 1600;
const H = 1000;
const BAY_W = 94;
const BAY_D = 168;
const COLS = 17;
const X0 = (W - COLS * BAY_W) / 2;
const AISLE_Y = 52 + BAY_D * 2;
const AISLE_H = 575 - AISLE_Y;

const AMBER = "#e8913c";
const TEAL = "#4f9aa3";
const CAR_TONES = ["#1d2226", "#2a3136", "#3a434a", "#8c9296", "#c9c2b4", "#24343a", "#4a2a17", "#202529", "#5d666c"];

type Mark = "taken" | "verify" | "free" | null;

interface Bay {
  x: number;
  y: number;
  flip: boolean;
  car: string | null;
  tilt: number;
  nudge: number;
  mark: Mark;
}

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

// Rows: [top y, faces down?]
const ROWS: [number, boolean][] = [
  [52, true],
  [52 + BAY_D, false],
  [575, true],
  [575 + BAY_D, false],
];

// Bays near the centre of the frame carry detection marks.
const MARKS: Record<string, Mark> = {
  "1-6": "taken",
  "1-7": "free",
  "1-8": "taken",
  "1-10": "verify",
  "2-7": "taken",
  "2-8": "free",
  "2-9": "verify",
  "2-10": "taken",
};

function buildBays(): Bay[] {
  const r = rng(20261028);
  const bays: Bay[] = [];
  ROWS.forEach(([y, flip], row) => {
    for (let c = 0; c < COLS; c++) {
      const mark = MARKS[`${row}-${c}`] ?? null;
      const occupied = mark === "free" ? false : mark ? true : r() > 0.3;
      bays.push({
        x: X0 + c * BAY_W,
        y,
        flip,
        car: occupied ? CAR_TONES[Math.floor(r() * CAR_TONES.length)] : null,
        tilt: (r() - 0.5) * 5,
        nudge: (r() - 0.5) * 10,
        mark,
      });
    }
  });
  return bays;
}

const BAYS = buildBays();

function Car({ cx, cy, tone, tilt, flip, sheen }: { cx: number; cy: number; tone: string; tilt: number; flip: boolean; sheen: string }) {
  const light = tone === "#c9c2b4" || tone === "#8c9296";
  return (
    <g transform={`translate(${cx} ${cy}) rotate(${tilt + (flip ? 180 : 0)})`}>
      <rect x={-31} y={-62} width={62} height={126} rx={15} fill="#000" opacity={0.55} transform="translate(4 8)" />
      <rect x={-28} y={-60} width={56} height={120} rx={14} fill={tone} />
      <rect x={-28} y={-60} width={56} height={120} rx={14} fill={`url(#${sheen})`} />
      <rect x={-22} y={-34} width={44} height={22} rx={6} fill="#07090a" opacity={0.85} />
      <rect x={-22} y={20} width={44} height={16} rx={5} fill="#07090a" opacity={0.75} />
      <rect x={-20} y={-10} width={40} height={28} rx={5} fill="#fff" opacity={light ? 0.14 : 0.05} />
      <rect x={-24} y={56} width={12} height={3} rx={1.5} fill="#b8322a" opacity={0.7} />
      <rect x={12} y={56} width={12} height={3} rx={1.5} fill="#b8322a" opacity={0.7} />
    </g>
  );
}

/** A car driving the aisle, with headlight cones. */
function Driver({ y, dir, tone, className, beam }: { y: number; dir: 1 | -1; tone: string; className: string; beam: string }) {
  return (
    <g className={className}>
      <g transform={`translate(0 ${y}) scale(${dir} 1)`}>
        <path d="M 70 -22 L 330 -95 L 330 95 L 70 22 Z" fill={`url(#${beam})`} />
        <rect x={-66} y={-30} width={140} height={60} rx={16} fill="#000" opacity={0.5} transform="translate(5 6)" />
        <rect x={-64} y={-28} width={136} height={56} rx={15} fill={tone} />
        <rect x={20} y={-22} width={26} height={44} rx={6} fill="#07090a" opacity={0.85} />
        <rect x={-52} y={-22} width={18} height={44} rx={5} fill="#07090a" opacity={0.75} />
        <rect x={66} y={-24} width={5} height={12} rx={2} fill="#fff4dc" />
        <rect x={66} y={12} width={5} height={12} rx={2} fill="#fff4dc" />
        <rect x={-66} y={-24} width={4} height={10} rx={2} fill="#e0473a" />
        <rect x={-66} y={14} width={4} height={10} rx={2} fill="#e0473a" />
      </g>
    </g>
  );
}

function Detection({ bay, index }: { bay: Bay; index: number }) {
  if (!bay.mark) return null;
  const pad = 8;
  const x = bay.x + pad;
  const y = bay.y + pad;
  const w = BAY_W - pad * 2;
  const h = BAY_D - pad * 2;
  const colour = bay.mark === "verify" ? AMBER : TEAL;
  const label = bay.mark === "taken" ? "occupied" : bay.mark;
  const tagY = bay.flip ? y - 2 : y + h + 22;
  return (
    <g className={`pa-det pa-det--${bay.mark}`} style={{ animationDelay: `${index * 0.18}s` }}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill={colour}
        fillOpacity={bay.mark === "free" ? 0.04 : 0.08}
        stroke={colour}
        strokeWidth={3}
        strokeDasharray={bay.mark === "taken" ? undefined : "10 7"}
      />
      {[
        [x, y, 1, 1],
        [x + w, y, -1, 1],
        [x, y + h, 1, -1],
        [x + w, y + h, -1, -1],
      ].map(([cx, cy, sx, sy], i) => (
        <path key={i} d={`M ${cx} ${cy + sy * 16} V ${cy} H ${cx + sx * 16}`} fill="none" stroke={colour} strokeWidth={5} />
      ))}
      <rect x={x} y={tagY - 20} width={label.length * 9.2 + 14} height={22} fill="#0a0c0e" stroke={colour} strokeWidth={1.5} />
      <text x={x + 7} y={tagY - 4} fill={colour} fontFamily="Sora, sans-serif" fontSize={13} letterSpacing="0.06em">
        {label}
      </text>
    </g>
  );
}

export const ParkingAerial = memo(function ParkingAerial({
  className = "",
  animated = false,
}: {
  className?: string;
  animated?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const ids = {
    lamp: `pa-lamp-${id}`,
    tar: `pa-tar-${id}`,
    grain: `pa-grain-${id}`,
    sheen: `pa-sheen-${id}`,
    beam: `pa-beam-${id}`,
    scan: `pa-scan-${id}`,
  };
  return (
    <svg
      className={`pa ${animated ? "pa--live" : ""} ${className}`.trim()}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={ids.lamp} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffb25e" stopOpacity="0.62" />
          <stop offset="0.45" stopColor="#e8913c" stopOpacity="0.22" />
          <stop offset="1" stopColor="#e8913c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={ids.tar} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#15191c" />
          <stop offset="1" stopColor="#0c0f11" />
        </linearGradient>
        <linearGradient id={ids.sheen} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={ids.beam} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff4dc" stopOpacity="0.5" />
          <stop offset="1" stopColor="#fff4dc" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={ids.scan} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={TEAL} stopOpacity="0" />
          <stop offset="0.85" stopColor={TEAL} stopOpacity="0.22" />
          <stop offset="1" stopColor="#9fd6dc" stopOpacity="0.9" />
        </linearGradient>
        <pattern id={ids.grain} width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.7" fill="#fff" opacity="0.04" />
          <circle cx="4" cy="4" r="0.6" fill="#000" opacity="0.3" />
        </pattern>
      </defs>

      <rect width={W} height={H} fill={`url(#${ids.tar})`} />
      <rect width={W} height={H} fill={`url(#${ids.grain})`} />

      {/* drive aisle */}
      <rect x={0} y={AISLE_Y + 6} width={W} height={AISLE_H - 12} fill="#111417" />
      {Array.from({ length: 14 }, (_, i) => (
        <rect key={i} x={40 + i * 118} y={473} width={64} height={6} fill="#ede7dc" opacity={0.28} />
      ))}
      <path d="M760 430 l40 -18 v10 h60 v16 h-60 v10z" fill="#ede7dc" opacity={0.22} />
      <path d="M840 532 l-40 18 v-10 h-60 v-16 h60 v-10z" fill="#ede7dc" opacity={0.22} />

      {/* bay lines */}
      <g stroke="#ede7dc" strokeWidth={4} opacity={0.32}>
        {ROWS.map(([y], row) =>
          Array.from({ length: COLS + 1 }, (_, c) => (
            <line key={`${row}-${c}`} x1={X0 + c * BAY_W} y1={y} x2={X0 + c * BAY_W} y2={y + BAY_D} />
          )),
        )}
        <line x1={X0} y1={52 + BAY_D} x2={X0 + COLS * BAY_W} y2={52 + BAY_D} />
        <line x1={X0} y1={575 + BAY_D} x2={X0 + COLS * BAY_W} y2={575 + BAY_D} />
      </g>

      {BAYS.map((b, i) =>
        b.car ? (
          <Car
            key={i}
            cx={b.x + BAY_W / 2 + b.nudge * 0.4}
            cy={b.y + BAY_D / 2 + b.nudge}
            tone={b.car}
            tilt={b.tilt}
            flip={b.flip}
            sheen={ids.sheen}
          />
        ) : null,
      )}

      {/* cars moving through the aisle (hero only) */}
      <Driver y={440} dir={1} tone="#c9c2b4" className="pa-drive pa-drive--east" beam={ids.beam} />
      <Driver y={522} dir={-1} tone="#2e3a40" className="pa-drive pa-drive--west" beam={ids.beam} />

      {/* sodium lamps — the source of the amber accent */}
      <g style={{ mixBlendMode: "screen" }}>
        {[300, 800, 1300].map((x, i) => (
          <circle
            key={x}
            className="pa-lamp"
            style={{ animationDelay: `${i * 1.3}s` }}
            cx={x}
            cy={480}
            r={300}
            fill={`url(#${ids.lamp})`}
          />
        ))}
      </g>
      {[300, 800, 1300].map((x) => (
        <g key={x}>
          <circle cx={x} cy={480} r={8} fill="#1d2124" />
          <circle cx={x} cy={480} r={3.5} fill="#ffd29a" />
        </g>
      ))}

      {BAYS.map((b, i) => (
        <Detection key={`d${i}`} bay={b} index={i % 9} />
      ))}

      {/* vision sweep (hero only) */}
      <g className="pa-scan">
        <rect x={-260} y={0} width={260} height={H} fill={`url(#${ids.scan})`} />
      </g>
    </svg>
  );
});
