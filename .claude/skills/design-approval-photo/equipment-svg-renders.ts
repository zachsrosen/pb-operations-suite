/**
 * equipment-svg-renders.ts
 *
 * Generates detailed, realistic SVG illustrations of solar/battery equipment
 * for use as overlays in design approval photos. Each function returns an SVG
 * string sized to the given width/height in pixels.
 *
 * Equipment covered:
 *   - Tesla Powerwall 3 (battery)
 *   - Tesla Powerwall 3 Expansion (expansion)
 *   - Tesla Gateway 3 (gateway)
 *   - Tesla Backup Switch (backup_switch)
 *   - AC Disconnect (disconnect)
 *   - Main Panel (main_panel)
 *   - Sub-Panel (sub_panel)
 *   - Production Meter (meter)
 *   - Solar Inverter (inverter)
 *   - EV Charger (ev_charger)
 */

import type { EquipmentKey } from "./equipment-config";

// ---------------------------------------------------------------------------
// Individual equipment SVG renderers
// ---------------------------------------------------------------------------

function svgPowerwall3(w: number, h: number): string {
  // Tesla Powerwall 3 — tall white/light-gray rectangular unit
  // Rounded corners, subtle gradient, Tesla "T" logo, status LED
  const rx = Math.round(w * 0.04);
  const logoSize = Math.round(w * 0.18);
  const logoX = Math.round(w / 2);
  const logoY = Math.round(h * 0.35);
  const ledR = Math.round(w * 0.02);
  const ledY = Math.round(h * 0.88);

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="pw3body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#F5F5F5"/>
      <stop offset="50%" stop-color="#E8E8E8"/>
      <stop offset="100%" stop-color="#D4D4D4"/>
    </linearGradient>
    <filter id="pw3shadow">
      <feDropShadow dx="2" dy="3" stdDeviation="3" flood-opacity="0.35"/>
    </filter>
  </defs>
  <!-- Body -->
  <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="${rx}" ry="${rx}"
        fill="url(#pw3body)" stroke="#B0B0B0" stroke-width="1.5" filter="url(#pw3shadow)"/>
  <!-- Top edge highlight -->
  <rect x="4" y="4" width="${w - 8}" height="${Math.round(h * 0.02)}" rx="2" fill="#FFFFFF" opacity="0.6"/>
  <!-- Tesla "T" logo -->
  <text x="${logoX}" y="${logoY}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="bold"
        font-size="${logoSize}" fill="#C0C0C0" opacity="0.5">T</text>
  <!-- Model text -->
  <text x="${logoX}" y="${Math.round(h * 0.52)}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="600"
        font-size="${Math.round(w * 0.08)}" fill="#A0A0A0" opacity="0.6">POWERWALL 3</text>
  <!-- Status LED -->
  <circle cx="${logoX}" cy="${ledY}" r="${ledR}" fill="#22C55E" opacity="0.8"/>
  <circle cx="${logoX}" cy="${ledY}" r="${Math.round(ledR * 0.5)}" fill="#4ADE80"/>
  <!-- Label banner -->
  <rect x="0" y="${h - Math.round(h * 0.14)}" width="${w}" height="${Math.round(h * 0.14)}"
        fill="#3B82F6" opacity="0.9" rx="0"/>
  <text x="${logoX}" y="${h - Math.round(h * 0.05)}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="bold"
        font-size="${Math.max(11, Math.round(h * 0.07))}" fill="white">POWERWALL 3</text>
</svg>`;
}

function svgExpansion(w: number, h: number): string {
  // Very similar to PW3 but with "EXP" branding and lighter blue banner
  const rx = Math.round(w * 0.04);
  const logoX = Math.round(w / 2);

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="expbody" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#F5F5F5"/>
      <stop offset="50%" stop-color="#E8E8E8"/>
      <stop offset="100%" stop-color="#D4D4D4"/>
    </linearGradient>
    <filter id="expshadow">
      <feDropShadow dx="2" dy="3" stdDeviation="3" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="${rx}" ry="${rx}"
        fill="url(#expbody)" stroke="#B0B0B0" stroke-width="1.5" filter="url(#expshadow)"/>
  <rect x="4" y="4" width="${w - 8}" height="${Math.round(h * 0.02)}" rx="2" fill="#FFFFFF" opacity="0.6"/>
  <text x="${logoX}" y="${Math.round(h * 0.35)}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="bold"
        font-size="${Math.round(w * 0.18)}" fill="#C0C0C0" opacity="0.5">T</text>
  <text x="${logoX}" y="${Math.round(h * 0.52)}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="600"
        font-size="${Math.round(w * 0.07)}" fill="#A0A0A0" opacity="0.6">EXPANSION</text>
  <circle cx="${logoX}" cy="${Math.round(h * 0.88)}" r="${Math.round(w * 0.02)}" fill="#22C55E" opacity="0.8"/>
  <rect x="0" y="${h - Math.round(h * 0.14)}" width="${w}" height="${Math.round(h * 0.14)}"
        fill="#60A5FA" opacity="0.9"/>
  <text x="${logoX}" y="${h - Math.round(h * 0.05)}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="bold"
        font-size="${Math.max(11, Math.round(h * 0.07))}" fill="white">PW3 EXPANSION</text>
</svg>`;
}

