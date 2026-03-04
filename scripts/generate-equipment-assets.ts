#!/usr/bin/env npx tsx
/**
 * generate-equipment-assets.ts
 *
 * Generates photorealistic equipment PNG assets for DA photo composition.
 * Each asset is a high-resolution render (600px tall) with proper proportions,
 * gradients, shadows, and branding that closely mimic the real products.
 *
 * Usage:
 *   npx tsx scripts/generate-equipment-assets.ts
 *
 * Outputs to: .claude/skills/design-approval-photo/assets/
 */

import sharp from "sharp";
import path from "path";
import { mkdirSync } from "fs";

const ASSETS_DIR = path.resolve(
  __dirname,
  "../.claude/skills/design-approval-photo/assets",
);
mkdirSync(ASSETS_DIR, { recursive: true });

// Base height for all renders — will be resized when composited
const BASE_H = 600;

// ---------------------------------------------------------------------------
// Tesla Powerwall 3 — white/light gray flat panel, Tesla T logo
// Real aspect ratio: ~43.25" H x 25.9" W x 7.7" D → portrait, ~1.67:1
// ---------------------------------------------------------------------------
async function generatePW3(): Promise<void> {
  const h = BASE_H;
  const w = Math.round(h / 1.67);

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="pw3body" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="#F7F7F7"/>
      <stop offset="30%" stop-color="#F0F0F0"/>
      <stop offset="70%" stop-color="#E5E5E5"/>
      <stop offset="100%" stop-color="#D8D8D8"/>
    </linearGradient>
    <linearGradient id="pw3edge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#C8C8C8"/>
      <stop offset="100%" stop-color="#B0B0B0"/>
    </linearGradient>
    <filter id="shadow1">
      <feDropShadow dx="3" dy="4" stdDeviation="6" flood-opacity="0.3"/>
    </filter>
    <filter id="innerGlow">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>

  <!-- Drop shadow base -->
  <rect x="8" y="8" width="${w - 16}" height="${h - 16}" rx="12" ry="12"
        fill="#999" filter="url(#shadow1)" opacity="0.5"/>

  <!-- Main body -->
  <rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="10" ry="10"
        fill="url(#pw3body)" stroke="#C0C0C0" stroke-width="1.5"/>

  <!-- Top highlight strip -->
  <rect x="6" y="6" width="${w - 12}" height="3" rx="1.5" fill="white" opacity="0.7"/>

  <!-- Left edge shadow (depth illusion) -->
  <rect x="4" y="4" width="3" height="${h - 8}" rx="1.5" fill="url(#pw3edge)" opacity="0.4"/>

  <!-- Bottom shadow strip -->
  <rect x="6" y="${h - 10}" width="${w - 12}" height="3" rx="1.5" fill="#B0B0B0" opacity="0.3"/>

  <!-- Tesla "T" logo (stylized) -->
  <g transform="translate(${w / 2}, ${h * 0.32})" opacity="0.18">
    <!-- Horizontal bar -->
    <rect x="-${w * 0.14}" y="-${w * 0.02}" width="${w * 0.28}" height="${w * 0.04}" rx="2" fill="#888"/>
    <!-- Vertical stem -->
    <rect x="-${w * 0.025}" y="-${w * 0.02}" width="${w * 0.05}" height="${w * 0.22}" rx="2" fill="#888"/>
  </g>

  <!-- Status LED (bottom center) -->
  <circle cx="${w / 2}" cy="${h * 0.9}" r="4" fill="#10B981" opacity="0.5"/>
  <circle cx="${w / 2}" cy="${h * 0.9}" r="2" fill="#34D399" opacity="0.7"/>

  <!-- Subtle panel seam lines -->
  <line x1="${w * 0.1}" y1="${h * 0.15}" x2="${w * 0.9}" y2="${h * 0.15}" stroke="#D0D0D0" stroke-width="0.5"/>
  <line x1="${w * 0.1}" y1="${h * 0.85}" x2="${w * 0.9}" y2="${h * 0.85}" stroke="#D0D0D0" stroke-width="0.5"/>
</svg>`;

  await sharp(Buffer.from(svg)).png().toFile(path.join(ASSETS_DIR, "battery.png"));
  console.log("✓ battery.png (Powerwall 3)");
}

// ---------------------------------------------------------------------------
// Tesla Gateway 3 — small white box, similar aesthetic to PW3
// Real dimensions: ~14.4" H x 7.6" W → portrait, ~1.9:1
// ---------------------------------------------------------------------------
async function generateGateway3(): Promise<void> {
  const h = Math.round(BASE_H * 0.45); // smaller unit
  const w = Math.round(h / 1.9);

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="gw3body" x1="0" y1="0" x2="0.2" y2="1">
      <stop offset="0%" stop-color="#F5F5F5"/>
      <stop offset="50%" stop-color="#EDEDED"/>
      <stop offset="100%" stop-color="#DCDCDC"/>
    </linearGradient>
    <filter id="gw3shadow">
      <feDropShadow dx="2" dy="3" stdDeviation="4" flood-opacity="0.25"/>
    </filter>
  </defs>

  <rect x="6" y="6" width="${w - 12}" height="${h - 12}" rx="8" ry="8"
        fill="url(#gw3body)" stroke="#BEBEBE" stroke-width="1.2" filter="url(#gw3shadow)"/>

  <!-- Top highlight -->
  <rect x="8" y="8" width="${w - 16}" height="2" rx="1" fill="white" opacity="0.6"/>

  <!-- Tesla T logo (smaller) -->
  <g transform="translate(${w / 2}, ${h * 0.35})" opacity="0.15">
    <rect x="-${w * 0.12}" y="-${w * 0.02}" width="${w * 0.24}" height="${w * 0.04}" rx="1.5" fill="#888"/>
    <rect x="-${w * 0.025}" y="-${w * 0.02}" width="${w * 0.05}" height="${w * 0.18}" rx="1.5" fill="#888"/>
  </g>

  <!-- "GATEWAY" text -->
  <text x="${w / 2}" y="${h * 0.6}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="500"
        font-size="${Math.round(w * 0.1)}" fill="#B0B0B0" letter-spacing="1">GATEWAY</text>

  <!-- Status LEDs -->
  <circle cx="${w * 0.35}" cy="${h * 0.82}" r="3" fill="#10B981" opacity="0.4"/>
  <circle cx="${w * 0.5}" cy="${h * 0.82}" r="3" fill="#10B981" opacity="0.4"/>
  <circle cx="${w * 0.65}" cy="${h * 0.82}" r="3" fill="#10B981" opacity="0.4"/>
</svg>`;

  await sharp(Buffer.from(svg)).png().toFile(path.join(ASSETS_DIR, "gateway.png"));
  console.log("✓ gateway.png (Gateway 3)");
}

