import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFile(join(root, path), "utf8");

const manifest = JSON.parse(await read("manifest.webmanifest"));
if (manifest.display !== "standalone") throw new Error("Manifest must use standalone display mode");
if (manifest.start_url !== "./" || manifest.scope !== "./") {
  throw new Error("Manifest URLs must remain relative for subpath hosting");
}

for (const icon of manifest.icons) {
  await stat(join(root, icon.src.replace(/^\.\//, "")));
}

const serviceWorker = await read("sw.js");
const shellBlock = serviceWorker.match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[1];
if (!shellBlock) throw new Error("Could not inspect service worker app shell");
const shellAssets = [...shellBlock.matchAll(/"(\.\/[^\"]+)"/g)].map((match) => match[1]);
if (shellAssets.length < 10) throw new Error("Service worker app shell is unexpectedly small");
for (const asset of shellAssets) {
  if (asset === "./") continue;
  await stat(join(root, asset.replace(/^\.\//, "")));
}

const index = await read("index.html");
if (!index.includes('<html lang="ru">')) throw new Error("Document language must be Russian");
if (!index.includes('rel="manifest"')) throw new Error("Manifest link is missing");
if (!index.includes('rel="apple-touch-icon"')) throw new Error("Apple touch icon is missing");

const sourceFiles = [
  "src/app.js",
  "src/constants.js",
  "src/dates.js",
  "src/model.js",
  "src/overview.js",
  "src/storage.js",
  "sw.js",
  "scripts/serve.mjs"
];
for (const sourceFile of sourceFiles) {
  const result = spawnSync(process.execPath, ["--check", join(root, sourceFile)], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${sourceFile}: ${result.stderr}`);
}

process.stdout.write(`Static checks passed (${shellAssets.length} offline assets).\n`);
