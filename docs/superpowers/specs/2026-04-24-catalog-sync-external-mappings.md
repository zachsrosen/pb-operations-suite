# Catalog Sync — External System Mapping Decisions

**Companion to:** `docs/superpowers/plans/2026-04-24-catalog-sync-quality-hardening.md`

This document captures the actual cross-reference data pulled from production
systems plus the proposed Zuper custom field schema. Created 2026-04-24 from
the live Zoho Inventory org and existing Zuper Product object inspection.

---

## 1. Zoho Inventory — what's actually there

**Pulled from prod via `scripts/_pull-zoho-item-groups.ts` on 2026-04-24.**
Full data: `scripts/zoho-item-groups.json` (1717 items, 22 categories).

### Key finding: `group_name` is the wrong field

Our `src/lib/zoho-taxonomy.ts` maps internal categories to Zoho `group_name`,
and `createOrUpdateZohoItem` writes that value on item create. But:

- Of 1717 items in our prod Zoho org, **only 2 items have a `group_name` set** ("Service" × 1, "H2" × 1).
- Even our `confirmed` mappings (`MODULE → "Module"`, `INVERTER → "Inverter"`) don't show up as actual `group_name` values in the existing data — meaning the field has either been silently dropped on Zoho's side, or it's the wrong API field for what the Zoho UI shows.
- The field that's *actually* populated and visible in Zoho UI is **`category_name`** — 21 distinct values used across 1351 items (366 items remain "(unset)" — pre-categorization legacy).

### Zoho's real category list (from production)

| Zoho category_name | Item count | What it groups |
|---|---:|---|
| Electrical Component | 235 | Generic electrical hardware |
| Breaker | 205 | Circuit breakers |
| Solar Component | 138 | Modules, racking, balance-of-system |
| Wire | 80 | Conductors |
| Non-inventory | 71 | Services, milestones |
| PVC | 67 | Conduit / fittings |
| Tesla | 65 | Tesla-branded equipment |
| Load Center | 57 | Main / sub panels |
| Coupling | 55 | Conduit fittings |
| Module | 52 | Solar modules ✓ matches today's MODULE→Module |
| Nipple | 44 | Conduit fittings |
| Other | 42 | Misc |
| Strap | 40 | Mounting straps |
| Bushing | 38 | Conduit fittings |
| Fastener | 37 | Screws/bolts |
| Fuse | 31 | Inline fuses |
| Locknut | 26 | Conduit fittings |
| Screw | 21 | Fasteners |
| Inverter | 18 | Inverters ✓ matches today's INVERTER→Inverter |
| Clamp - Electrical | 15 | Electrical clamps |
| Clamp - Solar | 14 | Module clamps |
| (unset) | 366 | Legacy uncategorized |

### Proposed mapping (16 internal → Zoho category)

Pulled live category IDs from Zoho on 2026-04-24. Use `category_id` for writes (resilient to renames in Zoho admin).

