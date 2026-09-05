import { chromium } from "@playwright/test";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const extensionPath = path.resolve(__dirname, "../../apps/extension/dist");

if (!existsSync(path.join(extensionPath, "manifest.json"))) {
  throw new Error(
    `Extension not built at ${extensionPath}. Run "npm run build" (or "npm run e2e") first.`,
  );
}

export interface ExtensionContextHandle {
  context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>;
  extensionId: string | undefined;
  extensionPath: string;
  close: () => Promise<void>;
}

/**
 * Launches a real Chromium process with the built MV3 extension loaded via
 * --load-extension (the same "Load unpacked" path a human would use).
 *
 * Extensions require Chrome's full build, so:
 *  - locally this defaults to Playwright's bundled Chromium in **headed** mode
 *    (set E2E_HEADED=1 explicitly; headless bundled Chromium is the
 *    extension-free "headless shell" build),
 *  - on CI we use the system Google Chrome via E2E_CHANNEL=chrome where even
 *    headless mode runs the full browser.
 */
export async function launchExtensionContext(): Promise<ExtensionContextHandle> {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), "pg-e2e-"));
  const channel = process.env.E2E_CHANNEL || undefined;
  const headless = channel === "chrome" ? process.env.E2E_HEADED !== "1" : false;

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel,
    headless,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  });

  let extensionId: string | undefined;
  const captureIdFromWorker = (url: string): boolean => {
    const match = /^chrome-extension:\/\/([a-p]{32})\//.exec(url);
    if (match) {
      extensionId = match[1];
      return true;
    }
    return false;
  };

  context.serviceWorkers().forEach((worker) => captureIdFromWorker(worker.url()));
  context.on("serviceworker", (worker) => {
    captureIdFromWorker(worker.url());
  });

  if (!extensionId) {
    await context.waitForEvent("serviceworker", { timeout: 15_000 }).catch(() => undefined);
  }

  return {
    context,
    extensionId,
    extensionPath,
    close: async () => {
      await context.close();
      void userDataDir;
    },
  };
}