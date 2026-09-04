export type DataSensitivity = "public" | "sensitive" | "restricted";

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
}

export interface SensitiveEntity {
  id: string;
  type:
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
    | "ACCOUNT";
  confidence: number;
  source: "regex" | "ner" | "vision" | "structural";
  token: string;
}

export interface SanitizedContext {
  sessionId: string;
  pageUrl: string;
  pageTitle: string;
  timestamp: string;
  elements: UiElement[];
  sensitiveEntities: SensitiveEntity[];
  redactedRegions: BoundingBox[];
  policyVersion: string;
  privacyScore: number;
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
}

export interface PlanRequest {
  userGoal: string;
  context: SanitizedContext;
}

export interface PlanResponse {
  plan: ActionPlan;
  serverNotes: string[];
}
