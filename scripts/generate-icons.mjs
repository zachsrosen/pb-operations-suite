/**
 * Generates app icons (192x192, 512x512, 180x180 apple-touch-icon)
 * from an inline SVG using the Canvas API via a local HTML page.
 *
 * Run with: node scripts/generate-icons.mjs
 * Requires: npm install -D sharp (one-time)
 */

import sharp from "sharp";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(__dirname, "../public/icons");

// Orange grid squares icon — clean, no overlap.
// 3×2 grid of rounded-corner octagons on a near-black background.
const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- Background -->
  <rect width="512" height="512" rx="0" fill="#0a0a0f"/>

  <!-- 3×2 grid of orange rounded squares, centered -->
  <!-- Square size: 110×110, gap: 18, grid: 366×238, offset: x=73, y=137 -->

  <!-- Row 1 -->
  <rect x="73"  y="137" width="110" height="110" rx="20" fill="#F49B04"/>
  <rect x="201" y="137" width="110" height="110" rx="20" fill="#F49B04"/>
  <rect x="329" y="137" width="110" height="110" rx="20" fill="#F49B04"/>

  <!-- Row 2 -->
  <rect x="73"  y="265" width="110" height="110" rx="20" fill="#F49B04"/>
  <rect x="201" y="265" width="110" height="110" rx="20" fill="#F49B04"/>
  <rect x="329" y="265" width="110" height="110" rx="20" fill="#F49B04"/>
</svg>`;

const svgBuffer = Buffer.from(svgIcon);

async function generateIcon(size, filename) {
  const outputPath = resolve(iconsDir, filename);
  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(outputPath);
  console.log(`✓ ${filename} (${size}×${size})`);
}

await generateIcon(192, "icon-192.png");
await generateIcon(512, "icon-512.png");
await generateIcon(180, "apple-touch-icon.png");

console.log("\nDone. Icons written to public/icons/");
