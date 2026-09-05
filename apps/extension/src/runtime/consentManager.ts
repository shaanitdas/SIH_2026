import { ActionPlan, ConsentDecision, SanitizedContext } from "@sih/shared";

export type ConsentMode = "strict" | "balanced" | "demo";

export interface ConsentFlow {
  promptRequired: boolean;
  autoDecision?: ConsentDecision;
  reason: string;
}

export interface ConsentUi {
  prompt(plan: ActionPlan, context: SanitizedContext): Promise<ConsentDecision>;
}

function hasHighSecuritySignal(context: SanitizedContext): boolean {
  return context.securitySignals.some((signal) => signal.confidence >= 0.75);
}

function worstRisk(plan: ActionPlan): "low" | "medium" | "high" | "none" {
  if (plan.actions.length === 0) return "none";
  const levels = plan.actions.map((action) => action.riskLevel);
  if (levels.includes("high")) return "high";
  if (levels.includes("medium")) return "medium";
  return "low";
}

export function evalConsentFlow(
  context: SanitizedContext,
  plan: ActionPlan,
  mode: ConsentMode = "balanced",
): ConsentFlow {
  const hasSignal = hasHighSecuritySignal(context);
  const risk = worstRisk(plan);
  const uncertain = context.detectionSummary.uncertainCount > 0;

  if (hasSignal) {
    return {
      promptRequired: true,
      reason: "Potential prompt-injection or malicious automation trap detected.",
    };
  }

  if (risk === "high") {
    return {
      promptRequired: true,
      reason: "Plan contains high-risk actions that require explicit user approval.",
    };
  }

  if (uncertain) {
    return {
      promptRequired: true,
      reason: "Uncertain privacy detections require user confirmation.",
    };
  }

  if (mode === "strict") {
    if (plan.requiresUserConsent || risk !== "low") {
      return {
        promptRequired: true,
        reason: "Strict mode requires review of any non-trivial action.",
      };
    }
  }

  if (mode === "balanced" && (risk === "medium" || plan.requiresUserConsent)) {
    return {
      promptRequired: true,
      reason: "Medium-risk actions or server-flagged actions require user approval.",
    };
  }

  return {
    promptRequired: false,
    autoDecision: {
      approved: true,
      reason: "Policy checks passed for autonomous low-risk execution.",
      requiredActions: [],
    },
    reason: "Autonomous low-risk execution permitted.",
  };
}

export async function requestConsent(
  plan: ActionPlan,
  context: SanitizedContext,
  ui: ConsentUi,
  mode: ConsentMode = "balanced",
): Promise<ConsentDecision> {
  const flow = evalConsentFlow(context, plan, mode);
  if (!flow.promptRequired && flow.autoDecision) {
    return flow.autoDecision;
  }
  return ui.prompt(plan, context);
}

export function buildRejectDecision(reason: string): ConsentDecision {
  return {
    approved: false,
    reason,
    requiredActions: [],
  };
}