import { describe, expect, it } from "vitest";
import {
  assertNoRawSensitiveValues,
  enforceTransportPolicy,
  findSensitiveValuesInText,
  sanitizePageTitle,
  sanitizePageUrl,
  SensitiveEntity,
  SanitizedContext,
  UiElement,
} from "../src/index.js";

const ELEMENTS: UiElement[] = [
  {
    id: "el_1",
    agentId: "81416666-6666-6667-8aab-003344556677",
    role: "button",
    text: "Submit Application",
    domPath: "html > body > form",
    bounds: { x: 0, y: 0, width: 100, height: 40, confidence: 1 },
    sensitivity: "public",
  },
  {
    id: "el_2",
    agentId: "23674946-8237-4ec7-9e3a-118899002211",
    role: "input",
    text: "Aadhaar: 2345 6789 0123",
    placeholder: "Enter Aadhaar",
    valueHint: "2345 6789 0123",
    domPath: "html > body > form",
    bounds: { x: 0, y: 40, width: 120, height: 32, confidence: 1 },
    sensitivity: "restricted",
    redactedText: "Aadhaar: <AADHAAR_1>",
    attributes: { name: "aadhaar" },
  },
];

const ENTITIES: SensitiveEntity[] = [
  {
    id: "ent_1",
    elementId: "el_2",
    type: "AADHAAR",
    confidence: 0.94,
    source: "regex",
    token: "<AADHAAR_1>",
    reasons: ["Aadhaar-like format"],
    matchText: "2345 6789 0123",
    rawValue: "234567890123",
  },
];

function baseContext(): SanitizedContext {
  return {
    sessionId: "session-1",
    pageUrl: "https://bank.example.com/user/rahul/account/12345?email=rahul%40gmail.com",
    pageTitle: "Mr. Rahul Sharma – Medical Reports",
    timestamp: "2026-01-01T00:00:00.000Z",
    elements: ELEMENTS,
    sensitiveEntities: ENTITIES,
    redactedRegions: [{ x: 0, y: 40, width: 120, height: 32, confidence: 1 }],
    tokenMap: { "<AADHAAR_1>": "AADHAAR" },
    policyVersion: "v3.0.0",
    privacyScore: 0.9,
    detectionSummary: { recallEstimate: 0.9, precisionEstimate: 0.9, uncertainCount: 0 },
    visionObservations: [],
    selectedVisionModel: {
      descriptor: {
        id: "paddleocr-mobile",
        name: "PaddleOCR Mobile",
        family: "onnx",
        task: "ocr",
        approxSizeMB: 18,
        expectedLatencyMs: { webgpu: 12, wasm: 40, cpu: 90 },
        metricFit: {
          visualContextAccuracy: 0.9,
          piiRecallPrecision: 0.88,
          redactionPrecision: 0.8,
          resourceUtilization: 0.7,
          endToEndLatency: 0.6,
        },
        recommendedFor: ["performance"],
        source: "builtin",
        notes: ["small"],
      },
      weightedScore: 0.86,
      reasons: ["best rubric fit"],
    },
    securitySignals: [],
    policyDecisions: [],
    runtimeProfile: { executionMode: "cpu", profileTier: "lite", hardwareConcurrency: 4 },
  };
}

describe("sanitizePageUrl", () => {
  it("parameterizes path segments and query values", () => {
    expect(sanitizePageUrl("https://bank.example.com/user/rahul/account/12345?email=rahul%40gmail.com&lang=en")).toBe(
      "https://bank.example.com/<seg>/<seg>/<seg>/<seg>?email=<value>&lang=<value>",
    );
  });

  it("handles origin-only URLs", () => {
    expect(sanitizePageUrl("https://example.com")).toBe("https://example.com/");
  });

  it("returns a safe placeholder for malformed URLs", () => {
    expect(sanitizePageUrl("not a url")).toBe("<unsafe-url>");
  });
});

