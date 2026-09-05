import { ActionPlan, PlanRequest, PlanResponse, SanitizedContext } from "@sih/shared";
import { assertTransportIsSafe } from "../privacy/networkFirewall.js";
import { minimizePayload } from "./payloadMinimizer.js";

const REQUEST_TIMEOUT_MS = 4500;
const MAX_RETRIES = 2;

export class PlannerUnavailableError extends Error {
  constructor(message = "Planner server unavailable") {
    super(message);
    this.name = "PlannerUnavailableError";
  }
}

export function buildLocalFallbackPlan(context: SanitizedContext): ActionPlan {
  const target = context.elements.find(
    (element) => element.sensitivity === "public" && element.role.includes("button"),
  );
  return {
    planId: crypto.randomUUID(),
    taskSummary: "Local fallback: no server reachable, suggesting a safe public interaction.",
    generatedAt: new Date().toISOString(),
    actions: target
      ? [
          {
            id: "action_local_click_1",
            type: "CLICK",
            targetElementId: target.id,
            reason: "Local fallback click on a public button.",
            confidence: 0.6,
            riskLevel: "medium",
          },
        ]
      : [],
    requiresUserConsent: true,
    guardrailNotes: ["Server unreachable; plan generated locally with consent required."],
  };
}

async function postPlan(
  serverUrl: string,
  payload: PlanRequest,
  requestId: string,
): Promise<PlanResponse> {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set("X-Request-Id", requestId);
  headers.set("X-Client-Version", "1.0.0");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${serverUrl}/api/plan`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (response.status === 400) {
      const body = await response.json().catch(() => undefined);
      throw new Error(`Planner rejected payload: ${JSON.stringify(body)}`);
    }

    if (!response.ok) {
      throw new Error(`Planner failed with status ${response.status}`);
    }

    return (await response.json()) as PlanResponse;
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestActionPlan(
  serverUrl: string,
  userGoal: string,
  context: SanitizedContext,
): Promise<PlanResponse> {
  const requestId = crypto.randomUUID();
  const transportContext = assertTransportIsSafe(context);
  const compactContext = minimizePayload(transportContext);
  const payload: PlanRequest = { userGoal, context: compactContext };

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= MAX_RETRIES) {
    try {
      return await postPlan(serverUrl, payload, requestId);
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (error instanceof Error && error.name === "AbortError") break;
    }
  }

  throw new PlannerUnavailableError(
    lastError instanceof Error ? lastError.message : "Planner request failed",
  );
}