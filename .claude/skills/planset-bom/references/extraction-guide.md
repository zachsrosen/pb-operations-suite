# Planset BOM Extraction Guide

## PB Planset Structure

Photon Brothers uses a consistent AutoCAD-based planset template across all jobs. Every stamped PDF contains these standard sheets:

| Sheet | Number | Content |
|-------|--------|---------|
| Cover Sheet | PV-0 | System specs, sheet index, design criteria, general/electrical notes |
| Site Plan | PV-1 | Property layout, equipment callout labels |
| Roof Plan with Modules | PV-2 | **Primary BOM source** — roof layout + BILL OF MATERIALS table |
| Equipment Elevation | PV-2.1 | Photo callouts of installed equipment |
| Attachment Details | PV-3 | Racking cross-section details |
| Electrical Line Diagram | PV-4 | **SLD** — equipment part numbers, AC disconnect callout, rapid shutdown switch |
| Electrical Calculation | PV-5 | OCPD rating |
| Warning Labels | PV-6 | NEC-required labels (has ESS size confirmation) |
| Placard | PV-7 | Rapid shutdown placard |
| Spec Sheets | PV-8+ | Equipment data sheets |

**The BILL OF MATERIALS table is always on sheet PV-2 (Roof Plan with Modules).**
**Do NOT extract wires or conductors from PV-4.** Wires are stocked internally and not needed in the BOM.

---

## Step 1: PV-0 Cover Sheet — System Summary

The cover sheet always contains a **PHOTOVOLTAIC SYSTEM SPECIFICATIONS** block in the top-left. This gives the complete high-level equipment list. The headline also states system size.

**Headline format:** `[N] MODULES-ROOF MOUNTED - [kWdc] kWDC, [kWac] kWAC`

**Component list format:** `(N) [QTY] - [MAKE MODEL] ([WATTAGE]) [DESCRIPTION]`

- `(N)` = New equipment → include in BOM
- `(E)` = Existing equipment → note but mark as EXISTING, do not allocate from inventory
- Number after `(N)` is quantity; if no number, qty = 1

### Example — Cantwell (PROJ8783, 16 modules):
```
16 MODULES-ROOF MOUNTED - 7.040 kWDC, 11.500 kWAC
(N) 16 - SEG SOLAR SEG-440-BTD-BG (440W) MODULES
(N) 01 - TESLA POWERWALL-3
(N) 07 - TESLA MCI-2 RAPID SHUTDOWN DEVICES
(N) JUNCTION BOX
(E) 150A MAIN SERVICE PANEL          ← existing, skip
(E) 150A MAIN SERVICE DISCONNECT     ← existing, skip
(N) 200A TESLA BACKUP GATEWAY-3
(N) 60A NON-FUSED AC DISCONNECT
```

### Example — Anderson (PROJ-8539, 23 modules):
```
23 MODULES-ROOF MOUNTED - 10.120 kWDC, 11.500 kWAC
(N) 23 - HYUNDAI SOLAR HiN-T440NF(BK) (440W) MODULES
(N) TESLA POWERWALL-3
(N) 08 - TESLA MCI-2 HIGH CURRENT RAPID SHUTDOWN DEVICES
(N) JUNCTION BOX
(E) 200A MAIN SERVICE PANEL WITH (E) 200A MAIN BREAKER   ← existing
(E) 200A METER MAIN PANEL WITH (E) 02 - 200A MAIN BREAKERS ← existing
(N) 200A TESLA BACKUP GATEWAY-3
(N) 60A NON-FUSED UTILITY PV AC DISCONNECT
(N) XCEL ENERGY PV PRODUCTION METER
```

---

## Step 2: PV-2 Roof Plan — BILL OF MATERIALS Table

The BOM table is in the upper-right of PV-2. It has exactly three columns:

```
EQUIPMENT | QTY | DESCRIPTION
```

### Real BOM — Cantwell (PROJ8783):

