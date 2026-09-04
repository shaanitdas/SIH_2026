import { SensitiveEntity, UiElement, VisionObservation } from "@sih/shared";

export interface VisionInferenceOutput {
  entities: SensitiveEntity[];
  observations: VisionObservation[];
}

function deriveVisionEntity(observation: VisionObservation, idx: number): SensitiveEntity {
  const type = observation.kind === "video" ? "FACE" : observation.kind === "iframe" ? "ACCOUNT" : "ADDRESS";

  return {
    id: `${observation.id}-entity-${idx}`,
    elementId: observation.id,
    type,
    confidence: observation.confidence,
    source: "vision",
    token: `<${type}_V${idx + 1}>`,
    reasons: [`Detected in ${observation.kind} fallback pipeline`],
    matchText: undefined,
  };
}

export async function runVisionFallback(
  observations: VisionObservation[],
  _elements: UiElement[],
): Promise<VisionInferenceOutput> {
  const entities = observations
    .filter((observation) => observation.bounds.width * observation.bounds.height > 2500)
    .map((observation, idx) => deriveVisionEntity(observation, idx));

  const calibratedObservations = observations.map((observation) => ({
    ...observation,
    confidence: Math.min(0.9, observation.confidence + 0.08),
  }));

  return { entities, observations: calibratedObservations };
}
