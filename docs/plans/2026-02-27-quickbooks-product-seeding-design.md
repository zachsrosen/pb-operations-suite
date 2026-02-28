# QuickBooks Product Seeding Design

**Date:** 2026-02-27
**Status:** Approved

## Problem

QuickBooks is the accounting system alongside Zoho Inventory. The product comparison dashboard and BOM tool already have QuickBooks columns, and `fetchQuickBooksProducts()` in the comparison API already does paginated QB API calls. However, QB API auth isn't configured yet, so the QB column is always empty.

The user has a QuickBooks product export (486 products, `.xls`) that needs to flow into the existing comparison and BOM pipelines immediately.

## Solution

Seed QuickBooks products into the `CatalogProduct` cache table, and wire QB into the existing cache hydration pipeline so the comparison dashboard and BOM tool show QB data without API credentials.

## Scope

### 1. Schema & Cache Pipeline

**Prisma:**
- Add `QUICKBOOKS` and `OPENSOLAR` to `CatalogProductSource` enum
- Create migration, regenerate Prisma client

**Comparison route** (`/api/products/comparison/route.ts`):
- Expand `CACHE_SOURCES` and `CacheSourceName` to include `"quickbooks"` and `"opensolar"`
- Add `QUICKBOOKS` and `OPENSOLAR` to `CACHE_SOURCE_ENUM`
- Fix `sourceFromCacheEnum()` — make all branches explicit, no default-to-zoho fallback
- Add `hydrateSourceWithCache("quickbooks", ...)` and `hydrateSourceWithCache("opensolar", ...)` calls
- Replace raw `quickbooksResult`/`opensolarResult` with `effectiveQuickbooksResult`/`effectiveOpensolarResult` in ALL downstream uses: `sourceResults`, `allProducts`, `productsBySource`, `summary.sourceCounts`, `health`, `warnings`

**Cache route** (`/api/products/cache/route.ts`):
- Add `quickbooks: "QUICKBOOKS"` and `opensolar: "OPENSOLAR"` to `SOURCE_ENUM`
- Fix `sourceToApiValue()` — explicit branches for all enum values, no default
- Update `summary.bySource` to include QB and OS counts
- Update error message for invalid source param

### 2. Seed Import

**Seed route** (`POST /api/products/seed`):
- Auth: `Authorization: Bearer $API_SECRET_TOKEN` (existing `api-auth.ts` support)
- Hardcoded `source = QUICKBOOKS` — client cannot override
- Zod-validated payload: array of `{ name, sku?, type?, price?, description? }`
- Deterministic `externalId`: use SKU when present; otherwise hash canonical inputs (trimmed, lowercased name + type + normalized numeric price + trimmed description) to prevent rerun duplicates
- Batch upserts: 200 per chunk
- Pre-check existing keys per chunk to accurately count `{ inserted, updated, skipped, errors }`
- Return summary response with counts

**CLI script** (`scripts/seed-qb-products.ts`):
- `xlsx` added as `devDependency` only
- Parses the QB `.xls` export
- Maps columns: Product/Service → name, SKU → sku, Type → type (status), Sales Price/Rate → price, Sales Description → description
- POSTs JSON array to `POST /api/products/seed` with bearer token auth
- Logs summary response

### 3. BOM Tool

No changes required. The BOM tool calls `/api/products/comparison` which will now include cached QB products. The existing `productMatchesBomItem()` fuzzy matcher is source-agnostic.

## Out of Scope

- OpenSolar seed data (enum added but no data import this round)
- Comparison route auth gate for non-admin BOM users (pre-existing issue)
- QB API OAuth setup (coming later; existing `fetchQuickBooksProducts()` will use it)

## Implementation Notes

1. `externalId` fallback must be canonical and stable: trim, lowercase, normalize numeric price (no trailing zeros) before hashing. Reruns must not create duplicates for formatting-only differences.
2. Upsert alone doesn't distinguish insert vs update. Pre-check existing `(source, externalId)` keys per chunk before upserting, then count accordingly.
3. All source mapping functions must be explicit — no catch-all defaults that silently map unknown sources to zoho.
