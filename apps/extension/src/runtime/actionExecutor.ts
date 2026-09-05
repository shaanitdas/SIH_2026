import { ActionPlan, AgentAction, ExecutionResult, SanitizedContext, UiElement } from "@sih/shared";
import { resolveDomTarget, signatureMatches, DomTargetSignature } from "../pipeline/domExtractor.js";

function findElementById(context: SanitizedContext, targetElementId?: string): UiElement | undefined {
  if (!targetElementId) return undefined;
  return context.elements.find((element) => element.id === targetElementId);
}

function resolveTarget(action: AgentAction, context: SanitizedContext): HTMLElement | null {
  const element = findElementById(context, action.targetElementId);
  if (!element) return null;
  const node = resolveDomTarget(element);
  if (!node) return null;

  const signature: DomTargetSignature = {
    role: element.role,
    accessibleName: element.accessibleName,
    bounds: element.bounds,
  };
  if (!signatureMatches(node, signature)) return null;
  return node;
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (valueSetter) {
    valueSetter.call(element, value);
  } else {
    element.value = value;
  }
  const inputEvent =
    typeof InputEvent !== "undefined" ? new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }) : new Event("input", { bubbles: true });
  element.dispatchEvent(inputEvent);
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function resolveTypeValue(value: string, context: SanitizedContext): { resolved: string; missingTokens: string[] } {
  const missingTokens: string[] = [];
  const resolved = value.replace(/<[A-Z]+_\d+>/g, (token) => {
    const entity = context.sensitiveEntities.find((candidate) => candidate.token === token);
    if (entity) return entity.rawValue ?? "";
    missingTokens.push(token);
    return token;
  });
  return { resolved, missingTokens };
}

function executeClick(target: HTMLElement, action: AgentAction): ExecutionResult {
  const started = performance.now();
  target.click();
  return {
    actionId: action.id,
    type: action.type,
    targetElementId: action.targetElementId,
    status: "success",
    message: `Clicked ${target.tagName.toLowerCase()} (${target.getAttribute("role") ?? ""})`,
    latencyMs: performance.now() - started,
  };
}

function executeType(action: AgentAction, target: HTMLElement, context: SanitizedContext): ExecutionResult {
  const started = performance.now();
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    return {
      actionId: action.id,
      type: action.type,
      targetElementId: action.targetElementId,
      status: "failed",
      message: "TYPE target is not a text control",
      latencyMs: 0,
    };
  }

  const rawValue = action.value ?? "";
  const { resolved, missingTokens } = resolveTypeValue(rawValue, context);
  if (missingTokens.length > 0) {
    return {
      actionId: action.id,
      type: action.type,
      targetElementId: action.targetElementId,
      status: "failed",
      message: `Cannot resolve local tokens ${missingTokens.join(", ")}; refusing to type unresolved secrets`,
      latencyMs: 0,
    };
  }

  setNativeValue(target, resolved);
  return {
    actionId: action.id,
    type: action.type,
    targetElementId: action.targetElementId,
    status: "success",
    message: `Typed ${resolved.length} characters into ${target.tagName.toLowerCase()}`,
    latencyMs: performance.now() - started,
  };
}

export function executePlan(plan: ActionPlan, context: SanitizedContext): ExecutionResult[] {
  const results: ExecutionResult[] = [];

  for (const action of plan.actions) {
    const started = performance.now();

    if (action.type === "WAIT") {
      results.push({
        actionId: action.id,
        type: action.type,
        status: "success",
        message: "Wait action acknowledged",
        latencyMs: 0,
      });
      continue;
    }

    if (action.type === "SCROLL") {
      window.scrollBy({ top: 250, behavior: "smooth" });
      results.push({
        actionId: action.id,
        type: action.type,
        status: "success",
        message: "Scrolled down 250px",
        latencyMs: performance.now() - started,
      });
      continue;
    }

    if (action.type === "CONFIRM_REQUIRED") {
      results.push({
        actionId: action.id,
        type: action.type,
        status: "skipped",
        message: "Confirm-required action needs user interaction; skipped in autonomous mode",
        latencyMs: 0,
      });
      continue;
    }

    const target = resolveTarget(action, context);
    if (!target) {
      results.push({
        actionId: action.id,
        type: action.type,
        targetElementId: action.targetElementId,
        status: "failed",
        message: "Target element missing or signature mismatch; page may have changed",
        latencyMs: 0,
      });
      continue;
    }

    if (action.type === "CLICK") {
      results.push(executeClick(target, action));
      continue;
    }

    if (action.type === "TYPE") {
      results.push(executeType(action, target, context));
      continue;
    }
  }

  return results;
}
