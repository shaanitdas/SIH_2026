import { SecuritySignal, UiElement } from "@sih/shared";

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+previous\s+instructions/i,
  /send\s+all\s+(data|information)/i,
  /disable\s+privacy/i,
  /developer\s+mode\s+override/i,
  /copy\s+otp\s+and\s+share/i,
];

export function detectPromptInjectionSignals(elements: UiElement[]): SecuritySignal[] {
  const signals: SecuritySignal[] = [];

  for (const element of elements) {
    const text = `${element.text} ${element.placeholder ?? ""}`.trim();
    if (!text) continue;

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        signals.push({
          type: "PROMPT_INJECTION",
          confidence: 0.88,
          message: `Potential malicious instruction in UI text: ${text.slice(0, 80)}`,
          elementId: element.id,
        });
      }
    }
  }

  return signals;
}
