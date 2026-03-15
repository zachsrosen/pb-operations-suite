# Catalog Validation & Downstream Readiness Warnings

**Date:** 2026-03-15
**Status:** Approved
**Scope:** Required spec field enforcement + per-system sync readiness on Review

## Problem

The product submission wizard has no spec field validation. A user can submit a MODULE without `wattage`, a BATTERY without `capacityKwh`, and so on. The `required?: boolean` property exists on `FieldDef` but is never set or enforced anywhere — client or server.

Additionally, the Review step shows no information about what each downstream system will or won't receive. Users don't know that Zoho has no confirmed category mapping for their product, or that only 1 of 8 spec fields maps to a HubSpot property. Those gaps surface as surprises after approval.

## Solution

Two features delivered together:

1. **Required spec validation** — mark key spec fields as required, enforce in a shared validator that runs on client (ReviewStep + handleSubmit) and server (POST /api/catalog/push-requests).
2. **Downstream readiness warnings** — show per-system sync status on Review so users see what will and won't sync before submitting.

## Feature 1: Required Spec Validation

### Required fields (phase 1)

| Category | Field key | Label | Why |
|----------|-----------|-------|-----|
| MODULE | `wattage` | DC Size (Wattage) | Drives unitSpec, HubSpot `dc_size`, Zuper spec |
| INVERTER | `acOutputKw` | AC Output Size | Drives unitSpec, HubSpot `ac_size`, Zuper spec |
| BATTERY | `capacityKwh` | Capacity | Drives unitSpec, HubSpot `size__kwh_`, Zuper spec |
| BATTERY_EXPANSION | `capacityKwh` | Capacity | Shared by reference — see note below |
| EV_CHARGER | `powerKw` | Charger Power | Drives HubSpot `capacity__kw_`, Zuper spec |

All other categories have no required spec fields in phase 1.

**BATTERY_EXPANSION note:** `CATEGORY_CONFIGS.BATTERY_EXPANSION.fields` is assigned by reference to `CATEGORY_CONFIGS.BATTERY.fields` (line 216 of catalog-fields.ts). This means only **4 `FieldDef` objects** are actually modified — setting `required: true` on BATTERY's `capacityKwh` automatically applies to BATTERY_EXPANSION. No separate edit is needed.

### Data layer changes — `catalog-fields.ts`

Add `required: true` to four `FieldDef` entries:
- MODULE → `wattage`
- INVERTER → `acOutputKw`
- BATTERY → `capacityKwh` (inherited by BATTERY_EXPANSION via shared reference)
- EV_CHARGER → `powerKw`

No other field definitions change.

### Shared validation core — `validateRequiredSpecFields()`

To support both client-side (`CatalogFormState`) and server-side (raw POST body with `metadata`) validation, extract a shared low-level function:

```typescript
// In catalog-form-state.ts
function validateRequiredSpecFields(
  category: string,
  specValues: Record<string, unknown>
): ValidationError[]
```

This checks the category's `FieldDef[]` for fields with `required: true`, skipping any hidden by `showWhen`, and returns errors for those with blank values.

**Client validator** — `validateCatalogForm(state: CatalogFormState)` calls `validateRequiredSpecFields(state.category, state.specValues)` plus top-level field checks and warning logic. Returns `{ valid, errors, warnings }`.

**Server validator** — the POST route applies two layers: (1) `isBlank()` checks on top-level fields (`brand`, `model`, `description`, `category`), replacing the existing truthiness guards, and (2) `validateRequiredSpecFields(category, metadata)` on spec fields. The `metadata` object may contain non-spec keys (like `_photoUrl`); this is harmless because the function iterates from `FieldDef[]` keys, never from `Object.keys(metadata)`.

### Validator shape

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];    // blocking — prevents submit
  warnings: ValidationWarning[]; // non-blocking — shown but don't prevent submit
}

interface ValidationError {
  field: string;    // e.g., "brand", "spec.wattage"
  message: string;  // e.g., "Wattage is required for Module"
  section: "basics" | "details" | "review";
}

