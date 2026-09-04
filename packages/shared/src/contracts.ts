export type DataSensitivity = "public" | "sensitive" | "restricted";

export type SensitiveEntityType =
  | "AADHAAR"
  | "PAN"
  | "UPI"
  | "GSTIN"
  | "PHONE_IN"
  | "EMAIL"
  | "PASSWORD"
  | "FACE"
  | "NAME"
  | "ADDRESS"
  | "ACCOUNT"
  | "IFSC"
  | "DOB"
  | "CARD_NUMBER";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export interface UiElement {
  id: string;
  role: string;
  text: string;
  placeholder?: string;
  valueHint?: string;
  domPath: string;
  bounds: BoundingBox;
  sensitivity: DataSensitivity;
  redactedText?: string;
  attributes?: Record<string, string>;
}

export interface SensitiveEntity {
  id: string;
  elementId: string;
  type: SensitiveEntityType;
  confidence: number;
  source: "regex" | "ner" | "vision" | "structural";
  token: string;
  reasons: string[];
  matchText?: string;
}

export interface DetectionSummary {
  recallEstimate: number;
  precisionEstimate: number;
  uncertainCount: number;
}

export interface VisionObservation {
  id: string;
  kind: "canvas" | "video" | "iframe";
  bounds: BoundingBox;
  sensitivityGuess: DataSensitivity;
  confidence: number;
  notes: string[];
}

export interface RuntimeProfile {
  executionMode: "webgpu" | "wasm" | "cpu";
  profileTier: "lite" | "balanced" | "performance";
  hardwareConcurrency: number;
  deviceMemoryGB?: number;
}

export interface ModelMetricFit {
  visualContextAccuracy: number;
  piiRecallPrecision: number;
  redactionPrecision: number;
  resourceUtilization: number;
  endToEndLatency: number;
}

export interface VisionModelDescriptor {
  id: string;
  name: string;
  family: "mediapipe" | "onnx" | "transformers";
  task: "face_detection" | "ocr" | "layout_detection";
  approxSizeMB: number;
  expectedLatencyMs: Record<RuntimeProfile["executionMode"], number>;
  metricFit: ModelMetricFit;
  recommendedFor: RuntimeProfile["profileTier"][];
  source: string;
  notes: string[];
}

export interface SelectedVisionModel {
  descriptor: VisionModelDescriptor;
  weightedScore: number;
  reasons: string[];
}

export interface ModelSelectionTrace {
  shortlist: Array<{ modelId: string; score: number }>;
  dominantBlindSpot: VisionObservation["kind"] | "none";
  selectedModelId: string;
}

export interface SecuritySignal {
  type: "PROMPT_INJECTION" | "MALICIOUS_INSTRUCTION" | "UNKNOWN_AUTOMATION_TRAP";
  confidence: number;
  message: string;
  elementId?: string;
}

export interface PolicyDecision {
  policy: string;
  status: "pass" | "warn" | "block";
  reason: string;
}

export interface RubricMetrics {
  visualContextAccuracy: number;
  piiRecallPrecision: number;
  redactionPrecision: number;
  resourceUtilization: number;
  endToEndLatency: number;
  weightedOverall: number;
}

export interface SanitizedContext {
  sessionId: string;
  pageUrl: string;
  pageTitle: string;
  timestamp: string;
  elements: UiElement[];
  sensitiveEntities: SensitiveEntity[];
  redactedRegions: BoundingBox[];
  tokenMap: Record<string, string>;
  policyVersion: string;
  privacyScore: number;
  detectionSummary: DetectionSummary;
  visionObservations: VisionObservation[];
  selectedVisionModel?: SelectedVisionModel;
  modelSelectionTrace?: ModelSelectionTrace;
  securitySignals: SecuritySignal[];
  policyDecisions: PolicyDecision[];
  runtimeProfile: RuntimeProfile;
  metrics?: RubricMetrics;
}

export type AgentActionType =
  | "CLICK"
  | "TYPE"
  | "SCROLL"
  | "WAIT"
  | "CONFIRM_REQUIRED";

export interface AgentAction {
  id: string;
  type: AgentActionType;
  targetElementId?: string;
  value?: string;
  reason: string;
  confidence: number;
  riskLevel: "low" | "medium" | "high";
}

export interface ActionPlan {
  planId: string;
  taskSummary: string;
  actions: AgentAction[];
  requiresUserConsent: boolean;
  generatedAt: string;
  guardrailNotes: string[];
}

export interface PlanRequest {
  userGoal: string;
  context: SanitizedContext;
}

export interface PlanResponse {
  plan: ActionPlan;
  serverNotes: string[];
}

export interface ConsentDecision {
  approved: boolean;
  reason: string;
  requiredActions: string[];
}

export interface RedactionResult {
  elements: UiElement[];
  tokenMap: Record<string, string>;
  redactedRegions: BoundingBox[];
  precisionEstimate: number;
}
