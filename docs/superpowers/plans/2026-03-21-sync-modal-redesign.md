# SyncModal Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SyncModal's push/pull/skip direction-cycling UI with a wide comparison table where each cell has a dropdown to pick which source's value should be written to that system.

**Architecture:** New UI on top of the existing sync relay backend. A new `selectionToIntents()` client utility translates per-cell dropdown state into the existing `FieldIntent` model. Backend stays unchanged except for adding ~10 missing mapping edges and updating Zoho/Zuper field parsers to read newly-mapped fields.

**Tech Stack:** React 19, TypeScript 5, Tailwind v4, existing sync relay API (`catalog-sync-plan.ts`, `catalog-sync-types.ts`)

**Spec:** `docs/superpowers/specs/2026-03-21-sync-modal-redesign-design.md`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/catalog-sync-mappings.ts` | Modify | Add 10 new static edges, make 2 existing edges bidirectional |
| `src/lib/zoho-inventory.ts` | Modify | Add `brand`, `manufacturer`, `group_name` to `ZohoInventoryItem` interface |
| `src/lib/catalog-sync.ts` | Modify | Update `parseZohoCurrentFields` and `parseZuperCurrentFields` to read new fields; add `vendor_part_number`, `unit_label` to `HUBSPOT_CORE_PROPERTIES` |
| `src/__tests__/lib/catalog-sync-mappings.test.ts` | Modify | Add tests for new edges |
| `src/lib/selection-to-intents.ts` | Create | Pure function: per-cell dropdown state → `IntentsMap` with dedup/conflict rules |
| `src/__tests__/lib/selection-to-intents.test.ts` | Create | Tests for translation, dedup, relay, conflict filtering |
| `src/components/catalog/SyncModal.tsx` | Rewrite | Wide table layout, per-cell dropdowns, 3-step flow |
| `src/__tests__/lib/sync-modal-logic.test.ts` | Rewrite | Replace old toggle/reset tests with new dropdown/selection tests |
| `src/hooks/useSyncCascade.ts` | Delete | Replaced by dropdown model |

---

## Chunk 1: Backend — Mapping Edges & Field Parsers

### Task 1: Add missing mapping edges

**Files:**
- Modify: `src/lib/catalog-sync-mappings.ts:91-139` (STATIC_EDGES array)
- Modify: `src/__tests__/lib/catalog-sync-mappings.test.ts`

- [ ] **Step 1: Write failing tests for new edges**

Add to `src/__tests__/lib/catalog-sync-mappings.test.ts`:

```typescript
describe("new mapping edges", () => {
  it("includes zoho brand edge", () => {
    const edges = getActiveMappings("MODULE");
    const zohoBrand = edges.find(
      (e) => e.system === "zoho" && e.externalField === "brand",
    );
    expect(zohoBrand).toBeDefined();
    expect(zohoBrand!.internalField).toBe("brand");
    expect(zohoBrand!.normalizeWith).toBe("enum-ci");
    expect(zohoBrand!.direction).toBeUndefined(); // bidirectional
  });

  it("includes hubspot vendor_part_number edge", () => {
    const edges = getActiveMappings("MODULE");
    const hsModel = edges.find(
      (e) => e.system === "hubspot" && e.externalField === "vendor_part_number",
    );
    expect(hsModel).toBeDefined();
    expect(hsModel!.internalField).toBe("model");
    expect(hsModel!.normalizeWith).toBe("trimmed-string");
  });

  it("includes hubspot unit_label edge", () => {
    const edges = getActiveMappings("MODULE");
    const hsUnit = edges.find(
      (e) => e.system === "hubspot" && e.externalField === "unit_label",
    );
    expect(hsUnit).toBeDefined();
    expect(hsUnit!.internalField).toBe("unitLabel");
  });

  it("includes hubspot vendor_name edge", () => {
    const edges = getActiveMappings("MODULE");
    const hsVendor = edges.find(
      (e) => e.system === "hubspot" && e.externalField === "vendor_name",
    );
    expect(hsVendor).toBeDefined();
    expect(hsVendor!.internalField).toBe("vendorName");
  });

  it("includes zuper price edge", () => {
    const edges = getActiveMappings("MODULE");
    const zuperPrice = edges.find(
      (e) => e.system === "zuper" && e.externalField === "price",
    );
    expect(zuperPrice).toBeDefined();
    expect(zuperPrice!.internalField).toBe("sellPrice");
    expect(zuperPrice!.normalizeWith).toBe("number");
  });

  it("includes zuper purchase_price edge", () => {
    const edges = getActiveMappings("MODULE");
    const zuperCost = edges.find(
      (e) => e.system === "zuper" && e.externalField === "purchase_price",
    );
    expect(zuperCost).toBeDefined();
    expect(zuperCost!.internalField).toBe("unitCost");
    expect(zuperCost!.normalizeWith).toBe("number");
  });

  it("includes zuper model edge", () => {
    const edges = getActiveMappings("MODULE");
    const zuperModel = edges.find(
      (e) => e.system === "zuper" && e.externalField === "model",
    );
    expect(zuperModel).toBeDefined();
    expect(zuperModel!.internalField).toBe("model");
  });

  it("includes zuper uom edge", () => {
    const edges = getActiveMappings("MODULE");
    const zuperUom = edges.find(
      (e) => e.system === "zuper" && e.externalField === "uom",
    );
    expect(zuperUom).toBeDefined();
    expect(zuperUom!.internalField).toBe("unitLabel");
  });

  it("includes zuper vendor_name edge", () => {
    const edges = getActiveMappings("MODULE");
    const zuperVendor = edges.find(
      (e) => e.system === "zuper" && e.externalField === "vendor_name",
    );
    expect(zuperVendor).toBeDefined();
    expect(zuperVendor!.internalField).toBe("vendorName");
  });

  it("includes zuper brand edge", () => {
    const edges = getActiveMappings("MODULE");
    const zuperBrand = edges.find(
      (e) => e.system === "zuper" && e.externalField === "brand",
    );
    expect(zuperBrand).toBeDefined();
    expect(zuperBrand!.internalField).toBe("brand");
  });

  it("zoho part_number is now bidirectional", () => {
    const edges = getActiveMappings("MODULE");
    const zohoModel = edges.find(
      (e) => e.system === "zoho" && e.externalField === "part_number",
    );
    expect(zohoModel).toBeDefined();
    expect(zohoModel!.direction).toBeUndefined(); // no longer push-only
  });

  it("zoho unit is now bidirectional", () => {
    const edges = getActiveMappings("MODULE");
    const zohoUnit = edges.find(
      (e) => e.system === "zoho" && e.externalField === "unit",
    );
    expect(zohoUnit).toBeDefined();
    expect(zohoUnit!.direction).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --testPathPatterns="catalog-sync-mappings" -v`
Expected: FAIL — edges not found

- [ ] **Step 3: Add new edges and update existing ones**

In `src/lib/catalog-sync-mappings.ts`, add to the `STATIC_EDGES` array:

```typescript
// ── Zoho (new) ──
{ system: "zoho", externalField: "brand", internalField: "brand",
  normalizeWith: "enum-ci" },

// ── HubSpot (new) ──
{ system: "hubspot", externalField: "vendor_part_number", internalField: "model",
  normalizeWith: "trimmed-string" },
{ system: "hubspot", externalField: "unit_label", internalField: "unitLabel",
  normalizeWith: "trimmed-string" },
{ system: "hubspot", externalField: "vendor_name", internalField: "vendorName",
  normalizeWith: "trimmed-string" },

// ── Zuper (new) ──
{ system: "zuper", externalField: "brand", internalField: "brand",
  normalizeWith: "enum-ci" },
{ system: "zuper", externalField: "price", internalField: "sellPrice",
  normalizeWith: "number" },
{ system: "zuper", externalField: "purchase_price", internalField: "unitCost",
  normalizeWith: "number" },
{ system: "zuper", externalField: "model", internalField: "model",
  normalizeWith: "trimmed-string" },
{ system: "zuper", externalField: "uom", internalField: "unitLabel",
  normalizeWith: "trimmed-string" },
{ system: "zuper", externalField: "vendor_name", internalField: "vendorName",
  normalizeWith: "trimmed-string" },
```

Also update the two existing Zoho edges — remove `direction: "push-only"` from:
- `{ system: "zoho", externalField: "part_number", ... }` (line ~104)
- `{ system: "zoho", externalField: "unit", ... }` (line ~106)

And reset the cached edges since the array is lazy-initialized:
Make sure `_allEdges` is reset to `null` if tests need fresh edges (already handled by module reload in Jest).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --testPathPatterns="catalog-sync-mappings" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog-sync-mappings.ts src/__tests__/lib/catalog-sync-mappings.test.ts
git commit -m "feat(sync): add 10 new mapping edges, make zoho part_number and unit bidirectional"
```

### Task 2: Update Zoho interface and field parsers

**Files:**
- Modify: `src/lib/zoho-inventory.ts:18-34` (ZohoInventoryItem interface)
- Modify: `src/lib/catalog-sync.ts:157-169` (parseZohoCurrentFields)
- Modify: `src/lib/catalog-sync.ts:175-178` (HUBSPOT_CORE_PROPERTIES)
- Modify: `src/lib/catalog-sync.ts:238-248` (parseZuperCurrentFields)

- [ ] **Step 1: Update ZohoInventoryItem interface**

In `src/lib/zoho-inventory.ts`, add three fields to the `ZohoInventoryItem` interface (after the existing `unit` field, before the closing `}`):

```typescript
  brand?: string;                   // manufacturer/brand name
  manufacturer?: string;            // alternate manufacturer field
  group_name?: string;              // Zoho category grouping
```

- [ ] **Step 2: Update parseZohoCurrentFields**

In `src/lib/catalog-sync.ts`, add `brand` to `parseZohoCurrentFields`:

```typescript
export function parseZohoCurrentFields(item: Record<string, unknown>): Record<string, string | null> {
  return {
    name: str(item.name),
    sku: str(item.sku),
    rate: numStr(item.rate),
    purchase_rate: numStr(item.purchase_rate),
    description: str(item.description),
    part_number: str(item.part_number),
    unit: str(item.unit),
    vendor_name: str(item.vendor_name),
    vendor_id: str(item.vendor_id),
    brand: str(item.brand ?? item.manufacturer),
  };
}
```

- [ ] **Step 3: Update HUBSPOT_CORE_PROPERTIES**

In `src/lib/catalog-sync.ts`, add the two new properties:

```typescript
const HUBSPOT_CORE_PROPERTIES = [
  "name", "hs_sku", "price", "description", "manufacturer",
  "product_category", "hs_cost_of_goods_sold",
  "vendor_part_number", "unit_label", "vendor_name",
];
```

- [ ] **Step 4: Update parseZuperCurrentFields**

In `src/lib/catalog-sync.ts`, add `brand`, `model`, `price`, `purchase_price`, `uom`, `vendor_name`:

```typescript
export function parseZuperCurrentFields(item: Record<string, unknown>): Record<string, string | null> {
  const categoryObj = item.product_category as Record<string, unknown> | undefined;
  return {
    name: str(item.product_name ?? item.name ?? item.item_name ?? item.part_name),
    sku: str(item.product_id ?? item.sku ?? item.item_sku ?? item.item_code),
    description: str(item.product_description ?? item.description),
    category: str(categoryObj?.category_name ?? item.category ?? item.category_name),
    specification: str(item.specification),
    brand: str(item.brand),
    model: str(item.model ?? item.part_number ?? item.vendor_part_number),
    price: numStr(item.price ?? item.unit_price ?? item.rate),
    purchase_price: numStr(item.purchase_price ?? item.cost_price ?? item.cost),
    uom: str(item.uom ?? item.unit),
    vendor_name: str(item.vendor_name ?? item.vendor),
  };
}
```

- [ ] **Step 5: Run type check and existing tests**

Run: `npx tsc --noEmit -p tsconfig.json && npx jest --testPathPatterns="catalog-sync" -v`
Expected: PASS (no type errors, existing tests still pass)

- [ ] **Step 6: Commit**

```bash
git add src/lib/zoho-inventory.ts src/lib/catalog-sync.ts
git commit -m "feat(sync): update Zoho/HubSpot/Zuper field parsers for new mapping edges"
```

---

## Chunk 2: Selection-to-Intents Translation Layer

### Task 3: Create `selectionToIntents()` utility with tests

**Files:**
- Create: `src/lib/selection-to-intents.ts`
- Create: `src/__tests__/lib/selection-to-intents.test.ts`

This is the key translation layer between the new dropdown model and the existing backend.

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/lib/selection-to-intents.test.ts`:

```typescript
// src/__tests__/lib/selection-to-intents.test.ts

import {
  selectionToIntents,
  expandCompanions,
  computeSmartDefaults,
  getDropdownOptions,
  type CellSelection,
  type FieldRow,
  type SystemColumn,
} from "@/lib/selection-to-intents";
import type { ExternalSystem, FieldMappingEdge, FieldValueSnapshot } from "@/lib/catalog-sync-types";

// ── Helper: build a snapshot entry ──
function snap(
  system: ExternalSystem | "internal",
  field: string,
  rawValue: string | number | null,
): FieldValueSnapshot {
  return { system, field, rawValue, normalizedValue: rawValue };
}

// ── Helper: build a mapping edge ──
function edge(
  system: ExternalSystem,
  externalField: string,
  internalField: string,
  opts?: Partial<FieldMappingEdge>,
): FieldMappingEdge {
  return {
    system,
    externalField,
    internalField,
    normalizeWith: "trimmed-string",
    ...opts,
  };
}

const PRICE_EDGES: FieldMappingEdge[] = [
  edge("zoho", "rate", "sellPrice", { normalizeWith: "number" }),
  edge("hubspot", "price", "sellPrice", { normalizeWith: "number" }),
  edge("zuper", "price", "sellPrice", { normalizeWith: "number" }),
];

describe("selectionToIntents", () => {
  it("generates push intent for external cell picking Internal", () => {
    const selections: CellSelection[] = [
      { system: "hubspot", externalField: "price", source: "internal" },
    ];
    const result = selectionToIntents(selections, PRICE_EDGES);
    expect(result.hubspot.price).toEqual({
      direction: "push",
      mode: "manual",
      updateInternalOnPull: false,
    });
  });

  it("generates pull intent with updateInternalOnPull for Internal cell picking external", () => {
    const selections: CellSelection[] = [
      { system: "zoho", externalField: "rate", source: "zoho", isInternalColumn: true },
    ];
    const result = selectionToIntents(selections, PRICE_EDGES);
    expect(result.zoho.rate).toEqual({
      direction: "pull",
      mode: "manual",
      updateInternalOnPull: true,
    });
  });

  it("generates relay: pull from source + push to target", () => {
    // HubSpot cell picks Zoho's value
    const selections: CellSelection[] = [
      { system: "hubspot", externalField: "price", source: "zoho" },
    ];
    const result = selectionToIntents(selections, PRICE_EDGES);
    // Pull from Zoho (relay, no internal persist)
    expect(result.zoho.rate).toEqual({
      direction: "pull",
      mode: "manual",
      updateInternalOnPull: false,
    });
    // Push to HubSpot
    expect(result.hubspot.price).toEqual({
      direction: "push",
      mode: "manual",
      updateInternalOnPull: false,
    });
  });

  it("deduplicates: Internal pull wins over relay pull for same field", () => {
    const selections: CellSelection[] = [
      // Internal picks Zoho (persist)
      { system: "zoho", externalField: "rate", source: "zoho", isInternalColumn: true },
      // HubSpot also picks Zoho (relay)
      { system: "hubspot", externalField: "price", source: "zoho" },
    ];
    const result = selectionToIntents(selections, PRICE_EDGES);
    // Pull intent should have updateInternalOnPull: true (Internal column wins)
    expect(result.zoho.rate.updateInternalOnPull).toBe(true);
    // HubSpot still gets a push
    expect(result.hubspot.price.direction).toBe("push");
  });

  it("skips 'keep' selections", () => {
    const selections: CellSelection[] = [
      { system: "hubspot", externalField: "price", source: "keep" },
    ];
    const result = selectionToIntents(selections, PRICE_EDGES);
    expect(result.hubspot.price).toBeUndefined();
  });

  it("generates no entries for empty selections", () => {
    const result = selectionToIntents([], PRICE_EDGES);
    expect(Object.keys(result.zoho)).toHaveLength(0);
    expect(Object.keys(result.hubspot)).toHaveLength(0);
    expect(Object.keys(result.zuper)).toHaveLength(0);
  });
});

describe("computeSmartDefaults", () => {
  it("defaults to Internal when external is empty and internal has value", () => {
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "sellPrice", 305),
      snap("zoho", "rate", 305),
      snap("hubspot", "price", null),
      snap("zuper", "price", null),
    ];
    const defaults = computeSmartDefaults(PRICE_EDGES, snapshots, {
      zoho: true, hubspot: true, zuper: true,
    });
    // Zoho matches → keep
    expect(defaults.find((d) => d.system === "zoho")?.source).toBe("keep");
    // HubSpot empty, internal has value → internal
    expect(defaults.find((d) => d.system === "hubspot")?.source).toBe("internal");
    // Zuper empty → internal
    expect(defaults.find((d) => d.system === "zuper")?.source).toBe("internal");
  });

  it("defaults to keep when values differ (user decides)", () => {
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "sellPrice", 305),
      snap("zoho", "rate", 180),
      snap("hubspot", "price", 305),
    ];
    const defaults = computeSmartDefaults(PRICE_EDGES, snapshots, {
      zoho: true, hubspot: true, zuper: false,
    });
    // Values differ → keep (user must decide)
    expect(defaults.find((d) => d.system === "zoho")?.source).toBe("keep");
  });

  it("defaults to keep when internal is empty (don't pull by default)", () => {
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "sellPrice", null),
      snap("zoho", "rate", 180),
    ];
    const defaults = computeSmartDefaults(PRICE_EDGES, snapshots, {
      zoho: true, hubspot: false, zuper: false,
    });
    expect(defaults.find((d) => d.system === "zoho")?.source).toBe("keep");
  });
});

