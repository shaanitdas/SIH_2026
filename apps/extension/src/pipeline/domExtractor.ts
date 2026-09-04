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

export function extractVisibleDom(maxElements = 200): UiElement[] {
  const selector = "button, input, textarea, a, select, [role], [contenteditable='true']";
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector)).slice(
    0,
    maxElements,
  );

  return nodes.map((node, index) => {
    const rect = node.getBoundingClientRect();
    const role = node.getAttribute("role") ?? node.tagName.toLowerCase();

    return {
      id: `el_${index + 1}`,
      role,
      text: (node.innerText || node.textContent || "").trim().slice(0, 120),
      placeholder: node.getAttribute("placeholder") ?? undefined,
      valueHint:
        node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
          ? node.type === "password"
            ? "password"
            : node.value.slice(0, 60)
          : undefined,
      domPath: getDomPath(node),
      bounds: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        confidence: 1,
      },
      sensitivity: "public",
    };
  });
}
