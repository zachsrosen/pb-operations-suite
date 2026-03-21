# SyncModal Redesign: Wide Table with Per-Cell Source Selection

**Date:** 2026-03-21
**Status:** Draft
**Depends on:** PR #116 (cross-system sync relay, merged)

## Problem

The current SyncModal uses a system-grouped layout with push/pull/skip direction cycling per field. Users find it confusing — pulling a value from Zoho doesn't visually update what HubSpot will receive, fields show stale internal values instead of effective post-pull values, and the mental model of "directions" is harder to reason about than "pick the value you want."

## Solution

Replace the SyncModal UI with a wide comparison table showing all 4 data sources (Internal, Zoho, HubSpot, Zuper) side by side. Each cell gets a dropdown to pick which source's value should be written to that system. The existing sync relay backend (plan derivation, execution engine, confirmation tokens, API routes) stays intact — only the UI layer changes.

## Design

### Layout

A 5-column table:

```
┌─────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│  Field      │  Internal    │  Zoho        │  HubSpot     │  Zuper       │
├─────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│  Name       │  HYUNDAI...  │  HYUNDAI...  │  HiN-T440... │  Hyundai...  │
│             │  [Keep ▾]    │  [Keep ▾]    │  [Internal▾] │  [Internal▾] │
├─────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│  Price      │  $305        │  $180.35     │  $305        │  —           │
│             │  [Keep ▾]    │  [Keep ▾]    │  [Keep ▾]    │  [Internal▾] │
└─────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
```

Each cell shows the current value in that system plus a dropdown to select which source's value should end up there.

### Per-Cell Dropdowns

Dropdown options per cell:

- **Keep** — retain current value, no write (default when in sync)
- **Internal** — use the internal DB value
- **Zoho** — use Zoho's value
- **HubSpot** — use HubSpot's value
- **Zuper** — use Zuper's value

Rules:
- The Internal column's dropdown only shows external sources (pull candidates)
- External columns show Internal + other externals (push/relay candidates)
- Options whose value matches the cell's current value are hidden or greyed — no point picking a source that produces no change
- Systems the product isn't linked to don't appear as source options

### Translation to Existing Intent Model

The `selectionToIntents()` client-side function converts the per-cell dropdown state into an `IntentsMap` (`Record<ExternalSystem, Record<externalField, FieldIntent>>`). A single dropdown pick may produce **multiple** intent entries across different system keys:

| Selection | Intent entries generated |
|---|---|
| Internal cell picks "Zoho" | `zoho.sku → { direction: "pull", updateInternalOnPull: true }` |
| Internal cell picks "Keep" | No entry (skip is the default) |
| HubSpot cell picks "Internal" | `hubspot.hs_sku → { direction: "push" }` |
| HubSpot cell picks "Zoho" | `zoho.sku → { direction: "pull" }` **and** `hubspot.hs_sku → { direction: "push" }` (two entries across two system keys) |
| Any cell picks "Keep" | No entry for that system×field |

**Relay = two intent entries.** When a user picks an external source for another external system's cell, `selectionToIntents()` emits a pull under the source system key AND a push under the target system key. The function iterates all cells, composing intents across all four columns before submission.

**`updateInternalOnPull` control:** Picking an external source in the Internal column sets `updateInternalOnPull: true`. Picking an external source in another external column (relay) sets `updateInternalOnPull: false` by default — the relay flows the value to the target without modifying the internal DB. A per-row "save to internal" checkbox appears when any relay is active, letting users opt in to also persisting the relayed value internally.

The `POST /api/inventory/products/[id]/sync/plan` and `POST /sync` endpoints remain unchanged. The translation layer is purely client-side in the SyncModal component.

### Virtual & Generator-Backed Fields

Fields prefixed with `_` (e.g., `_name`, `_specification`) are virtual — they have no persisted internal value and are computed by generators from other fields (brand, model, category, spec data).

