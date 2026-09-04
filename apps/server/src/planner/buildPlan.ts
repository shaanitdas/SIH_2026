import { ActionPlan, PlanRequest } from "@sih/shared";

function findLikelyTarget(payload: PlanRequest): string | undefined {
  const ordered = payload.context.elements
    .filter((element) => element.sensitivity === "public")
    .sort((a, b) => {
      const score = (el: (typeof ordered)[number]) =>
        (el.role.includes("button") ? 4 : 0) + (el.role.includes("a") ? 3 : 0) + (el.text.length > 0 ? 1 : 0);
      return score(b) - score(a);
    });

  return ordered[0]?.id;
}

export function buildPlan(payload: PlanRequest, forceConsent: boolean): ActionPlan {
  const targetElementId = findLikelyTarget(payload);

  const actions: ActionPlan["actions"] = [
    {
      id: "action_wait_1",
      type: "WAIT",
      reason: "Analyze sanitized context and guardrail notes.",
      confidence: 0.96,
      riskLevel: "low",
    },
  ];

  if (targetElementId) {
    actions.push({
      id: "action_click_1",
      type: "CLICK",
      targetElementId,
      reason: "Top-ranked public target selected from sanitized DOM context.",
      confidence: 0.74,
      riskLevel: "medium",
    });
  } else {
    actions.push({
      id: "action_confirm_1",
      type: "CONFIRM_REQUIRED",
      reason: "No reliable low-risk target found in sanitized context.",
      confidence: 0.5,
      riskLevel: "high",
    });
  }

  return {
    planId: crypto.randomUUID(),
    taskSummary: `Assist user goal: ${payload.userGoal}`,
    generatedAt: new Date().toISOString(),
    actions,
    requiresUserConsent: forceConsent || actions.some((action) => action.riskLevel !== "low"),
    guardrailNotes: [
      "Planner received sanitized-only context.",
      "Medium/high-risk actions are gated by local consent manager.",
    ],
  };
}
