import { SanitizedContext } from "@sih/shared";

export function logPrivacyLedger(context: SanitizedContext): void {
  const event = {
    time: context.timestamp,
    page: context.pageUrl,
    entities: context.sensitiveEntities.length,
    redactedRegions: context.redactedRegions.length,
    privacyScore: context.privacyScore,
  };

  console.info("[privacy-ledger]", event);
}
