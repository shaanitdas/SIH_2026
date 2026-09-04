import { BoundingBox, DataSensitivity, RedactionResult, SensitiveEntity, UiElement } from "@sih/shared";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenizeText(text: string, entity: SensitiveEntity): string {
  if (!entity.matchText) {
    return text.replace(/\S+/g, entity.token);
  }

  const pattern = new RegExp(escapeRegExp(entity.matchText), "gi");
  return text.replace(pattern, entity.token);
}

export function redactElements(elements: UiElement[], entities: SensitiveEntity[]): RedactionResult {
  const tokenMap: Record<string, string> = {};
  const redactedRegions: BoundingBox[] = [];

  const grouped = new Map<string, SensitiveEntity[]>();
  for (const entity of entities) {
    const list = grouped.get(entity.elementId) ?? [];
    list.push(entity);
    grouped.set(entity.elementId, list);
    tokenMap[entity.token] = entity.type;
  }

  const resultElements: UiElement[] = elements.map<UiElement>((element) => {
    const related = grouped.get(element.id) ?? [];
    if (related.length === 0) {
      const sensitivity: DataSensitivity = "public";
      return { ...element, sensitivity, redactedText: element.text };
    }

    let redactedText = element.text;
    let sensitivity: DataSensitivity = "sensitive";

    for (const entity of related) {
      redactedText = tokenizeText(redactedText, entity);
      if (entity.type === "PASSWORD" || entity.confidence < 0.7) {
        sensitivity = "restricted";
      }
    }

    redactedRegions.push(element.bounds);
    return {
      ...element,
      sensitivity,
      redactedText,
    };
  });

  const sensitiveCount = resultElements.filter((element) => element.sensitivity !== "public").length;
  const precisionEstimate = sensitiveCount === 0 ? 1 : Math.max(0.7, 1 - (entities.length - sensitiveCount) / (entities.length + 1));

  return {
    elements: resultElements,
    tokenMap,
    redactedRegions,
    precisionEstimate,
  };
}
