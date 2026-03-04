# Product Delete + Link Reliability Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this plan task-by-task.

Date: 2026-02-28  
Owner: Product Catalog / Operations Suite  
Status: Proposed (updated per review)

## 1) Objective

Ship a safe, auditable cleanup workflow for duplicate products (internal + external systems) and make product URLs reliably open the exact record in each system.

## 2) Review Decisions Locked

1. QuickBooks cleanup action in v1 is **archive/inactivate only**, never hard delete.
2. HubSpot cleanup action uses `DELETE` (soft archive), but UI defaults to **unlink-only**.
3. v1 excludes internal hard delete. v1 supports:
- unlink selected source IDs
- deactivate internal SKU
- external archive/delete per source
4. Duplicate cleanup stays in the existing comparison workflow (no separate queue page in v1).

## 3) Scope

### In scope (v1)
1. Internal cleanup actions:
- Deactivate internal SKU
- Unlink selected source IDs from internal SKU

2. External cleanup actions:
- HubSpot archive (soft delete)
- Zuper delete/archive (adapter-defined)
- Zoho delete/archive (adapter-defined)
- QuickBooks set inactive/archive

3. Optional cache cleanup:
- Remove `CatalogProduct` rows only after successful external action for that source.

4. UX:
- Batch cleanup from product comparison (duplicates queue)
- Single-item cleanup entry from catalog page

5. URL reliability:
- Centralized source URL builders
- Diagnostics endpoint for link quality

### Out of scope (v1)
1. Internal hard delete (planned v2)
2. OpenSolar cleanup action
3. Cancel/abort in-flight batch jobs (explicitly deferred)
4. New dedicated duplicate cleanup page

## 4) Safety Requirements

1. Default selected action in UI is `unlink only`.
2. No destructive external action without typed confirmation.
3. Per-batch limit: max `50` SKUs per API request.
4. Large UI selections are chunked client-side into batches of `<= 50`.
5. API and UI are both gated by `PRODUCT_CLEANUP_ENABLED`.
6. All outcomes are per-source/per-SKU, never one generic success.
7. All actions are logged in activity audit trail.

## 5) Design

## 5.1 API: `POST /api/products/cleanup`

Role: admin/owner only.  
Flag: returns `404` or `403` when `PRODUCT_CLEANUP_ENABLED` is false.

Request schema:
- `internalSkuIds: string[]` (1..50)
- `actions: {`
  - `internal: "none" | "deactivate"`
  - `links: "none" | "unlink_selected"`
  - `external: "none" | "delete_selected"`
  - `sources: Array<"hubspot" | "zuper" | "zoho" | "quickbooks">`
  - `deleteCachedProducts?: boolean`
- `}`
- `dryRun?: boolean`
- `confirmation: { token: string; issuedAt: number }`

Confirmation token:
- Server verifies HMAC/hash of `sortedSkuIds + actions + issuedAt`.
- Token expiry: `5 minutes` max.

Response schema:
- `summary: { total, succeeded, partial, failed }`
- `results: Array<{`
  - `internalSkuId`
  - `links: { status, changedFields[] }`
  - `externalBySource: Record<source, { status, externalId, message }>`
  - `internal: { status, message }`
  - `cache: { status, removedCount }`
- `}>`

Execution order per SKU:
1. Unlink internal fields (if requested)
2. External action (if requested and linked ID exists)
3. Internal deactivate (if requested)
4. Cache cleanup only for sources where external action was successful/idempotent (`deleted`, `archived`, `not_found`)

## 5.2 Adapter Layer: `src/lib/product-cleanup-adapters.ts`

Functions:
- `archiveHubSpotProduct(id)`
- `deleteOrArchiveZuperProduct(id)`
- `deleteOrArchiveZohoItem(id)`
- `archiveQuickBooksItem(id)`

Adapter result type:
- `status: "deleted" | "archived" | "not_found" | "failed" | "skipped"`
- `message: string`
- `httpStatus?: number`

Source-specific rules:
1. QuickBooks adapter returns `archived`, `not_found`, `failed`, or `skipped` (no `deleted`).
2. HubSpot uses archive semantics via `DELETE` endpoint.
3. `404` maps to `not_found` (idempotent-safe).

## 5.3 UI Behavior

