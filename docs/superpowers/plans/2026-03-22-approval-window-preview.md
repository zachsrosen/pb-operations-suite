# Product Approval Window Preview — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-system create/update payload preview cards to the product approval window so users can see exactly what each external system will receive before approving.

**Architecture:** Build a pure function `buildSystemPreview()` that uses the same mapping edges from `catalog-sync-mappings.ts` to compute the exact field→value pairs each system will receive. Render these as preview cards in `ReviewStep.tsx`, replacing the current vague "System Sync Preview" readiness indicators. Reuse the same mapping/plan logic so the preview stays aligned with actual execution.

**Tech Stack:** React, TypeScript, existing catalog-sync-mappings, catalog-fields, theme tokens.

---

## Chunk 1: Preview Data Builder

### Task 1: Build `buildSystemPreview()` pure function

**Files:**
- Create: `src/lib/catalog-preview.ts`
- Test: `src/__tests__/lib/catalog-preview.test.ts`

This function takes the form state and selected systems, and returns the exact field→value map each system will receive on approval. It uses the same `STATIC_EDGES` and category-conditional edges from `catalog-sync-mappings.ts`. For fields with transforms (e.g., Zuper category → UID), the preview shows both the raw internal value and a `transformed` flag so the UI can render `raw → (will be mapped)` instead of showing a misleading raw value as final. The only current transform (`zuperCategoryUid`) is async and depends on a Zuper API call, so the preview shows the human-readable category name with a "(will be mapped to system ID)" indicator rather than making an API call at preview time.

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/lib/catalog-preview.test.ts
import { buildSystemPreview, type SystemPreviewCard } from "@/lib/catalog-preview";

