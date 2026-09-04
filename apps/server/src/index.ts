import cors from "cors";
import express from "express";
import { z } from "zod";
import { ActionPlan, PlanRequest, PlanResponse } from "@sih/shared";

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
    sensitiveEntities: z.array(z.any()).max(200),
    redactedRegions: z.array(z.any()).max(200),
    policyVersion: z.string(),
    privacyScore: z.number(),
  }),
});

function buildPlan(payload: PlanRequest): ActionPlan {
  const firstSafeTarget = payload.context.elements.find(
    (el) => el.sensitivity === "public" && el.role !== "input",
  );

  return {
    planId: crypto.randomUUID(),
    taskSummary: `Assist user goal: ${payload.userGoal}`,
    generatedAt: new Date().toISOString(),
    requiresUserConsent: payload.context.privacyScore < 0.8,
    actions: [
      {
        id: "action_1",
        type: "WAIT",
        reason: "Analyze sanitized UI context",
        confidence: 0.95,
        riskLevel: "low",
      },
      {
        id: "action_2",
        type: firstSafeTarget ? "CLICK" : "CONFIRM_REQUIRED",
        targetElementId: firstSafeTarget?.id,
        reason: firstSafeTarget
          ? "First public actionable element selected"
          : "No confident public target found",
        confidence: firstSafeTarget ? 0.72 : 0.45,
        riskLevel: firstSafeTarget ? "medium" : "high",
      },
    ],
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "sih-privacy-planner" });
});

app.post("/api/plan", (req, res) => {
  const parsed = planRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const payload = parsed.data as PlanRequest;
  const plan = buildPlan(payload);

  const response: PlanResponse = {
    plan,
    serverNotes: [
      "Received sanitized context only",
      "High-risk actions require local consent gate",
    ],
  };

  return res.json(response);
});

const PORT = Number(process.env.PORT ?? 8080);
app.listen(PORT, () => {
  console.log(`Planner server listening at http://localhost:${PORT}`);
});