function svgGateway3(w: number, h: number): string {
  // Tesla Gateway 3 — small gray box with Tesla branding, status lights
  const rx = Math.round(w * 0.06);
  const cx = Math.round(w / 2);

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="gw3body" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="#9CA3AF"/>
      <stop offset="50%" stop-color="#6B7280"/>
      <stop offset="100%" stop-color="#4B5563"/>
    </linearGradient>
    <filter id="gw3shadow">
      <feDropShadow dx="1" dy="2" stdDeviation="2" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="${rx}" ry="${rx}"
        fill="url(#gw3body)" stroke="#374151" stroke-width="1" filter="url(#gw3shadow)"/>
  <!-- Tesla T -->
  <text x="${cx}" y="${Math.round(h * 0.35)}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="bold"
        font-size="${Math.round(w * 0.22)}" fill="#D1D5DB" opacity="0.5">T</text>
  <!-- Status LEDs row -->
  <circle cx="${Math.round(w * 0.3)}" cy="${Math.round(h * 0.65)}" r="${Math.round(w * 0.03)}" fill="#22C55E"/>
  <circle cx="${Math.round(w * 0.42)}" cy="${Math.round(h * 0.65)}" r="${Math.round(w * 0.03)}" fill="#22C55E"/>
  <circle cx="${Math.round(w * 0.54)}" cy="${Math.round(h * 0.65)}" r="${Math.round(w * 0.03)}" fill="#FBBF24"/>
  <circle cx="${Math.round(w * 0.66)}" cy="${Math.round(h * 0.65)}" r="${Math.round(w * 0.03)}" fill="#22C55E"/>
  <!-- Label banner -->
  <rect x="0" y="${h - Math.round(h * 0.2)}" width="${w}" height="${Math.round(h * 0.2)}"
        fill="#14B8A6" opacity="0.9"/>
  <text x="${cx}" y="${h - Math.round(h * 0.07)}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="bold"
        font-size="${Math.max(10, Math.round(h * 0.1))}" fill="white">GATEWAY 3</text>
</svg>`;
}

function svgBackupSwitch(w: number, h: number): string {
  // Tesla Backup Switch — gray rectangular box
  const rx = Math.round(w * 0.04);
  const cx = Math.round(w / 2);

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="buswbody" x1="0" y1="0" x2="0.2" y2="1">
      <stop offset="0%" stop-color="#D1D5DB"/>
      <stop offset="100%" stop-color="#9CA3AF"/>
    </linearGradient>
    <filter id="buswshadow">
      <feDropShadow dx="1" dy="2" stdDeviation="2" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="${rx}" ry="${rx}"
        fill="url(#buswbody)" stroke="#6B7280" stroke-width="1" filter="url(#buswshadow)"/>
  <!-- Panel lines suggesting internal breakers -->
  <line x1="${Math.round(w * 0.2)}" y1="${Math.round(h * 0.25)}" x2="${Math.round(w * 0.8)}" y2="${Math.round(h * 0.25)}"
        stroke="#6B7280" stroke-width="1" opacity="0.4"/>
  <line x1="${Math.round(w * 0.2)}" y1="${Math.round(h * 0.45)}" x2="${Math.round(w * 0.8)}" y2="${Math.round(h * 0.45)}"
        stroke="#6B7280" stroke-width="1" opacity="0.4"/>
  <line x1="${Math.round(w * 0.2)}" y1="${Math.round(h * 0.65)}" x2="${Math.round(w * 0.8)}" y2="${Math.round(h * 0.65)}"
        stroke="#6B7280" stroke-width="1" opacity="0.4"/>
  <!-- Tesla T -->
  <text x="${cx}" y="${Math.round(h * 0.15)}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial" font-weight="bold" font-size="${Math.round(w * 0.14)}"
        fill="#6B7280" opacity="0.4">T</text>
  <!-- Label banner -->
  <rect x="0" y="${h - Math.round(h * 0.18)}" width="${w}" height="${Math.round(h * 0.18)}"
        fill="#F59E0B" opacity="0.9"/>
  <text x="${cx}" y="${h - Math.round(h * 0.06)}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="bold"
        font-size="${Math.max(10, Math.round(h * 0.08))}" fill="white">BACKUP SWITCH</text>
</svg>`;
}

