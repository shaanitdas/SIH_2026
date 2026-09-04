import { RubricMetrics, SelectedVisionModel } from "@sih/shared";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function logMetricsDashboard(
  metrics: RubricMetrics,
  selectedModel?: SelectedVisionModel,
): void {
  console.info("[rubric-dashboard]", {
    visualContextAccuracy: pct(metrics.visualContextAccuracy),
    piiRecallPrecision: pct(metrics.piiRecallPrecision),
    redactionPrecision: pct(metrics.redactionPrecision),
    resourceUtilization: pct(metrics.resourceUtilization),
    endToEndLatency: pct(metrics.endToEndLatency),
    weightedOverall: pct(metrics.weightedOverall),
    selectedVisionModel: selectedModel?.descriptor.id ?? "none",
    modelScore: selectedModel ? pct(selectedModel.weightedScore) : "n/a",
  });
}
