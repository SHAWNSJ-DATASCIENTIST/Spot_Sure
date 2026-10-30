// All page copy lives here so sections stay presentational.
// Evidence rule: describe what SpotSure is built to do. Nothing on this page
// is a live reading, a real booking or a real AI result.

export type Status = "In development" | "Planned";

export type ArtKind = "sensor" | "vision" | "fusion" | "graph" | "booking" | "ledger";

export interface Capability {
  code: string;
  title: string;
  layer: string;
  stack: string;
  status: Status;
  art: ArtKind;
  summary: string;
}

export const capabilities: Capability[] = [
  {
    code: "SS-01",
    title: "Bay sensors",
    layer: "Hardware",
    stack: "Wi-Fi nodes → Firebase",
    status: "In development",
    art: "sensor",
    summary: "Wi-Fi parking hardware is being built to push each bay observation to Firebase as it changes.",
  },
  {
    code: "SS-02",
    title: "YOLO vision",
    layer: "Computer vision",
    stack: "CCTV + mobile video → YOLO",
    status: "In development",
    art: "vision",
    summary: "CCTV footage and phone-recorded clips are designed to run through YOLO to detect vehicles and infer occupancy.",
  },
  {
    code: "SS-03",
    title: "Occupancy fusion",
    layer: "Parking intelligence",
    stack: "Hardware + vision observations",
    status: "In development",
    art: "fusion",
    summary: "Both signals are meant to be reconciled per bay into one of three states: available, occupied or verify.",
  },
  {
    code: "SS-04",
    title: "Trust graph",
    layer: "Trust signals",
    stack: "TigerGraph (not connected yet)",
    status: "Planned",
    art: "graph",
    summary:
      "Planned: a graph of users, listings, bookings and devices to surface suspicious links, with reasons, for staff to review. No trust or fraud signals exist yet, and none would block a booking on their own.",
  },
  {
    code: "SS-05",
    title: "Book & enter",
    layer: "Marketplace",
    stack: "Listings, booking requests; QR entry/exit and payments planned",
    status: "In development",
    art: "booking",
    summary: "In pilot: find verified listings, request a time and get the owner's confirmation. Payments and QR entry/exit are planned.",
  },
  {
    code: "SS-06",
    title: "Audit proofs",
    layer: "Web3",
    stack: "Verifiable transaction records",
    status: "Planned",
    art: "ledger",
    summary: "Where it adds real value, bookings could carry a verifiable record that anyone can audit later.",
  },
];

export interface PipelineRow {
  art: ArtKind;
  tag: string;
  name: string;
  detail: string;
}

export const pipeline: PipelineRow[] = [
  { art: "sensor", tag: "Hardware", name: "Wi-Fi bay sensors", detail: "Firebase realtime" },
  { art: "vision", tag: "Vision", name: "CCTV footage", detail: "YOLO detection" },
  { art: "vision", tag: "Vision", name: "Mobile-recorded video", detail: "YOLO detection" },
  { art: "fusion", tag: "Fusion", name: "Occupancy engine", detail: "Available · Occupied · Verify" },
  { art: "graph", tag: "Trust", name: "Relationship graph", detail: "TigerGraph · planned" },
];

export const bayStates = [
  { name: "Available", rule: "Sensor and camera both read the bay as empty." },
  { name: "Occupied", rule: "Sensor and camera both read a vehicle in the bay." },
  { name: "Verify", rule: "The two signals disagree, or one is missing or stale." },
];

export const navLinks = [
  { href: "#how", label: "How it works" },
  { href: "#platform", label: "Platform" },
  { href: "#pipeline", label: "Pipeline" },
  { href: "#roadmap", label: "Roadmap" },
];
