# IDR Meeting BOM Review & Line Item Editor — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible "BOM Review" section to the IDR meeting ProjectDetail panel with line item presets/catalog add (direct HubSpot writes) and a BOM extraction editor (review/edit planset-extracted BOM, optional push).

**Architecture:** Two independent sub-features sharing a collapsible container. Feature 1 (line item quick actions) writes directly to HubSpot line items via presets + catalog search. Feature 2 (BOM extraction editor) shows Claude-extracted BOM from planset PDFs, with inline editing and optional push via the existing `pushBomToHubSpotLineItems()` pipeline. Pre-extraction runs during session creation for IDR items; on-demand for escalations.

**Tech Stack:** Next.js API routes, React Query, HubSpot CRM API (line items), Google Drive API (planset download), Anthropic Files API (BOM extraction), Prisma (ProjectBomSnapshot, InternalProduct)

**Spec:** `docs/superpowers/specs/2026-05-19-idr-bom-line-item-editor-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `src/lib/idr-line-item-presets.ts` | Preset definitions: label, SKU, defaultQty for backup switch/gateway/TRM |
| `src/app/dashboards/idr-meeting/BomReviewSection.tsx` | Collapsible container with two sub-sections (line items + BOM editor) |
| `src/app/dashboards/idr-meeting/LineItemQuickActions.tsx` | Preset buttons, module count +/-, current line items list |
| `src/app/dashboards/idr-meeting/AddLineItemDialog.tsx` | Catalog search popover for adding arbitrary products as line items |
| `src/app/dashboards/idr-meeting/BomExtractionEditor.tsx` | BOM table editor: inline editing, add/remove rows, save snapshot, push to HubSpot |
| `src/lib/idr-bom-extract.ts` | Extraction orchestration: folder → planset → download → extract → save snapshot |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/hubspot.ts` | Add `updateLineItemQuantity()` helper |
| `src/app/api/idr-meeting/line-items/[dealId]/route.ts` | Add POST handler (create line item from InternalProduct) |
| `src/app/dashboards/idr-meeting/ProjectDetail.tsx` | Import + render `<BomReviewSection>` below Equipment section |
| `src/app/api/idr-meeting/sessions/route.ts` | Trigger BOM extraction for IDR (non-escalation) items after session creation |

---

## Chunk 1: Backend — HubSpot helpers + POST API route

### Task 1: Add `updateLineItemQuantity()` to hubspot.ts

**Files:**
- Modify: `src/lib/hubspot.ts` (after `createDealLineItem` around line 2995)

- [ ] **Step 1: Add the helper function**

Add after the `createDealLineItem` function (around line 2995, after the association fallback block):

```ts
/**
 * Update a line item's quantity via PATCH.
 * Used by the IDR meeting module count adjuster.
 */
export async function updateLineItemQuantity(
  lineItemId: string,
  quantity: number,
): Promise<void> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN is not configured");
  if (!lineItemId) throw new Error("lineItemId is required");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("quantity must be > 0");

  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/line_items/${encodeURIComponent(lineItemId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: { quantity: String(Math.round(quantity * 1000) / 1000) },
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to update line item quantity (${res.status}): ${text.slice(0, 300)}`);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to `updateLineItemQuantity`

- [ ] **Step 3: Commit**

```bash
git add src/lib/hubspot.ts
git commit -m "feat(idr-meeting): add updateLineItemQuantity helper for module count adjustment"
```

### Task 2: Add POST handler to line-items API route

**Files:**
- Modify: `src/app/api/idr-meeting/line-items/[dealId]/route.ts`

- [ ] **Step 1: Read the existing file**

Read `src/app/api/idr-meeting/line-items/[dealId]/route.ts` — it currently has only a GET handler.

- [ ] **Step 2: Add POST handler**

Add imports for `prisma` and `createDealLineItem`, then add the POST function after the GET:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { fetchLineItemsForDeal, createDealLineItem } from "@/lib/hubspot";
import { prisma } from "@/lib/db";

// ... existing GET handler stays unchanged ...

/**
 * POST /api/idr-meeting/line-items/[dealId]
 *
 * Creates a HubSpot line item on the deal from an InternalProduct.
 * Body: { internalProductId: string, quantity?: number }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { dealId } = await params;
  const body = await req.json().catch(() => ({})) as {
    internalProductId?: string;
    quantity?: number;
  };

  const { internalProductId, quantity = 1 } = body;
  if (!internalProductId) {
    return NextResponse.json({ error: "internalProductId is required" }, { status: 400 });
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ error: "quantity must be > 0" }, { status: 400 });
  }

  // Look up the InternalProduct
  const product = await prisma.internalProduct.findUnique({
    where: { id: internalProductId },
    select: {
      id: true,
      brand: true,
      model: true,
      name: true,
      description: true,
      sku: true,
      hubspotProductId: true,
      unitCost: true,
      sellPrice: true,
    },
  });

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
  if (!product.hubspotProductId) {
    return NextResponse.json(
      { error: "Product has no HubSpot product ID — sync it first" },
      { status: 422 },
    );
  }

  const displayName = product.name || `${product.brand} ${product.model}`.trim();

  const result = await createDealLineItem({
    dealId,
    name: displayName,
    quantity,
    description: product.description ?? undefined,
    sku: product.sku ?? undefined,
    hubspotProductId: product.hubspotProductId,
    unitPrice: product.sellPrice ?? product.unitCost ?? undefined,
  });

  return NextResponse.json({
    success: true,
    lineItem: {
      id: result.lineItemId,
      name: displayName,
      quantity,
      hubspotProductId: product.hubspotProductId,
    },
  });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/app/api/idr-meeting/line-items/[dealId]/route.ts
git commit -m "feat(idr-meeting): add POST handler for creating deal line items from catalog"
```

### Task 3: Create preset configuration

**Files:**
- Create: `src/lib/idr-line-item-presets.ts`

- [ ] **Step 1: Look up actual SKUs for the preset products**

Search the InternalProduct catalog for backup switch, backup gateway, and TRM products:

```bash
npx prisma studio
# or query directly:
# SELECT id, brand, model, sku, "hubspotProductId" FROM "InternalProduct"
# WHERE (model ILIKE '%backup switch%' OR model ILIKE '%backup gateway%' OR model ILIKE '%trm%')
# AND "isActive" = true;
```

Alternative — use the catalog search API:
```bash
curl -s "http://localhost:3000/api/catalog/search?q=backup+switch" -H "Cookie: ..." | jq '.[].{id,brand,model,sku}'
curl -s "http://localhost:3000/api/catalog/search?q=backup+gateway" -H "Cookie: ..." | jq '.[].{id,brand,model,sku}'
curl -s "http://localhost:3000/api/catalog/search?q=trm" -H "Cookie: ..." | jq '.[].{id,brand,model,sku}'
```

- [ ] **Step 2: Create the presets file**

```ts
// src/lib/idr-line-item-presets.ts

export interface LineItemPreset {
  /** Button label shown in UI */
  label: string;
  /** InternalProduct ID for lookup (cuid) */
  internalProductId: string;
  /** Default quantity when adding */
  defaultQty: number;
  /** Optional icon hint for the UI */
  icon?: "shield" | "server" | "zap";
}