| Internal EquipmentCategory | → Proposed Zoho `category_name` | `category_id` | Confidence | Rationale |
|---|---|---|---|---|
| MODULE | Module | `5385454000001229316` | **HIGH** | Direct match, 52 existing items |
| INVERTER | Inverter | `5385454000001229328` | **HIGH** | Direct match, 18 existing items |
| BATTERY | Battery *(NEW — to be created in Zoho admin)* | *(TBD after creation)* | **HIGH** | Zach decision 2026-04-24: create new Zoho category. Powerwalls already in "Tesla" stay where they are (no retroactive migration). Enphase IQ-Battery rows currently uncategorized — backfill into new category as part of rollout |
| BATTERY_EXPANSION | Battery *(same as BATTERY)* | *(TBD)* | **HIGH** | Same as parent — uses the new Battery category |
| EV_CHARGER | EV Charger *(NEW — to be created in Zoho admin)* | *(TBD after creation)* | **HIGH** | Zach decision 2026-04-24: create new Zoho category. Existing Tesla Universal chargers in "Tesla" can stay or migrate (Zach call) |
| RACKING | Solar Component | `5385454000001289023` | **MEDIUM** | IronRidge/Unirac items live here today |
| ELECTRICAL_BOS | Electrical Component | `5385454000001229324` | **HIGH** | Direct conceptual match, 235 items |
| MONITORING | Solar Component | `5385454000001289023` | **MEDIUM** | Inverter monitoring devices, gateways |
| RAPID_SHUTDOWN | Solar Component | `5385454000001289023` | **MEDIUM** | Could also be Electrical Component |
| OPTIMIZER | Solar Component | `5385454000001289023` | **MEDIUM** | Tigo / SolarEdge optimizers |
| GATEWAY | Solar Component | `5385454000001289023` | **MEDIUM** | Sense, Neurio, etc. |
| D_AND_R | (no Zoho category — leave unset) | — | **LOW** | D&R items aren't tracked discretely in Zoho today |
| SERVICE | Non-inventory | `5385454000008795730` | **HIGH** | Direct conceptual match, 71 items |
| ADDER_SERVICES | Non-inventory | `5385454000008795730` | **HIGH** | Same as SERVICE |
| TESLA_SYSTEM_COMPONENTS | Tesla | `5385454000001229320` | **HIGH** | Direct match |
| PROJECT_MILESTONES | Non-inventory | `5385454000008795730` | **HIGH** | Same as SERVICE |

### Action items before Task 3.1 code change ships

1. **Zach: create two new Zoho categories** in Zoho admin → Items → Categories: `Battery` and `EV Charger`. Do not need to backfill existing items into them — only future writes need to land there. Existing Tesla Powerwalls / Tesla Universal Chargers stay in "Tesla" unless Zach decides to migrate.
2. **Re-run `scripts/_pull-zoho-item-groups.ts`** after creation to capture the new `category_id` values. Drop them into the mapping table above (and into `zoho-taxonomy.ts` when implementing).

### Existing categories not in this mapping

(Available but no internal category fits cleanly): Breaker (`5385454000005351734`), Wire (`5385454000005314281`), PVC (`5385454000009979994`), Coupling (`5385454000009989976`), Nipple (`5385454000009988948`), Bushing (`5385454000009990724`), Fastener (`5385454000001289019`), Fuse (`5385454000009989248`), Locknut (`5385454000014165596`), Screw (`5385454000009990306`), Strap (`5385454000009990948`), Load Center (`5385454000009988586`), Clamp - Electrical (`5385454000009990520`), Clamp - Solar (`5385454000009990428`), Other (`5385454000001289027`). These represent finer-grained items (mostly under our ELECTRICAL_BOS umbrella) that Zoho ops can sub-categorize manually after ingestion.

**Decision needed from Zach:** confirm or correct the MEDIUM-confidence entries.
Especially: do non-Tesla batteries (Enphase, etc.) go to "Tesla" or "Solar Component"?
Do non-Tesla EV chargers go to a separate Zoho category we should create?

### Required code change (replaces Milestone 3 Task 3.1 in the main plan)

This is a bigger change than originally planned. The path forward:

