import { ActionPlan, PlanRequest } from "@sih/shared";
import { actionPlanSchema } from "../schema.js";

const LLM_TIMEOUT_MS = 10_000;

export function llmConfigured(): boolean {
  return Boolean(process.env.PLANNER_API_KEY || process.env.OPENAI_API_KEY);
}

function compactContext(payload: PlanRequest): Record<string, unknown> {
  return {
    userGoal: payload.userGoal,
    pageUrl: payload.context.pageUrl,
    pageTitle: payload.context.pageTitle,
    elements: payload.context.elements.map((element) => ({
      id: element.id,
      role: element.role,
      label: element.accessibleName,
      text: element.sensitivity === "public" ? element.text : element.redactedText,
      sensitivity: element.sensitivity,
    })),
    entities: payload.context.sensitiveEntities.map((entity) => ({
      token: entity.token,
      type: entity.type,
      confidence: entity.confidence,
    })),
    securitySignals: payload.context.securitySignals.map((signal) => signal.type),
    privacyScore: payload.context.privacyScore,
  };
}

const SYSTEM_PROMPT = [
  "You are the planner for a privacy-preserving browser agent.",
  "You receive a goal and a sanitized page context. Raw PII is never shared with you.",
  "Return ONLY a JSON object matching this schema exactly:",
  JSON.stringify({
    planId: "uuid-like string",
    taskSummary: "short summary",
    actions: [
      {
        id: "action id",
        type: "CLICK | TYPE | SCROLL | WAIT | CONFIRM_REQUIRED",
        targetElementId: "one of the supplied element ids, required for CLICK/TYPE",
        value: "for TYPE only: static text or local <TOKEN> references, never raw PII",
        reason: "one sentence",
        confidence: "0..1",
        riskLevel: "low | medium | high",
      },
    ],
    requiresUserConsent: "true always for this milestone",
    generatedAt: "ISO date",
    guardrailNotes: ["note"],
  }),
  "Rules:",
  "- Only reference element ids that are present in the payload.",
  "- Never invent URLs, selectors, or JavaScript. Only the allowed action types.",
  "- Never fabricate secret values; TYPE may only use <TOKEN> placeholders.",
  "- Prefer low-risk actions; add CONFIRM_REQUIRED when a step needs the human.",
].join("\n");

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf("{"));
  return JSON.parse(candidate);
}

export async function buildPlanWithLlm(payload: PlanRequest): Promise<ActionPlan | null> {
  if (!llmConfigured()) return null;

  const baseUrl = (process.env.PLANNER_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const apiKey = (process.env.PLANNER_API_KEY ?? process.env.OPENAI_API_KEY) as string;
  const model = process.env.PLANNER_MODEL ?? "gpt-4o-mini";
  const context = compactContext(payload);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Plan these actions for the sanitized context:\n\n${JSON.stringify(context)}`,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const chat = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = chat.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = extractJson(content);
    const validated = actionPlanSchema.safeParse(parsed);
    if (!validated.success) return null;

    const elementIds = new Set(payload.context.elements.map((element) => element.id));
    const actions = validated.data.actions.filter((action) => {
      if (!action.targetElementId) return true;
      return elementIds.has(action.targetElementId);
    });

    return { ...validated.data, actions };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}