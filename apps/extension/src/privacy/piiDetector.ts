import { SensitiveEntity, UiElement } from "@sih/shared";

const PATTERNS: Array<{ type: SensitiveEntity["type"]; regex: RegExp }> = [
  { type: "AADHAAR", regex: /\b\d{4}\s?\d{4}\s?\d{4}\b/g },
  { type: "PAN", regex: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g },
  { type: "GSTIN", regex: /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]\b/g },
  { type: "PHONE_IN", regex: /\b(?:\+91[-\s]?)?[6-9]\d{9}\b/g },
  { type: "EMAIL", regex: /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g },
  { type: "UPI", regex: /\b[\w.\-]{2,}@[a-zA-Z]{2,}\b/g },
];

export function detectPii(elements: UiElement[]): SensitiveEntity[] {
  const entities: SensitiveEntity[] = [];

  for (const element of elements) {
    const text = [element.text, element.placeholder, element.valueHint]
      .filter(Boolean)
      .join(" ");

    for (const { type, regex } of PATTERNS) {
      if (regex.test(text)) {
        entities.push({
          id: `${element.id}-${type}`,
          type,
          confidence: 0.9,
          source: "regex",
          token: `<${type}_${entities.length + 1}>`,
        });
      }
      regex.lastIndex = 0;
    }

    if (element.role === "input" && /password/i.test(text)) {
      entities.push({
        id: `${element.id}-PASSWORD`,
        type: "PASSWORD",
        confidence: 0.99,
        source: "structural",
        token: `<PASSWORD_${entities.length + 1}>`,
      });
    }
  }

  return entities;
}
