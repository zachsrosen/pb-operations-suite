# Cross-System Product Sync Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poll Zoho, HubSpot, and Zuper for unlinked products every 15 minutes, import them into InternalProduct, and push outward to the other two systems.

**Architecture:** Cron-based poll detects unlinked external products, resolves category via mapping tables, deduplicates via canonical keys, creates InternalProduct records, then reuses the existing `catalog-sync.ts` outbound engine (with a thin wrapper for cross-link IDs). Items that can't be auto-categorized or have ambiguous dedup matches route to the PendingCatalogPush review queue.

**Tech Stack:** Next.js API routes, Prisma/Postgres, Zoho Inventory API, HubSpot CRM v3 API, Zuper REST API.

**Spec:** `docs/superpowers/specs/2026-04-10-cross-system-product-sync-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `prisma/schema.prisma` | Add `ProductSyncRun` model |
| `src/lib/product-sync-categories.ts` | Zoho `category_name` → `EquipmentCategory` mapping table + reverse HubSpot/Zuper lookups |
| `src/lib/product-sync.ts` | Core orchestrator: acquire lock, poll systems, detect unlinked, categorize, dedup, import, outbound sync, log run |
| `src/lib/product-sync-outbound.ts` | Thin wrapper around `catalog-sync.ts` that ensures cross-link IDs (`cf_internal_product_id`, etc.) are set on creates |
| `src/lib/zoho-inventory.ts` | Add `category_name`/`category_id` to type; add `listItemsSince(since)` method |
| `src/lib/hubspot.ts` | Add `listRecentHubSpotProducts(since)` using CRM v3 search API |
| `src/lib/zuper-catalog.ts` | Add `listRecentZuperProducts(since)` with pagination |
| `src/app/api/cron/product-sync/route.ts` | GET handler: cron auth → call orchestrator |
| `src/app/api/inventory/product-sync/route.ts` | POST handler: session auth → call orchestrator (supports `?mode=backfill`) |
| `vercel.json` | Add cron schedule + function timeout overrides |

---

## Chunk 1: Schema, Types, and Category Mapping

### Task 1: Add ProductSyncRun Prisma model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the ProductSyncRun model to schema.prisma**

Add after the last model in the file:

```prisma
model ProductSyncRun {
  id             String    @id @default(cuid())
  startedAt      DateTime  @default(now())
  completedAt    DateTime?
  trigger        String    // "cron" | "manual"
  triggeredBy    String?   // user email for manual triggers
  zohoScanned    Int       @default(0)
  hubspotScanned Int       @default(0)
  zuperScanned   Int       @default(0)
  imported       Int       @default(0)
  linked         Int       @default(0)
  flagged        Int       @default(0)
  skipped        Int       @default(0)
  errors         String?   // JSON array of error messages
  lockSentinel   String?   // "ACTIVE" while running, null when done

  @@unique([lockSentinel], name: "uq_product_sync_active_run")
  @@index([startedAt])
}
```

> **Concurrency strategy:** `lockSentinel` is set to `"ACTIVE"` at creation (by the orchestrator, not a schema default) and set to `null` on completion. The partial unique index ensures only one row with `lockSentinel = "ACTIVE"` can exist. A concurrent `create()` throws Prisma `P2002`, which the orchestrator catches. No findFirst+create race window. Because there is no schema default, test code that creates completed historical runs doesn't accidentally hold the lock.

- [ ] **Step 2: Generate Prisma client and verify**

Run: `npx prisma generate`
Expected: "Generated Prisma Client" success message.

- [ ] **Step 3: Create and apply migration**

Run: `npx prisma migrate dev --name add-product-sync-run`
Expected: Migration created and applied successfully.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(product-sync): add ProductSyncRun model"
```

---

### Task 2: Create category mapping module

**Files:**
- Create: `src/lib/product-sync-categories.ts`
- Test: `src/__tests__/product-sync-categories.test.ts`

- [ ] **Step 1: Write tests for category resolution**

```typescript
// src/__tests__/product-sync-categories.test.ts
import {
  resolveZohoCategoryName,
  resolveHubSpotCategory,
  resolveZuperCategory,
} from "@/lib/product-sync-categories";

describe("product-sync-categories", () => {
  describe("resolveZohoCategoryName", () => {
    it("maps Module to MODULE", () => {
      expect(resolveZohoCategoryName("Module")).toBe("MODULE");
    });

    it("maps Inverter to INVERTER", () => {
      expect(resolveZohoCategoryName("Inverter")).toBe("INVERTER");
    });

    it("maps Tesla to TESLA_SYSTEM_COMPONENTS", () => {
      expect(resolveZohoCategoryName("Tesla")).toBe("TESLA_SYSTEM_COMPONENTS");
    });

    it("maps all electrical sub-categories to ELECTRICAL_BOS", () => {
      const electrical = [
        "Electrical Component", "Breaker", "Wire", "PVC", "Load Center",
        "Coupling", "Nipple", "Fuse", "Locknut", "Bushing", "Strap",
        "Fastener", "Screw", "Clamp - Electrical",
      ];
      for (const cat of electrical) {
        expect(resolveZohoCategoryName(cat)).toBe("ELECTRICAL_BOS");
      }
    });

    it("maps Clamp - Solar to RACKING", () => {
      expect(resolveZohoCategoryName("Clamp - Solar")).toBe("RACKING");
    });

    it("maps Service to SERVICE", () => {
      expect(resolveZohoCategoryName("Service")).toBe("SERVICE");
    });

    it("returns 'skip' for Non-inventory", () => {
      expect(resolveZohoCategoryName("Non-inventory")).toBe("skip");
    });

    it("returns null for unresolvable categories", () => {
      expect(resolveZohoCategoryName("Solar Component")).toBeNull();
      expect(resolveZohoCategoryName("Other")).toBeNull();
      expect(resolveZohoCategoryName("H2")).toBeNull();
      expect(resolveZohoCategoryName(undefined)).toBeNull();
      expect(resolveZohoCategoryName("")).toBeNull();
    });
  });

  describe("resolveHubSpotCategory", () => {
    it("maps HubSpot product_category values to enum", () => {
      expect(resolveHubSpotCategory("Module")).toBe("MODULE");
      expect(resolveHubSpotCategory("Battery")).toBe("BATTERY");
      expect(resolveHubSpotCategory("Mounting Hardware")).toBe("RACKING");
      expect(resolveHubSpotCategory("Relay Device")).toBe("MONITORING");
    });

    it("returns null for unknown values", () => {
      expect(resolveHubSpotCategory("Unknown Category")).toBeNull();
      expect(resolveHubSpotCategory(undefined)).toBeNull();
    });
  });

  describe("resolveZuperCategory", () => {
    it("maps unambiguous Zuper category names to enum", () => {
      expect(resolveZuperCategory("Module")).toBe("MODULE");
      expect(resolveZuperCategory("Battery")).toBe("BATTERY");
      expect(resolveZuperCategory("Mounting Hardware")).toBe("RACKING");
      expect(resolveZuperCategory("Inverter")).toBe("INVERTER");
      expect(resolveZuperCategory("EV Charger")).toBe("EV_CHARGER");
      expect(resolveZuperCategory("D&R")).toBe("D_AND_R");
    });

    it("returns null for ambiguous Zuper categories (shared by multiple internal categories)", () => {
      expect(resolveZuperCategory("Electrical Hardwire")).toBeNull();
      expect(resolveZuperCategory("Relay Device")).toBeNull();
      expect(resolveZuperCategory("Service")).toBeNull();
    });

    it("returns null for unknown values", () => {
      expect(resolveZuperCategory("Weird Category")).toBeNull();
      expect(resolveZuperCategory(undefined)).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/product-sync-categories.test.ts --no-coverage`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement category mapping module**

