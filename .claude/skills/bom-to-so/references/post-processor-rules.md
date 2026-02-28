# Post-Processor Rules Reference

Two post-processors run at different pipeline stages. This document covers every rule, pattern table, and quantity formula in both.

## Overview

| Property | BOM Post-Processor | SO Post-Processor |
|----------|-------------------|-------------------|
| **File** | `src/lib/bom-post-process.ts` | `src/lib/bom-so-post-process.ts` |
| **Runs at** | Snapshot save (`POST /api/bom/history`) | SO creation (`POST /api/bom/create-so`) |
| **Env flag** | `ENABLE_BOM_POST_PROCESS=true` | `ENABLE_SO_POST_PROCESS=true` |
| **Version** | `2026-02-27-v2` | `2026-02-28-v3` |
| **Purity** | Pure synchronous, no external calls | Async, calls Zoho `findItemIdByName` |
| **Qty behavior** | INFORMATIONAL only (does NOT mutate `item.qty`) | MUTATES quantities directly on line items |
| **Additions** | Returns `suggestedAdditions[]` as separate array | Adds items directly to SO `lineItems[]` |

## Shared: Job Context Detection

Both processors use `detectJobContext(project, items)` from `bom-so-post-process.ts`. The BOM processor runs it AFTER Rules 1-3 (normalization), so it sees corrected categories/models.

### Detection Logic

| Field | Detection Method |
|-------|-----------------|
| `jobType` | `solar` if MODULE items exist without BATTERY; `battery_only` if BATTERY only; `hybrid` if both |
| `roofType` | Checks `project.roofType` string + all item descriptions for patterns |
| `isStandingSeamS5` | `roofType === "standing_seam_metal"` AND descriptions match `/s-?5\|l-?foot\|protea/i` |
| `hasPowerwall` | Any item model matches `/1707000/i` |
| `hasExpansion` | Any item model matches `/1807000/i` |
| `isStackedExpansion` | hasExpansion + hasPowerwall + total battery unit qty > 2 |
| `hasBackupSwitch` | Model matches `/1624171/i` or description matches `/backup\s*switch/i` |
| `hasGateway3` | Model matches `/1841000/i` |
| `hasRemoteMeter` | Model/desc matches `/2045796\|P2045794\|remote\s*meter/i` |
| `hasProductionMeter` | Model/desc matches `/production\s*meter\|pv\s*meter\|U4801\|U9701\|U9101/i` |
| `hasServiceTap` | Model matches `/DG222NRB\|TG3222R\|TGN3322R/i` or desc matches `/service\s*tap\|fusible/i` |
| `serviceTapType` | `fused_disconnect` if DG222NRB/fusible; `breaker_enclosure` if TG3222R/TGN3322R |
| `hasEnphase` | Brand matches `/enphase/i` or model matches `/IQ8\|Q-12-RAW/i` |
| `hasEvCharger` | Model/desc matches `/ev\s*charger\|1734411/i` |
| `moduleCount` | `project.moduleCount` if valid number, else sum of MODULE item quantities |

### Roof Type Detection

Priority order:
1. `/standing\s*seam\|s-?5\|l-?foot\|protea/i` -> `standing_seam_metal`
2. `/\btile\b/i` in roofStr OR `/\btile\s*hook\|ath-01/i` in descriptions -> `tile`
3. `/trap\|corrugated/i` OR `/xr-?100/i` -> `trapezoidal_metal`
4. Default for solar jobs: `asphalt_shingle`
5. Default for battery-only: `unknown`

---

## BOM Post-Processor Rules

Source: `src/lib/bom-post-process.ts`
Function: `postProcessBomItems(project, items) -> BomPostProcessResult`

### Rule 1: Category Normalization

Aliases normalized in-place on `item.category`:

| Input Category | Normalized To |
|---------------|---------------|
| `MOUNT` | `RACKING` |
| `MOUNTING` | `RACKING` |
| `ELECTRICAL` | `ELECTRICAL_BOS` |
| `ELEC_BOS` | `ELECTRICAL_BOS` |
| `ELEC` | `ELECTRICAL_BOS` |
| `BOS` | `ELECTRICAL_BOS` |
| `PV_MODULE` | `MODULE` |
| `SOLAR_MODULE` | `MODULE` |
| `STORAGE` | `BATTERY` |
| `ESS` | `BATTERY` |