// ---------------------------------------------------------------------------
// Tesla Backup Switch — gray metal box with handle
// Real dimensions: ~18" H x 12" W → 1.5:1
// ---------------------------------------------------------------------------
async function generateBackupSwitch(): Promise<void> {
  const h = Math.round(BASE_H * 0.5);
  const w = Math.round(h / 1.5);

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bsBody" x1="0" y1="0" x2="0.15" y2="1">
      <stop offset="0%" stop-color="#D4D4D8"/>
      <stop offset="40%" stop-color="#A1A1AA"/>
      <stop offset="100%" stop-color="#909098"/>
    </linearGradient>
    <filter id="bsShadow">
      <feDropShadow dx="2" dy="3" stdDeviation="4" flood-opacity="0.3"/>
    </filter>
  </defs>

  <!-- Metal body -->
  <rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="4" ry="4"
        fill="url(#bsBody)" stroke="#78788C" stroke-width="1.5" filter="url(#bsShadow)"/>

  <!-- Panel border inset -->
  <rect x="${w * 0.1}" y="${w * 0.1}" width="${w * 0.8}" height="${h - w * 0.2}" rx="2"
        fill="none" stroke="#8888A0" stroke-width="0.8"/>

  <!-- Door handle -->
  <rect x="${w * 0.7}" y="${h * 0.4}" width="${w * 0.06}" height="${h * 0.2}" rx="2"
        fill="#6B7280" stroke="#555" stroke-width="0.5"/>

  <!-- "TESLA" label plate -->
  <rect x="${w * 0.25}" y="${h * 0.12}" width="${w * 0.5}" height="${h * 0.08}" rx="2"
        fill="#E4E4E7" stroke="#B0B0B8" stroke-width="0.5"/>
  <text x="${w / 2}" y="${h * 0.165}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="bold"
        font-size="${Math.round(w * 0.08)}" fill="#71717A" letter-spacing="2">TESLA</text>

  <!-- "BACKUP SWITCH" label -->
  <text x="${w / 2}" y="${h * 0.5}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="600"
        font-size="${Math.round(w * 0.07)}" fill="#52525B">BACKUP</text>
  <text x="${w / 2}" y="${h * 0.58}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="600"
        font-size="${Math.round(w * 0.07)}" fill="#52525B">SWITCH</text>

  <!-- Warning sticker -->
  <rect x="${w * 0.3}" y="${h * 0.72}" width="${w * 0.4}" height="${h * 0.08}" rx="1"
        fill="#FEF3C7" stroke="#D97706" stroke-width="0.5"/>
  <text x="${w / 2}" y="${h * 0.765}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial" font-weight="bold" font-size="${Math.round(w * 0.04)}" fill="#92400E">⚡ CAUTION</text>
</svg>`;

  await sharp(Buffer.from(svg)).png().toFile(path.join(ASSETS_DIR, "backup_switch.png"));
  console.log("✓ backup_switch.png");
}

// ---------------------------------------------------------------------------
// AC Disconnect — standard gray outdoor disconnect box
// Real dimensions: ~12" H x 8" W → 1.5:1
// ---------------------------------------------------------------------------
async function generateDisconnect(): Promise<void> {
  const h = Math.round(BASE_H * 0.4);
  const w = Math.round(h / 1.5);

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="dcBody" x1="0" y1="0" x2="0.1" y2="1">
      <stop offset="0%" stop-color="#C4C4CC"/>
      <stop offset="50%" stop-color="#9CA3AF"/>
      <stop offset="100%" stop-color="#8B8B98"/>
    </linearGradient>
    <filter id="dcShadow">
      <feDropShadow dx="2" dy="2" stdDeviation="3" flood-opacity="0.25"/>
    </filter>
  </defs>

  <!-- Metal body -->
  <rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="3" ry="3"
        fill="url(#dcBody)" stroke="#6B7280" stroke-width="1.5" filter="url(#dcShadow)"/>

  <!-- Inner panel recess -->
  <rect x="${w * 0.12}" y="${h * 0.12}" width="${w * 0.76}" height="${h * 0.76}" rx="2"
        fill="none" stroke="#7C7C8C" stroke-width="0.8"/>

  <!-- Handle/lever -->
  <rect x="${w * 0.6}" y="${h * 0.35}" width="${w * 0.08}" height="${h * 0.3}" rx="3"
        fill="#555" stroke="#444" stroke-width="0.5"/>

  <!-- ON/OFF labels -->
  <text x="${w * 0.35}" y="${h * 0.35}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial" font-weight="bold" font-size="${Math.round(w * 0.08)}" fill="#555">ON</text>
  <text x="${w * 0.35}" y="${h * 0.65}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial" font-weight="bold" font-size="${Math.round(w * 0.08)}" fill="#EF4444">OFF</text>

  <!-- "AC DISCONNECT" label -->
  <text x="${w / 2}" y="${h * 0.92}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial" font-weight="600" font-size="${Math.round(w * 0.065)}" fill="#52525B">DISCONNECT</text>
</svg>`;

  await sharp(Buffer.from(svg)).png().toFile(path.join(ASSETS_DIR, "disconnect.png"));
  console.log("✓ disconnect.png");
}

