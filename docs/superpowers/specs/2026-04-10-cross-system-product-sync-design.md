# Cross-System Product Sync — Design Spec

**Date:** 2026-04-10
**Status:** Approved
**Author:** Zach + Claude

## Problem

Products created directly in Zoho Inventory, HubSpot, or Zuper don't flow back into the internal product catalog (InternalProduct) or to the other two systems. The current sync is outbound-only: InternalProduct → Zoho + HubSpot + Zuper. This leaves gaps where products exist in one external system but not the others.

## Solution

A scheduled poll (every 15 minutes) that scans all three external systems for unlinked products, imports them into InternalProduct, and pushes them outward to the other two systems via the existing `catalog-sync.ts` engine. A manual trigger provides on-demand sync.

## Architecture: Approach A — Cron-Based Poll + Existing Sync Engine

### Why this approach

- Reuses the existing outbound sync infrastructure (`catalog-sync.ts`, `zoho-inventory.ts`, `zuper-catalog.ts`)
- Simple and reliable — no webhook configuration in external systems
- Easy to debug — check cron logs and `ProductSyncRun` history
- 15-minute delay is acceptable for product creation volume

### Alternatives considered

- **Zoho webhook + sync engine** — near-instant but unreliable (missed events, manual Zoho admin setup, still needs poll as safety net)
- **Event-driven via Outbox pattern** — most robust but over-engineered for the volume of products being created

---

## Section 1: Polling & Detection

### Cron endpoint

`GET /api/cron/product-sync` — runs every 15 minutes via Vercel cron.

### Manual endpoint

`POST /api/inventory/product-sync` — same logic, triggered by button click in catalog UI.

### Auth

- Cron: `CRON_SECRET` bearer token (same pattern as existing crons)
- Manual: session-based, requires ADMIN / EXECUTIVE / PROJECT_MANAGER role (legacy `OWNER` normalizes to these)

### Concurrency — Atomic Sync Lock

Only one sync run at a time. Use a Postgres advisory lock (`pg_try_advisory_lock`) acquired at the start of each run:

1. Attempt `pg_try_advisory_lock(hash('product-sync'))` via `prisma.$queryRaw`
2. If lock not acquired → another run is in progress, exit immediately
3. If acquired → proceed with sync; lock is released automatically when the DB connection/transaction ends
4. As a safety net, also check for a `ProductSyncRun` with null `completedAt` older than 10 minutes and mark it as failed (handles cases where the process crashed without releasing the lock)

This prevents race conditions between concurrent cron and manual triggers, or Vercel retries.

### Detection logic

Polls all three systems in parallel. To limit API calls and avoid HubSpot's 10,000-result search cap, each system filters to **recently-created items** (since the last successful sync run's `startedAt`):

**First run / backfill:** The first run (no prior `ProductSyncRun` exists) performs a **full scan** of all three systems with no time filter. This is the one-time backfill that catches all existing unlinked products. Subsequent runs use time-bounded queries. An admin can also trigger a full backfill via `POST /api/inventory/product-sync?mode=backfill` to re-scan everything — useful if the time-bounded window missed items due to outages or clock skew.

1. **Zoho** — `listItems()` filtered by `last_modified_time` since last sync, then filter to items whose `item_id` is not in any InternalProduct's `zohoItemId` AND not in any PendingCatalogPush's `zohoItemId`
2. **HubSpot** — new `listRecentHubSpotProducts(since)` function using CRM v3 search API with `createdate` filter + cursor pagination, then filter to IDs not in any `hubspotProductId` AND not in PendingCatalogPush's `hubspotProductId`
3. **Zuper** — new `listRecentZuperProducts(since)` function with pagination, then filter to IDs not in any `zuperItemId` AND not in PendingCatalogPush's `zuperItemId`

**Note:** PendingCatalogPush external ID fields (`zohoItemId`, `hubspotProductId`, `zuperItemId`) must be populated at creation time (not just after approval) so they serve as a skip-list for both pending and rejected items.

### Per-item processing pipeline

For each unlinked item:

