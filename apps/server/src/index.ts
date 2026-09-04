import cors from "cors";
import express from "express";
import { z } from "zod";
import { PlanRequest, PlanResponse } from "@sih/shared";
import { buildPlan } from "./planner/buildPlan.js";
import { shouldForceConsent } from "./security/serverPolicy.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const planRequestSchema = z.object({
  userGoal: z.string().min(3),
  context: z.object({
    sessionId: z.string(),
    pageUrl: z.string(),
    pageTitle: z.string(),
    timestamp: z.string(),
    elements: z.array(z.any()).max(250),
    sensitiveEntities: z.array(z.any()).max(220),
    redactedRegions: z.array(z.any()).max(220),
    tokenMap: z.record(z.string(), z.string()),
    policyVersion: z.string(),
    privacyScore: z.number().min(0).max(1),
    detectionSummary: z.object({
      recallEstimate: z.number().min(0).max(1),
      precisionEstimate: z.number().min(0).max(1),
      uncertainCount: z.number().int().min(0),
    }),
    visionObservations: z.array(z.any()).max(80),
    selectedVisionModel: z
      .object({
        descriptor: z.object({
          id: z.string(),
          name: z.string(),
          family: z.enum(["mediapipe", "onnx", "transformers"]),
          task: z.enum(["face_detection", "ocr", "layout_detection"]),
        }),
        weightedScore: z.number().min(0).max(1),
        reasons: z.array(z.string()).max(10),
      })
      .optional(),
    modelSelectionTrace: z
      .object({
        shortlist: z.array(z.object({ modelId: z.string(), score: z.number() })).max(5),
        dominantBlindSpot: z.enum(["canvas", "video", "iframe", "none"]),
        selectedModelId: z.string(),
      })
      .optional(),
    securitySignals: z.array(z.any()).max(80),
    policyDecisions: z.array(z.any()).max(40),
    runtimeProfile: z.object({
      executionMode: z.enum(["webgpu", "wasm", "cpu"]),
      profileTier: z.enum(["lite", "balanced", "performance"]),
      hardwareConcurrency: z.number().int().min(1),
      deviceMemoryGB: z.number().optional(),
    }),
    metrics: z
      .object({
        visualContextAccuracy: z.number().min(0).max(1),
        piiRecallPrecision: z.number().min(0).max(1),
        redactionPrecision: z.number().min(0).max(1),
        resourceUtilization: z.number().min(0).max(1),
        endToEndLatency: z.number().min(0).max(1),
        weightedOverall: z.number().min(0).max(1),
      })
      .optional(),
  }),
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "sih-privacy-planner-v2" });
});

app.post("/api/plan", (req, res) => {
  const parsed = planRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const payload = parsed.data as PlanRequest;
  const consent = shouldForceConsent(payload);
  const plan = buildPlan(payload, consent.force);

  const response: PlanResponse = {
    plan,
    serverNotes: [
      "Received sanitized context only.",
      consent.reason,
      `Runtime profile: ${payload.context.runtimeProfile.executionMode}/${payload.context.runtimeProfile.profileTier}`,
      `Vision model: ${payload.context.selectedVisionModel?.descriptor.id ?? "not-provided"}`,
    ],
  };

  return res.json(response);
});

const PORT = Number(process.env.PORT ?? 8080);
app.listen(PORT, () => {
  console.log(`Planner server listening at http://localhost:${PORT}`);
});