### Rule 2: Brand Inference

If `item.brand` is empty/null, infer from model/description patterns:

| Pattern (RegExp) | Inferred Brand |
|-----------------|----------------|
| `/^1707000/` | Tesla |
| `/^1807000/` | Tesla |
| `/^1624171/` | Tesla |
| `/^1841000/` | Tesla |
| `/^1978069\|^1978070/` | Tesla |
| `/^1875157/` | Tesla |
| `/^1734411/` | Tesla |
| `/^2045796\|^P2045794\|^P2060713/` | Tesla |
| `/IQ8\|Q-12-RAW\|IQ-COMBINER/i` | Enphase |
| `/^XR-?10\|^XR-?100/i` | IronRidge |
| `/^UFO-\|^CAMO-\|^ATH-\|^BHW-\|^LFT-/i` | IronRidge |
| `/TL270RCU\|THQL21/i` | GE |
| `/DG222\|TG3222\|TGN3322/i` | Eaton |
| `/^HOM\d\|HOMT\d/i` | Square D |
| `/^Q2\d{2}$\|^Q1\d{2}$/i` | Siemens |
| `/^BR\d/i` | Eaton |
| `/SI16-PEL/i` | IMO |
| `/^MCI-2/i` | Tesla |
| `/^U4801\|^U9701\|^U9101/i` | Milbank |
| `/SBOXCOMP/i` | UNIRAC |
| `/JB-1\.2\|JB-2\|JB-3/i` | EZ Solar |
| `/S6466\|critter\s*guard/i` | SolarEdge |
| `/S6438\|sunscreener/i` | Heyco |
| `/M3317GBZ/i` | Arlington |

### Rule 3: Model Standardization

Product names in descriptions are replaced with canonical part numbers:

| Pattern (on description) | Canonical Model | Canonical Description |
|-------------------------|----------------|----------------------|
| `/powerwall\s*3(?!\s*expansion)/i` | `1707000-XX-Y` | Tesla Powerwall 3, 13.5kWh Battery & Inverter |
| `/pw3\s*expansion\|powerwall\s*3\s*expansion/i` | `1807000-XX-Y` | Tesla Powerwall 3 Expansion Unit |
| `/backup\s*gateway\s*3\|gateway[- ]?3/i` | `1841000-X1-Y` | Tesla Backup Gateway 3, 200A, NEMA 3R |
| `/backup\s*switch/i` | `1624171-00-x` | Tesla Backup Switch |

Only applies if description matches but model doesn't already contain the canonical prefix.

### Rule 4: Quantity Corrections (Informational Only)

Records suggested corrections in `corrections[]` but does **NOT** change `item.qty`. This prevents qty changes from silently propagating to PO/SO creation.

| Item Pattern | Formula (mc = moduleCount) |
|-------------|---------------------------|
| Snow dogs (`/snow\s*dog/i`) | standing_seam -> 0; mc<=10 -> 2; mc<=12 -> 4; mc<=13 -> 6; mc<=15 -> 8; else -> 10 |
| Critter guard (`/critter\s*guard\|S6466/i`) | mc<=10 -> 1; mc<=20 -> 2; else -> 4 |
| SunScreener (`/sunscreener\|S6438/i`) | mc<=10 -> 1; mc<=20 -> 2; else -> 4 |
| Strain relief (`/strain\s*relief\|M3317GBZ/i`) | mc<=25 -> 2; else -> 3 |
| SOLOBOX (`/solobox\|SBOXCOMP/i`) | mc<=10 -> 1; mc<=20 -> 2; else -> 3 |
| RD screws (`/2101175\|HW-RD\|rd\s*structural\s*screw/i`) | mc<=25 -> 120; else -> 240 |

### Rule 5: Suggested Additions

Returns `suggestedAdditions[]` as a separate array (NOT added to `items[]`). These are synced to the `EquipmentSku` inventory table.

