#!/usr/bin/env npx tsx
/**
 * generate-equipment-assets-gemini.ts
 *
 * Uses Google Gemini image generation to create photorealistic equipment PNG
 * assets for DA photo composition. Outputs to the same assets directory used
 * by compose-equipment-photo.ts.
 *
 * Usage:
 *   npx tsx scripts/generate-equipment-assets-gemini.ts               # all assets
 *   npx tsx scripts/generate-equipment-assets-gemini.ts --key battery  # single asset
 *   npx tsx scripts/generate-equipment-assets-gemini.ts --model gemini-2.0-flash-exp
 *
 * Requires GEMINI_API_KEY in .env.local or environment.
 */

import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import path from "path";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import {
  EQUIPMENT_VISUALS,
  type EquipmentKey,
} from "../.claude/skills/design-approval-photo/equipment-config";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Load .env.local if present
const envPath = path.resolve(__dirname, "../.env.local");
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    let val = trimmed.slice(eqIdx + 1);
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

const DEFAULT_MODEL = "gemini-2.0-flash-exp-image-generation";

const ASSETS_DIR = path.resolve(
  __dirname,
  "../.claude/skills/design-approval-photo/assets",
);
mkdirSync(ASSETS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Equipment image prompts
// ---------------------------------------------------------------------------

interface EquipmentPrompt {
  key: EquipmentKey;
  prompt: string;
  aspectRatio: number; // width / height (< 1 = portrait)
}

const EQUIPMENT_PROMPTS: EquipmentPrompt[] = [
  {
    key: "battery",
    aspectRatio: 26 / 43.25, // ~0.6
    prompt: `Product photo of a Tesla Powerwall 3 home battery.
Front-facing view showing the complete unit.
It is a sleek, flat, white/light gray rectangular wall-mounted panel, approximately 43 inches tall by 26 inches wide.
Smooth minimalist surface with very subtle Tesla "T" logo near the top center.
Small green LED status indicator light near the bottom.
Clean rounded corners, modern industrial design.
The unit appears to be a single seamless white panel with minimal visible seams.
Isolated product shot on a plain solid white background, no shadows, no reflections, no mounting hardware visible.
Professional product photography style, studio lighting, high resolution.`,
  },
  {
    key: "expansion",
    aspectRatio: 26 / 43.25,
    prompt: `Product photo of a Tesla Powerwall 3 Expansion Kit (battery expansion unit).
Front-facing view showing the complete unit.
Same form factor as the Tesla Powerwall 3 — flat, white/light gray rectangular wall-mounted panel, approximately 43 inches tall by 26 inches wide.
Very similar to the Powerwall 3 but with a subtle light blue accent strip or indicator to distinguish it.
Small LED status indicator light near the bottom.
Clean rounded corners, modern industrial design.
Isolated product shot on a plain solid white background, no shadows, no reflections.
Professional product photography style, studio lighting, high resolution.`,
  },
  {
    key: "gateway",
    aspectRatio: 7 / 13, // ~0.54
    prompt: `Product photo of a Tesla Backup Gateway 3 (home energy management device).
Front-facing view showing the complete unit.
Small white rectangular wall-mounted box, approximately 13 inches tall by 7 inches wide by 2 inches deep.
Smooth white plastic housing with subtle Tesla branding.
Row of small LED indicator lights (green, amber) near the top.
Slim, compact form factor — much smaller than a Powerwall.
Isolated product shot on a plain solid white background, no shadows, no reflections.
Professional product photography style, studio lighting, high resolution.`,
  },
  {
    key: "backup_switch",
    aspectRatio: 10 / 15, // ~0.67
    prompt: `Product photo of a Tesla Backup Switch (electrical transfer switch).
Front-facing view showing the complete unit.
Gray metal electrical enclosure, approximately 15 inches tall by 10 inches wide.
Industrial-style gray painted metal housing with "TESLA" branding on the front.
"BACKUP SWITCH" label visible on the front face.
A yellow warning label/sticker near the bottom.
Metal latch or handle on the front.
Standard electrical equipment appearance — utilitarian, professional.
Isolated product shot on a plain solid white background, no shadows, no reflections.
Professional product photography style, studio lighting, high resolution.`,
  },
  {
    key: "disconnect",
    aspectRatio: 6 / 10, // 0.6
    prompt: `Product photo of an AC disconnect switch (outdoor electrical disconnect box).
Front-facing view showing the complete unit.
Gray painted metal NEMA-rated outdoor enclosure, approximately 10 inches tall by 6 inches wide.
Has a metal handle/lever on the front for switching between ON and OFF positions.
"ON" and "OFF" labels visible near the handle.
"AC DISCONNECT" or "DISCONNECT" label on the front face.
Rugged outdoor-rated electrical equipment appearance.
Isolated product shot on a plain solid white background, no shadows, no reflections.
Professional product photography style, studio lighting, high resolution.`,
  },
  {
    key: "main_panel",
    aspectRatio: 16 / 24, // ~0.67
    prompt: `Product photo of a residential electrical main breaker panel (load center).
Front-facing view with the panel door CLOSED.
Gray painted metal enclosure, approximately 24 inches tall by 16 inches wide.
Has "MAIN PANEL" or manufacturer label on the door.
Metal door with a latch, typical residential electrical panel appearance.
Standard Square D, Siemens, or Eaton style main breaker panel.
Slightly worn/used appearance is fine — this represents existing equipment on-site.
Isolated product shot on a plain solid white background, no shadows, no reflections.
Professional product photography style, studio lighting, high resolution.`,
  },
  {
    key: "sub_panel",
    aspectRatio: 12 / 18, // ~0.67
    prompt: `Product photo of a residential electrical sub-panel (auxiliary load center).
Front-facing view with the panel door CLOSED.
Gray painted metal enclosure, approximately 18 inches tall by 12 inches wide.
Smaller than a main breaker panel but similar style.
Has "SUB PANEL" or manufacturer label visible.
Metal door with a latch, standard residential electrical panel look.
Isolated product shot on a plain solid white background, no shadows, no reflections.
Professional product photography style, studio lighting, high resolution.`,
  },
  {
    key: "meter",
    aspectRatio: 7 / 10, // 0.7
    prompt: `Product photo of a kilowatt-hour electricity production meter (revenue-grade PV meter).
Front-facing view showing the complete unit.
Gray metal base plate with a clear glass or plastic dome/cover over the meter mechanism.
Digital LCD display showing numbers (e.g., "0000.0 kWh").
"kWh" label visible on the meter face.
Standard utility-style electricity meter mounted on a gray metal base.
Approximately 10 inches tall by 7 inches wide overall.
Isolated product shot on a plain solid white background, no shadows, no reflections.
Professional product photography style, studio lighting, high resolution.`,
  },
  {
    key: "inverter",
    aspectRatio: 15 / 20, // 0.75
    prompt: `Product photo of a solar string inverter (grid-tied PV inverter).
Front-facing view showing the complete unit.
White or light gray rectangular wall-mounted box, approximately 20 inches tall by 15 inches wide.
Ventilation grilles/fins on the sides or bottom for heat dissipation.
Small LED status indicators (green for normal operation, amber for warning, red for fault).
"INVERTER" or manufacturer label on the front face.
Modern clean design with rounded corners.
Isolated product shot on a plain solid white background, no shadows, no reflections.
Professional product photography style, studio lighting, high resolution.`,
  },
  {
    key: "ev_charger",
    aspectRatio: 7 / 18, // ~0.39
    prompt: `Product photo of a Tesla Wall Connector (Gen 3 EV charger).
Front-facing view showing the complete unit.
Sleek white rectangular wall-mounted unit, approximately 18 inches tall by 7 inches wide.
Rounded front face with a subtle LED light bar/ring that glows when active.
The Tesla "T" logo centered on the front face.
Integrated cable holster on the side or bottom for the charging cable.
Modern, minimalist industrial design — premium home appliance appearance.
Isolated product shot on a plain solid white background, no shadows, no reflections.
Professional product photography style, studio lighting, high resolution.`,
  },
];

// ---------------------------------------------------------------------------
// Gemini image generation
// ---------------------------------------------------------------------------

async function generateImage(
  ai: GoogleGenAI,
  model: string,
  prompt: string,
): Promise<Buffer | null> {
  // Strategy 1: Try Gemini native image generation (generateContent with IMAGE modality)
  try {
    console.log(`  Trying ${model} (native image gen)...`);
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseModalities: ["IMAGE", "TEXT"],
      },
    });

    // Extract image from response parts
    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("image/")) {
          return Buffer.from(part.inlineData.data, "base64");
        }
      }
    }
    console.log("  No image in native response, trying Imagen...");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  Native image gen failed: ${message}`);
  }

  // Strategy 2: Try Imagen dedicated image generation API
  try {
    console.log("  Trying imagen-4.0-fast-generate-001...");
    const response = await ai.models.generateImages({
      model: "imagen-4.0-fast-generate-001",
      prompt,
      config: {
        numberOfImages: 1,
      },
    });

    const imageData = response?.generatedImages?.[0]?.image?.imageBytes;
    if (imageData) {
      return Buffer.from(imageData, "base64");
    }
    console.warn("  Imagen returned no image data");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  Imagen failed: ${message}`);
  }

  console.error("  All image generation strategies failed");
  return null;
}

