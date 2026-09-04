import { PlanRequest } from "@sih/shared";

export function shouldForceConsent(payload: PlanRequest): { force: boolean; reason: string } {
  const severeSignal = payload.context.securitySignals.find((signal) => signal.confidence >= 0.8);
  if (severeSignal) {
    return {
      force: true,
      reason: `High-confidence security signal received: ${severeSignal.type}`,
    };
  }

  if (payload.context.privacyScore < 0.75) {
    return {
      force: true,
      reason: "Privacy score below safe threshold.",
    };
  }

  return { force: false, reason: "No forced-consent condition triggered." };
}