function svgDisconnect(w: number, h: number): string {
  // AC Disconnect — gray metal box with red handle
  const rx = Math.round(w * 0.04);
  const cx = Math.round(w / 2);
  const handleW = Math.round(w * 0.3);
  const handleH = Math.round(h * 0.08);

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="discbody" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="#D1D5DB"/>
      <stop offset="100%" stop-color="#9CA3AF"/>
    </linearGradient>
    <filter id="discshadow">
      <feDropShadow dx="1" dy="2" stdDeviation="2" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="${rx}" ry="${rx}"
        fill="url(#discbody)" stroke="#6B7280" stroke-width="1.5" filter="url(#discshadow)"/>
  <!-- Red handle -->
  <rect x="${Math.round(cx - handleW / 2)}" y="${Math.round(h * 0.4)}"
        width="${handleW}" height="${handleH}" rx="2"
        fill="#DC2626" stroke="#991B1B" stroke-width="1"/>
  <!-- ON label -->
  <text x="${cx}" y="${Math.round(h * 0.25)}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial" font-weight="bold" font-size="${Math.round(w * 0.12)}"
        fill="#6B7280" opacity="0.6">ON</text>
  <text x="${cx}" y="${Math.round(h * 0.6)}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial" font-weight="bold" font-size="${Math.round(w * 0.12)}"
        fill="#6B7280" opacity="0.6">OFF</text>
  <!-- Label banner -->
  <rect x="0" y="${h - Math.round(h * 0.18)}" width="${w}" height="${Math.round(h * 0.18)}"
        fill="#EF4444" opacity="0.9"/>
  <text x="${cx}" y="${h - Math.round(h * 0.06)}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="bold"
        font-size="${Math.max(10, Math.round(h * 0.08))}" fill="white">AC DISCONNECT</text>
</svg>`;
}

function svgMainPanel(w: number, h: number): string {
  // Main electrical panel — gray box with breaker rows
  const rx = Math.round(w * 0.03);
  const cx = Math.round(w / 2);
  const brkW = Math.round(w * 0.15);
  const brkH = Math.round(h * 0.035);
  const colL = Math.round(w * 0.25);
  const colR = Math.round(w * 0.6);

  let breakers = "";
  for (let i = 0; i < 8; i++) {
    const y = Math.round(h * 0.15 + i * h * 0.07);
    breakers += `<rect x="${colL}" y="${y}" width="${brkW}" height="${brkH}" rx="1" fill="#374151" opacity="0.6"/>`;
    breakers += `<rect x="${colR}" y="${y}" width="${brkW}" height="${brkH}" rx="1" fill="#374151" opacity="0.6"/>`;
  }

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="panelbody" x1="0" y1="0" x2="0.2" y2="1">
      <stop offset="0%" stop-color="#9CA3AF"/>
      <stop offset="100%" stop-color="#6B7280"/>
    </linearGradient>
    <filter id="panelshadow">
      <feDropShadow dx="2" dy="3" stdDeviation="3" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="${rx}" ry="${rx}"
        fill="url(#panelbody)" stroke="#374151" stroke-width="1.5" filter="url(#panelshadow)"/>
  <!-- Inner panel door border -->
  <rect x="${Math.round(w * 0.08)}" y="${Math.round(h * 0.06)}"
        width="${Math.round(w * 0.84)}" height="${Math.round(h * 0.78)}" rx="2"
        fill="none" stroke="#4B5563" stroke-width="1" opacity="0.5"/>
  <!-- Center bus bar -->
  <line x1="${cx}" y1="${Math.round(h * 0.1)}" x2="${cx}" y2="${Math.round(h * 0.78)}"
        stroke="#4B5563" stroke-width="2" opacity="0.4"/>
  <!-- Breaker rows -->
  ${breakers}
  <!-- Main breaker at top -->
  <rect x="${Math.round(cx - brkW * 0.7)}" y="${Math.round(h * 0.08)}"
        width="${Math.round(brkW * 1.4)}" height="${Math.round(brkH * 1.5)}" rx="2"
        fill="#1F2937" opacity="0.7"/>
  <!-- Label banner -->
  <rect x="0" y="${h - Math.round(h * 0.12)}" width="${w}" height="${Math.round(h * 0.12)}"
        fill="#6B7280" opacity="0.9"/>
  <text x="${cx}" y="${h - Math.round(h * 0.04)}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="bold"
        font-size="${Math.max(10, Math.round(h * 0.06))}" fill="white">MAIN PANEL</text>
</svg>`;
}

