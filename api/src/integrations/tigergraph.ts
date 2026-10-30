/**
 * Boundary to TigerGraph for relationship sync and explainable trust analysis.
 * Trust results are advisory signals with reasons, never a verdict, and are
 * distinct from occupancy, booking status and access authorisation.
 */
export type GraphVertexType = "user" | "vehicle" | "device" | "parking_space" | "booking";

export interface GraphEdge {
  from: { type: GraphVertexType; id: string };
  to: { type: GraphVertexType; id: string };
  relation: string;
}

export interface TrustAssessment {
  subject: { type: GraphVertexType; id: string };
  /** Risk indicators with human-readable explanations. Empty means no indicators found, not "trusted". */
  indicators: { code: string; explanation: string; relatedVertices: { type: GraphVertexType; id: string }[] }[];
  assessedAt: string;
  queryVersion: string;
}

export interface TrustGraphService {
  readonly name: "tigergraph";
  upsertVertices(vertices: { type: GraphVertexType; id: string; attributes?: Record<string, unknown> }[]): Promise<void>;
  upsertEdges(edges: GraphEdge[]): Promise<void>;
  assess(subject: { type: GraphVertexType; id: string }): Promise<TrustAssessment>;
}
