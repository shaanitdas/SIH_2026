import { describe, expect, it } from "vitest";
import { UiElement } from "@sih/shared";
import { detectPii, detectPiiInText } from "../src/privacy/piiDetector.js";

function element(partial: Partial<UiElement>): UiElement {
  return {
    id: "el_1",
    role: "button",
    text: "",
    domPath: "html > body",
    bounds: { x: 0, y: 0, width: 10, height: 10, confidence: 1 },
    sensitivity: "public",
    ...partial,
  };
}

describe("detectPii regex channel", () => {
  it("detects an Aadhaar", () => {
    const { entities } = detectPii([element({ text: "Aadhaar 2345 6789 0123 submitted" })]);
    expect(entities.map((entity) => entity.type)).toContain("AADHAAR");
    expect(entities[0].matchText).toBe("2345 6789 0123");
    expect(entities[0].rawValue).toBe("2345 6789 0123");
  });

  it("detects a PAN and an email", () => {
    const { entities } = detectPii([
      element({ text: "PAN ABCDE1234F contact rahul@example.co.in" }),
    ]);
    const types = entities.map((entity) => entity.type);
    expect(types).toContain("PAN");
    expect(types).toContain("EMAIL");
  });

  it("detects Indian mobile numbers with optional +91", () => {
    const { entities } = detectPii([element({ text: "Call +91 98765 43210 now" })]);
    const types = entities.map((entity) => entity.type);
    expect(types).toContain("PHONE_IN");
  });

  it("ignores benign text", () => {
    const { entities } = detectPii([element({ text: "Click here to continue" })]);
    const regexSources = entities.filter((entity) => entity.source === "regex");
    expect(regexSources).toHaveLength(0);
  });
});

describe("detectPii structural channel", () => {
  it("marks password inputs", () => {
    const { entities } = detectPii([
      element({ role: "input", text: "Password", valueHint: "password" }),
    ]);
    expect(entities.map((entity) => entity.type)).toContain("PASSWORD");
    const password = entities.find((entity) => entity.type === "PASSWORD");
    expect(password?.confidence).toBeGreaterThan(0.9);
  });
});

describe("detectPii dedupe and calibration", () => {
  it("calibrates duplicate entities across channels", () => {
    const { entities } = detectPii([
      element({
        text: "Account: 1234 5678 9012 3456",
        role: "input",
        placeholder: "1234 5678 9012 3456",
      }),
    ]);
    const cards = entities.filter((entity) => entity.type === "CARD_NUMBER");
    expect(cards).toHaveLength(1);
  });
});

describe("detectPiiInText (OCR path)", () => {
  it("extracts entities from free text", () => {
    const entities = detectPiiInText("Aadhaar 2345 6789 0123 and email r@x.in");
    const types = entities.map((entity) => entity.type);
    expect(types).toContain("AADHAAR");
    expect(types).toContain("EMAIL");
  });
});