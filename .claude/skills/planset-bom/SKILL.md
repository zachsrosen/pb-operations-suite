---
name: planset-bom
description: This skill should be used when the user asks to "read a planset", "generate a BOM", "create a bill of materials from a plan set", "extract equipment from a planset", "pull the BOM from this PDF", "what's on this planset", "read this design plan", or drops a Photon Brothers stamped planset PDF. Produces a full bill of materials from a PB solar/storage design planset, outputting CSV, Markdown, and JSON matched to the EquipmentSku inventory schema.
version: 0.1.0
---

# Planset BOM Skill

Generate a complete Bill of Materials from a Photon Brothers stamped solar/storage planset PDF.

## What This Skill Does

Read a PB planset PDF and extract every line item into a structured BOM covering:
- Solar PV modules (make, model, wattage, qty)
- Battery & inverter (Tesla Powerwall-3, kWh, part number)
- Rapid shutdown devices
- Racking & mounting hardware (rails, attachments, clamps, screws)
- Electrical BOS (wire, conduit sizes, J-box, AC disconnect, ground lugs)
- Monitoring & controls (gateway, production meter)

Output all three formats: **CSV**, **Markdown**, and **JSON** (inventory-ready).

---

## Planset Structure

Every PB planset is a stamped AutoCAD PDF with consistent sheet numbering:

| Sheet | Source | What to Extract |
|-------|--------|----------------|
| **PV-0** | Cover sheet | System size (kWdc/kWac), equipment list with `(N)`/`(E)` prefixes |
| **PV-2** | Roof plan | **BILL OF MATERIALS table** — primary source |
| **PV-4** | Electrical line diagram | Conductor schedule (wire sizes, conduit types) + equipment model numbers |
| **PV-5** | Electrical calculation | OCPD rating for validation |
| **PV-6** | Warning labels | ESS kWh size for battery validation |

Focus extraction on **PV-2 BOM table** (primary) and **PV-4 conductor schedule** (electrical BOS).

---

## Extraction Workflow

### 1. Read the Planset

Use the Read tool on the PDF. If it's large, read pages 1–3 first (PV-0, PV-1, PV-2), then pages 5–6 (PV-4, PV-5) for the conductor table.

### 2. Extract Project Header (PV-0)

From the system headline and PHOTOVOLTAIC SYSTEM SPECIFICATIONS block:
- `systemSizeKwdc`, `systemSizeKwac` from headline: `16 MODULES-ROOF MOUNTED - 7.040 kWDC, 11.500 kWAC`
- `customer`, `address`, `apn`, `utility`, `ahj` from the title block (right side of sheet)
- `plansetRev`, `stampDate` from revisions block
- Equipment list: parse `(N) [QTY] - [MAKE MODEL]` lines — `(N)` = new, `(E)` = existing (skip from BOM)

### 3. Extract BOM Table (PV-2)

Find the **BILL OF MATERIALS** table with columns `EQUIPMENT | QTY | DESCRIPTION`.

Parse each row into:
```
lineItem, category, brand, model, description, qty, unitSpec, unitLabel, source="PV-2"
```

Also read the **module detail block** (upper-left of PV-2) for: module dimensions, weight, PSF, and roof coverage %.

### 4. Extract from PV-4 SLD (Three things to find)

**A. Conductor schedule** — table at the bottom of PV-4:
`TAG | CONDUCTOR | MIN CONDUCTOR SIZE | NUMBER OF CONDUCTORS | CONDUIT/CABLE TYPE | MIN CONDUIT SIZE`

Add each row to the BOM as an `ELECTRICAL_BOS` item. Standard tags for Powerwall-3 jobs:
- **Tag A** — PV-WIRE, 10 AWG, free air (DC at array)
- **Tag B** — THHN/THWN-2, 10 AWG, 3/4" EMT (after J-box)
- **Tag C** — THWN-2, 6 AWG, 3/4" EMT (AC after Powerwall)
- **Tag D** — THWN-2, 3/0 AWG, 2" EMT (utility/main panel feed)

**B. Rapid Shutdown Switch** — scan the SLD diagram itself (not the table) for:
`(N) RAPID SHUTDOWN SWITCH` (typically with a `16/2 COMM WIRE` label connecting it to MCI-2 devices)

If present → add to BOM:
```json
{ "category": "RAPID_SHUTDOWN", "brand": "IMO", "model": "IMO SI16-PEL64R-2",
  "description": "IMO RAPID SHUTDOWN DEVICE, SI16-PEL64R-2", "qty": 1, "source": "PV-4" }
```
This is the **control unit** that triggers the MCI-2 module-level devices. It does NOT appear in the PV-2 BOM table — only in the PV-4 SLD. Always qty 1 per job.

**C. AC disconnect wire configuration** — read the SLD callout for the 60A disconnect:
- If callout includes `1-PHASE, 3-WIRE` → use SKU **`TGN3322R`** (3-pole, for service upgrade jobs with neutral)
- If callout says `2-WIRE` or no wire count → use SKU **`DG222URB`** (2-pole, standard)

**D. Part numbers** — from PV-4 spec tables:
- Powerwall part number (e.g., `1707000-XX-Y`) → `model: "1707000-XX-Y"`, `description: "TESLA POWERWALL 3, 13.5kWh BATTERY & INVERTER"`
- Gateway part number (e.g., `1841000-X1-Y`) → `model: "1841000-X1-Y"`, `description: "TESLA BACKUP GATEWAY 3, 200A, NEMA 3R"`

