interface CaptureRequest {
  type: "CAPTURE_VISIBLE_TAB";
}

interface PingRequest {
  type: "PING";
}

interface RunTaskRequest {
  type: "RUN_TASK";
  tabId: number;
  goal: string;
}

export type BackgroundMessage = CaptureRequest | PingRequest | RunTaskRequest;

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const msg = message as BackgroundMessage;
  if (msg.type === "PING") {
    sendResponse({ ok: true, source: "privacyguard-background" });
    return false;
  }

  if (msg.type === "CAPTURE_VISIBLE_TAB") {
    const tabId = sender.tab?.id;
    if (tabId === undefined) {
      sendResponse({ ok: false, error: "No sender tab." });
      return false;
    }
    chrome.tabs
      .captureVisibleTab(tabId, { format: "png" })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }

  if (msg.type === "RUN_TASK") {
    chrome.tabs
      .sendMessage(msg.tabId, { type: "TM_RUN_TASK", goal: msg.goal })
      .then((response) => sendResponse(response ?? { ok: true }))
      .catch((error) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  console.info("[PrivacyGuard] Installed. The agent only ships typed tokens to the planner.");
});