interface ValidationWarning {
  field: string;
  message: string;
  section: "basics" | "details" | "review";
}
```

**Error checks (blocking):**
- Top-level required: `category`, `brand`, `model`, `description` must be non-blank
- Spec required: for the selected category, any `FieldDef` with `required: true` must have a non-blank value in `specValues`
- `valid` is `true` only when `errors.length === 0`

**Warning checks (non-blocking):**
- Sell price < unit cost (moved from ad-hoc ReviewStep logic into the shared validator)

**Blank detection:**
- Uses an `isBlank(value: unknown)` helper: returns `true` for `undefined`, `null`, `""`, whitespace-only strings
- `0` is NOT blank — a numeric zero is a valid value
- `false` is NOT blank — a boolean false is a valid value

**showWhen awareness:**
- Required field checks skip fields whose `showWhen` condition is not met
- A `showWhen` condition is met when `specValues[showWhen.field] === showWhen.value` (strict equality)
- Phase 1 has no `showWhen` fields marked required, but this prepares for the battery built-in-inverter conditional

**Edge case — blank category:**
- When `category` is blank or invalid, `getCategoryFields()` returns `[]`, so no spec-field required checks run. The top-level "category is required" error is sufficient.

### Enforcement points

1. **ReviewStep (client)** — calls `validateCatalogForm()` on render. Shows errors inline in the spec and basics summary sections. Disables Submit button when `valid === false`. Shows warnings in the existing amber banner.

2. **handleSubmit in submit-product/page.tsx (client)** — calls `validateCatalogForm()` before fetch. Bails with error if not valid. Safety net against step navigation bypass.

3. **POST /api/catalog/push-requests (server)** — two validation layers:
   - **Top-level fields:** replace the existing truthiness guards (`if (!brand || !model || !description || !category)`) with `isBlank()` checks so whitespace-only values like `" "` are rejected. This uses the same `isBlank()` helper from `catalog-form-state.ts`.
   - **Spec fields:** calls `validateRequiredSpecFields(category, metadata)` on the raw request body. Returns 400 with `{ error, missingFields }` if any required spec fields are blank.

   Note: the server must handle `metadata` containing non-spec keys like `_photoUrl` — the validator ignores these because it iterates from `FieldDef[]` keys, not `Object.keys(metadata)`.

### UX changes

**DetailsStep:**
- The DetailsStep `<h3>` header (line 70-72) conditionally renders: shows "Category Specifications" (no `(optional)` badge) when the category has any required fields, keeps "Category Specifications (optional)" otherwise
- Note: `CategoryFields.tsx` renders its own inner `<h3>` at line 149, but this is a subsection heading inside the card. The DetailsStep `<h3>` at line 70 is the card title that wraps it. The conditional logic applies to the DetailsStep card title only.

**CategoryFields (no changes needed):**
- `CategoryFields.tsx` already renders red asterisks for `required` fields (lines 166-168). Once the `FieldDef` data is updated, asterisks appear automatically.

**ReviewStep:**
- Spec rows with missing required values show the field label in red with "Required" instead of "—"
- Error summary above Submit button: "1 required field missing: Wattage (Module)"
- Submit button disabled with clear messaging when errors exist
- Warnings (e.g., sell < cost) shown in amber, non-blocking

## Feature 2: Downstream Readiness Warnings

### New module — `catalog-readiness.ts`

Separate from `catalog-fields.ts` because this is business/sync logic, not field configuration.

New export: `getDownstreamReadiness(input)`:

```typescript
interface ReadinessInput {
  category: string;
  systems: Set<string>;
  specValues: Record<string, unknown>;
}

interface SystemReadiness {
  system: "INTERNAL" | "ZOHO" | "HUBSPOT" | "ZUPER";
  status: "ready" | "partial" | "limited";
  details: string[];
}

function getDownstreamReadiness(input: ReadinessInput): SystemReadiness[];
```

**Per-system logic:**

- **INTERNAL**: always `ready` if category is valid. Detail: "Will create/update EquipmentSku"

- **ZOHO**: calls `hasVerifiedZohoMapping(category)` from `zoho-taxonomy.ts`.
  - If verified → `ready`: "Zoho group: {groupName}"
  - If not verified → `limited`: "No confirmed Zoho group mapping — item created without category group"

- **HUBSPOT**: inspects category's `FieldDef[]` to classify every filled spec field as "mapped" (has `hubspotProperty`) or "unmapped" (no `hubspotProperty`). Uses `isBlank()` for consistency. Iterates from `FieldDef[]` keys, never from `Object.keys(specValues)`.
  - Counts: `filledMapped` (filled + has hubspotProperty), `filledUnmapped` (filled + no hubspotProperty), `totalMapped` (all fields with hubspotProperty)
  - All filled fields are mapped → `ready`: "Will sync {fieldNames}"
  - Some filled fields are mapped, some aren't → `partial`: "Will sync {mappedNames} · {n} filled field(s) won't sync to HubSpot ({unmappedNames})"
  - No HubSpot-mapped fields exist for category → `limited`: "No spec fields map to HubSpot properties"
  - The key insight: the user needs to know which of their *entered* data won't reach HubSpot, not just whether the mapped fields are filled

- **ZUPER**: calls `generateZuperSpecification(category, specValues)`.
  - Non-empty result → `ready`: "Specification: \"{specString}\""
  - Empty result → `limited`: "No specification summary will be generated"
  - Note: `generateZuperSpecification` uses truthiness checks (`if (specData.wattage)`), so `wattage=0` produces an empty spec string. This is expected — a 0W module is nonsensical and would correctly show an amber warning for Zuper even though it passes required-field validation.

Only evaluates systems the user has toggled on.

### UX — ReviewStep "System Sync Preview"

New card rendered between the Systems checkboxes and the Submit button.

For each selected system, shows one row:
- Status icon: green checkmark for `ready`, amber warning for `partial`/`limited`
- System name
- First detail string as one-line description

Example:
```
System Sync Preview
 ✓ Internal  — Will create/update EquipmentSku
 ✓ HubSpot   — Will sync dc_size · 1 filled field won't sync (efficiency)
 ⚠ Zoho      — No confirmed category group · Item created without group
 ✓ Zuper     — Specification: "400W Mono PERC"
