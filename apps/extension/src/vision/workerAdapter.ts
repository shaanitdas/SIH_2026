import { SelectedVisionModel, UiElement, VisionObservation } from "@sih/shared";
import { runVisionFallback, VisionInferenceOutput, VisionRunReport } from "./inferenceAdapter.js";
import { createAnalysisWorker } from "./workerHost.js";

export interface WorkerBackedVisionOutput extends VisionInferenceOutput {
  workerAvailable: boolean;
  report?: VisionRunReport;
}

export async function runVisionInWorkerLikeMode(
  observations: VisionObservation[],
  elements: UiElement[],
  selectedModel: SelectedVisionModel,
): Promise<WorkerBackedVisionOutput> {
  const workerAvailable = createAnalysisWorker() !== null;
  const output = await runVisionFallback(observations, elements, selectedModel);
  return {
    entities: output.entities,
    observations: output.observations,
    workerAvailable,
    report: output.report
      ? { ...output.report, workerOffloaded: workerAvailable }
      : {
          captured: false,
          regionsAnalyzed: 0,
          detections: 0,
          backendUsed: selectedModel.descriptor.id,
          workerOffloaded: workerAvailable,
        },
  };
}