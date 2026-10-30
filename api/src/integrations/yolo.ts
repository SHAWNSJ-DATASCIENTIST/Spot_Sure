/**
 * Boundary to the YOLO vision service. Submitting a job only queues work;
 * results exist only once the service reports a completed run. Nothing here
 * may synthesise detections.
 */
export interface VideoAnalysisRequest {
  jobId: string;
  sourceType: "cctv_stream" | "uploaded_recording";
  /** Opaque storage key or stream id the vision service can resolve. */
  sourceRef: string;
  spaceId?: string;
}

export type VideoAnalysisOutcome =
  | { state: "queued" | "processing" }
  | { state: "failed"; error: string }
  | {
      state: "completed";
      model: string;
      detections: { bayId?: string; observation: "available" | "occupied" | "unknown"; confidence: number; frameAt: string }[];
    };

export interface VideoAnalysisService {
  readonly name: "yolo";
  submit(request: VideoAnalysisRequest): Promise<{ externalJobId: string }>;
  fetchOutcome(externalJobId: string): Promise<VideoAnalysisOutcome>;
}
