export interface PixelBlock {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type PixelLabel = "blank" | "face-like" | "text-like" | "barcode-like" | "texture";

export interface PixelAnalysisResult {
  label: PixelLabel;
  confidence: number;
  meanLuminance: number;
  luminanceVariance: number;
  gradientDensity: number;
  skinToneRatio: number;
  sampleCount: number;
  notes: string[];
}

const GRID_SIZE = 64;

interface GridSample {
  luminance: number;
  isSkin: boolean;
}

function luminanceAt(block: PixelBlock, x: number, y: number): number {
  const index = (y * block.width + x) * 4;
  const r = block.data[index] ?? 0;
  const g = block.data[index + 1] ?? 0;
  const b = block.data[index + 2] ?? 0;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function isSkinTone(r: number, g: number, b: number): boolean {
  return r > 60 && g > 40 && b > 20 && r >= g && g >= b && r - g >= 10 && r - b >= 20;
}

export function sampleGrid(block: PixelBlock): GridSample[] {
  const width = block.width;
  const height = block.height;
  const stepX = Math.max(1, Math.floor(width / GRID_SIZE));
  const stepY = Math.max(1, Math.floor(height / GRID_SIZE));
  const samples: GridSample[] = [];

  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const index = (y * width + x) * 4;
      const r = block.data[index] ?? 0;
      const g = block.data[index + 1] ?? 0;
      const b = block.data[index + 2] ?? 0;
      samples.push({ luminance: luminanceAt(block, x, y), isSkin: isSkinTone(r, g, b) });
    }
  }
  return samples;
}

export function analyzeImageBlock(block: PixelBlock): PixelAnalysisResult {
  const samples = sampleGrid(block);
  const count = Math.max(samples.length, 1);
  const meanLuminance =
    samples.reduce((acc, sample) => acc + sample.luminance, 0) / count;
  const luminanceVariance =
    samples.reduce((acc, sample) => acc + (sample.luminance - meanLuminance) ** 2, 0) / count;
  const skinCount = samples.filter((sample) => sample.isSkin).length;
  const skinToneRatio = skinCount / count;

  let gradients = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if (Math.abs(samples[i].luminance - samples[i - 1].luminance) > 28) gradients += 1;
  }
  const gradientDensity = gradients / count;

  const stddev = Math.sqrt(luminanceVariance);
  let label: PixelLabel;
  let confidence: number;
  const notes: string[] = [];

  if (stddev < 4 && gradientDensity < 0.02) {
    label = "blank";
    confidence = 0.92;
    notes.push("Uniform low-variance region (blank surface).");
  } else if (skinToneRatio > 0.35) {
    label = "face-like";
    confidence = Math.min(0.9, 0.55 + skinToneRatio);
    notes.push(`Skin-tone ratio ${(skinToneRatio * 100).toFixed(0)}% suggests a face region.`);
  } else if (gradientDensity > 0.32) {
    label = "text-like";
    confidence = Math.min(0.9, 0.5 + gradientDensity);
    notes.push(`High edge density ${(gradientDensity * 100).toFixed(0)}% suggests text.`);
  } else if (stddev > 64 && gradientDensity > 0.18) {
    label = "texture";
    confidence = Math.min(0.85, 0.45 + stddev / 200);
    notes.push("High-contrast non-uniform region (layout/imagery).");
  } else {
    label = "barcode-like";
    confidence = 0.6;
    notes.push("Moderate contrast region requiring closer inspection.");
  }

  return {
    label,
    confidence,
    meanLuminance,
    luminanceVariance,
    gradientDensity,
    skinToneRatio,
    sampleCount: samples.length,
    notes,
  };
}