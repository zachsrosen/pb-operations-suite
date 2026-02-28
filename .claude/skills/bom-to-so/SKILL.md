---
name: bom-to-so
description: Use when you have a BOM (extracted or saved) and need to create a Zoho Sales Order, compare against an ops SO, or understand the post-processing rules. Triggered by "create SO from BOM", "generate sales order", "compare auto vs ops SO", "what does the post-processor do".
version: 0.1.0
---

# BOM to Sales Order Pipeline

Converts a saved BOM snapshot into a draft Zoho Sales Order with automatic post-processing, then optionally compares it against the ops-created SO.

## Prerequisites

1. **BOM snapshot saved** — use the `planset-bom` skill to extract a BOM, then save it via `POST /api/bom/history`. You need a `dealId` and `version` number.
2. **Zoho customer ID resolved** — either auto-matched via `hubspot_contact_id` or manually selected.

## Pipeline Steps

### Step 1: Resolve Zoho Customer

Try automatic match first, fall back to name search:

```
# Auto-match via HubSpot contact ID (preferred)
GET /api/bom/zoho-customers?hubspot_contact_id={contactId}

# Fallback: name search (first 2 words of deal name)
GET /api/bom/zoho-customers?search={customerName}
```

The auto-match uses the `hubspot_contact_id` custom field on Zoho customers. It normalizes IDs (handles number/bigint/string formats) and picks the lowest `contact_id` on multiple matches (deterministic).

### Step 2: Create Sales Order

```
POST /api/bom/create-so
Body: { "dealId": "...", "version": 1, "customerId": "..." }
```

This endpoint:
1. Loads the BOM snapshot for the given deal + version
2. Checks idempotency — if `snapshot.zohoSoId` already exists, returns the existing SO
3. Matches each BOM item to a Zoho Inventory item via `findItemIdByName`
4. Runs the **SO Post-Processor** (if `ENABLE_SO_POST_PROCESS=true`) — see [post-processor-rules.md](references/post-processor-rules.md)
5. Creates a draft SO in Zoho Inventory
6. Stores `zohoSoId` and `zohoSoNumber` on the snapshot record

### Step 3: Verify Results

Check the response for:
- `salesorder_number` — the Zoho SO number (e.g., `SO-00123`)
- `unmatchedItems[]` — BOM items that couldn't be matched to Zoho inventory
- `corrections[]` — post-processor changes (SKU swaps, qty adjustments, additions, removals)
- `jobContext` — detected job parameters (jobType, roofType, moduleCount, etc.)

If `unmatchedItems` is non-empty, investigate: these items were skipped and won't appear on the SO.

### Step 4: Fetch Ops SO (for comparison)

```
# Single SO
GET /api/bom/zoho-so?so_number=SO-XXXX

# Batch (up to 50)
GET /api/bom/zoho-so?so_numbers=SO-1234,SO-1235
```

Handles both `SO-XXXX` and `SO_XXXX` formats (Zoho inconsistency).

### Step 5: Compare Auto vs Ops SO

