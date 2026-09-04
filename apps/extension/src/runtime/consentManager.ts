import { ActionPlan, ConsentDecision, SanitizedContext } from "@sih/shared";

export function evaluateConsentRequirement(
  context: SanitizedContext,
  plan: ActionPlan,
): ConsentDecision {
  const highRiskActions = plan.actions
    .filter((action) => action.riskLevel !== "low")
    .map((action) => action.id);

  const hasHighSecuritySignal = context.securitySignals.some((signal) => signal.confidence >= 0.75);

  if (hasHighSecuritySignal) {
    return {
      approved: false,
      reason: "Potential prompt-injection or malicious automation trap detected.",
      requiredActions: highRiskActions,
    };
  }

  if (plan.requiresUserConsent || context.detectionSummary.uncertainCount > 0) {
    return {
      approved: false,
      reason: "User review required for medium/high-risk or uncertain redaction outputs.",
      requiredActions: highRiskActions,
    };
  }

  return {
    approved: true,
    reason: "Policy checks passed for autonomous low-risk execution.",
    requiredActions: [],
  };
}