| EQUIPMENT | QTY | DESCRIPTION |
|-----------|-----|-------------|
| RAIL | 15 | IRONRIDGE XR10 RAIL 168" |
| BONDED SPLICE | 00 | SPLICE KIT |
| CLAMP | 08 | MODULES CLAMPS (MID CLAMP) |
| CLAMP | 48 | MODULES CLAMPS (END CLAMP) |
| ATTACHMENT | 62 | IRONRIDGE QUICKMOUNT HALO ULTRAGRIP (HUG) ATTACHMENTS |
| RD STRUCTURAL SCREW | 124 | HW-RD1430-01-M1 RD STRUCTURAL SCREW, 3.0L |
| GROUNDING LUG | 12 | GROUND LUG |
| SOLAR PV MODULE | 16 | SEG SOLAR SEG-440-BTD-BG (440W) MODULES |
| BATTERY & INVERTER | 01 | TESLA POWERWALL-3 |
| RAPID SHUTDOWN | 07 | TESLA MCI-2 RAPID SHUTDOWN DEVICES |
| JUNCTION BOX | 01 | EZ SOLAR JB-1.2, 1000V, 80A MAX, MOUNTED ON ROOF FOR WIRE & CONDUIT TRANSITION |
| TESLA BACKUP GATEWAY 3 | 01 | 200A TESLA BACKUP GATEWAY 3 |
| AC DISCONNECT | 01 | 60A NON-FUSED AC DISCONNECT |

**⚠️ CRITICAL — Mapping PV-2 descriptions to BOM `model` field:**

The DESCRIPTION column in the PV-2 BOM table shows the *product name* (e.g., "TESLA POWERWALL-3"), NOT the part number. **Never use the PV-2 description as the `model` field.** The `model` must be the manufacturer part number from PV-4.

| PV-2 DESCRIPTION (raw) | `model` to output | `description` to output |
|------------------------|-------------------|------------------------|
| `TESLA POWERWALL-3` | `1707000-XX-Y` ← from PV-4 spec table | `TESLA POWERWALL 3, 13.5kWh BATTERY & INVERTER` |
| `TESLA POWERWALL-3 EXPANSION UNIT` | `1807000-XX-Y` ← from PV-4 spec table | `TESLA POWERWALL 3 EXPANSION UNIT, 13.5kWh` |
| `200A TESLA BACKUP GATEWAY 3` | `1841000-X1-Y` ← from PV-4 callout | `TESLA BACKUP GATEWAY 3, 200A, NEMA 3R, UL LISTED` |
| `SEG SOLAR SEG-440-BTD-BG (440W) MODULES` | `SEG-440-BTD-BG` ← model # portion | `SEG SOLAR SEG-440-BTD-BG (440W) MODULES` |

The PV-4 spec tables are the **authoritative source** for part numbers. Always look there first.

### Real BOM — Anderson (PROJ-8539):

| EQUIPMENT | QTY | DESCRIPTION |
|-----------|-----|-------------|
| RAIL | 14 | IRONRIDGE XR10 RAIL 168" |
| BONDED SPLICE | 04 | SPLICE KIT |
| CLAMP | 30 | MODULES CLAMPS (MID CLAMP) |
| CLAMP | 32 | MODULES CLAMPS (END CLAMP) |
| ATTACHMENT | 71 | IRONRIDGE QUICKMOUNT HALO ULTRAGRIP (HUG) ATTACHMENTS |
| RD STRUCTURAL SCREW | 142 | HW-RD1430-01-M1 RD STRUCTURAL SCREW, 3.0L |
| GROUNDING LUG | 08 | GROUND LUG |
| SOLAR PV MODULE | 23 | HYUNDAI SOLAR HiN-T440NF(BK) (440W) MODULES |
| BATTERY & INVERTER | 01 | TESLA POWERWALL-3 |
| RAPID SHUTDOWN | 08 | TESLA MCI-2 HIGH CURRENT RAPID SHUTDOWN DEVICES |
| JUNCTION BOX | 01 | EZ SOLAR JB-1.2, 1000V, 80A MAX, MOUNTED ON ROOF FOR WIRE & CONDUIT TRANSITION |
| TESLA BACKUP GATEWAY | 01 | 200A TESLA BACKUP GATEWAY-3 |
| PRODUCTION METER | 01 | XCEL ENERGY PV PRODUCTION METER |
| AC DISCONNECT | 01 | 60A NON-FUSED UTILITY PV AC DISCONNECT |

