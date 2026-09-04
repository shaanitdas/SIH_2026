import { ActionPlan } from "@sih/shared";

function resolveTarget(targetElementId?: string): HTMLElement | null {
  if (!targetElementId) return null;
  return document.querySelector<HTMLElement>(`[data-agent-id='${targetElementId}']`);
}

export function executePlan(plan: ActionPlan): void {
  for (const action of plan.actions) {
    if (action.type === "WAIT") {
      continue;
    }

    if (action.type === "SCROLL") {
      window.scrollBy({ top: 250, behavior: "smooth" });
      continue;
    }

    if (action.type === "CLICK") {
      const target = resolveTarget(action.targetElementId);
      target?.click();
      continue;
    }

    if (action.type === "TYPE") {
      const target = resolveTarget(action.targetElementId);
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.value = action.value ?? "";
      }
    }
  }
}
