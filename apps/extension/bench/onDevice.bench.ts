import { describe, expect, test } from "vitest";
import { performance } from "node:perf_hooks";
import { analyzeImageBlock, PixelBlock } from "../src/vision/pixelAnalysis.js";
import { detectPii, detectPiiInText } from "../src/privacy/piiDetector.js";
import { UiElement } from "@sih/shared";

function randomBlock(width = 64, height = 64): PixelBlock {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = Math.floor(Math.random() * 256);
    data[index + 1] = Math.floor(Math.random() * 256);
    data[index + 2] = Math.floor(Math.random() * 256);
    data[index + 3] = 255;
  }
  return { data, width, height };
}

const OCR_LINES = [
  "Aadhaar 2345 6789 0123",
  "PAN ABCDE1234F",
  "Mobile +91 98765 43210",
  "Clear form",
  "Date 15/08/1990",
];

const DOM_ELEMENTS: UiElement[] = [
  { id: "el_1", role: "input", text: "Aadhaar 2345 6789 0123", domPath: "html > body", bounds: { x: 0, y: 0, width: 100, height: 30, confidence: 1 }, sensitivity: "public" },
  { id: "el_2", role: "input", text: "PAN ABCDE1234F", domPath: "html > body", bounds: { x: 0, y: 0, width: 100, height: 30, confidence: 1 }, sensitivity: "public" },
  { id: "el_3", role: "input", text: "Click submit", domPath: "html > body", bounds: { x: 0, y: 0, width: 100, height: 30, confidence: 1 }, sensitivity: "public" },
];

function measure(iterations: number, fn: () => void): number {
  const started = performance.now();
  for (let iteration = 0; iteration < iterations; iteration += 1) fn();
  const elapsedMs = performance.now() - started;
  return Math.round((iterations / elapsedMs) * 1000);
}

describe("on-device pixel analysis", () => {
  test("analyzeImageBlock (ops/sec)", () => {
    analyzeImageBlock(randomBlock());
    const opsPerSec = measure(200, () => {
      const result = analyzeImageBlock(randomBlock());
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });
    console.log(`[bench] analyzeImageBlock: ${opsPerSec} ops/sec`);
    expect(opsPerSec).toBeGreaterThan(50);
  });
});

describe("on-device PII detection", () => {
  test("detectPii on mixed DOM (ops/sec)", () => {
    detectPii(DOM_ELEMENTS);
    const opsPerSec = measure(400, () => {
      const { entities } = detectPii(DOM_ELEMENTS);
      expect(entities).toBeDefined();
    });
    console.log(`[bench] detectPii: ${opsPerSec} ops/sec`);
    expect(opsPerSec).toBeGreaterThan(100);
  });

  test("detectPiiInText on OCR lines (ops/sec)", () => {
    OCR_LINES.forEach((line) => detectPiiInText(line));
    const opsPerSec = measure(1000, () => {
      const summaries = OCR_LINES.map((line) => detectPiiInText(line).length);
      expect(summaries.reduce((acc, value) => acc + value, 0)).toBeGreaterThan(0);
    });
    console.log(`[bench] detectPiiInText: ${opsPerSec} ops/sec`);
    expect(opsPerSec).toBeGreaterThan(200);
  });
});