```typescript
// src/lib/product-sync-categories.ts
//
// Maps external system category names → internal EquipmentCategory enum values.
// Used by the cross-system product sync to categorize incoming items.

import { CATEGORY_CONFIGS } from "@/lib/catalog-fields";

// ── Zoho category_name → EquipmentCategory ──────────────────────────────────
// Source: live Zoho Inventory data (1,680 items scanned 2026-04-10).
// "category_name" is a flat classification field on Zoho items, distinct from
// "group_name" (hierarchical grouping used by the outbound sync in zoho-taxonomy.ts).

const ZOHO_CATEGORY_MAP: Record<string, string | "skip"> = {
  // Direct matches
  "Module": "MODULE",
  "Inverter": "INVERTER",
  "Tesla": "TESLA_SYSTEM_COMPONENTS",
  "Clamp - Solar": "RACKING",
  "Service": "SERVICE",

  // Electrical sub-categories → ELECTRICAL_BOS
  "Electrical Component": "ELECTRICAL_BOS",
  "Breaker": "ELECTRICAL_BOS",
  "Wire": "ELECTRICAL_BOS",
  "PVC": "ELECTRICAL_BOS",
  "Load Center": "ELECTRICAL_BOS",
  "Coupling": "ELECTRICAL_BOS",
  "Nipple": "ELECTRICAL_BOS",
  "Fuse": "ELECTRICAL_BOS",
  "Locknut": "ELECTRICAL_BOS",
  "Bushing": "ELECTRICAL_BOS",
  "Strap": "ELECTRICAL_BOS",
  "Fastener": "ELECTRICAL_BOS",
  "Screw": "ELECTRICAL_BOS",
  "Clamp - Electrical": "ELECTRICAL_BOS",

  // Skip — not physical inventory
  "Non-inventory": "skip",
};

/**
 * Resolve a Zoho `category_name` to an internal EquipmentCategory enum value.
 * Returns the enum string, `"skip"` for non-inventory items, or `null` if the
 * category can't be resolved (should route to manual review).
 */
export function resolveZohoCategoryName(
  categoryName: string | undefined | null,
): string | null {
  if (!categoryName) return null;
  return ZOHO_CATEGORY_MAP[categoryName] ?? null;
}

// ── HubSpot product_category → EquipmentCategory ────────────────────────────
// Built from CATEGORY_CONFIGS: each config has a `hubspotValue` field.

const HUBSPOT_CATEGORY_MAP: Record<string, string> = {};
for (const [enumValue, config] of Object.entries(CATEGORY_CONFIGS)) {
  if (config.hubspotValue) {
    HUBSPOT_CATEGORY_MAP[config.hubspotValue] = enumValue;
  }
}

/**
 * Resolve a HubSpot `product_category` property value to EquipmentCategory.
 * Returns the enum string or `null` if unrecognized.
 */
export function resolveHubSpotCategory(
  productCategory: string | undefined | null,
): string | null {
  if (!productCategory) return null;
  return HUBSPOT_CATEGORY_MAP[productCategory] ?? null;
}

// ── Zuper category name → EquipmentCategory ─────────────────────────────────
// CANNOT be auto-generated from CATEGORY_CONFIGS because multiple internal
// categories share the same zuperCategory value:
//   "Electrical Hardwire" → ELECTRICAL_BOS, RAPID_SHUTDOWN
//   "Relay Device"        → MONITORING, GATEWAY
//   "Service"             → SERVICE, ADDER_SERVICES, PROJECT_MILESTONES
// Auto-generating would silently overwrite earlier entries with later ones.
// Instead, we use an explicit map where ambiguous categories return null
// (routed to manual review via PendingCatalogPush).

const ZUPER_CATEGORY_MAP: Record<string, string | null> = {
  // Unambiguous 1:1 mappings
  "Module": "MODULE",
  "Inverter": "INVERTER",
  "Battery": "BATTERY",
  "Battery Expansion": "BATTERY_EXPANSION",
  "EV Charger": "EV_CHARGER",
  "Mounting Hardware": "RACKING",
  "Optimizer": "OPTIMIZER",
  "D&R": "D_AND_R",                    // Prisma enum is D_AND_R, not DNR
  "Tesla System Components": "TESLA_SYSTEM_COMPONENTS",

  // Ambiguous — multiple internal categories share this Zuper category.
  // Route to manual review (null) instead of silently picking one.
  "Electrical Hardwire": null,  // ELECTRICAL_BOS or RAPID_SHUTDOWN
  "Relay Device": null,         // MONITORING or GATEWAY
  "Service": null,              // SERVICE, ADDER_SERVICES, or PROJECT_MILESTONES
};

/**
 * Resolve a Zuper product category name to EquipmentCategory.
 * Returns the enum string, or `null` if unrecognized or ambiguous
 * (should route to manual review).
 */
export function resolveZuperCategory(
  categoryName: string | undefined | null,
): string | null {
  if (!categoryName) return null;
  if (categoryName in ZUPER_CATEGORY_MAP) {
    return ZUPER_CATEGORY_MAP[categoryName];
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/product-sync-categories.test.ts --no-coverage`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/product-sync-categories.ts src/__tests__/product-sync-categories.test.ts
git commit -m "feat(product-sync): add category mapping module with tests"
```

---

## Chunk 2: External System List Functions

### Task 3: Add `category_name` to Zoho type + `listItemsSince` method

**Files:**
- Modify: `src/lib/zoho-inventory.ts`

- [ ] **Step 1: Add `category_name` and `category_id` to `ZohoInventoryItem` interface**

In the `ZohoInventoryItem` interface (around line 19), add after the `group_name` field:

```typescript
  category_name?: string;           // Flat classification (e.g. "Module", "Wire")
  category_id?: string;             // Zoho category ID
```

- [ ] **Step 2: Add `listItemsSince` method**

Add this method to the `ZohoInventoryClient` class, right after the existing `listItems()` method (around line 601):

```typescript
  /**
   * Fetch Zoho items modified since a given date. Used by the cross-system
   * product sync to limit API calls to recently-changed items.
   * If `since` is undefined, returns all items (full scan / backfill mode).
   */
  async listItemsSince(since?: Date): Promise<ZohoInventoryItem[]> {
    if (!since) return this.listItems();

    const items: ZohoInventoryItem[] = [];
    let page = 1;
    const perPage = 200;
    const sinceStr = since.toISOString().replace("T", " ").slice(0, 19);

    while (true) {
      const response = await this.request<ZohoInventoryListItemsResponse>(
        "/items",
        {
          page,
          per_page: perPage,
          last_modified_time: sinceStr,
          sort_column: "last_modified_time",
          sort_order: "D",
        },
      );

      const batch = Array.isArray(response.items) ? response.items : [];
      items.push(...batch);

      const hasMore = !!response.page_context?.has_more_page;
      if (!hasMore || batch.length === 0) break;
      page += 1;

      if (page > 1000) {
        throw new Error("Zoho item pagination exceeded safety limit (1000 pages)");
      }
    }

    return items;
  }
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors related to `zoho-inventory.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/zoho-inventory.ts
git commit -m "feat(product-sync): add category_name type + listItemsSince to Zoho client"
```

