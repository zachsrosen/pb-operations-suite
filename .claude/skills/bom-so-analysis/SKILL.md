---
name: bom-so-analysis
description: Batch analysis of auto-generated vs ops-created Sales Orders. Use when asked to "run the SO analysis", "compare auto vs ops SOs", "analyze post-processor rules", "batch compare SOs", "find SO patterns", or "improve post-processor". Orchestrates pipeline runs, fetches SOs from Zoho, classifies jobs, compares equipment line items, and proposes post-processor rule improvements.
version: 0.1.0
---

# BOM→SO Batch Analysis

Batch-compare auto-generated Sales Orders against ops-created SOs to validate and improve the post-processor rules.

## Prerequisites

- Dev server running (for API access)
- `ENABLE_SO_POST_PROCESS=true` in env
- Fetch BOM tool feedback first: `GET /api/bom/feedback` via preview_eval

## Required Skills

- **`bom-pipeline-core`** — Shared pipeline (deal → planset → BOM → customer → SO).
  Invoke for each job in the batch. On escalation, log the failure and skip to next job.
- **`bom-to-so`** — Reference for post-processor rules and comparison methodology
- **`product-lookup`** — Manufacturer reference data for validating quantities,
  SKU variants, and installation rules. Invoke during pattern analysis (Step 4)

## Workflow

```
1. Select jobs (PROJ numbers, warehouse filter, or "all with ops SOs")
2. For each job:
   a. Run bom-pipeline-core steps 1-6 (ALWAYS fresh — never reuse old snapshots)
      On any escalation: log failure reason, skip to next job
   b. Fetch auto SO from Zoho
   c. Fetch ops SO from Zoho
   d. Compare equipment line items
   e. Save artifacts to disk
3. Classify all jobs by type, warehouse, equipment
4. Run pattern analysis (item frequency, qty formulas)
5. Propose post-processor rule improvements
6. Write findings to disk
```

**IMPORTANT — Fresh extraction is mandatory.** Both the BOM extraction logic and
the post-processor rules are actively being iterated. Reusing old snapshots means
you're testing stale logic. Every job in the batch MUST go through the full
pipeline so comparisons reflect the current state of both layers.

## Step 1: Select Jobs

**Option A — By PROJ numbers:**
```
User provides: PROJ-8596, PROJ-8721, PROJ-8722
```

**Option B — By warehouse (fetch from Zoho):**
```js
(async () => {
  const res = await fetch('/api/bom/zoho-so?page=1&per_page=200');
  const data = await res.json();
  // Filter by delivery_method (warehouse)
  const westminster = data.salesorders.filter(
    so => so.delivery_method?.includes('Westminster')
  );
  return JSON.stringify(westminster.map(so => so.salesorder_number), null, 2);
})()
```

Page through all SOs to build the full list. ~694 PROJ-referenced SOs across:

| Warehouse | Total SOs | Racking Pattern |
|-----------|:---------:|-----------------|
| Photon Brothers Westminster | 205 | Always includes racking |
| Photon Brothers Centennial | 193 | Always includes racking |
| Photon Brother SLO | 114 | Never includes racking |
| Photon Brothers Colorado Springs | 52 | Mixed |
| Photon Brother CAM | 35 | Never includes racking |
| (not set) | 84 | Unknown |

**Target sample sizes per session:**
- Westminster: 30 solar SOs
- Centennial: 30 solar SOs
- SLO: 15 solar + 10 battery SOs
- CAM: 10 solar SOs
- CO Springs: 15 solar SOs
- Battery-only (any warehouse): 15 SOs
- Total: ~125 SOs

## Step 2: Per-Job Pipeline

### 2a. Run bom-pipeline-core (steps 1-6)

Invoke `bom-pipeline-core` for the job. This handles: deal lookup → planset auto-selection → BOM extraction → snapshot save → customer match → SO creation.

**Batch behavior:** On any escalation (no PDFs, validation failure, no customer match, SO error), log the failure reason and skip to the next job. Do not pause for user input.

