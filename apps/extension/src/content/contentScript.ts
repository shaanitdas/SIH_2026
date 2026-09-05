import { runAgentCycleOnPage } from "../index.js";
import { attachPageLauncher } from "../ui/pageLauncher.js";

interface SummaryMessage {
  type: "TM_TAB_SUMMARY";
  ok: boolean;
  summary?: { piiCount: number; redactedCount: number; privacyScore: number };
}

function buildSummaryResponse(): SummaryMessage {
  return {
    type: "TM_TAB_SUMMARY",
    ok: true,
    summary: { piiCount: 0, redactedCount: 0, privacyScore: 0 },
  };
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const msg = message as { type?: string; goal?: string };
  if (msg.type === "TM_TAB_SUMMARY") {
    sendResponse(buildSummaryResponse());
    return false;
  }
  if (msg.type === "TM_RUN_TASK" && typeof msg.goal === "string") {
    void (async () => {
      const result = await runAgentCycleOnPage(msg.goal as string);
      sendResponse({
        type: "TM_TAB_SUMMARY",
        ok: true,
        summary: {
          piiCount: result.context.sensitiveEntities.length,
          redactedCount: result.context.redactedRegions.length,
          privacyScore: result.context.privacyScore,
        },
      });
    })();
    return true;
  }
  return false;
});

const remove = attachPageLauncher({
  onRun: async (goal) => {
    const result = await runAgentCycleOnPage(goal);
    const executed = result.execution.filter((item) => item.status === "success").length;
    const latency = result.telemetry.toJSON();
    const approved = result.consent.approved ? "Approved" : "Rejected";
    return [
      `${approved}. ${executed} action(s) executed.`,
      `Total ${latency.totalMs}ms across ${Object.keys(latency).length - 1} stages.`,
      "Console holds the full privacy ledger and metric dashboard.",
    ].join("\n");
  },
});

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__removePrivacyGuardLauncher = remove;
}