describe("getDropdownOptions", () => {
  it("filters out sources matching current value", () => {
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "sellPrice", 305),
      snap("zoho", "rate", 305),
      snap("hubspot", "price", 180),
    ];
    const options = getDropdownOptions(
      "hubspot", "price", "sellPrice",
      PRICE_EDGES, snapshots,
      { zoho: true, hubspot: true, zuper: false },
      null, // no locked source from Internal column
    );
    // "Internal" available (305 ≠ 180)
    expect(options.some((o) => o.value === "internal")).toBe(true);
    // "Zoho" available (305 ≠ 180, same value as internal but different source)
    expect(options.some((o) => o.value === "zoho")).toBe(true);
    // "Keep" always available
    expect(options.some((o) => o.value === "keep")).toBe(true);
    // Zuper not linked → not an option
    expect(options.some((o) => o.value === "zuper")).toBe(false);
  });

  it("filters external sources that conflict with Internal column pull", () => {
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "sellPrice", null),
      snap("zoho", "rate", 180),
      snap("hubspot", "price", 305),
    ];
    // Internal column already picked "zoho" for this field
    const options = getDropdownOptions(
      "hubspot", "price", "sellPrice",
      PRICE_EDGES, snapshots,
      { zoho: true, hubspot: true, zuper: false },
      "zoho", // locked source from Internal column
    );
    // Can pick Keep, Internal, or Zoho (same source as Internal → no conflict)
    expect(options.some((o) => o.value === "keep")).toBe(true);
    expect(options.some((o) => o.value === "internal")).toBe(true);
    expect(options.some((o) => o.value === "zoho")).toBe(true);
    // Cannot pick HubSpot as source (would conflict with Zoho pull)
    // HubSpot IS the target cell — it can't be its own source anyway
    // But if there were a 4th system, it would be blocked here
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --testPathPatterns="selection-to-intents" -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `selectionToIntents()`**