**Key response fields from SO creation:**
- `salesorder_number` — the auto SO number
- `unmatchedItems[]` — BOM items that couldn't match to Zoho inventory
- `corrections[]` — post-processor changes (sku_swap, item_removed, qty_adjust, item_added)
- `jobContext` — detected: jobType, roofType, hasPowerwall, hasExpansion, moduleCount, etc.

### 2b. Fetch Auto SO from Zoho (using SO number from pipeline)

```js
(async () => {
  const res = await fetch('/api/bom/zoho-so?so_number=SO-XXXXX');
  const data = await res.json();
  return JSON.stringify(data, null, 2);
})()
```

### 2d. Fetch Ops SO from Zoho

Same endpoint, different SO number. The ops SO number usually matches the PROJ number:
```js
(async () => {
  const res = await fetch('/api/bom/zoho-so?so_number=SO-8596');
  const data = await res.json();
  return JSON.stringify(data, null, 2);
})()
```

**Batch mode (up to 50):**
```
GET /api/bom/zoho-so?so_numbers=SO-8596,SO-8721,SO-8722
```

**Important:** Zoho uses both `SO-XXXX` and `SO_XXXX` formats. Always pass `SO-XXXX` — the API normalizes both.

### 2e. Compare Equipment Line Items

Use the `bom-to-so` skill's comparison methodology:

1. **Normalize** both sides (lowercase, strip non-alphanumeric, collapse whitespace)
2. **Exclude** admin items (permit fees, interconnection, design/engineering, inventory-no PO)
3. **Match** by SKU first (exact), then by normalized name (fuzzy)
4. **Classify** each item: `match`, `qty_delta`, `auto_only`, `ops_only`, `sku_mismatch`

### 2f. Save Artifacts

For each job, create `/Users/zach/Downloads/SOs/PROJ-XXXX-Customer/`:

**`ops-so-data.md`:**
```markdown
# PROJ-XXXX Customer — Ops SO Data (from Zoho API)

## Job Summary
- **SO Number:** SO-XXXX
- **Customer:** Name
- **Reference:** PROJ-XXXX | Last, First
- **Warehouse:** (from delivery_method)
- **Total:** $X,XXX.XX
- **Equipment Items:** N
- **Job Type:** solar_battery / battery_only / etc.

## Equipment Items

| # | Item | SKU | Qty | Rate |
|---|------|-----|-----|------|
| 1 | ... | ... | ... | ... |

## Key Observations
- bullet points about patterns
```

**`comparison-notes.md`:**
```markdown
# PROJ-XXXX Customer — BOM → SO Comparison

## Job Context
- **Job Type:** solar_battery
- **Roof Type:** asphalt_shingle
- **Modules:** 27x SEG Solar 440W
- **Battery:** 1x Powerwall 3
- **Post-Processor Version:** v3

## Comparison Table (equipment items only)

| Item | Auto SKU | Ops SKU | Auto Qty | Ops Qty | Status |
|------|----------|---------|----------|---------|--------|
| Powerwall 3 | 1707000-21-K | 1707000-21-K | 1 | 1 | ✅ Match |
| Gateway-3 | 1841000-x1-y | — | 1 | — | ❌ Extra |

## Findings
### Matches: N items
### Missing from Auto: N items (ops has, auto doesn't)
### Extra in Auto: N items (auto has, ops doesn't)
### Qty Differences: N items
```

## Step 3: Classify All Jobs

For each job in the batch, build a classification record:

```json
{
  "so_number": "SO-8596",
  "proj_number": "PROJ-8596",
  "customer": "Eckert",
  "warehouse": "Photon Brother SLO",
  "date": "2026-01-15",
  "total": 12345.67,
  "equipment_count": 18,
  "job_type": "battery_expansion",
  "has_modules": false,
  "module_brand": null,
  "module_model": null,
  "module_count": 0,
  "has_pw3": true,
  "pw3_count": 1,
  "has_expansion": true,
  "has_backup_switch": false,
  "has_racking": false,
  "racking_type": "none",
  "inverter_type": "tesla_pw3",
  "equipment": [{ "name": "...", "sku": "...", "qty": 1 }]
}
```