### Module Detail Block (also on PV-2, upper-left):
```
NUMBER OF MODULES     | 16 MODULES
MODULE                | SEG SOLAR SEG-440-BTD-BG (440W)
MODULE DIMENSIONS     | 67.8" X 44.6" X 1.18"
MODULE WEIGHT         | 52.9 LBS / 24.0 KG.
UNIT WEIGHT OF ARRAY  | 2.52 PSF
```

Extract: module make, model, wattage, qty, weight, dimensions from this block.

---

## Step 3: PV-4 Electrical Line Diagram — Conductor Schedule

The SLD on PV-4 contains two important data sources:

### A. System Summary Block (top-left of PV-4):
Lists the same components as PV-0 but also includes **model numbers with part numbers**:

```
16  SEG SOLAR SEG-440-BTD-BG (440W) MODULES
01  TESLA POWERWALL-3
07  TESLA MCI-2 RAPID SHUTDOWN DEVICES
(02) STRINGS OF 04 MODULES, (01) STRING OF 05 MODULES & (01) STRING OF 03 MODULES
```

### B. Solar Module Specifications Table (PV-4 top-center):
```
MANUFACTURER / MODEL #  | SEG SOLAR SEG-440-BTD-BG (440W) MODULES
VMP                     | 32.70 V
IMP                     | 13.46 A
VOC                     | 39.30 V
ISC                     | 14.15 A
MODULE DIMENSION        | 67.8"L x 44.6"W x 1.18"D
```

### C. Powerwall Specifications Table (PV-4 top-center):
```
MANUFACTURER / MODEL #              | TESLA POWERWALL 3 (1707000-XX-Y)
NOMINAL BATTERY ENERGY              | 13.5 kWH
MAXIMUM CONTINUOUS DISCHARGE POWER | 11.5 kW AC
MAXIMUM CONTINUOUS CHARGE POWER    | 5 kW AC
MAXIMUM CONTINUOUS CURRENT         | 48 A
MAXIMUM OUTPUT FAULT CURRENT       | 160 A
NOMINAL OUTPUT VOLTAGE              | 240 V
```

### D. Conductor / Wire Schedule Table (PV-4 bottom):

**SKIP — Do NOT extract wires or conductors.** The conductor schedule table (Tags A/B/C/D) is present on PV-4 but wires are stocked internally and should NOT be included in the BOM.

### E. Tesla Gateway Spec (PV-4):
`(N) TESLA BACKUP GATEWAY-3 W/200A, NEMA 3R, UL LISTED (1841000-X1-Y)`
→ Confirms gateway model number for BOM.

---

## Step 4: PV-5 Electrical Calculation — OCPD Confirmation

PV-5 confirms OCPD rating. Use this to validate the AC disconnect size:

```
OCPD: 60 A Overcurrent Protection
```

The OCPD rating (60A) should match the AC disconnect size listed in PV-2 BOM (60A NON-FUSED AC DISCONNECT).

---

## Step 5: PV-6 Warning Labels — ESS Size Confirmation

PV-6 contains the emergency ESS disconnect label which states battery capacity:

```
EMERGENCY ENERGY STORAGE SYSTEM DISCONNECT
ESS SIZE: 13.5kWh
```

Use this to confirm battery kWh for the BOM (13.5 kWh = Tesla Powerwall-3 nominal).

---

## BOM Category Mapping

