# Design Approval Photo Skill — Design Document

**Date:** 2026-03-02
**Status:** Approved

## Problem

Photon Brothers surveyors currently use Solarview to create equipment layout photos for customer design approval. This process is:
- **Surveyor-dependent** — surveyors create these manually during/after site visits, adding to their workload
- **Slow** — no integration with existing BOM/deal data; equipment info re-entered manually
- **Inconsistent** — quality varies by surveyor

The final photo shows where each piece of equipment (inverter, battery, meter, disconnect, etc.) will be physically placed on/around the house. This photo is inserted into a PandaDoc DA (Design Approval) template and sent to the customer for approval.

## Solution

A Claude Code skill that takes a site photo + BOM data, uses Claude Vision to analyze the photo and suggest equipment placement, then composites labeled equipment onto the photo using Sharp.

### Approach: Claude Vision + Sharp Image Composition

- Claude Vision analyzes the photo to identify walls, open space, existing panels, obstructions
- Claude applies placement rules (NEC clearances, standard installation practices) to suggest positions
- Sharp composites equipment labels/icons onto the photo at suggested coordinates
- Surveyor reviews the result conversationally, requesting adjustments until satisfied
- Final output: an annotated PNG image ready to drop into the PandaDoc DA template

## Skill Workflow

**Trigger:** `/design-approval-photo` or "create design approval photo for PROJ-XXXX"

**Inputs:**
- Site photo path(s) — taken by surveyor during site visit
- PROJ number — to pull BOM/equipment data

**Pipeline:**

1. **Gather equipment list** — Pull BOM for the deal (equipment names, quantities, physical dimensions, categories: inverter, battery, meter, disconnect, sub-panel, EV charger, etc.)
2. **AI Vision analysis** — Send photo + equipment list + placement rules to Claude Vision
3. **Compose image** — Sharp overlays equipment labels onto the photo at suggested coordinates
4. **Save & open** — Save to `~/Downloads/PROJ-XXXX-design-approval.png`, open for review
5. **Review loop** — Surveyor requests adjustments conversationally; each adjustment re-renders via Sharp
6. **Done** — Final image ready to insert into PandaDoc DA template

## AI Vision Prompt Design

### Context provided to Claude:
- The site photo
- Equipment list with physical dimensions (from BOM)
- Placement rules (codified surveyor knowledge)

### Placement rules (initial set, expanded over time):
- Batteries mount on garage walls, not exterior walls
- Inverter near main panel when possible
- Minimum clearances between equipment (NEC requirements)
- EV charger near garage door / parking area
- Disconnect within sight of utility meter
- Stacking configuration when wall space is limited

### Claude returns structured JSON:
```json
{
  "analysis": "South-facing garage wall, main panel on left side, ~12ft open wall space",
  "placements": [
    {
      "equipment": "Powerwall 3",
      "x": 340,
      "y": 520,
      "width": 120,
      "height": 48,
      "reasoning": "Adjacent to main panel, 4ft clearance maintained"
    }
  ],
  "warnings": ["Limited wall space - stacking batteries may be required"]
}
```

## Equipment Visuals

### Phase 1: Colored rectangles with text labels

Each equipment type maps to a color, label, and default real-world dimensions:

| Equipment | Color | Label | Approx Size |
|-----------|-------|-------|-------------|
| Battery (Powerwall) | Blue | PW3 | 2.8' x 1.1' |
| Inverter | Orange | INV | 1.5' x 1.0' |
| Main Panel / Sub-panel | Gray | PANEL | 2.0' x 1.0' |
| Meter | Green | METER | 0.8' x 0.5' |
| EV Charger | Purple | EV | 1.0' x 0.8' |
| Disconnect | Red | DISC | 0.6' x 0.4' |
| Gateway | Teal | GW | 0.8' x 0.5' |
| Backup Switch | Amber | BU SW | 1.0' x 0.6' |

Dimensions are scaled to the photo based on reference objects or user-provided scale.

### Phase 2 (future): SVG silhouettes or product images

Same coordinates and pipeline — swap rectangle rendering for image compositing. The config adds an optional `icon` path per equipment type.

## Output

- **Format:** PNG image
- **Location:** `~/Downloads/PROJ-XXXX-design-approval.png`
- **Contents:** Original site photo with equipment labels overlaid at suggested positions
- **Usage:** Inserted into existing PandaDoc DA template by surveyor

No PDF generation — the PandaDoc template handles the final document.

## Key Files

```
.claude/skills/design-approval-photo/
├── skill.md              # Skill definition and prompt
├── equipment-config.ts   # Equipment type → color, label, dimensions
├── placement-rules.md    # Codified placement rules for AI prompt
└── (references Sharp for composition)
```

Utility code for Sharp composition lives in `src/lib/` or `scripts/` as needed.

## Dependencies

- **Sharp** (`^0.34.5`) — already in package.json, currently unused
- **Claude Vision** — via the skill's natural conversation (no API call needed in CLI context)
- **BOM data** — from existing HubSpot API or saved BOM snapshots

## Future: Web App Version

The same logic (AI analysis → Sharp composition → review loop) can power a web UI in the Operations Suite where surveyors:
- Upload photos directly
- See equipment placed interactively (drag-drop adjustment)
- Export the final image

The CLI skill establishes the core pipeline; the web version wraps it in a UI.
