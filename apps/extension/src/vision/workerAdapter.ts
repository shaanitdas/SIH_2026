import { SelectedVisionModel, UiElement, VisionObservation } from "@sih/shared";
import { runVisionFallback, VisionInferenceOutput } from "./inferenceAdapter.js";

export async function runVisionInWorkerLikeMode(
  observations: VisionObservation[],
  elements: UiElement[],
  selectedModel: SelectedVisionModel,
): Promise<VisionInferenceOutput> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return runVisionFallback(observations, elements, selectedModel);
}