**Classification logic:**
- `has_modules`: SKU contains `HYU`, `SEG`, `Silfab`, `Q.PEAK`, `Lightspeed`, or name contains `440W`, `430W`, `485W`
- `has_pw3`: SKU = `1707000-21-K`
- `has_expansion`: SKU = `1807000-20-B`
- `has_backup_switch`: SKU = `1624171-00-x`
- `has_racking`: Any SKU matching `XR-10-*`, `XR-100-*`, `UFO-CL-*`, `UFO-END-*`, `2101151` (HUG)
- `racking_type`: XR-10 → "XR10", XR-100 → "XR100"
- `job_type`: Derived from `has_modules` + `has_pw3` + `has_expansion` + `has_backup_switch`

**Job type derivation:**

| has_modules | has_pw3 | has_expansion | Result |
|:-----------:|:-------:|:-------------:|--------|
| true | false | false | `solar_only` |
| true | true | false | `solar_battery` |
| true | true | true | `solar_battery_expansion` |
| false | true | false | `battery_only` |
| false | true | true | `battery_expansion` |
| false | true | false + has_backup | `battery_backup` |

## Step 4: Pattern Analysis

**Invoke `product-lookup` skill** before analyzing quantities — use manufacturer
reference data to compare ops quantities against published installation rules
(e.g., Alpine snow dog qty per array, IronRidge HUG spacing per rail, UFO mid
clamp count per row). Flag deviations between ops practice and manufacturer
guidelines as open questions.

For each warehouse x job_type combination:

### 4a. Item Frequency
Which SKUs appear in what % of SOs? Build a frequency table:
```
| SKU | Item Name | Westminster | Centennial | SLO | CO Springs | CAM |
|-----|-----------|:-----------:|:----------:|:---:|:----------:|:---:|
| 1707000-21-K | Powerwall 3 | 45% | 52% | 60% | 48% | 55% |
```

### 4b. Quantity Formulas
Correlate variable-qty items with module count. Target items:

| Item | SKU Pattern | Expected Relationship |
|------|------------|----------------------|
| HUG attachment | `2101151` | ~2.5x modules + offset? |
| RD structural screws | `HW-RD*` | ~modules? |
| Mid clamps | `UFO-CL-*` | ~2x modules |
| End clamps | `UFO-END-*` | ~modules? |
| T-bolt | `BHW-TB-*` | ~modules? |
| Ground lug | `XR-LUG-*` | ~modules? |
| MCI-2 connectors | MCI | ~modules |
| Critter guard | critter | rolls vs modules? |
| SunScreener clips | sunscreener | ~modules? |
| Snow dogs | snow | ~modules? |
| SOLOBOX | solobox | ~modules? |
| Strain relief | strain | ~modules? |
| XR10/XR100 rails | `XR-10-*`/`XR-100-*` | length x count vs modules |

For each, plot qty vs module_count and derive formula (e.g., `HUG qty = ceil(moduleCount * 2.5) + 4`).

### 4c. Breaker Patterns
Which 60A breaker brand (HOM260, Q260, BR260) correlates with which panel type or region?

### 4d. Missing Items
Items in >80% of ops SOs but NOT in current post-processor rules — these are candidates for Rule 4 additions.

### 4e. Service Upgrade Items
Meter housings, disconnects, wire — when do these appear? What triggers inclusion?

### 4f. Enphase vs Tesla
Different equipment suites — document the differences.

## Step 5: Propose Post-Processor Rules

For each proposed rule, document:

```markdown
### Proposed Rule: [Name]

- **Category:** SKU swap / removal / qty adjustment / add missing
- **Trigger:** [job type] + [warehouse] + [roof type]
- **Action:** [what to change]
- **Evidence:** [which SOs support this, sample size]
- **Confidence:** High / Medium / Low
- **Current v3 behavior:** [what happens now]
```

## Step 6: Write Findings

Save outputs to `/Users/zach/Downloads/SOs/`:

