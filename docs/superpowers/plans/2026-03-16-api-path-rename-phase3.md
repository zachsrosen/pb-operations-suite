# API Path Rename (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the canonical API surface from `/api/inventory/skus/**` to `/api/inventory/products/**` (and `/api/inventory/sync-skus` → `/api/inventory/sync-products`), with thin compatibility wrappers at the old paths that keep existing bookmarks, external tools, and any delayed deploys working during transition.

**Architecture:** `git mv` each route file to the new `products/` directory tree, then create a lightweight re-export wrapper at the old `skus/` path. Internal fetch callers are updated to the new canonical URL in the same PR. The wrappers are pure named re-exports — zero logic, zero divergence risk. Removal is safe once one full release cycle passes with no external traffic on old paths.

**Tech Stack:** Next.js 16.1 App Router, TypeScript 5

**Depends on:** Phase 1 (logical model rename, PR #87) ✅ and Phase 2 (UI language rename, PR #90) ✅

---

## Route Inventory

**11 route files to migrate** (3,276 lines total, all under `src/app/api/inventory/`):

| # | Current Path | Methods | Config Exports | Lines |
|---|---|---|---|---|
| 1 | `skus/route.ts` | GET, POST, PATCH, DELETE | — | 1118 |
| 2 | `skus/stats/route.ts` | GET | — | 132 |
| 3 | `skus/merge/route.ts` | POST | — | 284 |
| 4 | `skus/sync-enabled/route.ts` | GET | runtime | 11 |
| 5 | `skus/sync-bulk/route.ts` | POST | runtime, maxDuration | 616 |
| 6 | `skus/sync-bulk/confirm/route.ts` | POST | runtime | 86 |
| 7 | `skus/sync-hubspot-bulk/route.ts` | POST | runtime, maxDuration | 519 |
| 8 | `skus/sync-hubspot-bulk/confirm/route.ts` | POST | runtime | 54 |
| 9 | `skus/[id]/sync/route.ts` | GET, POST | runtime, maxDuration | 174 |
| 10 | `skus/[id]/sync/confirm/route.ts` | POST | runtime | 75 |
| 11 | `sync-skus/route.ts` | POST | — | 207 |

## Caller Inventory

**21 internal fetch calls** across 7 files:

| File | Calls | Routes Hit |
|---|---|---|
| `dashboards/catalog/page.tsx` | 8 | skus (GET, PATCH, DELETE), sync-enabled, stats, sync-bulk, sync-bulk/confirm |
| `dashboards/catalog/edit/[id]/page.tsx` | 3 | skus (GET, PATCH, DELETE) |
| `dashboards/product-comparison/page.tsx` | 3 | skus (PATCH, POST), merge |
| `dashboards/inventory/page.tsx` | 2 | skus (GET), sync-skus (POST) |
| `dashboards/bom/page.tsx` | 1 | skus (GET) |
| `components/catalog/SyncModal.tsx` | 3 | [id]/sync (GET, POST), [id]/sync/confirm |
| `components/catalog/BasicsStep.tsx` | 1 | merge |

## Key Design Decisions

1. **Pure re-exports for wrappers.** No wrapper logic, no deprecation headers, no logging. The wrappers are `export { GET, POST } from "…"` — identical behavior guaranteed. Removal is primarily time-based (one release cycle minimum), with a Vercel access-log spot-check to confirm no unexpected external traffic before deleting.

2. **`git mv` preserves blame.** Moving files instead of copy-and-delete keeps `git log --follow` intact for the 3,276 lines of handler code.

3. **`requestPath` in logActivity calls.** The main `route.ts` and `merge/route.ts` already use `request.nextUrl.pathname` (dynamic). Only `sync-skus/route.ts` has a hardcoded `requestPath` string to update. After migration, calls via the old wrapper path will log the old URL (since `request.nextUrl.pathname` reflects the matched URL) — this is fine and actually helpful for tracking wrapper usage in logs.

4. **No conflict with `/api/products/`.** The existing `/api/products/` routes (comparison, cleanup, link-diagnostics) are a separate namespace from `/api/inventory/products/`.

5. **Doc comments updated.** JSDoc route-path comments in canonical files updated from `/api/inventory/skus` to `/api/inventory/products`.

---

## Chunk 1: Route Migration

### Task 1: Move all `skus/` routes to `products/` and create wrappers

**Files:**
- Move: all 10 files under `src/app/api/inventory/skus/` → `src/app/api/inventory/products/`
- Create: 10 wrapper files at original `src/app/api/inventory/skus/` paths

This is one atomic operation: move the directory, then recreate wrapper files at every old path. Build must stay green.

- [ ] **Step 1: Move the `skus/` directory to `products/`**

```bash
cd src/app/api/inventory
git mv skus products
```

This moves the entire directory tree, preserving all 10 route files with git history.

- [ ] **Step 2: Create wrapper for `skus/route.ts`**

Create `src/app/api/inventory/skus/route.ts`:

```typescript
/**
 * @deprecated Use /api/inventory/products instead.
 * Compatibility wrapper — will be removed after one release cycle.
 */
export { GET, POST, PATCH, DELETE } from "@/app/api/inventory/products/route";
```

- [ ] **Step 3: Create wrapper for `skus/stats/route.ts`**

Create `src/app/api/inventory/skus/stats/route.ts`:

```typescript
/**
 * @deprecated Use /api/inventory/products/stats instead.
 */
export { GET } from "@/app/api/inventory/products/stats/route";
```

- [ ] **Step 4: Create wrapper for `skus/merge/route.ts`**

Create `src/app/api/inventory/skus/merge/route.ts`:

```typescript
/**
 * @deprecated Use /api/inventory/products/merge instead.
 */
export { POST } from "@/app/api/inventory/products/merge/route";
```

- [ ] **Step 5: Create wrapper for `skus/sync-enabled/route.ts`**

Create `src/app/api/inventory/skus/sync-enabled/route.ts`:

```typescript
/**
 * @deprecated Use /api/inventory/products/sync-enabled instead.
 */
export { GET, runtime } from "@/app/api/inventory/products/sync-enabled/route";
```

- [ ] **Step 6: Create wrapper for `skus/sync-bulk/route.ts`**

Create `src/app/api/inventory/skus/sync-bulk/route.ts`:

```typescript
/**
 * @deprecated Use /api/inventory/products/sync-bulk instead.
 */
export { POST, runtime, maxDuration } from "@/app/api/inventory/products/sync-bulk/route";
```

- [ ] **Step 7: Create wrapper for `skus/sync-bulk/confirm/route.ts`**

Create `src/app/api/inventory/skus/sync-bulk/confirm/route.ts`:

```typescript
/**
 * @deprecated Use /api/inventory/products/sync-bulk/confirm instead.
 */
export { POST, runtime } from "@/app/api/inventory/products/sync-bulk/confirm/route";
```

- [ ] **Step 8: Create wrapper for `skus/sync-hubspot-bulk/route.ts`**

Create `src/app/api/inventory/skus/sync-hubspot-bulk/route.ts`:

```typescript
/**
 * @deprecated Use /api/inventory/products/sync-hubspot-bulk instead.
 */
export { POST, runtime, maxDuration } from "@/app/api/inventory/products/sync-hubspot-bulk/route";
```

- [ ] **Step 9: Create wrapper for `skus/sync-hubspot-bulk/confirm/route.ts`**

Create `src/app/api/inventory/skus/sync-hubspot-bulk/confirm/route.ts`:

```typescript
/**
 * @deprecated Use /api/inventory/products/sync-hubspot-bulk/confirm instead.
 */
export { POST, runtime } from "@/app/api/inventory/products/sync-hubspot-bulk/confirm/route";
```

- [ ] **Step 10: Create wrapper for `skus/[id]/sync/route.ts`**

Create `src/app/api/inventory/skus/[id]/sync/route.ts`:

```typescript
/**
 * @deprecated Use /api/inventory/products/[id]/sync instead.
 */
export { GET, POST, runtime, maxDuration } from "@/app/api/inventory/products/[id]/sync/route";
```

- [ ] **Step 11: Create wrapper for `skus/[id]/sync/confirm/route.ts`**

Create `src/app/api/inventory/skus/[id]/sync/confirm/route.ts`:

```typescript
/**
 * @deprecated Use /api/inventory/products/[id]/sync/confirm instead.
 */
export { POST, runtime } from "@/app/api/inventory/products/[id]/sync/confirm/route";
```

- [ ] **Step 12: Verify build passes**

```bash
npm run build
```

Expected: Clean build. Both `/api/inventory/skus/**` (wrappers) and `/api/inventory/products/**` (canonical) resolve.

- [ ] **Step 13: Commit**

```bash
git add -A src/app/api/inventory/products/ src/app/api/inventory/skus/
git commit -m "refactor: move inventory SKU routes to /api/inventory/products/ with compat wrappers"
```

### Task 2: Move `sync-skus/` route to `sync-products/` and create wrapper

**Files:**
- Move: `src/app/api/inventory/sync-skus/route.ts` → `src/app/api/inventory/sync-products/route.ts`
- Create: `src/app/api/inventory/sync-skus/route.ts` (wrapper)
- Modify: `src/app/api/inventory/sync-products/route.ts` (update hardcoded requestPath)

- [ ] **Step 1: Move the directory**

```bash
cd src/app/api/inventory
git mv sync-skus sync-products
```

- [ ] **Step 2: Create wrapper at old path**

Create `src/app/api/inventory/sync-skus/route.ts`:

```typescript
/**
 * @deprecated Use /api/inventory/sync-products instead.
 * Compatibility wrapper — will be removed after one release cycle.
 */
export { POST } from "@/app/api/inventory/sync-products/route";
```

- [ ] **Step 3: Update hardcoded requestPath in canonical file**

In `src/app/api/inventory/sync-products/route.ts`, change:

```
requestPath: "/api/inventory/sync-skus",
```

to:

```
requestPath: "/api/inventory/sync-products",
```

This is the only hardcoded requestPath across all 11 route files — the others use `request.nextUrl.pathname`.

- [ ] **Step 4: Verify build passes**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add -A src/app/api/inventory/sync-products/ src/app/api/inventory/sync-skus/
git commit -m "refactor: move sync-skus route to /api/inventory/sync-products/ with compat wrapper"
```

---

## Chunk 2: Update JSDoc Comments in Canonical Files

### Task 3: Update doc comments in canonical route files

**Files:**
- Modify: `src/app/api/inventory/products/route.ts`
- Modify: `src/app/api/inventory/products/stats/route.ts`
- Modify: `src/app/api/inventory/sync-products/route.ts`

The canonical files still have JSDoc headers referencing `/api/inventory/skus`. Update them to reflect the new paths. Only doc comments — no logic changes.

- [ ] **Step 1: Update doc comments in `products/route.ts`**

Old (lines 1–7):
```
/**
 * Inventory SKU API
 *
 * GET    /api/inventory/skus - List SKUs with optional filtering
 * POST   /api/inventory/skus - Create or upsert a SKU (admin/manager only)
 * DELETE /api/inventory/skus - Permanently delete a SKU (admin only)
 */
```

New:
```
/**
 * Inventory Products API
 *
 * GET    /api/inventory/products - List products with optional filtering
 * POST   /api/inventory/products - Create or upsert a product (admin/manager only)
 * DELETE /api/inventory/products - Permanently delete a product (admin only)
 */
```

Also update the inline JSDoc blocks at lines ~311, ~457, ~705, ~996:
- `GET /api/inventory/skus` → `GET /api/inventory/products`
- `POST /api/inventory/skus` → `POST /api/inventory/products`
- `PATCH /api/inventory/skus` → `PATCH /api/inventory/products`
- `DELETE /api/inventory/skus` → `DELETE /api/inventory/products`

- [ ] **Step 2: Update doc comment in `products/stats/route.ts`**

Old (line 4):
```
 * GET /api/inventory/skus/stats — per-category sync health breakdown
```

New:
```
 * GET /api/inventory/products/stats — per-category sync health breakdown
```

- [ ] **Step 3: Update doc comment in `sync-products/route.ts`**

Old (lines 1–8):
```
/**
 * Inventory SKU Sync API
 *
 * POST /api/inventory/sync-skus
 *   Scans all equipment-context HubSpot projects and upserts unique SKUs
 *   into the InternalProduct table. Returns counts of created/existing/total.
 *   Auth required, roles: ADMIN, OWNER, PROJECT_MANAGER
 */
```

New:
```
/**
 * Inventory Product Sync API
 *
 * POST /api/inventory/sync-products
 *   Scans all equipment-context HubSpot projects and upserts unique products
 *   into the InternalProduct table. Returns counts of created/existing/total.
 *   Auth required, roles: ADMIN, OWNER, PROJECT_MANAGER
 */
```

- [ ] **Step 4: Verify build passes**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/inventory/products/route.ts src/app/api/inventory/products/stats/route.ts src/app/api/inventory/sync-products/route.ts
git commit -m "docs: update JSDoc route-path comments to /api/inventory/products"
```

---

## Chunk 3: Caller Migration

### Task 4: Update dashboard page callers — catalog pages

**Files:**
- Modify: `src/app/dashboards/catalog/page.tsx` (8 fetch calls)
- Modify: `src/app/dashboards/catalog/edit/[id]/page.tsx` (3 fetch calls)

These two files account for 11 of the 21 internal callers — the highest concentration.

- [ ] **Step 1: Update `catalog/page.tsx` fetch URLs**

Apply these exact string replacements:

| Approx Line | Old URL | New URL |
|---|---|---|
| 337 | `"/api/inventory/skus?active=false"` | `"/api/inventory/products?active=false"` |
| 369 | `"/api/inventory/skus"` (DELETE) | `"/api/inventory/products"` |
| 397 | `"/api/inventory/skus/sync-enabled"` | `"/api/inventory/products/sync-enabled"` |
| 414 | `"/api/inventory/skus/stats"` | `"/api/inventory/products/stats"` |
| 571 | `"/api/inventory/skus"` (PATCH) | `"/api/inventory/products"` |
| 814 | `"/api/inventory/skus/sync-bulk"` | `"/api/inventory/products/sync-bulk"` |
| 844 | `"/api/inventory/skus/sync-bulk/confirm"` | `"/api/inventory/products/sync-bulk/confirm"` |
| 872 | `"/api/inventory/skus/sync-bulk"` | `"/api/inventory/products/sync-bulk"` |

**Critical:** Match on the full fetch URL string, not just the path fragment. There are 8 occurrences total in this file.

- [ ] **Step 2: Update `catalog/edit/[id]/page.tsx` fetch URLs**

| Approx Line | Old URL | New URL |
|---|---|---|
| 115 | `"/api/inventory/skus?active=false"` | `"/api/inventory/products?active=false"` |
| 197 | `"/api/inventory/skus"` (PATCH) | `"/api/inventory/products"` |
| 227 | `"/api/inventory/skus"` (DELETE) | `"/api/inventory/products"` |

- [ ] **Step 3: Verify build passes**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/catalog/page.tsx src/app/dashboards/catalog/edit/\\[id\\]/page.tsx
git commit -m "refactor: update catalog page fetch URLs to /api/inventory/products"
```

### Task 5: Update dashboard page callers — remaining pages

**Files:**
- Modify: `src/app/dashboards/product-comparison/page.tsx` (3 fetch calls)
- Modify: `src/app/dashboards/inventory/page.tsx` (2 fetch calls)
- Modify: `src/app/dashboards/bom/page.tsx` (1 fetch call)

- [ ] **Step 1: Update `product-comparison/page.tsx` fetch URLs**

| Approx Line | Old URL | New URL |
|---|---|---|
| 903 | `"/api/inventory/skus"` (PATCH) | `"/api/inventory/products"` |
| 1083 | `"/api/inventory/skus"` (POST) | `"/api/inventory/products"` |
| 1170 | `"/api/inventory/skus/merge"` | `"/api/inventory/products/merge"` |

- [ ] **Step 2: Update `inventory/page.tsx` fetch URLs**

| Approx Line | Old URL | New URL |
|---|---|---|
| 1276 | `"/api/inventory/skus"` (GET) | `"/api/inventory/products"` |
| 1335 | `"/api/inventory/sync-skus"` (POST) | `"/api/inventory/sync-products"` |

- [ ] **Step 3: Update `bom/page.tsx` fetch URL**

| Approx Line | Old URL | New URL |
|---|---|---|
| 1095 | `"/api/inventory/skus?active=false"` | `"/api/inventory/products?active=false"` |

- [ ] **Step 4: Verify build passes**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/product-comparison/page.tsx src/app/dashboards/inventory/page.tsx src/app/dashboards/bom/page.tsx
git commit -m "refactor: update remaining dashboard fetch URLs to /api/inventory/products"
```

### Task 6: Update component callers

**Files:**
- Modify: `src/components/catalog/SyncModal.tsx` (3 fetch calls)
- Modify: `src/components/catalog/BasicsStep.tsx` (1 fetch call)

- [ ] **Step 1: Update `SyncModal.tsx` fetch URLs**

| Approx Line | Old URL | New URL |
|---|---|---|
| 62 | `` `/api/inventory/skus/${internalProductId}/sync` `` | `` `/api/inventory/products/${internalProductId}/sync` `` |
| 92 | `` `/api/inventory/skus/${internalProductId}/sync/confirm` `` | `` `/api/inventory/products/${internalProductId}/sync/confirm` `` |
| 104 | `` `/api/inventory/skus/${internalProductId}/sync` `` | `` `/api/inventory/products/${internalProductId}/sync` `` |

**Note:** These are template literals — replace `/api/inventory/skus/` with `/api/inventory/products/` within the backtick strings.

- [ ] **Step 2: Update `BasicsStep.tsx` fetch URL**

| Approx Line | Old URL | New URL |
|---|---|---|
| 74 | `"/api/inventory/skus/merge"` | `"/api/inventory/products/merge"` |

- [ ] **Step 3: Verify build passes**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/catalog/SyncModal.tsx src/components/catalog/BasicsStep.tsx
git commit -m "refactor: update component fetch URLs to /api/inventory/products"
```

---

## Chunk 4: Verification & Deprecation Criteria

### Task 7: Full verification sweep

No new files — this is a verification-only task. Confirm zero remaining references to old paths in caller code, and confirm wrappers correctly re-export everything.

- [ ] **Step 1: Grep for stale `/api/inventory/skus` in non-wrapper files**

```bash
# From project root — should find ONLY the wrapper files
grep -r "/api/inventory/skus" src/ --include="*.ts" --include="*.tsx" -l
```

Expected results (wrapper files only + one known historical exception):
```
src/app/api/inventory/skus/route.ts
src/app/api/inventory/skus/stats/route.ts
src/app/api/inventory/skus/merge/route.ts
src/app/api/inventory/skus/sync-enabled/route.ts
src/app/api/inventory/skus/sync-bulk/route.ts
src/app/api/inventory/skus/sync-bulk/confirm/route.ts
src/app/api/inventory/skus/sync-hubspot-bulk/route.ts
src/app/api/inventory/skus/sync-hubspot-bulk/confirm/route.ts
src/app/api/inventory/skus/[id]/sync/route.ts
src/app/api/inventory/skus/[id]/sync/confirm/route.ts
src/lib/product-updates.ts              ← historical changelog, DO NOT rewrite
```

**`src/lib/product-updates.ts`** contains a release-notes entry mentioning `/api/inventory/skus` as a historical record of what shipped. Per Phase 2 review decision, historical changelog entries are preserved as-is. This is NOT a runtime caller — ignore it.

If ANY dashboard page, component, or other lib file still references `/api/inventory/skus` — fix it before proceeding.

- [ ] **Step 2: Grep for stale `/api/inventory/sync-skus` in non-wrapper files**

```bash
grep -r "/api/inventory/sync-skus" src/ --include="*.ts" --include="*.tsx" -l
```

Expected: Only `src/app/api/inventory/sync-skus/route.ts` (the wrapper).

- [ ] **Step 3: Verify each wrapper re-exports all required symbols**

For each wrapper, confirm the exports match the canonical file:

| Wrapper | Must export |
|---|---|
| `skus/route.ts` | GET, POST, PATCH, DELETE |
| `skus/stats/route.ts` | GET |
| `skus/merge/route.ts` | POST |
| `skus/sync-enabled/route.ts` | GET, runtime |
| `skus/sync-bulk/route.ts` | POST, runtime, maxDuration |
| `skus/sync-bulk/confirm/route.ts` | POST, runtime |
| `skus/sync-hubspot-bulk/route.ts` | POST, runtime, maxDuration |
| `skus/sync-hubspot-bulk/confirm/route.ts` | POST, runtime |
| `skus/[id]/sync/route.ts` | GET, POST, runtime, maxDuration |
| `skus/[id]/sync/confirm/route.ts` | POST, runtime |
| `sync-skus/route.ts` | POST |

Open each wrapper file and verify the export list matches this table.

- [ ] **Step 4: Run `npm run build` for final verification**

```bash
npm run build
```

Expected: Clean build, zero errors.

- [ ] **Step 5: Run `npm run lint`**

```bash
npm run lint
```

Expected: No new lint errors from this change.

- [ ] **Step 6: Update skill reference docs**

Three files in the `planset-bom` skill bundle reference `/api/inventory/sync-skus`. Update all three to `/api/inventory/sync-products`. These are developer/agent-facing context, not runtime callers.

| File | Line | Old | New |
|---|---|---|---|
| `.claude/skills/planset-bom/references/bom-schema.md` | 5 | `/api/inventory/sync-skus` | `/api/inventory/sync-products` |
| `.claude/skills/planset-bom/SKILL.md` | 117 | `/api/inventory/sync-skus` | `/api/inventory/sync-products` |
| `.claude/skills/planset-bom/scripts/export-bom.py` | 178 | `/api/inventory/sync-skus` | `/api/inventory/sync-products` |

### Task 8: Write dual-path re-export tests

**Files:**
- Create: `src/__tests__/api/inventory/route-compat.test.ts`

These tests verify that every compatibility wrapper re-exports the exact same function references as the canonical routes. No HTTP mocking needed — just import identity checks.

- [ ] **Step 1: Write the re-export identity tests**

Create `src/__tests__/api/inventory/route-compat.test.ts`:

```typescript
/**
 * Compatibility wrapper tests
 *
 * Verify that deprecated /api/inventory/skus/** wrappers re-export
 * the identical handler functions from /api/inventory/products/**.
 * These are import identity checks — no HTTP calls, no mocking.
 */

import * as canonicalMain from "@/app/api/inventory/products/route";
import * as compatMain from "@/app/api/inventory/skus/route";

import * as canonicalStats from "@/app/api/inventory/products/stats/route";
import * as compatStats from "@/app/api/inventory/skus/stats/route";

import * as canonicalMerge from "@/app/api/inventory/products/merge/route";
import * as compatMerge from "@/app/api/inventory/skus/merge/route";

import * as canonicalSyncEnabled from "@/app/api/inventory/products/sync-enabled/route";
import * as compatSyncEnabled from "@/app/api/inventory/skus/sync-enabled/route";

import * as canonicalSyncBulk from "@/app/api/inventory/products/sync-bulk/route";
import * as compatSyncBulk from "@/app/api/inventory/skus/sync-bulk/route";

import * as canonicalSyncBulkConfirm from "@/app/api/inventory/products/sync-bulk/confirm/route";
import * as compatSyncBulkConfirm from "@/app/api/inventory/skus/sync-bulk/confirm/route";

import * as canonicalSyncHubspotBulk from "@/app/api/inventory/products/sync-hubspot-bulk/route";
import * as compatSyncHubspotBulk from "@/app/api/inventory/skus/sync-hubspot-bulk/route";

import * as canonicalSyncHubspotBulkConfirm from "@/app/api/inventory/products/sync-hubspot-bulk/confirm/route";
import * as compatSyncHubspotBulkConfirm from "@/app/api/inventory/skus/sync-hubspot-bulk/confirm/route";

import * as canonicalIdSync from "@/app/api/inventory/products/[id]/sync/route";
import * as compatIdSync from "@/app/api/inventory/skus/[id]/sync/route";

import * as canonicalIdSyncConfirm from "@/app/api/inventory/products/[id]/sync/confirm/route";
import * as compatIdSyncConfirm from "@/app/api/inventory/skus/[id]/sync/confirm/route";

import * as canonicalSyncProducts from "@/app/api/inventory/sync-products/route";
import * as compatSyncSkus from "@/app/api/inventory/sync-skus/route";

describe("/api/inventory/skus → /api/inventory/products compat wrappers", () => {
  test("main route: GET, POST, PATCH, DELETE", () => {
    expect(compatMain.GET).toBe(canonicalMain.GET);
    expect(compatMain.POST).toBe(canonicalMain.POST);
    expect(compatMain.PATCH).toBe(canonicalMain.PATCH);
    expect(compatMain.DELETE).toBe(canonicalMain.DELETE);
  });

  test("stats route: GET", () => {
    expect(compatStats.GET).toBe(canonicalStats.GET);
  });

  test("merge route: POST", () => {
    expect(compatMerge.POST).toBe(canonicalMerge.POST);
  });

  test("sync-enabled route: GET, runtime", () => {
    expect(compatSyncEnabled.GET).toBe(canonicalSyncEnabled.GET);
    expect(compatSyncEnabled.runtime).toBe(canonicalSyncEnabled.runtime);
  });

  test("sync-bulk route: POST, runtime, maxDuration", () => {
    expect(compatSyncBulk.POST).toBe(canonicalSyncBulk.POST);
    expect(compatSyncBulk.runtime).toBe(canonicalSyncBulk.runtime);
    expect(compatSyncBulk.maxDuration).toBe(canonicalSyncBulk.maxDuration);
  });

  test("sync-bulk/confirm route: POST, runtime", () => {
    expect(compatSyncBulkConfirm.POST).toBe(canonicalSyncBulkConfirm.POST);
    expect(compatSyncBulkConfirm.runtime).toBe(canonicalSyncBulkConfirm.runtime);
  });

  test("sync-hubspot-bulk route: POST, runtime, maxDuration", () => {
    expect(compatSyncHubspotBulk.POST).toBe(canonicalSyncHubspotBulk.POST);
    expect(compatSyncHubspotBulk.runtime).toBe(canonicalSyncHubspotBulk.runtime);
    expect(compatSyncHubspotBulk.maxDuration).toBe(canonicalSyncHubspotBulk.maxDuration);
  });

  test("sync-hubspot-bulk/confirm route: POST, runtime", () => {
    expect(compatSyncHubspotBulkConfirm.POST).toBe(canonicalSyncHubspotBulkConfirm.POST);
    expect(compatSyncHubspotBulkConfirm.runtime).toBe(canonicalSyncHubspotBulkConfirm.runtime);
  });

  test("[id]/sync route: GET, POST, runtime, maxDuration", () => {
    expect(compatIdSync.GET).toBe(canonicalIdSync.GET);
    expect(compatIdSync.POST).toBe(canonicalIdSync.POST);
    expect(compatIdSync.runtime).toBe(canonicalIdSync.runtime);
    expect(compatIdSync.maxDuration).toBe(canonicalIdSync.maxDuration);
  });

  test("[id]/sync/confirm route: POST, runtime", () => {
    expect(compatIdSyncConfirm.POST).toBe(canonicalIdSyncConfirm.POST);
    expect(compatIdSyncConfirm.runtime).toBe(canonicalIdSyncConfirm.runtime);
  });

  test("sync-skus → sync-products: POST", () => {
    expect(compatSyncSkus.POST).toBe(canonicalSyncProducts.POST);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm run test -- src/__tests__/api/inventory/route-compat.test.ts
```

Expected: All 11 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/api/inventory/route-compat.test.ts
git commit -m "test: add re-export identity tests for inventory route compat wrappers"
```

---

## Deprecation & Removal Criteria

The compatibility wrappers are **temporary**. Remove them when ALL of these are true:

1. **One full release cycle** has passed since this PR merged (minimum 2 weeks)
2. **All internal callers** point to `/api/inventory/products/**` (verified in Task 7)
3. **No external integrations** hit the old paths — check Vercel access logs for `/api/inventory/skus` traffic
4. **Phase 4** (physical DB rename) is not in active development — avoid stacking path changes and DB changes simultaneously

**To remove:** Delete all 11 wrapper files under `src/app/api/inventory/skus/` and `src/app/api/inventory/sync-skus/`, delete `route-compat.test.ts`, and verify build passes.