```

Uses theme tokens: `text-green-400` for ready, `text-amber-400` for partial/limited. Card follows existing `bg-surface rounded-xl border border-t-border p-6 shadow-card` pattern.

## Files touched

| File | Change type | Description |
|------|-------------|-------------|
| `src/lib/catalog-fields.ts` | Modify | Add `required: true` to 4 FieldDefs (BATTERY_EXPANSION inherits) |
| `src/lib/catalog-form-state.ts` | Modify | Add `validateCatalogForm()`, `validateRequiredSpecFields()`, `isBlank()`, validation types |
| `src/lib/catalog-readiness.ts` | **New** | `getDownstreamReadiness()` with per-system sync logic |
| `src/components/catalog/ReviewStep.tsx` | Modify | Wire validation errors/warnings + downstream readiness UI |
| `src/components/catalog/DetailsStep.tsx` | Modify | Conditional section header (remove "optional" badge when required fields exist) |
| `src/components/catalog/CategoryFields.tsx` | **No change** | Already renders required asterisks — works automatically once FieldDef data is updated |
| `src/app/dashboards/submit-product/page.tsx` | Modify | Call `validateCatalogForm()` in handleSubmit |
| `src/app/api/catalog/push-requests/route.ts` | Modify | Server-side `validateRequiredSpecFields()` call |
| `src/__tests__/lib/catalog-form-state.test.ts` | Modify | Tests for `validateCatalogForm()` and `validateRequiredSpecFields()` |
| `src/__tests__/lib/catalog-readiness.test.ts` | **New** | Tests for `getDownstreamReadiness()` |

## Not in scope

- Battery built-in-inverter conditional fields (follow-up: schema migration + new FieldDefs + showWhen + conditional validation)
- Vendor picker / brand normalization (separate effort, needs canonical vendor list from Zoho)
- Create-vs-update preview (phase 2: needs backend lookup endpoint)
- Payload preview per system (later operational hardening)
- Per-field confidence scores or provenance taxonomy (unnecessary — current binary prefilled/manual is sufficient)

## Test plan

### validateCatalogForm / validateRequiredSpecFields tests
- Returns valid for MODULE with wattage filled
- Returns error for MODULE with wattage empty
- Returns valid for RACKING with no spec fields (no required fields)
- `0` is not blank — MODULE with wattage=0 passes validation
- Whitespace-only string is blank — brand=" " fails
- Returns warning (not error) for sell < cost
- Skips fields hidden by showWhen conditions (mock a showWhen field)
- Top-level required fields (category, brand, model, description) produce errors when missing
- Blank category skips spec-field checks, returns only top-level category error

### getDownstreamReadiness tests
- ZOHO returns `ready` for MODULE (confirmed mapping) — mock `hasVerifiedZohoMapping`
- ZOHO returns `limited` for a category without confirmed mapping — mock `hasVerifiedZohoMapping` returning false
- HUBSPOT returns `ready` when all filled fields have hubspotProperty mappings
- HUBSPOT returns `partial` when some filled fields lack hubspotProperty (reports which won't sync)
- ZUPER returns `ready` with spec string for MODULE with wattage
- ZUPER returns `limited` for MODULE without wattage
- Only evaluates toggled-on systems
- INTERNAL always returns `ready` for valid categories

### Integration
- ReviewStep renders error indicators for missing required fields
- ReviewStep disables Submit when errors exist
- ReviewStep shows downstream readiness card for selected systems
- Server rejects POST missing required spec fields with 400 and structured error
