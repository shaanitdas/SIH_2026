import { beforeEach, describe, expect, it } from "vitest";
import { SanitizedContext } from "@sih/shared";
import { extractVisibleDom, resolveDomTarget } from "../src/pipeline/domExtractor.js";

describe("extractVisibleDom", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="submit-btn">Submit</button>
      <input id="name-input" type="text" placeholder="Name">
      <input id="pass-input" type="password" placeholder="Password">
      <div style="display:none" id="hidden">Shhh <span>secret</span></div>
    `;
  });

  it("annotates interactive elements with agent ids", () => {
    const elements = extractVisibleDom(50);
    expect(elements.length).toBeGreaterThanOrEqual(3);
    expect(elements.every((element) => typeof element.agentId === "string" && element.agentId.length > 10)).toBe(true);
    const submit = elements.find((element) => element.text?.includes("Submit"));
    expect(submit?.role).toBe("button");
    expect(submit?.nodeName).toBe("button");
  });

  it("excludes non-interactive standalone text nodes", () => {
    const elements = extractVisibleDom(50);
    expect(elements.some((element) => element.role === "group" && element.text === "Shhh secret")).toBe(false);
  });
});

describe("resolveDomTarget", () => {
  beforeEach(() => {
    document.body.innerHTML = `<button id="b1" data-agent-id="agent-abc">Go</button>`;
  });

  it("resolves by agent id", () => {
    const element = extractVisibleDom(10).find((entry) => entry.text?.includes("Go"));
    expect(element).toBeDefined();
    const node = resolveDomTarget(element!);
    expect(node?.id).toBe("b1");
  });

  it("falls back to query selectors and returns null when nothing matches", () => {
    document.body.innerHTML = "";
    expect(resolveDomTarget({ id: "el_x", agentId: "ghost", role: "button", text: "", domPath: "html > body", bounds: { x: 0, y: 0, width: 10, height: 10, confidence: 1 }, sensitivity: "public" })).toBeNull();
  });
});

describe("extractVisibleDom round trip", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <input id="acc" type="text" placeholder="Aadhaar">
        <button id="send">Send</button>
      </form>
    `;
  });

  it("produces a context shape that survives transport enforcement", () => {
    const elements = extractVisibleDom(50);
    const context: SanitizedContext = {
      sessionId: "s",
      pageUrl: "https://example.com/",
      pageTitle: "Example",
      timestamp: new Date().toISOString(),
      elements,
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
    expect(context.elements.length).toBeGreaterThanOrEqual(2);
    expect(() => JSON.stringify(context)).not.toThrow();
  });
});