# Preferred-Vendor PO Splitting Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-split BOM items by their Zoho Inventory preferred vendor and create one draft Purchase Order per vendor, with a UI preview and partial-failure retry.

**Architecture:** Shared library (`bom-po-create.ts`) holds all grouping and PO creation logic, consumed by the preview route, the creation route, and the pipeline. Schema migrates from a single `zohoPoId` string to a `zohoPurchaseOrders` JSON array. Frozen-grouping semantics prevent drift on retry.

**Tech Stack:** Next.js 16 API routes, Prisma 7 on Neon Postgres, Zoho Inventory REST API, React 19 UI

**Spec:** `docs/superpowers/specs/2026-03-18-preferred-vendor-po-splitting-design.md`

---

## Chunk 1: Data Layer — Schema, Migration, and Zoho Client

### Task 1: Add `vendor_id` and `vendor_name` to `findItemIdByName()` return type

**Files:**
- Modify: `src/lib/zoho-inventory.ts:634-686`
- Test: `src/__tests__/lib/bom-po-create.test.ts` (created in Task 4)

The method has 7 non-null return sites. Each constructs `{ item_id, zohoName, zohoSku }` from the matched `ZohoInventoryItem`. Add `vendor_id` and `vendor_name` from the same matched item.

- [ ] **Step 1: Update the return type signature**

In `src/lib/zoho-inventory.ts:634`, change:

```ts
async findItemIdByName(query: string): Promise<{ item_id: string; zohoName: string; zohoSku?: string } | null> {
```

to:

```ts
async findItemIdByName(query: string): Promise<{ item_id: string; zohoName: string; zohoSku?: string; vendor_id?: string; vendor_name?: string } | null> {
```

- [ ] **Step 2: Update all 7 non-null return sites**

Each return site follows the same pattern. For each one, add `vendor_id` and `vendor_name` from the matched item variable. The matched variable name differs per site:

**Line 646** (static override match — variable `hit`):
```ts
return hit ? { item_id: hit.item_id, zohoName: hit.name, zohoSku: hit.sku, vendor_id: hit.vendor_id, vendor_name: hit.vendor_name } : null;
```

**Line 654** (exact name — variable `exactName`):
```ts
if (exactName) return { item_id: exactName.item_id, zohoName: exactName.name, zohoSku: exactName.sku, vendor_id: exactName.vendor_id, vendor_name: exactName.vendor_name };
```

**Line 658** (exact SKU — variable `exactSku`):
```ts
if (exactSku) return { item_id: exactSku.item_id, zohoName: exactSku.name, zohoSku: exactSku.sku, vendor_id: exactSku.vendor_id, vendor_name: exactSku.vendor_name };
```

**Line 663** (SKU contains — variable `skuContains`):
```ts
if (skuContains) return { item_id: skuContains.item_id, zohoName: skuContains.name, zohoSku: skuContains.sku, vendor_id: skuContains.vendor_id, vendor_name: skuContains.vendor_name };
```

**Line 672** (query contains SKU — variable `queryContainsSku`):
```ts
if (queryContainsSku) return { item_id: queryContainsSku.item_id, zohoName: queryContainsSku.name, zohoSku: queryContainsSku.sku, vendor_id: queryContainsSku.vendor_id, vendor_name: queryContainsSku.vendor_name };
```

**Line 676** (name contains — variable `nameContains`):
```ts
if (nameContains) return { item_id: nameContains.item_id, zohoName: nameContains.name, zohoSku: nameContains.sku, vendor_id: nameContains.vendor_id, vendor_name: nameContains.vendor_name };
```

**Line 683** (query contains name — variable `queryContains`):
```ts
if (queryContains) return { item_id: queryContains.item_id, zohoName: queryContains.name, zohoSku: queryContains.sku, vendor_id: queryContains.vendor_id, vendor_name: queryContains.vendor_name };
```

Line 685 (`return null`) stays unchanged.

- [ ] **Step 3: Verify build passes**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No errors related to `findItemIdByName` return type. Existing callers accept the wider type since the new fields are optional.

- [ ] **Step 4: Commit**

```bash
git add src/lib/zoho-inventory.ts
git commit -m "feat: add vendor_id/vendor_name to findItemIdByName return"
```

---

### Task 2: Prisma schema — replace `zohoPoId` with `zohoPurchaseOrders`, add `CREATE_PO` step

**Files:**
- Modify: `prisma/schema.prisma` (ProjectBomSnapshot model ~line 1026, BomPipelineStep enum ~line 1147)

- [ ] **Step 1: Update `ProjectBomSnapshot` model**

In `prisma/schema.prisma`, in the `ProjectBomSnapshot` model, replace:

```prisma
  zohoPoId    String?
```

with:

```prisma
  zohoPurchaseOrders Json?
```

- [ ] **Step 2: Add `CREATE_PO` to `BomPipelineStep` enum**

In the `BomPipelineStep` enum, add `CREATE_PO` between `CREATE_SO` and `NOTIFY`:

```prisma
enum BomPipelineStep {
  FETCH_DEAL
  LIST_PDFS
  EXTRACT_BOM
  SAVE_SNAPSHOT
  RESOLVE_CUSTOMER
  CREATE_SO
  CREATE_PO
  NOTIFY
}
```

- [ ] **Step 3: Create the migration**

Run: `npx prisma migrate dev --name replace-zoho-po-id-with-purchase-orders --create-only`
Expected: Creates a migration SQL file without applying it. We need to add data migration SQL.

- [ ] **Step 4: Edit migration SQL to include data migration**

Open the generated migration file in `prisma/migrations/<timestamp>_replace_zoho_po_id_with_purchase_orders/migration.sql`. Before the column drop, add data migration:

```sql
-- Step 1: Add new column
ALTER TABLE "ProjectBomSnapshot" ADD COLUMN "zohoPurchaseOrders" JSONB;

-- Step 2: Migrate existing zohoPoId data to JSON array format
UPDATE "ProjectBomSnapshot"
SET "zohoPurchaseOrders" = jsonb_build_array(
  jsonb_build_object(
    'vendorId', 'unknown',
    'vendorName', 'Unknown (migrated)',
    'poId', "zohoPoId",
    'poNumber', null::text,
    'itemCount', 0
  )
)
WHERE "zohoPoId" IS NOT NULL;

-- Step 3: Drop old column
ALTER TABLE "ProjectBomSnapshot" DROP COLUMN "zohoPoId";

-- Step 4: Add CREATE_PO to BomPipelineStep enum
ALTER TYPE "BomPipelineStep" ADD VALUE 'CREATE_PO';
```

**Note:** Prisma may generate some of these statements automatically. Review what Prisma generated and merge your data migration step (the UPDATE statement) into the right position. The key requirement is: the UPDATE must run AFTER `zohoPurchaseOrders` is added and BEFORE `zohoPoId` is dropped.

- [ ] **Step 5: Apply the migration**

Run: `npx prisma migrate dev`
Expected: Migration applies successfully. Verify with: `npx prisma migrate status`

- [ ] **Step 6: Regenerate Prisma client**