**UI treatment:** Virtual fields appear as **read-only rows** with a label like "Name (auto-generated)" or "Specification (auto-generated)". The Internal column shows the computed value. External columns show their current values. No dropdowns — these fields are always pushed from the generated value. They appear in the "In Sync" section if the generated value matches all externals, or in "Needs Attention" if any external differs.

**Push-only edges** (e.g., `category` on HubSpot — has `direction: "push-only"`): Displayed as read-only rows. The Internal column shows the current category. External columns show their current values. No dropdown — the value always flows from Internal. If Internal and external match, the row is in the "In Sync" section. Note: Zuper's `category` edge is bidirectional (it has a `transform: "zuperCategoryUid"`), so the Zuper category cell gets a normal dropdown like other fields.

### Companion Fields

Companion fields (e.g., `vendor_name` / `vendor_id` on Zoho) appear as a **single row** labeled with the user-facing field (e.g., "Vendor"). Picking a source for the vendor name auto-applies the same source for the companion vendor ID. The companion field value is shown as a subtitle or tooltip, not as a separate row. This prevents users from accidentally splitting vendor name and ID across different sources.

### Unlinked Systems

When a product is not linked to an external system (e.g., no `zuperProductUid`):

- The column **still appears** but all cells show "Not linked" in muted text
- A column-level **"Create in [System]"** toggle appears in the column header
- When toggled on, all cells in that column default to "Internal" (push all fields to create the new item)
- When toggled off, the column remains visible but inert (greyed out, no dropdowns)
- The summary bar reflects create operations: "Will create Zuper item with N fields"

This replaces the current modal's "Will Create" badge with an explicit user action.

### Row Organization

**Two sections (collapsed in-sync rows):**

1. **"Needs Attention" (top, always visible):** Rows where at least one system's value differs from another after normalization. These require user decisions. Sorted by field name.

2. **"In Sync" (bottom, collapsed by default):** Rows where all mapped systems agree on the value. Expandable via "Show N in-sync fields" toggle. When expanded, cells are read-only — no dropdowns.

**Row content:**
- Field label as row header with unit suffix when applicable (e.g., "Wattage (W)")
- Current value in each system cell
- "—" for fields that don't map to a system (rare after wiring up missing edges)
- Colored dropdown border when user selects a non-"Keep" source: green for the source being pulled from, blue for targets receiving a new value

**Category-conditional fields:** Only rows relevant to the product's category appear. No empty/irrelevant spec rows.

### Interaction Flow

**3 steps** (down from the current 5-step state machine):

1. **Loading** — fetch snapshots from all 3 external systems, build comparison table
2. **Table** — wide comparison grid with per-cell dropdowns. Summary bar at bottom: "N fields will be updated across M systems" with a **Sync** button
3. **Results** — per-system success/failure outcomes with field-level detail (same as current results step)

No separate plan preview step — the table IS the preview. Users see current values, what each system will receive, and where values come from. Plan derivation still runs server-side on Sync click to catch stale data.