| PV-2 EQUIPMENT Label | BOM Category | EquipmentSku.category | unitSpec example |
|----------------------|-------------|-----------------------|-----------------|
| SOLAR PV MODULE | Module | `MODULE` | "440W" |
| BATTERY & INVERTER | Battery/Inverter combo | `BATTERY` | "13.5kWh" |
| RAPID SHUTDOWN | Rapid shutdown devices | `RAPID_SHUTDOWN` | — |
| RAIL | Racking rail | `RACKING` | "168\"" |
| BONDED SPLICE | Rail splice | `RACKING` | — |
| CLAMP (MID) | Mid clamp | `RACKING` | — |
| CLAMP (END) | End clamp | `RACKING` | — |
| ATTACHMENT | Roof attachment (HUG) | `RACKING` | — |
| RD STRUCTURAL SCREW | Structural screw | `RACKING` | "3.0L" |
| GROUNDING LUG | Ground lug | `ELECTRICAL_BOS` | — |
| JUNCTION BOX | Roof J-box | `ELECTRICAL_BOS` | "80A, 1000V" |
| TESLA BACKUP GATEWAY | Gateway/comms | `MONITORING` | "200A" |
| TESLA BACKUP SWITCH | Backup switch (simpler) | `MONITORING` | "200A" |
| BATTERY (expansion) | Expansion storage unit | `BATTERY` | "13.5kWh" |
| SUB PANEL | New load center | `ELECTRICAL_BOS` | "125A" |
| AC DISCONNECT | AC disconnect | `ELECTRICAL_BOS` | "60A" |
| PRODUCTION METER | Utility PV meter | `MONITORING` | — |
| EMT conduit (from PV-4) | Conduit | `ELECTRICAL_BOS` | "3/4\" EMT" |

---

## Validation Cross-Checks

After extracting the full BOM, run these checks:

1. **Module count**: Sum of all STRING # modules = SOLAR PV MODULE qty in PV-2 BOM
2. **Battery capacity**: ESS SIZE on PV-6 label = kWh listed in POWERWALL 3 SPECIFICATIONS on PV-4
3. **OCPD match**: PV-5 OCPD rating (60A) = AC disconnect size in PV-2 BOM
4. **Gateway paired with battery**: If BATTERY & INVERTER row is present, TESLA BACKUP GATEWAY row must also be present
5. **OCPD matches disconnect**: PV-5 OCPD rating matches AC disconnect amp rating from PV-2
6. **Production meter**: Xcel Energy jobs require XCEL ENERGY PV PRODUCTION METER; PVREA jobs do not

Flag any mismatch as `VALIDATION_WARNING` in BOM output.

---

## Roof Type Variations — Racking Hardware Changes

**Roof type is critical** — it determines what attachment system is used. Read from DESIGN CRITERIA block on PV-0.

| Roof Type | Attachment System | Rail | Notes |
|-----------|------------------|------|-------|
| ASPHALT SHINGLE | IronRidge Quickmount Halo Ultragrip (HUG) | XR10 168" | Most common |
| TRAPEZOIDAL METAL ROOF | S-5! ProteaBracket | XR100 168" | Clips to standing seams, no lag screws |
| STANDING SEAM METAL | S-5! clips (various) | XR10 or XR100 | Check seam spacing |

**IronRidge HUG jobs** (asphalt shingle): ATTACHMENT qty + RD STRUCTURAL SCREW qty (lag bolts into rafters)
**S-5! ProteaBracket jobs** (metal roof): ATTACHMENT = "S-5! PROTEABRACKET ATTACHMENTS" — no lag screws row

Rowe (PROJ8788) BOM example for metal roof:
```
ATTACHMENT | 97 | S-5! PROTEABRACKET ATTACHMENTS
RAIL       | 29 | IRONRIDGE XR100 RAIL 168"
```
No "RD STRUCTURAL SCREW" row at all. Rail is XR100 (not XR10).

---

## Powerwall-3 Expansion Unit

Some jobs include a **TESLA POWERWALL-3 EXPANSION UNIT** as a separate line item alongside the base Powerwall-3. This is an additional storage module that stacks physically with the Powerwall-3.

**On PV-2 BOM, look for two separate rows:**
```
BATTERY & INVERTER | 01 | TESLA POWERWALL-3
BATTERY            | 01 | TESLA POWERWALL-3 EXPANSION UNIT
```

**On cover sheet (PV-0):**
```
(N) 01 - TESLA POWERWALL-3
(N) 01 - TESLA POWERWALL-3 EXPANSION UNIT
```

**On site plan:** Labeled as "(N) TESLA POWERWALL-3 (STACKED WITH POWERWALL-3 EXPANSION UNIT)"

The expansion unit adds ~13.5 kWh. PV-6 ESS size label will reflect both combined (e.g., "ESS SIZE: 27.0kWh").

**Part number extraction:** Look for the expansion unit callout on the SLD (PV-4), labeled e.g. `(N) TESLA POWERWALL-3 EXPANSION PACK (1807000-XX-Y)`. The part number appears in parentheses.

