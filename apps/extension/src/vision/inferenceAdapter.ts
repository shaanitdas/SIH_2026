import {
  SensitiveEntity,
  SelectedVisionModel,
  UiElement,
  VisionObservation,
} from "@sih/shared";

export interface VisionInferenceOutput {
  entities: SensitiveEntity[];
  observations: VisionObservation[];
}

function derivedType(
  model: SelectedVisionModel,
  observation: VisionObservation,
): SensitiveEntity["type"] {
  if (model.descriptor.task === "face_detection") return "FACE";
  if (model.descriptor.task === "ocr") return "ACCOUNT";
  if (observation.kind === "video") return "FACE";
  return "ADDRESS";
}

function deriveVisionEntity(
  observation: VisionObservation,
  idx: number,
  model: SelectedVisionModel,
): SensitiveEntity {
  const type = derivedType(model, observation);
  const boostedConfidence = Math.min(
    0.97,
    observation.confidence * 0.6 + model.descriptor.metricFit.piiRecallPrecision * 0.4,
  );

  return {
    id: `${observation.id}-entity-${idx}`,
    elementId: observation.id,
    type,
    confidence: boostedConfidence,
    source: "vision",
    token: `<${type}_V${idx + 1}>`,
    reasons: [
      `Detected with ${model.descriptor.name} (${model.descriptor.family}).`,
      `Dominant task mode: ${model.descriptor.task}.`,
    ],
    matchText: undefined,
  };
}

export async function runVisionFallback(
  observations: VisionObservation[],
  _elements: UiElement[],
  selectedModel: SelectedVisionModel,
): Promise<VisionInferenceOutput> {
  const entities = observations
    .filter((observation) => observation.bounds.width * observation.bounds.height > 2500)
    .map((observation, idx) => deriveVisionEntity(observation, idx, selectedModel));

  const calibratedObservations = observations.map((observation) => ({
    ...observation,
    confidence: Math.min(
      0.95,
      observation.confidence * 0.7 + selectedModel.descriptor.metricFit.visualContextAccuracy * 0.3,
    ),
    notes: [...observation.notes, `Inference model: ${selectedModel.descriptor.id}`],
  }));

  return { entities, observations: calibratedObservations };
}