1. **`src/lib/zoho-taxonomy.ts`** — rename `groupName` field to `categoryName`; add a parallel `categoryId` if we want to pin to Zoho's stable IDs (recommended — names can change in admin).
2. **`src/lib/zoho-inventory.ts:892-907`** — switch the create payload from `group_name: groupName` to `category_id: categoryId` (or `category_name` if we don't have IDs). The current `group_name` write becomes a no-op.
3. **`createOrUpdateZohoItem` update path (line 850-890)** — same swap on the update branch.
4. **Backfill script** (optional, separate task): walk existing InternalProducts and update their corresponding Zoho items to use the right category_id. Out of scope for this plan unless Zach explicitly asks.
5. **`src/lib/catalog-fields.ts`** — no change.

The original plan's `getZohoGroupName` becomes `getZohoCategory(category): { categoryId?, categoryName? }`. All `confirmed | likely | unresolved` semantics carry over.

### Pending: pull category IDs

The `/categories` endpoint returned 22 records but with the schema `{ name, category_id, parent_category_id, depth, ... }` — not `category_name`. The script needs a small fix to surface `name`+`category_id` pairs. Once fixed, drop those IDs into `zoho-taxonomy.ts` so we write by ID (resilient to renames in Zoho admin).

---

## 2. Zuper Product custom fields — proposed schema

**Status:** plumbing in place after Milestone 3 Task 3.3 of the main plan. This
section defines the actual fields to create in Zuper admin.

### Storage shape (verified 2026-04-24 via `scripts/_pull-zuper-product-schema.ts`)

Zuper stores Product custom fields in the `meta_data` array (NOT a `custom_fields`
key). Each entry looks like:

```json
{
  "label": "HubSpot Product ID",
  "value": "2708424207",
  "type": "SINGLE_LINE",
  "hide_field": false,
  "hide_to_fe": false,
  "module_name": "PRODUCT",
  "_id": "692a8d40e3340df09dff2a01"
}
```

**Implications:**
- The user-facing key is the `label` (human-readable). Snake_case API keys are secondary.
- The existing cross-link code (`buildZuperProductCustomFields` in `zuper-catalog.ts:206`) already writes to this storage — "HubSpot Product ID", "Internal Product ID", "Zoho Item ID" are present today on existing Zuper products. So our new Zuper writes have proven precedent.
- The Sync Modal's `parseZuperCurrentFields` (`catalog-sync.ts:241-256`) does NOT read `meta_data` today. To surface spec fields in the modal's diff view, that function needs extending to walk `meta_data` and pull entries by label match. (Out of scope for the basic write path; surfaces as an item in M3 T3.4 work.)

### Design principles

- **One Zuper custom field per high-value spec field.** Don't replicate every
  internal spec — pick the ones that help techs in the field or that ops uses
  for warranty/inventory lookups.
- **Label naming**: human-readable, matches what techs would search for. Do NOT use snake_case in the label — that's tech debt the techs would be exposed to. Snake_case lives only in the code mapping.
- **Data types**: Zuper supports `SINGLE_LINE`, `NUMBER`, `DROPDOWN`, `MULTI_LINE`, `BOOLEAN`, `DATE` (verify the exact set in Zuper admin when defining).
- **Optional everywhere**: products created before custom field rollout shouldn't break. New products populate; old products stay null.

### Proposed fields (15 total)

The "Internal key" column is the `FieldDef.key` in `catalog-fields.ts` we'd thread to the new `zuperCustomField` value. The "Zuper label" column is what gets created in Zuper admin and what techs see. The `pb_*` snake_case "API key" is internal-only — it's what we'd write into `zuperCustomField` so the mapping registry knows where to send the value, but the label is the source of truth in Zuper's storage.

#### Universal (cross-category) — 0 fields
The universal sync (name, brand, model, sku, description, vendor, dimensions, etc.)
already covers identity. The cross-link IDs ("HubSpot Product ID", "Zoho Item ID", "Internal Product ID") are already populated by `buildZuperProductCustomFields`.

#### MODULE — 5 fields

| Internal `FieldDef.key` | API key (`zuperCustomField`) | Zuper Label (what techs see) | Type | Notes |
|---|---|---|---|---|
| `wattage` | `pb_module_wattage` | Module Wattage (W) | NUMBER | Already in `specification` string today; promote to discrete field for filtering |
| `efficiency` | `pb_module_efficiency_pct` | Module Efficiency (%) | NUMBER | 0-100 range |
| `cellType` | `pb_module_cell_type` | Module Cell Type | DROPDOWN | Mono PERC / TOPCon / HJT / Poly / Thin Film |
| `voc` | `pb_module_voc_v` | Module Voc (V) | NUMBER | For string sizing reference |
| `isc` | `pb_module_isc_a` | Module Isc (A) | NUMBER | For OCPD sizing reference |

#### INVERTER — 4 fields

| Internal `FieldDef.key` | API key | Zuper Label | Type | Notes |
|---|---|---|---|---|
| `acOutputKw` | `pb_inverter_ac_output_kw` | Inverter AC Output (kW) | NUMBER | Already in `specification` |
| `phase` | `pb_inverter_phase` | Inverter Phase | DROPDOWN | Single / Three-phase |
| `inverterType` | `pb_inverter_type` | Inverter Type | DROPDOWN | String / Micro / Hybrid / Central |
| `mpptChannels` | `pb_inverter_mppt_channels` | Inverter MPPT Channels | NUMBER | Tech reference for string design |

#### BATTERY / BATTERY_EXPANSION — 3 fields

| Internal `FieldDef.key` | API key | Zuper Label | Type | Notes |
|---|---|---|---|---|
| `capacityKwh` | `pb_battery_capacity_kwh` | Battery Capacity (kWh) | NUMBER | Already in `specification` |
| `chemistry` | `pb_battery_chemistry` | Battery Chemistry | DROPDOWN | LFP / NMC |
| `continuousPowerKw` | `pb_battery_continuous_kw` | Battery Continuous Power (kW) | NUMBER | Sizing for backup loads |

#### EV_CHARGER — 2 fields

| Internal `FieldDef.key` | API key | Zuper Label | Type | Notes |
|---|---|---|---|---|
| `connectorType` | `pb_evcharger_connector` | EV Charger Connector | DROPDOWN | J1772 / NACS / CCS |
| `level` | `pb_evcharger_level` | EV Charger Level | DROPDOWN | Level 1 / Level 2 / DC Fast |

#### RACKING — 1 field

| Internal `FieldDef.key` | API key | Zuper Label | Type | Notes |
|---|---|---|---|---|
| `roofAttachment` | `pb_racking_roof_type` | Racking Roof Attachment | DROPDOWN | Comp Shingle / Tile / Metal / S-Tile — load-bearing for crew prep |

#### Skipped (low value for techs / no clear use case)

- `tempCoefficient`, `vmp`, `imp` (MODULE) — engineering reference, not field-relevant
- `nominalAcVoltage`, `maxInputVoltage`, `maxDcInput` (INVERTER) — design tool data
- `usableCapacityKwh`, `peakPowerKw`, `roundTripEfficiency`, `nominalVoltage` (BATTERY) — spec sheet data
- `amperage`, `voltage`, `smartFeatures` (EV_CHARGER) — derivable from level + connector
- `mountType`, `material`, `tiltRange`, `windRating`, `snowLoad` (RACKING) — engineering data
- `componentType`, `gaugeSize`, `voltageRating`, `material` (ELECTRICAL_BOS) — too varied; rely on description
- `deviceType`, `connectivity`, `compatibleInverters` (MONITORING) — narrow audience

If Zach wants any of the skipped ones promoted, easy add — pattern is the same.

### Open questions for Zach

1. **Mobile app visibility.** Should these custom fields appear on the Zuper mobile
   form when techs view the Product on a job, or are they API-only for inventory
   audits? (Affects which Zuper screen they're added to in admin.)

2. **Backfill strategy.** Once the fields exist in Zuper and we deploy the wiring,
   do we run a one-time backfill script to populate the new custom fields on
   the ~few hundred existing Zuper Products? Or only populate for products synced
   going forward? (Default recommendation: backfill — ~30 minutes of script time.)

3. **Field-creation execution.** Zach defines them in Zuper admin manually, or
   we write a script that hits Zuper's "create custom field" API (if it exists)?
   Manual is safer for a one-time setup; script is reusable for future additions.

### Required code changes (replaces Milestone 3 Task 3.4 in the main plan)

After Zuper admin defines the fields:

1. **`src/lib/catalog-fields.ts`** — add `zuperCustomField: "pb_module_wattage"` etc. to each FieldDef listed above. The `buildCategoryExternalEdges()` plumbing from Task 3.3 picks them up automatically for the Sync Modal preview/diff.

2. **`src/lib/zuper-catalog.ts:754-839`** — `createOrUpdateZuperPart` needs a new `customFields?: Record<string, unknown>` input that gets nested into the Zuper create payload as `custom_fields: { pb_module_wattage: 400, ... }`. Currently the function doesn't accept arbitrary custom fields on create.

3. **`src/lib/catalog-push-approve.ts:411-423`** — pass spec data through to `createOrUpdateZuperPart` so custom fields flow on first create. Build the customFields dict from `metadata` filtered through `getCategoryFields(category)` looking for entries with `zuperCustomField` set.

4. **`src/lib/catalog-sync.ts` `executeZuperSync`** — when handling `update` operations from the Sync Modal, route `custom_fields` updates through Zuper's product update endpoint structure (the existing `ZUPER_FIELD_MAP` handles core fields; custom fields go nested under `custom_fields`).

---

## 3. HubSpot manufacturer enum — policy update

**Decision (D4 in main plan, updated 2026-04-24 from Zach):** brand SHOULD be in HubSpot. Silent strip is unacceptable.

### Reality check — pre-existing data hygiene problem

Pulled live HubSpot manufacturer enum + cross-referenced against InternalProduct brands via `scripts/_pull-hubspot-manufacturer-enum.ts`. **Findings:**

- HubSpot enum has 32 manufacturer values today
- Internal catalog has **45 distinct brand strings** in active use
- Of those 45, **only 8 match the HubSpot enum** (Tesla, Enphase, SolarEdge, REC, Hanwha, Silfab, Sense, Hyundai)
- **37 brands would be blocked under D4 enforcement.** Top offenders by usage: `Generic` (106 products), `IronRidge` (32), `Square D` (27), `Siemens` (23), `Pegasus` (13), `GE` (11), `Eaton` (9)
- The missing-brand list also exposes data quality issues: `Multiple` vs `MULTIPLE` duplicates, `Cutler-Hammer` vs `Cutler Hammer - Eaton`, `Unirac` vs `UNIRAC`, test data (`TestBrand_1776452275719`, `UIBrand_1776452298063`)

Full data: `scripts/hubspot-manufacturer-enum.json`.

### Implication for D4 rollout

If we ship the block-and-prompt code as a hard enforcement immediately, future product submissions for 37 brand strings will fail. That's the right behavior **eventually**, but turning it on cold without backfilling HubSpot first will block legitimate ops work tomorrow morning.

**Proposed phased rollout:**

- **Phase A (Milestone 2 Task 2.4 ships):** Land the typed `HubSpotManufacturerEnumError` and block behavior, but gate it behind a feature flag `HUBSPOT_MANUFACTURER_ENFORCEMENT=true`. Default OFF — current "drop manufacturer property and continue" behavior preserved when the flag is off. The new ActivityLog row still records the rejection so the missing-brand backfill list builds up.
- **Phase B (Zach data hygiene):** Zach reviews `scripts/hubspot-manufacturer-enum.json` and either (a) adds the legitimate brands to HubSpot enum manually via Settings → Properties → Products → Manufacturer, OR (b) we build a small `scripts/_backfill-hubspot-manufacturer-enum.ts` that hits HubSpot's `PATCH /crm/v3/properties/products/manufacturer` to add missing options programmatically (requires `crm.schemas.products.write` scope — verify before relying). Also clean up the duplicates/typos in InternalProduct.brand. **Concrete cleanup list from `scripts/brand-dedup-suggestions.json` (pulled 2026-04-24):**

  - **Dedup `UNIRAC` (4) + `Unirac` (1) → pick one** (suggest `Unirac` to match HubSpot enum convention; `IronRidge`/`SolarEdge` are similarly capitalized in the enum)
  - **Dedup `Multiple` (1) + `MULTIPLE` (1) → pick one** (or replace with the actual brand on those rows)
  - **Delete 3 obvious test products:**
    - `cmo39tkke000joj8od6j6e42z` (brand "TestBrand_1776452275719")
    - `cmo39ufkn000uoj8oh475ail7` (brand "UIBrand_1776452298063")
    - `cmo39vyq2001aoj8osv4z0pxo` (brand "UIBrand2_1776452374269")
  - **`Generic` (106 products) — Zach decision 2026-04-24: re-brand each row to its actual manufacturer.** Significant data-cleanup task (83 ELECTRICAL_BOS, 9 RACKING, 6 PROJECT_MILESTONES, 3 MONITORING, 3 BATTERY, 2 ADDER_SERVICES). Approach: dump all 106 rows with model + category, walk them in spreadsheet form, identify actual manufacturer per row from model number / packaging / vendor records. Spawn as its own follow-up task — does not block the rest of Phase B if rough categorization is acceptable for the initial enum backfill (i.e., DO add common manufacturers to HubSpot enum first, THEN do the Generic→real-brand walk and update each row, with each updated row's HubSpot push picking up the now-valid manufacturer). NOTE: 106 rows means 106 InternalProduct.brand updates AND 106 corresponding HubSpot Product manufacturer updates — a backfill script should handle both transactionally.
  - **Eaton variants — Zach decision 2026-04-24: keep separate.** `Eaton` (9), `Cutler-Hammer` (1), `Cutler Hammer - Eaton` (1) stay as 3 distinct values. Cutler-Hammer was a real brand on legacy gear before Eaton acquired it; preserving the historical name has lookup/searchability value. **Action:** add all 3 (`Eaton`, `Cutler-Hammer`, `Cutler Hammer - Eaton`) to HubSpot manufacturer enum. (Optional follow-up: agree on "Cutler Hammer - Eaton" vs "Cutler-Hammer" canonicalization later.)
  - **Brands missing from HubSpot enum that are likely legitimate:** IronRidge (32), Square D (27), Siemens (23), Pegasus (13), GE (11), Eaton (9), Alpine (5), SVC (5), SEG Solar (4), UNIRAC (5 after dedup), EZ Solar (3), ABB (3), Ecolibrium Solar (3), IMO (3), S-5! (2), Heyco (2), Arlington (1), Polaris (1), bussman (1), QuickBolt (1), Solis (1), Rooftech (1), System Sensor (1), Midwest (1), Buchanan (1), Xcel Energy (1), QCell (1), AP Smart (1), Sunpower-not-in-enum-yet variants. Add these to HubSpot enum in Phase B.
- **Phase C (flip the flag):** Set `HUBSPOT_MANUFACTURER_ENFORCEMENT=true` in Vercel prod env. New unknown brands now hard-block as Zach intended.

The flag-gated approach also provides a clean rollback if Phase C surfaces unexpected failures.

### Revised behavior (flag-gated per phased rollout above)

**When `HUBSPOT_MANUFACTURER_ENFORCEMENT=true`:** `createOrUpdateHubSpotProduct` hits a 400 from the `manufacturer` enum check, the function will:

1. **Block the entire HubSpot push** with a structured error containing the rejected brand.
2. The catalog approval engine returns `outcomes.HUBSPOT.status: "failed"` with message `"Brand 'XXX' is not in the HubSpot manufacturer enumeration. Add it via HubSpot Settings → Properties → Products → Manufacturer."`
3. **PendingCatalogPush remains PENDING** with the failure note (existing behavior — partial failures don't auto-approve).
4. The wizard UI surfaces the failure message, prompting the submitter to either request the brand be added or submit a corrected brand value.
5. The new ActivityLog row (from Milestone 1) carries `riskLevel: HIGH` and includes the rejected brand in metadata for admin follow-up.
6. **Brand is NOT silently moved to vendor_name.** The previous fallback proposal is reversed.

**When `HUBSPOT_MANUFACTURER_ENFORCEMENT=false` (default until Phase C):** the existing fallback behavior of dropping the `manufacturer` property and retrying is preserved — but we still log a HIGH-risk ActivityLog row recording the rejected brand. This builds up the backfill list during Phase B without blocking ops.

### Required code changes (replaces Milestone 2 Task 2.4 in the main plan)

1. **`src/lib/hubspot.ts:2568-2587`** — narrow the existing 400 retry to detect the manufacturer enum error specifically AND raise a typed error rather than dropping properties:

```typescript
class HubSpotManufacturerEnumError extends Error {
  constructor(public brand: string, public hubspotMessage: string) {
    super(`HubSpot rejected manufacturer "${brand}": ${hubspotMessage}`);
    this.name = "HubSpotManufacturerEnumError";
  }
}

// Inside createOrUpdateHubSpotProduct catch:
if (hasOptional && isManufacturerEnumRejection(message) && brand) {
  throw new HubSpotManufacturerEnumError(brand, message);
}
```

2. **`src/lib/catalog-push-approve.ts` HUBSPOT block (line 273-329)** — catch this error type specifically and produce a clearer outcome message:

```typescript
} catch (error) {
  if (error instanceof HubSpotManufacturerEnumError) {
    outcomes.HUBSPOT = {
      status: "failed",
      message: `Brand "${error.brand}" is not in HubSpot's manufacturer enum. Add it in HubSpot Settings → Properties → Products → Manufacturer (or correct the brand spelling), then retry.`,
    };
  } else {
    outcomes.HUBSPOT = {
      status: "failed",
      message: error instanceof Error ? error.message : "HubSpot product push failed.",
    };
  }
}
```

3. **`src/lib/catalog-sync-plan.ts` executePlan** — same error handling for the Sync Modal path.

4. **(Optional, follow-up)** — surface a "Request brand addition" button in the wizard's failure UI that emails the admin with the rejected brand. Out of scope for the initial fix.

---

## 4. Decisions log (all resolved 2026-04-24)

| # | Decision | Outcome |
|---|---|---|
| 1 | Zoho BATTERY/EV_CHARGER mapping | **Create new "Battery" + "EV Charger" categories in Zoho admin.** Existing items in "Tesla" stay put — no retroactive migration. |
| 2 | Zoho write field — id vs name | **Pin by `category_id`** for rename resilience. |
| 3 | Zuper custom field schema (15 fields) | **Approved as drafted in § 2.** |
| 4 | Zuper mobile visibility | **Mobile-visible** — add to Zuper mobile Product detail screen so techs see specs in the field. |
| 5 | Zuper backfill | **Yes** — one-time script populates existing Zuper Products from existing InternalProduct specs after fields are defined. |
| 6 | HubSpot "Generic" (106 products) | **Re-brand each row to actual manufacturer.** Significant Phase B data-cleanup task. Backfill script must update both `InternalProduct.brand` and the corresponding HubSpot Product `manufacturer` transactionally. |
| 7 | Eaton variants | **Keep 3 separate enum values** (`Eaton`, `Cutler-Hammer`, `Cutler Hammer - Eaton`). All 3 added to HubSpot manufacturer enum. |
| 8 | Other dedup | UNIRAC/Unirac → **Unirac**. Multiple/MULTIPLE → **merge to "Multiple"**. 3 test products (`TestBrand_*`, `UIBrand_*`, `UIBrand2_*`) → **delete**. |
| 9 | Auto-seed stock rows on product create | **No** — keep stock creation as an explicit ops action. |
| 10 | Wizard auth | **Keep open to all authed users with audit-flagging** (HIGH risk in ActivityLog for non-admin submissions). Do not restrict to ADMIN/EXEC. |
| D4 | HubSpot manufacturer enum policy | **Block-and-prompt** when enforcement flag is on. Phased rollout: Phase A ships flag-gated (default off), Phase B is data hygiene + enum backfill, Phase C flips flag in Vercel prod env. |

All decisions resolved. The plan is fully unblocked for implementation.
