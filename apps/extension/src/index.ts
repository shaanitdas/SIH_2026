import { runAgentCycle, AgentCycleOptions, AgentCycleResult } from "./pipeline/agentCycle.js";
import { consentOverlayUi } from "./ui/consentOverlay.js";
import { logAgentExecution } from "./ui/executionLog.js";

export const DEFAULT_SERVER_URL = "http://localhost:8080";

export function createAgentCycleOptions(
  overrides: Partial<AgentCycleOptions> = {},
): AgentCycleOptions {
  return {
    serverUrl: DEFAULT_SERVER_URL,
    consentMode: "balanced",
    consentUi: consentOverlayUi,
    maxReplanAttempts: 2,
    allowOfflinePlan: true,
    ...overrides,
  };
}

export async function runAgentCycleOnPage(userGoal: string): Promise<AgentCycleResult> {
  const options = createAgentCycleOptions();
  const result = await runAgentCycle(userGoal, options);
  logAgentExecution(result);
  return result;
}

export { runAgentCycle } from "./pipeline/agentCycle.js";
export type { AgentCycleOptions, AgentCycleResult } from "./pipeline/agentCycle.js";