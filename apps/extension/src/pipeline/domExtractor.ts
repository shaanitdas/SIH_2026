import { UiElement } from "@sih/shared";

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

function pickAttributes(node: HTMLElement): Record<string, string> {
  const keys = ["name", "id", "aria-label", "autocomplete", "type", "title"];
  return keys.reduce<Record<string, string>>((acc, key) => {
    const value = node.getAttribute(key);
    if (value) acc[key] = value;
    return acc;
  }, {});
}

export function extractVisibleDom(maxElements = 250): UiElement[] {
  const selector = "button, input, textarea, a, select, [role], [contenteditable='true'], label";
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector))
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    })
    .slice(0, maxElements);

  return nodes.map((node, index) => {
    const rect = node.getBoundingClientRect();
    const role = node.getAttribute("role") ?? node.tagName.toLowerCase();

    return {
      id: `el_${index + 1}`,
      role,
      text: (node.innerText || node.textContent || "").trim().slice(0, 180),
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
    };
  });
}
