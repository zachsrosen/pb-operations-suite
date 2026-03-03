---
name: design-approval-photo
description: Use when the user asks to "create a design approval photo", "generate DA photo", "equipment layout photo for PROJ-XXXX", "place equipment on site photo", or provides a site photo and wants equipment labels added. Takes a site photo + BOM/deal data, uses AI vision to suggest equipment placement, composites labeled equipment onto the photo, and outputs an annotated image for the PandaDoc DA template.
version: 0.1.0
---

# Design Approval Photo Skill

Generate an annotated equipment placement photo for a Photon Brothers design approval (DA) package. Takes a site photo and a PROJ number (or manual equipment list), analyzes the photo to identify wall space and the main panel, suggests equipment positions, composites labeled rectangles onto the image, and outputs a PNG ready for the PandaDoc DA template.

---

## Inputs

| Input | Required | Source |
|-------|----------|--------|
| Site photo (JPEG/PNG) | Yes | Surveyor uploads or user provides file path |
| PROJ number | Preferred | Used to pull BOM data for the equipment list |
| Manual equipment list | Fallback | User lists equipment if no PROJ/BOM available |

---

## Workflow

### Step 1: Gather Equipment

**If a PROJ number is provided:**

1. Ask the user to provide the BOM, or check for saved BOM snapshots via `GET /api/bom/history?dealId={dealId}`.
2. Pass each BOM line item through `resolveEquipmentKey()` from `equipment-config.ts` (in this skill directory). This filters to wall-mountable equipment only -- modules, racking, wire, conduit, lugs, and rapid shutdown all return `null` and are excluded.
3. For items that resolve to an `EquipmentKey`, note the key and the quantity from the BOM.

**If no PROJ number / no BOM:**

Ask the user to list equipment manually. Common items:

- `battery` -- Tesla Powerwall 3 (include qty)
- `expansion` -- PW3 Expansion Kit (include qty)
- `gateway` -- Tesla Backup Gateway 3
- `backup_switch` -- Tesla Backup Switch
- `disconnect` -- AC Disconnect
- `meter` -- Production / PV Meter
- `sub_panel` -- Sub-Panel
- `ev_charger` -- EV Charger
- `main_panel` -- Existing Main Panel (for reference positioning)

Always include `main_panel` as a reference anchor even though it is existing equipment.

### Step 2: Analyze Photo and Suggest Placement

Read the site photo using the Read tool (it supports JPEG/PNG images natively).

Analyze the photo and identify:

1. **Main electrical panel** -- gray or black metal box; this is the anchor for all other equipment.
2. **Available wall space** -- continuous unobstructed sections adjacent to the panel.
3. **Obstructions** -- windows, doors, pipes, HVAC, water heaters, shelving.
4. **Mounting surfaces** -- drywall over studs, concrete, stucco (acceptable); thin plywood (not acceptable for heavy equipment).
5. **Utility meter** -- usually exterior, near the panel. AC disconnect must be within line of sight.

Apply the rules from `placement-rules.md` (in this skill directory). Key rules:

- Main panel is the anchor; position everything relative to it.
- Batteries within 10 ft of main panel, 36" front clearance, 3 ft from gas appliances.
- Gateway within 5 ft of panel, above or beside it.
- Backup switch between panel and gateway, as close to panel as possible.
- AC disconnect exterior, within line of sight of utility meter.
- Multiple batteries: stack vertically (preferred) or side-by-side if wall width allows.

**Output structured JSON** with a placements array. Each placement has:

```json
{
  "analysis": "Brief description of what was identified in the photo",
  "placements": [
    {
      "key": "main_panel",
      "label": "PANEL",
      "x": 620,
      "y": 400,
      "width": 180,
      "height": 280
    },
    {
      "key": "battery",
      "label": "PW3",
      "x": 350,
      "y": 380,
      "width": 200,
      "height": 320
    }
  ],
  "warnings": ["Water heater visible 2 ft from proposed battery location"]
}
```

**Coordinate guidelines:**

- `x` and `y` are the top-left corner of the rectangle, in pixels.
- Use the main panel as a size reference. A typical residential main panel is approximately 24" wide x 30" tall. Estimate its pixel dimensions in the photo and derive a pixels-per-foot ratio from that.
- Keep all placements within photo bounds (check image dimensions).
- Maintain a minimum 20px gap between equipment rectangles.
- Use the `label` field from `EQUIPMENT_VISUALS` in `equipment-config.ts` (e.g., "PW3", "GW3", "BU SW", "DISC").

### Step 3: Compose Image

1. Save the placements JSON to a temp file:

