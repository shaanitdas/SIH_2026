import {
  BoundingBox,
  SensitiveEntity,
  SelectedVisionModel,
  UiElement,
  VisionObservation,
} from "@sih/shared";
import { captureViewport, cropRegion } from "../capture/screenshot.js";
import { detectPiiInText } from "../privacy/piiDetector.js";
import { selectInferenceBackend, VisionDetection } from "./backends.js";

export interface VisionInferenceOutput {
  entities: SensitiveEntity[];
  observations: VisionObservation[];
}

export interface VisionRunReport {
  captured: boolean;
  regionsAnalyzed: number;
  detections: number;
  backendUsed: string;
  error?: string;
  workerOffloaded?: boolean;
}

export const EMPTY_VISION_OUTPUT: VisionInferenceOutput = { entities: [], observations: [] };

function pageBounds(relative: BoundingBox, obs: VisionObservation, scaleX: number, scaleY: number): BoundingBox {
  return {
    x: obs.bounds.x + relative.x * obs.bounds.width * scaleX,
    y: obs.bounds.y + relative.y * obs.bounds.height * scaleY,
    width: relative.width * obs.bounds.width * scaleX,
    height: relative.height * obs.bounds.height * scaleY,
    confidence: relative.confidence,
  };
}

function detectionBoundsInPage(
  detection: VisionDetection,
  obs: VisionObservation,
  scaleX: number,
  scaleY: number,
): BoundingBox {
  return pageBounds(detection.bounds, obs, scaleX, scaleY);
}

function guessEntityFromDetection(
  detection: VisionDetection,
  obs: VisionObservation,
  scaleX: number,
  scaleY: number,
  idx: number,
): SensitiveEntity[] {
  if (detection.kind === "face") {
    return [
      {
        id: `${obs.id}-face-${idx}`,
        elementId: obs.id,
        type: "FACE",
        confidence: Math.min(0.96, detection.confidence * 0.92),
        source: "vision",
        token: `<FACE_${idx + 1}>`,
        reasons: detection.notes,
        bounds: detectionBoundsInPage(detection, obs, scaleX, scaleY),
      },
    ];
  }

  if ((detection.kind === "text" || detection.kind === "barcode") && detection.rawText) {
    const pii = detectPiiInText(detection.rawText);
    if (pii.length > 0) {
      return pii.map((entity, piiIdx) => ({
        ...entity,
        id: `${obs.id}-${entity.type}-${piiIdx}-${idx}`,
        elementId: obs.id,
        bounds: detectionBoundsInPage(detection, obs, scaleX, scaleY),
      }));
    }
    return [];
  }

  return [
    {
      id: `${obs.id}-region-${idx}`,
      elementId: obs.id,
      type: detection.kind === "region" ? "ADDRESS" : "ACCOUNT",
      confidence: Math.min(0.62, detection.confidence * 0.55),
      source: "vision",
      token: `<VISION_${idx + 1}>`,
      reasons: [...detection.notes, "Low-confidence visual region flagged for user review."],
      bounds: detectionBoundsInPage(detection, obs, scaleX, scaleY),
    },
  ];
}

export async function runVisionFallback(
  observations: VisionObservation[],
  elements: UiElement[],
  selectedModel: SelectedVisionModel,
): Promise<VisionInferenceOutput & { report?: VisionRunReport }> {
  void elements;
  const entities: SensitiveEntity[] = [];
  const report: VisionRunReport = {
    captured: false,
    regionsAnalyzed: 0,
    detections: 0,
    backendUsed: selectedModel.descriptor.id,
  };

  if (observations.length === 0 || typeof window === "undefined") {
    return { ...EMPTY_VISION_OUTPUT, report };
  }

  const capture = await captureViewport();
  if (!capture.ok || !capture.canvas) {
    report.error = capture.error ?? "capture unavailable";
    return { ...EMPTY_VISION_OUTPUT, report };
  }

  report.captured = true;
  const scaleX = capture.canvas.width / Math.max(1, window.innerWidth);
  const scaleY = capture.canvas.height / Math.max(1, window.innerHeight);
  const backend = selectInferenceBackend(selectedModel.descriptor.task);

  const calibratedObservations: VisionObservation[] = [];
  for (const observation of observations) {
    const px = observation.bounds.width * scaleX;
    const py = observation.bounds.height * scaleY;
    if (px * py < 2500) {
      calibratedObservations.push({
        ...observation,
        notes: [...observation.notes, "Blind spot too small to analyze."],
      });
      continue;
    }

    const canvasBounds: BoundingBox = {
      x: observation.bounds.x * scaleX,
      y: observation.bounds.y * scaleY,
      width: px,
      height: py,
      confidence: observation.bounds.confidence,
    };

    const imageData = cropRegion(capture.canvas as HTMLCanvasElement, canvasBounds);
    if (!imageData) {
      calibratedObservations.push(observation);
      continue;
    }

    const detections = await backend.detect(imageData).catch<VisionDetection[]>(() => []);

    for (const detection of detections) {
      const derived = guessEntityFromDetection(detection, observation, scaleX, scaleY, entities.length);
      entities.push(...derived);
      report.detections += 1;
    }
    report.regionsAnalyzed += 1;

    calibratedObservations.push({
      ...observation,
      confidence: Math.min(
        0.95,
        observation.confidence * 0.4 + (detections.length > 0 ? 0.6 : 0.35),
      ),
      notes: [
        ...observation.notes,
        `Inference model: ${selectedModel.descriptor.id} (${backend.name}).`,
        `${detections.length} visual detection(s).`,
      ],
    });
  }

  return {
    entities,
    observations: calibratedObservations,
    report,
  };
}