Create `src/lib/selection-to-intents.ts`:

```typescript
// src/lib/selection-to-intents.ts
//
// Translates per-cell dropdown selections from the SyncModal wide table
// into the IntentsMap consumed by the existing sync relay backend.

import type {
  ExternalSystem,
  FieldIntent,
  FieldMappingEdge,
  FieldValueSnapshot,
} from "./catalog-sync-types";
import { EXTERNAL_SYSTEMS } from "./catalog-sync-types";
import { normalizedEqual } from "./catalog-sync-mappings";

type IntentsMap = Record<ExternalSystem, Record<string, FieldIntent>>;

// ── Public types ──

/** A single cell's dropdown selection */
export interface CellSelection {
  /** The external system this cell belongs to */
  system: ExternalSystem;
  /** The external field name (mapping edge key) */
  externalField: string;
  /** Which source the user picked: "keep", "internal", or an ExternalSystem */
  source: "keep" | "internal" | ExternalSystem;
  /** True when this selection is for the Internal column (controls updateInternalOnPull) */
  isInternalColumn?: boolean;
}

/** A row in the comparison table */
export interface FieldRow {
  internalField: string;
  label: string;
  unit?: string;
  isVirtual: boolean;
  isPushOnly: boolean;
  edges: FieldMappingEdge[];
}

/** Column metadata */
export interface SystemColumn {
  system: ExternalSystem;
  linked: boolean;
  createEnabled: boolean;
}

/** Dropdown option */
export interface DropdownOption {
  value: "keep" | "internal" | ExternalSystem;
  label: string;
  projectedValue: string | number | null;
  disabled?: boolean;
}

// ── Core translation ──

/**
 * Convert per-cell dropdown selections into an IntentsMap for the backend.
 *
 * Rules:
 * - "keep" → no entry (skip is default)
 * - "internal" in an external column → push
 * - External source in the Internal column → pull with updateInternalOnPull: true
 * - External source in another external column → relay: pull(source) + push(target)
 * - Dedup: same system+externalField merges; updateInternalOnPull: true wins
 */
export function selectionToIntents(
  selections: CellSelection[],
  mappings: FieldMappingEdge[],
): IntentsMap {
  const result: IntentsMap = { zoho: {}, hubspot: {}, zuper: {} };

  // Expand companion fields before processing
  const expanded = expandCompanions(selections, mappings);

  for (const sel of expanded) {
    if (sel.source === "keep") continue;

    if (sel.source === "internal") {
      // Push internal value to this external system
      result[sel.system][sel.externalField] = {
        direction: "push",
        mode: "manual",
        updateInternalOnPull: false,
      };
      continue;
    }

    // Source is an external system
    const sourceSystem = sel.source as ExternalSystem;

    if (sel.isInternalColumn) {
      // Internal column pulling from an external source
      const sourceEdge = findEdgeForInternalField(mappings, sourceSystem, sel);
      if (sourceEdge) {
        mergePull(result, sourceSystem, sourceEdge.externalField, true);
      }
    } else {
      // External column picking another external source → relay
      // 1. Pull from the source system (no internal persist)
      const sourceEdge = findEdgeForInternalField(mappings, sourceSystem, sel);
      if (sourceEdge) {
        mergePull(result, sourceSystem, sourceEdge.externalField, false);
      }
      // 2. Push to the target system
      result[sel.system][sel.externalField] = {
        direction: "push",
        mode: "manual",
        updateInternalOnPull: false,
      };
    }
  }

  return result;
}

/** Find the mapping edge on `sourceSystem` that shares the same internalField as `sel` */
function findEdgeForInternalField(
  mappings: FieldMappingEdge[],
  sourceSystem: ExternalSystem,
  sel: CellSelection,
): FieldMappingEdge | undefined {
  // Find what internalField the target edge maps to
  const targetEdge = mappings.find(
    (e) => e.system === sel.system && e.externalField === sel.externalField,
  );
  if (!targetEdge) return undefined;

  // Find the source system's edge for the same internalField
  return mappings.find(
    (e) => e.system === sourceSystem && e.internalField === targetEdge.internalField,
  );
}

/**
 * Expand companion fields: if an edge has a `companion` property,
 * emit a matching selection for the companion field on the same system.
 * This ensures vendor_name and vendor_id always move together.
 */
export function expandCompanions(
  selections: CellSelection[],
  mappings: FieldMappingEdge[],
): CellSelection[] {
  const expanded = [...selections];
  for (const sel of selections) {
    if (sel.source === "keep") continue;
    const edge = mappings.find(
      (e) => e.system === sel.system && e.externalField === sel.externalField,
    );
    if (!edge?.companion) continue;
    // Check if the companion is already in selections
    const hasCompanion = selections.some(
      (s) => s.system === sel.system && s.externalField === edge.companion,
    );
    if (!hasCompanion) {
      expanded.push({
        system: sel.system,
        externalField: edge.companion,
        source: sel.source,
        isInternalColumn: sel.isInternalColumn,
      });
    }
  }
  return expanded;
}

/** Merge a pull intent, with updateInternalOnPull: true winning over false */
function mergePull(
  result: IntentsMap,
  system: ExternalSystem,
  externalField: string,
  updateInternal: boolean,
): void {
  const existing = result[system][externalField];
  if (existing && existing.direction === "pull") {
    // true wins over false
    if (updateInternal) {
      existing.updateInternalOnPull = true;
    }
    return;
  }
  result[system][externalField] = {
    direction: "pull",
    mode: "manual",
    updateInternalOnPull: updateInternal,
  };
}

// ── Smart defaults ──

/**
 * Compute default dropdown selections based on value comparison.
 *
 * Rules (from spec):
 * - All systems agree → "keep"
 * - Internal has value, external empty → "internal" (obvious push)
 * - Internal empty, external has value → "keep" (user must opt in)
 * - Values differ → "keep" (user decides)
 */
export function computeSmartDefaults(
  mappings: FieldMappingEdge[],
  snapshots: FieldValueSnapshot[],
  linkedSystems: Record<ExternalSystem, boolean>,
): CellSelection[] {
  const defaults: CellSelection[] = [];

  for (const edge of mappings) {
    if (!linkedSystems[edge.system]) continue;
    if (edge.direction === "push-only") continue;
    if (edge.internalField.startsWith("_")) continue; // virtual

    const internalSnap = snapshots.find(
      (s) => s.system === "internal" && s.field === edge.internalField,
    );
    const externalSnap = snapshots.find(
      (s) => s.system === edge.system && s.field === edge.externalField,
    );

    const internalValue = internalSnap?.rawValue ?? null;
    const externalValue = externalSnap?.rawValue ?? null;

    let source: "keep" | "internal" = "keep";

    if (normalizedEqual(internalValue, externalValue, edge.normalizeWith)) {
      source = "keep"; // already in sync
    } else if (internalValue != null && (externalValue == null || externalValue === "")) {
      source = "internal"; // obvious push
    }
    // else: values differ or internal empty → keep (user decides)

    defaults.push({
      system: edge.system,
      externalField: edge.externalField,
      source,
    });
  }

  return defaults;
}

// ── Dropdown option builder ──

/**
 * Build the dropdown options for a cell, filtering by:
 * - Whether the system is linked
 * - Whether the source value matches the current value (greyed/hidden)
 * - Whether the source would conflict with the Internal column's pull
 */
export function getDropdownOptions(
  system: ExternalSystem,
  externalField: string,
  internalField: string,
  mappings: FieldMappingEdge[],
  snapshots: FieldValueSnapshot[],
  linkedSystems: Record<ExternalSystem, boolean>,
  lockedPullSource: ExternalSystem | null,
): DropdownOption[] {
  const options: DropdownOption[] = [];

  const currentValue = snapshots.find(
    (s) => s.system === system && s.field === externalField,
  )?.rawValue ?? null;

  // Always include Keep
  options.push({
    value: "keep",
    label: "Keep",
    projectedValue: currentValue,
  });

  // Internal as a source
  const internalValue = snapshots.find(
    (s) => s.system === "internal" && s.field === internalField,
  )?.rawValue ?? null;

  options.push({
    value: "internal",
    label: "Internal",
    projectedValue: internalValue,
    disabled: internalValue === currentValue,
  });

  // Other external systems as sources
  for (const otherSys of EXTERNAL_SYSTEMS) {
    if (otherSys === system) continue; // can't be your own source
    if (!linkedSystems[otherSys]) continue; // not linked

    // Conflict check: if Internal column locked a pull source,
    // external cells can only use "keep", "internal", or the same source
    if (lockedPullSource && otherSys !== lockedPullSource) continue;

    const otherEdge = mappings.find(
      (e) => e.system === otherSys && e.internalField === internalField,
    );
    if (!otherEdge) continue;

    const otherValue = snapshots.find(
      (s) => s.system === otherSys && s.field === otherEdge.externalField,
    )?.rawValue ?? null;

    options.push({
      value: otherSys,
      label: otherSys === "zoho" ? "Zoho" : otherSys === "hubspot" ? "HubSpot" : "Zuper",
      projectedValue: otherValue,
      disabled: otherValue === currentValue,
    });
  }

  return options;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --testPathPatterns="selection-to-intents" -v`
