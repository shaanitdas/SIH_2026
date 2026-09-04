import {
  ModelSelectionTrace,
  RuntimeProfile,
  SelectedVisionModel,
  VisionModelDescriptor,
  VisionObservation,
} from "@sih/shared";
import { MODEL_CATALOG } from "./modelCatalog.js";

interface SelectionResult {
  selected: SelectedVisionModel;
  trace: ModelSelectionTrace;
}

function dominantBlindSpot(
  observations: VisionObservation[],
): VisionObservation["kind"] | "none" {
  if (observations.length === 0) return "none";
  const counts = new Map<VisionObservation["kind"], number>();
  for (const observation of observations) {
    counts.set(observation.kind, (counts.get(observation.kind) ?? 0) + 1);
  }
  let top: VisionObservation["kind"] = observations[0].kind;
  let best = counts.get(top) ?? 0;
  for (const [kind, count] of counts.entries()) {
    if (count > best) {
      top = kind;
      best = count;
    }
  }
  return top;
}

function taskRelevanceBonus(
  model: VisionModelDescriptor,
  dominant: VisionObservation["kind"] | "none",
): number {
  if (dominant === "video" && model.task === "face_detection") return 0.09;
  if ((dominant === "canvas" || dominant === "iframe") && model.task === "ocr") return 0.08;
  if ((dominant === "canvas" || dominant === "iframe") && model.task === "layout_detection") {
    return 0.05;
  }
  return 0;
}

function runtimeBonus(model: VisionModelDescriptor, profile: RuntimeProfile): number {
  const recommended = model.recommendedFor.includes(profile.profileTier) ? 0.06 : -0.06;
  const latency = model.expectedLatencyMs[profile.executionMode];
  const latencyBonus = latency <= 30 ? 0.08 : latency <= 60 ? 0.04 : latency <= 110 ? 0 : -0.08;
  const sizeBonus = model.approxSizeMB <= 8 ? 0.05 : model.approxSizeMB <= 30 ? 0.02 : -0.1;
  return recommended + latencyBonus + sizeBonus;
}

function scoreModel(
  model: VisionModelDescriptor,
  profile: RuntimeProfile,
  dominant: VisionObservation["kind"] | "none",
): number {
  const weightedRubric =
    model.metricFit.visualContextAccuracy * 0.25 +
    model.metricFit.piiRecallPrecision * 0.2 +
    model.metricFit.redactionPrecision * 0.2 +
    model.metricFit.resourceUtilization * 0.2 +
    model.metricFit.endToEndLatency * 0.15;

  return Math.max(0, Math.min(1, weightedRubric + runtimeBonus(model, profile) + taskRelevanceBonus(model, dominant)));
}

export function selectVisionModel(
  profile: RuntimeProfile,
  observations: VisionObservation[],
): SelectionResult {
  const dominant = dominantBlindSpot(observations);

  const scored = MODEL_CATALOG.map((model) => ({
    model,
    score: scoreModel(model, profile, dominant),
  })).sort((a, b) => b.score - a.score);

  const best = scored[0];
  const selected: SelectedVisionModel = {
    descriptor: best.model,
    weightedScore: best.score,
    reasons: [
      `Dominant blind spot: ${dominant}.`,
      `Runtime mode: ${profile.executionMode}/${profile.profileTier}.`,
      `Model expected latency ${best.model.expectedLatencyMs[profile.executionMode]}ms and size ${best.model.approxSizeMB}MB.`,
      `Rubric-weighted model score ${(best.score * 100).toFixed(1)}%.`,
    ],
  };

  const trace: ModelSelectionTrace = {
    shortlist: scored.slice(0, 3).map((entry) => ({ modelId: entry.model.id, score: entry.score })),
    dominantBlindSpot: dominant,
    selectedModelId: best.model.id,
  };

  return { selected, trace };
}
