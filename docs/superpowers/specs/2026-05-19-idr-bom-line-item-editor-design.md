# IDR Meeting BOM Review & Line Item Editor

**Date**: 2026-05-19
**Status**: Draft

## Problem

During IDR meetings, the team reviews projects but has no way to:
1. Add equipment items (backup switches, gateways, TRMs) to a deal's HubSpot line items
2. View or edit the BOM extracted from the planset PDF
3. Confirm the BOM matches what's actually in the planset before it gets pushed

Equipment additions and BOM review currently require leaving the meeting to use the BOM dashboard — breaking meeting flow.

## Solution

Add a collapsible "BOM Review" section to the IDR meeting ProjectDetail panel with two distinct sub-features:

1. **Line Item Quick Actions** — preset buttons and catalog search to add items directly to HubSpot deal line items
2. **BOM Extraction & Editor** — view/edit the Claude-extracted BOM from the planset, with optional push to HubSpot

## Architecture

### UI Layout

Inside `ProjectDetail.tsx`, below the existing Equipment tags section, a new collapsible `<BomReviewSection>`:

```
┌─ BOM Review ──────────────────────────────────────┐
│                                                    │
│  ── Line Item Quick Actions ──────────────────── │
│  [Add Backup Switch] [Add Backup Gateway] [Add TRM]│
│  [+/- Module Count]  [Add Item from Catalog...]    │
│                                                    │
│  Current Line Items:                               │
│  • REC 430W Alpha Pure-R x24                       │
│  • Enphase IQ8M-72-2-US x24                       │
│  • Enphase IQ Combiner 4C x1                      │
│  • Tesla Backup Switch x1  ← just added            │
│                                                    │
│  ── BOM Extraction ──────────────────────────── │
│  Status: Ready ✓                                   │
│  ┌──────────┬────────────────────┬─────┬────────┐ │
│  │ Category │ Brand / Model      │ Qty │ Action │ │
│  ├──────────┼────────────────────┼─────┼────────┤ │
│  │ MODULE   │ REC / REC430AA     │ 24  │ ✓ ✗ 🗑 │ │
│  │ INVERTER │ Enphase / IQ8M-72  │ 24  │ ✓ ✗ 🗑 │ │
│  │ ...      │                    │     │        │ │
│  └──────────┴────────────────────┴─────┴────────┘ │
│  [+ Add Row]                                       │
│  [Save Snapshot]  [Push to HubSpot]                │
│                                                    │
└────────────────────────────────────────────────────┘
```

### Component Hierarchy

```
ProjectDetail.tsx
  └─ BomReviewSection.tsx (new, collapsible)
       ├─ LineItemQuickActions.tsx (new)
       │    ├─ Preset buttons (config-driven)
       │    ├─ Module count adjuster
       │    ├─ AddLineItemDialog.tsx (new — catalog search popover)
       │    └─ Current line items list (read from lineItemsQuery)
       └─ BomExtractionEditor.tsx (new)
            ├─ Extraction status indicator
            ├─ Editable BOM table
            ├─ Add row button
            └─ Save / Push to HubSpot buttons
```

## Feature 1: Line Item Quick Actions

### Preset Configuration

New file `src/lib/idr-line-item-presets.ts`:

```ts
interface LineItemPreset {
  label: string;        // Button text
  sku: string;          // InternalProduct SKU for lookup
  defaultQty: number;   // Default quantity when adding
}

const LINE_ITEM_PRESETS: LineItemPreset[] = [
  { label: "Backup Switch", sku: "TBD", defaultQty: 1 },
  { label: "Backup Gateway", sku: "TBD", defaultQty: 1 },
  { label: "TRM", sku: "TBD", defaultQty: 1 },
];
```

SKUs will be populated from the existing `InternalProduct` catalog at implementation time.

### Add Flow

1. User clicks preset button (e.g., "Add Backup Switch")
2. Frontend calls `POST /api/idr-meeting/line-items/[dealId]`
3. API looks up `InternalProduct` by SKU → gets `hubspotProductId`, name, description
4. Calls `createDealLineItem()` with deal ID, product ID, quantity
5. Returns created line item
6. Frontend refetches line items list, shows toast confirmation

**Concurrency**: Preset adds are idempotent-ish — clicking "Add Backup Switch" twice creates two line items. The UI disables the button with a loading state during the API call and re-enables after refetch. If the product already exists in the current line items list, the button shows a checkmark instead. This is client-side only — no server lock needed since duplicate line items are easily cleaned up in HubSpot.

### Module Count Adjustment

+/- buttons find the existing module line item(s) in the current line items. Adjusting:
- Fetches the line item ID
- PATCHes the HubSpot line item quantity via new `updateLineItemQuantity()` helper
- Refetches line items list

### Catalog Search (Add Item)

"Add Item from Catalog" opens a popover/dialog:
- Search input hits `GET /api/catalog/search?q=`
- Results show brand, model, category, SKU
- User picks a product, sets quantity
- Submits → same `POST /api/idr-meeting/line-items/[dealId]` flow

### API Route

`POST /api/idr-meeting/line-items/[dealId]`:

```ts
// Request body
{ internalProductId: string, quantity: number }

// Flow
1. requireApiAuth() + isIdrAllowedRole()
2. Look up InternalProduct by ID → validate hubspotProductId exists
3. createDealLineItem({ dealId, name, quantity, hubspotProductId, sku, description })
4. Return { success: true, lineItem: { id, name, quantity } }
```

## Feature 2: BOM Extraction & Editor

### Pre-Extraction During Session Prep

When a project is added to an IDR session (not an escalation):

