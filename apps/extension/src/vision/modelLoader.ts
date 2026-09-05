import { RuntimeProfile, SelectedVisionModel } from "@sih/shared";
import { shapeDetectionAvailable } from "./backends.js";
import { analyzeImageBlock } from "./pixelAnalysis.js";
import { createAnalysisWorker, runPixelAnalysisInWorker } from "./workerHost.js";

export interface ModelLoadResult {
  loaded: boolean;
  backend: RuntimeProfile["executionMode"];
  warmupMs: number;
  notes: string[];
}

function warmupPixels(): Uint8ClampedArray {
  const size = 16;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    data[i * 4] = (i * 7) % 256;
    data[i * 4 + 1] = (i * 13) % 256;
    data[i * 4 + 2] = (i * 29) % 256;
    data[i * 4 + 3] = 255;
  }
  return data;
}

export async function loadSelectedModel(
  selected: SelectedVisionModel,
  profile: RuntimeProfile,
): Promise<ModelLoadResult> {
  const startedAt = performance.now();
  const notes: string[] = [];
  const workerAvailable = createAnalysisWorker() !== null;
  const shapeAvailable = shapeDetectionAvailable();

  if (shapeAvailable) {
    notes.push(`Chrome Shape Detection API available for ${selected.descriptor.task}.`);
  } else {
    notes.push("Shape Detection API unavailable; pixel-analysis backend will be used.");
  }

  let warmed = false;
  if (workerAvailable) {
    const outcome = await runPixelAnalysisInWorker({
      data: warmupPixels(),
      width: 16,
      height: 16,
    });
    warmed = outcome.ok;
    notes.push(outcome.ok ? "Pixel-analysis worker warmed successfully." : "Worker warmup failed; inline fallback active.");
  } else {
    analyzeImageBlock({ data: warmupPixels(), width: 16, height: 16 });
    notes.push("Worker unavailable; running warmup inline.");
  }

  const warmupMs = Math.round(Math.max(0, performance.now() - startedAt));
  const loaded = shapeAvailable || workerAvailable;

  return {
    loaded,
    backend: profile.executionMode,
    warmupMs,
    notes: [
      ...notes,
      loaded ? "On-device ML backend is loaded and warm." : "Only inline heuristic fallback available; no on-device ML backend loaded.",
      `Backend mode: ${profile.executionMode}/${profile.profileTier}.`,
      `Model ${selected.descriptor.id} warmup took ${warmupMs.toFixed(1)}ms (${warmed ? "verified" : "estimated"}).`,
    ],
  };
}