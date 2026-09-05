import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const extensionSrc = resolve(rootDir, "apps", "extension", "src");
const outFile = resolve(extensionSrc, "generated", "visionWorkerSource.js");

async function main() {
  const result = await build({
    entryPoints: [resolve(extensionSrc, "vision", "workerEntry.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome111",
    treeShaking: true,
    write: false,
  });

  const code = result.outputFiles[0].text;
  const source = `export const VISION_WORKER_SOURCE = ${JSON.stringify(code)};\n`;

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, source, "utf8");
  console.log(`[embed-worker] wrote ${outFile} (${(source.length / 1024).toFixed(1)} KB)`);
}

main().catch((error) => {
  console.error("[embed-worker] failed:", error);
  process.exit(1);
});