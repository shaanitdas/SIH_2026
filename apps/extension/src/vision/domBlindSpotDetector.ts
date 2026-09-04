import { VisionObservation } from "@sih/shared";

function observationFromElement(
  element: HTMLElement,
  kind: VisionObservation["kind"],
  index: number,
): VisionObservation {
  const rect = element.getBoundingClientRect();
  return {
    id: `vision_${kind}_${index + 1}`,
    kind,
    bounds: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      confidence: 0.65,
    },
    sensitivityGuess: "sensitive",
    confidence: 0.65,
    notes: [`DOM-blind ${kind} region`],
  };
}

export function detectDomBlindSpots(): VisionObservation[] {
  const observations: VisionObservation[] = [];

  const canvases = Array.from(document.querySelectorAll<HTMLElement>("canvas"));
  canvases.forEach((canvas, index) => observations.push(observationFromElement(canvas, "canvas", index)));

  const videos = Array.from(document.querySelectorAll<HTMLElement>("video"));
  videos.forEach((video, index) => observations.push(observationFromElement(video, "video", index)));

  const iframes = Array.from(document.querySelectorAll<HTMLElement>("iframe"));
  iframes.forEach((iframe, index) => observations.push(observationFromElement(iframe, "iframe", index)));

  return observations;
}