Expected: PASS

- [ ] **Step 5: Run type check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/selection-to-intents.ts src/__tests__/lib/selection-to-intents.test.ts
git commit -m "feat(sync): add selectionToIntents translation layer with smart defaults and dropdown filtering"
```

---

## Chunk 3: SyncModal Rewrite

### Task 4: Rewrite SyncModal component

**Files:**
- Rewrite: `src/components/catalog/SyncModal.tsx`
- Rewrite: `src/__tests__/lib/sync-modal-logic.test.ts`
- Delete: `src/hooks/useSyncCascade.ts`

This is the largest task. The component goes from a 5-step direction-cycling modal to a 3-step wide comparison table.

- [ ] **Step 1: Rewrite SyncModal.tsx**

Complete rewrite of `src/components/catalog/SyncModal.tsx`. Key structural changes:

**Props** — same interface (`internalProductId`, `skuName`, `isOpen`, `onClose`, `onSyncComplete?`).

**State:**
```typescript
type Step = "loading" | "table" | "results";

// Per-cell dropdown state: maps "system:externalField" → source
type SelectionMap = Record<string, "keep" | "internal" | ExternalSystem>;

const [step, setStep] = useState<Step>("loading");
const [error, setError] = useState<string | null>(null);
const [snapshots, setSnapshots] = useState<FieldValueSnapshot[]>([]);
const [mappings, setMappings] = useState<FieldMappingEdge[]>([]);
const [selections, setSelections] = useState<SelectionMap>({});
const [linkedSystems, setLinkedSystems] = useState<Record<ExternalSystem, boolean>>({
  zoho: false, hubspot: false, zuper: false,
});
const [createToggles, setCreateToggles] = useState<Record<ExternalSystem, boolean>>({
  zoho: false, hubspot: false, zuper: false,
});
const [outcomes, setOutcomes] = useState<SyncOperationOutcome[]>([]);
const [showInSync, setShowInSync] = useState(false);
```

**Data fetch** — same `GET /api/inventory/products/${id}/sync` call. On success, compute smart defaults via `computeSmartDefaults()` to populate initial `selections`.

**Row building:**
```typescript
function buildRows(): { attention: FieldRow[]; inSync: FieldRow[] } {
  // Group edges by internalField, dedupe companions
  // Check if row has any diff across systems → attention vs inSync
  // Filter out virtual/push-only for separate handling
}
```

**Table rendering:**
- Full-width modal (`max-w-5xl`)
- 5-column grid: Field label | Internal | Zoho | HubSpot | Zuper
- Each cell: current value + dropdown (or `current → projected` when source ≠ keep)
- Colored borders: green for pull source, blue for push target
- Unlinked columns: "Not linked" + create toggle in header
- Virtual/push-only rows: read-only, no dropdowns, "(auto-generated)" or "(push-only)" label

**Summary bar:**
- Count of changes: "N fields will be updated across M systems"
- Implicit writes line: "Also updates: Name (auto-generated), ..."
- Sync button (disabled when no changes)

**Execute flow:**
1. Convert `selections` → `CellSelection[]` → `selectionToIntents()` → `IntentsMap`
2. `POST /sync/plan` with intents
3. If plan has conflicts → show error (shouldn't happen due to UI filtering)
4. `POST /sync/confirm` to get confirmation token
5. `POST /sync` with plan hash + confirmation token to execute
6. Show results step

**Results step** — reuse existing per-system outcome display.

The full component implementation should follow the patterns already in the file (theme tokens, Tailwind classes, etc.) and reference the spec for exact behavior of:
- Smart defaults (spec §Interaction Flow)
- Conflict prevention via dropdown filtering (spec §Conflict prevention)
- Cell display rule: `current → projected` (spec §Layout)
- Companion field merging (spec §Companion Fields)
- Unlinked system columns (spec §Unlinked Systems)
- Error handling (spec §Error handling)

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: No errors

- [ ] **Step 3: Rewrite sync-modal-logic tests**

Replace `src/__tests__/lib/sync-modal-logic.test.ts` — the old tests cover `handleGlobalToggle` and `resetAutoDecisions` which no longer exist. New tests should cover:

```typescript
// src/__tests__/lib/sync-modal-logic.test.ts
// Tests for SyncModal helper logic (row building, projected values, implicit writes)

