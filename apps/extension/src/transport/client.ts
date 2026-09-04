import {
  PlanRequest,
  PlanResponse,
  SanitizedContext,
  enforceTransportPolicy,
} from "@sih/shared";

export async function requestActionPlan(
  serverUrl: string,
  userGoal: string,
  context: SanitizedContext,
): Promise<PlanResponse> {
  const policyContext = enforceTransportPolicy(context);
  const payload: PlanRequest = { userGoal, context: policyContext };

  const response = await fetch(`${serverUrl}/api/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Planner failed with status ${response.status}`);
  }

  return (await response.json()) as PlanResponse;
}