1. **Category resolution** — map source category to `EquipmentCategory` enum (see Category Mapping Table)
2. **Canonical key dedup** — `buildCanonicalKey(category, brand, model)` checked against existing InternalProducts
   - **Strong match** (exact canonical key) → auto-link the external ID to the existing InternalProduct, **but only if** the target external ID field is empty. If the matching InternalProduct already has a different `zohoItemId`/`hubspotProductId`/`zuperItemId` for the source system, route to PendingCatalogPush with `reviewReason: "canonical_conflict"` (indicates a possible external duplicate or data integrity issue)
   - **Ambiguous match** (same `canonicalBrand` + `canonicalModel` but different `category`, or same `canonicalBrand` with model differing only by suffix) → PendingCatalogPush with `reviewReason: "ambiguous_match"`
   - **No match + resolved category** → create new InternalProduct + outbound sync to the other 2 systems
   - **No match + unresolved category** → PendingCatalogPush with `reviewReason: "unknown_category"`

---

## Section 2: Category Mapping

### Zoho `category_name` → Internal Category

**Note:** Zoho has two classification fields: `group_name` (hierarchical item grouping, mostly empty in our data) and `category_name` (flat classification, well-populated). The reverse sync uses `category_name` for category inference. The outbound sync in `zoho-taxonomy.ts` uses `group_name` — these are independent mappings. The `category_name` field is already returned by the Zoho `/items` API but is not typed on `ZohoInventoryItem` — needs a type addition.

| Zoho `category_name` | → Internal Category | Type |
|---|---|---|
| `"Module"` | `MODULE` | Direct |
| `"Inverter"` | `INVERTER` | Direct |
| `"Tesla"` | `TESLA_SYSTEM_COMPONENTS` | Direct |
| `"Electrical Component"` | `ELECTRICAL_BOS` | Direct |
| `"Breaker"` | `ELECTRICAL_BOS` | Direct |
| `"Wire"` | `ELECTRICAL_BOS` | Direct |
| `"PVC"` | `ELECTRICAL_BOS` | Direct |
| `"Load Center"` | `ELECTRICAL_BOS` | Direct |
| `"Coupling"` | `ELECTRICAL_BOS` | Direct |
| `"Nipple"` | `ELECTRICAL_BOS` | Direct |
| `"Fuse"` | `ELECTRICAL_BOS` | Direct |
| `"Locknut"` | `ELECTRICAL_BOS` | Direct |
| `"Bushing"` | `ELECTRICAL_BOS` | Direct |
| `"Strap"` | `ELECTRICAL_BOS` | Direct |
| `"Fastener"` | `ELECTRICAL_BOS` | Direct |
| `"Screw"` | `ELECTRICAL_BOS` | Direct |
| `"Clamp - Electrical"` | `ELECTRICAL_BOS` | Direct |
| `"Clamp - Solar"` | `RACKING` | Direct |
| `"Service"` | `SERVICE` | Direct |
| `"Non-inventory"` | Skip | Skip |
| `"Solar Component"` | Manual review | Mixed |
| `"Other"` | Manual review | Mixed |
| `"(no category)"` | Manual review | Unknown |
| `"H2"` | Manual review | Unknown |

### HubSpot `product_category` → Internal Category

Uses existing `CATEGORY_CONFIGS` from `catalog-fields.ts`. Each config has a `hubspotValue` that maps directly:

| HubSpot `product_category` | → Internal Category |
|---|---|
| `"Module"` | `MODULE` |
| `"Inverter"` | `INVERTER` |
| `"Battery"` | `BATTERY` |
| `"Battery Expansion"` | `BATTERY_EXPANSION` |
| `"EV Charger"` | `EV_CHARGER` |
| `"Mounting Hardware"` | `RACKING` |
| `"Electrical Hardware"` | `ELECTRICAL_BOS` |
| `"Relay Device"` | `MONITORING` |
| `"Rapid Shutdown"` | `RAPID_SHUTDOWN` |
| `"Optimizer"` | `OPTIMIZER` |
| `"Gateway"` | `GATEWAY` |
| `"Tesla System Components"` | `TESLA_SYSTEM_COMPONENTS` |
| `"D&R"` | `D_AND_R` |
| `"Service"` | `SERVICE` |
| `"Adder"` | `ADDER_SERVICES` |
| `"Project Milestones"` | `PROJECT_MILESTONES` |

