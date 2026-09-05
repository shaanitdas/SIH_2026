import {
  DetectionSummary,
  PII_PATTERNS,
  SensitiveEntity,
  SensitiveEntityType,
  UiElement,
} from "@sih/shared";

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

export function detectPiiInText(text: string): SensitiveEntity[] {
  const entities: SensitiveEntity[] = [];
  const matches: Array<{ type: SensitiveEntityType; matchText: string; confidence: number; reason: string }> = [];
  for (const rule of PII_PATTERNS) {
    let match: RegExpExecArray | null;
    while ((match = rule.regex.exec(text)) !== null) {
      matches.push({ type: rule.type, matchText: match[0], confidence: rule.confidence, reason: rule.reason });
    }
    rule.regex.lastIndex = 0;
  }

  for (const match of matches) {
    entities.push({
      id: `text-${match.type}-${entities.length + 1}`,
      elementId: "text-region",
      type: match.type,
      confidence: match.confidence,
      source: "regex",
      token: `<${match.type}_${entities.length + 1}>`,
      reasons: [match.reason],
      matchText: match.matchText,
      rawValue: match.matchText,
    });
  }
  return entities;
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
  rawValue?: string,
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
    rawValue,
  });
}

function detectByRegex(element: UiElement, entities: SensitiveEntity[]): void {
  const candidates = extractTextCandidates(element);
  for (const candidate of candidates) {
    for (const rule of PII_PATTERNS) {
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
    pushEntity(
      entities,
      element,
      "NAME",
      hasHonorific ? 0.83 : 0.69,
      "ner",
      "Name-like phrase detected",
      text.slice(0, 80),
    );
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
  const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

  return {
    recallEstimate: round4(Math.min(0.99, 0.72 + highConfidence / (total * 4))),
    precisionEstimate: round4(Math.max(0.5, 0.95 - uncertain / (total * 2))),
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