**Output two separate BOM line items:**
```json
{ "category": "BATTERY", "brand": "Tesla", "model": "1707000-XX-Y", "description": "TESLA POWERWALL 3, 13.5kWh BATTERY & INVERTER", "qty": 1, "unitSpec": "13.5kWh" }
{ "category": "BATTERY", "brand": "Tesla", "model": "1807000-XX-Y", "description": "TESLA POWERWALL 3 EXPANSION UNIT, 13.5kWh", "qty": 1, "unitSpec": "13.5kWh" }
```

**Rule:** `model` = part number from PV-4 SLD callout (e.g., `1807000-XX-Y`), never `"Powerwall-3 expansion unit"` or any product name string.

---

## Tesla Backup Switch vs. Tesla Backup Gateway-3

Two different monitoring/control units appear across jobs — look at the legend on PV-2:

| Equipment | Legend Tag | When Used |
|-----------|-----------|-----------|
| Tesla Backup Gateway-3 | `TG` | Most jobs — full monitoring + load center control |
| Tesla Backup Switch | `TBS` | Simpler jobs — when full gateway not required |

Both are `MONITORING` category. Model numbers differ:
- Gateway-3: `1841000-X1-Y`
- Backup Switch: `1624171-XX-Y`

**Active extraction rule:** A job will have one or the other, never both. Scan PV-2 BOM for a `BACKUP SWITCH` / `TBS` row, or scan PV-4 SLD for `(N) BACKUP SWITCH` callout. If found, output:

```json
{ "category": "MONITORING", "brand": "Tesla", "model": "1624171-00-J",
  "description": "TESLA BACKUP SWITCH", "qty": 1, "source": "PV-4" }
```

If a Gateway-3 row is present instead, output the Gateway-3 entry (see category mapping). Do not include both.

---

## Sub Panel

Some jobs add a new sub panel (load center). Look for:
```
SUB PANEL | 01 | 125A SUB PANEL
```

Category: `ELECTRICAL_BOS`. Amp rating from description. Parker (PROJ-8860) included a 125A sub panel.

---

## Main Breaker Enclosure → Two BOM Items

When the PV-2 BOM table (or PV-0 cover sheet) lists a **60A MAIN BREAKER ENCLOSURE**, this implies two separate physical products that must be ordered:

1. **The enclosure (load center)** — `TL270RCU`: 70A Main Lugs, 1PH, 65kA, 120/240VAC, 2/4 Circuit
2. **The breaker** — `THQL2160`: 60A 2-Pole GE circuit breaker that populates the enclosure

**Rule:** Always output TWO BOM items when you see "60A MAIN BREAKER ENCLOSURE":

```json
{ "category": "ELECTRICAL_BOS", "brand": "", "model": "TL270RCU",
  "description": "LOAD CENTER, 70A, MAIN LUGS, 1PH, 65KA, 120/240VAC, 2/4 CIRCUIT", "qty": 1 }
{ "category": "ELECTRICAL_BOS", "brand": "GE", "model": "THQL2160",
  "description": "60A 2-POLE GE CIRCUIT BREAKER", "qty": 1 }
```

The planset only shows one line item but ops always orders both. The breaker is never listed separately in the planset — outputting it here ensures it makes it into the SO.

---

## BONDED SPLICE — Use Rail-Specific Model

The PV-2 BOM table always labels the splice as "SPLICE KIT" or "BONDED SPLICE" generically. When outputting this item, include the rail system in the description so the correct SKU is matched:

| Rail System | Output `model` | Output `description` |
|-------------|----------------|----------------------|
| XR10 (asphalt shingle) | `XR10-BOSS-01-M1` | `IRONRIDGE XR10 BONDED SPLICE MILL` |
| XR100 (metal/trapezoidal) | `XR100-BOSS-01-M1` | `IRONRIDGE XR100 BONDED SPLICE MILL` |

**Rule:** Check the RAIL row in PV-2 BOM to determine rail type (XR10 or XR100), then set the splice model accordingly. Never output "SPLICE KIT" as the model — it will match the wrong Zoho product.

---

## AC Disconnect SKU — 2-Wire vs 3-Wire

