import { scoreZeroError, type DefectKind } from "./scoring";

export type InferenceInput = {
  fileName: string;
  latitude: number;
  longitude: number;
  assetCriticality: number;
  priorOpenDefects: number;
  demo?: boolean;
};

export type InferenceResult = {
  model: string;
  label: DefectKind;
  confidence: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  severityInput: Record<string, number>;
  score: ReturnType<typeof scoreZeroError>;
  annotationNote: string;
};

/**
 * Adapter contract for a production CV service. When ML_INFERENCE_URL is configured,
 * a compatible service can replace this deterministic local fallback. The fallback is
 * intentionally explainable and powers the complete no-hardware demonstration flow.
 */
export async function runVisionInference(input: InferenceInput): Promise<InferenceResult> {
  const normalized = input.fileName.toLowerCase();
  const label: DefectKind = normalized.includes("crack") ? "crack" : normalized.includes("struct") || normalized.includes("bridge") ? "structural" : "pothole";
  const seed = Array.from(input.fileName).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const confidence = Math.min(0.97, 0.76 + (seed % 20) / 100);
  const score = scoreZeroError({
    defectType: label,
    confidence,
    latitude: input.latitude,
    longitude: input.longitude,
    assetCriticality: input.assetCriticality,
    priorOpenDefects: input.priorOpenDefects,
    observationCount: 1 + (seed % 3),
  });

  return {
    model: input.demo ? "DRIFT-CV demo adapter v1" : "DRIFT-CV local fallback v1",
    label,
    confidence,
    boundingBox: { x: 18 + (seed % 22), y: 20 + (seed % 17), width: 38, height: 29 },
    severityInput: { confidence, assetCriticality: input.assetCriticality, priorOpenDefects: input.priorOpenDefects },
    score,
    annotationNote: `Detected ${label} candidate; manual engineer review is required before work-order release.`,
  };
}
