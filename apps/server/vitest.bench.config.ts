import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const sharedIndex = fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["bench/**/*.bench.ts"],
    alias: { "@sih/shared": sharedIndex },
  },
  resolve: {
    alias: { "@sih/shared": sharedIndex },
  },
});