function svgSubPanel(w: number, h: number): string {
  // Sub-panel — similar to main panel but smaller/lighter
  const rx = Math.round(w * 0.03);
  const cx = Math.round(w / 2);
  const brkW = Math.round(w * 0.15);
  const brkH = Math.round(h * 0.04);
  const colL = Math.round(w * 0.25);
  const colR = Math.round(w * 0.6);

  let breakers = "";
  for (let i = 0; i < 5; i++) {
    const y = Math.round(h * 0.18 + i * h * 0.1);
    breakers += `<rect x="${colL}" y="${y}" width="${brkW}" height="${brkH}" rx="1" fill="#4B5563" opacity="0.5"/>`;
    breakers += `<rect x="${colR}" y="${y}" width="${brkW}" height="${brkH}" rx="1" fill="#4B5563" opacity="0.5"/>`;
  }

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="subbody" x1="0" y1="0" x2="0.2" y2="1">
      <stop offset="0%" stop-color="#D1D5DB"/>
      <stop offset="100%" stop-color="#9CA3AF"/>
    </linearGradient>
    <filter id="subshadow">
      <feDropShadow dx="1" dy="2" stdDeviation="2" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="${rx}" ry="${rx}"
        fill="url(#subbody)" stroke="#6B7280" stroke-width="1" filter="url(#subshadow)"/>
  <line x1="${cx}" y1="${Math.round(h * 0.12)}" x2="${cx}" y2="${Math.round(h * 0.75)}"
        stroke="#6B7280" stroke-width="1.5" opacity="0.3"/>
  ${breakers}
  <rect x="0" y="${h - Math.round(h * 0.14)}" width="${w}" height="${Math.round(h * 0.14)}"
        fill="#9CA3AF" opacity="0.9"/>
  <text x="${cx}" y="${h - Math.round(h * 0.05)}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="bold"
        font-size="${Math.max(10, Math.round(h * 0.07))}" fill="white">SUB-PANEL</text>
</svg>`;
}

function svgMeter(w: number, h: number): string {
  // Production meter — round meter socket (circular glass dome style)
  const cx = Math.round(w / 2);
  const cy = Math.round(h * 0.42);
  const outerR = Math.round(Math.min(w, h * 0.8) * 0.38);
  const innerR = Math.round(outerR * 0.75);

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="meterglass" cx="0.4" cy="0.35" r="0.65">
      <stop offset="0%" stop-color="#E5E7EB"/>
      <stop offset="60%" stop-color="#D1D5DB"/>
      <stop offset="100%" stop-color="#9CA3AF"/>
    </radialGradient>
    <filter id="metershadow">
      <feDropShadow dx="1" dy="2" stdDeviation="2" flood-opacity="0.3"/>
    </filter>
  </defs>
  <!-- Base plate -->
  <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="4"
        fill="#9CA3AF" stroke="#6B7280" stroke-width="1" filter="url(#metershadow)"/>
  <!-- Meter ring (outer) -->
  <circle cx="${cx}" cy="${cy}" r="${outerR}" fill="#6B7280" stroke="#4B5563" stroke-width="1.5"/>
  <!-- Glass dome -->
  <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="url(#meterglass)" stroke="#9CA3AF" stroke-width="1"/>
  <!-- Dial markings -->
  <text x="${cx}" y="${Math.round(cy - innerR * 0.3)}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial" font-size="${Math.round(innerR * 0.3)}" fill="#374151" opacity="0.6">kWh</text>
  <!-- Digits display -->
  <rect x="${Math.round(cx - innerR * 0.6)}" y="${Math.round(cy)}"
        width="${Math.round(innerR * 1.2)}" height="${Math.round(innerR * 0.3)}" rx="2"
        fill="#1F2937" opacity="0.5"/>
  <text x="${cx}" y="${Math.round(cy + innerR * 0.17)}" text-anchor="middle" dominant-baseline="central"
        font-family="'Courier New', monospace" font-size="${Math.round(innerR * 0.22)}"
        fill="#22C55E" opacity="0.8">00000</text>
  <!-- Label banner -->
  <rect x="0" y="${h - Math.round(h * 0.18)}" width="${w}" height="${Math.round(h * 0.18)}"
        fill="#22C55E" opacity="0.9"/>
  <text x="${cx}" y="${h - Math.round(h * 0.06)}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="bold"
        font-size="${Math.max(10, Math.round(h * 0.08))}" fill="white">METER</text>
</svg>`;
}