describe("buildSystemPreview", () => {
  const baseInput = {
    category: "MODULE",
    brand: "REC",
    model: "Alpha 400W",
    name: "REC Alpha 400W",
    description: "400 Watt Solar Panel",
    sku: "REC-ALPHA-400",
    vendorName: "REC Group",
    vendorPartNumber: "REC-400-AA",
    unitLabel: "W",
    sellPrice: 305,
    unitCost: 180,
    specValues: { dc_size: "400", efficiency: "21.6" },
  };

  it("returns preview cards for selected systems", () => {
    const cards = buildSystemPreview(baseInput, new Set(["ZOHO", "HUBSPOT"]));
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.system)).toEqual(["ZOHO", "HUBSPOT"]);
  });

  it("zoho card includes mapped fields with external field names", () => {
    const cards = buildSystemPreview(baseInput, new Set(["ZOHO"]));
    const zoho = cards[0];
    expect(zoho.system).toBe("ZOHO");
    expect(zoho.fields).toContainEqual({ label: "Name", externalField: "name", value: "REC Alpha 400W" });
    expect(zoho.fields).toContainEqual({ label: "SKU", externalField: "sku", value: "REC-ALPHA-400" });
    expect(zoho.fields).toContainEqual({ label: "Sell Price", externalField: "rate", value: 305 });
    expect(zoho.fields).toContainEqual({ label: "Unit Cost", externalField: "purchase_rate", value: 180 });
    expect(zoho.fields).toContainEqual({ label: "Brand", externalField: "brand", value: "REC" });
  });

  it("hubspot card includes category-conditional spec fields", () => {
    const cards = buildSystemPreview(baseInput, new Set(["HUBSPOT"]));
    const hs = cards[0];
    // Category-conditional field from MODULE config
    const wattage = hs.fields.find((f) => f.externalField === "dc_size");
    expect(wattage).toBeDefined();
    expect(wattage!.value).toBe("400");
  });

  it("marks missing required fields", () => {
    const input = { ...baseInput, sku: null, sellPrice: null };
    const cards = buildSystemPreview(input, new Set(["ZOHO"]));
    const zoho = cards[0];
    const skuField = zoho.fields.find((f) => f.externalField === "sku");
    expect(skuField!.value).toBeNull();
    expect(skuField!.missing).toBe(true);
  });

  it("returns empty array when no systems selected", () => {
    const cards = buildSystemPreview(baseInput, new Set());
    expect(cards).toEqual([]);
  });

  it("does not include internal-only fields", () => {
    const cards = buildSystemPreview(baseInput, new Set(["ZUPER"]));
    const zuper = cards[0];
    // zohoVendorId is internal-only for Zuper
    const vendorId = zuper.fields.find((f) => f.externalField === "zohoVendorId");
    expect(vendorId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/lib/catalog-preview.test.ts --no-coverage`
Expected: FAIL with "Cannot find module '@/lib/catalog-preview'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/catalog-preview.ts
//
// Builds per-system create payload previews for the product approval window.
// Uses the same mapping edges as SyncModal so preview matches execution.

import { getActiveMappings } from "./catalog-sync-mappings";
import type { FieldMappingEdge } from "./catalog-sync-types";

/** A single field in a system preview card. */
export interface PreviewField {
  label: string;
  externalField: string;
  value: string | number | null;
  /** True when value is null/empty for a field that the system expects. */
  missing?: boolean;
}

/** Preview card for one external system. */
export interface SystemPreviewCard {
  system: "ZOHO" | "HUBSPOT" | "ZUPER";
  fields: PreviewField[];
}

/** Human-readable labels for internal field names. */
const INTERNAL_LABELS: Record<string, string> = {
  name: "Name",
  brand: "Brand",
  model: "Model",
  description: "Description",
  sku: "SKU",
  sellPrice: "Sell Price",
  unitCost: "Unit Cost",
  unitLabel: "Unit Label",
  vendorName: "Vendor",
  category: "Category",
  zohoVendorId: "Vendor ID",
};

/** Map system checkbox values to ExternalSystem keys. */
const SYSTEM_MAP: Record<string, "zoho" | "hubspot" | "zuper"> = {
  ZOHO: "zoho",
  HUBSPOT: "hubspot",
  ZUPER: "zuper",
};

/** System display order. */
const SYSTEM_ORDER = ["ZOHO", "HUBSPOT", "ZUPER"] as const;

interface PreviewInput {
  category: string;
  brand: string;
  model: string;
  name?: string | null;
  description?: string | null;
  sku?: string | null;
  vendorName?: string | null;
  vendorPartNumber?: string | null;
  unitLabel?: string | null;
  sellPrice?: number | null;
  unitCost?: number | null;
  specValues?: Record<string, unknown>;
}

/**
 * Build per-system preview cards showing exactly what fields each system
 * will receive when the product is approved. Uses the same mapping edges
 * as the SyncModal to stay aligned with actual execution.
 */
export function buildSystemPreview(
  input: PreviewInput,
  selectedSystems: Set<string>,
): SystemPreviewCard[] {
  const cards: SystemPreviewCard[] = [];
  const activeMappings = getActiveMappings(input.category);

  for (const sysKey of SYSTEM_ORDER) {
    if (!selectedSystems.has(sysKey)) continue;
    const system = SYSTEM_MAP[sysKey];
    if (!system) continue;

    const systemEdges = activeMappings.filter((e) => e.system === system);
    const fields = buildFieldsForSystem(systemEdges, input);

    cards.push({ system: sysKey, fields });
  }

  return cards;
}

function buildFieldsForSystem(
  edges: FieldMappingEdge[],
  input: PreviewInput,
): PreviewField[] {
  const fields: PreviewField[] = [];
  const seen = new Set<string>();

  for (const edge of edges) {
    if (seen.has(edge.externalField)) continue;
    seen.add(edge.externalField);

    const value = resolveValue(edge.internalField, input);
    const label = INTERNAL_LABELS[edge.internalField] ?? edge.internalField;

    fields.push({
      label,
      externalField: edge.externalField,
      value,
      missing: value === null || value === undefined || value === "",
    });
  }

  return fields;
}

function resolveValue(
  internalField: string,
  input: PreviewInput,
): string | number | null {
  // Check core fields first
  const coreFields: Record<string, unknown> = {
    name: input.name ?? `${input.brand} ${input.model}`.trim(),
    brand: input.brand,
    model: input.model,
    description: input.description,
    sku: input.sku,
    vendorName: input.vendorName,
    unitLabel: input.unitLabel,
    sellPrice: input.sellPrice,
    unitCost: input.unitCost,
    category: input.category,
  };

  if (internalField in coreFields) {
    const v = coreFields[internalField];
    if (v === null || v === undefined || v === "") return null;
    return typeof v === "number" ? v : String(v);
  }

  // Check spec values for category-conditional fields
  if (input.specValues && internalField in input.specValues) {
    const v = input.specValues[internalField];
    if (v === null || v === undefined || v === "") return null;
    return typeof v === "number" ? v : String(v);
  }

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/lib/catalog-preview.test.ts --no-coverage`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog-preview.ts src/__tests__/lib/catalog-preview.test.ts
git commit -m "feat: add buildSystemPreview for approval window payload preview"
```

---

## Chunk 2: Preview Cards in ReviewStep

### Task 2: Replace readiness indicators with preview cards

**Files:**
- Modify: `src/components/catalog/ReviewStep.tsx`

Replace the current "System Sync Preview" section (which shows vague readiness status) with detailed per-system preview cards. Each card shows the exact fields and values that system will receive.

- [ ] **Step 1: Import `buildSystemPreview` and build preview data**

In `ReviewStep.tsx`, add the import and call `buildSystemPreview` with the form state.

**Note:** `CatalogFormState` currently has no `name` field. The preview input omits `name`, so `buildSystemPreview` falls back to computing `brand + model` via the `resolveValue` fallback. This matches what the approval API actually sends downstream (the create helpers compute name from brand+model when no override is provided). If a `name` field is later added to the form state, this call should pass it through.

```typescript
import { buildSystemPreview } from "@/lib/catalog-preview";

// Inside the component, after readiness:
const systemPreviews = buildSystemPreview(
  {
    category: state.category,
    brand: state.brand,
    model: state.model,
    // CatalogFormState has no `name` field — preview falls back to brand+model,
    // which matches what the approval API actually sends downstream.
    description: state.description,
    sku: state.sku,
    vendorName: state.vendorName,
    vendorPartNumber: state.vendorPartNumber,
    unitLabel: state.unitLabel,
    sellPrice: state.sellPrice ? Number(state.sellPrice) : null,
    unitCost: state.unitCost ? Number(state.unitCost) : null,
    specValues: state.specValues,
  },
  state.systems,
);
```

- [ ] **Step 2: Replace the "System Sync Preview" section**

Replace the existing readiness section (lines 183-212 of ReviewStep.tsx) with preview cards:

```tsx
{/* Per-System Create Preview */}
{systemPreviews.length > 0 && (
  <div className="space-y-4">
    <h3 className="text-lg font-semibold text-foreground">
      What each system will receive
    </h3>
    {systemPreviews.map((card) => (
      <div
        key={card.system}
        className="bg-surface rounded-xl border border-t-border p-5 shadow-card"
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-block h-2 w-2 rounded-full bg-cyan-500" />
          <h4 className="text-sm font-semibold text-foreground">
            {card.system === "ZOHO"
              ? "Zoho Inventory"
              : card.system === "HUBSPOT"
                ? "HubSpot"
                : "Zuper"}
          </h4>
          <span className="text-xs text-muted">
            — {card.fields.filter((f) => !f.missing).length} of{" "}
            {card.fields.length} fields populated
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          {card.fields.map((field) => (
            <div
              key={field.externalField}
              className="flex items-baseline justify-between py-1 border-b border-t-border/30 last:border-0"
            >
              <span className={`text-xs ${field.missing ? "text-amber-400" : "text-muted"}`}>
                {field.label}
              </span>
              <span
                className={`text-xs font-mono ml-2 truncate max-w-[200px] ${
                  field.missing
                    ? "text-amber-400/60 italic"
                    : "text-foreground"
                }`}
                title={field.value != null ? String(field.value) : undefined}
              >
                {field.missing ? "not set" : formatPreviewValue(field.value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 3: Add the `formatPreviewValue` helper**

Add above the component:

```typescript
function formatPreviewValue(value: string | number | null): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") {
    // Format prices with $ prefix
    return String(value);
  }
  return String(value).length > 40 ? `${String(value).slice(0, 37)}...` : String(value);
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "ReviewStep\|catalog-preview"`
Expected: No errors in these files

- [ ] **Step 5: Commit**

```bash
git add src/components/catalog/ReviewStep.tsx
git commit -m "feat: replace readiness indicators with per-system payload preview cards"
```

---

### Task 3: Show missing/transformed field highlights

**Files:**
- Modify: `src/lib/catalog-preview.ts`
- Modify: `src/__tests__/lib/catalog-preview.test.ts`

Add a `transformed` flag for fields where the value will be modified before reaching the external system (e.g., Zuper category → UID). The preview shows the raw internal value with a visual indicator that it will be mapped, rather than attempting to resolve the final value (which would require async API calls). This is honest: the user sees what they entered and knows the system will transform it.

- [ ] **Step 1: Write the failing test**

```typescript
it("marks category as transformed for Zuper (category UID resolution)", () => {
  const cards = buildSystemPreview(baseInput, new Set(["ZUPER"]));
  const zuper = cards[0];
  const cat = zuper.fields.find((f) => f.externalField === "category");
  expect(cat).toBeDefined();
  expect(cat!.transformed).toBe(true);
});

it("marks push-only fields", () => {
  const cards = buildSystemPreview(baseInput, new Set(["HUBSPOT"]));
  const hs = cards[0];
  const cat = hs.fields.find((f) => f.externalField === "product_category");
  expect(cat).toBeDefined();
  expect(cat!.pushOnly).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/lib/catalog-preview.test.ts --no-coverage`
Expected: FAIL — `transformed` and `pushOnly` properties don't exist on `PreviewField`

- [ ] **Step 3: Add `transformed` and `pushOnly` to PreviewField and builder**

In `catalog-preview.ts`, update the `PreviewField` interface:

```typescript
export interface PreviewField {
  label: string;
  externalField: string;
  value: string | number | null;
  missing?: boolean;
  /** True when the value will be transformed before reaching the system (e.g., category UID). */
  transformed?: boolean;
  /** True when this field is push-only (cannot be pulled back). */
  pushOnly?: boolean;
}
```

In `buildFieldsForSystem`, set these flags from the edge:

```typescript
fields.push({
  label,
  externalField: edge.externalField,
  value,
  missing: value === null || value === undefined || value === "",
  transformed: !!edge.transform,
  pushOnly: edge.direction === "push-only",
});
```

- [ ] **Step 4: Update ReviewStep rendering for transformed/pushOnly fields**

In `ReviewStep.tsx`, update the field value rendering to show transformed fields honestly:

```tsx
<span
  className={`text-xs font-mono ml-2 truncate max-w-[200px] ${
    field.missing
      ? "text-amber-400/60 italic"
      : "text-foreground"
  }`}
  title={field.value != null ? String(field.value) : undefined}
>
  {field.missing ? "not set" : formatPreviewValue(field.value)}
  {field.transformed && (
    <span className="ml-1 text-[10px] text-amber-400/70 font-sans" title="This value will be mapped to a system-specific ID before sync">
      → mapped
    </span>
  )}
  {field.pushOnly && (
    <span className="ml-1 text-[10px] text-muted/50 font-sans" title="This field is push-only and cannot be pulled back">
      (one-way)
    </span>
  )}
</span>
```

This replaces the simpler `formatPreviewValue` rendering from Task 2 Step 2. The `→ mapped` indicator tells the user the raw value they see will be transformed to a system ID during actual sync.

- [ ] **Step 5: Run tests**

Run: `npx jest src/__tests__/lib/catalog-preview.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 6: Verify TypeScript**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "ReviewStep\|catalog-preview"`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/lib/catalog-preview.ts src/__tests__/lib/catalog-preview.test.ts src/components/catalog/ReviewStep.tsx
git commit -m "feat: add transformed/push-only indicators to preview cards"
```

---

## Chunk 3: Approval Dashboard Preview

### Task 4: Add preview cards to the admin approval view

**Files:**
- Modify: `src/app/dashboards/catalog/page.tsx` (the Pending Approvals tab)

The admin approval dashboard lists `PendingCatalogPush` records. When an admin is about to approve, they should see what each system will receive — the same preview cards from ReviewStep, but built from the `PendingCatalogPush` record data instead of form state.

- [ ] **Step 1: Import `buildSystemPreview` in the catalog dashboard**

Add import at the top of `src/app/dashboards/catalog/page.tsx`:

```typescript
import { buildSystemPreview } from "@/lib/catalog-preview";
```

- [ ] **Step 2: Build preview data from PendingCatalogPush record**

Where the approval UI renders each pending request, compute the preview:

```typescript
// PendingCatalogPush has `name` as a top-level field (display name override).
// `metadata` is for category-specific spec values only.
const preview = buildSystemPreview(
  {
    category: request.category,
    brand: request.brand,
    model: request.model,
    name: request.name,
    description: request.description,
    sku: request.sku,
    vendorName: request.vendorName,
    vendorPartNumber: request.vendorPartNumber,
    unitLabel: request.unitLabel,
    sellPrice: request.sellPrice,
    unitCost: request.unitCost,
    specValues: (request.metadata as Record<string, unknown>) ?? {},
  },
  new Set(request.systems),
);
```

- [ ] **Step 3: Render preview cards in the approval detail view**

Add a collapsible "Preview what each system will receive" section between the request details and the approve/reject buttons. Reuse the same card layout from ReviewStep:

```tsx
{preview.length > 0 && (
  <details className="mt-4">
    <summary className="text-sm font-medium text-cyan-400 cursor-pointer hover:text-cyan-300">
      Preview what each system will receive ({preview.length} system{preview.length > 1 ? "s" : ""})
    </summary>
    <div className="mt-3 space-y-3">
      {preview.map((card) => (
        <div key={card.system} className="rounded-lg border border-t-border bg-surface-2 p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-500" />
            <span className="text-xs font-semibold text-foreground">
              {card.system === "ZOHO" ? "Zoho" : card.system === "HUBSPOT" ? "HubSpot" : "Zuper"}
            </span>
            <span className="text-xs text-muted">
              — {card.fields.filter((f) => !f.missing).length}/{card.fields.length} fields
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            {card.fields.map((f) => (
              <div key={f.externalField} className="flex justify-between text-xs py-0.5">
                <span className={f.missing ? "text-amber-400" : "text-muted"}>{f.label}</span>
                <span className={`font-mono ml-2 truncate max-w-[140px] ${f.missing ? "text-amber-400/60 italic" : "text-foreground"}`}>
                  {f.missing ? "—" : f.value != null ? String(f.value) : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  </details>
)}
```

- [ ] **Step 4: Verify TypeScript**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "catalog/page"`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/catalog/page.tsx
git commit -m "feat: add per-system preview cards to approval dashboard"
```

---

## Chunk 4: Verification

### Task 5: Run full test suite and build

**Files:** None (verification only)

- [ ] **Step 1: Run all catalog-related tests**

Run: `npx jest --testPathPatterns="catalog" --no-coverage`
Expected: All tests pass (ignore pre-existing `catalog-sync.test.ts` Zuper field naming failure)

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`
Expected: Only pre-existing errors (not in our files)

- [ ] **Step 3: Run lint**

Run: `npx eslint src/lib/catalog-preview.ts src/components/catalog/ReviewStep.tsx`
Expected: No errors

- [ ] **Step 4: Final commit with all passing**

```bash
git add -A
git commit -m "chore: verify approval window preview implementation"
```
