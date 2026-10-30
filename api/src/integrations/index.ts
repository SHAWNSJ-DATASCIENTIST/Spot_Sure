import type { Env } from "../config/env.js";
import { IntegrationNotConfiguredError } from "../http/errors.js";
import type { HardwareEventSource } from "./firebase.js";
import type { TrustGraphService } from "./tigergraph.js";
import type { BookingProofService } from "./web3.js";
import type { VideoAnalysisService } from "./yolo.js";

// "not_configured": required settings are absent.
// "configured_not_implemented": settings present, but no client ships yet,
// so the integration is still unusable. Only a real client plus a passing
// integration test may introduce a "connected" state.
export type IntegrationState = "not_configured" | "configured_not_implemented";

export interface Integrations {
  firebase: HardwareEventSource;
  yolo: VideoAnalysisService;
  tigergraph: TrustGraphService;
  web3: BookingProofService;
  status(): Record<"firebase" | "yolo" | "tigergraph" | "web3", IntegrationState>;
}

function unavailable(name: string): () => never {
  return () => {
    throw new IntegrationNotConfiguredError(name);
  };
}

export function buildIntegrations(env: Env): Integrations {
  const state = (configured: boolean): IntegrationState =>
    configured ? "configured_not_implemented" : "not_configured";

  return {
    firebase: { name: "firebase", normalise: unavailable("Firebase"), subscribe: unavailable("Firebase") },
    yolo: { name: "yolo", submit: unavailable("YOLO"), fetchOutcome: unavailable("YOLO") },
    tigergraph: {
      name: "tigergraph",
      upsertVertices: unavailable("TigerGraph"),
      upsertEdges: unavailable("TigerGraph"),
      assess: unavailable("TigerGraph"),
    },
    web3: { name: "web3", anchor: unavailable("Web3"), verify: unavailable("Web3") },
    status: () => ({
      firebase: state(Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_SERVICE_ACCOUNT_PATH)),
      yolo: state(Boolean(env.YOLO_SERVICE_URL)),
      tigergraph: state(Boolean(env.TIGERGRAPH_HOST && env.TIGERGRAPH_GRAPH && env.TIGERGRAPH_SECRET)),
      web3: state(Boolean(env.WEB3_RPC_URL && env.WEB3_CHAIN_ID)),
    }),
  };
}
