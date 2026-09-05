import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionPlan, SanitizedContext } from "@sih/shared";
import { executePlan } from "../src/runtime/actionExecutor.js";

function baseContext(): SanitizedContext {
  return {
    sessionId: "session-1",
    pageUrl: "https://example.com/",
    pageTitle: "Example",
    timestamp: new Date().toISOString(),
    elements: [],
    sensitiveEntities: [],
    redactedRegions: [],
    policyVersion: "v3.0.0",
    privacyScore: 1,
    detectionSummary: { recallEstimate: 1, precisionEstimate: 1, uncertainCount: 0 },
    visionObservations: [],
    securitySignals: [],
    policyDecisions: [],
    runtimeProfile: { executionMode: "cpu", profileTier: "lite", hardwareConcurrency: 4 },
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("executePlan CLICK", () => {
  it("clicks a resolved target", () => {
    document.body.innerHTML = `<button id="real" data-agent-id="agent-1">Go</button>`;
    const context: SanitizedContext = {
      ...baseContext(),
      elements: [
        {
          id: "el_1",
          agentId: "agent-1",
          role: "button",
          nodeName: "BUTTON",
          text: "Go",
          domPath: "html > body",
          bounds: { x: 0, y: 0, width: 10, height: 10, confidence: 1 },
          sensitivity: "public",
        },
      ],
    };
    const clicked = vi.fn();
    document.getElementById("real")!.addEventListener("click", clicked);

    const plan: ActionPlan = {
      planId: "p",
      taskSummary: "t",
      generatedAt: new Date().toISOString(),
      actions: [{ id: "a1", type: "CLICK", targetElementId: "el_1", reason: "r", confidence: 0.9, riskLevel: "low" }],
      requiresUserConsent: false,
      guardrailNotes: [],
    };

    const results = executePlan(plan, context);
    expect(results[0].status).toBe("success");
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("fails when the DOM target is missing", () => {
    const context: SanitizedContext = baseContext();
    const plan: ActionPlan = {
      planId: "p",
      taskSummary: "t",
      generatedAt: new Date().toISOString(),
      actions: [{ id: "a1", type: "CLICK", targetElementId: "ghost", reason: "r", confidence: 0.9, riskLevel: "low" }],
      requiresUserConsent: false,
      guardrailNotes: [],
    };
    const results = executePlan(plan, context);
    expect(results[0].status).toBe("failed");
  });
});

describe("executePlan TYPE", () => {
  it("resolves a local token against the raw value map", () => {
    document.body.innerHTML = `<input id="real-input" data-agent-id="agent-2" />`;
    const context: SanitizedContext = {
      ...baseContext(),
      elements: [
        {
          id: "el_2",
          agentId: "agent-2",
          role: "input",
          nodeName: "INPUT",
          text: "Password",
          domPath: "html > body",
          bounds: { x: 0, y: 0, width: 10, height: 10, confidence: 1 },
          sensitivity: "restricted",
          redactedText: "<PASSWORD_1>",
        },
      ],
      sensitiveEntities: [
        {
          id: "ent_1",
          elementId: "el_2",
          type: "PASSWORD",
          confidence: 0.99,
          source: "structural",
          token: "<PASSWORD_1>",
          rawValue: "s3cret",
          reasons: [],
        },
      ],
    };
    const input = document.getElementById("real-input")! as HTMLInputElement;
    const onInput = vi.fn();
    const onChange = vi.fn();
    input.addEventListener("input", onInput);
    input.addEventListener("change", onChange);

    const plan: ActionPlan = {
      planId: "p",
      taskSummary: "t",
      generatedAt: new Date().toISOString(),
      actions: [
        { id: "a1", type: "TYPE", targetElementId: "el_2", value: "<PASSWORD_1>", reason: "r", confidence: 0.9, riskLevel: "high" },
      ],
      requiresUserConsent: true,
      guardrailNotes: [],
    };

    const results = executePlan(plan, context);
    expect(results[0].status).toBe("success");
    expect(input.value).toBe("s3cret");
    expect(onInput).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();
  });

  it("refuses to type unresolved tokens", () => {
    document.body.innerHTML = `<input id="real-input" data-agent-id="agent-3" />`;
    const context: SanitizedContext = {
      ...baseContext(),
      elements: [
        {
          id: "el_3",
          agentId: "agent-3",
          role: "input",
          nodeName: "INPUT",
          text: "Password",
          domPath: "html > body",
          bounds: { x: 0, y: 0, width: 10, height: 10, confidence: 1 },
          sensitivity: "restricted",
        },
      ],
    };
    const plan: ActionPlan = {
      planId: "p",
      taskSummary: "t",
      generatedAt: new Date().toISOString(),
      actions: [
        { id: "a1", type: "TYPE", targetElementId: "el_3", value: "<PASSWORD_1>", reason: "r", confidence: 0.9, riskLevel: "high" },
      ],
      requiresUserConsent: true,
      guardrailNotes: [],
    };
    const results = executePlan(plan, context);
    expect(results[0].status).toBe("failed");
  });
});

describe("executePlan non-interactive actions", () => {
  it("acknowledges WAIT", () => {
    const plan: ActionPlan = {
      planId: "p",
      taskSummary: "t",
      generatedAt: new Date().toISOString(),
      actions: [{ id: "a1", type: "WAIT", reason: "r", confidence: 1, riskLevel: "low" }],
      requiresUserConsent: false,
      guardrailNotes: [],
    };
    expect(executePlan(plan, baseContext())[0].status).toBe("success");
  });

  it("skips CONFIRM_REQUIRED actions in autonomous mode", () => {
    const plan: ActionPlan = {
      planId: "p",
      taskSummary: "t",
      generatedAt: new Date().toISOString(),
      actions: [{ id: "a1", type: "CONFIRM_REQUIRED", reason: "r", confidence: 1, riskLevel: "medium" }],
      requiresUserConsent: true,
      guardrailNotes: [],
    };
    expect(executePlan(plan, baseContext())[0].status).toBe("skipped");
  });
});