// ---------------------------------------------------------------------------
// Main Panel — gray electrical panel (existing equipment marker)
// Real dimensions: ~30" H x 24" W → 1.25:1
// ---------------------------------------------------------------------------
async function generateMainPanel(): Promise<void> {
  const h = Math.round(BASE_H * 0.65);
  const w = Math.round(h / 1.25);

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="panelBody" x1="0" y1="0" x2="0.1" y2="1">
      <stop offset="0%" stop-color="#94A3B8"/>
      <stop offset="50%" stop-color="#64748B"/>
      <stop offset="100%" stop-color="#556270"/>
    </linearGradient>
    <filter id="panelShadow">
      <feDropShadow dx="3" dy="4" stdDeviation="5" flood-opacity="0.3"/>
    </filter>
  </defs>

  <!-- Metal body -->
  <rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="4" ry="4"
        fill="url(#panelBody)" stroke="#475569" stroke-width="2" filter="url(#panelShadow)"/>

  <!-- Panel door inset -->
  <rect x="${w * 0.08}" y="${h * 0.06}" width="${w * 0.84}" height="${h * 0.88}" rx="2"
        fill="none" stroke="#4B5563" stroke-width="1"/>

  <!-- Door latch -->
  <rect x="${w * 0.85}" y="${h * 0.45}" width="${w * 0.04}" height="${h * 0.1}" rx="1"
        fill="#374151" stroke="#1F2937" stroke-width="0.5"/>

  <!-- Brand label area -->
  <rect x="${w * 0.15}" y="${h * 0.08}" width="${w * 0.45}" height="${h * 0.06}" rx="1"
        fill="#4B5563" opacity="0.5"/>

  <!-- "MAIN PANEL" text -->
  <text x="${w / 2}" y="${h * 0.5}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="bold"
        font-size="${Math.round(w * 0.09)}" fill="#E2E8F0" opacity="0.7">MAIN PANEL</text>

  <!-- Circuit breaker indicators -->
  <g opacity="0.3">
    ${Array.from({ length: 8 }, (_, i) => {
      const row = Math.floor(i / 2);
      const col = i % 2;
      const bx = w * 0.2 + col * w * 0.35;
      const by = h * 0.3 + row * h * 0.12;
      return `<rect x="${bx}" y="${by}" width="${w * 0.2}" height="${h * 0.04}" rx="1" fill="#1E293B"/>`;
    }).join("\n    ")}
  </g>
</svg>`;

  await sharp(Buffer.from(svg)).png().toFile(path.join(ASSETS_DIR, "main_panel.png"));
  console.log("✓ main_panel.png");
}

// ---------------------------------------------------------------------------
// Production Meter — small round/square meter
// Real dimensions: ~10" H x 8" W → 1.25:1
// ---------------------------------------------------------------------------
async function generateMeter(): Promise<void> {
  const h = Math.round(BASE_H * 0.35);
  const w = Math.round(h / 1.25);

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="meterBody" x1="0" y1="0" x2="0.1" y2="1">
      <stop offset="0%" stop-color="#D1D5DB"/>
      <stop offset="100%" stop-color="#9CA3AF"/>
    </linearGradient>
    <filter id="meterShadow">
      <feDropShadow dx="1" dy="2" stdDeviation="3" flood-opacity="0.25"/>
    </filter>
  </defs>

  <!-- Metal body -->
  <rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="4" ry="4"
        fill="url(#meterBody)" stroke="#6B7280" stroke-width="1.2" filter="url(#meterShadow)"/>

  <!-- Display window -->
  <rect x="${w * 0.15}" y="${h * 0.15}" width="${w * 0.7}" height="${h * 0.4}" rx="3"
        fill="#1F2937" stroke="#374151" stroke-width="0.8"/>

  <!-- LCD digits -->
  <text x="${w / 2}" y="${h * 0.37}" text-anchor="middle" dominant-baseline="central"
        font-family="'Courier New', monospace" font-weight="bold"
        font-size="${Math.round(w * 0.14)}" fill="#22C55E">0000.0</text>

  <!-- "kWh" label -->
  <text x="${w * 0.78}" y="${h * 0.5}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial" font-size="${Math.round(w * 0.06)}" fill="#22C55E">kWh</text>

  <!-- "METER" text -->
  <text x="${w / 2}" y="${h * 0.75}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="600"
        font-size="${Math.round(w * 0.08)}" fill="#4B5563">PV METER</text>
</svg>`;

  await sharp(Buffer.from(svg)).png().toFile(path.join(ASSETS_DIR, "meter.png"));
  console.log("✓ meter.png");
}

