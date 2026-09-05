import { describe, expect, test } from "vitest";
import { performance } from "node:perf_hooks";
import {
  assertNoRawSensitiveValues,
  enforceTransportPolicy,
  findSensitiveValuesInText,
  SanitizedContext,
  SensitiveEntity,
  UiElement,
} from "../src/index.js";

const GROUND_TRUTH: Array<{ text: string; expected: string[] }> = [
  { text: "Aadhaar 2345 6789 0123 verified", expected: ["AADHAAR"] },
  { text: "PAN ABCDE1234F on file", expected: ["PAN"] },
  { text: "mail rahul@example.co.in", expected: ["EMAIL"] },
  { text: "call +91 98765 43210 or 91234 56789", expected: ["PHONE_IN"] },
  { text: "UPI rahul@okhdfc", expected: ["UPI"] },
  { text: "IFSC HDFC0001234", expected: ["IFSC"] },
  { text: "GSTIN 07AABCD1234F1Z5", expected: ["GSTIN"] },
  { text: "DOB 15-08-1990", expected: ["DOB"] },
  { text: "card 4532 1145 6742 7890", expected: ["CARD_NUMBER"] },
  { text: "click continue to verify account", expected: [] },
  { text: "submit the form without details", expected: [] },
  { text: "new feature landed in production today", expected: [] },
];

function groundTruthStats() {
  let truePositives = 0;
  let falsePositives = 0;
  let trueNegatives = 0;
  let falseNegatives = 0;

  for (const sample of GROUND_TRUTH) {
    const detected = new Set(findSensitiveValuesInText(sample.text).map((match) => match.type));
    const expected = new Set(sample.expected);

    for (const type of detected) {
      expected.has(type) ? (truePositives += 1) : (falsePositives += 1);
    }
    for (const type of expected) {
      if (!detected.has(type)) falseNegatives += 1;
    }
    if (sample.expected.length === 0 && detected.size === 0) trueNegatives += 1;
  }

  const precision = truePositives / Math.max(1, truePositives + falsePositives);
  const recall = truePositives / Math.max(1, truePositives + falseNegatives);
  return {
    precision: Number(precision.toFixed(3)),
    recall: Number(recall.toFixed(3)),
    truePositives,
    falsePositives,
    falseNegatives,
    trueNegatives,
    accuracy: Number(((truePositives + trueNegatives) / GROUND_TRUTH.length).toFixed(3)),
  };
}

function measure(iterations: number, fn: () => void): number {
  const started = performance.now();
  for (let iteration = 0; iteration < iterations; iteration += 1) fn();
  const elapsedMs = performance.now() - started;
  return Math.round((iterations / elapsedMs) * 1000);
}

const elements: UiElement[] = GROUND_TRUTH.slice(0, 9).map((sample, index) => ({
  id: `el_${index}`,
  role: "input",
  text: sample.text,
  domPath: "html > body",
  bounds: { x: 0, y: 0, width: 100, height: 30, confidence: 1 },
  sensitivity: "public",
}));

const entities: SensitiveEntity[] = [];
for (const element of elements) {
  for (const match of findSensitiveValuesInText(element.text)) {
    entities.push({
      id: `ent_${entities.length}`,
      elementId: element.id,
      type: match.type,
      confidence: match.confidence,
      source: "regex",
      token: `<${match.type}_${entities.length}>`,
      matchText: match.matchText,
      rawValue: match.matchText,
      reasons: [],
    });
  }
}

function buildContext(): SanitizedContext {
  return {
    sessionId: "bench-session",
    pageUrl: "https://bank.example.com/verify?id=99123&step=otp",
    pageTitle: "Verification",
    timestamp: new Date().toISOString(),
    elements,
    sensitiveEntities: entities,
    redactedRegions: [],
    policyVersion: "v3.0.0",
    privacyScore: 0.9,
    detectionSummary: { recallEstimate: 0.92, precisionEstimate: 0.93, uncertainCount: 0 },
    visionObservations: [],
    securitySignals: [],
    policyDecisions: [],
    runtimeProfile: { executionMode: "cpu", profileTier: "lite", hardwareConcurrency: 8 },
  };
}

describe("ground-truth privacy quality", () => {
  test("regex detector precision/recall vs ground truth", () => {
    const stats = groundTruthStats();
    console.log(`[bench] privacy: precision=${stats.precision} recall=${stats.recall} accuracy=${stats.accuracy}`);
    expect(stats.precision).toBeGreaterThan(0.9);
    expect(stats.recall).toBeGreaterThan(0.85);
    expect(stats.accuracy).toBeGreaterThan(0.9);
  });
});

describe("transport enforcement throughput", () => {
  test("enforceTransportPolicy (ops/sec)", () => {
    enforceTransportPolicy(buildContext());
    const opsPerSec = measure(300, () => {
      const outbound = enforceTransportPolicy(buildContext());
      expect(outbound.sensitiveEntities[0].matchText).toBeUndefined();
    });
    console.log(`[bench] enforceTransportPolicy: ${opsPerSec} ops/sec`);
    expect(opsPerSec).toBeGreaterThan(100);
  });
});

describe("leak-proof redaction", () => {
  test("no raw values survive serialization (ops/sec)", () => {
    enforceTransportPolicy(buildContext());
    const opsPerSec = measure(300, () => {
      const outbound = enforceTransportPolicy(buildContext());
      expect(() => assertNoRawSensitiveValues(outbound)).not.toThrow();
      expect(JSON.stringify(outbound)).not.toContain("2345 6789 0123");
    });
    console.log(`[bench] leak-proof serialization: ${opsPerSec} ops/sec`);
    expect(opsPerSec).toBeGreaterThan(50);
  });
});