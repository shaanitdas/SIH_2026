import { z } from "zod";

export const boundingBoxSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number().min(0),
  height: z.number().min(0),
  confidence: z.number().min(0).max(1),
});

export const uiElementSchema = z.strictObject({
  id: z.string(),
  agentId: z.string().optional(),
  nodeName: z.string().optional(),
  role: z.string(),
  text: z.string(),
  placeholder: z.string().optional(),
  domPath: z.string(),
  bounds: boundingBoxSchema,
  sensitivity: z.enum(["public", "sensitive", "restricted"]),
  redactedText: z.string().optional(),
  accessibleName: z.string().optional(),
});

export const sanitizedSensitiveEntitySchema = z.strictObject({
  id: z.string(),
  elementId: z.string(),
  type: z.enum([
    "AADHAAR",
    "PAN",
    "UPI",
    "GSTIN",
    "PHONE_IN",
    "EMAIL",
    "PASSWORD",
    "FACE",
    "NAME",
    "ADDRESS",
    "ACCOUNT",
    "IFSC",
    "DOB",
    "CARD_NUMBER",
  ]),
  confidence: z.number().min(0).max(1),
  source: z.enum(["regex", "ner", "vision", "structural"]),
  token: z.string().regex(/^<[A-Z_]+_\d+>$/),
});

export const visionObservationSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(["canvas", "video", "iframe"]),
  bounds: boundingBoxSchema,
  sensitivityGuess: z.enum(["public", "sensitive", "restricted"]),
  confidence: z.number().min(0).max(1),
  notes: z.array(z.string()).max(20),
});

export const securitySignalSchema = z.strictObject({
  type: z.enum(["PROMPT_INJECTION", "MALICIOUS_INSTRUCTION", "UNKNOWN_AUTOMATION_TRAP"]),
  confidence: z.number().min(0).max(1),
  message: z.string(),
  elementId: z.string().optional(),
});

export const policyDecisionSchema = z.strictObject({
  policy: z.string(),
  status: z.enum(["pass", "warn", "block"]),
  reason: z.string(),
});

export const selectedVisionModelSchema = z.strictObject({
  descriptor: z.strictObject({
    id: z.string(),
    name: z.string(),
    family: z.enum(["mediapipe", "onnx", "transformers"]),
    task: z.enum(["face_detection", "ocr", "layout_detection"]),
  }),
  weightedScore: z.number().min(0).max(1),
  reasons: z.array(z.string()).max(10),
});

export const modelSelectionTraceSchema = z.strictObject({
  shortlist: z.array(z.strictObject({ modelId: z.string(), score: z.number() })).max(5),
  dominantBlindSpot: z.enum(["canvas", "video", "iframe", "none"]),
  selectedModelId: z.string(),
});

export const runtimeProfileSchema = z.strictObject({
  executionMode: z.enum(["webgpu", "wasm", "cpu"]),
  profileTier: z.enum(["lite", "balanced", "performance"]),
  hardwareConcurrency: z.number().int().min(1),
  deviceMemoryGB: z.number().optional(),
});

export const metricsSchema = z.strictObject({
  visualContextAccuracy: z.number().min(0).max(1),
  piiRecallPrecision: z.number().min(0).max(1),
  redactionPrecision: z.number().min(0).max(1),
  resourceUtilization: z.number().min(0).max(1),
  endToEndLatency: z.number().min(0).max(1),
  weightedOverall: z.number().min(0).max(1),
});

export const transportContextSchema = z.strictObject({
  sessionId: z.string(),
  pageUrl: z.string(),
  pageTitle: z.string(),
  timestamp: z.string(),
  elements: z.array(uiElementSchema).max(250),
  sensitiveEntities: z.array(sanitizedSensitiveEntitySchema).max(220),
  redactedRegions: z.array(boundingBoxSchema).max(220),
  policyVersion: z.string(),
  privacyScore: z.number().min(0).max(1),
  detectionSummary: z.strictObject({
    recallEstimate: z.number().min(0).max(1),
    precisionEstimate: z.number().min(0).max(1),
    uncertainCount: z.number().int().min(0),
  }),
  visionObservations: z.array(visionObservationSchema).max(80),
  selectedVisionModel: selectedVisionModelSchema.optional(),
  modelSelectionTrace: modelSelectionTraceSchema.optional(),
  securitySignals: z.array(securitySignalSchema).max(80),
  policyDecisions: z.array(policyDecisionSchema).max(40),
  runtimeProfile: runtimeProfileSchema,
  metrics: metricsSchema.optional(),
  requestId: z.string().optional(),
});

export const agentActionSchema = z.strictObject({
  id: z.string(),
  type: z.enum(["CLICK", "TYPE", "SCROLL", "WAIT", "CONFIRM_REQUIRED"]),
  targetElementId: z.string().optional(),
  value: z
    .string()
    .max(200)
    // TYPE values may only carry static text or local <TOKEN> references — never URLs, selectors or JS.
    .regex(/^[A-Za-z0-9 _<>\-./@]*$/)
    .optional(),
  reason: z.string().max(160),
  confidence: z.number().min(0).max(1),
  riskLevel: z.enum(["low", "medium", "high"]),
});

export const actionPlanSchema = z.strictObject({
  planId: z.string(),
  taskSummary: z.string().max(200),
  actions: z.array(agentActionSchema).max(20),
  requiresUserConsent: z.boolean(),
  generatedAt: z.string(),
  guardrailNotes: z.array(z.string()).max(20),
});

export const planRequestSchema = z.strictObject({
  userGoal: z.string().min(3).max(500),
  context: transportContextSchema,
});