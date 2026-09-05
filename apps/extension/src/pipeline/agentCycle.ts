import {
  ActionPlan,
  ConsentDecision,
  ExecutionResult,
  PolicyDecision,
  SanitizedContext,
  SecuritySignal,
} from "@sih/shared";
import { attachMetrics, computeRubricMetrics } from "../metrics/metricsEngine.js";
import { Telemetry } from "../metrics/telemetry.js";
import { extractVisibleDom } from "./domExtractor.js";
import { detectPii } from "../privacy/piiDetector.js";
import { redactElements } from "../privacy/redactor.js";
import { executePlan } from "../runtime/actionExecutor.js";
import { validatePlan } from "../runtime/actionGuardian.js";
import { ConsentMode, ConsentUi, requestConsent } from "../runtime/consentManager.js";
import { detectRuntimeProfile } from "../runtime/runtimeProfile.js";
import { detectPromptInjectionSignals } from "../security/promptInjectionGuard.js";
import {
  buildLocalFallbackPlan,
  PlannerUnavailableError,
  requestActionPlan,
} from "../transport/client.js";
import { logMetricsDashboard } from "../ui/dashboard.js";
import { logPrivacyLedger } from "../ui/privacyLedger.js";
import { detectDomBlindSpots } from "../vision/domBlindSpotDetector.js";
import { loadSelectedModel } from "../vision/modelLoader.js";
import { selectVisionModel } from "../vision/modelSelector.js";
import { runVisionInWorkerLikeMode } from "../vision/workerAdapter.js";

export interface AgentCycleOptions {
  serverUrl: string;
  consentMode?: ConsentMode;
  consentUi: ConsentUi;
  maxReplanAttempts?: number;
  allowOfflinePlan?: boolean;
}

export interface AgentCycleResult {
  context: SanitizedContext;
  plan: ActionPlan;
  consent: ConsentDecision;
  execution: ExecutionResult[];
  telemetry: Telemetry;
  startedAt: string;
  replanAttempts: number;
}

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

async function buildContext(telemetry: Telemetry): Promise<SanitizedContext> {
  telemetry.start("context-build");
  const runtimeProfile = detectRuntimeProfile();

  telemetry.start("dom-extraction");
  const elements = extractVisibleDom();
  const blindSpots = detectDomBlindSpots();
  telemetry.end("dom-extraction");

  telemetry.start("vision-inference");
  const modelChoice = selectVisionModel(runtimeProfile, blindSpots);
  const loadResult = await loadSelectedModel(modelChoice.selected, runtimeProfile);
  const visionOutput = await runVisionInWorkerLikeMode(
    blindSpots,
    elements,
    modelChoice.selected,
  );
  telemetry.end("vision-inference");

  telemetry.start("pii-detection");
  const pii = detectPii(elements);
  telemetry.end("pii-detection");

  telemetry.start("redaction");
  const allEntities = [...pii.entities, ...visionOutput.entities];
  const redaction = redactElements(elements, allEntities);
  telemetry.end("redaction");

  telemetry.start("security-scan");
  const securitySignals = mergeSignals(
    detectPromptInjectionSignals(redaction.elements),
    allEntities.filter((entity) => entity.confidence < 0.65).map((entity) => ({
      type: "UNKNOWN_AUTOMATION_TRAP" as const,
      confidence: 0.7,
      message: `Uncertain entity detection requires user confirmation (${entity.type})`,
      elementId: entity.elementId,
    })),
  );
  telemetry.end("security-scan");
  telemetry.end("context-build");

  const metrics = computeRubricMetrics({
    telemetry,
    totalElements: elements.length,
    detectionRecall: pii.summary.recallEstimate,
    detectionPrecision: pii.summary.precisionEstimate,
    redactionPrecision: redaction.precisionEstimate,
    runtimeProfile,
    blindSpots,
  });

  const privacyScore = Math.max(0, Math.min(1, metrics.redactionPrecision * metrics.piiRecallPrecision));

  const policyDecisions: PolicyDecision[] = [
    {
      policy: "adaptive-vision-model-selection",
      status: loadResult.loaded ? "pass" : "warn",
      reason: `${modelChoice.selected.descriptor.id} prepared with ${loadResult.backend}; warmup ${loadResult.warmupMs}ms.`,
    },
  ];

  const context: SanitizedContext = {
    sessionId: crypto.randomUUID(),
    pageUrl: window.location.href,
    pageTitle: document.title,
    timestamp: new Date().toISOString(),
    elements: redaction.elements,
    sensitiveEntities: allEntities,
    redactedRegions: redaction.redactedRegions,
    tokenMap: redaction.tokenMap,
    policyVersion: "v3.0.0",
    privacyScore,
    detectionSummary: pii.summary,
    visionObservations: visionOutput.observations,
    selectedVisionModel: modelChoice.selected,
    modelSelectionTrace: modelChoice.trace,
    securitySignals,
    policyDecisions,
    runtimeProfile,
  };

  return attachMetrics(context, metrics);
}

export async function runAgentCycle(
  userGoal: string,
  options: AgentCycleOptions,
): Promise<AgentCycleResult> {
  const maxReplanAttempts = options.maxReplanAttempts ?? 2;
  const telemetry = new Telemetry();
  telemetry.start("agent-cycle");

  let plan: ActionPlan;
  let context: SanitizedContext;

  telemetry.start("observe");
  context = await buildContext(telemetry);
  telemetry.end("observe");

  logPrivacyLedger(context);
  if (context.metrics) {
    logMetricsDashboard(context.metrics, context.selectedVisionModel);
  }

  let replanAttempts = 0;

  telemetry.start("plan");
  try {
    const response = await requestActionPlan(options.serverUrl, userGoal, context);
    plan = response.plan;
  } catch (error) {
    if (options.allowOfflinePlan && error instanceof PlannerUnavailableError) {
      plan = buildLocalFallbackPlan(context);
    } else {
      throw error;
    }
  }
  telemetry.end("plan");

  telemetry.start("guard");
  plan = validatePlan(plan, context);
  telemetry.end("guard");

  if (plan.actions.length === 0 && replanAttempts < maxReplanAttempts) {
    replanAttempts += 1;
    telemetry.start("plan");
    const response = await requestActionPlan(options.serverUrl, userGoal, context);
    plan = validatePlan(response.plan, context);
    telemetry.end("plan");
  }

  telemetry.start("consent");
  const consent = await requestConsent(
    plan,
    context,
    options.consentUi,
    options.consentMode ?? "balanced",
  );
  telemetry.end("consent");

  if (!consent.approved) {
    telemetry.end("agent-cycle");
    logPrivacyLedger(context);
    return {
      context,
      plan,
      consent,
      execution: [],
      telemetry,
      startedAt: context.timestamp,
      replanAttempts,
    };
  }

  telemetry.start("execute");
  const execution = executePlan(plan, context);
  telemetry.end("execute");
  telemetry.end("agent-cycle");

  return {
    context,
    plan,
    consent,
    execution,
    telemetry,
    startedAt: context.timestamp,
    replanAttempts,
  };
}