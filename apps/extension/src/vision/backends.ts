import { BoundingBox } from "@sih/shared";
import { analyzeImageBlock, PixelBlock, PixelAnalysisResult } from "./pixelAnalysis.js";
import { runPixelAnalysisInWorker } from "./workerHost.js";

export type DetectionKind = "face" | "text" | "barcode" | "region";

export interface VisionDetection {
  kind: DetectionKind;
  bounds: BoundingBox;
  confidence: number;
  rawText?: string;
  notes: string[];
}

export interface VisionInference {
  name: string;
  detect(imageData: ImageData): Promise<VisionDetection[]>;
}

interface ShapeBox {
  top?: number;
  left?: number;
  x?: number;
  y?: number;
  width: number;
  height: number;
}

interface BarcodeDetection {
  rawValue?: string;
  boundingBox: ShapeBox;
  format?: string;
}

interface FaceDetection {
  boundingBox: ShapeBox;
  landmarkCoordinates?: unknown[];
}

interface TextDetection {
  rawValue?: string;
  boundingBox: ShapeBox;
}

type DetectorInstance = { detect(source: ImageData): Promise<unknown[]> };
type DetectorConstructor = new () => DetectorInstance;

declare global {
  interface Window {
    BarcodeDetector?: DetectorConstructor;
    TextDetector?: DetectorConstructor;
    FaceDetector?: DetectorConstructor;
  }
}

function toBounds(box: ShapeBox, source: ImageData): BoundingBox {
  const left = box.x ?? box.left ?? 0;
  const top = box.y ?? box.top ?? 0;
  return {
    x: left / source.width,
    y: top / source.height,
    width: box.width / source.width,
    height: box.height / source.height,
    confidence: 1,
  };
}

function availableDetectors(): Array<{ name: string; ctor: DetectorConstructor }> {
  const entries: Array<{ name: string; ctor?: DetectorConstructor }> = [
    { name: "BarcodeDetector", ctor: window.BarcodeDetector },
    { name: "FaceDetector", ctor: window.FaceDetector },
    { name: "TextDetector", ctor: window.TextDetector },
  ];
  return entries.filter((entry): entry is { name: string; ctor: DetectorConstructor } => Boolean(entry.ctor));
}

export function shapeDetectionAvailable(): boolean {
  return availableDetectors().length > 0;
}

export const shapeDetectionBackend = (): VisionInference | null => {
  if (!shapeDetectionAvailable()) return null;

  return {
    name: "shape-detection-api",
    detect: async (imageData: ImageData): Promise<VisionDetection[]> => {
      const detections: VisionDetection[] = [];
      const hints = { userId: 1 };

      for (const { name, ctor } of availableDetectors()) {
        try {
          const detector = new ctor();
          const raw = await detector.detect(imageData);

          for (const item of raw) {
            const known = item as unknown as BarcodeDetection;

            if (name === "BarcodeDetector" && typeof known.rawValue === "string") {
              detections.push({
                kind: "barcode",
                bounds: toBounds(known.boundingBox, imageData),
                confidence: 0.9,
                rawText: known.rawValue,
                notes: [`Barcode format: ${known.format ?? "unknown"}`],
              });
            } else if (name === "FaceDetector") {
              const face = item as unknown as FaceDetection;
              if (face.boundingBox) {
                detections.push({
                  kind: "face",
                  bounds: toBounds(face.boundingBox, imageData),
                  confidence: 0.88,
                  notes: [`Face landmarks: ${face.landmarkCoordinates?.length ?? 0}`],
                });
              }
            } else if (name === "TextDetector") {
              const text = item as unknown as TextDetection;
              if (text.boundingBox && typeof text.rawValue === "string" && text.rawValue.length > 0) {
                detections.push({
                  kind: "text",
                  bounds: toBounds(text.boundingBox, imageData),
                  confidence: 0.92,
                  rawText: text.rawValue,
                  notes: ["OCR line read via on-device TextDetector."],
                });
              }
            }
          }
        } catch {
          // Detector failed for this frame type; continue with the next detector.
        }
      }

      void hints;
      return detections;
    },
  };
};

function analysisToDetection(result: PixelAnalysisResult, imageData: ImageData): VisionDetection | null {
  const region: BoundingBox = {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    confidence: result.confidence,
  };

  if (result.label === "blank") return null;

  if (result.label === "face-like") {
    return {
      kind: "face",
      bounds: region,
      confidence: result.confidence,
      notes: result.notes,
    };
  }

  if (result.label === "text-like") {
    return {
      kind: "text",
      bounds: region,
      confidence: result.confidence,
      notes: [...result.notes, "Pixel-level edge analysis (on-device worker)."],
    };
  }

  return {
    kind: "region",
    bounds: region,
    confidence: result.confidence,
    notes: result.notes,
  };
}

export const pixelAnalysisBackend = (): VisionInference => ({
  name: "pixel-analysis-worker",
  detect: async (imageData: ImageData): Promise<VisionDetection[]> => {
    const block: PixelBlock = {
      data: imageData.data,
      width: imageData.width,
      height: imageData.height,
    };

    let result: PixelAnalysisResult;
    try {
      const workerOutcome = await runPixelAnalysisInWorker(block);
      if (!workerOutcome.ok) {
        result = analyzeImageBlock(block);
      } else {
        result = workerOutcome.result;
      }
    } catch {
      result = analyzeImageBlock(block);
    }

    const detection = analysisToDetection(result, imageData);
    return detection ? [detection] : [];
  },
});

export function selectInferenceBackend(task: string): VisionInference {
  if (task === "face_detection" || task === "ocr" || task === "layout_detection") {
    const shape = shapeDetectionBackend();
    const pixel = pixelAnalysisBackend();
    return {
      name: "hybrid-backend",
      detect: async (imageData: ImageData): Promise<VisionDetection[]> => {
        const shapeResults = shape ? await shape.detect(imageData) : [];
        const pixelResults = await pixel.detect(imageData);
        return [...shapeResults, ...pixelResults];
      },
    };
  }
  return pixelAnalysisBackend();
}