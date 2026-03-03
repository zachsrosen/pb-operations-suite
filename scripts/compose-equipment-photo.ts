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
import { readFileSync } from "fs";
import path from "path";
import {
  EQUIPMENT_VISUALS,
  type EquipmentKey,
} from "../.claude/skills/design-approval-photo/equipment-config";

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
 * Build an SVG buffer for a single equipment label overlay.
 */
function buildLabelSvg(p: Placement): Buffer {
  // Resolve colours from config, falling back to gray for unknown keys
  const visual = EQUIPMENT_VISUALS[p.key as EquipmentKey] ?? undefined;
  const fillColor = visual?.color ?? FALLBACK_COLOR;
  const textColor = visual?.textColor ?? FALLBACK_TEXT_COLOR;

  // Use the placement label if provided, otherwise the config default
  const displayLabel =
    p.label || visual?.label || p.key;

  // Font size: 30% of height, clamped 12-24 px
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

  // Build composite inputs
  const composites: sharp.OverlayOptions[] = placementData.placements.map(
    (p) => ({
      input: buildLabelSvg(p),
      top: Math.round(p.y),
      left: Math.round(p.x),
    }),
  );

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

// Run when executed directly
main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