| Condition | Suggested Item | Qty | Reason |
|-----------|---------------|-----|--------|
| Solar + PW3 (`jobType !== "battery_only" && hasPowerwall`) | GE TL270RCU (70A 2-Pole Load Center) | 1 | OPS_STANDARD: always needed for PW3 solar |
| Solar + PW3 | GE THQL2160 (60A 2-Pole Breaker) | 1 | OPS_STANDARD: always needed for PW3 solar |
| Fused disconnect (`serviceTapType === "fused_disconnect"`) | Bussman 46201 (60A Fuses) | 2 | Always needed with fusible disconnect |
| Breaker enclosure (`serviceTapType === "breaker_enclosure"`) | GE TL270RCU | 1 | Breaker enclosure for service tap |
| Breaker enclosure | GE THQL2160 | 1 | Breaker enclosure for service tap |
| Expansion (wall mount) | Tesla 1978069-00-x (Wall Mount Kit) | 1 | Default config for PW3 Expansion |
| Expansion (stacked) | Tesla 1978070-00-x (Stacking Kit) | 1 | Stacked config detected from planset |
| Any expansion | Tesla 1875157-20-y (Expansion Harness 2.0m) | 1 | Always needed with Expansion unit |
| Tile roof + solar | IronRidge ATH-01-M1 (Tile Hook) | mc * 4 | Required for tile roof |
| Tile roof + solar | IronRidge BHW-TB-03-A1 (T-Bolt Bonding) | mc * 4 | Required for tile roof |
| Tile roof + solar | EZ Solar JB-2 (Tile J-Box) | 2 | Required for tile roof |
| Standing seam S-5 + solar | IronRidge LFT-03-M1 (L-Foot Mount) | mc * 3 | Required for S-5! system |
| Solar + no IMO detected | IMO SI16-PEL64R-2 (Rapid Shutdown) | 1 | Commonly missing from PV-4 SLD extraction |

---

## SO Post-Processor Rules

Source: `src/lib/bom-so-post-process.ts`
Function: `postProcessSoItems(lineItems, bomData, findItemIdByName) -> PostProcessResult`

### Rule 1: SKU Swaps by Roof Type

Only applies when `isStandingSeamS5 === true`:

| Original SKU Pattern | Replacement SKU | Reason |
|---------------------|-----------------|--------|
| `UFO-CL-01-B1` (mid clamp, Black) | `UFO-CL-01-A1` (mid clamp, Mill) | Standing seam S-5!/L-Foot uses Mill finish |
| `UFO-END-01-B1` (end clamp) | `CAMO-01-M1` (Camo End) | Standing seam uses Camo End instead of standard end clamp |

The replacement item is looked up via `findItemIdByName` to get the correct Zoho `item_id`. SKU-swapped items are "locked" — subsequent rules won't modify them.

### Rule 2: Remove Wrong Items

Items removed based on roof type and job type:

#### Standing Seam Metal (`isStandingSeamS5`)

| Item Pattern | Reason |
|-------------|--------|
| `/snow\s*dog/i` | Not used on standing seam |
| `/\b2101151\b\|\bhug\s+attach/i` (excluding screws) | HUG attachment not used (L-Foot instead) |
| `/2101175\|HW-RD\|rd\s*structural\s*screw/i` | RD structural screws not used (no shingle penetration) |

#### Tile Roof

| Item Pattern | Reason |
|-------------|--------|
| `/\b2101151\b\|\bhug\s+attach/i` (excluding screws) | HUG attachment not used (tile hooks instead) |
| `/2101175\|HW-RD\|rd\s*structural\s*screw/i` | RD structural screws not used (tile hooks replace) |

#### Battery-Only Jobs (`jobType === "battery_only"`)

| Item Pattern | Reason |
|-------------|--------|
| `/\b1841000\b\|gateway-?3\|backup\s*gateway/i` | Gateway-3 not used |
| `/\bac\s*disconnect\b\|DG222URB\|D224NRB\|TGN3324R/i` | AC disconnect not used |
| `/THQL21100/i` | THQL21100 breaker not used |
| `/TL270RCU/i` | Load center not used |
| `/THQL2160/i` | THQL2160 breaker not used |
| `/snow\s*dog/i` | No roof-mounted PV |
| `/critter\s*guard\|S6466/i` | No roof-mounted PV |
| `/sunscreener\|S6438/i` | No roof-mounted PV |
| `/strain\s*relief\|M3317GBZ/i` | No roof-mounted PV |
| `/solobox\|SBOXCOMP/i` | No roof-mounted PV |

