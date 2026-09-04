import { SanitizedContext, SecuritySignal } from "@sih/shared";
import { computeRubricMetrics, attachMetrics } from "./metrics/metricsEngine.js";
import { extractVisibleDom } from "./pipeline/domExtractor.js";
import { detectPii } from "./privacy/piiDetector.js";
import { redactElements } from "./privacy/redactor.js";
import { executePlan } from "./runtime/actionExecutor.js";
import { validatePlan } from "./runtime/actionGuardian.js";
import { evaluateConsentRequirement } from "./runtime/consentManager.js";
import { detectRuntimeProfile } from "./runtime/runtimeProfile.js";
import { detectPromptInjectionSignals } from "./security/promptInjectionGuard.js";
import { requestActionPlan } from "./transport/client.js";
import { logMetricsDashboard } from "./ui/dashboard.js";
import { logPrivacyLedger } from "./ui/privacyLedger.js";
import { detectDomBlindSpots } from "./vision/domBlindSpotDetector.js";
import { loadSelectedModel } from "./vision/modelLoader.js";
import { selectVisionModel } from "./vision/modelSelector.js";
import { runVisionInWorkerLikeMode } from "./vision/workerAdapter.js";

const SERVER_URL = "http://localhost:8080";

function mergeSignals(...chunks: SecuritySignal[][]): SecuritySignal[] {
  return chunks.flat().filter((signal, index, array) => {
    const key = `${signal.type}:${signal.elementId ?? "na"}:${signal.message}`;
    return (
      array.findIndex(
        (item) => `${item.type}:${item.elementId ?? "na"}:${item.message}` === key,
      ) === index
    );
  });
}

async function buildContext(startedAt: number): Promise<SanitizedContext> {
  const runtimeProfile = detectRuntimeProfile();
  const elements = extractVisibleDom();
  const blindSpots = detectDomBlindSpots();
  const pii = detectPii(elements);

  const modelChoice = selectVisionModel(runtimeProfile, blindSpots);
  const loadResult = await loadSelectedModel(modelChoice.selected, runtimeProfile);
  const visionOutput = await runVisionInWorkerLikeMode(
    blindSpots,
    elements,
    modelChoice.selected,
  );

  const allEntities = [...pii.entities, ...visionOutput.entities];
  const redaction = redactElements(elements, allEntities);
  const securitySignals = mergeSignals(
    detectPromptInjectionSignals(redaction.elements),
    allEntities.filter((entity) => entity.confidence < 0.65).map((entity) => ({
      type: "UNKNOWN_AUTOMATION_TRAP" as const,
      confidence: 0.7,
      message: `Uncertain entity detection requires user confirmation (${entity.type})`,
      elementId: entity.elementId,
    })),
  );

  const endedAt = performance.now();
  const metrics = computeRubricMetrics({
    startedAt,
    endedAt,
    totalElements: elements.length,
    detectionRecall: pii.summary.recallEstimate,
    detectionPrecision: pii.summary.precisionEstimate,
    redactionPrecision: redaction.precisionEstimate,
    runtimeProfile,
    blindSpots,
  });

  const privacyScore = Math.max(0, Math.min(1, metrics.redactionPrecision * metrics.piiRecallPrecision));

  const context: SanitizedContext = {
    sessionId: crypto.randomUUID(),
    pageUrl: window.location.href,
    pageTitle: document.title,
    timestamp: new Date().toISOString(),
    elements: redaction.elements,
    sensitiveEntities: allEntities,
    redactedRegions: redaction.redactedRegions,
    tokenMap: redaction.tokenMap,
    policyVersion: "v2.0.0",
    privacyScore,
    detectionSummary: pii.summary,
    visionObservations: visionOutput.observations,
    selectedVisionModel: modelChoice.selected,
    modelSelectionTrace: modelChoice.trace,
    securitySignals,
    policyDecisions: [
      {
        policy: "adaptive-vision-model-selection",
        status: loadResult.loaded ? "pass" : "warn",
        reason: `${modelChoice.selected.descriptor.id} prepared with ${loadResult.backend}; warmup ${loadResult.warmupMs}ms.`,
      },
    ],
    runtimeProfile,
  };

  return attachMetrics(context, metrics);
}

export async function runAgentCycle(userGoal: string): Promise<void> {
  const startedAt = performance.now();
  const context = await buildContext(startedAt);

  logPrivacyLedger(context);
  if (context.metrics) {
    logMetricsDashboard(context.metrics, context.selectedVisionModel);
  }

  const response = await requestActionPlan(SERVER_URL, userGoal, context);
  const validatedPlan = validatePlan(response.plan, context);
  const consentDecision = evaluateConsentRequirement(context, validatedPlan);

  if (!consentDecision.approved) {
    console.warn("[consent-required]", consentDecision);
    return;
  }

  executePlan(validatedPlan);
  console.info("[agent-plan-executed]", validatedPlan);
}
