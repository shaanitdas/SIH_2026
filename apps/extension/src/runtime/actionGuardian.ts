import { ActionPlan, AgentAction, SanitizedContext } from "@sih/shared";

function confidenceFloor(action: AgentAction): number {
  if (action.riskLevel === "high") return 0.95;
  if (action.riskLevel === "medium") return 0.7;
  return 0.5;
}

function targetExists(action: AgentAction, context: SanitizedContext): boolean {
  if (!action.targetElementId) return true;
  return context.elements.some((element) => element.id === action.targetElementId);
}

function canExecute(action: AgentAction, context: SanitizedContext): boolean {
  if (action.riskLevel === "high") return false;
  if (!targetExists(action, context)) return false;
  return action.confidence >= confidenceFloor(action);
}

export function validatePlan(plan: ActionPlan, context: SanitizedContext): ActionPlan {
  const filtered = plan.actions.filter((action) => canExecute(action, context));

  return {
    ...plan,
    actions: filtered,
    requiresUserConsent:
      plan.requiresUserConsent ||
      filtered.some((action) => action.riskLevel !== "low") ||
      context.securitySignals.length > 0,
    guardrailNotes: [
      ...plan.guardrailNotes,
      "Local action guardian removed high-risk/invalid-target actions.",
    ],
  };
}
