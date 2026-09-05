import { webcrypto } from "node:crypto";
import { performance } from "node:perf_hooks";

if (typeof globalThis.crypto === "undefined") {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

Object.defineProperty(globalThis, "performance", { value: performance, writable: true });

const rect = (x = 0, y = 0, width = 10, height = 10) => ({
  x,
  y,
  top: y,
  left: x,
  width,
  height,
  right: x + width,
  bottom: y + height,
  toJSON: () => ({}),
});

Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
  configurable: true,
  value: function getBoundingClientRect() {
    return rect();
  },
});

Object.defineProperty(window, "getComputedStyle", {
  configurable: true,
  value: () => ({
    visibility: "visible",
    display: "block",
    opacity: "1",
  }),
});

Object.defineProperty(window, "scrollBy", {
  configurable: true,
  value: () => undefined,
});