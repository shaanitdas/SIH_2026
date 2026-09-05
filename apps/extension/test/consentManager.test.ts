import { describe, expect, it, vi } from "vitest";
import { ActionPlan, SanitizedContext } from "@sih/shared";
import { ConsentUi, evalConsentFlow, requestConsent } from "../src/runtime/consentManager.js";

function context(overrides: Partial<SanitizedContext> = {}): SanitizedContext {
  return {
    sessionId: "session-1",
    pageUrl: "https://example.com/",
    pageTitle: "Example",
    timestamp: "2026-01-01T00:00:00.000Z",
    elements: [],
    sensitiveEntities: [],
    redactedRegions: [],
    policyVersion: "v3.0.0",
    privacyScore: 0.9,
    detectionSummary: { recallEstimate: 0.9, precisionEstimate: 0.9, uncertainCount: 0 },
    visionObservations: [],
    securitySignals: [],
    policyDecisions: [],
    runtimeProfile: { executionMode: "cpu", profileTier: "lite", hardwareConcurrency: 4 },
    ...overrides,
  };
}

function plan(overrides: Partial<ActionPlan> = {}): ActionPlan {
  return {
    planId: "plan_1",
    taskSummary: "Task",
    generatedAt: new Date().toISOString(),
    actions: [
      {
        id: "a1",
        type: "CLICK",
        targetElementId: "el_1",
        reason: "proceed",
        confidence: 0.7,
        riskLevel: "low",
      },
    ],
    requiresUserConsent: false,
    guardrailNotes: [],
    ...overrides,
  };
}

describe("evalConsentFlow", () => {
  it("auto-approves low-risk plans in balanced mode", () => {
    const flow = evalConsentFlow(context(), plan());
    expect(flow.promptRequired).toBe(false);
    expect(flow.autoDecision?.approved).toBe(true);
  });

  it("requires prompt for medium-risk plan with server consent flag", () => {
    const flow = evalConsentFlow(
      context(),
      plan({ requiresUserConsent: true, actions: [{ ...plan().actions[0], riskLevel: "medium" }] }),
      "balanced",
    );
    expect(flow.promptRequired).toBe(true);
  });

  it("requires prompt on high-risk action", () => {
    const flow = evalConsentFlow(
      context(),
      plan({ actions: [{ ...plan().actions[0], riskLevel: "high" }] }),
      "balanced",
    );
    expect(flow.promptRequired).toBe(true);
  });

  it("requires prompt on high-confidence security signal", () => {
    const flow = evalConsentFlow(
      context({
        securitySignals: [
          { id: "sig_1", type: "PROMPT_INJECTION_TRAP", confidence: 0.9, description: "trap" },
        ],
      }),
      plan(),
    );
    expect(flow.promptRequired).toBe(true);
  });

  it("requires prompt when detections are uncertain", () => {
    const flow = evalConsentFlow(
      context({ detectionSummary: { recallEstimate: 0.5, precisionEstimate: 0.5, uncertainCount: 3 } }),
      plan(),
    );
    expect(flow.promptRequired).toBe(true);
  });

  it("strict mode prompts more aggressively than demo mode", () => {
    const medium = plan({ actions: [{ ...plan().actions[0], riskLevel: "medium" }] });
    expect(evalConsentFlow(context(), medium, "strict").promptRequired).toBe(true);
    expect(evalConsentFlow(context(), medium, "demo").promptRequired).toBe(false);
  });
});

describe("requestConsent", () => {
  it("returns the auto-approval without calling the UI", async () => {
    const ui: ConsentUi = { prompt: vi.fn(async () => ({ approved: true, reason: "user ok", requiredActions: [] })) };
    const decision = await requestConsent(plan(), context(), ui, "balanced");
    expect(decision.approved).toBe(true);
    expect(ui.prompt).not.toHaveBeenCalled();
  });

  it("calls the UI when a prompt is required", async () => {
    const ui: ConsentUi = { prompt: vi.fn(async () => ({ approved: false, reason: "user declined", requiredActions: [] })) };
    const decision = await requestConsent(
      plan({ actions: [{ ...plan().actions[0], riskLevel: "high" }] }),
      context(),
      ui,
      "balanced",
    );
    expect(ui.prompt).toHaveBeenCalledTimes(1);
    expect(decision.approved).toBe(false);
  });
});