describe("buildRows", () => {
  it("separates diff rows from in-sync rows");
  it("excludes virtual fields from editable rows");
  it("merges companion fields into single row");
  it("only includes category-relevant rows");
});

describe("getProjectedValue", () => {
  it("returns current value when selection is keep");
  it("returns source value when selection is an external system");
  it("returns internal value when selection is internal");
});

describe("getImplicitWrites", () => {
  it("lists generator-backed fields when related fields change");
  it("lists companion fields when primary field changes");
  it("returns empty when no implicit writes");
});
```

Extract the row-building and projected-value logic into testable pure functions (either in the component file or a small helper) so tests don't need to render React components.

- [ ] **Step 4: Run tests**

Run: `npx jest --testPathPatterns="sync-modal-logic" -v`
Expected: PASS

- [ ] **Step 5: Delete useSyncCascade**

```bash
rm src/hooks/useSyncCascade.ts
```

Verify no other files import it:

Run: `grep -r "useSyncCascade" src/ --include="*.ts" --include="*.tsx"`
Expected: No matches (the old SyncModal.tsx import is gone after the rewrite)

- [ ] **Step 6: Run full type check and test suite**

Run: `npx tsc --noEmit -p tsconfig.json && npx jest --testPathPatterns="catalog-sync|selection-to-intents|sync-modal" -v`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(sync): rewrite SyncModal with wide comparison table and per-cell source selection

Replace push/pull/skip direction cycling with a 4-column comparison table.
Each cell has a dropdown to pick which source's value should be written.
Remove useSyncCascade hook (replaced by dropdown model).

Closes: SyncModal redesign spec"
```

