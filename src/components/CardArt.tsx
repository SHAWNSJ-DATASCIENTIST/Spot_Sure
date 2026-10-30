import { memo } from "react";
import type { ArtKind } from "../data/content";

/** Abstract sleeve artwork for each capability. Decorative only. */

const BONE = "#ede7dc";
const AMBER = "#e8913c";
const TEAL = "#4f9aa3";
const DIM = "rgba(237,231,220,0.16)";

function Sensor() {
  return (
    <>
      <rect x="130" y="110" width="140" height="230" fill="none" stroke={DIM} strokeWidth="2" />
      {[60, 105, 150, 195].map((r, i) => (
        <path
          key={r}
          d={`M ${200 - r} 230 A ${r} ${r} 0 0 1 ${200 + r} 230`}
          fill="none"
          stroke={i === 0 ? AMBER : BONE}
          strokeOpacity={i === 0 ? 1 : 0.55 - i * 0.12}
          strokeWidth="2"
        />
      ))}
      <circle cx="200" cy="230" r="11" fill={AMBER} />
      <line x1="40" y1="300" x2="360" y2="300" stroke={DIM} strokeWidth="2" />
    </>
  );
}

function Vision() {
  const boxes = [
    [62, 96, 82, 132, true],
    [160, 96, 82, 132, false],
    [258, 96, 82, 132, true],
    [62, 246, 82, 100, false],
    [160, 246, 82, 100, true],
  ] as const;
  return (
    <>
      {boxes.map(([x, y, w, h, car], i) => (
        <g key={i}>
          {car && <rect x={x + 16} y={y + 18} width={w - 32} height={h - 36} rx="10" fill={BONE} opacity="0.2" />}
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill="none"
            stroke={car ? TEAL : AMBER}
            strokeWidth="2"
            strokeDasharray={car ? undefined : "7 6"}
          />
        </g>
      ))}
      <line x1="40" y1="60" x2="360" y2="60" stroke={DIM} strokeWidth="2" />
      <circle cx="320" cy="296" r="22" fill="none" stroke={BONE} strokeOpacity="0.5" strokeWidth="2" />
      <circle cx="320" cy="296" r="6" fill={AMBER} />
    </>
  );
}

function Fusion() {
  const wave = (amp: number, phase: number) => {
    let d = "M 40 200";
    for (let x = 40; x <= 360; x += 8) {
      const t = (x - 40) / 320;
      const y = 200 + Math.sin(t * Math.PI * 3 + phase) * amp * (1 - t);
      d += ` L ${x} ${y.toFixed(1)}`;
    }
    return d;
  };
  return (
    <>
      <path d={wave(110, 0)} fill="none" stroke={AMBER} strokeWidth="2.5" />
      <path d={wave(110, Math.PI)} fill="none" stroke={TEAL} strokeWidth="2.5" />
      <path d="M 300 200 L 360 200" stroke={BONE} strokeWidth="4" />
      <circle cx="300" cy="200" r="9" fill={BONE} />
    </>
  );
}

function Graph() {
  const nodes: [number, number][] = [
    [90, 110],
    [200, 80],
    [310, 130],
    [130, 230],
    [250, 210],
    [330, 290],
    [90, 320],
    [210, 320],
  ];
  const edges = [
    [0, 1], [1, 2], [0, 3], [1, 4], [2, 4], [3, 4], [4, 5], [3, 6], [6, 7], [7, 4], [7, 5],
  ];
  return (
    <>
      {edges.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a][0]}
          y1={nodes[a][1]}
          x2={nodes[b][0]}
          y2={nodes[b][1]}
          stroke={a === 4 || b === 4 ? AMBER : BONE}
          strokeOpacity={a === 4 || b === 4 ? 0.9 : 0.3}
          strokeWidth="2"
        />
      ))}
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 4 ? 13 : 8} fill={i === 4 ? AMBER : "#15191c"} stroke={i === 4 ? AMBER : BONE} strokeWidth="2" />
      ))}
      <circle cx="250" cy="210" r="30" fill="none" stroke={AMBER} strokeWidth="1.5" strokeDasharray="4 5" />
    </>
  );
}

function Booking() {
  const cells: [number, number][] = [];
  const r = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 0, 1];
  for (let i = 0; i < 25; i++) if (r[i]) cells.push([i % 5, Math.floor(i / 5)]);
  return (
    <>
      <rect x="80" y="70" width="240" height="260" rx="14" fill="none" stroke={DIM} strokeWidth="2" />
      <line x1="80" y1="250" x2="320" y2="250" stroke={DIM} strokeWidth="2" strokeDasharray="6 6" />
      {cells.map(([cx, cy], i) => (
        <rect key={i} x={140 + cx * 24} y={98 + cy * 24} width="20" height="20" fill={BONE} opacity="0.75" />
      ))}
      <rect x="132" y="90" width="136" height="136" fill="none" stroke={TEAL} strokeWidth="2" />
      <line x1="110" y1="290" x2="210" y2="290" stroke={BONE} strokeOpacity="0.5" strokeWidth="6" strokeLinecap="round" />
      <circle cx="286" cy="290" r="8" fill={AMBER} />
    </>
  );
}

function Ledger() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${60 + i * 100} ${150 + (i % 2) * 30})`}>
          <rect width="80" height="80" fill="none" stroke={i === 2 ? AMBER : BONE} strokeOpacity={i === 2 ? 1 : 0.55} strokeWidth="2" strokeDasharray={i === 2 ? "6 6" : undefined} />
          <line x1="14" y1="28" x2="66" y2="28" stroke={BONE} strokeOpacity="0.4" strokeWidth="2" />
          <line x1="14" y1="44" x2="50" y2="44" stroke={BONE} strokeOpacity="0.4" strokeWidth="2" />
        </g>
      ))}
      <line x1="140" y1="190" x2="160" y2="210" stroke={TEAL} strokeWidth="2" />
      <line x1="240" y1="210" x2="260" y2="190" stroke={TEAL} strokeWidth="2" />
      <line x1="40" y1="320" x2="360" y2="320" stroke={DIM} strokeWidth="2" />
    </>
  );
}

const ART: Record<ArtKind, () => JSX.Element> = {
  sensor: Sensor,
  vision: Vision,
  fusion: Fusion,
  graph: Graph,
  booking: Booking,
  ledger: Ledger,
};

export const CardArt = memo(function CardArt({ kind }: { kind: ArtKind }) {
  const Art = ART[kind];
  return (
    <svg viewBox="0 0 400 400" aria-hidden="true">
      <Art />
    </svg>
  );
});
