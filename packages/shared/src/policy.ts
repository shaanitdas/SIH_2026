import { PolicyDecision, SanitizedContext } from "./contracts.js";

export const POLICY_VERSION = "v2.0.0";

const MAX_TEXT_LENGTH = 180;

export function enforceTransportPolicy(context: SanitizedContext): SanitizedContext {
  const decisions: PolicyDecision[] = [];

  const safeElements = context.elements.map((element) => {
    const forceRedact = element.sensitivity !== "public";
    const outboundText = forceRedact
      ? (element.redactedText ?? "[REDACTED]")
      : element.text;

    return {
      ...element,
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
    reason: "Sensitive values replaced with local semantic tokens.",
  });

  return {
    ...context,
    elements: safeElements,
    policyVersion: POLICY_VERSION,
    policyDecisions: [...context.policyDecisions, ...decisions],
  };
}
