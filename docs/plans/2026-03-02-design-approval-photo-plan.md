# Design Approval Photo Skill — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Claude Code skill that composites equipment labels onto site photos using AI-suggested placement, replacing manual Solarview workflow.

**Architecture:** Claude Vision analyzes a site photo + BOM equipment list and returns placement coordinates as JSON. A Sharp-based composition script renders labeled equipment rectangles onto the photo. The review loop is conversational — the surveyor asks for adjustments and the image re-renders.

**Tech Stack:** Sharp (image composition), TypeScript (composition script), Claude Vision (placement analysis), BOM API (equipment data)

---

### Task 1: Equipment Config

**Files:**
- Create: `.claude/skills/design-approval-photo/equipment-config.ts`

**Step 1: Create the equipment visual config**

```typescript
// .claude/skills/design-approval-photo/equipment-config.ts

export interface EquipmentVisual {
  color: string;        // hex fill color
  textColor: string;    // hex text color
  label: string;        // short label on rectangle
  widthFt: number;      // real-world width in feet
  heightFt: number;     // real-world height in feet
  icon?: string;        // optional path to SVG/PNG icon (Phase 2)
}

/**
 * Maps BOM category + model patterns to visual config.
 * Order matters — first match wins.
 */
export const EQUIPMENT_VISUALS: Record<string, EquipmentVisual> = {
  battery: {
    color: "#3B82F6",
    textColor: "#FFFFFF",
    label: "PW3",
    widthFt: 2.8,
    heightFt: 1.1,
  },
  expansion: {
    color: "#60A5FA",
    textColor: "#FFFFFF",
    label: "PW3 EXP",
    widthFt: 2.8,
    heightFt: 1.1,
  },
  inverter: {
    color: "#F97316",
    textColor: "#FFFFFF",
    label: "INV",
    widthFt: 1.5,
    heightFt: 1.0,
  },
  gateway: {
    color: "#14B8A6",
    textColor: "#FFFFFF",
    label: "GW3",
    widthFt: 0.8,
    heightFt: 0.5,
  },
  backup_switch: {
    color: "#F59E0B",
    textColor: "#FFFFFF",
    label: "BU SW",
    widthFt: 1.0,
    heightFt: 0.6,
  },
  main_panel: {
    color: "#6B7280",
    textColor: "#FFFFFF",
    label: "PANEL",
    widthFt: 2.0,
    heightFt: 1.0,
  },
  sub_panel: {
    color: "#9CA3AF",
    textColor: "#FFFFFF",
    label: "SUB",
    widthFt: 1.5,
    heightFt: 0.8,
  },
  meter: {
    color: "#22C55E",
    textColor: "#FFFFFF",
    label: "METER",
    widthFt: 0.8,
    heightFt: 0.5,
  },
  disconnect: {
    color: "#EF4444",
    textColor: "#FFFFFF",
    label: "DISC",
    widthFt: 0.6,
    heightFt: 0.4,
  },
  ev_charger: {
    color: "#A855F7",
    textColor: "#FFFFFF",
    label: "EV",
    widthFt: 1.0,
    heightFt: 0.8,
  },
};

/**
 * Resolve a BOM item to its equipment visual key.
 * Uses category + model/description pattern matching.
 */
export function resolveEquipmentKey(item: {
  category: string;
  model?: string;
  description?: string;
}): string | null {
  const cat = item.category?.toUpperCase() || "";
  const model = (item.model || "").toLowerCase();
  const desc = (item.description || "").toLowerCase();

  if (cat === "BATTERY") {
    if (model.includes("1807000") || desc.includes("expansion")) return "expansion";
    return "battery";
  }
  if (cat === "INVERTER") return "inverter";
  if (cat === "EV_CHARGER") return "ev_charger";
  if (cat === "MONITORING") {
    if (model.includes("1841000") || desc.includes("gateway")) return "gateway";
    if (desc.includes("meter")) return "meter";
    return "gateway";
  }
  if (cat === "ELECTRICAL_BOS") {
    if (desc.includes("disconnect")) return "disconnect";
    if (desc.includes("backup switch") || model.includes("1624171")) return "backup_switch";
    if (desc.includes("sub") && desc.includes("panel")) return "sub_panel";
    // Skip wire, conduit, lugs, j-box — not placed on wall
    return null;
  }
  // Skip racking, rapid shutdown, modules — not wall-mounted equipment
  return null;
}
```

**Step 2: Commit**

```bash
git add .claude/skills/design-approval-photo/equipment-config.ts
git commit -m "feat(da-photo): add equipment visual config with BOM category resolver"
```

---

### Task 2: Placement Rules Reference

**Files:**
- Create: `.claude/skills/design-approval-photo/placement-rules.md`

