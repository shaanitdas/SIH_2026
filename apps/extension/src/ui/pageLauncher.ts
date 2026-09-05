export interface LauncherCallbacks {
  onRun(goal: string): Promise<string>;
}

const LAUNCHER_ROOT_ID = "privacy-guard-launcher-root";

export function attachPageLauncher(callbacks: LauncherCallbacks): () => void {
  const existing = document.getElementById(LAUNCHER_ROOT_ID);
  if (existing) return () => existing.remove();

  const host = document.createElement("div");
  host.id = LAUNCHER_ROOT_ID;
  host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    * { box-sizing: border-box; font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; }
    .pg-launcher {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      background: #1d4ed8; color: #fff; border: 0; border-radius: 999px;
      padding: 10px 16px; font-size: 13px; font-weight: 700; cursor: pointer;
      box-shadow: 0 8px 24px rgba(29, 78, 216, 0.45); display: flex; align-items: center; gap: 8px;
    }
    .pg-panel {
      position: fixed; right: 16px; bottom: 64px; z-index: 2147483646;
      width: 300px; background: #fff; color: #0f172a; border-radius: 14px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.3); padding: 14px; display: none;
    }
    .pg-panel.open { display: block; }
    .pg-panel textarea {
      width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px;
      font-size: 12px; resize: none; min-height: 64px; color: #0f172a;
    }
    .pg-panel .pg-run {
      width: 100%; margin-top: 8px; border: 0; border-radius: 8px; padding: 9px 0;
      background: #16a34a; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer;
    }
    .pg-panel .pg-result {
      margin-top: 8px; font-size: 11px; color: #475569; line-height: 1.5; white-space: pre-wrap;
      max-height: 120px; overflow: auto;
    }
  `;

  const launcher = document.createElement("button");
  launcher.className = "pg-launcher";
  launcher.textContent = "\u{1F6E1} PrivacyGuard";

  const panel = document.createElement("div");
  panel.className = "pg-panel";
  panel.innerHTML = `
    <textarea placeholder="e.g. Find the scholarship form and submit it"></textarea>
    <button class="pg-run">Run agent</button>
    <div class="pg-result"></div>
  `;
  const textarea = panel.querySelector("textarea");
  const runBtn = panel.querySelector(".pg-run");
  const result = panel.querySelector(".pg-result");

  launcher.addEventListener("click", () => panel.classList.toggle("open"));
  runBtn?.addEventListener("click", async () => {
    const goal = textarea?.value.trim();
    if (!goal) return;
    if (result && runBtn instanceof HTMLButtonElement) {
      result.textContent = "Agent working… (approve if prompted)";
      runBtn.disabled = true;
    }
    try {
      const summary = await callbacks.onRun(goal);
      if (result) result.textContent = summary;
    } catch (error) {
      if (result) result.textContent = error instanceof Error ? error.message : "Agent failed";
    } finally {
      if (runBtn instanceof HTMLButtonElement) runBtn.disabled = false;
    }
  });

  host.shadowRoot?.append(style, launcher, panel);
  document.documentElement.append(host);

  return () => host.remove();
}