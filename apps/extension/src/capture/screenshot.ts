export interface CaptureResult {
  ok: boolean;
  canvas?: HTMLCanvasElement;
  dataUrl?: string;
  width?: number;
  height?: number;
  error?: string;
}

async function requestCaptureFromBackground(): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  if (typeof chrome === "undefined" || !chrome.runtime?.id) {
    return { ok: false, error: "chrome.runtime unavailable (not running as an extension)" };
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" });
    if (response?.ok && typeof response.dataUrl === "string") {
      return { ok: true, dataUrl: response.dataUrl };
    }
    return { ok: false, error: response?.error ?? "capture rejected by background" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode captured screenshot"));
    image.src = dataUrl;
  });
}

function drawToCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context?.drawImage(image, 0, 0);
  return canvas;
}

export async function captureViewport(): Promise<CaptureResult> {
  const requested = await requestCaptureFromBackground();
  if (!requested.ok || !requested.dataUrl) {
    return { ok: false, error: requested.error ?? "no screenshot" };
  }
  try {
    const image = await loadImage(requested.dataUrl);
    const canvas = drawToCanvas(image);
    return {
      ok: true,
      canvas,
      dataUrl: requested.dataUrl,
      width: canvas.width,
      height: canvas.height,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function cropRegion(canvas: HTMLCanvasElement, bounds: { x: number; y: number; width: number; height: number }): ImageData | null {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const x = Math.max(0, Math.round(bounds.x));
  const y = Math.max(0, Math.round(bounds.y));
  const width = Math.max(1, Math.round(Math.min(bounds.width, canvas.width - x)));
  const height = Math.max(1, Math.round(Math.min(bounds.height, canvas.height - y)));
  try {
    return context.getImageData(x, y, width, height);
  } catch {
    return null;
  }
}