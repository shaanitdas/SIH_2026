import { SensitiveEntity, UiElement } from "@sih/shared";

export function redactElements(
  elements: UiElement[],
  entities: SensitiveEntity[],
): UiElement[] {
  return elements.map((element) => {
    const related = entities.filter((entity) => entity.id.startsWith(element.id));

    if (!related.length) {
      return { ...element, sensitivity: "public", redactedText: element.text };
    }

    let redactedText = element.text;
    for (const entity of related) {
      redactedText = redactedText.replace(/\S+/g, entity.token);
    }

    return {
      ...element,
      sensitivity: "sensitive",
      redactedText,
    };
  });
}
