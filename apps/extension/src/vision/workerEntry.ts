import { analyzeImageBlock } from "./pixelAnalysis.js";

interface WorkerRequest {
  id?: string;
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (!request || !request.data || !request.width || !request.height) {
    workerScope.postMessage({ ok: false, error: "Invalid pixel payload." });
    return;
  }
  try {
    const result = analyzeImageBlock({
      data: request.data,
      width: request.width,
      height: request.height,
    });
    workerScope.postMessage({ id: request.id, ok: true, result });
  } catch (error) {
    workerScope.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};