**Smart defaults:** When the modal opens, dropdowns are set based on value comparison:
- If all systems agree on a value → "Keep" (no action needed)
- If Internal has a value and an external system's field is empty → default to "Internal" (pre-fill the obvious push)
- If Internal is empty and an external has a value → "Keep" (don't pull by default — user must opt in)
- If values differ across systems → "Keep" everywhere (user decides)

Users can override any default. This matches the spirit of the existing `deriveDefaultIntents` behavior (push diffs, skip matches) but expressed through dropdown pre-selection.

**Conflict indication:** If a user picks different sources for the same internal field across systems (e.g., pull price from Zoho into Internal but leave HubSpot's cell on "Keep" with its old different price), highlight the inconsistency with a yellow border. Informational only — not blocking.

**Stale data guard:** Same mechanism as current sync relay — if values changed between load and execute, server returns 409 and the modal reloads fresh snapshots.

**Error handling:** If the snapshot fetch fails during Loading (network error, 500, product not found), the modal shows an error message in the table area with a "Retry" button. The modal stays open — user can retry or close. Individual system fetch failures are non-fatal: the system's column appears with "Failed to load" and is inert (no dropdowns). The user can still sync the other systems.

### Modal Sizing

Full-width modal (`max-w-5xl` or similar) to fit 5 columns. On smaller screens, horizontal scroll with the field label column sticky-left. Title pattern unchanged: "Sync: BRAND MODEL(SKU)". Close button and chrome unchanged.

## Missing Mapping Edges

The following fields already exist in each external system but aren't wired into `catalog-sync-mappings.ts`. This redesign adds them so the comparison table is fully populated.

### New Static Edges

| Internal Field | Zoho | HubSpot | Zuper | Notes |
|---|---|---|---|---|
| brand | `brand` (standard field) | `manufacturer` (already mapped) | `brand` (Zuper product field) | Add Zoho + Zuper edges |
| model | `part_number` (exists, push-only) | `vendor_part_number` (exists, unmapped) | `model` (Zuper product field) | Make Zoho bidirectional, add HubSpot + Zuper edges |
| unitLabel | `unit` (exists, push-only) | `unit_label` (exists, unmapped) | `uom` | Make Zoho bidirectional, add HubSpot + Zuper edges |
| sellPrice | `rate` (already mapped) | `price` (already mapped) | `price` | Add Zuper edge |
| unitCost | `purchase_rate` (already mapped) | `hs_cost_of_goods_sold` (already mapped) | `purchase_price` | Add Zuper edge |
| vendorName | `vendor_name` (already mapped) | `vendor_name` (already mapped) | `vendor_name` | Add Zuper edge |

### Interface Updates

- `ZohoInventoryItem`: add `brand?: string`, `manufacturer?: string`, `group_name?: string` fields
- Snapshot builders in `catalog-sync-plan.ts`: update `parseZuperCurrentFields` and `parseZohoCurrentFields` to read new fields
- Remove `direction: "push-only"` from Zoho `part_number` and `unit` edges to make them bidirectional

### Total New Edges

~9 new `FieldMappingEdge` entries in the static edges array:
- Zoho: `brand` → brand (1 new)
- HubSpot: `vendor_part_number` → model, `unit_label` → unitLabel (2 new)
- Zuper: `brand` → brand, `price` → sellPrice (`normalizeWith: "number"`), `purchase_price` → unitCost (`normalizeWith: "number"`), `model` → model, `uom` → unitLabel, `vendor_name` → vendorName (6 new, all `normalizeWith: "trimmed-string"` except price/cost which use `"number"`)

Plus updating 2 existing Zoho edges (`part_number`, `unit`) from `direction: "push-only"` to bidirectional (remove the direction property).

## What Stays Unchanged

- `catalog-sync-types.ts` — all types remain valid
- `catalog-sync-plan.ts` — plan derivation engine, execution, effective state overlay
- `catalog-sync-confirmation.ts` — HMAC confirmation tokens
- API routes: `GET/POST /sync`, `POST /sync/plan`, `POST /sync/confirm`
- Server-side plan hash, stale detection, conflict detection

## What Changes

- `SyncModal.tsx` — complete rewrite of the UI (steps, layout, interaction model)
- `catalog-sync-mappings.ts` — add ~9 new static edges, make 2 bidirectional
- `ZohoInventoryItem` interface — add 3 optional fields
- Snapshot builders — read new external fields
- New client-side utility: `selectionToIntents()` — translates per-cell dropdown state to `FieldIntent` map for the plan API

## What Gets Removed

- `useSyncCascade.ts` — the auto-cascade hook is replaced by the dropdown model. Users explicitly pick sources instead of cycling directions; no cascading needed.
- Direction cycling UI (push → skip → pull buttons)
- The "plan preview" step — the table serves as the preview

## Out of Scope

- Creating custom fields in external systems (confirmed unnecessary — all fields already exist)
- Zuper custom field sync (spec-level fields like wattage, efficiency — these remain HubSpot-only via category-conditional edges for now)
- Bulk sync across multiple products
- Auto-sync scheduling
