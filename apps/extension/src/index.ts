import { SanitizedContext } from "@sih/shared";
import { extractVisibleDom } from "./pipeline/domExtractor.js";
import { detectPii } from "./privacy/piiDetector.js";
import { redactElements } from "./privacy/redactor.js";
import { validatePlan } from "./runtime/actionGuardian.js";
import { requestActionPlan } from "./transport/client.js";
import { logPrivacyLedger } from "./ui/privacyLedger.js";

const SERVER_URL = "http://localhost:8080";

function buildContext(): SanitizedContext {
  const elements = extractVisibleDom();
  const sensitiveEntities = detectPii(elements);
  const redactedElements = redactElements(elements, sensitiveEntities);

  return {
    sessionId: crypto.randomUUID(),
    pageUrl: window.location.href,
    pageTitle: document.title,
    timestamp: new Date().toISOString(),
    elements: redactedElements,
    sensitiveEntities,
    redactedRegions: redactedElements
      .filter((el) => el.sensitivity !== "public")
      .map((el) => el.bounds),
    policyVersion: "v1.0.0",
    privacyScore: Math.max(0, 1 - sensitiveEntities.length / Math.max(elements.length, 1)),
  };
}

export async function runAgentCycle(userGoal: string): Promise<void> {
  const context = buildContext();
  logPrivacyLedger(context);

  const response = await requestActionPlan(SERVER_URL, userGoal, context);
  const validatedPlan = validatePlan(response.plan);

  console.info("[agent-plan]", validatedPlan);
}