/**
 * Quick-add presets for the IDR meeting line item section.
 * Each maps to a known InternalProduct. IDs populated from catalog query.
 *
 * To add a new preset: find the product in /dashboards/catalog, copy its ID,
 * and add an entry here.
 */
export const LINE_ITEM_PRESETS: LineItemPreset[] = [
  {
    label: "Backup Switch",
    internalProductId: "TODO_POPULATE_FROM_CATALOG",
    defaultQty: 1,
    icon: "shield",
  },
  {
    label: "Backup Gateway",
    internalProductId: "TODO_POPULATE_FROM_CATALOG",
    defaultQty: 1,
    icon: "server",
  },
  {
    label: "TRM",
    internalProductId: "TODO_POPULATE_FROM_CATALOG",
    defaultQty: 1,
    icon: "zap",
  },
];
```

Note: The `internalProductId` values must be populated from the actual catalog query in Step 1. The POST API uses `internalProductId` (not SKU) so the lookup is a direct `findUnique` — faster and unambiguous.

- [ ] **Step 3: Commit**

```bash
git add src/lib/idr-line-item-presets.ts
git commit -m "feat(idr-meeting): add line item preset config for backup switch/gateway/TRM"
```

---

## Chunk 2: Frontend — Line Item Quick Actions

### Task 4: Create LineItemQuickActions component

**Files:**
- Create: `src/app/dashboards/idr-meeting/LineItemQuickActions.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/app/dashboards/idr-meeting/LineItemQuickActions.tsx
"use client";

import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useToast } from "@/contexts/ToastContext";
import { LINE_ITEM_PRESETS, type LineItemPreset } from "@/lib/idr-line-item-presets";

interface LineItem {
  name: string;
  quantity: number;
  manufacturer: string;
  productCategory: string;
  sku: string;
  price: number;
  amount: number;
  hubspotProductId?: string;
  id?: string;
}

interface Props {
  dealId: string;
  lineItems: LineItem[] | undefined;
  isLoading: boolean;
  onOpenCatalogSearch: () => void;
}

export function LineItemQuickActions({ dealId, lineItems, isLoading, onOpenCatalogSearch }: Props) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [addingPreset, setAddingPreset] = useState<string | null>(null);

  const lineItemKey = [...queryKeys.idrMeeting.root, "lineItems", dealId];

  const addPresetMutation = useMutation({
    mutationFn: async (preset: LineItemPreset) => {
      setAddingPreset(preset.label);
      const res = await fetch(`/api/idr-meeting/line-items/${dealId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          internalProductId: preset.internalProductId,
          quantity: preset.defaultQty,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (_data, preset) => {
      addToast({ type: "success", title: `Added ${preset.label}` });
      queryClient.invalidateQueries({ queryKey: lineItemKey });
    },
    onError: (err: Error, preset) => {
      addToast({ type: "error", title: `Failed to add ${preset.label}: ${err.message}` });
    },
    onSettled: () => setAddingPreset(null),
  });

  // Check if a preset's product already exists in the line items
  const isPresetOnDeal = useCallback(
    (preset: LineItemPreset) => {
      if (!lineItems) return false;
      // Match by checking if the preset label appears in any line item name (case-insensitive)
      const label = preset.label.toLowerCase();
      return lineItems.some((li) => li.name.toLowerCase().includes(label));
    },
    [lineItems],
  );

  // Find module line items for +/- count
  const moduleItems = lineItems?.filter(
    (li) => li.productCategory?.toUpperCase() === "MODULE" || li.name?.toLowerCase().includes("module"),
  ) ?? [];
  const totalModuleQty = moduleItems.reduce((sum, li) => sum + li.quantity, 0);

  return (
    <div className="space-y-2">
      {/* Preset buttons */}
      <div className="flex flex-wrap gap-1.5">
        {LINE_ITEM_PRESETS.map((preset) => {
          const onDeal = isPresetOnDeal(preset);
          const isAdding = addingPreset === preset.label;
          return (
            <button
              key={preset.label}
              onClick={() => addPresetMutation.mutate(preset)}
              disabled={isAdding}
              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors
                ${onDeal
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                  : "bg-surface-2 text-foreground hover:bg-surface-2/80 border border-t-border"
                }
                disabled:opacity-50`}
            >
              {isAdding ? (
                <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
              ) : onDeal ? (
                <span>✓</span>
              ) : (
                <span>+</span>
              )}
              {preset.label}
            </button>
          );
        })}

        {/* Module count adjuster */}
        {moduleItems.length > 0 && (
          <ModuleCountAdjuster
            dealId={dealId}
            moduleItems={moduleItems}
            totalQty={totalModuleQty}
            lineItemKey={lineItemKey}
          />
        )}

        {/* Add from catalog */}
        <button
          onClick={onOpenCatalogSearch}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium
            bg-surface-2 text-muted hover:text-foreground hover:bg-surface-2/80 border border-t-border transition-colors"
        >
          + Add Item…
        </button>
      </div>

      {/* Current line items list */}
      <div className="space-y-0.5">
        {isLoading && <div className="h-4 w-48 rounded bg-surface-2 animate-pulse" />}
        {lineItems && lineItems.length > 0 ? (
          lineItems.map((li, i) => (
            <div key={i} className="flex items-center justify-between text-xs text-foreground">
              <span className="truncate">{li.name}</span>
              <span className="text-muted ml-2 shrink-0">x{li.quantity}</span>
            </div>
          ))
        ) : lineItems ? (
          <p className="text-xs text-muted">No line items on deal</p>
        ) : null}
      </div>
    </div>
  );
}

