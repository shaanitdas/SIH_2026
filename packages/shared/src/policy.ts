import { SanitizedContext } from "./contracts.js";

export const POLICY_VERSION = "v1.0.0";

export function enforceTransportPolicy(context: SanitizedContext): SanitizedContext {
  const safeElements = context.elements.map((element) => ({
    ...element,
    text:
      element.sensitivity === "public"
        ? element.text
        : element.redactedText ?? "[REDACTED]",
    placeholder:
      element.sensitivity === "public" ? element.placeholder : undefined,
    valueHint: undefined,
  }));

  return {
    ...context,
    elements: safeElements,
    policyVersion: POLICY_VERSION,
  };
}