**Model field rule:** Always use the manufacturer part number (alphanumeric code from the planset specs) as `model`, never the marketing product name. Put the product name in `description`.

### 5. Run Validation Checks

- Module count: sum of all STRING #N values = SOLAR PV MODULE qty
- Battery kWh: ESS SIZE on PV-6 = nominal battery energy on PV-4
- OCPD: PV-5 OCPD rating = AC disconnect amp rating on PV-2
- Gateway paired with battery: both present or both absent

Set `validation.moduleCountMatch`, `batteryCapacityMatch`, `ocpdMatch` booleans.

### 6. Build and Output BOM

Assemble the full BOM JSON matching the schema in `references/bom-schema.md`.

Output all three formats inline:
1. **Markdown table** — grouped by category, with validation summary
2. **CSV** — ready to import into Google Sheets or inventory
3. **JSON** — structured for `/api/inventory/sync-skus`

Optionally run the export script if a file path is needed:
```bash
python3 .claude/skills/planset-bom/scripts/export-bom.py bom.json
```

---

## Category Mapping Quick Reference

| Source | EQUIPMENT Label | Category | Notes |
|--------|----------------|----------|-------|
| PV-2 | SOLAR PV MODULE | `MODULE` | e.g. "SEG Solar", "Hyundai Solar" |
| PV-2 | BATTERY & INVERTER | `BATTERY` | "Tesla" (Powerwall-3 is combo unit) |
| PV-2 | RAPID SHUTDOWN | `RAPID_SHUTDOWN` | "Tesla" MCI-2 devices |
| **PV-4 SLD** | **RAPID SHUTDOWN SWITCH** | **`RAPID_SHUTDOWN`** | **"IMO" — NOT in PV-2 BOM; scan SLD diagram** |
| PV-2 | RAIL | `RACKING` | "IronRidge" XR10 or XR100 per roof type |
| PV-2 | BONDED SPLICE | `RACKING` | "IronRidge" |
| PV-2 | CLAMP (MID/END) | `RACKING` | "IronRidge" |
| PV-2 | ATTACHMENT | `RACKING` | "IronRidge" (HUG = Halo Ultragrip) |
| PV-2 | RD STRUCTURAL SCREW | `RACKING` | "IronRidge" (HW-RD1430-01-M1) |
| PV-2 | GROUNDING LUG | `ELECTRICAL_BOS` | — |
| PV-2 | JUNCTION BOX | `ELECTRICAL_BOS` | "EZ Solar" (JB-1.2) |
| PV-2 | AC DISCONNECT | `ELECTRICAL_BOS` | **Check PV-4 SLD: 2-WIRE → DG222URB, 3-WIRE → TGN3322R** |
| PV-4 | Wire/conduit | `ELECTRICAL_BOS` | Conductor schedule rows |
| PV-2 | TESLA BACKUP GATEWAY | `MONITORING` | "Tesla" (Backup Gateway-3) |
| PV-2 | PRODUCTION METER | `MONITORING` | "Xcel Energy" (Xcel jobs only) |

---

## Roof Type Changes Racking Hardware

**Always read DESIGN CRITERIA on PV-0 for roof type first** — it determines the attachment system:

| Roof Type | Attachment | Rail | Lag Screws |
|-----------|-----------|------|-----------|
| ASPHALT SHINGLE | IronRidge HUG | XR10 | Yes (HW-RD1430-01-M1) |
| TRAPEZOIDAL METAL ROOF | S-5! ProteaBracket | XR100 | No |

For metal roofs: ATTACHMENT row = "S-5! PROTEABRACKET ATTACHMENTS", no RD STRUCTURAL SCREW row.

---

## Common PB Equipment

Patterns seen across multiple reviewed jobs — expect to see these on most jobs:

**Modules (varies per job):**
- SEG Solar SEG-440-BTD-BG (440W) — N-Type bifacial
- Hyundai Solar HiN-T440NF(BK) (440W) — N-Type TOPCon black frame

**Battery/Inverter:** Tesla Powerwall 3 → `brand: "Tesla"`, `model: "1707000-XX-Y"`, `description: "TESLA POWERWALL 3, 13.5kWh BATTERY & INVERTER"` (part number from PV-4 SPECIFICATIONS table)

**Rapid Shutdown:** Tesla MCI-2 (standard) or MCI-2 High Current — count = number of modules / 2 rounded up, or 1 per string

**Racking:** IronRidge XR10 rail (168" lengths), HUG attachments, HW-RD1430-01-M1 structural screws

**Wiring:** 10 AWG PV-WIRE (DC), 6 AWG THWN-2 (AC), 3/0 AWG THWN-2 (utility side)

**Gateway:** Tesla Backup Gateway-3, 200A, NEMA 3R (model 1841000-X1-Y)

---

## Additional Resources

- **`references/extraction-guide.md`** — Full extraction guide with real BOM examples from two actual PB jobs (Cantwell PROJ8783 and Anderson PROJ-8539), complete conductor schedules, and validation rules
- **`references/bom-schema.md`** — Full JSON schema, CSV column order, and Markdown template with example output
- **`scripts/export-bom.py`** — Export script: takes BOM JSON, outputs .csv + .md + pretty JSON
