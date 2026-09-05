import { describe, expect, it } from "vitest";
import { SensitiveEntity, UiElement } from "@sih/shared";
import { redactElements } from "../src/privacy/redactor.js";

function element(partial: Partial<UiElement>): UiElement {
  return {
    id: "el_1",
    role: "input",
    text: "Aadhaar 2345 6789 0123",
    domPath: "html > body",
    bounds: { x: 0, y: 0, width: 100, height: 40, confidence: 1 },
    sensitivity: "public",
    ...partial,
  };
}

function aadhaarEntity(elementId: string): SensitiveEntity {
  return {
    id: "ent_1",
    elementId,
    type: "AADHAAR",
    confidence: 0.94,
    source: "regex",
    token: "<AADHAAR_1>",
    reasons: [],
    matchText: "2345 6789 0123",
    rawValue: "234567890123",
  };
}

describe("redactElements", () => {
  it("tokenizes matchText and never keeps raw values in redacted text", () => {
    const el = element({});
    const result = redactElements([el], [aadhaarEntity(el.id)]);
    expect(result.elements[0].redactedText).toBe("Aadhaar <AADHAAR_1>");
    expect(result.elements[0].redactedText).not.toContain("2345 6789 0123");
    expect(result.elements[0].sensitivity).toBe("sensitive");
    expect(result.tokenMap["<AADHAAR_1>"]).toBe("AADHAAR");
  });

  it("marks password or low-confidence entities as restricted", () => {
    const el = element({ text: "Password", role: "input" });
    const password = {
      id: "ent_2",
      elementId: el.id,
      type: "PASSWORD" as const,
      confidence: 0.99,
      source: "structural" as const,
      token: "<PASSWORD_1>",
      reasons: [],
    };
    const result = redactElements([el], [password]);
    expect(result.elements[0].sensitivity).toBe("restricted");
  });

  it("keeps unrelated elements public and unmodified", () => {
    const publicEl = element({ id: "el_public", text: "Submit" });
    const privateEl = element({ id: "el_private", text: "Email r@x.in" });
    const email = {
      ...aadhaarEntity(privateEl.id),
      id: "ent_3",
      type: "EMAIL" as const,
      matchText: "r@x.in",
      rawValue: "r@x.in",
      token: "<EMAIL_1>",
    };
    const result = redactElements([publicEl, privateEl], [email]);
    expect(result.elements[0].sensitivity).toBe("public");
    expect(result.elements[0].redactedText).toBe("Submit");
    expect(result.elements[1].sensitivity).toBe("sensitive");
  });

  it("uses entity-level bounds when present, otherwise element bounds", () => {
    const el = element({});
    const entity = {
      ...aadhaarEntity(el.id),
      bounds: { x: 3, y: 5, width: 60, height: 20, confidence: 0.94 },
    };
    const result = redactElements([el], [entity]);
    expect(result.redactedRegions).toContainEqual(entity.bounds);
    expect(result.redactedRegions).not.toContainEqual(el.bounds);
  });
});