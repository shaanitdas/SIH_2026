import { describe, expect, it } from "vitest";
import { analyzeImageBlock, PixelBlock, sampleGrid } from "../src/vision/pixelAnalysis.js";

function blockWith(data: Uint8ClampedArray, width = 8, height = 8): PixelBlock {
  return { data, width, height };
}

function flatPixels(value: number, width = 8, height = 8): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
  return data;
}

function skinPixels(r: number, g: number, b: number, width = 8, height = 8): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = r;
    data[index + 1] = g;
    data[index + 2] = b;
    data[index + 3] = 255;
  }
  return data;
}

describe("sampleGrid", () => {
  it("samples every pixel for small blocks", () => {
    const samples = sampleGrid(blockWith(flatPixels(240)));
    expect(samples).toHaveLength(64);
  });
});

describe("analyzeImageBlock", () => {
  it("labels a uniform block as blank", () => {
    const result = analyzeImageBlock(blockWith(flatPixels(248)));
    expect(result.label).toBe("blank");
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("labels a high-contrast checkerboard as text-like", () => {
    const data = flatPixels(245);
    for (let index = 0; index < data.length; index += 8) {
      data[index] = 30;
      data[index + 1] = 30;
      data[index + 2] = 30;
    }
    const result = analyzeImageBlock(blockWith(data));
    expect(result.gradientDensity).toBeGreaterThan(0.3);
    expect(result.label).toBe("text-like");
  });

  it("labels a region with a dominant skin-tone population as face-like", () => {
    const data = skinPixels(235, 185, 155);
    for (let index = 0; index < data.length; index += 8) {
      data[index] = 80;
      data[index + 1] = 80;
      data[index + 2] = 90;
    }
    const result = analyzeImageBlock(blockWith(data));
    expect(result.skinToneRatio).toBeGreaterThan(0.35);
    expect(result.label).toBe("face-like");
  });
});