import { RubricMetrics, RuntimeProfile, SanitizedContext, VisionObservation } from "@sih/shared";

interface MetricInput {
  startedAt: number;
  endedAt: number;
  totalElements: number;
  detectionRecall: number;
  detectionPrecision: number;
  redactionPrecision: number;
  runtimeProfile: RuntimeProfile;
  blindSpots: VisionObservation[];
}

function latencyScore(durationMs: number): number {
  if (durationMs <= 700) return 1;
  if (durationMs >= 5000) return 0.3;
  return Math.max(0.3, 1 - (durationMs - 700) / 6000);
}

function resourceScore(profile: RuntimeProfile, totalElements: number): number {
  const modeFactor = profile.executionMode === "webgpu" ? 0.95 : profile.executionMode === "wasm" ? 0.85 : 0.75;
  const loadPenalty = Math.min(0.25, totalElements / 1200);
  return Math.max(0.45, modeFactor - loadPenalty);
}

function visualScore(totalElements: number, blindSpots: VisionObservation[]): number {
  const domCoverage = Math.min(1, totalElements / 100);
  const blindSpotPenalty = Math.min(0.35, blindSpots.length * 0.04);
  return Math.max(0.5, domCoverage - blindSpotPenalty + 0.25);
}

export function computeRubricMetrics(input: MetricInput): RubricMetrics {
  const visualContextAccuracy = visualScore(input.totalElements, input.blindSpots);
  const piiRecallPrecision = (input.detectionRecall + input.detectionPrecision) / 2;
  const redactionPrecision = input.redactionPrecision;
  const resourceUtilization = resourceScore(input.runtimeProfile, input.totalElements);
  const endToEndLatency = latencyScore(input.endedAt - input.startedAt);

  const weightedOverall =
    visualContextAccuracy * 0.25 +
    piiRecallPrecision * 0.2 +
    redactionPrecision * 0.2 +
    resourceUtilization * 0.2 +
    endToEndLatency * 0.15;

  return {
    visualContextAccuracy,
    piiRecallPrecision,
    redactionPrecision,
    resourceUtilization,
    endToEndLatency,
    weightedOverall,
  };
}

export function attachMetrics(context: SanitizedContext, metrics: RubricMetrics): SanitizedContext {
  return { ...context, metrics };
}