### Zuper category name → Internal Category

Uses existing `CATEGORY_CONFIGS` from `catalog-fields.ts`. Each config has a `zuperCategory` that maps directly (same table as HubSpot but using `zuperCategory` values).

---

## Section 3: Import & InternalProduct Creation

When a new unlinked item passes category resolution and dedup checks, the InternalProduct is created by mapping fields from the source system:

| InternalProduct field | From Zoho | From HubSpot | From Zuper |
|---|---|---|---|
| `category` | Mapped from `category_name` | From `product_category` | From category name |
| `brand` | `brand` or `manufacturer` | `manufacturer` | `brand` field |
| `model` | `part_number` or parsed from `name` | Parsed from `name` | `model` field |
| `name` | `name` | `name` | `name` |
| `description` | `description` | `description` | `description` |
| `sku` | `sku` | `hs_sku` | `sku` |
| `unitCost` | `purchase_rate` | `hs_cost_of_goods_sold` | `purchase_price` |
| `sellPrice` | `rate` | `price` | `price` |
| `zohoItemId` | `item_id` | — | — |
| `hubspotProductId` | — | product ID | — |
| `zuperItemId` | — | — | item ID |
| `canonicalBrand` | `canonicalToken(brand)` | `canonicalToken(manufacturer)` | `canonicalToken(brand)` |
| `canonicalModel` | `canonicalToken(model)` | `canonicalToken(model)` | `canonicalToken(model)` |
| `canonicalKey` | `buildCanonicalKey(...)` | `buildCanonicalKey(...)` | `buildCanonicalKey(...)` |

After creation, an outbound sync pushes to the **other two** systems (e.g., Zoho source → push to HubSpot + Zuper).

**Outbound sync for reverse-imported products:** The existing `catalog-sync.ts` create paths do not consistently pass all cross-link IDs and custom fields (e.g., `cf_internal_product_id` on Zoho, `internal_product_id` on Zuper). The implementation plan should include either a small `product-sync-outbound.ts` helper that wraps `catalog-sync.ts` with source-aware field population, or targeted enhancements to `catalog-sync.ts` itself to handle reverse-sync creates properly.

No spec table data is populated on import — just core fields. Specs can be added later via the catalog UI.

---

## Section 4: Review Queue

Items that can't be auto-imported route to the existing `PendingCatalogPush` table:

| Scenario | `source` | `reviewReason` | `status` |
|---|---|---|---|
| Unresolved category | `"ZOHO_SYNC"` / `"HUBSPOT_SYNC"` / `"ZUPER_SYNC"` | `"unknown_category"` | `PENDING` |
| Ambiguous dedup match | Same | `"ambiguous_match"` | `PENDING` |
| Canonical conflict (exact key match but external ID slot already occupied) | Same | `"canonical_conflict"` | `PENDING` |
| Missing critical fields (no name, no brand+model) | Same | `"incomplete_data"` | `PENDING` |

The review item stores:
- `brand`, `model`, `name`, `description` (empty string if source has none), `category` — snapshot from the source system
- `metadata` — raw source fields as JSON for reviewer context
- `candidateSkuIds` — potential InternalProduct matches (for ambiguous dedup)
- `systems` — `["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER"]`
- `requestedBy` — `"product-sync@system"` for cron-created entries (distinguishes from user-submitted push requests in the review UI)
- `zohoItemId` / `hubspotProductId` / `zuperItemId` — populated at creation time with the source system's external ID (serves as skip-list for future polls)

**Approval flow:** Admin assigns correct category, confirms/rejects dedup match → existing approval pipeline creates InternalProduct + outbound sync.

**Rejection flow:** Rejected items stay in PendingCatalogPush with `REJECTED` status. Their external IDs (already populated at creation) serve as a skip-list so the next poll doesn't re-flag them.

---

## Section 5: Sync Run Tracking

