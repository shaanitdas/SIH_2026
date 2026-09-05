import request from "supertest";
import express from "express";
import { describe, expect, it } from "vitest";
import { createApp, errorHandler } from "../src/app.js";

const app = createApp();

function validPayload() {
  return {
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
          text: "Submit Application",
          domPath: "html > body > form",
          bounds: { x: 0, y: 0, width: 120, height: 40, confidence: 1 },
          sensitivity: "public",
        },
      ],
      sensitiveEntities: [],
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
}

describe("GET /health", () => {
  it("reports healthy", async () => {
    const response = await request(app).get("/health").expect(200);
    expect(response.body).toMatchObject({ ok: true, service: "sih-privacy-planner-v3" });
  });
});

describe("POST /api/plan", () => {
  it("returns a deterministic plan for a sanitized context", async () => {
    const response = await request(app).post("/api/plan").send(validPayload()).expect(200);
    expect(response.body.plan.actions.length).toBeGreaterThan(1);
    expect(response.body.plan.actions[0]).toHaveProperty("type");
    expect(typeof response.body.plan.requiresUserConsent).toBe("boolean");
    expect(response.body.plan.guardrailNotes).toContain(
      "Planner received sanitized-only context.",
    );
  });

  it("echoes server-side privacy probe confirmations", async () => {
    const response = await request(app).post("/api/plan").send(validPayload()).expect(200);
    expect(response.body.serverNotes.join(" ")).toContain("Private field probe: clean");
  });

  it("rejects matchText smuggled into sensitive entities", async () => {
    const payload = validPayload();
    payload.context.sensitiveEntities = [
      {
        id: "ent_1",
        elementId: "el_1",
        type: "PAN",
        confidence: 0.95,
        source: "regex",
        token: "<PAN_1>",
        matchText: "ABCDE1234F",
      },
    ];
    const response = await request(app).post("/api/plan").send(payload);
    expect(response.status).toBe(400);
  });

  it("rejects rawValue in sensitive entities", async () => {
    const payload = validPayload();
    payload.context.sensitiveEntities = [
      {
        id: "ent_1",
        elementId: "el_1",
        type: "PAN",
        confidence: 0.95,
        source: "regex",
        token: "<PAN_1>",
        rawValue: "ABCDE1234F",
      },
    ];
    const response = await request(app).post("/api/plan").send(payload);
    expect(response.status).toBe(400);
  });

  it("rejects an untyped tokenMap on the wire", async () => {
    const payload = validPayload();
    (payload as any).context.tokenMap = { "<PAN_1>": "PAN" };
    const response = await request(app).post("/api/plan").send(payload);
    expect(response.status).toBe(400);
  });

  it("rejects malformed payloads with a flattened error", async () => {
    const response = await request(app)
      .post("/api/plan")
      .send({ userGoal: "missing context" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });
});

describe("error handler", () => {
  it("returns a generic 500 without leaking internals", async () => {
    const throwingApp = express();
    throwingApp.get("/boom", () => {
      throw new Error("secret internal detail");
    });
    throwingApp.use(errorHandler);

    const response = await request(throwingApp).get("/boom").expect(500);
    expect(response.body).toEqual({ error: "Internal server error." });
    expect(JSON.stringify(response.body)).not.toContain("secret internal detail");
  });
});