describe("sanitizePageTitle", () => {
  it("truncates long titles", () => {
    const longTitle = "R".repeat(200);
    expect(sanitizePageTitle(longTitle)).toHaveLength(120);
  });

  it("handles empty titles", () => {
    expect(sanitizePageTitle("   ")).toBe("<untitled>");
  });
});

describe("enforceTransportPolicy", () => {
  it("strips matchText, rawValue, valueHint, attributes and tokenMap from the network payload", () => {
    const outbound = enforceTransportPolicy(baseContext());

    expect(outbound.sensitiveEntities[0].matchText).toBeUndefined();
    expect(outbound.sensitiveEntities[0].rawValue).toBeUndefined();
    expect(outbound.tokenMap).toBeUndefined();
    expect(outbound.elements[1].valueHint).toBeUndefined();
    expect(outbound.elements[1].attributes).toBeUndefined();
    expect(outbound.elements[0].text).toBe("Submit Application");
    expect(outbound.elements[0].agentId).toBeUndefined();
  });

  it("restricts the vision model descriptor to the wire-safe subset", () => {
    const outbound = enforceTransportPolicy(baseContext());
    expect(outbound.selectedVisionModel?.descriptor).toEqual({
      id: "paddleocr-mobile",
      name: "PaddleOCR Mobile",
      family: "onnx",
      task: "ocr",
    });
    expect(outbound.selectedVisionModel?.descriptor.approxSizeMB).toBeUndefined();
    expect(outbound.selectedVisionModel?.descriptor.metricFit).toBeUndefined();
    expect(outbound.selectedVisionModel?.descriptor.expectedLatencyMs).toBeUndefined();
    expect(outbound.selectedVisionModel?.descriptor.recommendedFor).toBeUndefined();
    expect(outbound.selectedVisionModel?.descriptor.source).toBeUndefined();
    expect(outbound.selectedVisionModel?.descriptor.notes).toBeUndefined();
  });

  it("never leaks a raw sensitive value or PII-looking identifier in serialized JSON", () => {
    const outbound = enforceTransportPolicy(baseContext());
    const serialized = JSON.stringify(outbound);
    expect(serialized).not.toContain("234567890123");
    expect(serialized).not.toContain("rahul@gmail.com");
    expect(serialized).not.toContain("Rahul Sharma");
    // UUID-shaped identifiers (session/agent ids) must not survive transport:
    // they would otherwise trip the fail-closed PII firewall as card numbers.
    expect(serialized).not.toContain("81416666-6666-6667");
    expect(outbound.sessionId).not.toMatch(/^[0-9a-f-]{36}$/);
  });

  it("marks sensitive element text as redacted before transport", () => {
    const outbound = enforceTransportPolicy(baseContext());
    expect(outbound.elements[1].text).toContain("<AADHAAR_1>");
  });
});

describe("findSensitiveValuesInText", () => {
  it("detects an Aadhaar and PAN", () => {
    const matches = findSensitiveValuesInText("Aadhaar 2345 6789 0123 and PAN ABCDE1234F");
    const types = matches.map((match) => match.type);
    expect(types).toContain("AADHAAR");
    expect(types).toContain("PAN");
  });

  it("returns no matches for benign text", () => {
    expect(findSensitiveValuesInText("Click here to continue")).toEqual([]);
  });

  it("does not treat decimal float artifacts as card numbers", () => {
    const matches = findSensitiveValuesInText(
      "metrics: 0.8141666666666667, 0.7833333333333333 (computed on device);",
    );
    expect(matches).toEqual([]);
  });

  it("still flags a genuine 16-digit card number", () => {
    const matches = findSensitiveValuesInText("Card: 4111 1111 1111 1111");
    expect(matches.some((match) => match.type === "CARD_NUMBER")).toBe(true);
  });
});

describe("assertNoRawSensitiveValues", () => {
  it("passes clean payloads", () => {
    expect(() => assertNoRawSensitiveValues({ hello: "world" })).not.toThrow();
  });

  it("throws when a raw PII value is present", () => {
    expect(() =>
      assertNoRawSensitiveValues({ pan: "ABCDE1234F" }),
    ).toThrow(/PrivacyFirewallError/);
  });
});