The AC disconnect SKU depends on whether the circuit is 2-wire or 3-wire. Check the PV-4 SLD callout text for the AC disconnect:

| PV-4 SLD Description | SKU | Notes |
|----------------------|-----|-------|
| `60A NON-FUSED ... 1-PHASE, **2-WIRE**` or no wire count | `DG222URB` | Most common — 2-pole knife blade |
| `60A NON-FUSED ... 1-PHASE, **3-WIRE**` | `TGN3322R` | 3-pole — used on service upgrade jobs with neutral |

**Rule:** Always read the AC disconnect callout on the PV-4 SLD (not just the PV-2 BOM description). If "3-WIRE" appears in the disconnect callout, use `TGN3322R`. Default to `DG222URB` if ambiguous or no wire count stated.

**Why this matters:** Service upgrade jobs (where the PW3 is tied in upstream of the main panel) wire the disconnect with hot-hot-neutral (3-wire). The TGN3322R disconnects all three conductors. The DG222URB only disconnects 2.

---

## Rapid Shutdown Switch (IMO) — PV-4 SLD Callout

The PV-2 BOM table lists `RAPID SHUTDOWN | N | TESLA MCI-2 ...` for the module-level shutdown devices. However, the **control unit** that triggers those MCI-2s (the Rapid Shutdown Switch / initiator) is **NOT a separate row in the PV-2 BOM table** — it is shown in the PV-4 SLD as a callout with a comm wire running to the MCI-2 string devices.

**When you see `(N) RAPID SHUTDOWN SWITCH` in the PV-4 SLD** (typically shown with a `16/2 COMM WIRE` label), add to BOM:

```json
{ "category": "RAPID_SHUTDOWN", "brand": "IMO", "model": "IMO SI16-PEL64R-2",
  "description": "IMO RAPID SHUTDOWN DEVICE, SI16-PEL64R-2", "qty": 1, "source": "PV-4" }
```

**Extraction rule:**
1. Scan PV-4 SLD for the text `RAPID SHUTDOWN SWITCH` (with or without "(N)")
2. If found → add 1× `IMO SI16-PEL64R-2` to BOM
3. If NOT found (some jobs use a different initiator already in the panel) → omit

This item is always 1 per job regardless of module count.

---

## Ops-Standard Additions

These items are ordered on every **solar (PV module) job** (or triggered by a specific planset condition) regardless of whether the planset mentions them. Add them to the BOM output so they appear in the generated SO.

> **Solar-only condition:** The always-add items below (critter guard, solobox) apply **only when the planset includes roof-mounted PV modules**. Do **not** add them for battery-only, EV-charger-only, or other non-solar installs.

### Always Add (Solar Jobs Only)

#### Snow Dogs (Snow Guards)

Every PB solar job gets Alpine Snow Dogs. Always output:

```json
{ "category": "RACKING", "brand": "", "model": "SNOW DOG-BLK",
  "description": "ALPINE SNOW DOG", "qty": 10, "unitLabel": "pcs", "source": "OPS_STANDARD" }
```

**Rule:** Always add 10× snow dogs to every solar job. Qty is fixed at 10 regardless of array size. Skip for battery-only or EV-only jobs.

#### Strain Relief 3/4" 5-Hole

Every solar job gets strain reliefs for J-box conduit entries. Always output:

```json
{ "category": "ELECTRICAL_BOS", "brand": "", "model": "M3317GBZ-SM",
  "description": "STRAIN RELIEF 3/4\" 5 HOLE", "qty": 5, "source": "OPS_STANDARD" }
```

**Rule:** Always add 5× strain reliefs to every solar job. Fixed qty. Skip for battery-only or EV-only jobs.

#### Critter Guard — Two Products

Every solar job gets critter guard bird proofing. Always output **two separate BOM items**:

```json
{ "category": "ELECTRICAL_BOS", "brand": "", "model": "S6466",
  "description": "CRITTER GUARD 6\" ROLL, BIRD PROOFING", "qty": 4, "unitLabel": "box", "source": "OPS_STANDARD" }
{ "category": "ELECTRICAL_BOS", "brand": "Heyco", "model": "S6438",
  "description": "HEYCO SUNSCREENER CLIP, BIRD PROOFING", "qty": 4, "unitLabel": "box", "source": "OPS_STANDARD" }
```

