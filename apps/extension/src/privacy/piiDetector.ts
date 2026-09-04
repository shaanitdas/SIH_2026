import { DetectionSummary, SensitiveEntity, SensitiveEntityType, UiElement } from "@sih/shared";

interface PatternRule {
  type: SensitiveEntityType;
  regex: RegExp;
  confidence: number;
  reason: string;
}

const REGEX_RULES: PatternRule[] = [
  { type: "AADHAAR", regex: /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, confidence: 0.94, reason: "Aadhaar-like format" },
  { type: "PAN", regex: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, confidence: 0.95, reason: "PAN format" },
  { type: "GSTIN", regex: /\b\d{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g, confidence: 0.95, reason: "GSTIN format" },
  { type: "UPI", regex: /\b[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}\b/g, confidence: 0.85, reason: "UPI handle pattern" },
  { type: "PHONE_IN", regex: /\b(?:\+91[-\s]?)?[6-9]\d{9}\b/g, confidence: 0.88, reason: "Indian mobile number pattern" },
  { type: "IFSC", regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, confidence: 0.91, reason: "IFSC format" },
  { type: "EMAIL", regex: /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, confidence: 0.86, reason: "Email pattern" },
  { type: "CARD_NUMBER", regex: /\b(?:\d[ -]*?){13,19}\b/g, confidence: 0.82, reason: "Card-number-like sequence" },
  { type: "DOB", regex: /\b(?:0?[1-9]|[12][0-9]|3[01])[\/\-.](?:0?[1-9]|1[0-2])[\/\-.](?:19|20)\d{2}\b/g, confidence: 0.8, reason: "Date-of-birth style date" },
];

const NAME_CONTEXT_HINTS = ["name", "full name", "applicant", "beneficiary", "customer"];
const ADDRESS_HINTS = ["address", "city", "district", "street", "pincode", "pin code", "state"];
const ACCOUNT_HINTS = ["account", "a/c", "bank", "iban", "beneficiary account"];

export interface PiiDetectionResult {
  entities: SensitiveEntity[];
  summary: DetectionSummary;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function extractTextCandidates(element: UiElement): string[] {
  return [element.text, element.placeholder, element.valueHint]
    .filter((item): item is string => Boolean(item && item.trim()))
    .map((item) => normalize(item));
}

function pushEntity(
  entities: SensitiveEntity[],
  element: UiElement,
  type: SensitiveEntityType,
  confidence: number,
  source: SensitiveEntity["source"],
  reason: string,
  matchText?: string,
): void {
  const token = `<${type}_${entities.length + 1}>`;
  entities.push({
    id: `${element.id}-${type}-${entities.length + 1}`,
    elementId: element.id,
    type,
    confidence,
    source,
    token,
    reasons: [reason],
    matchText,
  });
}

function detectByRegex(element: UiElement, entities: SensitiveEntity[]): void {
  const candidates = extractTextCandidates(element);
  for (const candidate of candidates) {
    for (const rule of REGEX_RULES) {
      let match: RegExpExecArray | null;
      while ((match = rule.regex.exec(candidate)) !== null) {
        pushEntity(
          entities,
          element,
          rule.type,
          rule.confidence,
          "regex",
          rule.reason,
          match[0],
        );
      }
      rule.regex.lastIndex = 0;
    }
  }
}

function hintMatch(hints: string[], text: string): boolean {
  const lowered = text.toLowerCase();
  return hints.some((hint) => lowered.includes(hint));
}

function detectByStructure(element: UiElement, entities: SensitiveEntity[]): void {
  const role = element.role.toLowerCase();
  const textBlob = extractTextCandidates(element).join(" ").toLowerCase();

  if (role.includes("input") && textBlob.includes("password")) {
    pushEntity(entities, element, "PASSWORD", 0.99, "structural", "Password field semantics");
  }

  if (hintMatch(ACCOUNT_HINTS, textBlob)) {
    pushEntity(entities, element, "ACCOUNT", 0.78, "structural", "Bank account semantic hint");
  }

  if (hintMatch(ADDRESS_HINTS, textBlob)) {
    pushEntity(entities, element, "ADDRESS", 0.74, "structural", "Address semantic hint");
  }
}

function detectByHeuristicNer(element: UiElement, entities: SensitiveEntity[]): void {
  const text = extractTextCandidates(element).join(" ");
  if (!text) return;

  const hasHonorific = /\b(Mr|Mrs|Ms|Dr|Shri|Smt)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/.test(text);
  const hasNameLabel = hintMatch(NAME_CONTEXT_HINTS, text);

  if (hasHonorific || hasNameLabel) {
    pushEntity(entities, element, "NAME", hasHonorific ? 0.83 : 0.69, "ner", "Name-like phrase detected", text.slice(0, 80));
  }
}

function dedupeAndCalibrate(entities: SensitiveEntity[]): SensitiveEntity[] {
  const map = new Map<string, SensitiveEntity>();

  for (const entity of entities) {
    const key = `${entity.elementId}:${entity.type}:${entity.matchText ?? ""}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, entity);
      continue;
    }

    const mergedConfidence = Math.min(0.99, Math.max(existing.confidence, entity.confidence) + 0.02);
    map.set(key, {
      ...existing,
      confidence: mergedConfidence,
      reasons: Array.from(new Set([...existing.reasons, ...entity.reasons])),
    });
  }

  return Array.from(map.values());
}

function buildSummary(entities: SensitiveEntity[]): DetectionSummary {
  const highConfidence = entities.filter((entity) => entity.confidence >= 0.85).length;
  const uncertain = entities.filter((entity) => entity.confidence < 0.7).length;
  const total = Math.max(entities.length, 1);

  return {
    recallEstimate: Math.min(0.99, 0.72 + highConfidence / (total * 4)),
    precisionEstimate: Math.max(0.5, 0.95 - uncertain / (total * 2)),
    uncertainCount: uncertain,
  };
}

export function detectPii(elements: UiElement[]): PiiDetectionResult {
  const rawEntities: SensitiveEntity[] = [];

  for (const element of elements) {
    detectByRegex(element, rawEntities);
    detectByStructure(element, rawEntities);
    detectByHeuristicNer(element, rawEntities);
  }

  const entities = dedupeAndCalibrate(rawEntities);
  const summary = buildSummary(entities);

  return { entities, summary };
}