---

### Task 4: Add `listRecentHubSpotProducts` function

**Files:**
- Modify: `src/lib/hubspot.ts`

- [ ] **Step 1: Add the function**

Add at the end of the file, before any default export. This uses the CRM v3 search API (`POST /crm/v3/objects/products/search`) with cursor pagination and rate-limit retry:

```typescript
/** Properties needed by the product sync for field mapping. */
const PRODUCT_SYNC_PROPERTIES = [
  "name",
  "hs_sku",
  "price",
  "description",
  "manufacturer",
  "product_category",
  "hs_cost_of_goods_sold",
];

export interface HubSpotProductRecord {
  id: string;
  properties: Record<string, string | null>;
}

/**
 * List HubSpot products created since a given date.
 * Uses POST /crm/v3/objects/products/search with createdate filter.
 * If `since` is undefined, lists all products (backfill mode).
 */
export async function listRecentHubSpotProducts(
  since?: Date,
): Promise<HubSpotProductRecord[]> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN is not configured");

  const products: HubSpotProductRecord[] = [];
  let after: string | undefined;
  const limit = 100;
  const maxRetries = 5;

  const filters = since
    ? [
        {
          propertyName: "createdate",
          operator: "GTE",
          value: since.getTime().toString(),
        },
      ]
    : [];

  while (true) {
    const body: Record<string, unknown> = {
      filterGroups: filters.length > 0 ? [{ filters }] : [],
      properties: PRODUCT_SYNC_PROPERTIES,
      limit,
      ...(after ? { after } : {}),
    };

    let response: Response | undefined;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      response = await fetch(
        "https://api.hubapi.com/crm/v3/objects/products/search",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );

      if (response.status === 429 && attempt < maxRetries - 1) {
        const delay = Math.round(Math.pow(2, attempt) * 1100 + Math.random() * 400);
        console.log(
          `[hubspot] Product search rate limited (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms...`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }

    if (!response || !response.ok) {
      const text = await response?.text().catch(() => "unknown");
      throw new Error(
        `HubSpot product search failed: ${response?.status} ${text}`,
      );
    }

    const json = (await response.json()) as {
      results?: Array<{ id: string; properties: Record<string, string | null> }>;
      paging?: { next?: { after?: string } };
    };

    const batch = json.results ?? [];
    for (const item of batch) {
      products.push({ id: item.id, properties: item.properties });
    }

    after = json.paging?.next?.after;
    if (!after || batch.length === 0) break;

    if (products.length > 50_000) {
      throw new Error("HubSpot product pagination exceeded safety limit (50,000 products)");
    }
  }

  return products;
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/hubspot.ts
git commit -m "feat(product-sync): add listRecentHubSpotProducts to HubSpot client"
```

---

### Task 5: Add `listRecentZuperProducts` function

**Files:**
- Modify: `src/lib/zuper-catalog.ts`

- [ ] **Step 1: Add the function**

Add near the other list/get functions. Zuper's product API uses `/product` with `count` and `page` query params. The function needs to handle the defensive multi-endpoint approach already used in the file:

```typescript
export interface ZuperProductRecord {
  id: string;
  name?: string;
  sku?: string;
  brand?: string;
  model?: string;
  description?: string;
  price?: number;
  purchasePrice?: number;
  categoryName?: string;
  raw: Record<string, unknown>;
}

/**
 * List Zuper products, optionally filtered to those created since a given date.
 * If `since` is undefined, lists all products (backfill mode).
 * Extracts common fields into a normalized shape while preserving the raw record.
 */
export async function listRecentZuperProducts(
  since?: Date,
): Promise<ZuperProductRecord[]> {
  const products: ZuperProductRecord[] = [];
  const endpoints = getCatalogEndpoints();
  const perPage = 200;

  for (const endpoint of endpoints) {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      try {
        const params = new URLSearchParams({
          count: String(perPage),
          page: String(page),
        });
        const url = `${endpoint}?${params.toString()}`;
        const response = await requestZuper(url);

        if (!isRecord(response)) break;

        // Zuper wraps results in various shapes
        const dataKey = ["data", "items", "products", "parts"].find(
          (k) => Array.isArray((response as Record<string, unknown>)[k]),
        );
        const batch = dataKey
          ? ((response as Record<string, unknown>)[dataKey] as Record<string, unknown>[])
          : [];

        if (batch.length === 0) break;

        for (const item of batch) {
          if (!isRecord(item)) continue;

          // Extract ID using the same key fallback as getZuperPartById
          const id = ITEM_ID_KEYS.reduce<string | undefined>(
            (found, key) => found || trimOrUndefined(item[key] as string),
            undefined,
          );
          if (!id) continue;

          // Filter by creation date if provided
          const createdAt = item.created_at || item.createdAt;
          if (since && createdAt) {
            const created = new Date(String(createdAt));
            if (!isNaN(created.getTime()) && created < since) continue;
          }

          products.push({
            id,
            name: trimOrUndefined(item.name as string),
            sku: trimOrUndefined(item.sku as string) ||
              trimOrUndefined(item.part_number as string),
            brand: trimOrUndefined(item.brand as string),
            model: trimOrUndefined(item.model as string),
            description: trimOrUndefined(item.description as string),
            price: typeof item.price === "number" ? item.price : undefined,
            purchasePrice: typeof item.purchase_price === "number"
              ? item.purchase_price
              : undefined,
            categoryName: trimOrUndefined(item.category_name as string) ||
              trimOrUndefined(
                (isRecord(item.category) ? (item.category as Record<string, unknown>).name : undefined) as string,
              ),
            raw: item,
          });
        }

        // Check pagination
        const total = typeof (response as Record<string, unknown>).total_count === "number"
          ? (response as Record<string, unknown>).total_count as number
          : undefined;
        hasMore = total ? products.length < total : batch.length === perPage;
        page += 1;

        if (page > 500) break; // Safety limit
      } catch {
        // If this endpoint doesn't support listing, try next
        break;
      }
    }

    // If we got results from one endpoint, don't try others
    if (products.length > 0) break;
  }

  return products;
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/zuper-catalog.ts
git commit -m "feat(product-sync): add listRecentZuperProducts to Zuper client"
```

---

## Chunk 3: Core Sync Orchestrator

### Task 6: Create outbound sync wrapper

**Files:**
- Create: `src/lib/product-sync-outbound.ts`

- [ ] **Step 1: Create the outbound wrapper**

This wraps the existing `catalog-sync.ts` to handle reverse-sync creates, ensuring cross-link IDs and peer external IDs are written to newly-created external records.

**Important:** The existing `catalog-sync.ts` create paths (`executeZohoSync`, `executeHubSpotSync`, `executeZuperSync`) do NOT pass cross-link or peer IDs to external systems — they only link back by updating the InternalProduct's `zohoItemId`/`hubspotProductId`/`zuperItemId` after creation. This wrapper adds a post-create step that writes cross-link custom fields using the correct payload shapes for each system:
- **Zoho**: `updateItem(id, { custom_fields: [{ api_name, value }] })` — array of `{ api_name, value }` objects
- **HubSpot**: `updateHubSpotProduct(id, { internal_product_id, ... })` — flat properties
- **Zuper**: `updateZuperPart(id, { custom_fields: buildZuperProductCustomFields(...) })` — uses `buildZuperProductCustomFields` helper

```typescript
// src/lib/product-sync-outbound.ts
//
// Thin wrapper around catalog-sync.ts for reverse-imported products.
// After catalog-sync creates external records, this module writes cross-link
// custom fields using the correct payload format for each external system.

import { prisma } from "@/lib/db";
import {
  previewSyncToLinkedSystems,
  executeSyncToLinkedSystems,
  computePreviewHash,
} from "@/lib/catalog-sync";
import type { SyncOutcome } from "@/lib/catalog-sync";
import type { SyncSystem } from "@/lib/catalog-sync-confirmation";

/**
 * After catalog-sync creates an external record, write cross-link custom
 * fields (internal product ID + peer external IDs) to the new record.
 *
 * Each system has a different custom field payload format:
 * - Zoho: custom_fields array of { api_name, value }
 * - HubSpot: flat properties object
 * - Zuper: { custom_fields: buildZuperProductCustomFields(...) }
 *
 * Failures are logged but do not block the sync.
 */
async function setCrossLinkFields(
  product: {
    id: string;
    zohoItemId: string | null;
    hubspotProductId: string | null;
    zuperItemId: string | null;
  },
  outcomes: SyncOutcome[],
): Promise<void> {
  // Re-read the product to get freshly-linked external IDs
  // (catalog-sync sets these via guarded writes after creation)
  const fresh = await prisma.internalProduct.findUnique({
    where: { id: product.id },
    select: { zohoItemId: true, hubspotProductId: true, zuperItemId: true },
  });
  if (!fresh) return;

  for (const outcome of outcomes) {
    if (outcome.status !== "created" || !outcome.externalId) continue;

    try {
      if (outcome.system === "zoho") {
        // Zoho custom fields use array of { api_name, value } objects
        const { updateZohoItem } = await import("@/lib/zoho-inventory");
        const customFields: Array<{ api_name: string; value: string }> = [
          { api_name: "cf_internal_product_id", value: product.id },
        ];
        if (fresh.hubspotProductId) {
          customFields.push({ api_name: "cf_hubspot_product_id", value: fresh.hubspotProductId });
        }
        if (fresh.zuperItemId) {
          customFields.push({ api_name: "cf_zuper_product_id", value: fresh.zuperItemId });
        }
        await updateZohoItem(outcome.externalId, { custom_fields: customFields });

      } else if (outcome.system === "hubspot") {
        // HubSpot uses flat properties
        const { updateHubSpotProduct } = await import("@/lib/hubspot");
        const properties: Record<string, string> = {
          internal_product_id: product.id,
        };
        if (fresh.zohoItemId) properties.zoho_item_id = fresh.zohoItemId;
        if (fresh.zuperItemId) properties.zuper_item_id = fresh.zuperItemId;
        await updateHubSpotProduct(outcome.externalId, properties);

      } else if (outcome.system === "zuper") {
        // Zuper uses buildZuperProductCustomFields helper
        const { updateZuperPart, buildZuperProductCustomFields } = await import("@/lib/zuper-catalog");
        const customFields = buildZuperProductCustomFields({
          internalProductId: product.id,
          hubspotProductId: fresh.hubspotProductId,
          zohoItemId: fresh.zohoItemId,
        });
        if (customFields) {
          await updateZuperPart(outcome.externalId, { custom_fields: customFields });
        }
      }
    } catch (error) {
      console.error(
        `[product-sync-outbound] Failed to set cross-link on ${outcome.system} ${outcome.externalId}:`,
        error,
      );
    }
  }
}

/**
 * Push a newly-imported InternalProduct to the external systems it's missing from.
 * For example, if the product was imported from Zoho, push to HubSpot + Zuper.
 * After creation, writes cross-link custom fields (with correct payload shapes)
 * and peer external IDs to the new records.
 *
 * Returns outcomes for each system attempted.
 */
export async function pushToMissingSystems(
  internalProductId: string,
): Promise<SyncOutcome[]> {
  const product = await prisma.internalProduct.findUnique({
    where: { id: internalProductId },
    include: {
      moduleSpec: true,
      inverterSpec: true,
      batterySpec: true,
      evChargerSpec: true,
      mountingHardwareSpec: true,
      electricalHardwareSpec: true,
      relayDeviceSpec: true,
    },
  });

  if (!product) return [];

  // Determine which systems are missing
  const missingSystems: SyncSystem[] = [];
  if (!product.zohoItemId) missingSystems.push("zoho");
  if (!product.hubspotProductId) missingSystems.push("hubspot");
  if (!product.zuperItemId) missingSystems.push("zuper");

  if (missingSystems.length === 0) return [];

  // Build SkuRecord shape expected by catalog-sync
  const specTable = product.moduleSpec
    || product.inverterSpec
    || product.batterySpec
    || product.evChargerSpec
    || product.mountingHardwareSpec
    || product.electricalHardwareSpec
    || product.relayDeviceSpec;

  const sku = {
    id: product.id,
    category: product.category,
    brand: product.brand,
    model: product.model,
    name: product.name,
    description: product.description,
    sku: product.sku,
    unitCost: product.unitCost,
    sellPrice: product.sellPrice,
    unitSpec: product.unitSpec,
    unitLabel: product.unitLabel,
    vendorName: product.vendorName,
    vendorPartNumber: product.vendorPartNumber,
    hardToProcure: product.hardToProcure,
    length: product.length,
    width: product.width,
    weight: product.weight,
    hubspotProductId: product.hubspotProductId,
    zuperItemId: product.zuperItemId,
    zohoItemId: product.zohoItemId,
    zohoVendorId: product.zohoVendorId,
    specData: specTable ? Object.fromEntries(
      Object.entries(specTable).filter(
        ([k]) => !["id", "internalProductId", "createdAt", "updatedAt"].includes(k),
      ),
    ) : {},
  };

  try {
    const previews = await previewSyncToLinkedSystems(
      sku as Parameters<typeof previewSyncToLinkedSystems>[0],
      missingSystems,
    );
    const hash = computePreviewHash(previews);
    const result = await executeSyncToLinkedSystems(
      sku as Parameters<typeof executeSyncToLinkedSystems>[0],
      hash,
      missingSystems,
    );

    // Post-create: write cross-link custom fields + peer IDs to new records
    await setCrossLinkFields(product, result.outcomes);

    return result.outcomes;
  } catch (error) {
    console.error(
      `[product-sync-outbound] Failed to push product ${internalProductId} to ${missingSystems.join(", ")}:`,
      error,
    );
    return missingSystems.map((system) => ({
      system,
      externalId: "",
      status: "failed" as const,
      message: error instanceof Error ? error.message : "Unknown error",
    }));
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/product-sync-outbound.ts
git commit -m "feat(product-sync): add outbound sync wrapper for reverse-imported products"
```

---

### Task 7: Create core sync orchestrator

**Files:**
- Create: `src/lib/product-sync.ts`
- Test: `src/__tests__/product-sync.test.ts`

This is the largest task. The orchestrator ties together: advisory lock → poll systems → filter unlinked → categorize → dedup → import/link/flag → outbound sync → log run.

- [ ] **Step 1: Write tests for the item processing pipeline**

These test the pure logic functions (categorize, dedup, field extraction) without hitting external APIs.

```typescript
// src/__tests__/product-sync.test.ts
import {
  extractFieldsFromZohoItem,
  extractFieldsFromHubSpotProduct,
  extractFieldsFromZuperProduct,
  type ExternalProductFields,
} from "@/lib/product-sync";

describe("product-sync field extraction", () => {
  describe("extractFieldsFromZohoItem", () => {
    it("extracts core fields from a Zoho item", () => {
      const zohoItem = {
        item_id: "zoho-123",
        name: "REC Alpha Pure Black 400",
        sku: "REC-400-AB",
        description: "400W module",
        brand: "REC",
        manufacturer: "",
        part_number: "REC400AA",
        rate: 250,
        purchase_rate: 180,
        category_name: "Module",
      };

      const result = extractFieldsFromZohoItem(zohoItem);

      expect(result.externalId).toBe("zoho-123");
      expect(result.source).toBe("zoho");
      expect(result.name).toBe("REC Alpha Pure Black 400");
      expect(result.brand).toBe("REC");
      expect(result.model).toBe("REC400AA");
      expect(result.sku).toBe("REC-400-AB");
      expect(result.sellPrice).toBe(250);
      expect(result.unitCost).toBe(180);
      expect(result.sourceCategory).toBe("Module");
    });

    it("falls back to manufacturer when brand is empty", () => {
      const zohoItem = {
        item_id: "z-1",
        name: "Test",
        brand: "",
        manufacturer: "Enphase",
        category_name: "Inverter",
      };
      const result = extractFieldsFromZohoItem(zohoItem);
      expect(result.brand).toBe("Enphase");
    });

    it("parses model from name when part_number is missing", () => {
      const zohoItem = {
        item_id: "z-2",
        name: "Enphase IQ8A-72-M-US",
        brand: "Enphase",
        category_name: "Inverter",
      };
      const result = extractFieldsFromZohoItem(zohoItem);
      // model should be extracted from name minus brand
      expect(result.model).toBeTruthy();
    });
  });

  describe("extractFieldsFromHubSpotProduct", () => {
    it("extracts core fields from a HubSpot product", () => {
      const product = {
        id: "hs-456",
        properties: {
          name: "SolarEdge SE10000H-US",
          hs_sku: "SE10000H",
          price: "1200",
          description: "10kW inverter",
          manufacturer: "SolarEdge",
          product_category: "Inverter",
          hs_cost_of_goods_sold: "900",
        },
      };

      const result = extractFieldsFromHubSpotProduct(product);

      expect(result.externalId).toBe("hs-456");
      expect(result.source).toBe("hubspot");
      expect(result.name).toBe("SolarEdge SE10000H-US");
      expect(result.brand).toBe("SolarEdge");
      expect(result.sku).toBe("SE10000H");
      expect(result.sellPrice).toBe(1200);
      expect(result.unitCost).toBe(900);
      expect(result.sourceCategory).toBe("Inverter");
    });
  });

  describe("extractFieldsFromZuperProduct", () => {
    it("extracts core fields from a Zuper product", () => {
      const product = {
        id: "zup-789",
        name: "Tesla Powerwall 3",
        sku: "PW3",
        brand: "Tesla",
        model: "Powerwall 3",
        description: "13.5 kWh battery",
        price: 8500,
        purchasePrice: 7000,
        categoryName: "Battery",
        raw: {},
      };

      const result = extractFieldsFromZuperProduct(product);

      expect(result.externalId).toBe("zup-789");
      expect(result.source).toBe("zuper");
      expect(result.name).toBe("Tesla Powerwall 3");
      expect(result.brand).toBe("Tesla");
      expect(result.model).toBe("Powerwall 3");
      expect(result.sellPrice).toBe(8500);
      expect(result.unitCost).toBe(7000);
      expect(result.sourceCategory).toBe("Battery");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/product-sync.test.ts --no-coverage`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the core orchestrator**

```typescript
// src/lib/product-sync.ts
//
// Cross-system product sync orchestrator.
// Polls Zoho, HubSpot, and Zuper for unlinked products, imports them into
// InternalProduct, and pushes outward to the other systems.

import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { canonicalToken, buildCanonicalKey } from "@/lib/canonical";
import {
  resolveZohoCategoryName,
  resolveHubSpotCategory,
  resolveZuperCategory,
} from "@/lib/product-sync-categories";
import { zohoInventory } from "@/lib/zoho-inventory";
import type { ZohoInventoryItem } from "@/lib/zoho-inventory";
import { listRecentHubSpotProducts } from "@/lib/hubspot";
import type { HubSpotProductRecord } from "@/lib/hubspot";
import { listRecentZuperProducts } from "@/lib/zuper-catalog";
import type { ZuperProductRecord } from "@/lib/zuper-catalog";
import { pushToMissingSystems } from "@/lib/product-sync-outbound";

// ── Types ────────────────────────────────────────────────────────────────────

export type SyncSource = "zoho" | "hubspot" | "zuper";

export interface ExternalProductFields {
  externalId: string;
  source: SyncSource;
  name: string;
  brand: string;
  model: string;
  description: string;
  sku?: string;
  unitCost?: number;
  sellPrice?: number;
  sourceCategory?: string;
  rawMetadata: Record<string, unknown>;
}

interface SyncRunStats {
  zohoScanned: number;
  hubspotScanned: number;
  zuperScanned: number;
  imported: number;
  linked: number;
  flagged: number;
  skipped: number;
  errors: string[];
}

interface SyncRunOptions {
  trigger: "cron" | "manual";
  triggeredBy?: string;
  backfill?: boolean;
}

// ── Concurrency Lock (partial unique index on lockSentinel) ─────────────────
// Advisory locks are unreliable in serverless (Prisma + Neon connection pooling).
// Instead, we use a partial unique index on ProductSyncRun.lockSentinel:
// only one row with lockSentinel="ACTIVE" can exist. On completion, lockSentinel
// is set to null (excluded from the unique index). A concurrent create() throws
// P2002, which the orchestrator catches to reject the duplicate run.

const STALE_RUN_MS = 5 * 60 * 1000; // 5 minutes

// ── Field Extraction ─────────────────────────────────────────────────────────

export function extractFieldsFromZohoItem(
  item: ZohoInventoryItem & { category_name?: string },
): ExternalProductFields {
  const brand = (item.brand || item.manufacturer || "").trim();
  let model = (item.part_number || "").trim();

  // If no part_number, try to extract model from name by removing brand prefix
  if (!model && item.name && brand) {
    const lower = item.name.toLowerCase();
    const brandLower = brand.toLowerCase();
    const nameWithoutBrand = lower.startsWith(brandLower)
      ? item.name.slice(brand.length).trim()
      : item.name;
    model = nameWithoutBrand || item.name;
  } else if (!model) {
    model = item.name || "";
  }

  return {
    externalId: item.item_id,
    source: "zoho",
    name: item.name || "",
    brand,
    model,
    description: item.description || "",
    sku: item.sku,
    unitCost: item.purchase_rate,
    sellPrice: item.rate,
    sourceCategory: item.category_name,
    rawMetadata: item as unknown as Record<string, unknown>,
  };
}

export function extractFieldsFromHubSpotProduct(
  product: HubSpotProductRecord,
): ExternalProductFields {
  const props = product.properties;
  const name = props.name || "";
  const brand = (props.manufacturer || "").trim();
  let model = "";

  // Try to extract model from name by removing brand prefix
  if (brand && name.toLowerCase().startsWith(brand.toLowerCase())) {
    model = name.slice(brand.length).trim();
  } else {
    model = name;
  }

  return {
    externalId: product.id,
    source: "hubspot",
    name,
    brand,
    model,
    description: props.description || "",
    sku: props.hs_sku || undefined,
    unitCost: props.hs_cost_of_goods_sold
      ? parseFloat(props.hs_cost_of_goods_sold)
      : undefined,
    sellPrice: props.price ? parseFloat(props.price) : undefined,
    sourceCategory: props.product_category || undefined,
    rawMetadata: props as unknown as Record<string, unknown>,
  };
}

export function extractFieldsFromZuperProduct(
  product: ZuperProductRecord,
): ExternalProductFields {
  return {
    externalId: product.id,
    source: "zuper",
    name: product.name || "",
    brand: product.brand || "",
    model: product.model || "",
    description: product.description || "",
    sku: product.sku,
    unitCost: product.purchasePrice,
    sellPrice: product.price,
    sourceCategory: product.categoryName,
    rawMetadata: product.raw,
  };
}

// ── Category Resolution ──────────────────────────────────────────────────────

function resolveCategory(
  source: SyncSource,
  sourceCategory: string | undefined,
): string | "skip" | null {
  switch (source) {
    case "zoho":
      return resolveZohoCategoryName(sourceCategory);
    case "hubspot":
      return resolveHubSpotCategory(sourceCategory);
    case "zuper":
      return resolveZuperCategory(sourceCategory);
  }
}

// ── External ID Field Helpers ────────────────────────────────────────────────

function externalIdField(source: SyncSource): "zohoItemId" | "hubspotProductId" | "zuperItemId" {
  switch (source) {
    case "zoho": return "zohoItemId";
    case "hubspot": return "hubspotProductId";
    case "zuper": return "zuperItemId";
  }
}

function sourceLabel(source: SyncSource): string {
  switch (source) {
    case "zoho": return "ZOHO_SYNC";
    case "hubspot": return "HUBSPOT_SYNC";
    case "zuper": return "ZUPER_SYNC";
  }
}

// ── Per-Item Processing ──────────────────────────────────────────────────────

async function processItem(
  fields: ExternalProductFields,
  stats: SyncRunStats,
): Promise<void> {
  const idField = externalIdField(fields.source);

  // 1. Category resolution
  const category = resolveCategory(fields.source, fields.sourceCategory);

  if (category === "skip") {
    stats.skipped += 1;
    return;
  }

  if (!category) {
    // Route to review queue
    await createPendingReview(fields, "unknown_category", []);
    stats.flagged += 1;
    return;
  }

  // 2. Missing critical fields
  if (!fields.name && !fields.brand && !fields.model) {
    await createPendingReview(fields, "incomplete_data", []);
    stats.flagged += 1;
    return;
  }

  // 3. Canonical key dedup
  const cBrand = canonicalToken(fields.brand);
  const cModel = canonicalToken(fields.model);
  const canonicalKey = buildCanonicalKey(category, fields.brand, fields.model);

  if (canonicalKey) {
    // Exact match check
    const exactMatch = await prisma.internalProduct.findFirst({
      where: { canonicalKey },
    });

    if (exactMatch) {
      // Check if the external ID slot is empty
      const currentExternalId = exactMatch[idField];
      if (!currentExternalId) {
        // Auto-link
        await prisma.internalProduct.update({
          where: { id: exactMatch.id },
          data: { [idField]: fields.externalId },
        });
        // Push to any other missing systems
        await pushToMissingSystems(exactMatch.id).catch((err) =>
          stats.errors.push(`Outbound sync failed for linked product ${exactMatch.id}: ${err}`),
        );
        stats.linked += 1;
        return;
      } else if (currentExternalId !== fields.externalId) {
        // Canonical conflict — slot already occupied by different ID
        await createPendingReview(fields, "canonical_conflict", [exactMatch.id]);
        stats.flagged += 1;
        return;
      } else {
        // Already linked to this exact ID — skip
        stats.skipped += 1;
        return;
      }
    }

    // Ambiguous match check: same brand OR model in same-ish space
    if (cBrand && cModel) {
      // Fetch all products with same brand for JS-side suffix comparison.
      // Scoped to same brand, so this is a small result set.
      const ambiguousCandidates = await prisma.internalProduct.findMany({
        where: {
          canonicalBrand: cBrand,
          canonicalModel: { not: null },
          // Exclude exact canonical key match (already handled above)
          NOT: canonicalKey ? { canonicalKey } : undefined,
        },
        select: { id: true, canonicalModel: true, category: true },
        take: 50,
      });

      // Bidirectional suffix check + cross-category exact match
      const filtered = ambiguousCandidates.filter((c) => {
        if (!c.canonicalModel) return false;
        // Same brand+model but different category
        if (c.canonicalModel === cModel && c.category !== category) return true;
        // Either direction: one is a prefix of the other (suffix variant)
        if (c.canonicalModel !== cModel) {
          return cModel.startsWith(c.canonicalModel) || c.canonicalModel.startsWith(cModel);
        }
        return false;
      });

      if (filtered.length > 0) {
        await createPendingReview(
          fields,
          "ambiguous_match",
          filtered.map((c) => c.id),
        );
        stats.flagged += 1;
        return;
      }
    }
  }

  // 4. No match — create new InternalProduct
  try {
    const newProduct = await prisma.internalProduct.create({
      data: {
        category: category as never,
        brand: fields.brand || "Unknown",
        model: fields.model || fields.name || "Unknown",
        name: fields.name || undefined,
        description: fields.description || undefined,
        sku: fields.sku || undefined,
        unitCost: fields.unitCost,
        sellPrice: fields.sellPrice,
        [idField]: fields.externalId,
        canonicalBrand: cBrand || undefined,
        canonicalModel: cModel || undefined,
        canonicalKey: canonicalKey || undefined,
      },
    });

    // Push to missing systems
    await pushToMissingSystems(newProduct.id).catch((err) =>
      stats.errors.push(`Outbound sync failed for new product ${newProduct.id}: ${err}`),
    );

    stats.imported += 1;
  } catch (error) {
    // Handle unique constraint violation (race condition safety net)
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      stats.skipped += 1;
      return;
    }
    throw error;
  }
}

async function createPendingReview(
  fields: ExternalProductFields,
  reason: string,
  candidateIds: string[],
): Promise<void> {
  const idField = externalIdField(fields.source);

  await prisma.pendingCatalogPush.create({
    data: {
      brand: fields.brand || "Unknown",
      model: fields.model || fields.name || "Unknown",
      name: fields.name || undefined,
      description: fields.description || "",
      category: fields.sourceCategory || "UNKNOWN",
      sku: fields.sku || undefined,
      unitCost: fields.unitCost,
      sellPrice: fields.sellPrice,
      metadata: fields.rawMetadata,
      systems: ["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER"],
      requestedBy: "product-sync@system",
      source: sourceLabel(fields.source),
      reviewReason: reason,
      candidateSkuIds: candidateIds,
      [idField]: fields.externalId,
    },
  });
}

// ── Known External IDs ───────────────────────────────────────────────────────

async function getKnownExternalIds(field: "zohoItemId" | "hubspotProductId" | "zuperItemId"): Promise<Set<string>> {
  const [products, pending] = await Promise.all([
    prisma.internalProduct.findMany({
      where: { [field]: { not: null } },
      select: { [field]: true },
    }),
    prisma.pendingCatalogPush.findMany({
      where: { [field]: { not: null } },
      select: { [field]: true },
    }),
  ]);

  const ids = new Set<string>();
  for (const p of products) {
    const val = (p as Record<string, unknown>)[field];
    if (typeof val === "string") ids.add(val);
  }
  for (const p of pending) {
    const val = (p as Record<string, unknown>)[field];
    if (typeof val === "string") ids.add(val);
  }
  return ids;
}

// ── Main Orchestrator ────────────────────────────────────────────────────────

export async function runProductSync(options: SyncRunOptions): Promise<{
  id: string;
  stats: SyncRunStats;
}> {
  // 1. Mark stale runs as failed (>5 min without completing)
  await prisma.productSyncRun.updateMany({
    where: {
      lockSentinel: "ACTIVE",
      startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) },
    },
    data: {
      completedAt: new Date(),
      lockSentinel: null,
      errors: JSON.stringify(["Marked as failed: exceeded 5-minute timeout"]),
    },
  });

  // 2. Atomically create run record — the unique index on lockSentinel
  //    ensures only one row with lockSentinel="ACTIVE" can exist at a time.
  //    If another run is active, the create will throw P2002.
  let run: { id: string };
  try {
    run = await prisma.productSyncRun.create({
      data: {
        trigger: options.trigger,
        triggeredBy: options.triggeredBy,
        lockSentinel: "ACTIVE",  // no schema default — explicit on create
      },
    });
  } catch (error) {
    // Prisma P2002 = unique constraint violation on lockSentinel
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      throw new Error("Another product sync is already in progress");
    }
    throw error;
  }

  const stats: SyncRunStats = {
    zohoScanned: 0,
    hubspotScanned: 0,
    zuperScanned: 0,
    imported: 0,
    linked: 0,
    flagged: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // 4. Determine time window
    let since: Date | undefined;
    if (!options.backfill) {
      const lastSuccessful = await prisma.productSyncRun.findFirst({
        where: {
          completedAt: { not: null },
          errors: null,
          id: { not: run.id },
        },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true },
      });
      // First run: default to last 24 hours (not a full scan — use backfill for that)
      since = lastSuccessful?.startedAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
    }
    // backfill mode: since stays undefined = full scan

    // 5. Poll all three systems in parallel
    const [knownZoho, knownHubSpot, knownZuper] = await Promise.all([
      getKnownExternalIds("zohoItemId"),
      getKnownExternalIds("hubspotProductId"),
      getKnownExternalIds("zuperItemId"),
    ]);

    const [zohoItems, hubspotProducts, zuperProducts] = await Promise.allSettled([
      zohoInventory.listItemsSince(since).catch((err) => {
        stats.errors.push(`Zoho poll failed: ${err}`);
        return [] as ZohoInventoryItem[];
      }),
      listRecentHubSpotProducts(since).catch((err) => {
        stats.errors.push(`HubSpot poll failed: ${err}`);
        return [] as HubSpotProductRecord[];
      }),
      listRecentZuperProducts(since).catch((err) => {
        stats.errors.push(`Zuper poll failed: ${err}`);
        return [] as ZuperProductRecord[];
      }),
    ]);

    const zoho = zohoItems.status === "fulfilled" ? zohoItems.value : [];
    const hubspot = hubspotProducts.status === "fulfilled" ? hubspotProducts.value : [];
    const zuper = zuperProducts.status === "fulfilled" ? zuperProducts.value : [];

    stats.zohoScanned = zoho.length;
    stats.hubspotScanned = hubspot.length;
    stats.zuperScanned = zuper.length;

    // 6. Filter to unlinked items
    const unlinkedZoho = zoho.filter(
      (item) => item.item_id && !knownZoho.has(item.item_id),
    );
    const unlinkedHubSpot = hubspot.filter(
      (p) => p.id && !knownHubSpot.has(p.id),
    );
    const unlinkedZuper = zuper.filter(
      (p) => p.id && !knownZuper.has(p.id),
    );

    // 7. Process each unlinked item sequentially (to avoid DB race conditions)
    for (const item of unlinkedZoho) {
      try {
        await processItem(
          extractFieldsFromZohoItem(item as ZohoInventoryItem & { category_name?: string }),
          stats,
        );
      } catch (error) {
        stats.errors.push(`Zoho item ${item.item_id}: ${error}`);
      }
    }

    for (const product of unlinkedHubSpot) {
      try {
        await processItem(extractFieldsFromHubSpotProduct(product), stats);
      } catch (error) {
        stats.errors.push(`HubSpot product ${product.id}: ${error}`);
      }
    }

    for (const product of unlinkedZuper) {
      try {
        await processItem(extractFieldsFromZuperProduct(product), stats);
      } catch (error) {
        stats.errors.push(`Zuper product ${product.id}: ${error}`);
      }
    }
  } catch (fatalError) {
    // Capture fatal errors so the run is never marked as successful
    stats.errors.push(
      `Fatal: ${fatalError instanceof Error ? fatalError.message : String(fatalError)}`,
    );
    throw fatalError;
  } finally {
    // 8. Complete run record (releases the lock by clearing lockSentinel)
    await prisma.productSyncRun.update({
      where: { id: run.id },
      data: {
        completedAt: new Date(),
        lockSentinel: null,
        ...stats,
        errors: stats.errors.length > 0 ? JSON.stringify(stats.errors) : null,
      },
    });
  }

  return { id: run.id, stats };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/product-sync.test.ts --no-coverage`
Expected: All tests PASS.

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/product-sync.ts src/lib/product-sync-outbound.ts src/__tests__/product-sync.test.ts
git commit -m "feat(product-sync): add core sync orchestrator with field extraction tests"
```

---

## Chunk 4: API Routes and Vercel Config

### Task 8: Create cron endpoint

**Files:**
- Create: `src/app/api/cron/product-sync/route.ts`

- [ ] **Step 1: Create the cron route handler**

```typescript
// src/app/api/cron/product-sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { runProductSync } from "@/lib/product-sync";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, stats } = await runProductSync({ trigger: "cron" });

    return NextResponse.json({
      ok: true,
      runId: id,
      ...stats,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("already in progress")
    ) {
      return NextResponse.json({ ok: true, skipped: "lock_held" });
    }

    console.error("[cron/product-sync] Fatal error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/cron/product-sync/route.ts
git commit -m "feat(product-sync): add cron endpoint"
```

---

### Task 9: Create manual trigger endpoint

**Files:**
- Create: `src/app/api/inventory/product-sync/route.ts`

- [ ] **Step 1: Create the manual trigger route handler**

```typescript
// src/app/api/inventory/product-sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { runProductSync } from "@/lib/product-sync";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set([
  "ADMIN", "OWNER", "EXECUTIVE", "PROJECT_MANAGER", "OPERATIONS_MANAGER",
]);

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!ALLOWED_ROLES.has(authResult.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const backfill = url.searchParams.get("mode") === "backfill";

  try {
    const { id, stats } = await runProductSync({
      trigger: "manual",
      triggeredBy: authResult.email,
      backfill,
    });

    return NextResponse.json({
      ok: true,
      runId: id,
      backfill,
      ...stats,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("already in progress")
    ) {
      return NextResponse.json(
        { ok: false, error: "A sync is already in progress. Try again shortly." },
        { status: 409 },
      );
    }

    console.error("[inventory/product-sync] Fatal error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/inventory/product-sync/route.ts
git commit -m "feat(product-sync): add manual trigger endpoint with backfill mode"
```

---

### Task 10: Update vercel.json

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Add cron schedule and function timeout overrides**

Add to the `crons` array:
```json
{
  "path": "/api/cron/product-sync",
  "schedule": "*/15 * * * *"
}
```

Add to the `functions` object:
```json
"src/app/api/cron/product-sync/route.ts": {
  "maxDuration": 120
},
"src/app/api/inventory/product-sync/route.ts": {
  "maxDuration": 120
}
```

- [ ] **Step 2: Verify vercel.json is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat(product-sync): add cron schedule and function timeouts to vercel.json"
```

---

### Task 11: Verify full build

- [ ] **Step 1: Run Prisma generate + TypeScript check**

Run: `npx prisma generate && npx tsc --noEmit --pretty 2>&1 | tail -5`
Expected: No errors.

- [ ] **Step 2: Run all tests**

Run: `npx jest --no-coverage 2>&1 | tail -20`
Expected: All tests pass, including the new product-sync tests.

- [ ] **Step 3: Commit any fixes if needed**

---

## Chunk 5: Integration Testing and Smoke Test

### Task 12: Add integration-style test for the orchestrator

**Files:**
- Create: `src/__tests__/product-sync-integration.test.ts`

- [ ] **Step 1: Write an integration test that mocks external APIs**

This test mocks the Zoho/HubSpot/Zuper API calls but exercises the real DB logic (advisory lock, InternalProduct creation, PendingCatalogPush creation). Requires a test database.

```typescript
// src/__tests__/product-sync-integration.test.ts
import { prisma } from "@/lib/db";

// Skip if no test database configured
const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDb("product-sync integration", () => {
  beforeEach(async () => {
    // Clean up test data
    await prisma.productSyncRun.deleteMany({});
  });

  it("creates a ProductSyncRun record on execution", async () => {
    // This test validates the DB model works correctly
    const run = await prisma.productSyncRun.create({
      data: {
        trigger: "manual",
        triggeredBy: "test@example.com",
        zohoScanned: 10,
        hubspotScanned: 5,
        zuperScanned: 3,
        imported: 2,
        linked: 1,
        flagged: 3,
        skipped: 12,
        completedAt: new Date(),
      },
    });

    expect(run.id).toBeTruthy();
    expect(run.trigger).toBe("manual");
    expect(run.imported).toBe(2);

    // Verify index works by querying by startedAt
    const recent = await prisma.productSyncRun.findFirst({
      orderBy: { startedAt: "desc" },
    });
    expect(recent?.id).toBe(run.id);
  });

  it("active run prevents concurrent execution via unique constraint", async () => {
    // Create an active run with lockSentinel="ACTIVE"
    await prisma.productSyncRun.create({
      data: {
        trigger: "cron",
        lockSentinel: "ACTIVE",
      },
    });

    // A second create with lockSentinel="ACTIVE" should fail with P2002
    await expect(
      prisma.productSyncRun.create({
        data: { trigger: "cron", lockSentinel: "ACTIVE" },
      }),
    ).rejects.toThrow();
  });

  it("completed runs do not block new runs", async () => {
    // Create a completed run (lockSentinel is null — no schema default)
    await prisma.productSyncRun.create({
      data: {
        trigger: "cron",
        completedAt: new Date(),
        // lockSentinel omitted = null, so it won't hold the lock
      },
    });

    // A new active run should succeed
    const newRun = await prisma.productSyncRun.create({
      data: { trigger: "cron", lockSentinel: "ACTIVE" },
    });
    expect(newRun.id).toBeTruthy();
  });

  it("stale runs older than 5 min are cleaned up", async () => {
    // Create a stale run (started 10 min ago, never completed)
    await prisma.productSyncRun.create({
      data: {
        trigger: "cron",
        lockSentinel: "ACTIVE",
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    // Clean up stale runs (same logic as orchestrator)
    const updated = await prisma.productSyncRun.updateMany({
      where: {
        lockSentinel: "ACTIVE",
        startedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) },
      },
      data: {
        completedAt: new Date(),
        lockSentinel: null,
        errors: JSON.stringify(["Marked as failed: exceeded 5-minute timeout"]),
      },
    });

    expect(updated.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `npx jest src/__tests__/product-sync-integration.test.ts --no-coverage`
Expected: Tests pass (or skip if no DATABASE_URL).

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/product-sync-integration.test.ts
git commit -m "test(product-sync): add integration tests for DB model and advisory lock"
```

---

### Task 13: Final build and lint check

- [ ] **Step 1: Run full build**

Run: `npm run build 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 2: Run linter**

Run: `npm run lint 2>&1 | tail -10`
Expected: No errors (warnings are OK).

- [ ] **Step 3: Run all tests**

Run: `npm run test 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 4: Final commit if any fixes needed, then tag completion**

```bash
git add -A
git commit -m "feat(product-sync): cross-system product sync complete

Adds a cron-based poll (every 15 min) that detects products created
in Zoho, HubSpot, or Zuper that aren't in the internal catalog,
imports them as InternalProducts, and pushes to the other systems.

- Atomic advisory lock prevents concurrent runs
- Category mapping from all 3 systems (Zoho category_name, HubSpot
  product_category, Zuper category name)
- Canonical key dedup with conflict detection
- PendingCatalogPush review queue for ambiguous items
- Manual trigger with backfill mode
- ProductSyncRun tracking for history/debugging"
```

---

## Follow-Up: UI Tasks (separate plan)

The following UI additions from the spec are **not covered in this plan** and should be implemented in a follow-up after the backend is deployed and tested:

1. **"Sync Products" button** on the catalog page — calls `POST /api/inventory/product-sync`, shows result summary toast
2. **Badge/count** showing pending review items from external sync sources (`source IN ('ZOHO_SYNC', 'HUBSPOT_SYNC', 'ZUPER_SYNC')`)
3. **Sync history view** — recent `ProductSyncRun` results table (scanned/imported/linked/flagged counts)

These are frontend-only tasks that depend on the catalog page layout and will be planned after confirming the backend sync works correctly via the cron and manual API endpoints.