```bash
cat > /tmp/placements.json << 'PLACEMENTS_EOF'
{ ... the JSON from Step 2 ... }
PLACEMENTS_EOF
```

2. Run the composition script:

```bash
npx tsx scripts/compose-equipment-photo.ts <photo-path> /tmp/placements.json ~/Downloads/PROJ-XXXX-design-approval.png
```

Replace `PROJ-XXXX` with the actual project number.

3. Open the result for the user to review:

```bash
open ~/Downloads/PROJ-XXXX-design-approval.png
```

### Step 4: Review Loop

Ask the user: "Does the equipment placement look correct? Any adjustments needed?"

Common adjustments:

| Request | Action |
|---------|--------|
| "Move the battery left" | Decrease `x` by 50-100px, re-run |
| "Make the panel bigger" | Increase `width`/`height`, re-run |
| "Stack the batteries" | Place PW3 #2 directly above PW3 #1 (same `x`, `y` = PW3#1.y - height - 10) |
| "Add another Powerwall" | Add a new placement with `key: "battery"`, `label: "PW3 #2"` |
| "Remove the meter" | Delete the meter placement from the JSON |
| "Move everything down" | Increase all `y` values by the same offset |

For each adjustment:

1. Update the placements JSON.
2. Re-run the composition script.
3. Open the new image.

Repeat until the user approves.

### Step 5: Finalize

Once approved:

1. Confirm the output file path: `~/Downloads/PROJ-XXXX-design-approval.png`
2. Let the user know this image is ready to insert into the PandaDoc DA template.

---

## Equipment Config Reference

The file `equipment-config.ts` (in this skill directory) defines the visual appearance of each equipment type:

| Key | Color | Label | Real-World Size (W x H ft) |
|-----|-------|-------|-----------------------------|
| `battery` | Blue (#3B82F6) | PW3 | 2.8 x 1.1 |
| `expansion` | Light Blue (#60A5FA) | PW3 EXP | 2.8 x 1.1 |
| `inverter` | Orange (#F97316) | INV | 1.5 x 1.0 |
| `gateway` | Teal (#14B8A6) | GW3 | 0.8 x 0.5 |
| `backup_switch` | Amber (#F59E0B) | BU SW | 1.0 x 0.6 |
| `main_panel` | Gray (#6B7280) | PANEL | 2.0 x 1.0 |
| `sub_panel` | Light Gray (#9CA3AF) | SUB | 1.5 x 0.8 |
| `meter` | Green (#22C55E) | METER | 0.8 x 0.5 |
| `disconnect` | Red (#EF4444) | DISC | 0.6 x 0.4 |
| `ev_charger` | Purple (#A855F7) | EV | 1.0 x 0.8 |

**To add a new equipment type:**

1. Add the key to the `EquipmentKey` union type.
2. Add a visual definition to `EQUIPMENT_VISUALS`.
3. Add a case to `resolveEquipmentKey()` so BOM items map to the new key.

---

## Placement Rules Summary

See `placement-rules.md` for the full reference. Key points:

- **Main panel is the anchor** -- identify it first, position everything relative to it.
- **36" front clearance** required for panels, batteries, disconnects, backup switches (NEC 110.26).
- **Batteries within 10 ft of panel**, 3 ft from gas appliances, vertical orientation only.
- **Gateway within 5 ft of panel**, above or beside it, needs WiFi coverage.
- **AC disconnect exterior**, within line of sight of utility meter.
- **Stacking**: bottom unit (#1) first, top unit (#2) above. Max ~7 ft from floor for top unit. Confirm wall supports ~260 lbs combined for dual batteries.

---

## Tips

- **Dark photos**: If the site photo is very dark (e.g., poorly lit garage), suggest the user brighten the image first, or note that labels may be hard to see against dark walls.
- **Portrait orientation**: Portrait photos work better for garage walls since equipment is arranged vertically. Landscape photos work better for exterior shots showing the meter and disconnect.
- **Main panel as size reference**: The main panel is the most reliable size reference in the photo. A standard residential panel is roughly 24" wide x 30" tall. Use its pixel dimensions to estimate scale for all other equipment.
- **Multiple batteries**: For 2+ Powerwalls, check the stacking patterns in `placement-rules.md`. Stacked is preferred when horizontal space is limited; side-by-side when the wall is wide enough (~5 ft minimum span for two units).
- **Expansion kits**: PW3 Expansion Kits are the same physical size as a Powerwall 3 and mount the same way. Use `key: "expansion"` with the lighter blue color to visually distinguish them.
- **Existing equipment**: Always include the main panel as a reference rectangle even though it already exists. This helps the user see the spatial relationship. Use `key: "main_panel"` with the gray color.
