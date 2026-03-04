#!/usr/bin/env npx tsx
/**
 * compose-equipment-photo.ts
 *
 * Renders equipment placement labels onto a site photo using Sharp.
 *
 * Usage:
 *   npx tsx scripts/compose-equipment-photo.ts <photo> <placements.json> [output]
 *
 * The placements JSON should match the PlacementData interface (see below).
 * Output defaults to the input filename with a `-da.png` suffix.
 */

import sharp from "sharp";
import { readFileSync, existsSync } from "fs";
import path from "path";
import {
  EQUIPMENT_VISUALS,
  type EquipmentKey,
} from "../.claude/skills/design-approval-photo/equipment-config";

// Pre-rendered equipment asset directory
const ASSETS_DIR = path.resolve(
  __dirname,
  "../.claude/skills/design-approval-photo/assets",
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Placement {
  key: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacementData {
  analysis?: string;
  placements: Placement[];
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FALLBACK_COLOR = "#6B7280";
const FALLBACK_TEXT_COLOR = "#FFFFFF";

/** Escape special XML characters in text so it is safe inside SVG. */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Get the pre-rendered PNG asset path for an equipment key.
 * Returns null if no asset exists for this key.
 */
function getAssetPath(key: string): string | null {
  const assetFile = path.join(ASSETS_DIR, `${key}.png`);
  return existsSync(assetFile) ? assetFile : null;
}

/**
 * Build an overlay buffer for a single equipment placement.
 *
 * Strategy: Load pre-rendered PNG asset and resize to placement dimensions.
 * Falls back to a simple colored rectangle for unknown equipment types.
 */
async function buildOverlay(p: Placement): Promise<Buffer> {
  const assetPath = getAssetPath(p.key);

  if (assetPath) {
    // Load asset PNG and resize to target placement dimensions
    return sharp(assetPath)
      .resize(Math.round(p.width), Math.round(p.height), {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
  }

  // Fallback: simple colored rectangle for unknown equipment types
  const visual = EQUIPMENT_VISUALS[p.key as EquipmentKey] ?? undefined;
  const fillColor = visual?.color ?? FALLBACK_COLOR;
  const textColor = visual?.textColor ?? FALLBACK_TEXT_COLOR;

  const displayLabel = p.label || visual?.label || p.key;
  const fontSize = Math.min(24, Math.max(12, Math.round(p.height * 0.3)));

  const svg = `<svg width="${p.width}" height="${p.height}" xmlns="http://www.w3.org/2000/svg">
  <rect
    x="1" y="1"
    width="${p.width - 2}" height="${p.height - 2}"
    rx="4" ry="4"
    fill="${fillColor}" fill-opacity="0.85"
    stroke="white" stroke-width="2"
  />
  <text
    x="${p.width / 2}" y="${p.height / 2}"
    dominant-baseline="central"
    text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-weight="bold"
    font-size="${fontSize}"
    fill="${textColor}"
  >${escapeXml(displayLabel)}</text>
</svg>`;

  return Buffer.from(svg);
}

// ---------------------------------------------------------------------------
// Core composition function (exported for reuse)
// ---------------------------------------------------------------------------

export async function composeEquipmentPhoto(
  photoPath: string,
  placementData: PlacementData,
  outputPath?: string,
): Promise<string> {
  const resolvedPhoto = path.resolve(photoPath);
  const resolvedOutput =
    outputPath
      ? path.resolve(outputPath)
      : resolvedPhoto.replace(/\.[^.]+$/, "-da.png");

  // Read and validate the source image
  const image = sharp(resolvedPhoto);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(
      `Cannot read dimensions from "${resolvedPhoto}". Is it a valid image?`,
    );
  }

  // Build composite inputs: equipment asset + floating label
  const composites: sharp.OverlayOptions[] = [];
  for (const p of placementData.placements) {
    // Equipment asset overlay
    composites.push({
      input: await buildOverlay(p),
      top: Math.round(p.y),
      left: Math.round(p.x),
    });

    // Floating label below the equipment
    const visual = EQUIPMENT_VISUALS[p.key as EquipmentKey] ?? undefined;
    const displayLabel = p.label || visual?.label || p.key;
    const labelColor = visual?.color ?? FALLBACK_COLOR;
    const labelW = Math.max(p.width, 80);
    const labelH = Math.min(28, Math.max(18, Math.round(p.height * 0.12)));
    const labelFontSize = Math.min(16, Math.max(10, Math.round(labelH * 0.6)));
    const labelX = Math.round(p.x + (p.width - labelW) / 2);
    const labelY = Math.round(p.y + p.height + 4);

    // Only add label if it fits within image bounds
    if (labelY + labelH < (metadata.height ?? 9999)) {
      const labelSvg = `<svg width="${labelW}" height="${labelH}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${labelW}" height="${labelH}" rx="4" ry="4"
              fill="${labelColor}" fill-opacity="0.9"/>
        <text x="${labelW / 2}" y="${labelH / 2}" dominant-baseline="central" text-anchor="middle"
              font-family="Arial, Helvetica, sans-serif" font-weight="bold"
              font-size="${labelFontSize}" fill="white">${escapeXml(displayLabel)}</text>
      </svg>`;

      composites.push({
        input: Buffer.from(labelSvg),
        top: labelY,
        left: labelX,
      });
    }
  }

  // Compose and write
  await image.composite(composites).png().toFile(resolvedOutput);

  return resolvedOutput;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const [photoArg, jsonArg, outputArg] = process.argv.slice(2);

  if (!photoArg || !jsonArg) {
    console.error(
      "Usage: npx tsx scripts/compose-equipment-photo.ts <photo> <placements.json> [output]",
    );
    process.exit(1);
  }

  // Parse placements JSON
  const raw = readFileSync(path.resolve(jsonArg), "utf-8");
  const placementData: PlacementData = JSON.parse(raw);

  if (
    !placementData.placements ||
    !Array.isArray(placementData.placements) ||
    placementData.placements.length === 0
  ) {
    console.error("Error: placements array is empty or missing.");
    process.exit(1);
  }

  console.log(
    `Composing ${placementData.placements.length} label(s) onto ${photoArg}...`,
  );

  if (placementData.warnings?.length) {
    for (const w of placementData.warnings) {
      console.warn(`  warning: ${w}`);
    }
  }

  const outFile = await composeEquipmentPhoto(photoArg, placementData, outputArg);
  console.log(`Output: ${outFile}`);
}

// Run when executed directly (not when imported)
const isMainModule =
  process.argv[1]?.endsWith("compose-equipment-photo.ts") ||
  process.argv[1]?.endsWith("compose-equipment-photo");

if (isMainModule) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
