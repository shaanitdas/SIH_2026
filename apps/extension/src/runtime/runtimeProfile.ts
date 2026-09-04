import { RuntimeProfile } from "@sih/shared";

function hasWebGpu(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export function detectRuntimeProfile(): RuntimeProfile {
  const hardwareConcurrency = navigator.hardwareConcurrency ?? 4;
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const webgpu = hasWebGpu();

  let profileTier: RuntimeProfile["profileTier"] = "lite";
  if (webgpu && hardwareConcurrency >= 8) {
    profileTier = "performance";
  } else if (hardwareConcurrency >= 4) {
    profileTier = "balanced";
  }

  return {
    executionMode: webgpu ? "webgpu" : deviceMemory && deviceMemory >= 4 ? "wasm" : "cpu",
    profileTier,
    hardwareConcurrency,
    deviceMemoryGB: deviceMemory,
  };
}
