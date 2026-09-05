import { describe, expect, test } from "vitest";
import { performance } from "node:perf_hooks";
import request from "supertest";
import { createApp } from "../src/app.js";

const app = createApp();

const VALID_PAYLOAD = {
  userGoal: "Fill the application and submit",
  context: {
    sessionId: "session-7f3a",
    pageUrl: "https://bank.example.com/apply?loan=12345",
    pageTitle: "Loan Application",
    timestamp: "2026-01-01T00:00:00.000Z",
    elements: [
      {
        id: "el_1",
        agentId: "agent-0001",
        role: "button",
        nodeName: "button",
        text: "First name",
        domPath: "html > body > form",
        bounds: { x: 0, y: 0, width: 120, height: 40, confidence: 1 },
        sensitivity: "public",
      },
      {
        id: "el_2",
        agentId: "agent-0002",
        role: "input",
        nodeName: "input",
        text: "Aadhaar",
        domPath: "html > body > form",
        bounds: { x: 0, y: 40, width: 120, height: 40, confidence: 1 },
        sensitivity: "sensitive",
      },
      {
        id: "el_3",
        agentId: "agent-0003",
        role: "button",
        nodeName: "button",
        text: "Submit",
        domPath: "html > body > form",
        bounds: { x: 0, y: 80, width: 120, height: 40, confidence: 1 },
        sensitivity: "public",
      },
    ],
    sensitiveEntities: [
      {
        id: "ent_1",
        elementId: "el_2",
        type: "AADHAAR",
        confidence: 0.94,
        source: "regex",
        token: "<AADHAAR_1>",
      },
    ],
    redactedRegions: [],
    policyVersion: "v3.0.0",
    privacyScore: 0.92,
    detectionSummary: { recallEstimate: 0.9, precisionEstimate: 0.94, uncertainCount: 0 },
    visionObservations: [],
    securitySignals: [],
    policyDecisions: [],
    runtimeProfile: { executionMode: "cpu", profileTier: "lite", hardwareConcurrency: 8 },
  },
};

async function measureAsync(iterations: number, fn: () => Promise<void>): Promise<number> {
  const started = performance.now();
  for (let iteration = 0; iteration < iterations; iteration += 1) await fn();
  const elapsedMs = performance.now() - started;
  return Math.round((iterations / elapsedMs) * 1000);
}

describe("planner API latency", () => {
  test("POST /api/plan deterministic (req/sec)", async () => {
    await request(app).post("/api/plan").send(VALID_PAYLOAD).expect(200);
    const reqPerSec = await measureAsync(20, async () => {
      const response = await request(app).post("/api/plan").send(VALID_PAYLOAD).expect(200);
      expect(response.body.plan.actions.length).toBeGreaterThan(1);
    });
    console.log(`[bench] POST /api/plan: ${reqPerSec} req/sec`);
    expect(reqPerSec).toBeGreaterThan(30);
  });
});