/* ── Module count +/- sub-component ─────────────────────────────────────── */

function ModuleCountAdjuster({
  dealId,
  moduleItems,
  totalQty,
  lineItemKey,
}: {
  dealId: string;
  moduleItems: LineItem[];
  totalQty: number;
  lineItemKey: unknown[];
}) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [adjusting, setAdjusting] = useState(false);

  const adjust = useCallback(
    async (delta: number) => {
      // Adjust the first module line item's quantity
      const target = moduleItems[0];
      if (!target?.id) {
        addToast({ type: "error", title: "Cannot adjust — line item ID not available" });
        return;
      }
      const newQty = Math.max(1, target.quantity + delta);
      if (newQty === target.quantity) return;

      setAdjusting(true);
      try {
        const res = await fetch(`/api/idr-meeting/line-items/${dealId}/quantity`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lineItemId: target.id, quantity: newQty }),
        });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        addToast({ type: "success", title: `Module count → ${newQty}` });
        queryClient.invalidateQueries({ queryKey: lineItemKey });
      } catch (err) {
        addToast({ type: "error", title: err instanceof Error ? err.message : "Failed to adjust" });
      } finally {
        setAdjusting(false);
      }
    },
    [moduleItems, dealId, addToast, queryClient, lineItemKey],
  );

  return (
    <div className="inline-flex items-center gap-0.5 rounded border border-t-border bg-surface-2 px-1">
      <button
        onClick={() => adjust(-1)}
        disabled={adjusting || totalQty <= 1}
        className="px-1 py-0.5 text-xs text-muted hover:text-foreground disabled:opacity-30"
      >
        −
      </button>
      <span className="px-1 text-xs font-medium text-foreground">
        {adjusting ? "…" : totalQty} modules
      </span>
      <button
        onClick={() => adjust(1)}
        disabled={adjusting}
        className="px-1 py-0.5 text-xs text-muted hover:text-foreground disabled:opacity-30"
      >
        +
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors (may show warnings about unused `patchQty` import — that's fine, it gets used in the PATCH route added next)

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/idr-meeting/LineItemQuickActions.tsx
git commit -m "feat(idr-meeting): add LineItemQuickActions with presets and module count adjuster"
```

### Task 5: Add PATCH endpoint for module count adjustment

**Files:**
- Create: `src/app/api/idr-meeting/line-items/[dealId]/quantity/route.ts`

- [ ] **Step 1: Create the PATCH route**

```ts
// src/app/api/idr-meeting/line-items/[dealId]/quantity/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { updateLineItemQuantity } from "@/lib/hubspot";

/**
 * PATCH /api/idr-meeting/line-items/[dealId]/quantity
 *
 * Updates a line item's quantity. Used by the module count +/- buttons.
 * Body: { lineItemId: string, quantity: number }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // dealId is available for context/logging but not strictly needed for the PATCH
  await params;

  const body = await req.json().catch(() => ({})) as {
    lineItemId?: string;
    quantity?: number;
  };

  const { lineItemId, quantity } = body;
  if (!lineItemId) {
    return NextResponse.json({ error: "lineItemId is required" }, { status: 400 });
  }
  if (!quantity || !Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ error: "quantity must be > 0" }, { status: 400 });
  }

  await updateLineItemQuantity(lineItemId, quantity);
  return NextResponse.json({ success: true, quantity });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/idr-meeting/line-items/[dealId]/quantity/route.ts
git commit -m "feat(idr-meeting): add PATCH endpoint for module count adjustment"
```

### Task 6: Create AddLineItemDialog component

**Files:**
- Create: `src/app/dashboards/idr-meeting/AddLineItemDialog.tsx`

- [ ] **Step 1: Create the dialog**

```tsx
// src/app/dashboards/idr-meeting/AddLineItemDialog.tsx
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useToast } from "@/contexts/ToastContext";

interface CatalogProduct {
  id: string;
  category: string;
  brand: string;
  model: string;
  description: string | null;
  sku: string | null;
  unitSpec: number | null;
  unitLabel: string | null;
  hubspotProductId: string | null;
}

interface Props {
  dealId: string;
  open: boolean;
  onClose: () => void;
}

export function AddLineItemDialog({ dealId, open, onClose }: Props) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const debounceRef = useRef<NodeJS.Timeout>();

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelectedId(null);
      setQuantity(1);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounced search
  const handleSearch = useCallback((q: string) => {
    setQuery(q);
    setSelectedId(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(q.trim())}`);
        if (res.ok) {
          const data = await res.json() as CatalogProduct[];
          setResults(data);
        }
      } catch {
        // silent
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("No product selected");
      const res = await fetch(`/api/idr-meeting/line-items/${dealId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ internalProductId: selectedId, quantity }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      const selected = results.find((r) => r.id === selectedId);
      addToast({ type: "success", title: `Added ${selected?.brand} ${selected?.model}` });
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.idrMeeting.root, "lineItems", dealId],
      });
      onClose();
    },
    onError: (err: Error) => {
      addToast({ type: "error", title: err.message });
    },
  });

  if (!open) return null;

  const selected = results.find((r) => r.id === selectedId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-t-border bg-surface p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-foreground mb-3">Add Line Item from Catalog</h3>

        {/* Search input */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search products by brand, model, or SKU…"
          className="w-full rounded border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground
            placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-orange-500/50"
        />

        {/* Results */}
        <div className="mt-2 max-h-48 overflow-y-auto space-y-0.5">
          {searching && <p className="text-xs text-muted p-2">Searching…</p>}
          {!searching && query.length >= 2 && results.length === 0 && (
            <p className="text-xs text-muted p-2">No products found</p>
          )}
          {results.map((product) => (
            <button
              key={product.id}
              onClick={() => setSelectedId(product.id)}
              className={`w-full text-left rounded px-2 py-1.5 text-xs transition-colors
                ${selectedId === product.id
                  ? "bg-orange-500/10 border border-orange-500/30"
                  : "hover:bg-surface-2 border border-transparent"
                }`}
            >
              <div className="font-medium text-foreground">
                {product.brand} {product.model}
              </div>
              <div className="text-muted">
                {product.category} {product.sku ? `· ${product.sku}` : ""}
                {!product.hubspotProductId && " · ⚠ No HubSpot ID"}
              </div>
            </button>
          ))}
        </div>

        {/* Quantity + Add */}
        {selected && (
          <div className="mt-3 flex items-center gap-2">
            <label className="text-xs text-muted">Qty:</label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-16 rounded border border-t-border bg-surface-2 px-2 py-1 text-xs text-foreground text-center"
            />
            <button
              onClick={() => addMutation.mutate()}
              disabled={addMutation.isPending || !selected.hubspotProductId}
              className="ml-auto rounded bg-orange-500 px-3 py-1.5 text-xs font-medium text-white
                hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {addMutation.isPending ? "Adding…" : "Add to Deal"}
            </button>
          </div>
        )}

        {/* Close */}
        <button
          onClick={onClose}
          className="mt-3 w-full rounded border border-t-border py-1.5 text-xs text-muted hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/idr-meeting/AddLineItemDialog.tsx
git commit -m "feat(idr-meeting): add catalog search dialog for adding arbitrary line items"
```

---

## Chunk 3: Backend — BOM Extraction Orchestration

### Task 7: Create BOM extraction orchestration module

**Files:**
- Create: `src/lib/idr-bom-extract.ts`

This module handles the extraction flow: folder URL → folder ID → planset search → download → Claude extraction → save snapshot. Used by both session prep (fire-and-forget) and on-demand (awaited with progress).

- [ ] **Step 1: Create the module**

```ts
// src/lib/idr-bom-extract.ts

import { extractFolderId, listPlansetPdfs, pickBestPlanset, downloadDrivePdf } from "@/lib/drive-plansets";
import { extractBomFromPdf } from "@/lib/bom-extract";
import { saveBomSnapshot, type BomData } from "@/lib/bom-snapshot";
import type { ActorContext } from "@/lib/actor-context";

export type BomExtractionStatus = "idle" | "pending" | "extracting" | "ready" | "failed";

export interface BomExtractionResult {
  status: BomExtractionStatus;
  snapshotId?: string;
  error?: string;
  itemCount?: number;
}

/**
 * Run BOM extraction for a deal: find planset in design folder, extract via Claude,
 * and save as a ProjectBomSnapshot.
 *
 * Used by:
 * - Session prep (fire-and-forget for IDR items)
 * - On-demand button (awaited for escalations)
 */
export async function extractBomForDeal(params: {
  dealId: string;
  dealName: string;
  designFolderUrl: string | null;
  actor: ActorContext;
}): Promise<BomExtractionResult> {
  const { dealId, dealName, designFolderUrl, actor } = params;

  // Step 1: Validate folder URL
  if (!designFolderUrl) {
    return { status: "failed", error: "No design folder linked to deal" };
  }

  const folderId = extractFolderId(designFolderUrl);
  if (!folderId) {
    return { status: "failed", error: "Cannot parse folder ID from design folder URL" };
  }

  // Step 2: Find planset PDF
  let files;
  try {
    files = await listPlansetPdfs(folderId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("403") || msg.includes("forbidden")) {
      return { status: "failed", error: "Drive access denied — check service account permissions" };
    }
    return { status: "failed", error: `Failed to list drive files: ${msg.slice(0, 200)}` };
  }

  const planset = pickBestPlanset(files);
  if (!planset) {
    return { status: "failed", error: "No planset PDF found in design folder" };
  }

  // Step 3: Download
  let buffer: Buffer;
  let filename: string;
  try {
    const downloaded = await downloadDrivePdf(planset.id);
    buffer = downloaded.buffer;
    filename = downloaded.filename;
  } catch (err) {
    return { status: "failed", error: `Failed to download planset: ${(err as Error).message?.slice(0, 200)}` };
  }

  // Step 4: Extract BOM via Claude
  let bomResult;
  try {
    bomResult = await extractBomFromPdf(buffer, filename, actor);
  } catch (err) {
    return { status: "failed", error: `BOM extraction failed: ${(err as Error).message?.slice(0, 200)}` };
  }

  // Cast the untyped bom record to BomData
  const bomPayload = bomResult?.bom as BomData | undefined;
  if (!bomPayload?.items || bomPayload.items.length === 0) {
    return { status: "failed", error: "Extraction returned no items" };
  }

  // Step 5: Save snapshot
  const bomData: BomData = {
    project: bomPayload.project ?? {},
    items: bomPayload.items,
    validation: bomPayload.validation,
  };

  try {
    const snapshot = await saveBomSnapshot({
      dealId,
      dealName,
      bomData,
      sourceFile: filename,
      actor,
    });

    return {
      status: "ready",
      snapshotId: snapshot.id,
      itemCount: bomResult.bom.items.length,
    };
  } catch (err) {
    return { status: "failed", error: `Failed to save snapshot: ${(err as Error).message?.slice(0, 200)}` };
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

Note: The `extractBomFromPdf` return type includes a `bom` field with `project`, `items`, and `validation`. Verify the actual return shape at `src/lib/bom-extract.ts` — look for the `BomExtractionResult` type. Adjust field access if the return structure differs.

- [ ] **Step 3: Commit**

```bash
git add src/lib/idr-bom-extract.ts
git commit -m "feat(idr-meeting): add BOM extraction orchestration module"
```

### Task 8: Create on-demand extraction API endpoint

**Files:**
- Create: `src/app/api/idr-meeting/bom-extract/[dealId]/route.ts`

- [ ] **Step 1: Create the route**

```ts
// src/app/api/idr-meeting/bom-extract/[dealId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { extractBomForDeal } from "@/lib/idr-bom-extract";
import { prisma } from "@/lib/db";

export const maxDuration = 120; // extraction can take 60s+

/**
 * POST /api/idr-meeting/bom-extract/[dealId]
 *
 * On-demand BOM extraction for escalation items or re-extractions.
 * Body: { dealName: string, designFolderUrl: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { dealId } = await params;
  const body = await req.json().catch(() => ({})) as {
    dealName?: string;
    designFolderUrl?: string;
  };

  const result = await extractBomForDeal({
    dealId,
    dealName: body.dealName || `Deal ${dealId}`,
    designFolderUrl: body.designFolderUrl || null,
    actor: {
      email: auth.email,
      name: auth.name ?? auth.email,
    },
  });

  if (result.status === "failed") {
    return NextResponse.json({ ...result }, { status: 422 });
  }

  return NextResponse.json(result);
}

/**
 * GET /api/idr-meeting/bom-extract/[dealId]
 *
 * Returns the latest BOM snapshot for the deal, if any.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { dealId } = await params;

  const snapshot = await prisma.projectBomSnapshot.findFirst({
    where: { dealId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      version: true,
      bomData: true,
      sourceFile: true,
      savedBy: true,
      createdAt: true,
    },
  });

  if (!snapshot) {
    return NextResponse.json({ snapshot: null });
  }

  return NextResponse.json({ snapshot });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/idr-meeting/bom-extract/[dealId]/route.ts
git commit -m "feat(idr-meeting): add BOM extraction API with GET (snapshot) and POST (extract)"
```

### Task 9: Wire pre-extraction into session creation

**Files:**
- Modify: `src/app/api/idr-meeting/sessions/route.ts`

- [ ] **Step 1: Read the sessions route**

Read `src/app/api/idr-meeting/sessions/route.ts` to understand the full POST flow. The extraction should fire after session + items are created, as fire-and-forget (don't block session creation response).

- [ ] **Step 2: Add extraction trigger**

At the end of the POST handler (after all items are created and response is about to be returned), add fire-and-forget extraction for IDR items:

```ts
// Add import at top of file:
import { extractBomForDeal } from "@/lib/idr-bom-extract";

// After all items are created, before the final return, add:

// ── Fire-and-forget BOM extraction for IDR items ──
// Escalation items skip auto-extraction (on-demand only).
const idrItemsWithFolder = items.filter(
  (item) => item.type === "IDR" && item.designFolderUrl,
);
if (idrItemsWithFolder.length > 0) {
  const extractionActor = { email: auth.email, name: auth.name ?? auth.email };

  // Import waitUntil lazily for Vercel edge runtime
  try {
    const { waitUntil } = await import("@vercel/functions");
    waitUntil(
      Promise.allSettled(
        idrItemsWithFolder.map((item) =>
          extractBomForDeal({
            dealId: item.dealId,
            dealName: item.dealName ?? `Deal ${item.dealId}`,
            designFolderUrl: item.designFolderUrl,
            actor: extractionActor,
          }).catch((err) => {
            console.error(`[idr-session] BOM extraction failed for deal ${item.dealId}:`, err);
          }),
        ),
      ),
    );
  } catch {
    // waitUntil not available (local dev) — run inline but don't block response
    Promise.allSettled(
      idrItemsWithFolder.map((item) =>
        extractBomForDeal({
          dealId: item.dealId,
          dealName: item.dealName ?? `Deal ${item.dealId}`,
          designFolderUrl: item.designFolderUrl,
          actor: extractionActor,
        }).catch((err) => {
          console.error(`[idr-session] BOM extraction failed for deal ${item.dealId}:`, err);
        }),
      ),
    );
  }
}
```

Place this block just before the final `return NextResponse.json({ session, items })`.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/idr-meeting/sessions/route.ts
git commit -m "feat(idr-meeting): trigger BOM pre-extraction for IDR items on session creation"
```

---

## Chunk 4: Frontend — BOM Extraction Editor

### Task 10: Create BomExtractionEditor component

**Files:**
- Create: `src/app/dashboards/idr-meeting/BomExtractionEditor.tsx`

- [ ] **Step 1: Create the component**

This is the BOM table editor with inline editing, extraction status, save, and push. Pattern follows the BOM dashboard's `updateItem` / `deleteItem` / `addRow` pattern but in a compact layout.

```tsx
// src/app/dashboards/idr-meeting/BomExtractionEditor.tsx
"use client";

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useToast } from "@/contexts/ToastContext";
import type { IdrItem } from "./IdrMeetingClient";

interface BomItem {
  id: string; // client-side ID
  category: string;
  brand: string | null;
  model: string | null;
  description: string;
  qty: number | string;
  unitSpec?: number | string | null;
  unitLabel?: string | null;
  source?: string;
  flags?: string[];
  confirmed?: boolean; // local UI state
}

interface BomSnapshot {
  id: string;
  version: number;
  bomData: {
    project: Record<string, unknown>;
    items: Omit<BomItem, "id" | "confirmed">[];
    validation?: Record<string, unknown>;
  };
  sourceFile: string | null;
  savedBy: string | null;
  createdAt: string;
}

interface Props {
  item: IdrItem;
  readOnly: boolean;
}

let nextId = 1;
function assignIds(items: Omit<BomItem, "id" | "confirmed">[]): BomItem[] {
  return items.map((it) => ({ ...it, id: String(nextId++), confirmed: false }));
}

const CATEGORIES = [
  "MODULE", "INVERTER", "BATTERY", "BATTERY_EXPANSION",
  "EV_CHARGER", "RACKING", "ELECTRICAL_BOS", "MONITORING", "RAPID_SHUTDOWN",
] as const;

export function BomExtractionEditor({ item, readOnly }: Props) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [bomItems, setBomItems] = useState<BomItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);

  // Fetch existing snapshot
  const snapshotQuery = useQuery({
    queryKey: [...queryKeys.idrMeeting.root, "bomSnapshot", item.dealId],
    queryFn: async () => {
      const res = await fetch(`/api/idr-meeting/bom-extract/${item.dealId}`);
      if (!res.ok) throw new Error("Failed to fetch BOM snapshot");
      return res.json() as Promise<{ snapshot: BomSnapshot | null }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Load snapshot into editor on first fetch
  if (snapshotQuery.data?.snapshot && !loaded) {
    const snap = snapshotQuery.data.snapshot;
    setBomItems(assignIds(snap.bomData.items));
    setSnapshotId(snap.id);
    setLoaded(true);
  }

  // ── Inline editing ──
  const updateItem = useCallback((id: string, field: keyof BomItem, value: string | number | null) => {
    setBomItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)),
    );
  }, []);

  const deleteItem = useCallback((id: string) => {
    setBomItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const toggleConfirm = useCallback((id: string) => {
    setBomItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, confirmed: !it.confirmed } : it)),
    );
  }, []);

  const addRow = useCallback(() => {
    setBomItems((prev) => [
      ...prev,
      {
        id: String(nextId++),
        category: "ELECTRICAL_BOS",
        brand: "",
        model: "",
        description: "",
        qty: 1,
        confirmed: false,
      },
    ]);
  }, []);

  // ── On-demand extraction ──
  const handleExtract = useCallback(async () => {
    setExtracting(true);
    try {
      const res = await fetch(`/api/idr-meeting/bom-extract/${item.dealId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealName: item.dealName,
          designFolderUrl: item.designFolderUrl,
        }),
      });
      const data = await res.json() as { status: string; snapshotId?: string; error?: string; itemCount?: number };
      if (data.status === "failed") {
        addToast({ type: "error", title: data.error || "Extraction failed" });
        return;
      }
      addToast({ type: "success", title: `Extracted ${data.itemCount ?? 0} items` });
      setSnapshotId(data.snapshotId || null);
      // Refetch snapshot to populate editor
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.idrMeeting.root, "bomSnapshot", item.dealId],
      });
      setLoaded(false); // allow reload from new snapshot
    } catch (err) {
      addToast({ type: "error", title: err instanceof Error ? err.message : "Extraction failed" });
    } finally {
      setExtracting(false);
    }
  }, [item.dealId, item.dealName, item.designFolderUrl, addToast, queryClient]);

  // ── Save snapshot ──
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/bom/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: item.dealId,
          dealName: item.dealName,
          bomData: {
            project: {},
            items: bomItems.map(({ id, confirmed, ...rest }) => rest),
          },
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      const data = await res.json() as { id?: string };
      setSnapshotId(data.id || null);
      addToast({ type: "success", title: "BOM snapshot saved" });
    } catch (err) {
      addToast({ type: "error", title: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }, [item.dealId, item.dealName, bomItems, addToast]);

  // ── Push to HubSpot ──
  const handlePush = useCallback(async () => {
    // Save first if needed, then push
    setPushing(true);
    try {
      // Ensure we have a saved snapshot
      let currentSnapshotId = snapshotId;
      if (!currentSnapshotId) {
        const saveRes = await fetch("/api/bom/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dealId: item.dealId,
            dealName: item.dealName,
            bomData: {
              project: {},
              items: bomItems.map(({ id, confirmed, ...rest }) => rest),
            },
          }),
        });
        if (!saveRes.ok) throw new Error("Failed to save snapshot before push");
        const saveData = await saveRes.json() as { snapshotId?: string };
        currentSnapshotId = saveData.snapshotId || null;
        setSnapshotId(currentSnapshotId);
      }

      if (!currentSnapshotId) throw new Error("No snapshot ID available");

      const res = await fetch("/api/bom/push-to-hubspot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: item.dealId,
          snapshotId: currentSnapshotId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || `Push failed (${res.status})`);
      }
      addToast({ type: "success", title: "BOM pushed to HubSpot line items" });
      // Refresh line items
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.idrMeeting.root, "lineItems", item.dealId],
      });
    } catch (err) {
      addToast({ type: "error", title: err instanceof Error ? err.message : "Push failed" });
    } finally {
      setPushing(false);
    }
  }, [item.dealId, item.dealName, bomItems, snapshotId, addToast, queryClient]);

  const hasSnapshot = snapshotQuery.data?.snapshot != null || bomItems.length > 0;
  const isEscalation = item.type === "ESCALATION";

  // ── No snapshot + no extraction yet ──
  if (!hasSnapshot && !snapshotQuery.isLoading) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={handleExtract}
          disabled={extracting || !item.designFolderUrl}
          className="rounded bg-cyan-500/10 border border-cyan-500/30 px-2.5 py-1.5 text-xs font-medium
            text-cyan-400 hover:bg-cyan-500/20 disabled:opacity-50 transition-colors"
        >
          {extracting ? "Extracting…" : "Extract BOM"}
        </button>
        {!item.designFolderUrl && (
          <span className="text-[10px] text-muted">No design folder linked</span>
        )}
        {extracting && (
          <span className="text-[10px] text-muted">Reading planset with Claude (~30-60s)…</span>
        )}
      </div>
    );
  }

  if (snapshotQuery.isLoading) {
    return <div className="h-8 w-48 rounded bg-surface-2 animate-pulse" />;
  }

  // ── Editor ──
  return (
    <div className="space-y-2">
      {/* Status bar */}
      <div className="flex items-center gap-2 text-[10px] text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {bomItems.length} items
        </span>
        {snapshotQuery.data?.snapshot?.sourceFile && (
          <span>from {snapshotQuery.data.snapshot.sourceFile}</span>
        )}
        <button
          onClick={handleExtract}
          disabled={extracting}
          className="ml-auto text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
        >
          {extracting ? "Extracting…" : "Re-extract"}
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted text-left">
              <th className="pb-1 pr-2 font-medium">Category</th>
              <th className="pb-1 pr-2 font-medium">Brand / Model</th>
              <th className="pb-1 pr-2 font-medium w-14 text-center">Qty</th>
              <th className="pb-1 font-medium w-16 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {bomItems.map((bi) => (
              <tr
                key={bi.id}
                className={`border-t border-t-border/50 ${bi.confirmed ? "opacity-60" : ""}`}
              >
                <td className="py-1 pr-2">
                  {readOnly ? (
                    <span>{bi.category}</span>
                  ) : (
                    <select
                      value={bi.category}
                      onChange={(e) => updateItem(bi.id, "category", e.target.value)}
                      className="rounded bg-surface-2 px-1 py-0.5 text-xs text-foreground border-none"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="py-1 pr-2">
                  {readOnly ? (
                    <span>{bi.brand} {bi.model}</span>
                  ) : (
                    <div className="flex gap-1">
                      <input
                        value={bi.brand ?? ""}
                        onChange={(e) => updateItem(bi.id, "brand", e.target.value)}
                        placeholder="Brand"
                        className="w-24 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-foreground"
                      />
                      <input
                        value={bi.model ?? ""}
                        onChange={(e) => updateItem(bi.id, "model", e.target.value)}
                        placeholder="Model"
                        className="flex-1 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-foreground"
                      />
                    </div>
                  )}
                </td>
                <td className="py-1 pr-2 text-center">
                  {readOnly ? (
                    <span>{bi.qty}</span>
                  ) : (
                    <input
                      type="number"
                      min={1}
                      value={bi.qty}
                      onChange={(e) => updateItem(bi.id, "qty", parseInt(e.target.value) || 1)}
                      className="w-12 rounded bg-surface-2 px-1 py-0.5 text-xs text-foreground text-center"
                    />
                  )}
                </td>
                <td className="py-1 text-center">
                  {!readOnly && (
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => toggleConfirm(bi.id)}
                        title={bi.confirmed ? "Unconfirm" : "Confirm"}
                        className={`text-xs ${bi.confirmed ? "text-emerald-400" : "text-muted hover:text-emerald-400"}`}
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => deleteItem(bi.id)}
                        title="Remove"
                        className="text-xs text-muted hover:text-red-400"
                      >
                        ✗
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Actions */}
      {!readOnly && (
        <div className="flex items-center gap-2">
          <button
            onClick={addRow}
            className="text-xs text-muted hover:text-foreground"
          >
            + Add Row
          </button>
          <div className="ml-auto flex gap-1.5">
            <button
              onClick={handleSave}
              disabled={saving || bomItems.length === 0}
              className="rounded border border-t-border px-2.5 py-1 text-xs font-medium text-foreground
                hover:bg-surface-2 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Save Snapshot"}
            </button>
            <button
              onClick={handlePush}
              disabled={pushing || bomItems.length === 0}
              className="rounded bg-orange-500/10 border border-orange-500/30 px-2.5 py-1 text-xs font-medium
                text-orange-400 hover:bg-orange-500/20 disabled:opacity-50 transition-colors"
            >
              {pushing ? "Pushing…" : "Push to HubSpot"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

Likely adjustments needed: verify `/api/bom/save` and `/api/bom/push-to-hubspot` accept the request shapes used here. Read those route files to confirm.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/idr-meeting/BomExtractionEditor.tsx
git commit -m "feat(idr-meeting): add BOM extraction editor with inline editing and push"
```

---

## Chunk 5: Integration — BomReviewSection + ProjectDetail wiring

### Task 11: Create BomReviewSection container

**Files:**
- Create: `src/app/dashboards/idr-meeting/BomReviewSection.tsx`

- [ ] **Step 1: Create the collapsible container**

```tsx
// src/app/dashboards/idr-meeting/BomReviewSection.tsx
"use client";

import { useState, useCallback } from "react";
import type { IdrItem } from "./IdrMeetingClient";
import { LineItemQuickActions } from "./LineItemQuickActions";
import { AddLineItemDialog } from "./AddLineItemDialog";
import { BomExtractionEditor } from "./BomExtractionEditor";

interface LineItem {
  name: string;
  quantity: number;
  manufacturer: string;
  productCategory: string;
  sku: string;
  price: number;
  amount: number;
  hubspotProductId?: string;
  id?: string;
}

interface Props {
  item: IdrItem;
  lineItems: LineItem[] | undefined;
  lineItemsLoading: boolean;
  readOnly: boolean;
}

export function BomReviewSection({ item, lineItems, lineItemsLoading, readOnly }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [catalogOpen, setCatalogOpen] = useState(false);

  return (
    <div className="rounded-lg border border-t-border bg-surface-2/50">
      {/* Header — collapsible */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between p-3"
      >
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          BOM Review
        </h3>
        <span className="text-xs text-muted">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-4">
          {/* Line Item Quick Actions */}
          <div>
            <p className="text-[9px] font-medium uppercase tracking-wider text-muted mb-1.5">
              Line Items
            </p>
            <LineItemQuickActions
              dealId={item.dealId}
              lineItems={lineItems}
              isLoading={lineItemsLoading}
              onOpenCatalogSearch={() => setCatalogOpen(true)}
            />
          </div>

          {/* BOM Extraction Editor */}
          <div>
            <p className="text-[9px] font-medium uppercase tracking-wider text-muted mb-1.5">
              BOM Extraction
            </p>
            <BomExtractionEditor item={item} readOnly={readOnly} />
          </div>
        </div>
      )}

      {/* Catalog search dialog */}
      <AddLineItemDialog
        dealId={item.dealId}
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/idr-meeting/BomReviewSection.tsx
git commit -m "feat(idr-meeting): add BomReviewSection collapsible container"
```

### Task 12: Wire BomReviewSection into ProjectDetail

**Files:**
- Modify: `src/app/dashboards/idr-meeting/ProjectDetail.tsx`

- [ ] **Step 1: Read the ProjectDetail file**

Read `src/app/dashboards/idr-meeting/ProjectDetail.tsx` to find the exact location of the Equipment section (around lines 339-357) and understand the current `lineItemsQuery` usage.

- [ ] **Step 2: Add import**

At the top of the file, add:

```ts
import { BomReviewSection } from "./BomReviewSection";
```

- [ ] **Step 3: Add BomReviewSection below Equipment section**

Find the closing `</Section>` tag after the Equipment section (around line 357). After it, add:

```tsx
{/* BOM Review */}
<BomReviewSection
  item={item}
  lineItems={lineItemsQuery.data?.lineItems}
  lineItemsLoading={lineItemsQuery.isLoading}
  readOnly={readOnly}
/>
```

The existing `lineItemsQuery` in ProjectDetail already fetches line items for the deal — reuse it. The `readOnly` prop is already a prop of ProjectDetail.

**Important**: The `lineItemsQuery` type annotation in ProjectDetail (line ~62) must be widened to include `id` and `hubspotProductId` fields — the data is already returned by `fetchLineItemsForDeal` at runtime, but the TypeScript type omits them. Update the type cast in the `queryFn` to:

```ts
return res.json() as Promise<{ lineItems: Array<{
  id: string; name: string; quantity: number; manufacturer: string;
  productCategory: string; sku: string; price: number; amount: number;
  hubspotProductId: string | null;
}> }>;
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 5: Verify the app renders**

Run: `npm run dev` and navigate to the IDR meeting page. Open a project detail view and confirm:
- BOM Review section appears below Equipment
- Preset buttons render
- Line items list shows
- BOM extraction section shows (either "Extract BOM" button or loaded snapshot)

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboards/idr-meeting/ProjectDetail.tsx
git commit -m "feat(idr-meeting): wire BomReviewSection into ProjectDetail"
```

---

## Chunk 6: Verification + Polish

### Task 13: End-to-end verification

- [ ] **Step 1: Verify preset add flow**

1. Open IDR meeting, select a project
2. Click "Add Backup Switch" preset
3. Confirm toast shows "Added Backup Switch"
4. Confirm the line items list refreshes and shows the new item
5. Click the same preset again — confirm the button shows ✓ (already on deal)

- [ ] **Step 2: Verify catalog search flow**

1. Click "Add Item…" button
2. Search for a known product (e.g., "Enphase")
3. Select a product, set quantity to 2
4. Click "Add to Deal"
5. Confirm toast and line items list update

- [ ] **Step 3: Verify module count adjustment**

1. Find a project with module line items
2. Click +/- buttons
3. Confirm quantity updates in the line items list

- [ ] **Step 4: Verify BOM extraction (on-demand)**

1. Open an escalation item
2. Click "Extract BOM"
3. Wait ~30-60s for extraction
4. Confirm BOM table populates with extracted items
5. Edit a quantity, change a brand
6. Click "Save Snapshot" — confirm toast

- [ ] **Step 5: Verify BOM push (optional)**

1. With a BOM loaded, click "Push to HubSpot"
2. Confirm line items list updates with new items
3. Check HubSpot deal to verify line items were created

- [ ] **Step 6: Run TypeScript check**

```bash
npx tsc --noEmit --pretty
```

- [ ] **Step 7: Run lint**

```bash
npm run lint
```

- [ ] **Step 8: Fix any issues and commit**

```bash
git add -A
git commit -m "fix(idr-meeting): address lint and type issues from BOM review integration"
```

### Task 14: Populate preset product IDs

- [ ] **Step 1: Query the catalog for real product IDs**

This must be done at implementation time against the live database:

```bash
# Connect to the database or use the running app
curl -s "http://localhost:3000/api/catalog/search?q=backup+switch" | jq '.[0].id'
curl -s "http://localhost:3000/api/catalog/search?q=backup+gateway" | jq '.[0].id'
curl -s "http://localhost:3000/api/catalog/search?q=trm" | jq '.[0].id'
```

- [ ] **Step 2: Update the presets file**

Replace the `TODO_POPULATE_FROM_CATALOG` values in `src/lib/idr-line-item-presets.ts` with the actual `id` values from the catalog query.

- [ ] **Step 3: Commit**

```bash
git add src/lib/idr-line-item-presets.ts
git commit -m "feat(idr-meeting): populate preset product IDs from catalog"
```
