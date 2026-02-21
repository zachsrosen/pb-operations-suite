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

### 4. Extract Conductor Schedule (PV-4)

Find the conductor table at the bottom of PV-4 with columns:
`TAG | CONDUCTOR | MIN CONDUCTOR SIZE | NUMBER OF CONDUCTORS | CONDUIT/CABLE TYPE | MIN CONDUIT SIZE`

Add each row to the BOM as an `ELECTRICAL_BOS` item. Standard tags for Powerwall-3 jobs:
- **Tag A** — PV-WIRE, 10 AWG, free air (DC at array)
- **Tag B** — THHN/THWN-2, 10 AWG, 3/4" EMT (after J-box)
- **Tag C** — THWN-2, 6 AWG, 3/4" EMT (AC after Powerwall)
- **Tag D** — THWN-2, 3/0 AWG, 2" EMT (utility/main panel feed)

Also extract from PV-4:
- Powerwall model number (e.g., `1707000-XX-Y`) from POWERWALL 3 SPECIFICATIONS table
- Gateway model number (e.g., `1841000-X1-Y`) from SLD callout

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

| PV-2 EQUIPMENT Label | Category | Brand Pattern |
|----------------------|----------|--------------|
| SOLAR PV MODULE | `MODULE` | e.g. "SEG Solar", "Hyundai Solar" |
| BATTERY & INVERTER | `BATTERY` | "Tesla" (Powerwall-3 is combo unit) |
| RAPID SHUTDOWN | `RAPID_SHUTDOWN` | "Tesla" (MCI-2) |
| RAIL | `RACKING` | "IronRidge" (XR10) |
| BONDED SPLICE | `RACKING` | "IronRidge" |
| CLAMP (MID/END) | `RACKING` | "IronRidge" |
| ATTACHMENT | `RACKING` | "IronRidge" (HUG = Halo Ultragrip) |
| RD STRUCTURAL SCREW | `RACKING` | "IronRidge" (HW-RD1430-01-M1) |
| GROUNDING LUG | `ELECTRICAL_BOS` | — |
| JUNCTION BOX | `ELECTRICAL_BOS` | "EZ Solar" (JB-1.2) |
| AC DISCONNECT | `ELECTRICAL_BOS` | — (60A non-fused) |
| Wire/conduit (PV-4) | `ELECTRICAL_BOS` | — |
| TESLA BACKUP GATEWAY | `MONITORING` | "Tesla" (Backup Gateway-3) |
| PRODUCTION METER | `MONITORING` | "Xcel Energy" (Xcel jobs only) |

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

**Battery/Inverter:** Tesla Powerwall-3 (13.5 kWh, 11.5 kW AC discharge, model 1707000-XX-Y)

**Rapid Shutdown:** Tesla MCI-2 (standard) or MCI-2 High Current — count = number of modules / 2 rounded up, or 1 per string

**Racking:** IronRidge XR10 rail (168" lengths), HUG attachments, HW-RD1430-01-M1 structural screws

**Wiring:** 10 AWG PV-WIRE (DC), 6 AWG THWN-2 (AC), 3/0 AWG THWN-2 (utility side)

**Gateway:** Tesla Backup Gateway-3, 200A, NEMA 3R (model 1841000-X1-Y)

---

## Additional Resources

- **`references/extraction-guide.md`** — Full extraction guide with real BOM examples from two actual PB jobs (Cantwell PROJ8783 and Anderson PROJ-8539), complete conductor schedules, and validation rules
- **`references/bom-schema.md`** — Full JSON schema, CSV column order, and Markdown template with example output
- **`scripts/export-bom.py`** — Export script: takes BOM JSON, outputs .csv + .md + pretty JSON