// ---------------------------------------------------------------------------
// Post-process: remove white background → transparent
// ---------------------------------------------------------------------------

async function removeWhiteBackground(inputBuffer: Buffer): Promise<Buffer> {
  // Get raw pixel data
  const { data, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);

  // Replace near-white pixels with transparent
  const threshold = 235; // pixels with all channels > 235 → transparent
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];

    if (r > threshold && g > threshold && b > threshold) {
      pixels[i + 3] = 0; // set alpha to 0
    }
  }

  // Also soften edges: pixels near-white get partial transparency
  const softThreshold = 220;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];

    if (a > 0 && r > softThreshold && g > softThreshold && b > softThreshold) {
      // Fade based on how close to white
      const brightness = (r + g + b) / 3;
      const fade = Math.max(0, (brightness - softThreshold) / (threshold - softThreshold));
      pixels[i + 3] = Math.round(a * (1 - fade * 0.7));
    }
  }

  return sharp(Buffer.from(pixels), {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Parse CLI args
  const args = process.argv.slice(2);
  let filterKey: string | null = null;
  let model = DEFAULT_MODEL;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--key" && args[i + 1]) {
      filterKey = args[++i];
    } else if (args[i] === "--model" && args[i + 1]) {
      model = args[++i];
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`Usage: npx tsx scripts/generate-equipment-assets-gemini.ts [options]

Options:
  --key <equipment_key>   Generate only this equipment type (e.g., battery, gateway)
  --model <model_name>    Gemini model to use (default: ${DEFAULT_MODEL})
  --help                  Show this help message

Equipment keys: ${Object.keys(EQUIPMENT_VISUALS).join(", ")}
`);
      process.exit(0);
    }
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Error: GEMINI_API_KEY not set. Add it to .env.local or export it.");
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  // Filter to specific key if requested
  const prompts = filterKey
    ? EQUIPMENT_PROMPTS.filter((p) => p.key === filterKey)
    : EQUIPMENT_PROMPTS;

  if (prompts.length === 0) {
    console.error(`Unknown equipment key: "${filterKey}"`);
    console.error(`Valid keys: ${Object.keys(EQUIPMENT_VISUALS).join(", ")}`);
    process.exit(1);
  }

  console.log(`Generating ${prompts.length} equipment asset(s) via Gemini...`);
  console.log(`Model: ${model}`);
  console.log(`Output: ${ASSETS_DIR}\n`);

  let success = 0;
  let failed = 0;

  for (const ep of prompts) {
    const outFile = path.join(ASSETS_DIR, `${ep.key}.png`);
    console.log(`[${ep.key}] Generating...`);

    // Try up to 2 attempts
    let imageBuffer: Buffer | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt > 1) {
        console.log(`  Retry attempt ${attempt}...`);
        await sleep(2000);
      }
      imageBuffer = await generateImage(ai, model, ep.prompt);
      if (imageBuffer) break;
    }

    if (!imageBuffer) {
      console.error(`  FAILED — no image generated for ${ep.key}`);
      failed++;
      continue;
    }

    console.log(`  Raw image: ${(imageBuffer.length / 1024).toFixed(0)}KB`);

    // Post-process: remove white background
    console.log(`  Removing white background...`);
    const transparentBuffer = await removeWhiteBackground(imageBuffer);

    // Resize to standard height (600px) maintaining aspect ratio
    const finalBuffer = await sharp(transparentBuffer)
      .resize({ height: 600, fit: "inside" })
      .png()
      .toBuffer();

    writeFileSync(outFile, finalBuffer);
    const finalSize = (finalBuffer.length / 1024).toFixed(0);
    console.log(`  Saved: ${outFile} (${finalSize}KB)\n`);

    success++;

    // Rate limit: 1s delay between calls
    if (prompts.indexOf(ep) < prompts.length - 1) {
      await sleep(1000);
    }
  }

  console.log(`\nDone! ${success} succeeded, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run when executed directly
const isMain =
  process.argv[1]?.endsWith("generate-equipment-assets-gemini.ts") ||
  process.argv[1]?.endsWith("generate-equipment-assets-gemini");

if (isMain) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