Run: `npx prisma generate`
Expected: No errors. The generated types now have `zohoPurchaseOrders: Prisma.JsonValue | null` instead of `zohoPoId: string | null`.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: replace zohoPoId with zohoPurchaseOrders JSON, add CREATE_PO pipeline step"
```

---

### Task 3: Fix downstream references to `zohoPoId`

**Files:**
- Modify: `src/app/api/bom/history/route.ts:48`
- Modify: `src/lib/product-updates.ts:248-255` (changelog strings only)

- [ ] **Step 1: Update history route select**

In `src/app/api/bom/history/route.ts:48`, replace:

```ts
      zohoPoId: true,
```

with:

```ts
      zohoPurchaseOrders: true,
```

- [ ] **Step 2: Update product-updates.ts changelog strings**

In `src/lib/product-updates.ts`, find lines referencing `zohoPoId` (around lines 248-255). These are changelog description strings. Update them to reference `zohoPurchaseOrders` instead. These are string-only changes — no functional code changes needed.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -i "zohoPoId" | head -10`
Expected: No type errors referencing `zohoPoId`. (Generated Prisma files will be regenerated and won't reference the old field.)

**Note:** The following files will have compile errors at this point — that's intentional:
- `src/app/dashboards/bom/page.tsx` (7 refs) → rewritten in Task 7
- `src/app/api/bom/create-po/route.ts` (5 refs) → rewritten in Task 6
- `src/__tests__/api/bom-create-po.test.ts` (4 refs) → rewritten in Task 6

The build is intentionally broken between Tasks 2-3 and Tasks 6-7. Do NOT run full builds until Task 7 is complete.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/bom/history/route.ts src/lib/product-updates.ts
git commit -m "fix: update downstream zohoPoId references to zohoPurchaseOrders"
```

---

## Chunk 2: Shared Library — `bom-po-create.ts`

### Task 4: Create `bom-po-create.ts` with types, `resolvePoVendorGroups`, and `createPurchaseOrders`

**Files:**
- Create: `src/lib/bom-po-create.ts`
- Create: `src/__tests__/lib/bom-po-create.test.ts`

This is the core of the feature. Pattern follows `src/lib/bom-so-create.ts`.

- [ ] **Step 1: Write the test file**

Create `src/__tests__/lib/bom-po-create.test.ts`:

```ts
/**
 * Tests for bom-po-create.ts — vendor grouping, merging, reference number, PO creation.
 *
 * Tests:
 *  1. resolvePoVendorGroups groups items by vendor_id from Zoho matches
 *  2. Items with no Zoho match go to unassigned with reason 'no_zoho_match'
 *  3. Items matched but no vendor go to unassigned with reason 'no_vendor'
 *  4. Zero/negative qty items are skipped entirely
 *  5. mergeUnassignedIntoVendor merges into existing vendor group
 *  6. mergeUnassignedIntoVendor creates new group for unknown vendor
 *  7. buildReferenceNumber extracts PROJ-{id} and truncates vendor name
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockFindItemIdByName = jest.fn();
jest.mock("@/lib/zoho-inventory", () => ({
  zohoInventory: {
    isConfigured: () => true,
    findItemIdByName: (...args: unknown[]) => mockFindItemIdByName(...args),
    createPurchaseOrder: jest.fn(),
  },
}));

// Mock buildBomSearchTerms to return deterministic single-element arrays.
// The real function returns multiple search terms per item, which would
// cause mockResolvedValueOnce ordering to break.
jest.mock("@/lib/bom-search-terms", () => ({
  buildBomSearchTerms: (input: { brand?: string | null; model?: string | null; description?: string | null }) => {
    const name = input.model
      ? input.brand ? `${input.brand} ${input.model}` : input.model
      : input.description;
    return name ? [name] : [];
  },
}));

const mockUpdate = jest.fn();
jest.mock("@/lib/db", () => ({
  prisma: {
    projectBomSnapshot: {
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
  logActivity: jest.fn(async () => {}),
}));

import {
  resolvePoVendorGroups,
  mergeUnassignedIntoVendor,
  buildReferenceNumber,
  type PoGroupingResult,
} from "@/lib/bom-po-create";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBomData(items: Array<Record<string, unknown>>) {
  return {
    project: { address: "123 Solar St" },
    items,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── resolvePoVendorGroups ────────────────────────────────────────────────────

describe("resolvePoVendorGroups", () => {
  it("groups items by vendor_id from Zoho match", async () => {
    // Each BOM item produces one search term (via mocked buildBomSearchTerms),
    // so one mockResolvedValueOnce per item is correct.
    mockFindItemIdByName
      .mockResolvedValueOnce({
        item_id: "z1", zohoName: "QCell 400W", zohoSku: "QC-400",
        vendor_id: "v-qcell", vendor_name: "QCells",
      })
      .mockResolvedValueOnce({
        item_id: "z2", zohoName: "Enphase IQ8+", zohoSku: "EN-IQ8",
        vendor_id: "v-enphase", vendor_name: "Enphase",
      })
      .mockResolvedValueOnce({
        item_id: "z3", zohoName: "QCell 500W", zohoSku: "QC-500",
        vendor_id: "v-qcell", vendor_name: "QCells",
      });

    const bomData = makeBomData([
      { category: "MODULE", brand: "QCell", model: "Q.PEAK-400", description: "400W module", qty: 32 },
      { category: "INVERTER", brand: "Enphase", model: "IQ8+", description: "Microinverter", qty: 32 },
      { category: "MODULE", brand: "QCell", model: "Q.PEAK-500", description: "500W module", qty: 10 },
    ]);

    const result: PoGroupingResult = await resolvePoVendorGroups(bomData);

    expect(result.vendorGroups).toHaveLength(2);

    const qcellGroup = result.vendorGroups.find(g => g.vendorId === "v-qcell");
    expect(qcellGroup).toBeDefined();
    expect(qcellGroup!.vendorName).toBe("QCells");
    expect(qcellGroup!.items).toHaveLength(2);

    const enphaseGroup = result.vendorGroups.find(g => g.vendorId === "v-enphase");
    expect(enphaseGroup).toBeDefined();
    expect(enphaseGroup!.items).toHaveLength(1);

    expect(result.unassignedItems).toHaveLength(0);
  });

  it("puts items with no Zoho match into unassigned with reason 'no_zoho_match'", async () => {
    mockFindItemIdByName.mockResolvedValue(null);

    const bomData = makeBomData([
      { category: "MODULE", brand: "Unknown", model: "XYZ-999", description: "Mystery panel", qty: 10 },
    ]);

    const result = await resolvePoVendorGroups(bomData);

    expect(result.vendorGroups).toHaveLength(0);
    expect(result.unassignedItems).toHaveLength(1);
    expect(result.unassignedItems[0].reason).toBe("no_zoho_match");
  });

  it("puts items matched but with no vendor into unassigned with reason 'no_vendor'", async () => {
    mockFindItemIdByName.mockResolvedValue({
      item_id: "z1", zohoName: "Generic Wire", zohoSku: "GW-1",
      vendor_id: undefined, vendor_name: undefined,
    });

    const bomData = makeBomData([
      { category: "ELECTRICAL_BOS", brand: null, model: null, description: "Generic Wire", qty: 5 },
    ]);

    const result = await resolvePoVendorGroups(bomData);

    expect(result.vendorGroups).toHaveLength(0);
    expect(result.unassignedItems).toHaveLength(1);
    expect(result.unassignedItems[0].reason).toBe("no_vendor");
    expect(result.unassignedItems[0].zohoItemId).toBe("z1");
    expect(result.unassignedItems[0].zohoName).toBe("Generic Wire");
  });

  it("skips items with zero or negative quantity", async () => {
    mockFindItemIdByName.mockResolvedValue({
      item_id: "z1", zohoName: "Module", vendor_id: "v1", vendor_name: "V1",
    });

    const bomData = makeBomData([
      { category: "MODULE", brand: "A", model: "B", description: "C", qty: 0 },
      { category: "MODULE", brand: "A", model: "D", description: "E", qty: -5 },
    ]);

    const result = await resolvePoVendorGroups(bomData);

    expect(result.vendorGroups).toHaveLength(0);
    expect(result.unassignedItems).toHaveLength(0);
    // findItemIdByName should not even be called for zero-qty items
    expect(mockFindItemIdByName).not.toHaveBeenCalled();
  });
});

// ── mergeUnassignedIntoVendor ────────────────────────────────────────────────

describe("mergeUnassignedIntoVendor", () => {
  it("merges items with zohoItemId into an existing vendor group", () => {
    const input: PoGroupingResult = {
      vendorGroups: [
        { vendorId: "v1", vendorName: "Vendor 1", items: [
          { bomName: "Panel", zohoName: "Panel", zohoItemId: "z1", quantity: 10, description: "Solar panel" },
        ]},
      ],
      unassignedItems: [
        { name: "Wire", quantity: 5, description: "Wire", zohoItemId: "z2", zohoName: "Wire", reason: "no_vendor" },
      ],
    };

    const result = mergeUnassignedIntoVendor(input, "v1", "Vendor 1");

    expect(result.vendorGroups).toHaveLength(1);
    expect(result.vendorGroups[0].items).toHaveLength(2);
    expect(result.unassignedItems).toHaveLength(0);
    // Original should not be mutated
    expect(input.vendorGroups[0].items).toHaveLength(1);
  });

  it("creates a new vendor group when vendorId is not in existing groups", () => {
    const input: PoGroupingResult = {
      vendorGroups: [
        { vendorId: "v1", vendorName: "Vendor 1", items: [
          { bomName: "Panel", zohoName: "Panel", zohoItemId: "z1", quantity: 10, description: "Solar panel" },
        ]},
      ],
      unassignedItems: [
        { name: "Wire", quantity: 5, description: "Wire", zohoItemId: "z2", zohoName: "Wire", reason: "no_vendor" },
        { name: "Mystery", quantity: 1, description: "Mystery", reason: "no_zoho_match" }, // no zohoItemId — stays unassigned
      ],
    };

    const result = mergeUnassignedIntoVendor(input, "v-new", "New Vendor");

    expect(result.vendorGroups).toHaveLength(2);
    const newGroup = result.vendorGroups.find(g => g.vendorId === "v-new");
    expect(newGroup).toBeDefined();
    expect(newGroup!.items).toHaveLength(1);
    expect(newGroup!.items[0].bomName).toBe("Wire");
    // Items without zohoItemId remain unassigned
    expect(result.unassignedItems).toHaveLength(1);
    expect(result.unassignedItems[0].name).toBe("Mystery");
  });
});

// ── buildReferenceNumber ─────────────────────────────────────────────────────

describe("buildReferenceNumber", () => {
  it("extracts PROJ-{id} from full deal name and builds reference", () => {
    const ref = buildReferenceNumber("PROJ-1234 Smith - 123 Solar St", 2, "QCells");
    expect(ref).toBe("PROJ-1234 V2 — QCells");
    expect(ref.length).toBeLessThanOrEqual(50);
  });

  it("truncates vendor name with ellipsis when too long", () => {
    const ref = buildReferenceNumber("PROJ-7832 Very Long Deal Name Here", 1, "SunPower Solar Equipment Wholesale Distribution Inc");
    expect(ref.length).toBeLessThanOrEqual(50);
    expect(ref).toMatch(/^PROJ-7832 V1 — /);
    expect(ref).toMatch(/…$/);
  });

  it("falls back to first 20 chars of dealName when no PROJ- match", () => {
    const ref = buildReferenceNumber("Custom Deal Name Without Project ID", 1, "QCells");
    expect(ref).toMatch(/^Custom Deal Name With/);
    expect(ref.length).toBeLessThanOrEqual(50);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx jest src/__tests__/lib/bom-po-create.test.ts --no-coverage 2>&1 | tail -20`
Expected: FAIL — `Cannot find module '@/lib/bom-po-create'`

- [ ] **Step 3: Create `src/lib/bom-po-create.ts`**

```ts
/**
 * BOM → Purchase Order Creation — Shared Logic
 *
 * Splits BOM items by their Zoho Inventory preferred vendor and creates
 * one draft Purchase Order per vendor. Used by:
 *   - GET  /api/bom/po-preview  (preview grouping)
 *   - POST /api/bom/create-po   (create POs)
 *   - BOM pipeline orchestrator  (automated)
 *
 * Handles: vendor grouping, frozen-grouping idempotency, sequential PO
 * creation with persist-as-you-go, and partial-failure recovery.
 *
 * Callers provide an ActorContext for audit logging — routes build it from
 * requireApiAuth(), the pipeline uses PIPELINE_ACTOR.
 */

import { zohoInventory } from "@/lib/zoho-inventory";
import { logActivity, prisma } from "@/lib/db";
import { buildBomSearchTerms } from "@/lib/bom-search-terms";
import type { ActorContext } from "@/lib/actor-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single BOM item as stored in bomData.items */
export interface BomDataItem {
  category: string;
  brand?: string | null;
  model?: string | null;
  description: string;
  qty: number | string;
}

/** Parsed bomData shape (subset of the full JSON blob) */
export interface BomData {
  project?: { address?: string };
  items?: BomDataItem[];
  /** Frozen vendor grouping — persisted after first successful PO */
  poVendorGroups?: PoVendorGroup[];
}

/** One line item in a vendor PO group */
export interface PoLineItem {
  bomName: string;
  zohoName: string;
  zohoSku?: string;
  zohoItemId: string;
  quantity: number;
  description: string;
}

/** A group of items for one vendor */
export interface PoVendorGroup {
  vendorId: string;
  vendorName: string;
  items: PoLineItem[];
}

/** An item that couldn't be assigned to a vendor */
export interface UnassignedItem {
  name: string;
  quantity: number;
  description: string;
  zohoItemId?: string;
  zohoName?: string;
  reason: "no_zoho_match" | "no_vendor";
}

/** Result of resolving BOM items into vendor groups */
export interface PoGroupingResult {
  vendorGroups: PoVendorGroup[];
  unassignedItems: UnassignedItem[];
}

/** A single persisted PO entry in the snapshot JSON */
export interface ZohoPurchaseOrderEntry {
  vendorId: string;
  vendorName: string;
  poId: string;
  poNumber: string | null;
  itemCount: number;
}

/** Options for createPurchaseOrders */
export interface CreatePosOptions {
  snapshotId: string;
  bomData: BomData;
  vendorGroups: PoVendorGroup[];
  existingPos: ZohoPurchaseOrderEntry[];
  dealName: string;
  version: number;
  address?: string;
  actor: ActorContext;
}

/** Result of PO creation attempt */
export interface CreatePosResult {
  created: ZohoPurchaseOrderEntry[];
  failed: Array<{ vendorId: string; vendorName: string; error: string }>;
  skippedExisting: ZohoPurchaseOrderEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a Zoho reference_number for a PO, keeping the project prefix intact
 * and truncating the vendor name portion to fit the 50-char limit.
 *
 * Extracts PROJ-{id} from the full deal name (e.g., "PROJ-7832 Smith - 123 Solar St"
 * becomes "PROJ-7832"). Falls back to first 20 chars of dealName if no PROJ- match.
 */
export function buildReferenceNumber(
  dealName: string,
  version: number,
  vendorName: string,
): string {
  const projMatch = dealName.match(/PROJ-\d+/);
  const projId = projMatch ? projMatch[0] : dealName.slice(0, 20);
  const prefix = `${projId} V${version} — `;
  const maxVendor = 50 - prefix.length;
  if (maxVendor <= 0) return projId.slice(0, 50);
  if (vendorName.length <= maxVendor) return prefix + vendorName;
  return prefix + vendorName.slice(0, maxVendor - 1) + "…";
}

// ---------------------------------------------------------------------------
// resolvePoVendorGroups
// ---------------------------------------------------------------------------

/**
 * Match each BOM item to its Zoho Inventory item, then group by preferred vendor.
 *
 * Sequential processing — findItemIdByName uses a shared in-memory cache,
 * so concurrency gives no throughput benefit and risks Zoho rate limits.
 */
export async function resolvePoVendorGroups(
  bomData: BomData,
): Promise<PoGroupingResult> {
  const bomItems = Array.isArray(bomData?.items) ? bomData.items : [];
  const vendorMap = new Map<string, PoVendorGroup>();
  const unassignedItems: UnassignedItem[] = [];

  for (const item of bomItems) {
    // Parse and validate quantity first — skip zero/negative before any lookups
    const parsedQty = Math.round(Number(item.qty));
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) continue;

    const bomName = item.model
      ? `${item.brand ? item.brand + " " : ""}${item.model}`
      : item.description;

    // Build search terms using the shared utility
    const searchTerms = buildBomSearchTerms({
      brand: item.brand,
      model: item.model,
      description: item.description,
    });

    let match: {
      item_id: string;
      zohoName: string;
      zohoSku?: string;
      vendor_id?: string;
      vendor_name?: string;
    } | null = null;

    for (const term of searchTerms) {
      match = await zohoInventory.findItemIdByName(term);
      if (match) break;
    }

    if (!match) {
      unassignedItems.push({
        name: bomName,
        quantity: parsedQty,
        description: item.description,
        reason: "no_zoho_match",
      });
      continue;
    }

    if (!match.vendor_id) {
      unassignedItems.push({
        name: bomName,
        quantity: parsedQty,
        description: item.description,
        zohoItemId: match.item_id,
        zohoName: match.zohoName,
        reason: "no_vendor",
      });
      continue;
    }

    // Group into vendor bucket
    let group = vendorMap.get(match.vendor_id);
    if (!group) {
      group = {
        vendorId: match.vendor_id,
        vendorName: match.vendor_name ?? match.vendor_id,
        items: [],
      };
      vendorMap.set(match.vendor_id, group);
    }

    group.items.push({
      bomName,
      zohoName: match.zohoName,
      zohoSku: match.zohoSku,
      zohoItemId: match.item_id,
      quantity: parsedQty,
      description: item.description,
    });
  }

  return {
    vendorGroups: Array.from(vendorMap.values()),
    unassignedItems,
  };
}

// ---------------------------------------------------------------------------
// mergeUnassignedIntoVendor
// ---------------------------------------------------------------------------

/**
 * Merge unassigned items (that have a zohoItemId) into a specified vendor group.
 * Returns the updated groups and the remaining truly-unassigned items.
 */
export function mergeUnassignedIntoVendor(
  result: PoGroupingResult,
  vendorId: string,
  vendorName: string,
): PoGroupingResult {
  const mergeable: PoLineItem[] = [];
  const remaining: UnassignedItem[] = [];

  for (const item of result.unassignedItems) {
    if (item.zohoItemId) {
      mergeable.push({
        bomName: item.name,
        zohoName: item.zohoName ?? item.name,
        zohoItemId: item.zohoItemId,
        quantity: item.quantity,
        description: item.description,
      });
    } else {
      remaining.push(item);
    }
  }

  if (mergeable.length === 0) return { ...result, unassignedItems: remaining };

  // Find or create the target vendor group
  const groups = [...result.vendorGroups];
  let target = groups.find(g => g.vendorId === vendorId);
  if (!target) {
    target = { vendorId, vendorName, items: [] };
    groups.push(target);
  } else {
    // Clone to avoid mutation
    target = { ...target, items: [...target.items] };
    const idx = groups.findIndex(g => g.vendorId === vendorId);
    groups[idx] = target;
  }
  target.items.push(...mergeable);

  return { vendorGroups: groups, unassignedItems: remaining };
}

// ---------------------------------------------------------------------------
// createPurchaseOrders
// ---------------------------------------------------------------------------

/**
 * Create Zoho draft POs for each vendor group. Persist-as-you-go semantics:
 * each successful PO is immediately written to the snapshot, so partial
 * failures can be retried without re-creating already-created POs.
 *
 * Frozen-grouping rule: when existingPos is non-empty, we use the persisted
 * poVendorGroups from bomData (frozen at first PO creation) rather than the
 * freshly-computed vendorGroups. This prevents vendor assignment drift between
 * retries from moving items between POs.
 */
export async function createPurchaseOrders(
  opts: CreatePosOptions,
): Promise<CreatePosResult> {
  if (!prisma) throw new Error("Database not configured");
  if (!zohoInventory.isConfigured()) throw new Error("Zoho Inventory not configured");

  const { snapshotId, bomData, existingPos, dealName, version, address, actor } = opts;
  let { vendorGroups } = opts;

  // Frozen-grouping: if POs already exist, use the persisted grouping
  if (existingPos.length > 0 && bomData.poVendorGroups) {
    vendorGroups = bomData.poVendorGroups;
  }

  // If this is the first attempt, persist the vendor grouping for future retries
  if (existingPos.length === 0) {
    await prisma.projectBomSnapshot.update({
      where: { id: snapshotId },
      data: {
        bomData: { ...bomData, poVendorGroups: vendorGroups },
      },
    });
  }

  const existingVendorIds = new Set(existingPos.map(p => p.vendorId));
  const created: ZohoPurchaseOrderEntry[] = [];
  const failed: Array<{ vendorId: string; vendorName: string; error: string }> = [];
  // Pass through all previously-created POs for the response.
  // Sequential processing within the loop prevents race conditions on the
  // read-modify-write; concurrent callers for the same snapshot are prevented
  // by the pipeline lock / UI state.
  const skippedExisting = [...existingPos];

  for (const group of vendorGroups) {
    if (existingVendorIds.has(group.vendorId)) continue;

    const refNumber = buildReferenceNumber(dealName, version, group.vendorName);

    try {
      const poResult = await zohoInventory.createPurchaseOrder({
        vendor_id: group.vendorId,
        reference_number: refNumber,
        notes: `Generated from PB Ops BOM v${version}${address ? ` — ${address}` : ""}`,
        status: "draft",
        line_items: group.items.map(item => ({
          item_id: item.zohoItemId,
          name: item.bomName,
          quantity: item.quantity,
          description: item.description,
        })),
      });

      const entry: ZohoPurchaseOrderEntry = {
        vendorId: group.vendorId,
        vendorName: group.vendorName,
        poId: poResult.purchaseorder_id,
        poNumber: poResult.purchaseorder_number,
        itemCount: group.items.length,
      };

      // Persist immediately — read current state, append, write back
      const current = await prisma.projectBomSnapshot.findUnique({
        where: { id: snapshotId },
        select: { zohoPurchaseOrders: true },
      });
      const currentPos = (current?.zohoPurchaseOrders as ZohoPurchaseOrderEntry[] | null) ?? [];
      await prisma.projectBomSnapshot.update({
        where: { id: snapshotId },
        data: { zohoPurchaseOrders: [...currentPos, entry] },
      });

      created.push(entry);

      await logActivity({
        type: "FEATURE_USED",
        description: `Created Zoho PO for ${group.vendorName} (${group.items.length} items) — ${dealName} v${version}`,
        userEmail: actor.email,
        userName: actor.name,
        entityType: "bom",
        entityName: dealName,
        metadata: {
          event: "bom_create_po",
          outcome: "created",
          vendorId: group.vendorId,
          vendorName: group.vendorName,
          poId: poResult.purchaseorder_id,
          poNumber: poResult.purchaseorder_number,
          itemCount: group.items.length,
          version,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        requestPath: actor.requestPath,
        requestMethod: actor.requestMethod,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Zoho API error";
      console.error(`[bom-po-create] PO creation failed for vendor ${group.vendorName}:`, message);
      failed.push({ vendorId: group.vendorId, vendorName: group.vendorName, error: message });

      await logActivity({
        type: "API_ERROR",
        description: `PO creation failed for ${group.vendorName}: ${message}`,
        userEmail: actor.email,
        userName: actor.name,
        entityType: "bom",
        entityName: dealName,
        metadata: {
          event: "bom_create_po",
          outcome: "failed",
          vendorId: group.vendorId,
          vendorName: group.vendorName,
          error: message,
          version,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        requestPath: actor.requestPath,
        requestMethod: actor.requestMethod,
      });
    }
  }

  return { created, failed, skippedExisting };
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/__tests__/lib/bom-po-create.test.ts --no-coverage 2>&1 | tail -30`
Expected: All 9 tests pass (4 for resolvePoVendorGroups, 2 for mergeUnassignedIntoVendor, 3 for buildReferenceNumber).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bom-po-create.ts src/__tests__/lib/bom-po-create.test.ts
git commit -m "feat: add bom-po-create shared library with vendor grouping and PO creation"
```

---

## Chunk 3: API Routes — Preview and Create-PO Rework

### Task 5: Create `GET /api/bom/po-preview` route

**Files:**
- Create: `src/app/api/bom/po-preview/route.ts`

- [ ] **Step 1: Create the route file**

```ts
// src/app/api/bom/po-preview/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { logActivity, prisma } from "@/lib/db";
import { zohoInventory } from "@/lib/zoho-inventory";
import { resolvePoVendorGroups, type BomData } from "@/lib/bom-po-create";

export const runtime = "nodejs";

const ALLOWED_ROLES = new Set([
  "ADMIN",
  "OWNER",
  "MANAGER",           // legacy — normalizes to PROJECT_MANAGER
  "OPERATIONS",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
  "DESIGNER",          // legacy — normalizes to TECH_OPS
  "TECH_OPS",
]);

export async function GET(request: NextRequest) {
  const startedAt = Date.now();

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!ALLOWED_ROLES.has(authResult.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  if (!zohoInventory.isConfigured()) {
    return NextResponse.json({ error: "Zoho Inventory is not configured" }, { status: 503 });
  }

  const dealId = request.nextUrl.searchParams.get("dealId");
  const versionStr = request.nextUrl.searchParams.get("version");
  if (!dealId || !versionStr) {
    return NextResponse.json({ error: "dealId and version are required" }, { status: 400 });
  }
  const version = Number(versionStr);
  if (!Number.isFinite(version)) {
    return NextResponse.json({ error: "version must be a number" }, { status: 400 });
  }

  try {
    const snapshot = await prisma.projectBomSnapshot.findFirst({
      where: { dealId, version },
    });
    if (!snapshot) {
      return NextResponse.json({ error: "BOM snapshot not found" }, { status: 404 });
    }

    const bomData = snapshot.bomData as BomData;
    const result = await resolvePoVendorGroups(bomData);

    await logActivity({
      type: "FEATURE_USED",
      description: `PO preview for ${snapshot.dealName} v${version}: ${result.vendorGroups.length} vendors, ${result.unassignedItems.length} unassigned`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityId: dealId,
      entityName: snapshot.dealName,
      metadata: {
        event: "bom_po_preview",
        dealId,
        version,
        vendorCount: result.vendorGroups.length,
        unassignedCount: result.unassignedItems.length,
      },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/po-preview",
      requestMethod: "GET",
      responseStatus: 200,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[bom/po-preview] Error:", message, e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep po-preview | head -5`
Expected: No errors for the new route.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/bom/po-preview/route.ts
git commit -m "feat: add GET /api/bom/po-preview route for vendor grouping preview"
```

---

### Task 6: Rework `POST /api/bom/create-po` for multi-vendor

**Files:**
- Modify: `src/app/api/bom/create-po/route.ts` (full rewrite)

- [ ] **Step 1: Rewrite the route**

Replace the entire contents of `src/app/api/bom/create-po/route.ts` with:

```ts
// src/app/api/bom/create-po/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { logActivity, prisma } from "@/lib/db";
import {
  resolvePoVendorGroups,
  mergeUnassignedIntoVendor,
  createPurchaseOrders,
  type BomData,
  type ZohoPurchaseOrderEntry,
} from "@/lib/bom-po-create";
import { zohoInventory } from "@/lib/zoho-inventory";

export const runtime = "nodejs";

const ALLOWED_ROLES = new Set([
  "ADMIN",
  "OWNER",
  "MANAGER",           // legacy — normalizes to PROJECT_MANAGER
  "OPERATIONS",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
  "DESIGNER",          // legacy — normalizes to TECH_OPS
  "TECH_OPS",
]);

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!ALLOWED_ROLES.has(authResult.role)) {
    await logActivity({
      type: "API_ERROR",
      description: "BOM create-po denied: insufficient permissions",
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityName: "create_po",
      metadata: { event: "bom_create_po", outcome: "failed", reason: "insufficient_permissions" },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/create-po",
      requestMethod: "POST",
      responseStatus: 403,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  if (!zohoInventory.isConfigured()) {
    return NextResponse.json({ error: "Zoho Inventory is not configured" }, { status: 503 });
  }

  let body: { dealId?: string; version?: number; unassignedVendorId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { dealId, version, unassignedVendorId } = body;
  if (!dealId || typeof version !== "number") {
    return NextResponse.json({ error: "dealId and version are required" }, { status: 400 });
  }

  try {
    // 1. Load snapshot
    const snapshot = await prisma.projectBomSnapshot.findFirst({
      where: { dealId: String(dealId), version },
    });
    if (!snapshot) {
      return NextResponse.json({ error: "BOM snapshot not found" }, { status: 404 });
    }

    const bomData = snapshot.bomData as BomData;
    const existingPos = (snapshot.zohoPurchaseOrders as ZohoPurchaseOrderEntry[] | null) ?? [];

    // 2. Resolve vendor groups (or use frozen grouping on retry)
    let grouping = await resolvePoVendorGroups(bomData);

    // 3. Merge unassigned items into specified vendor if provided
    if (unassignedVendorId) {
      // Look up vendor name from Zoho vendors list
      const vendors = await zohoInventory.listVendors();
      const vendor = vendors.find(v => v.contact_id === unassignedVendorId);
      const vendorName = vendor?.contact_name ?? unassignedVendorId;
      grouping = mergeUnassignedIntoVendor(grouping, unassignedVendorId, vendorName);
    }

    // 4. Create POs
    const actor = {
      email: authResult.email,
      name: authResult.name,
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/create-po",
      requestMethod: "POST",
    };

    const result = await createPurchaseOrders({
      snapshotId: snapshot.id,
      bomData,
      vendorGroups: grouping.vendorGroups,
      existingPos,
      dealName: snapshot.dealName,
      version,
      address: bomData?.project?.address,
      actor,
    });

    // 5. Build response
    const allPos = [...result.skippedExisting, ...result.created];

    await logActivity({
      type: "FEATURE_USED",
      description: `Created ${result.created.length} POs for ${snapshot.dealName} v${version}${result.failed.length > 0 ? ` (${result.failed.length} failed)` : ""}`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityId: String(dealId),
      entityName: snapshot.dealName,
      metadata: {
        event: "bom_create_po",
        outcome: result.failed.length > 0 ? "partial" : "created",
        dealId,
        version,
        createdCount: result.created.length,
        failedCount: result.failed.length,
        skippedCount: result.skippedExisting.length,
      },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/create-po",
      requestMethod: "POST",
      responseStatus: 200,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      purchaseOrders: allPos,
      unassignedItems: grouping.unassignedItems.map(i => ({
        name: i.name,
        qty: i.quantity,
      })),
      failed: result.failed,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[bom/create-po] Unhandled error:", message, e);
    await logActivity({
      type: "API_ERROR",
      description: `BOM create-po unhandled error: ${message}`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityName: "create_po",
      metadata: { event: "bom_create_po", outcome: "failed", reason: "unhandled_exception", error: message },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/create-po",
      requestMethod: "POST",
      responseStatus: 500,
      durationMs: Date.now() - startedAt,
    }).catch(() => {});
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Update the test file**

Rewrite `src/__tests__/api/bom-create-po.test.ts` to test the new multi-vendor behavior:

```ts
/**
 * Tests for POST /api/bom/create-po (multi-vendor version)
 *
 * Tests:
 *  1. Creates POs split by vendor from the shared lib
 *  2. Returns existing POs on retry without re-creating
 *  3. Handles unassignedVendorId merge
 *  4. Returns 400 when dealId or version is missing
 */

jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn(async () => ({
    email: "test@photonbrothers.com",
    name: "Test User",
    role: "ADMIN",
    ip: "127.0.0.1",
    userAgent: "jest",
  })),
}));

const mockResolvePoVendorGroups = jest.fn();
const mockMergeUnassignedIntoVendor = jest.fn();
const mockCreatePurchaseOrders = jest.fn();

jest.mock("@/lib/bom-po-create", () => ({
  resolvePoVendorGroups: (...args: unknown[]) => mockResolvePoVendorGroups(...args),
  mergeUnassignedIntoVendor: (...args: unknown[]) => mockMergeUnassignedIntoVendor(...args),
  createPurchaseOrders: (...args: unknown[]) => mockCreatePurchaseOrders(...args),
}));

const mockFindFirst = jest.fn();
jest.mock("@/lib/db", () => ({
  prisma: {
    projectBomSnapshot: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
  },
  logActivity: jest.fn(async () => {}),
}));

jest.mock("@/lib/zoho-inventory", () => ({
  zohoInventory: {
    isConfigured: () => true,
    listVendors: jest.fn(async () => [
      { contact_id: "v-fallback", contact_name: "Fallback Vendor" },
    ]),
  },
}));

import { POST } from "@/app/api/bom/create-po/route";
import { NextRequest } from "next/server";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/bom/create-po", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockResolvePoVendorGroups.mockResolvedValue({
    vendorGroups: [{ vendorId: "v1", vendorName: "Vendor 1", items: [{ bomName: "Panel", zohoItemId: "z1", quantity: 10, description: "Solar panel" }] }],
    unassignedItems: [],
  });
  mockCreatePurchaseOrders.mockResolvedValue({
    created: [{ vendorId: "v1", vendorName: "Vendor 1", poId: "po-1", poNumber: "PO-001", itemCount: 1 }],
    failed: [],
    skippedExisting: [],
  });
});

describe("POST /api/bom/create-po — multi-vendor", () => {
  it("returns 400 when dealId is missing", async () => {
    const res = await POST(makeRequest({ version: 1 }));
    expect(res.status).toBe(400);
  });

  it("creates POs via shared lib and returns purchaseOrders array", async () => {
    mockFindFirst.mockResolvedValue({
      id: "snap-1", dealId: "d1", dealName: "PROJ-1234", version: 1,
      bomData: { items: [] }, zohoPurchaseOrders: null,
    });

    const res = await POST(makeRequest({ dealId: "d1", version: 1 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.purchaseOrders).toHaveLength(1);
    expect(json.purchaseOrders[0].poId).toBe("po-1");
    expect(mockCreatePurchaseOrders).toHaveBeenCalled();
  });

  it("calls mergeUnassignedIntoVendor when unassignedVendorId is provided", async () => {
    mockFindFirst.mockResolvedValue({
      id: "snap-1", dealId: "d1", dealName: "PROJ-1234", version: 1,
      bomData: { items: [] }, zohoPurchaseOrders: null,
    });
    const mergedResult = {
      vendorGroups: [{ vendorId: "v-fallback", vendorName: "Fallback Vendor", items: [{ bomName: "Wire", zohoItemId: "z1", quantity: 5, description: "Wire" }] }],
      unassignedItems: [],
    };
    mockMergeUnassignedIntoVendor.mockReturnValue(mergedResult);

    const res = await POST(makeRequest({ dealId: "d1", version: 1, unassignedVendorId: "v-fallback" }));
    expect(res.status).toBe(200);
    expect(mockMergeUnassignedIntoVendor).toHaveBeenCalledWith(
      expect.anything(),
      "v-fallback",
      "Fallback Vendor",
    );
  });

  it("passes existing POs to createPurchaseOrders for partial retry", async () => {
    const existingPo = { vendorId: "v1", vendorName: "V1", poId: "po-existing", poNumber: "PO-OLD", itemCount: 2 };
    mockFindFirst.mockResolvedValue({
      id: "snap-1", dealId: "d1", dealName: "PROJ-1234", version: 1,
      bomData: { items: [] }, zohoPurchaseOrders: [existingPo],
    });
    mockCreatePurchaseOrders.mockResolvedValue({
      created: [],
      failed: [],
      skippedExisting: [existingPo],
    });

    const res = await POST(makeRequest({ dealId: "d1", version: 1 }));
    const json = await res.json();

    expect(json.purchaseOrders).toHaveLength(1);
    expect(json.purchaseOrders[0].poId).toBe("po-existing");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx jest src/__tests__/api/bom-create-po.test.ts --no-coverage 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/bom/create-po/route.ts src/__tests__/api/bom-create-po.test.ts
git commit -m "feat: rework create-po route for multi-vendor PO splitting with partial retry"
```

---

## Chunk 4: BOM Dashboard UI Updates

### Task 7: Update BOM page for multi-PO display and preview

**Files:**
- Modify: `src/app/dashboards/bom/page.tsx`

This is the largest UI change. We update the `BomSnapshot` interface, replace state variables, rewrite the PO section, and add the preview panel.

- [ ] **Step 1: Update `BomSnapshot` interface**

In `src/app/dashboards/bom/page.tsx`, around line 156, replace:

```ts
  zohoPoId: string | null;
```

with:

```ts
  zohoPurchaseOrders: Array<{ vendorId: string; vendorName: string; poId: string; poNumber: string | null; itemCount: number }> | null;
```

- [ ] **Step 1b: Import shared types**

At the top of the file, add:

```ts
import type { ZohoPurchaseOrderEntry, PoGroupingResult } from "@/lib/bom-po-create";
```

- [ ] **Step 2: Replace PO state variables**

Around line 958-963, replace:

```ts
  const [zohoVendors, setZohoVendors] = useState<{ contact_id: string; contact_name: string }[] | null>(null);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [zohoVendorError, setZohoVendorError] = useState<string | null>(null);
  const [selectedVendorId, setSelectedVendorId] = useState<string>("");
  const [zohoPoId, setZohoPoId] = useState<string | null>(null);
  const [creatingPo, setCreatingPo] = useState(false);
```

with:

```ts
  const [zohoVendors, setZohoVendors] = useState<{ contact_id: string; contact_name: string }[] | null>(null);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [zohoVendorError, setZohoVendorError] = useState<string | null>(null);
  const [zohoPurchaseOrders, setZohoPurchaseOrders] = useState<ZohoPurchaseOrderEntry[] | null>(null);
  const [poPreview, setPoPreview] = useState<PoGroupingResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [unassignedVendorId, setUnassignedVendorId] = useState<string>("");
  const [creatingPo, setCreatingPo] = useState(false);
```

- [ ] **Step 3: Update all `zohoPoId` references to `zohoPurchaseOrders`**

Search for all remaining `zohoPoId` references in `bom/page.tsx` and update:

**Line ~1187** (snapshot load):
```ts
setZohoPurchaseOrders(latest.zohoPurchaseOrders ?? null);
```

**Line ~3095** (snapshot switch in history):
```ts
setZohoPurchaseOrders(snap.zohoPurchaseOrders ?? null);
setPoPreview(null);           // clear stale preview when switching snapshots
setUnassignedVendorId("");    // reset vendor selection (replaces old setSelectedVendorId(""))
```

**Line ~3595** (snapshot restore):
```ts
setZohoPurchaseOrders(latest.zohoPurchaseOrders ?? null);
```

- [ ] **Step 4: Rewrite the `createPo` callback**

Replace the `createPo` callback (around line 1384-1425) with a `fetchPoPreview` callback and a new `createPos` callback:

```ts
  /* ---- Preview PO vendor grouping ---- */
  const fetchPoPreview = useCallback(async () => {
    if (!linkedProject || !savedVersion) return;
    setPreviewLoading(true);
    try {
      const res = await fetch(
        `/api/bom/po-preview?dealId=${linkedProject.hs_object_id}&version=${savedVersion}`
      );
      const data = await res.json();
      if (!res.ok) {
        addToast({ type: "error", title: data.error ?? "Failed to load PO preview" });
        return;
      }
      setPoPreview(data);
    } catch {
      addToast({ type: "error", title: "Network error loading PO preview" });
    } finally {
      setPreviewLoading(false);
    }
  }, [linkedProject, savedVersion, addToast]);

  /* ---- Create Zoho POs (multi-vendor) ---- */
  const createPos = useCallback(async () => {
    if (!linkedProject || !savedVersion) return;
    setCreatingPo(true);
    try {
      const res = await fetch("/api/bom/create-po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: linkedProject.hs_object_id,
          version: savedVersion,
          ...(unassignedVendorId ? { unassignedVendorId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        addToast({ type: "error", title: data.error ?? "Failed to create POs" });
        return;
      }
      setZohoPurchaseOrders(data.purchaseOrders);
      setPoPreview(null);
      const created = data.purchaseOrders?.length ?? 0;
      const failCount = data.failed?.length ?? 0;
      addToast({
        type: failCount > 0 ? "warning" : "success",
        title: `${created} PO${created !== 1 ? "s" : ""} created${failCount > 0 ? `, ${failCount} failed` : ""}`,
      });
    } catch {
      addToast({ type: "error", title: "Network error creating POs" });
    } finally {
      setCreatingPo(false);
    }
  }, [linkedProject, savedVersion, unassignedVendorId, addToast]);
```

- [ ] **Step 5: Replace the PO section in the JSX**

Replace the PO display block (around line 2762-2801 — everything from `{/* Zoho PO */}` to the end of its conditional) with:

```tsx
{/* Zoho POs — multi-vendor display */}
{savedVersion && (
  zohoPurchaseOrders && zohoPurchaseOrders.length > 0 ? (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted">Purchase Orders:</span>
      {zohoPurchaseOrders.map((po) => (
        <a
          key={po.poId}
          href={`https://inventory.zoho.com/app#/purchaseorders/${po.poId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
        >
          {po.vendorName} — {po.poNumber ?? "View PO"} ({po.itemCount} items) →
        </a>
      ))}
    </div>
  ) : poPreview ? (
    <div className="flex flex-col gap-2 p-3 bg-surface-2 rounded-lg border border-border">
      <span className="text-xs font-medium text-foreground">PO Preview — {poPreview.vendorGroups.length} vendor{poPreview.vendorGroups.length !== 1 ? "s" : ""}</span>
      {poPreview.vendorGroups.map((group) => (
        <details key={group.vendorId} className="text-xs">
          <summary className="cursor-pointer font-medium text-foreground">
            {group.vendorName} ({group.items.length} items)
          </summary>
          <ul className="ml-4 mt-1 space-y-0.5 text-muted">
            {group.items.map((item, i) => (
              <li key={i}>
                {item.bomName}{item.bomName !== item.zohoName ? ` → ${item.zohoName}` : ""} ×{item.quantity}
              </li>
            ))}
          </ul>
        </details>
      ))}
      {poPreview.unassignedItems.length > 0 && (
        <div className="text-xs">
          <span className="font-medium text-amber-600 dark:text-amber-400">
            {poPreview.unassignedItems.length} unassigned item{poPreview.unassignedItems.length !== 1 ? "s" : ""}
          </span>
          <ul className="ml-4 mt-1 space-y-0.5 text-muted">
            {poPreview.unassignedItems.map((item, i) => (
              <li key={i}>
                {item.name} ×{item.quantity} ({item.reason === "no_zoho_match" ? "no Zoho match" : "no vendor"})
              </li>
            ))}
          </ul>
          {zohoVendors && zohoVendors.length > 0 && (
            <div className="flex items-center gap-2 mt-2">
              <ContactCombobox
                contacts={zohoVendors}
                value={unassignedVendorId}
                onChange={setUnassignedVendorId}
                placeholder="Assign vendor…"
              />
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 mt-1">
        <button
          onClick={createPos}
          disabled={creatingPo}
          className="text-xs rounded bg-cyan-600 text-white px-3 py-1 hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {creatingPo ? "Creating…" : `Create ${poPreview.vendorGroups.length} PO${poPreview.vendorGroups.length !== 1 ? "s" : ""}`}
        </button>
        <button
          onClick={() => setPoPreview(null)}
          className="text-xs text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  ) : (
    <div className="flex items-center gap-2">
      <button
        onClick={fetchPoPreview}
        disabled={previewLoading}
        className="text-xs rounded bg-cyan-600 text-white px-3 py-1 hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {previewLoading ? "Loading…" : "Preview Purchase Orders"}
      </button>
      {vendorsLoading && (
        <span className="text-xs text-muted animate-pulse">Loading vendors…</span>
      )}
    </div>
  )
)}
```

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No type errors. (If there are remaining `zohoPoId` references, fix them.)

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboards/bom/page.tsx
git commit -m "feat: update BOM page for multi-vendor PO preview and creation"
```

---

## Chunk 5: Pipeline Integration and Cleanup

### Task 8: Add `CREATE_PO` step to the BOM pipeline

**Files:**
- Modify: `src/lib/bom-pipeline.ts`

- [ ] **Step 1: Import the shared lib**

At the top of `src/lib/bom-pipeline.ts`, add:

```ts
import {
  resolvePoVendorGroups,
  createPurchaseOrders,
  type BomData,
  type ZohoPurchaseOrderEntry,
} from "@/lib/bom-po-create";
```

- [ ] **Step 2: Add retry policy for CREATE_PO**

In the `STEP_RETRY_POLICIES` object (around line 132), add after `CREATE_SO`:

```ts
  CREATE_PO: {
    maxAttempts: 2,
    baseDelayMs: 3_000,
    jitterMs: 1_000,
    retryableStatuses: DEFAULT_RETRYABLE_STATUSES,
    retryablePatterns: DEFAULT_RETRYABLE_PATTERNS,
  },
```

- [ ] **Step 3: Add CREATE_PO step after CREATE_SO**

After the `CREATE_SO` step block (around line 944, after `updateRun` for SO), add the PO creation step:

```ts
    // ── Step 6b: Create draft Purchase Orders (optional, non-blocking) ──
    currentStep = "CREATE_PO";

    try {
      const poSnapshot = await prisma.projectBomSnapshot.findFirst({
        where: { dealId, version: snapshotResult.version },
      });

      if (poSnapshot && zohoInventory.isConfigured()) {
        const poBomData = poSnapshot.bomData as BomData;
        const existingPos = (poSnapshot.zohoPurchaseOrders as ZohoPurchaseOrderEntry[] | null) ?? [];

        // resolvePoVendorGroups uses cached Zoho items — unlikely to fail transiently.
        // createPurchaseOrders handles its own partial-failure recovery internally,
        // so wrapping either in withRetry would risk double-creation.
        const poGrouping = await resolvePoVendorGroups(poBomData);

        if (poGrouping.vendorGroups.length > 0) {
          const poResult = await createPurchaseOrders({
            snapshotId: poSnapshot.id,
            bomData: poBomData,
            vendorGroups: poGrouping.vendorGroups,
            existingPos,
            dealName,
            version: snapshotResult.version,
            address: poBomData?.project?.address,
            actor: PIPELINE_ACTOR,
          });

          await updateRun(runId, {
            metadata: {
              poCreated: poResult.created.length,
              poFailed: poResult.failed.length,
              poSkipped: poResult.skippedExisting.length,
              poUnassigned: poGrouping.unassignedItems.length,
            },
          });
        }
      }
    } catch (e) {
      // PO creation is non-blocking — log and continue to NOTIFY
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[bom-pipeline] CREATE_PO failed for ${dealId}:`, msg);
      await logActivity({
        type: "API_ERROR",
        description: `Pipeline CREATE_PO failed for ${dealName}: ${msg}`,
        userEmail: PIPELINE_ACTOR.email,
        userName: PIPELINE_ACTOR.name,
        entityType: "bom",
        entityId: dealId,
        entityName: "pipeline",
        metadata: { event: "bom_pipeline_create_po_failed", error: msg },
        requestPath: PIPELINE_ACTOR.requestPath,
        requestMethod: PIPELINE_ACTOR.requestMethod,
      });
    }
```

**Important:** This entire block is wrapped in a try/catch so PO failures don't prevent the NOTIFY step. The pipeline proceeds even if PO creation fails entirely.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep bom-pipeline | head -10`
Expected: No errors.

- [ ] **Step 5: Run full test suite**

Run: `npx jest --no-coverage 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bom-pipeline.ts
git commit -m "feat: add CREATE_PO step to BOM pipeline with non-blocking execution"
```

---

### Task 9: Final verification and cleanup

- [ ] **Step 1: Full TypeScript check**

Run: `npx tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 2: Full test run**

Run: `npx jest --no-coverage`
Expected: All tests pass.

- [ ] **Step 3: Lint check**

Run: `npx eslint src/lib/bom-po-create.ts src/app/api/bom/po-preview/route.ts src/app/api/bom/create-po/route.ts --fix`
Expected: No errors (or auto-fixed).

- [ ] **Step 4: Search for any remaining `zohoPoId` references in source**

Run: `grep -r "zohoPoId" src/ --include="*.ts" --include="*.tsx" | grep -v "generated/" | grep -v node_modules | grep -v "product-updates.ts"`
Expected: Zero results. All functional references have been migrated. (Generated Prisma files excluded — they'll be regenerated. `product-updates.ts` excluded — those are historical changelog strings referencing the old column name.)

- [ ] **Step 5: Commit any cleanup**

```bash
git add -A
git commit -m "chore: final cleanup for preferred-vendor PO splitting"
```
