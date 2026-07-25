/**
 * Generate KKCoder brand icon PNG from the V3 Hex Badge SVG.
 * Outputs: src-tauri/app-icon.png (for `tauri icon`) and brand previews.
 *
 * Usage: node scripts/generate-brand-assets.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDirectory, "..");
const brandDirectory = join(projectRoot, "src", "assets", "brand");
const iconsSourcePath = join(projectRoot, "src-tauri", "app-icon.png");
const logoSvgPath = join(brandDirectory, "kkcoder-v3-hex-badge.svg");

function ensureDirectory(directoryPath) {
  if (!existsSync(directoryPath)) {
    mkdirSync(directoryPath, { recursive: true });
  }
}

function renderSvgToPngBuffer(svgSource, width) {
  const renderer = new Resvg(svgSource, {
    fitTo: { mode: "width", value: width },
    background: "rgba(0,0,0,0)",
  });
  return renderer.render().asPng();
}

async function main() {
  ensureDirectory(brandDirectory);
  ensureDirectory(dirname(iconsSourcePath));

  const svgSource = readFileSync(logoSvgPath, "utf8");

  // High-res transparent icon master for Tauri
  const iconMasterPng = renderSvgToPngBuffer(svgSource, 1024);
  writeFileSync(iconsSourcePath, iconMasterPng);
  writeFileSync(join(brandDirectory, "kkcoder-logo-1024.png"), iconMasterPng);

  // Official logo alias (SVG)
  writeFileSync(join(brandDirectory, "kkcoder-logo.svg"), svgSource);

  // Public preview raster
  const previewDirectory = join(projectRoot, "public", "brand-preview");
  ensureDirectory(previewDirectory);
  writeFileSync(join(previewDirectory, "kkcoder-logo-512.png"), renderSvgToPngBuffer(svgSource, 512));

  console.log("Brand assets generated:");
  console.log(`  - ${iconsSourcePath}`);
  console.log(`  - ${join(brandDirectory, "kkcoder-logo.svg")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