Primary UI: `/dashboards/product-comparison`

1. Batch toolbar shown only when `PRODUCT_CLEANUP_ENABLED` is true.
2. Default action preset: unlink only.
3. External archive/delete toggles are opt-in and source-specific.
4. Confirmation modal shows:
- selected SKU count
- selected sources/actions
- typed confirmation input
5. Large selections are chunked by 50 and processed sequentially.
6. Results panel shows per-batch and per-SKU outcome; no page reset.

Secondary UI: `/dashboards/catalog`
- Per-row cleanup action opening same modal flow for one SKU.

## 5.4 URL Reliability

1. Use centralized builders in `src/lib/external-links.ts` only.
2. Add diagnostics endpoint:
- `GET /api/products/link-diagnostics?source=...&limit=...`
- Returns `externalId`, `storedUrl`, `generatedUrl`, `hasTemplate`, `likelyBroken`.
3. Support env templates:
- `ZUPER_PRODUCT_URL_TEMPLATE` (`{id}`)
- `ZOHO_INVENTORY_ITEM_URL_TEMPLATE` (`{id}`)
- `OPENSOLAR_PRODUCT_URL_TEMPLATE` (`{id}`)
- `QUICKBOOKS_ITEM_URL_TEMPLATE` (`{id}`, `{companyId}`)

## 6) Task Plan (Reordered)

### Task A (parallel): Source adapters
Files:
- `src/lib/product-cleanup-adapters.ts` (new)
- source libs as needed

Deliverables:
- typed result mapping
- idempotent 404 handling
- QuickBooks archive-only semantics

### Task B (parallel): Internal cleanup engine
Files:
- `src/lib/product-cleanup-engine.ts` (new)

Deliverables:
- unlink + deactivate core operations
- per-SKU result composition
- cache-cleanup post-external-success rule

### Task C: Cleanup route wiring
Files:
- `src/app/api/products/cleanup/route.ts` (new)
- optional `src/lib/schemas/product-cleanup.ts`

Deliverables:
- zod validation + max 50 enforcement
- confirmation token validation with 5-minute TTL
- feature-flag gate + role checks

### Task D: Comparison UI batch controls
Files:
- `src/app/dashboards/product-comparison/page.tsx`

Deliverables:
- cleanup toolbar + modal
- UI gating by `PRODUCT_CLEANUP_ENABLED`
- chunked execution and result rendering

### Task E: Catalog single-item cleanup entry
Files:
- `src/app/dashboards/catalog/page.tsx`

Deliverables:
- single SKU cleanup trigger using same flow

### Task F: Link diagnostics endpoint
Files:
- `src/app/api/products/link-diagnostics/route.ts` (new)

Deliverables:
- diagnostics payload for URL verification

### Task G: Tests
Files:
- `src/__tests__/api/products-cleanup.test.ts` (new)
- adapter tests

Required cases:
1. request > 50 SKUs rejected
2. invalid/expired confirmation token rejected
3. unlink-only does not call external adapters
4. external partial failure returns partial summary
5. QuickBooks returns archive semantics only
6. cache cleanup only occurs after successful/idempotent external outcome

## 7) Acceptance Criteria

1. Operators can batch cleanup duplicates without leaving comparison flow.
2. Default workflow is safe (`unlink only`).
3. No false success toasts; outcomes are explicit per source.
4. API rejects oversized batches and stale confirmation tokens.
5. All cleanup actions are auditable.
6. URL diagnostics quickly identifies broken source links.

## 8) Rollout

1. Deploy behind `PRODUCT_CLEANUP_ENABLED=false`.
2. Enable flag for admin-only environment.
3. Run dry-run on 50 duplicate rows.
4. Execute live cleanup in chunks of 25–50.
5. Monitor adapter error rates and tune source mappings.

## 9) Risks & Mitigations

1. External API variations by tenant:
- Mitigation: adapter fallbacks + normalized status mapping.

2. Accidental destructive actions:
- Mitigation: unlink default + explicit opt-in + typed confirmation.

3. Batch latency/timeouts:
- Mitigation: server cap 50 + client chunking.

4. No in-flight cancellation in v1:
- Mitigation: process in chunks and allow stop between chunks; full cancel token deferred to v2.
