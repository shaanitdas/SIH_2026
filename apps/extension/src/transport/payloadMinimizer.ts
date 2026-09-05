import { TransportContext } from "@sih/shared";

const MAX_ELEMENTS = 200;
const MAX_ENTITIES = 150;

export function minimizePayload(context: TransportContext): TransportContext {
  return {
    ...context,
    elements: context.elements.slice(0, MAX_ELEMENTS).map((element) => ({
      ...element,
      text: element.text.slice(0, 150),
      redactedText: element.redactedText?.slice(0, 150),
    })),
    sensitiveEntities: context.sensitiveEntities.slice(0, MAX_ENTITIES),
    redactedRegions: context.redactedRegions.slice(0, MAX_ENTITIES),
    visionObservations: context.visionObservations.slice(0, 60),
  };
}
