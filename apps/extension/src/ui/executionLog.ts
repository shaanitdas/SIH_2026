import { AgentCycleResult } from "../pipeline/agentCycle.js";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function logAgentExecution(result: AgentCycleResult): void {
  const execution = result.execution.map((item) => ({
    action: item.actionId,
    type: item.type,
    status: item.status,
    message: item.message,
    latencyMs: Number(item.latencyMs.toFixed(1)),
  }));

  const consolePayload = {
    consent: result.consent.approved ? "approved" : "rejected",
    replanAttempts: result.replanAttempts,
    planActions: result.plan.actions.map((action) => ({
      id: action.id,
      type: action.type,
      risk: action.riskLevel,
      target: action.targetElementId,
    })),
    execution,
    latencyBreakdown: result.telemetry.toJSON(),
    privacy: contextSummary(result.context),
  };

  console.info("[agent-execution]", consolePayload);
}

function contextSummary(context: AgentCycleResult["context"]): Record<string, string | number> {
  return {
    entities: context.sensitiveEntities.length,
    regions: context.redactedRegions.length,
    privacyScore: pct(context.privacyScore),
    uncertain: context.detectionSummary.uncertainCount,
    visionModel: context.selectedVisionModel?.descriptor.id ?? "none",
  };
}