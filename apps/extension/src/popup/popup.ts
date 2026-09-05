interface TabSummaryMessage {
  type: "TM_TAB_SUMMARY";
  summary: {
    piiCount: number;
    redactedCount: number;
    privacyScore: number;
  };
}

async function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

const goalInput = document.getElementById("goal") as HTMLTextAreaElement | null;
const runButton = document.getElementById("runBtn") as HTMLButtonElement | null;
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const piiCount = document.getElementById("piiCount");
const redactedCount = document.getElementById("redactedCount");
const privacyScore = document.getElementById("privacyScore");

function setStatus(state: "online" | "busy" | "error", text: string): void {
  statusDot?.classList.remove("online", "busy", "error");
  statusDot?.classList.add(state);
  if (statusText) statusText.textContent = text;
}

function refreshSummaryFromMessage(message: unknown): void {
  const msg = message as TabSummaryMessage;
  if (msg?.type === "TM_TAB_SUMMARY" && msg.summary && chrome.runtime?.lastError === undefined) {
    if (piiCount) piiCount.textContent = String(msg.summary.piiCount);
    if (redactedCount) redactedCount.textContent = String(msg.summary.redactedCount);
    if (privacyScore) privacyScore.textContent = `${Math.round(msg.summary.privacyScore * 100)}%`;
  }
}

async function loadSummary(): Promise<void> {
  const tab = await queryActiveTab();
  if (!tab?.id) {
    setStatus("error", "No active tab.");
    return;
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "TM_TAB_SUMMARY" });
    refreshSummaryFromMessage(response);
    setStatus("online", "Agent ready");
    if (runButton) runButton.disabled = false;
  } catch {
    setStatus("error", "Reload this tab, then retry.");
    if (runButton) runButton.disabled = true;
  }
}

async function runTask(): Promise<void> {
  const goal = goalInput?.value.trim();
  if (!goal) return;
  const tab = await queryActiveTab();
  if (!tab?.id) {
    setStatus("error", "No active tab.");
    return;
  }
  setStatus("busy", "Agent working… (consent prompt may appear on the page)");
  try {
    const response = await chrome.runtime.sendMessage({ type: "RUN_TASK", tabId: tab.id, goal });
    if (response?.error) {
      setStatus("error", response.error);
    } else {
      setStatus("online", "Task finished");
      await loadSummary();
    }
  } catch (error) {
    setStatus("error", error instanceof Error ? error.message : "Agent failed");
  }
}

runButton?.addEventListener("click", () => void runTask());
void loadSummary();