import { RuntimeProfile, SelectedVisionModel } from "@sih/shared";

export interface ModelLoadResult {
  loaded: boolean;
  backend: RuntimeProfile["executionMode"];
  warmupMs: number;
  notes: string[];
}

export async function loadSelectedModel(
  selected: SelectedVisionModel,
  profile: RuntimeProfile,
): Promise<ModelLoadResult> {
  const baseline = selected.descriptor.expectedLatencyMs[profile.executionMode];
  const warmupMs = Math.max(8, Math.round(baseline * 0.6));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  return {
    loaded: true,
    backend: profile.executionMode,
    warmupMs,
    notes: [
      `Model prepared in ${profile.executionMode} mode.`,
      `Estimated warmup ${warmupMs}ms for ${selected.descriptor.name}.`,
    ],
  };
}
