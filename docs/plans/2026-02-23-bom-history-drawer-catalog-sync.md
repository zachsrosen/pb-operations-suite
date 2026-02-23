# Design: BOM History Drawer + Catalog Sync

**Date:** 2026-02-23
**Status:** Approved

---

## Overview

Three related BOM enhancements:

1. Replace the "BOM History" navigation button with an inline slide-over drawer
2. Add a contextual "push to systems" action on unmatched BOM rows (approval-gated)
3. New `/dashboards/catalog` page for equipment SKU management and approval queue

---

## 1 — BOM History Drawer

### Problem
The "⏱ BOM History" button currently navigates away from the BOM page to `/dashboards/bom/history`, losing the current BOM context.

### Solution
Replace the navigation with a right-side slide-over drawer (~480px wide) that opens over the current page.

### Behavior
- Button triggers `historyDrawerOpen` state (boolean), renders drawer
- Drawer content: search input + date-grouped rows (Today / Yesterday / This Week / Older), same data as `/api/bom/history/all`
- Clicking a row: loads that BOM into the page (same as current history page behavior), closes drawer
- Drawer closes via ✕ button or clicking the backdrop
- The existing per-deal "Extraction History" panel on the BOM page is unchanged
- `/dashboards/bom/history` route stays but the button no longer links to it

### Components
- Drawer: fixed overlay, `z-50`, backdrop `bg-black/40`, panel slides in from right
- Reuses `BomSnapshot` type and `relativeTime` / `getDateGroup` helpers (extract to shared util or inline)
- Fetches `/api/bom/history/all` when drawer opens (lazy — not on page load)

---

## 2 — Contextual "Push to Systems" on BOM Page

### Problem
When a BOM item has a red dot (not in internal catalog), there's no way to add it to any system from the BOM page.

### Solution
Per-row `+ Add` button (visible on hover for unmatched items) opens a confirmation modal pre-filled from the BOM row. Submitting creates a pending approval record — no API calls fire until an admin approves.

### Modal Fields
- Brand, Model, Description, Category (pre-filled, editable)
- Unit Spec / Unit Label (pre-filled if present)
- System checkboxes: ☑ Internal Catalog · ☑ Zoho Inventory · ☑ HubSpot Products · ☑ Zuper Parts
- Submit button: "Submit for Approval"

### Data Flow
1. User clicks Submit → `POST /api/catalog/push-requests` with item data + systems[] + dealId + bomItemId
2. API writes `PendingCatalogPush` row to Postgres (status: `PENDING`)
3. Toast: "Submitted for approval"
4. Admin sees pending count badge on Catalog nav item
5. Admin approves on `/dashboards/catalog` → API fires calls to selected systems → status → `APPROVED`
6. Admin rejects → status → `REJECTED`, optional note stored

### Visibility
- `+ Add` button visible to all roles
- Approval execution (actual system writes) restricted to ADMIN / OWNER / MANAGER roles

---

## 3 — Catalog Management Page

### Route
`/dashboards/catalog` — `DashboardShell` with `accentColor="cyan"`

### Two Tabs

#### Tab 1: Equipment SKUs
- Table of all `EquipmentSku` rows from Postgres
- Columns: Category · Brand · Model · Description · Unit Spec · Sync status badges
- Sync badges per row: Zoho ✓/✗ · HubSpot ✓/✗ · Zuper ✓/✗ (derived from nullable foreign-key fields on the sku row)
- Filter bar: category dropdown + search (brand / model / description)
- Per-row actions (admin only): "Push to missing" (immediate, no approval queue) · Edit · Delete
- "Add SKU" button (top right): opens same form modal as #2, but executes immediately for admins

#### Tab 2: Pending Approvals
- Table of `PendingCatalogPush` rows with status `PENDING`
- Columns: Item · Systems requested · Requested by · Deal · Time ago · Actions
- Actions: Approve (fires API calls, marks APPROVED) · Reject (marks REJECTED)
- Badge count on tab label showing pending count
- Empty state: "No pending requests"

### API Routes Needed
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/catalog/skus` | GET | List all EquipmentSkus (with filters) |
| `/api/catalog/skus` | POST | Create new EquipmentSku |
| `/api/catalog/skus/[id]` | PATCH | Update sku |
| `/api/catalog/skus/[id]` | DELETE | Delete sku |
| `/api/catalog/push-requests` | GET | List pending push requests |
| `/api/catalog/push-requests` | POST | Create push request (any role) |
| `/api/catalog/push-requests/[id]/approve` | POST | Execute push + mark approved (admin only) |
| `/api/catalog/push-requests/[id]/reject` | POST | Mark rejected (admin only) |
| `/api/catalog/push` | POST | Immediate push to systems (admin only, no queue) |

### Prisma Schema Additions
```prisma
model PendingCatalogPush {
  id          String   @id @default(cuid())
  status      PushStatus @default(PENDING)
  itemData    Json     // {brand, model, description, category, unitSpec, unitLabel}
  systems     String[] // ["INTERNAL","ZOHO","HUBSPOT","ZUPER"]
  requestedBy String   // user email
  dealId      String?
  note        String?  // rejection note
  createdAt   DateTime @default(now())
  resolvedAt  DateTime?
}

enum PushStatus {
  PENDING
  APPROVED
  REJECTED
}
```

---

## Out of Scope
- Editing items already synced to external systems (update propagation)
- Bulk push of multiple BOM rows at once
- Automated sync / polling from external systems back to internal catalog

---

## Implementation Order

1. BOM History drawer (self-contained, no schema changes)
2. Prisma schema + migration (`PendingCatalogPush`)
3. API routes for catalog
4. Catalog page (SKUs tab first, Pending tab second)
5. BOM page "push to systems" button + modal