### New Prisma model

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
  imported       Int       @default(0) // auto-created InternalProducts
  linked         Int       @default(0) // auto-linked to existing
  flagged        Int       @default(0) // sent to review queue
  skipped        Int       @default(0) // already known
  errors         String?   // JSON array of error messages

  @@index([startedAt])
}
```

Each poll execution writes a row, giving a full history of sync activity.

---

## Section 6: Vercel Configuration

### Cron schedule

```json
{
  "path": "/api/cron/product-sync",
  "schedule": "*/15 * * * *"
}
```

### Function timeout

Set to 120s in `vercel.json` (three parallel API polls + per-item processing warrants extra headroom):

```json
"src/app/api/cron/product-sync/route.ts": { "maxDuration": 120 },
"src/app/api/inventory/product-sync/route.ts": { "maxDuration": 120 }
```

---

## Section 7: UI Additions

- **"Sync Products" button** on the catalog page — calls `POST /api/inventory/product-sync`, shows result summary
- **Badge/count** showing pending review items from external sync sources
- **Sync history view** — recent `ProductSyncRun` results (scanned/imported/linked/flagged counts)

---

## Section 8: Error Handling

- If one system fails (e.g., Zoho token expired), the other two still run
- Errors logged to `ProductSyncRun.errors` and Sentry
- No alerts on individual run failures — only if multiple consecutive runs fail (same pattern as `pipeline-health` cron)

---

## Data Flow Diagram

```
Every 15 min (cron) or on-demand (manual trigger)
         │
         ▼
┌─────────────────────────────────────────────┐
│  Poll all 3 systems in parallel             │
│  Zoho listItems() | HubSpot Products | Zuper│
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│  Filter to unlinked items                   │
│  (not in InternalProduct or PendingCatalog) │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│  For each unlinked item:                    │
│                                             │
│  1. Resolve category (mapping table)        │
│     ├─ Resolved → continue                  │
│     └─ Unresolved → PendingCatalogPush      │
│                                             │
│  2. Build canonical key, check dedup        │
│     ├─ Exact match → auto-link external ID  │
│     ├─ Ambiguous → PendingCatalogPush       │
│     └─ No match → create InternalProduct    │
│                                             │
│  3. Outbound sync to other 2 systems        │
│     (via existing catalog-sync.ts)          │
└─────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│  Write ProductSyncRun log                   │
└─────────────────────────────────────────────┘
```

---

## Files to Create/Modify

### New files
- `src/lib/product-sync.ts` — core sync logic (poll, detect, categorize, dedup, import)
- `src/lib/product-sync-categories.ts` — category mapping table (Zoho category_name → EquipmentCategory)
- `src/app/api/cron/product-sync/route.ts` — cron endpoint
- `src/app/api/inventory/product-sync/route.ts` — manual trigger endpoint

### Modified files
- `prisma/schema.prisma` — add `ProductSyncRun` model
- `vercel.json` — add cron schedule entry + function timeout overrides
- `src/lib/zoho-inventory.ts` — add `category_name` and `category_id` to `ZohoInventoryItem` type (already returned by API, just not typed); add `listItemsSince(since: Date)` method that passes `last_modified_time` query parameter to the `/items` endpoint for time-bounded polling
- `src/lib/hubspot.ts` — add `listRecentHubSpotProducts(since: Date)` function using CRM v3 search API (`POST /crm/v3/objects/products/search`) with `createdate` filter + `after` cursor pagination. Properties to fetch: `name`, `hs_sku`, `price`, `description`, `manufacturer`, `product_category`, `hs_cost_of_goods_sold`
- `src/lib/zuper-catalog.ts` — add `listRecentZuperProducts(since: Date)` function with pagination
- Catalog UI components — sync button, review badge, sync history (specific files TBD in implementation plan)

### Modified or extended
- `src/lib/catalog-sync.ts` — may need targeted enhancements for source-aware creates (cross-link IDs, custom fields); alternatively, a thin `product-sync-outbound.ts` wrapper handles this

### Existing code reused (no changes needed)
- `src/lib/canonical.ts` — canonical key building
- `src/lib/catalog-fields.ts` — category configs and mappings
- PendingCatalogPush model and existing review UI
