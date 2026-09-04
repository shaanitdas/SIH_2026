import { SanitizedContext } from "@sih/shared";

export function logPrivacyLedger(context: SanitizedContext): void {
  const event = {
    time: context.timestamp,
    page: context.pageUrl,
    entities: context.sensitiveEntities.length,
    uncertainEntities: context.detectionSummary.uncertainCount,
    redactedRegions: context.redactedRegions.length,
    privacyScore: context.privacyScore,
    policyDecisions: context.policyDecisions,
  };

  console.info("[privacy-ledger]", event);
}