### Rule 3: Quantity Adjustments (MUTATES)

These directly change `item.quantity` on SO line items. Note the thresholds differ slightly from BOM post-processor Rule 4.

| Item Pattern | Formula (mc = moduleCount) | vs BOM PP difference |
|-------------|---------------------------|---------------------|
| Snow dogs | standing_seam/tile -> 0 (remove); mc<=10 -> 2; mc<=12 -> 4; mc<=13 -> 6; mc<=15 -> 8; else -> 10 | Tile also removes (BOM PP only removes standing_seam) |
| Critter guard (`/critter\s*guard\|S6466/i`) | mc<=15 -> 1; mc<=25 -> 2; else -> 4 | Thresholds: 15/25 (BOM PP: 10/20) |
| SunScreener (`/sunscreener\|S6438/i`) | mc<=15 -> 1; mc<=25 -> 2; else -> 4 | Thresholds: 15/25 (BOM PP: 10/20) |
| Strain relief (`/strain\s*relief\|M3317GBZ/i`) | mc<=15 -> 1; else -> 2 | Different: 15->1/2 (BOM PP: 25->2/3) |
| SOLOBOX (`/solobox\|SBOXCOMP/i`) | mc<=12 -> 1; mc<=20 -> 2; else -> 3 | Threshold: 12 (BOM PP: 10) |
| RD screws (`/2101175\|HW-RD\|rd\s*structural\s*screw/i`) | mc<=18 -> 120; else -> 240 | Threshold: 18 (BOM PP: 25) |

**Important**: The SO post-processor thresholds are the authoritative values for the final Sales Order. The BOM post-processor values are informational suggestions only.

### Rule 4: Add Missing OPS_STANDARD Items

Items added directly to the SO line items via `addIfMissing()` which calls `findItemIdByName` to resolve Zoho item IDs. Deduplication uses normalized name/SKU matching.

| Condition | Added Item (Zoho lookup query) | Qty | Reason |
|-----------|-------------------------------|-----|--------|
| Solar + PW3 | `TL270RCU` | 1 | OPS_STANDARD: Load center for PW3 solar |
| Solar + PW3 | `THQL2160` | 1 | OPS_STANDARD: 60A breaker for PW3 solar |
| Expansion | `1978069-00-x` (Wall Mount Kit) | 1 | Always needed with Expansion unit |
| Expansion | `1875157-20-y` (Expansion Harness) | 1 | Always needed with Expansion unit |
| Tile roof + solar | `ATH-01-M1` (Tile Hook) | mc * 4 | Required for tile roof |
| Tile roof + solar | `BHW-TB-03-A1` (T-Bolt Bonding) | mc * 4 | Required for tile roof |
| Tile roof + solar | `JB-2` (Tile J-Box) | 2 | Required for tile roof |
| Standing seam S-5 + solar | `LFT-03-M1` (L-Foot Mount) | mc * 3 | Required for S-5! system |

---

## Threshold Comparison Table

Side-by-side comparison for items with different thresholds between the two processors:

| Item | BOM PP (informational) | SO PP (authoritative) |
|------|----------------------|---------------------|
| Critter guard | mc<=10:1, mc<=20:2, else:4 | mc<=15:1, mc<=25:2, else:4 |
| SunScreener | mc<=10:1, mc<=20:2, else:4 | mc<=15:1, mc<=25:2, else:4 |
| Strain relief | mc<=25:2, else:3 | mc<=15:1, else:2 |
| SOLOBOX | mc<=10:1, mc<=20:2, else:3 | mc<=12:1, mc<=20:2, else:3 |
| RD screws | mc<=25:120, else:240 | mc<=18:120, else:240 |
| Snow dogs (removal) | standing_seam only | standing_seam AND tile |

The SO post-processor values represent current ops practice. The BOM post-processor values are intentionally more conservative (informational only).

## Version History

### BOM Post-Processor
- **v2** (2026-02-27): Initial rules — category normalization, brand inference, model standardization, informational qty corrections, suggested additions

### SO Post-Processor
- **v1** (2026-02-27): Initial session 1 rules
- **v2** (2026-02-27): Added standing seam SKU swaps, roof-type removals
- **v3** (2026-02-28): Added Gateway-3 removal, AC disconnect removal, THQL21100 removal on battery-only jobs
