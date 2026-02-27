# Catalog SKU Hard Delete — Design Doc

**Date:** 2026-02-27
**Scope:** Step 4 of catalog hardening plan
**Branch:** `feat/catalog-delete`

## Problem

Junk and test SKUs accumulate in the catalog with no way to permanently remove them. The existing `isActive` toggle hides them from default views but the records persist. ADMIN users need a way to hard-delete SKUs with an audit trail.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Delete type | Hard delete with audit log | Junk cleanup doesn't need reversibility; audit log provides accountability |
| Permissions | ADMIN only | Destructive permanent action — most restrictive role |
| External sync guard | 409 with `force` override | Warn but allow deletion of synced SKUs |
| ID transport | Path param (`/skus/[id]`) | More reliable across clients/proxies than body on DELETE |
| Transaction | Atomic Prisma `$transaction` | Snapshot, cleanup, and delete must be all-or-nothing |

## API

### `DELETE /api/inventory/skus/[id]/route.ts`

**Auth:** ADMIN role only (checked via `requireApiAuth`)

**Body:** `{ force?: boolean }` (defaults to `false`)

**Flow (single `$transaction`):**

1. `findUnique` SKU with all relations (specs, stock levels)
2. 404 if not found
3. Check `zohoItemId`, `hubspotProductId`, `zuperItemId` — if any set and `force !== true`:
   - Return `409 { warning: "SKU is synced to external systems.", syncedSystems: ["ZOHO", ...] }`
4. Count `PendingCatalogPush` rows referencing this SKU with status != `REJECTED` — if >0 and `force !== true`:
   - Return `409 { warning: "SKU has N pending push request(s).", pendingCount: N }`
5. Insert `CatalogAuditLog` row with full SKU snapshot
6. Set `PendingCatalogPush.internalSkuId = null` where it matches this SKU
7. Delete the SKU (Prisma cascade handles specs, stock, transactions)
8. Return `200 { deleted: true, auditLogId: "..." }`

### Response codes

| Code | Meaning |
|------|---------|
| 200 | Deleted successfully |
| 400 | Missing or invalid ID |
| 401 | Not authenticated |
| 403 | Not ADMIN role |
| 404 | SKU not found |
| 409 | Blocked — synced systems or pending pushes (re-send with `force: true`) |

## Database

### New model: `CatalogAuditLog`

```prisma
model CatalogAuditLog {
  id              String   @id @default(cuid())
  action          String   // "SKU_DELETE" — constrained at app level
  skuId           String   // original SKU id, preserved post-deletion
  snapshot        Json     // full SKU + specs + stock at deletion time
  deletedByUserId String   // user DB id (stable identifier)
  deletedByEmail  String   // user email at time of action (human-readable)
  createdAt       DateTime @default(now())
}
```

No migration to existing tables. All FK cascades on EquipmentSku relations (specs, stock, transactions) are already configured in the schema.

### FK strategy

No historical/financial tables have FK references to EquipmentSku:
- `ProjectBomSnapshot` stores denormalized JSON (no FK)
- `PendingCatalogPush.internalSkuId` is a plain string (no FK constraint) — nulled out in step 6

Cascade deletion will not corrupt reporting.

## UI

### Two-step server-authoritative flow

1. UI sends `DELETE /api/inventory/skus/:id` with `force: false`
2. If `200`: SKU deleted, show success toast
3. If `409`: open confirmation modal with server-provided warning details
4. On user confirm: re-send with `force: true`

This avoids UI/server drift — the server is the single source of truth for whether guards apply.

### Delete button placement

**Catalog list page (`catalog/page.tsx`):**
- Red "Delete" text button in actions column, next to Quick Edit / Full Edit
- Visible only to ADMIN role
- Clicking triggers the two-step flow above

**Full edit page (`catalog/edit/[id]/page.tsx`):**
- "Delete SKU" button at bottom of page, destructive styling (red outline)
- ADMIN only

### Confirmation modal

**Component:** `DeleteSkuModal` (new, in `src/components/catalog/`)

**Content:**
- SKU summary: category, brand, model
- If synced externally: amber warning banner listing systems from `syncedSystems`
- If pending push requests: warning line with count from `pendingCount`
- Text input: user must type the model name to confirm
  - Compare with `trim()` + case-insensitive match
  - Exact model shown above the input so user knows what to type
- "Delete permanently" button — disabled until model name matches, sends `force: true`

### Post-delete behavior

**List page:**
- Remove row from local state
- Recompute summary cards (total, synced counts, etc.) by re-fetching or decrementing
- Toast: "SKU deleted"

**Edit page:**
- `router.replace("/dashboards/catalog")` — replace, not push, so back button doesn't land on deleted SKU
- Toast: "SKU deleted"

## Testing

- API route tests: happy path, 409 guards (synced, pending pushes), force override, ADMIN-only auth, 404
- Audit log verification: snapshot contains full SKU data
- PendingCatalogPush nulling
- UI: modal renders warnings correctly, model-name confirmation gate works

## Out of scope

- Restore/undo capability
- Bulk delete
- Soft-delete-then-purge workflow
- Audit log viewer UI
