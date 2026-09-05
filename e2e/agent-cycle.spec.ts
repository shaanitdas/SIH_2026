import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { launchExtensionContext } from "./helpers/launch-extension";

const TEST_PAGE = "http://127.0.0.1:3020/";

const RAW_VALUES = {
  aadhaar: "2345 6789 0123",
  phone: "+91 98765 43210",
  pan: "ABCDE1234F",
  card: "4111 1111 1111 1111",
  name: "Apple Achterberg",
};

async function runAgent(page: Page, goal: string): Promise<void> {
  const launcher = page.locator("#privacy-guard-launcher-root");
  await launcher.locator(".pg-launcher").click();
  await launcher.locator("textarea").fill(goal);
  await launcher.locator(".pg-run").click();
}

test("full agent cycle in real Chrome: sanitized transport, consent, local execution", async () => {
  const { context, extensionId } = await launchExtensionContext();
  test.info().annotations.push({
    type: "extension",
    description: `Loaded unpacked from ${context ? "context" : ""}${extensionId ? ` (id ${extensionId})` : ""}`,
  });

  const page = await context.newPage();
  const planRequests: string[] = [];
  const consoleLogs: string[] = [];

  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/plan")) {
      const body = request.postData();
      if (body) planRequests.push(body);
    }
  });
  page.on("console", (message) => consoleLogs.push(message.text()));

  await page.goto(TEST_PAGE);

  // Content script injected -> launcher is present on the page.
  await expect(page.locator("#privacy-guard-launcher-root .pg-launcher")).toBeVisible();

  // Background service worker registered with a valid extension id.
  if (extensionId) {
    expect(extensionId).toMatch(/^[a-p]{32}$/);
  }

  await runAgent(page, "Fill the application and click submit");

  // Consent overlay appears with a risk pill and the privacy-scan summary.
  const overlay = page.locator("#privacy-guard-consent-root");
  await expect(overlay.locator(".pg-card")).toBeVisible({ timeout: 20_000 });
  await expect(overlay.locator(".pg-risk").first()).toBeVisible();
  await expect(overlay.locator(".pg-chip").first()).toContainText("PII found");

  // Approve -> the plan (a deterministic CLICK on the submit button) executes locally.
  await overlay.locator(".pg-btn-allow").click();

  await expect(page.locator("#privacy-guard-launcher-root .pg-result")).toContainText(
    "Approved",
    { timeout: 30_000 },
  );
  await expect(page.locator("#status")).toHaveText("Submitted by agent", { timeout: 30_000 });

  // The privacy ledger was written to the console.
  expect(consoleLogs.some((log) => log.includes("[privacy-ledger]"))).toBe(true);

  // ---- The transport contract is enforced end to end on the real wire ----
  expect(planRequests.length).toBeGreaterThanOrEqual(1);
  const payload = JSON.parse(planRequests[planRequests.length - 1]);
  expect(payload.userGoal).toBe("Fill the application and click submit");

  const serialized = JSON.stringify(payload);
  for (const raw of Object.values(RAW_VALUES)) {
    expect(serialized).not.toContain(raw);
  }
  expect(serialized).toMatch(/<AADHAAR_\d+>/);

  for (const element of payload.context.elements ?? []) {
    expect(element.valueHint).toBeUndefined();
    expect(element.attributes).toBeUndefined();
    expect(element.enabled).toBeUndefined();
    expect(element.checked).toBeUndefined();
  }
  for (const entity of payload.context.sensitiveEntities ?? []) {
    expect(entity.token).toMatch(/^<[A-Z_]+_\d+>$/);
    expect(entity.matchText).toBeUndefined();
    expect(entity.rawValue).toBeUndefined();
  }

  await context.close();
});

test("rejecting consent stops the cycle with zero executed actions", async () => {
  const { context } = await launchExtensionContext();
  const page = await context.newPage();
  const planRequests: string[] = [];

  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/plan")) {
      const body = request.postData();
      if (body) planRequests.push(body);
    }
  });

  await page.goto(TEST_PAGE);
  await expect(page.locator("#privacy-guard-launcher-root .pg-launcher")).toBeVisible();

  await runAgent(page, "Fill the application and click submit");

  const overlay = page.locator("#privacy-guard-consent-root");
  await expect(overlay.locator(".pg-card")).toBeVisible({ timeout: 20_000 });
  await overlay.locator(".pg-btn-reject").click();

  await expect(page.locator("#privacy-guard-launcher-root .pg-result")).toContainText(
    "Rejected. 0 action(s) executed.",
    { timeout: 30_000 },
  );
  await expect(page.locator("#status")).toHaveText("ready");

  // The plan WAS requested (observe + plan always run); consent is what stopped action.
  expect(planRequests.length).toBeGreaterThanOrEqual(1);

  await context.close();
});