**Rule:** If the planset has PV modules, output both items even if the planset doesn't mention critter guard. Qty is always 4 boxes each. Skip for battery-only or EV-only jobs.

#### UNIRAC SOLOBOX COMP-D (Standard Junction Box)

Every solar job uses the **UNIRAC SOLOBOX COMP-D** as the roof junction box — regardless of what the planset shows (plansets sometimes specify a different J-box model). Always output:

```json
{ "category": "ELECTRICAL_BOS", "brand": "UNIRAC", "model": "SBOXCOMP-D",
  "description": "UNIRAC SOLOBOX COMP-D JUNCTION BOX", "qty": 3, "source": "OPS_STANDARD" }
```

**Rule:** If the PV-2 BOM table lists `JUNCTION BOX`, replace it with the SOLOBOX COMP-D entry above. Do not include the planset's J-box model — always substitute SBOXCOMP-D. Only applies when PV modules are present.

---

### Triggered by Production Meter

When the job has a **XCEL ENERGY PV PRODUCTION METER** (or any production meter install), always add these two accessories alongside the meter:

```json
{ "category": "MONITORING", "brand": "", "model": "K8180",
  "description": "METER BYPASS JUMPERS", "qty": 1, "unitLabel": "pair", "source": "OPS_STANDARD" }
{ "category": "MONITORING", "brand": "", "model": "43974",
  "description": "METER COVER", "qty": 1, "source": "OPS_STANDARD" }
```

**Rule:** Whenever you output a production meter BOM item (e.g., `U4801XL5T9`), also output the two meter accessories above. They ship with every meter install.

---

### Triggered by HUG Attachments (Asphalt Shingle Jobs)

When the job uses IronRidge HUG attachments (XR10 rail, asphalt shingle roof), always add T-bolt bonding hardware. Qty = same as ATTACHMENT qty from PV-2 BOM:

```json
{ "category": "RACKING", "brand": "IronRidge", "model": "BHW-TB-03-A1",
  "description": "IRONRIDGE T-BOLT BONDING HARDWARE", "qty": [HUG attachment qty], "source": "OPS_STANDARD" }
```

**Rule:** If the PV-2 BOM ATTACHMENT row uses HUG (not S-5! ProteaBracket), add T-bolts with qty equal to the ATTACHMENT qty. Do NOT add for metal roof (S-5!) jobs.

---

### Triggered by Tap / Service Upgrade

When the job includes a **tap** or **service upgrade** (look for "SERVICE UPGRADE", "METER SOCKET TAP", "UTILITY TAP", or any 3-wire disconnect on PV-4), add:

```json
{ "category": "ELECTRICAL_BOS", "brand": "", "model": "BIPC4/010S",
  "description": "INSULATION PIERCING CONNECTOR", "qty": 3, "source": "OPS_STANDARD" }
```

**Rule:** If PV-4 shows a 3-wire AC disconnect (`TGN3322R`) or the cover sheet mentions "SERVICE UPGRADE" / "UTILITY TAP", include 3× IPC connectors. These pierce the utility conductors for the tap connection.

---

## Items NOT in BOM Table (but extractable from planset)

| Item | Source Sheet | Notes |
|------|-------------|-------|
| **Rapid Shutdown Switch (IMO)** | **PV-4 SLD callout** | **"(N) RAPID SHUTDOWN SWITCH" → 1× IMO SI16-PEL64R-2** |
| **AC disconnect wire config** | **PV-4 SLD callout** | **"3-WIRE" → TGN3322R; default → DG222URB** |
| Module electrical specs (Vmp, Imp, Voc, Isc) | PV-4 module spec table | Add to module row as additional fields |
| Battery model number (part #) | PV-4 (e.g., 1707000-XX-Y) | Add to battery row |
| Gateway model number | PV-4 (e.g., 1841000-X1-Y) | Add to monitoring row |
| ESS kWh capacity | PV-6 warning label | Confirms battery spec |
| Snow guards | PV-1 site plan callouts | "SNOW DOG SNOWGUARD" if present |
| Structural screw type | PV-3 attachment detail | Wood screw: #14-14, 1.5" min embedment |