1. Check if deal has `designFolderUrl` — if not, skip (status: `no_folder`)
2. Parse folder ID via `extractFolderId(designFolderUrl)` — if unparseable, skip (status: `no_folder`)
3. Call `listPlansetPdfs(folderId)` (recursive subfolder search: Stamped Plans → parent → BFS 3 levels) → `pickBestPlanset(files)`
4. If no planset found, skip (status: `no_planset`)
5. Download PDF via `downloadDrivePdf()`
6. Run `extractBomFromPdf(pdfBuffer, filename)` — filename from the Drive file metadata
7. Save result as `ProjectBomSnapshot` via `saveBomSnapshot()` with version auto-increment
8. Update extraction status: `ready`

**Extraction status tracking**: Derived from `ProjectBomSnapshot` — query by `dealId` to check if a snapshot exists for the current session. No schema change needed. The IDR meeting item prep endpoint stores a `bomExtractionStatus` field in its JSON metadata:
- `idle` — no extraction attempted (escalations default here)
- `pending` — queued for extraction
- `extracting` — in progress
- `ready` — snapshot available
- `failed` — extraction failed (error message stored in metadata)

**Error handling**: Drive API auth failures (403), missing planset, and extraction errors all result in `failed` status with a human-readable message surfaced in the UI (e.g., "No planset found in design folder" vs "Drive access denied — check service account").

The project queue in the IDR meeting UI shows a small status indicator per project so the person prepping knows which extractions completed.

### On-Demand Extraction

For escalations (both in IDR sessions and shit-show meetings):
- BOM section shows an "Extract BOM" button instead of the table
- Clicking triggers the same extraction flow
- Shows progress indicator (~30-60s)
- Populates the editor when complete

### BOM Editor

Compact editable table matching the BOM dashboard's editing capabilities:

- **Columns**: Category, Brand/Model (combined), Qty, Actions (confirm/reject/delete)
- **Inline editing**: Click qty to edit, click brand/model to edit text
- **Add Row**: Manual entry at bottom of table
- **Confirm/Reject per row**: Toggle to mark items as verified or rejected

### Save & Push

- **Save Snapshot**: Always available. Persists the current editor state as a `ProjectBomSnapshot` version.
- **Push to HubSpot**: Secondary/optional button. Creates deal line items from the BOM.

### Push to HubSpot & Deduplication

"Push to HubSpot" reuses the existing `pushBomToHubSpotLineItems(dealId, snapshotId, userEmail)` from `bom-hubspot-line-items.ts`. This keeps BOM tag management (`[BOM:pushLogId]` description tags), lock acquisition, push logging, and prior-item cleanup in one codepath.

The flow:
1. Save current editor state as a `ProjectBomSnapshot` (if not already saved)
2. Call `pushBomToHubSpotLineItems(dealId, snapshotId, userEmail)`
3. This handles: catalog matching, lock acquisition, create new tagged line items, delete prior BOM-managed items on success, log to `BomHubSpotPushLog`

**Deduplication with preset-added items**: Preset-added line items (backup switch, gateway, TRM) are created without BOM tags — they're standalone line items. The BOM push only deletes items tagged with a prior `[BOM:...]` push log ID. So preset items are safe from BOM push cleanup.

When the BOM contains an item that matches a preset-added line item (same `hubspotProductId`), the BOM push creates a second line item with the BOM tag. This is acceptable — the team can remove the duplicate preset item manually, or we can add a pre-push check that warns "Backup Switch already exists as a line item — BOM will add another. Continue?"

New helper in `hubspot.ts` (for module count adjustment, not BOM push):

```ts
export async function updateLineItemQuantity(
  lineItemId: string,
  quantity: number
): Promise<void>
// PATCH https://api.hubapi.com/crm/v3/objects/line_items/{id}
// body: { properties: { quantity: String(quantity) } }
```

### Extraction Trigger Rules

| Context | Auto-extract on add? | On-demand button? |
|---------|---------------------|-------------------|
| IDR session — regular project | Yes (during prep) | Yes (re-extract) |
| IDR session — escalation | No | Yes |
| Shit-show meeting — any project | No | Yes |

## Files to Create

| File | Purpose |
|------|---------|
| `src/app/dashboards/idr-meeting/BomReviewSection.tsx` | Collapsible container for both sub-features |
| `src/app/dashboards/idr-meeting/LineItemQuickActions.tsx` | Preset buttons, module adjuster, catalog search trigger |
| `src/app/dashboards/idr-meeting/AddLineItemDialog.tsx` | Catalog search popover for adding arbitrary items |
| `src/app/dashboards/idr-meeting/BomExtractionEditor.tsx` | BOM table editor with extraction status |
| `src/lib/idr-line-item-presets.ts` | Preset definitions (label, SKU, default qty) |

## Files to Modify

| File | Change |
|------|--------|
| `src/app/dashboards/idr-meeting/ProjectDetail.tsx` | Add `<BomReviewSection>` below Equipment section |
| `src/app/api/idr-meeting/line-items/[dealId]/route.ts` | Add POST handler for creating line items |
| `src/lib/hubspot.ts` | Add `updateLineItemQuantity()` helper |
| `src/lib/idr-meeting.ts` | Add extraction trigger logic to session prep flow |
| `src/app/api/idr-meeting/sessions/route.ts` | Trigger BOM extraction for non-escalation items when session is created |
| `src/lib/roles.ts` | Ensure IDR meeting API routes are in role allowlists |

## Out of Scope

- BOM extraction for the shit-show meeting dashboard (uses same components but wired separately — follow-up)
- Pricing recalculation from BOM editor items (PricingBreakdown continues to use HubSpot line items)
- Zuper job part sync from the IDR meeting (stays on BOM dashboard)
- Drag-and-drop reordering of BOM items