// ---------------------------------------------------------------------------
// Solar Inverter — orange/white box (generic)
// Real dimensions: ~24" H x 18" W → 1.33:1
// ---------------------------------------------------------------------------
async function generateInverter(): Promise<void> {
  const h = Math.round(BASE_H * 0.55);
  const w = Math.round(h / 1.33);

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="invBody" x1="0" y1="0" x2="0.15" y2="1">
      <stop offset="0%" stop-color="#E8E8E8"/>
      <stop offset="50%" stop-color="#D4D4D4"/>
      <stop offset="100%" stop-color="#BEBEBE"/>
    </linearGradient>
    <filter id="invShadow">
      <feDropShadow dx="2" dy="3" stdDeviation="4" flood-opacity="0.25"/>
    </filter>
  </defs>

  <!-- Metal body -->
  <rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="6" ry="6"
        fill="url(#invBody)" stroke="#9CA3AF" stroke-width="1.5" filter="url(#invShadow)"/>

  <!-- Vent grille area -->
  <g opacity="0.2">
    ${Array.from({ length: 6 }, (_, i) => {
      const ly = h * 0.15 + i * h * 0.05;
      return `<line x1="${w * 0.15}" y1="${ly}" x2="${w * 0.85}" y2="${ly}" stroke="#666" stroke-width="1"/>`;
    }).join("\n    ")}
  </g>

  <!-- Display/status area -->
  <rect x="${w * 0.2}" y="${h * 0.5}" width="${w * 0.6}" height="${h * 0.18}" rx="3"
        fill="#111827" stroke="#374151" stroke-width="0.8"/>

  <!-- LED indicators -->
  <circle cx="${w * 0.35}" cy="${h * 0.59}" r="4" fill="#22C55E" opacity="0.6"/>
  <circle cx="${w * 0.5}" cy="${h * 0.59}" r="4" fill="#F59E0B" opacity="0.3"/>
  <circle cx="${w * 0.65}" cy="${h * 0.59}" r="4" fill="#EF4444" opacity="0.2"/>

  <!-- Brand label -->
  <text x="${w / 2}" y="${h * 0.8}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="bold"
        font-size="${Math.round(w * 0.09)}" fill="#6B7280">INVERTER</text>

  <!-- Bottom conduit knockouts -->
  <circle cx="${w * 0.3}" cy="${h * 0.93}" r="${w * 0.04}" fill="none" stroke="#888" stroke-width="0.8"/>
  <circle cx="${w * 0.5}" cy="${h * 0.93}" r="${w * 0.04}" fill="none" stroke="#888" stroke-width="0.8"/>
  <circle cx="${w * 0.7}" cy="${h * 0.93}" r="${w * 0.04}" fill="none" stroke="#888" stroke-width="0.8"/>
</svg>`;

  await sharp(Buffer.from(svg)).png().toFile(path.join(ASSETS_DIR, "inverter.png"));
  console.log("✓ inverter.png");
}

// ---------------------------------------------------------------------------
// EV Charger — wall-mounted charger with cable
// ---------------------------------------------------------------------------
async function generateEVCharger(): Promise<void> {
  const h = Math.round(BASE_H * 0.5);
  const w = Math.round(h / 1.3);

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="evBody" x1="0" y1="0" x2="0.15" y2="1">
      <stop offset="0%" stop-color="#F0F0F0"/>
      <stop offset="50%" stop-color="#E0E0E0"/>
      <stop offset="100%" stop-color="#CCCCCC"/>
    </linearGradient>
    <filter id="evShadow">
      <feDropShadow dx="2" dy="3" stdDeviation="4" flood-opacity="0.25"/>
    </filter>
  </defs>

  <!-- Body -->
  <rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="12" ry="12"
        fill="url(#evBody)" stroke="#A0A0A0" stroke-width="1.5" filter="url(#evShadow)"/>

  <!-- Status ring -->
  <circle cx="${w / 2}" cy="${h * 0.35}" r="${w * 0.18}" fill="none"
          stroke="#A855F7" stroke-width="3" opacity="0.5"/>
  <circle cx="${w / 2}" cy="${h * 0.35}" r="${w * 0.15}" fill="none"
          stroke="#A855F7" stroke-width="1.5" opacity="0.3"/>

  <!-- EV icon -->
  <text x="${w / 2}" y="${h * 0.37}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial" font-weight="bold" font-size="${Math.round(w * 0.12)}" fill="#7C3AED" opacity="0.6">⚡</text>

  <!-- "EV CHARGER" text -->
  <text x="${w / 2}" y="${h * 0.62}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="600"
        font-size="${Math.round(w * 0.075)}" fill="#6B7280">EV CHARGER</text>

  <!-- Cable holster -->
  <ellipse cx="${w / 2}" cy="${h * 0.82}" rx="${w * 0.12}" ry="${h * 0.04}"
           fill="#888" stroke="#666" stroke-width="0.8"/>
</svg>`;

  await sharp(Buffer.from(svg)).png().toFile(path.join(ASSETS_DIR, "ev_charger.png"));
  console.log("✓ ev_charger.png");
}