See [Comparison Methodology](#comparison-methodology) below.

## Post-Processing Pipeline

Two separate post-processors run at different stages:

```
Planset PDF
  |
  v
[BOM Extraction] (Anthropic API)
  |
  v
[BOM Post-Processor] ── runs at snapshot SAVE (/api/bom/history)
  |  - Category normalization (PV_MODULE -> MODULE)
  |  - Brand inference (1707000 -> Tesla)
  |  - Model standardization (Powerwall 3 -> 1707000-XX-Y)
  |  - Qty corrections (INFORMATIONAL only, does NOT mutate)
  |  - Suggested additions (SEPARATE array, synced to EquipmentSku)
  |
  v
[Saved BOM Snapshot] (bomData.items[] + bomData.suggestedAdditions[])
  |
  v
[SO Post-Processor] ── runs at SO CREATE (/api/bom/create-so)
  |  - SKU swaps by roof type (standing seam clamp changes)
  |  - Remove wrong items (battery-only removals, roof-specific)
  |  - Qty adjustments (MUTATES quantities)
  |  - Add missing OPS_STANDARD items (via Zoho item lookup)
  |
  v
[Draft Zoho Sales Order]
```

Key differences:
- **BOM Post-Processor**: Pure/sync, no Zoho calls, informational qty corrections, suggested additions as separate array
- **SO Post-Processor**: Async, calls Zoho `findItemIdByName`, MUTATES quantities and line items directly

Full rule documentation: [references/post-processor-rules.md](references/post-processor-rules.md)

## Interpreting Results

### `jobContext`

Detected automatically from BOM items and project metadata:

| Field | Values | How Detected |
|-------|--------|--------------|
| `jobType` | `solar`, `battery_only`, `hybrid` | Presence of MODULE and/or BATTERY category items |
| `roofType` | `asphalt_shingle`, `standing_seam_metal`, `tile`, `trapezoidal_metal`, `unknown` | Project roofType field + item descriptions (S-5, tile hook, XR100) |
| `isStandingSeamS5` | boolean | Standing seam + S-5/L-Foot/Protea in descriptions |
| `hasPowerwall` | boolean | Model matches `1707000` |
| `hasExpansion` | boolean | Model matches `1807000` |
| `hasBackupSwitch` | boolean | Model matches `1624171` or "backup switch" |
| `hasGateway3` | boolean | Model matches `1841000` |
| `moduleCount` | number | From `project.moduleCount` or sum of MODULE item quantities |
| `serviceTapType` | `fused_disconnect`, `breaker_enclosure`, `null` | DG222NRB = fused, TG3222R/TGN3322R = breaker enclosure |

### `corrections[]`

Each correction has an `action` type:

| Action | Meaning | Stage |
|--------|---------|-------|
| `category_fix` | Category alias normalized | BOM post-processor |
| `brand_fill` | Brand inferred from model pattern | BOM post-processor |
| `model_standardize` | Product name replaced with part number | BOM post-processor |
| `qty_adjust` | Quantity changed (informational at BOM, mutating at SO) | Both |
| `addition_suggested` | Missing OPS_STANDARD item suggested | BOM post-processor |
| `sku_swap` | SKU replaced for roof type compatibility | SO post-processor |
| `item_removed` | Item removed (wrong for job type/roof) | SO post-processor |
| `item_added` | OPS_STANDARD item added to SO | SO post-processor |

### `unmatchedItems[]`

Items that couldn't be matched to Zoho Inventory. Common causes:
- SKU doesn't exist in Zoho (typo or new product)
- Item name doesn't match any Zoho item (fuzzy match failed)
- Category not in the inventory sync list

## Comparison Methodology

When comparing auto-generated SO vs ops-created SO:

### 1. Normalize Both Sides

```
Auto SO items  ──normalize SKU/name──>  Comparable format
Ops SO items   ──normalize SKU/name──>  Comparable format
```

Use `normalizedName()`: lowercase, strip non-alphanumeric, collapse whitespace.

### 2. Ignore Admin/Non-Material Items

Ops SOs may include items not in BOMs:
- Labor line items
- Permit fees
- Administrative charges
- Shipping/handling

Filter these out before comparing.

### 3. Match Items

Match by SKU first (exact), then by normalized name (fuzzy). Build three lists:
- **Matched**: same item in both, compare quantities
- **Auto-only**: items in auto SO but not ops SO
- **Ops-only**: items in ops SO but not auto SO

### 4. Classify Mismatches

| Type | Meaning | Action |
|------|---------|--------|
| Qty delta | Same item, different quantity | Check post-processor rules — may be correct |
| Auto-only | Post-processor added item ops didn't | Verify if OPS_STANDARD rule is correct |
| Ops-only | Ops included item auto didn't | Check if it should be a post-processor rule |
| SKU mismatch | Different SKU for same function | Check if post-processor SKU swap rule applies |

### 5. Warehouse Context

Racking inclusion varies by warehouse (confirmed across 50+ SOs):
- **Westminster + Centennial**: ALWAYS include racking in solar SOs
- **SLO + CAM**: NEVER include racking
- **Colorado Springs**: MIXED

Don't flag racking differences without checking the warehouse.

## Common Issues

### "Customer not found"
- Check `hubspot_contact_id` exists on Zoho customer record
- Fallback: use `?search=` with first 2 words of deal name
- Cache refreshes every 60 minutes — recent Zoho changes may not be visible

### "Unmatched items" on SO
- Item name in BOM doesn't match any Zoho Inventory item
- Check spelling, model number format
- Some items are informational (not orderable SKUs)

### "SO already exists"
- Idempotency guard: snapshot already has `zohoSoId`
- This is expected on retry — returns the existing SO

### Wrong quantities
- Check `jobContext.moduleCount` — if wrong, all qty formulas will be off
- Compare BOM post-processor (informational) vs SO post-processor (mutating) thresholds — they differ slightly for some items

### Missing items on SO
- Check `ENABLE_SO_POST_PROCESS` env flag
- Verify `addIfMissing` checks — item may already exist under a different name/SKU
- Check `existingKeys` dedup set — normalized name collision can prevent additions