function svgInverter(w: number, h: number): string {
  // Solar inverter — gray box with ventilation lines, display area
  const rx = Math.round(w * 0.04);
  const cx = Math.round(w / 2);

  let vents = "";
  for (let i = 0; i < 6; i++) {
    const y = Math.round(h * 0.12 + i * h * 0.06);
    vents += `<line x1="${Math.round(w * 0.15)}" y1="${y}" x2="${Math.round(w * 0.85)}" y2="${y}"
                    stroke="#4B5563" stroke-width="1" opacity="0.3"/>`;
  }

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="invbody" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="#D1D5DB"/>
      <stop offset="50%" stop-color="#9CA3AF"/>
      <stop offset="100%" stop-color="#6B7280"/>
    </linearGradient>
    <filter id="invshadow">
      <feDropShadow dx="2" dy="3" stdDeviation="3" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="${rx}" ry="${rx}"
        fill="url(#invbody)" stroke="#4B5563" stroke-width="1.5" filter="url(#invshadow)"/>
  <!-- Ventilation lines -->
  ${vents}
  <!-- Display/status area -->
  <rect x="${Math.round(w * 0.2)}" y="${Math.round(h * 0.55)}"
        width="${Math.round(w * 0.6)}" height="${Math.round(h * 0.12)}" rx="3"
        fill="#1F2937" opacity="0.6"/>
  <text x="${cx}" y="${Math.round(h * 0.62)}" text-anchor="middle" dominant-baseline="central"
        font-family="'Courier New', monospace" font-size="${Math.round(w * 0.07)}"
        fill="#22C55E" opacity="0.8">SOLAR</text>
  <!-- Status LED -->
  <circle cx="${Math.round(w * 0.75)}" cy="${Math.round(h * 0.75)}" r="${Math.round(w * 0.025)}" fill="#22C55E"/>
  <!-- Label banner -->
  <rect x="0" y="${h - Math.round(h * 0.14)}" width="${w}" height="${Math.round(h * 0.14)}"
        fill="#F97316" opacity="0.9"/>
  <text x="${cx}" y="${h - Math.round(h * 0.05)}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="bold"
        font-size="${Math.max(10, Math.round(h * 0.07))}" fill="white">INVERTER</text>
</svg>`;
}

function svgEvCharger(w: number, h: number): string {
  // EV charger — wall connector style (Tesla Wall Connector-ish)
  const rx = Math.round(w * 0.06);
  const cx = Math.round(w / 2);

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="evbody" x1="0" y1="0" x2="0.5" y2="1">
      <stop offset="0%" stop-color="#F5F5F5"/>
      <stop offset="100%" stop-color="#D1D5DB"/>
    </linearGradient>
    <filter id="evshadow">
      <feDropShadow dx="1" dy="2" stdDeviation="2" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="${rx}" ry="${rx}"
        fill="url(#evbody)" stroke="#9CA3AF" stroke-width="1" filter="url(#evshadow)"/>
  <!-- Tesla T -->
  <text x="${cx}" y="${Math.round(h * 0.3)}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial" font-weight="bold" font-size="${Math.round(w * 0.2)}"
        fill="#C0C0C0" opacity="0.4">T</text>
  <!-- Status light bar -->
  <rect x="${Math.round(w * 0.2)}" y="${Math.round(h * 0.5)}"
        width="${Math.round(w * 0.6)}" height="${Math.round(h * 0.04)}" rx="2"
        fill="#22C55E" opacity="0.7"/>
  <!-- Cable exit point -->
  <circle cx="${cx}" cy="${Math.round(h * 0.72)}" r="${Math.round(w * 0.06)}"
          fill="#6B7280" stroke="#4B5563" stroke-width="1"/>
  <!-- Label banner -->
  <rect x="0" y="${h - Math.round(h * 0.16)}" width="${w}" height="${Math.round(h * 0.16)}"
        fill="#A855F7" opacity="0.9"/>
  <text x="${cx}" y="${h - Math.round(h * 0.06)}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="bold"
        font-size="${Math.max(10, Math.round(h * 0.08))}" fill="white">EV CHARGER</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

const RENDERERS: Record<EquipmentKey, (w: number, h: number) => string> = {
  battery: svgPowerwall3,
  expansion: svgExpansion,
  gateway: svgGateway3,
  backup_switch: svgBackupSwitch,
  disconnect: svgDisconnect,
  main_panel: svgMainPanel,
  sub_panel: svgSubPanel,
  meter: svgMeter,
  inverter: svgInverter,
  ev_charger: svgEvCharger,
};

/**
 * Generate a detailed SVG string for the given equipment type and pixel dimensions.
 * Returns null if the key is not recognized.
 */
export function renderEquipmentSvg(
  key: EquipmentKey,
  width: number,
  height: number,
): string | null {
  const renderer = RENDERERS[key];
  if (!renderer) return null;
  return renderer(Math.round(width), Math.round(height));
}
