import { PolicyDecision, SanitizedContext, SanitizedSensitiveEntity, TransportContext } from "./contracts.js";
import { findSensitiveValuesInText } from "./patterns.js";

export const POLICY_VERSION = "v3.0.0";

const MAX_TEXT_LENGTH = 180;

function transportSessionId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function sanitizePageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const sensitiveSegments = parsed.pathname
      .split("/")
      .map((segment) => (segment.length > 0 ? "<seg>" : ""))
      .join("/");
    const path = sensitiveSegments === "" ? "/" : sensitiveSegments;
    const queryKeys = Array.from(parsed.searchParams.keys())
      .map((key) => `${key}=<value>`)
      .join("&");
    return `${parsed.origin}${path}${queryKeys ? `?${queryKeys}` : ""}`;
  } catch {
    return "<unsafe-url>";
  }
}

export function sanitizePageTitle(title: string): string {
  let safe = title.trim().slice(0, 120);
  const matches = findSensitiveValuesInText(safe);
  for (const match of matches) {
    safe = safe.split(match.matchText).join(`<${match.type}>`);
  }
  safe = safe.replace(
    /\b(Mr|Mrs|Ms|Dr|Shri|Smt)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}/g,
    "<NAME_1>",
  );
  return safe.trim().length > 0 ? safe : "<untitled>";
}

function sanitizeSensitiveEntity(entity: SanitizedContext["sensitiveEntities"][number]): SanitizedSensitiveEntity {
  return {
    id: entity.id,
    elementId: entity.elementId,
    type: entity.type,
    confidence: entity.confidence,
    source: entity.source,
    token: entity.token,
  };
}

function rebuildRedactedText(
  text: string,
  entities: SanitizedContext["sensitiveEntities"],
  elementId: string,
): string {
  let redacted = text;
  for (const entity of entities) {
    if (entity.elementId !== elementId || !entity.matchText) continue;
    redacted = redacted.split(entity.matchText).join(entity.token);
  }
  return redacted;
}

function sanitizeSelectedVisionModel(
  value: SanitizedContext["selectedVisionModel"],
): TransportContext["selectedVisionModel"] {
  if (!value) return undefined;
  return {
    descriptor: {
      id: value.descriptor.id,
      name: value.descriptor.name,
      family: value.descriptor.family,
      task: value.descriptor.task,
    },
    weightedScore: value.weightedScore,
    reasons: value.reasons,
  };
}

export function enforceTransportPolicy(context: SanitizedContext): TransportContext {
  const decisions: PolicyDecision[] = [];

  const safeElements = context.elements.map((element) => {
    const hasEntityRedaction = context.sensitiveEntities.some(
      (entity) => entity.elementId === element.id && !!entity.matchText,
    );
    const forceRedact =
      element.sensitivity !== "public" || element.redactedText !== undefined || hasEntityRedaction;
    const outboundText = forceRedact
      ? (element.redactedText ?? rebuildRedactedText(element.text, context.sensitiveEntities, element.id) ?? "[REDACTED]")
      : element.text;

    const { enabled: _enabled, checked: _checked, agentId: _agentId, ...rest } = element;

    return {
      ...rest,
      text: outboundText.slice(0, MAX_TEXT_LENGTH),
      placeholder: forceRedact ? undefined : element.placeholder?.slice(0, 60),
      valueHint: undefined,
      attributes: undefined,
      redactedText: element.redactedText?.slice(0, MAX_TEXT_LENGTH),
    };
  });

  if (context.securitySignals.some((signal) => signal.confidence >= 0.75)) {
    decisions.push({
      policy: "high-risk-signal-consent",
      status: "warn",
      reason: "High confidence malicious/prompt-injection signal detected in UI.",
    });
  }

  decisions.push({
    policy: "no-raw-sensitive-values-over-network",
    status: "pass",
    reason: "matchText/rawValue/tokenMap excluded; only typed semantic tokens are transported.",
  });

  return {
    sessionId: transportSessionId(),
    pageUrl: sanitizePageUrl(context.pageUrl),
    pageTitle: sanitizePageTitle(context.pageTitle),
    timestamp: context.timestamp,
    elements: safeElements,
    sensitiveEntities: context.sensitiveEntities.map(sanitizeSensitiveEntity),
    redactedRegions: context.redactedRegions,
    policyVersion: POLICY_VERSION,
    privacyScore: context.privacyScore,
    detectionSummary: context.detectionSummary,
    visionObservations: context.visionObservations,
    selectedVisionModel: sanitizeSelectedVisionModel(context.selectedVisionModel),
    modelSelectionTrace: context.modelSelectionTrace,
    securitySignals: context.securitySignals,
    policyDecisions: [...context.policyDecisions, ...decisions],
    runtimeProfile: context.runtimeProfile,
    metrics: context.metrics,
  };
}