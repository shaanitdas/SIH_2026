import { SensitiveEntityType } from "./contracts.js";

export interface PiiPattern {
  type: SensitiveEntityType;
  regex: RegExp;
  confidence: number;
  reason: string;
}

export const PII_PATTERNS: PiiPattern[] = [
  { type: "AADHAAR", regex: /(?<![\d][ -]?)\b\d{4}[ -]?\d{4}[ -]?\d{4}\b(?![ -]?[\d])/g, confidence: 0.94, reason: "Aadhaar-like format" },
  { type: "PAN", regex: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, confidence: 0.95, reason: "PAN format" },
  { type: "GSTIN", regex: /\b\d{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g, confidence: 0.95, reason: "GSTIN format" },
  { type: "UPI", regex: /\b[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,10}\b(?!\.[A-Za-z])/g, confidence: 0.85, reason: "UPI handle pattern" },
  { type: "PHONE_IN", regex: /\b(?:\+91[-\s]?)?[6-9]\d{4}[-\s]?\d{5}\b/g, confidence: 0.88, reason: "Indian mobile number pattern" },
  { type: "IFSC", regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, confidence: 0.91, reason: "IFSC format" },
  { type: "EMAIL", regex: /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, confidence: 0.86, reason: "Email pattern" },
  { type: "CARD_NUMBER", regex: /\b(?<!\.)(?:\d[ -]*?){13,19}\b/g, confidence: 0.82, reason: "Card-number-like sequence" },
  { type: "DOB", regex: /\b(?:0?[1-9]|[12][0-9]|3[01])[\/\-.](?:0?[1-9]|1[0-2])[\/\-.](?:19|20)\d{2}\b/g, confidence: 0.8, reason: "Date-of-birth style date" },
];

export interface PiiMatch {
  type: SensitiveEntityType;
  matchText: string;
  confidence: number;
}

export function findSensitiveValuesInText(text: string): PiiMatch[] {
  const matches: PiiMatch[] = [];
  for (const rule of PII_PATTERNS) {
    let match: RegExpExecArray | null;
    while ((match = rule.regex.exec(text)) !== null) {
      matches.push({ type: rule.type, matchText: match[0], confidence: rule.confidence });
    }
    rule.regex.lastIndex = 0;
  }
  return matches;
}

export function assertNoRawSensitiveValues(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) return;
  const hits = findSensitiveValuesInText(serialized);
  if (hits.length > 0) {
    const unique = Array.from(new Set(hits.map((hit) => `${hit.type}:${hit.matchText}`))).slice(0, 5);
    throw new Error(`PrivacyFirewallError: raw sensitive values present in outbound payload: ${unique.join(", ")}`);
  }
}