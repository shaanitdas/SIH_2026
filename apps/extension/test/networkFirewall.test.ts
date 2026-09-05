import { describe, expect, it } from "vitest";
import { enforceTransportPolicy, SanitizedContext, TransportContext } from "@sih/shared";
import { assertTransportIsSafe, runNetworkFirewall } from "../src/privacy/networkFirewall.js";

function rawContext(): SanitizedContext {
  return {
    sessionId: "session-1",
    pageUrl: "https://bank.example.com/account?id=12345",
    pageTitle: "Account Portal",
    timestamp: "2026-01-01T00:00:00.000Z",
    elements: [
      {
        id: "el_1",
        role: "input",
        text: "PAN ABCDE1234F",
        domPath: "html > body",
        bounds: { x: 0, y: 0, width: 10, height: 10, confidence: 1 },
        sensitivity: "public",
        valueHint: "ABCDE1234F",
        attributes: { name: "pan" },
      },
    ],
    sensitiveEntities: [
      {
        id: "ent_1",
        elementId: "el_1",
        type: "PAN",
        confidence: 0.95,
        source: "regex",
        token: "<PAN_1>",
        reasons: ["PAN-like format"],
        matchText: "ABCDE1234F",
        rawValue: "ABCDE1234F",
        bounds: { x: 0, y: 0, width: 60, height: 20, confidence: 0.95 },
      },
    ],
    redactedRegions: [{ x: 0, y: 0, width: 60, height: 20, confidence: 0.95 }],
    tokenMap: { "<PAN_1>": "PAN" },
    policyVersion: "v3.0.0",
    privacyScore: 0.8,
    detectionSummary: { recallEstimate: 0.9, precisionEstimate: 0.9, uncertainCount: 0 },
    visionObservations: [],
    securitySignals: [],
    policyDecisions: [],
    runtimeProfile: { executionMode: "cpu", profileTier: "lite", hardwareConcurrency: 4 },
  };
}

describe("runNetworkFirewall", () => {
  it("passes a sanitized outbound payload", () => {
    const outbound = enforceTransportPolicy(rawContext());
    const report = runNetworkFirewall(outbound);
    expect(report.pass).toBe(true);
    expect(report.checks.every((check) => check.ok)).toBe(true);
  });

  it("detects a private field smuggled into the transport contract", () => {
    const outbound = enforceTransportPolicy(rawContext());
    const tampered = {
      ...outbound,
      sensitiveEntities: [
        {
          ...outbound.sensitiveEntities[0],
          rawValue: "ABCDE1234F",
          matchText: "ABCDE1234F",
        },
      ],
    } as unknown as TransportContext;
    const report = runNetworkFirewall(tampered);
    expect(report.pass).toBe(false);
    expect(report.checks[0].ok).toBe(false);
  });

  it("fails the regex scan when a raw PAN value reaches the wire", () => {
    const outbound = enforceTransportPolicy(rawContext());
    const tampered = {
      ...outbound,
      pageTitle: "PAN ABCDE1234F leaked",
    } as TransportContext;
    const report = runNetworkFirewall(tampered);
    expect(report.pass).toBe(false);
  });
});

describe("assertTransportIsSafe", () => {
  it("returns the enforcing outbound contract", () => {
    const outbound = assertTransportIsSafe(rawContext());
    expect(outbound.tokenMap).toBeUndefined();
    expect(outbound.sensitiveEntities[0].rawValue).toBeUndefined();
  });
});