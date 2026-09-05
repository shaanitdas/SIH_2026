import { PixelAnalysisResult, PixelBlock } from "./pixelAnalysis.js";
import { VISION_WORKER_SOURCE } from "../generated/visionWorkerSource.js";

let cachedWorker: Worker | null = null;

export type PixelTaskResult =
  | { ok: true; result: PixelAnalysisResult }
  | { ok: false; error: string };

export function createAnalysisWorker(): Worker | null {
  if (cachedWorker) return cachedWorker;
  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") {
    return null;
  }
  try {
    const blob = new Blob([VISION_WORKER_SOURCE], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    cachedWorker = new Worker(url);
    return cachedWorker;
  } catch {
    return null;
  }
}

export function runPixelAnalysisInWorker(block: PixelBlock): Promise<PixelTaskResult> {
  const analysisWorker = createAnalysisWorker();
  if (!analysisWorker) {
    return Promise.reject(new Error("Worker API unavailable"));
  }

  return new Promise<PixelTaskResult>((resolve) => {
    const id = crypto.randomUUID();

    const onMessage = (event: MessageEvent<PixelTaskResult & { id?: string }>): void => {
      if (event.data?.id && event.data.id !== id) return;
      analysisWorker.removeEventListener("message", onMessage);
      analysisWorker.removeEventListener("error", onError);
      resolve(event.data);
    };

    const onError = (event: ErrorEvent): void => {
      analysisWorker.removeEventListener("message", onMessage);
      analysisWorker.removeEventListener("error", onError);
      resolve({ ok: false, error: event.message ?? "worker error" });
    };

    analysisWorker.addEventListener("message", onMessage);
    analysisWorker.addEventListener("error", onError);
    analysisWorker.postMessage({ id, data: block.data, width: block.width, height: block.height });
  });
}

export function terminateAnalysisWorker(): void {
  cachedWorker?.terminate();
  cachedWorker = null;
}