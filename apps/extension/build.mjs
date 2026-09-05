import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const extensionDir = resolve(rootDir, "apps", "extension");
const srcDir = resolve(extensionDir, "src");
const sharedSrc = resolve(rootDir, "packages", "shared", "src", "index.ts");
const distDir = resolve(extensionDir, "dist");

const sharedOptions = {
  bundle: true,
  platform: "browser",
  target: "chrome111",
  sourcemap: false,
  minify: false,
  treeShaking: true,
  legalComments: "none",
  logLevel: "info",
  alias: { "@sih/shared": sharedSrc },
};

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

async function main() {
  await build({
    ...sharedOptions,
    entryPoints: [resolve(srcDir, "content", "contentScript.ts")],
    format: "iife",
    outfile: resolve(distDir, "content", "contentScript.js"),
  });

  await build({
    ...sharedOptions,
    entryPoints: [resolve(srcDir, "background", "serviceWorker.ts")],
    format: "esm",
    outfile: resolve(distDir, "background", "serviceWorker.js"),
  });

  await build({
    ...sharedOptions,
    entryPoints: [resolve(srcDir, "popup", "popup.ts")],
    format: "iife",
    outfile: resolve(distDir, "popup", "popup.js"),
  });

  const manifest = JSON.parse(readFileSync(resolve(extensionDir, "manifest.json"), "utf8"));
  const rewrite = (value) => (typeof value === "string" ? value.replace(/^dist\//, "") : value);
  const deepRewrite = (entry) => {
    if (typeof entry === "string") return rewrite(entry);
    if (Array.isArray(entry)) return entry.map(deepRewrite);
    if (entry && typeof entry === "object") {
      return Object.fromEntries(Object.entries(entry).map(([k, v]) => [k, deepRewrite(v)]));
    }
    return entry;
  };
  writeFileSync(
    resolve(distDir, "manifest.json"),
    JSON.stringify(deepRewrite(manifest), null, 2),
    "utf8",
  );

  await cp(resolve(srcDir, "popup", "popup.html"), resolve(distDir, "popup", "popup.html"));
  await cp(resolve(srcDir, "popup", "popup.css"), resolve(distDir, "popup", "popup.css"));
  await cp(resolve(extensionDir, "scripts", "icons"), resolve(distDir, "icons"), { recursive: true });

  console.log(`[extension] Loadable build at ${distDir}. Install via chrome://extensions → Load unpacked.`);
}

main().catch((error) => {
  console.error("[extension] build failed:", error);
  process.exit(1);
});