| File | Contents |
|------|----------|
| `session-N-dataset.json` | Full classified dataset (all jobs) |
| `session-N-analysis.md` | Findings: frequency tables, qty formulas, anomalies, proposed rules |
| `PROJ-XXXX-Customer/ops-so-data.md` | Per-job ops SO data |
| `PROJ-XXXX-Customer/comparison-notes.md` | Per-job auto vs ops comparison |

Increment `N` from previous sessions. Check existing files to determine the next session number.

## Two Post-Processors in the Pipeline

There are **two distinct post-processors** — one runs before the BOM tool, one during SO creation:

### BOM Post-Processor (`src/lib/bom-post-process.ts`) — Pre-BOM Tool

Runs server-side in `/api/bom/history` when `ENABLE_BOM_POST_PROCESS=true`. Cleans up raw
extraction output before the BOM tool displays it. Version: `2026-02-27-v2`.

1. **Rule 1 — Category Standardization:** Aliases (`PV_MODULE→MODULE`, `STORAGE→BATTERY`, `MOUNT→RACKING`)
2. **Rule 2 — Brand Inference:** Fills missing brands from model patterns (`1707000*` → Tesla, `XR-10` → IronRidge, etc.)
3. **Rule 3 — Model Standardization:** Vague descriptions → canonical part numbers ("Powerwall 3" → `1707000-XX-Y`)
4. **Rule 4 — Qty Corrections (informational):** Suggests correct quantities but does NOT mutate `item.qty` — logs only
5. **Rule 5 — Suggested Additions:** Returns separate `suggestedAdditions[]` for missing ops-standard items — does NOT modify `items[]`

**Design:** Rules 1-3 mutate in-place (cosmetic). Rules 4-5 are non-destructive suggestions only.

### SO Post-Processor (`src/lib/bom-so-post-process.ts`) — During SO Creation

Runs inside `createSalesOrder()` when `ENABLE_SO_POST_PROCESS=true`. Modifies line items
for the Zoho SO only — never touches the BOM snapshot. Version: `2026-02-28-v3`.

1. **Rule 1 — SKU Swaps**: Racking SKUs by roof type (shingle→XR10, metal→S-5!, tile→hooks)
2. **Rule 2 — Remove Wrong Items**: Standing seam removes Snow Dogs/HUG/RD screws; battery-only removes Gateway-3, AC Disconnect, THQL21100, TL270RCU, THQL2160, Snow Dogs, Critter Guard, SunScreener, Strain Relief, SOLOBOX
3. **Rule 3 — Qty Adjustments**: MCI-2 connectors by module count; snow dogs, critter guard, SunScreener, strain relief, SOLOBOX, RD screws — module-count-aware scaling
4. **Rule 4 — Add Missing OPS_STANDARD**: TL270RCU+THQL2160 for PW3 solar; Wall Mount/Stacking Kit for Expansion; tile hooks + T-bolt + J-box for tile; L-Foot mounts for standing seam S-5!

## Existing Analysis to Read First

- `/Users/zach/Downloads/SOs/session-2-summary.md` — 16-job manual comparison results
- `/Users/zach/Downloads/SOs/warehouse-racking-analysis.md` — racking pattern (n=50)
- Previous `session-N-analysis.md` files for continuity
- BOM tool feedback: `GET /api/bom/feedback`

## Execution Notes

- Use `preview_eval` with async IIFEs for all API calls
- Batch-fetch ops SOs 20 at a time using `so_numbers` param
- Write findings to disk as you go (don't wait until the end)
- Work autonomously — don't ask questions, just analyze and document
- If a job fails at any step (no planset, customer not found, etc.), log it and move on
- **NEVER reuse old BOM snapshots** — always run fresh `find-design-plans` → `planset-bom`
  extraction for every job. Both the extraction logic and post-processor are under
  active iteration; stale snapshots invalidate the entire comparison
- When invoking `find-design-plans`, fetch `design_documents` AND
  `all_document_parent_folder_id` from HubSpot in the same search call to avoid
  extra API round-trips