// ---------------------------------------------------------------------------
// Sub-Panel — smaller version of main panel
// ---------------------------------------------------------------------------
async function generateSubPanel(): Promise<void> {
  const h = Math.round(BASE_H * 0.5);
  const w = Math.round(h / 1.4);

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="subBody" x1="0" y1="0" x2="0.1" y2="1">
      <stop offset="0%" stop-color="#B4BCC8"/>
      <stop offset="50%" stop-color="#8896A4"/>
      <stop offset="100%" stop-color="#6E7E8E"/>
    </linearGradient>
    <filter id="subShadow">
      <feDropShadow dx="2" dy="3" stdDeviation="4" flood-opacity="0.25"/>
    </filter>
  </defs>

  <rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="3" ry="3"
        fill="url(#subBody)" stroke="#5B6B7B" stroke-width="1.5" filter="url(#subShadow)"/>

  <!-- Panel door -->
  <rect x="${w * 0.08}" y="${h * 0.06}" width="${w * 0.84}" height="${h * 0.88}" rx="2"
        fill="none" stroke="#566676" stroke-width="0.8"/>

  <!-- Latch -->
  <rect x="${w * 0.84}" y="${h * 0.45}" width="${w * 0.04}" height="${h * 0.1}" rx="1"
        fill="#465566"/>

  <text x="${w / 2}" y="${h * 0.5}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="bold"
        font-size="${Math.round(w * 0.1)}" fill="#D1D5DB" opacity="0.7">SUB PANEL</text>

  <!-- Circuit indicators -->
  <g opacity="0.25">
    ${Array.from({ length: 4 }, (_, i) => {
      const row = Math.floor(i / 2);
      const col = i % 2;
      const bx = w * 0.2 + col * w * 0.35;
      const by = h * 0.35 + row * h * 0.15;
      return `<rect x="${bx}" y="${by}" width="${w * 0.2}" height="${h * 0.04}" rx="1" fill="#2C3C4C"/>`;
    }).join("\n    ")}
  </g>
</svg>`;

  await sharp(Buffer.from(svg)).png().toFile(path.join(ASSETS_DIR, "sub_panel.png"));
  console.log("✓ sub_panel.png");
}

// Also generate expansion (same as PW3 but slightly different shade)
async function generateExpansion(): Promise<void> {
  const h = BASE_H;
  const w = Math.round(h / 1.67);

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="expBody" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="#F5F5F5"/>
      <stop offset="30%" stop-color="#EEEEEE"/>
      <stop offset="70%" stop-color="#E0E0E0"/>
      <stop offset="100%" stop-color="#D4D4D4"/>
    </linearGradient>
    <filter id="expShadow">
      <feDropShadow dx="3" dy="4" stdDeviation="6" flood-opacity="0.3"/>
    </filter>
  </defs>

  <rect x="8" y="8" width="${w - 16}" height="${h - 16}" rx="12" ry="12"
        fill="#999" filter="url(#expShadow)" opacity="0.5"/>

  <rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="10" ry="10"
        fill="url(#expBody)" stroke="#C0C0C0" stroke-width="1.5"/>

  <rect x="6" y="6" width="${w - 12}" height="3" rx="1.5" fill="white" opacity="0.7"/>
  <rect x="4" y="4" width="3" height="${h - 8}" rx="1.5" fill="#BEBEBE" opacity="0.4"/>

  <!-- Tesla T logo -->
  <g transform="translate(${w / 2}, ${h * 0.32})" opacity="0.15">
    <rect x="-${w * 0.14}" y="-${w * 0.02}" width="${w * 0.28}" height="${w * 0.04}" rx="2" fill="#888"/>
    <rect x="-${w * 0.025}" y="-${w * 0.02}" width="${w * 0.05}" height="${w * 0.22}" rx="2" fill="#888"/>
  </g>

  <!-- "EXPANSION" label to distinguish from main PW3 -->
  <text x="${w / 2}" y="${h * 0.52}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="500"
        font-size="${Math.round(w * 0.07)}" fill="#A0A0A0" opacity="0.5">EXPANSION</text>

  <circle cx="${w / 2}" cy="${h * 0.9}" r="4" fill="#60A5FA" opacity="0.5"/>
  <circle cx="${w / 2}" cy="${h * 0.9}" r="2" fill="#93C5FD" opacity="0.7"/>

  <line x1="${w * 0.1}" y1="${h * 0.15}" x2="${w * 0.9}" y2="${h * 0.15}" stroke="#D0D0D0" stroke-width="0.5"/>
  <line x1="${w * 0.1}" y1="${h * 0.85}" x2="${w * 0.9}" y2="${h * 0.85}" stroke="#D0D0D0" stroke-width="0.5"/>
</svg>`;

  await sharp(Buffer.from(svg)).png().toFile(path.join(ASSETS_DIR, "expansion.png"));
  console.log("✓ expansion.png (PW3 Expansion)");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Generating equipment assets...\n");

  await Promise.all([
    generatePW3(),
    generateGateway3(),
    generateBackupSwitch(),
    generateDisconnect(),
    generateMainPanel(),
    generateMeter(),
    generateInverter(),
    generateEVCharger(),
    generateSubPanel(),
    generateExpansion(),
  ]);

  console.log(`\nAll assets saved to: ${ASSETS_DIR}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
