import { ActionPlan, AgentAction } from "@sih/shared";

function canExecute(action: AgentAction): boolean {
  if (action.riskLevel === "high") {
    return false;
  }
  return action.confidence >= 0.55;
}

export function validatePlan(plan: ActionPlan): ActionPlan {
  const filtered = plan.actions.filter(canExecute);

  return {
    ...plan,
    actions: filtered,
    requiresUserConsent:
      plan.requiresUserConsent || filtered.some((action) => action.riskLevel !== "low"),
  };
}