**Step 1: Write placement rules document**

```markdown
# Equipment Placement Rules

These rules guide AI-assisted equipment placement on site photos.
They codify standard PB installation practices and NEC requirements.

## General Principles

1. **Main panel is the anchor** — most equipment is placed relative to the existing main panel
2. **Minimize conduit runs** — place equipment to keep wire runs short
3. **Accessible for maintenance** — all equipment needs 36" clearance in front (NEC 110.26)
4. **Weather protection preferred** — garage interior or covered areas preferred over exterior walls

## Equipment-Specific Rules

### Battery (Powerwall 3)
- Mount on garage wall (interior preferred)
- Adjacent to main panel when possible (within 10ft)
- 36" clearance in front
- If multiple batteries: stack vertically or side-by-side depending on wall space
- Keep away from water heaters and gas appliances (3ft minimum)

### Gateway 3
- Mount within 5ft of main panel
- Typically above or beside the main panel
- Needs WiFi connectivity — avoid metal enclosures that block signal

### Backup Switch
- Between main panel and gateway
- As close to main panel as possible

### AC Disconnect
- Within sight of utility meter (NEC requirement)
- Exterior mount, accessible to utility
- Near the point where solar feed enters the home

### Sub-Panel
- Adjacent to main panel or in same room
- Used when main panel has insufficient breaker slots

### Meter
- Exterior mount, utility-accessible
- Production meters near the point of interconnection

### EV Charger
- Near parking area / garage door
- Within reach of vehicle charging port
- Dedicated 240V circuit from panel

## Stacking & Layout Patterns

### Single Battery + Gateway
```
[GW3] [BU SW]
[  PANEL  ]
[   PW3   ]
```

### Dual Battery (Side by Side)
```
      [GW3] [BU SW]
      [  PANEL  ]
[  PW3  ] [  PW3  ]
```

### Dual Battery (Stacked)
```
[GW3] [BU SW] [  PANEL  ]
[   PW3   ]
[   PW3   ]
```

## Photo Analysis Guidance

When analyzing the site photo, identify:
1. **Existing main panel** — the gray/black electrical panel box
2. **Available wall space** — unobstructed flat wall areas
3. **Obstructions** — windows, doors, pipes, HVAC, water heater
4. **Mounting surface** — drywall/stud (interior), stucco/siding (exterior)
5. **Floor/ground space** — for equipment that sits on the ground
6. **Utility meter location** — if visible, note position for disconnect placement
```

**Step 2: Commit**

```bash
git add .claude/skills/design-approval-photo/placement-rules.md
git commit -m "feat(da-photo): add equipment placement rules reference"
```

---

### Task 3: Sharp Composition Script

**Files:**
- Create: `scripts/compose-equipment-photo.ts`

This is the core rendering engine. It takes a photo path and placement data, and outputs an annotated image.

**Step 1: Write the composition script**

