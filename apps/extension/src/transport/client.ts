import {
  PlanRequest,
  PlanResponse,
  SanitizedContext,
  enforceTransportPolicy,
} from "@sih/shared";
import { minimizePayload } from "./payloadMinimizer.js";

const REQUEST_TIMEOUT_MS = 4500;

export async function requestActionPlan(
  serverUrl: string,
  userGoal: string,
  context: SanitizedContext,
): Promise<PlanResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const policyContext = enforceTransportPolicy(context);
    const compactContext = minimizePayload(policyContext);
    const payload: PlanRequest = { userGoal, context: compactContext };

    const response = await fetch(`${serverUrl}/api/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Planner failed with status ${response.status}`);
    }

    return (await response.json()) as PlanResponse;
  } finally {
    clearTimeout(timeout);
  }
}
