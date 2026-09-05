import { ActionPlan, AgentAction, SanitizedContext } from "@sih/shared";
import { resolveDomTarget, signatureMatches } from "../pipeline/domExtractor.js";

function confidenceFloor(action: AgentAction): number {
  if (action.riskLevel === "high") return 0.95;
  if (action.riskLevel === "medium") return 0.7;
  return 0.5;
}

function targetExists(action: AgentAction, context: SanitizedContext): boolean {
  if (!action.targetElementId) return true;
  return context.elements.some((element) => element.id === action.targetElementId);
}

function targetIsLiveAndStable(action: AgentAction, context: SanitizedContext): boolean {
  if (!action.targetElementId) return true;
  const element = context.elements.find((candidate) => candidate.id === action.targetElementId);
  if (!element) return false;
  const node = resolveDomTarget(element);
  if (!node) return false;
  return signatureMatches(node, {
    role: element.role,
    accessibleName: element.accessibleName,
    bounds: element.bounds,
  });
}

function canExecute(action: AgentAction, context: SanitizedContext): boolean {
  if (action.riskLevel === "high") return false;
  if (!targetExists(action, context)) return false;
  if (!targetIsLiveAndStable(action, context)) return false;
  return action.confidence >= confidenceFloor(action);
}

export function validatePlan(plan: ActionPlan, context: SanitizedContext): ActionPlan {
  const filtered = plan.actions.filter((action) => canExecute(action, context));

  const dropped = plan.actions.length - filtered.length;
  return {
    ...plan,
    actions: filtered,
    requiresUserConsent:
      plan.requiresUserConsent ||
      filtered.some((action) => action.riskLevel !== "low") ||
      context.securitySignals.length > 0,
    guardrailNotes: [
      ...plan.guardrailNotes,
      dropped > 0
        ? `Local action guardian dropped ${dropped} high-risk/invalid-target/moved actions.`
        : "Local action guardian verified every action against the live DOM.",
    ],
  };
}