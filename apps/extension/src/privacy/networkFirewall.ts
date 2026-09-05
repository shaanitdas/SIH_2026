import {
  assertNoRawSensitiveValues,
  enforceTransportPolicy,
  SanitizedContext,
  TransportContext,
} from "@sih/shared";

export interface PrivacyReport {
  pass: boolean;
  checks: Array<{ label: string; ok: boolean; detail: string }>;
}

export function runNetworkFirewall(outbound: TransportContext): PrivacyReport {
  const checks: PrivacyReport["checks"] = [];

  const leaks = outbound.sensitiveEntities.filter((entity) => {
    const widest = entity as unknown as Record<string, unknown>;
    return (
      widest.matchText !== undefined ||
      widest.rawValue !== undefined ||
      widest.reasons !== undefined
    );
  });

  checks.push({
    label: "sensitive-entities-are-token-only",
    ok: leaks.length === 0,
    detail: leaks.length === 0 ? "all entities carry typed tokens only" : `${leaks.length} entity(ies) leaked private fields`,
  });

  checks.push({
    label: "no-token-map",
    ok: (outbound as unknown as Record<string, unknown>).tokenMap === undefined,
    detail: "tokenMap is excluded from the transport contract",
  });

  const queryPart = outbound.pageUrl.split("?")[1];
  checks.push({
    label: "sanitized-url",
    ok: queryPart === undefined ? true : /^([^=]+=<value>&?)*$/.test(queryPart ?? ""),
    detail: "query/hash parameters are parameterized",
  });

  try {
    assertNoRawSensitiveValues(outbound);
    checks.push({
      label: "regex-pii-scan",
      ok: true,
      detail: "no Aadhaar/PAN/email/phone/IFSC/GSTIN/card values in serialized payload",
    });
  } catch (error) {
    checks.push({
      label: "regex-pii-scan",
      ok: false,
      detail: error instanceof Error ? error.message : "unknown firewall error",
    });
  }

  return {
    pass: checks.every((check) => check.ok),
    checks,
  };
}

export function assertTransportIsSafe(context: SanitizedContext): TransportContext {
  const outbound = enforceTransportPolicy(context);
  const report = runNetworkFirewall(outbound);
  if (!report.pass) {
    throw new Error(
      `NetworkFirewallError: ${report.checks.find((check) => !check.ok)?.detail ?? "payload blocked"}`,
    );
  }
  return outbound;
}