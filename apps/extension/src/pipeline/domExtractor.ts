import { BoundingBox, UiElement } from "@sih/shared";

export interface DomTargetSignature {
  role?: string;
  accessibleName?: string;
  bounds?: BoundingBox;
}

function getDomPath(element: Element): string {
  const path: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const name = current.nodeName.toLowerCase();
    const siblingIndex =
      current.parentElement === null
        ? 1
        : Array.from(current.parentElement.children).indexOf(current) + 1;
    path.unshift(`${name}:nth-child(${siblingIndex})`);
    current = current.parentElement;
  }

  return path.join(" > ");
}

function getAccessibleName(node: HTMLElement): string | undefined {
  const ariaLabel = node.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel.slice(0, 120);
  const labelElement = node.getAttribute("aria-labelledby");
  if (labelElement) {
    const labelledBy = document.getElementById(labelElement);
    if (labelledBy?.textContent) return labelledBy.textContent.trim().slice(0, 120);
  }
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
    const label = node.labels?.[0]?.textContent?.trim();
    if (label) return label.slice(0, 120);
  }
  if (node.title) return node.title.slice(0, 120);
  return undefined;
}

function pickAttributes(node: HTMLElement): Record<string, string> {
  const keys = ["name", "id", "aria-label", "autocomplete", "type", "title"];
  return keys.reduce<Record<string, string>>((acc, key) => {
    const value = node.getAttribute(key);
    if (value) acc[key] = value;
    return acc;
  }, {});
}

function isControl(node: HTMLElement): node is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (
    node instanceof HTMLInputElement ||
    node instanceof HTMLTextAreaElement ||
    node instanceof HTMLSelectElement
  );
}

function truncate(text: string, max = 180): string {
  return text.length <= max ? text : text.slice(0, max);
}

function resolveAgentId(node: HTMLElement): string {
  const existing = node.dataset.agentId;
  if (existing) return existing;
  const agentId = crypto.randomUUID();
  node.dataset.agentId = agentId;
  return agentId;
}

function isVisible(node: HTMLElement): boolean {
  const rect = node.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(node);
  return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
}

export function extractVisibleDom(maxElements = 250): UiElement[] {
  const selector = [
    "button",
    "input",
    "textarea",
    "a",
    "select",
    "img",
    "figure",
    "video",
    "canvas",
    "iframe",
    "dialog",
    "table",
    "form",
    "[role]",
    "[contenteditable='true']",
    "label",
    "[aria-label]",
    "[aria-describedby]",
  ].join(", ");

  const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector))
    .filter(isVisible)
    .slice(0, maxElements);

  return nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    const role = node.getAttribute("role") ?? node.tagName.toLowerCase();
    const agentId = resolveAgentId(node);

    return {
      id: agentId,
      agentId,
      nodeName: node.tagName.toLowerCase(),
      role,
      text: truncate((node.innerText || node.textContent || "").trim()),
      placeholder: node.getAttribute("placeholder") ?? undefined,
      valueHint:
        node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
          ? node.type === "password"
            ? "password"
            : node.value.slice(0, 80)
          : undefined,
      domPath: getDomPath(node),
      bounds: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        confidence: 1,
      },
      attributes: pickAttributes(node),
      sensitivity: "public",
      accessibleName: getAccessibleName(node),
      enabled: isControl(node) ? !node.disabled : undefined,
      checked: node instanceof HTMLInputElement ? node.checked : undefined,
    };
  });
}

function isExecutableTarget(node: HTMLElement): boolean {
  const name = node.tagName.toLowerCase();
  return name !== "body" && name !== "html";
}

export function resolveDomTarget(element: UiElement): HTMLElement | null {
  if (element.agentId) {
    const byAgentId = document.querySelector<HTMLElement>(`[data-agent-id='${element.agentId}']`);
    if (byAgentId && isExecutableTarget(byAgentId)) return byAgentId;
  }
  try {
    const byPath = document.querySelector<HTMLElement>(element.domPath);
    return byPath && isExecutableTarget(byPath) ? byPath : null;
  } catch {
    return null;
  }
}

export function signatureMatches(node: HTMLElement, signature: DomTargetSignature): boolean {
  if (signature.role) {
    const currentRole = node.getAttribute("role") ?? node.tagName.toLowerCase();
    if (signature.role !== currentRole) return false;
  }
  if (signature.accessibleName) {
    if (getAccessibleName(node) !== signature.accessibleName) return false;
  }
  if (signature.bounds) {
    const rect = node.getBoundingClientRect();
    const displacement = Math.hypot(rect.x - signature.bounds.x, rect.y - signature.bounds.y);
    if (displacement > Math.max(240, signature.bounds.width * 1.5)) return false;
  }
  return true;
}