---

## Chunk 4: Integration Verification

### Task 5: Full build and lint

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No errors (warnings acceptable)

- [ ] **Step 3: Run full test suite**

Run: `npm run test`
Expected: All tests pass. Pre-existing failures unrelated to this work are acceptable (e.g., `zoho-inventory-create-contact.test.ts` has a known TypeScript error).

### Task 6: Manual E2E verification scenarios

**Files:** None (manual testing)

These are the key scenarios to verify against a running dev server or preview deployment:

- [ ] **Step 1: Product linked to all 3 systems**

1. Navigate to Catalog → edit a product linked to Zoho + HubSpot + Zuper
2. Click "Sync" → modal opens with wide table
3. Verify: "Needs Attention" rows show fields with diffs
4. Verify: "In Sync" section is collapsed with correct count
5. Pick "Internal" for an external cell → verify `current → projected` display
6. Click Sync → verify execution completes and results show

- [ ] **Step 2: Product linked to 1 system only**

1. Edit a product linked to Zoho only
2. Click Sync → HubSpot and Zuper columns show "Not linked"
3. Toggle "Create in HubSpot" → cells populate with "Internal" defaults
4. Execute → verify item created in HubSpot

- [ ] **Step 3: Relay scenario**

1. Find a product where Zoho has a different price than HubSpot
2. In HubSpot's price cell, pick "Zoho" from dropdown
3. Verify: Zoho pull intent + HubSpot push intent generated
4. Verify: Internal column stays on "Keep" (price not persisted internally)
5. Execute and verify HubSpot received Zoho's price

- [ ] **Step 4: Conflict prevention**

1. Set Internal column's price to "Zoho"
2. Check HubSpot column's price dropdown → should NOT offer "Zuper" as option (only Keep, Internal, Zoho)
3. Verify no way to create a conflicting pull

- [ ] **Step 5: Commit verification tag**

```bash
git commit --allow-empty -m "chore: SyncModal redesign E2E verification complete"
```