```typescript
// scripts/compose-equipment-photo.ts
//
// Usage: npx tsx scripts/compose-equipment-photo.ts <photo> <placements.json> [output]
//
// placements.json format:
// {
//   "placements": [
//     { "key": "battery", "label": "Powerwall 3", "x": 340, "y": 520, "width": 120, "height": 48 }
//   ]
// }

import sharp from "sharp";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { EQUIPMENT_VISUALS } from "../.claude/skills/design-approval-photo/equipment-config";

interface Placement {
  key: string;       // equipment config key
  label: string;     // display label (can override config default)
  x: number;         // left edge, pixels from photo left
  y: number;         // top edge, pixels from photo top
  width: number;     // pixels
  height: number;    // pixels
}

interface PlacementData {
  analysis?: string;
  placements: Placement[];
  warnings?: string[];
}

function createEquipmentSvg(p: Placement): string {
  const visual = EQUIPMENT_VISUALS[p.key];
  if (!visual) {
    // Fallback: gray rectangle
    return createRectSvg(p, "#6B7280", "#FFFFFF", p.label || p.key);
  }
  return createRectSvg(p, visual.color, visual.textColor, p.label || visual.label);
}

function createRectSvg(
  p: Placement,
  fillColor: string,
  textColor: string,
  label: string
): string {
  const fontSize = Math.max(12, Math.min(p.height * 0.3, 24));
  const borderRadius = 4;

  return `<svg width="${p.width}" height="${p.height}">
    <rect x="0" y="0" width="${p.width}" height="${p.height}"
          rx="${borderRadius}" ry="${borderRadius}"
          fill="${fillColor}" fill-opacity="0.85"
          stroke="white" stroke-width="2"/>
    <text x="${p.width / 2}" y="${p.height / 2}"
          text-anchor="middle" dominant-baseline="central"
          font-family="Arial, Helvetica, sans-serif"
          font-size="${fontSize}" font-weight="bold"
          fill="${textColor}">${escapeXml(label)}</text>
  </svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function composeEquipmentPhoto(
  photoPath: string,
  placements: PlacementData,
  outputPath?: string
): Promise<string> {
  const photo = sharp(photoPath);
  const metadata = await photo.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not read image dimensions from ${photoPath}`);
  }

  // Build overlay composites
  const composites: sharp.OverlayOptions[] = [];

  for (const p of placements.placements) {
    const svg = createEquipmentSvg(p);
    composites.push({
      input: Buffer.from(svg),
      left: Math.round(p.x),
      top: Math.round(p.y),
    });
  }

  const outPath = outputPath || photoPath.replace(/\.[^.]+$/, "-da.png");

  await photo
    .composite(composites)
    .png({ quality: 90 })
    .toFile(outPath);

  return outPath;
}

// CLI entry point
if (process.argv[1]?.endsWith("compose-equipment-photo.ts")) {
  const [, , photoArg, placementsArg, outputArg] = process.argv;

  if (!photoArg || !placementsArg) {
    console.error("Usage: npx tsx scripts/compose-equipment-photo.ts <photo> <placements.json> [output]");
    process.exit(1);
  }

  const photoPath = resolve(photoArg);
  const placementsJson = readFileSync(resolve(placementsArg), "utf-8");
  const placements: PlacementData = JSON.parse(placementsJson);
  const outputPath = outputArg ? resolve(outputArg) : undefined;

  composeEquipmentPhoto(photoPath, placements, outputPath)
    .then((out) => console.log(`Saved: ${out}`))
    .catch((err) => {
      console.error("Error:", err.message);
      process.exit(1);
    });
}
```

**Step 2: Test manually with a sample photo**

```bash
# Create a test placement file
cat > /tmp/test-placements.json << 'EOF'
{
  "placements": [
    { "key": "battery", "label": "Powerwall 3", "x": 100, "y": 200, "width": 140, "height": 55 },
    { "key": "gateway", "label": "Gateway 3", "x": 100, "y": 140, "width": 80, "height": 40 }
  ]
}
EOF

# Test with any available image
npx tsx scripts/compose-equipment-photo.ts /path/to/test-photo.jpg /tmp/test-placements.json /tmp/test-output.png
open /tmp/test-output.png
```

Expected: Opens a PNG with blue and teal rectangles overlaid at the specified positions.

**Step 3: Commit**

```bash
git add scripts/compose-equipment-photo.ts
git commit -m "feat(da-photo): add Sharp-based equipment photo composition script"
```

---

### Task 4: Skill Definition (SKILL.md)

**Files:**
- Create: `.claude/skills/design-approval-photo/SKILL.md`

**Step 1: Write the skill file**

```markdown
---
name: design-approval-photo
description: Use when the user asks to "create a design approval photo", "generate DA photo", "equipment layout photo for PROJ-XXXX", "place equipment on site photo", or provides a site photo and wants equipment labels added. Takes a site photo + BOM/deal data, uses AI vision to suggest equipment placement, composites labeled equipment onto the photo, and outputs an annotated image for the PandaDoc DA template.
version: 0.1.0
---

# Design Approval Photo Skill

Generate an annotated equipment layout photo for customer design approval by analyzing a site photo with AI vision and compositing equipment labels.

## What This Skill Does

1. Takes a site photo (garage wall, side of house, etc.) and a PROJ number
2. Pulls BOM equipment data for the deal
3. Analyzes the photo to identify walls, open space, existing panels, obstructions
4. Suggests equipment placement based on NEC rules and PB installation practices
5. Composites labeled equipment rectangles onto the photo using Sharp
6. Outputs an annotated PNG for insertion into the PandaDoc DA template

## Inputs

- **Site photo path** — JPEG/PNG taken by surveyor during site visit
- **PROJ number** — to pull equipment list from BOM history (or user provides equipment list directly)

## Workflow

### Step 1: Gather Equipment

If a PROJ number is provided, fetch the latest BOM snapshot:
```
GET /api/bom/history?dealId={dealId}
```

From the BOM, extract wall-mountable equipment using the category resolver in `equipment-config.ts`. Skip racking, modules, wire, and other non-placed items.

If no BOM is available, ask the user to list the equipment manually (e.g., "1x Powerwall 3, 1x Gateway 3, 1x Backup Switch").

### Step 2: Analyze Photo & Suggest Placement

Read the site photo using the Read tool (it supports images). Then analyze it with this structured approach:

**Identify in the photo:**
1. Existing main electrical panel (gray/black box)
2. Available wall space (unobstructed flat areas)
3. Obstructions (windows, doors, pipes, HVAC, water heater)
4. Mounting surfaces (drywall, stucco, concrete)
5. Utility meter location (if visible)

**Apply placement rules** from `placement-rules.md`:
- Battery adjacent to main panel, 36" front clearance
- Gateway within 5ft of panel
- Disconnect within sight of utility meter
- Minimize conduit runs

**Output a placements JSON** with pixel coordinates:
```json
{
  "analysis": "Description of what you see in the photo",
  "placements": [
    {
      "key": "battery",
      "label": "Powerwall 3",
      "x": 340,
      "y": 520,
      "width": 140,
      "height": 55
    }
  ],
  "warnings": ["any concerns about placement"]
}
```

**Coordinate guidelines:**
- `x`, `y` are top-left corner of the equipment rectangle in pixels
- `width`, `height` should be proportional to real equipment size relative to other objects in the photo (use the main panel as a size reference — typically ~24" wide x 30" tall)
- Keep all placements within the photo bounds
- Maintain spacing between equipment (minimum 20px gap)

### Step 3: Compose Image

Save the placements JSON to a temp file and run the composition script:

```bash
npx tsx scripts/compose-equipment-photo.ts <photo-path> <placements.json> ~/Downloads/PROJ-XXXX-design-approval.png
```

Then open the result:
```bash
open ~/Downloads/PROJ-XXXX-design-approval.png
```

### Step 4: Review Loop

Show the composed image to the user and ask if adjustments are needed. Common adjustments:
- "Move the battery to the right"
- "Make the Powerwall bigger"
- "Stack the batteries vertically"
- "Add a sub-panel"
- "Remove the EV charger"

For each adjustment:
1. Update the placements JSON (adjust x/y/width/height values)
2. Re-run the composition script
3. Open the new image
4. Ask again if it looks right

### Step 5: Finalize

When the user approves, confirm the output path:
```
Final image saved to: ~/Downloads/PROJ-XXXX-design-approval.png
Ready to insert into PandaDoc DA template.
```

## Equipment Config

The equipment visual config is in `equipment-config.ts`. Each equipment type has:
- `color` — fill color for the rectangle
- `textColor` — label text color
- `label` — default short label
- `widthFt` / `heightFt` — real-world dimensions (for scaling reference)

To add new equipment types, add an entry to `EQUIPMENT_VISUALS` and a matching pattern in `resolveEquipmentKey()`.

## Placement Rules

Full placement rules are in `placement-rules.md`. Key rules:
- Main panel is the anchor — place everything relative to it
- 36" clearance in front of all equipment (NEC 110.26)
- Battery on garage wall, adjacent to panel
- Gateway within 5ft of panel, needs WiFi
- Disconnect within sight of utility meter

## Tips

- If the photo is dark, suggest the user brighten it first
- Portrait photos work better for garage walls
- Use the main panel as a size reference for scaling equipment rectangles
- For multiple batteries, check `placement-rules.md` for stacking patterns
```

**Step 2: Commit**

```bash
git add .claude/skills/design-approval-photo/SKILL.md
git commit -m "feat(da-photo): add skill definition with full workflow"
```

---

### Task 5: End-to-End Test

**Files:** None created — this is a manual integration test.

**Step 1: Find or create a test photo**

Use any photo of a garage wall or interior wall with an electrical panel. If none available, use a stock photo of a garage interior.

**Step 2: Create test BOM data**

A typical PB job has: 1x Powerwall 3, 1x Gateway 3, 1x Backup Switch, 1x AC Disconnect. Test with this minimal set.

**Step 3: Run the skill end-to-end**

In a new Claude Code session:
```
Create a design approval photo using the photo at ~/Downloads/test-garage.jpg
Equipment: 1x Powerwall 3, 1x Gateway 3, 1x Backup Switch, 1x 60A AC Disconnect
```

**Expected result:**
1. Claude reads the photo
2. Analyzes wall space and identifies panel
3. Suggests placement coordinates
4. Runs `compose-equipment-photo.ts`
5. Opens annotated PNG
6. Asks for adjustments

**Step 4: Test the review loop**

Ask: "Move the Powerwall to the left side of the panel"

Expected: Claude adjusts coordinates, re-renders, opens new image.

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(da-photo): adjustments from end-to-end testing"
```

---

### Task 6: Final Commit & Cleanup

**Step 1: Verify all files exist**

```
.claude/skills/design-approval-photo/
├── SKILL.md
├── equipment-config.ts
├── placement-rules.md
scripts/
├── compose-equipment-photo.ts
docs/plans/
├── 2026-03-02-design-approval-photo-design.md
├── 2026-03-02-design-approval-photo-plan.md
```

**Step 2: Final commit if needed**

```bash
git add -A
git commit -m "feat(da-photo): complete design approval photo skill v0.1"
```
