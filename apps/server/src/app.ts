import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { PlanRequest, PlanResponse } from "@sih/shared";
import { planRequestSchema } from "./schema.js";
import { buildPlan } from "./planner/buildPlan.js";
import { buildPlanWithLlm, llmConfigured } from "./planner/llmPlanner.js";
import { shouldForceConsent } from "./security/serverPolicy.js";

export interface CreateAppOptions {
  logging?: boolean;
}

const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 120);
const TRUST_PROXY = process.env.TRUST_PROXY === "true" || process.env.TRUST_PROXY === "1";

function accessLogMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = performance.now();
    res.on("finish", () => {
      const ms = (performance.now() - startedAt).toFixed(1);
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "info",
          type: "access",
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Number(ms),
          ip: req.ip,
        }),
      );
    });
    next();
  };
}

function createRateLimiter() {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_MAX) {
      res.status(429).json({ error: "Rate limit exceeded." });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const message = err instanceof Error ? err.message : String(err);
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      type: "error",
      method: req.method,
      path: req.originalUrl,
      message,
    }),
  );
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error." });
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();
  if (TRUST_PROXY) app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: CORS_ORIGIN }));
  app.use(express.json({ limit: "1mb" }));
  if (options.logging) app.use(accessLogMiddleware());
  app.use(createRateLimiter());
  app.disable("x-powered-by");

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "sih-privacy-planner-v3" });
  });

  app.post("/api/plan", async (req, res) => {
    const parsed = planRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const payload = parsed.data as PlanRequest;

    const rawFieldHits = /matchText|rawValue|tokenMap/.exec(
      JSON.stringify(payload.context.sensitiveEntities),
    );
    if (rawFieldHits) {
      return res.status(400).json({
        error: "Private field leaked into transport contract and was rejected server-side.",
      });
    }

    const consent = shouldForceConsent(payload);
    const llmPlan = await buildPlanWithLlm(payload);
    const plan = llmPlan ?? buildPlan(payload, consent.force);

    const response: PlanResponse = {
      plan,
      serverNotes: [
        "Received sanitized context only.", 
        `Private field probe: ${rawFieldHits ? "PRESENT (blocked)" : "clean"}.`,
        `Planner source: ${llmPlan ? "llm" : "deterministic"}${llmConfigured() ? " (LLM mode)" : ""}.`,
        consent.reason,
        `Session ${payload.context.sessionId.slice(0, 8)}; ${payload.context.elements.length} elements; ${payload.context.sensitiveEntities.length} typed tokens.`,
        `Vision model: ${payload.context.selectedVisionModel?.descriptor.id ?? "not-provided"}.`,
      ],
    };

    return res.json(response);
  });

  app.use(errorHandler);

  return app;
}