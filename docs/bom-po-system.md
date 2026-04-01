# BOM Pipeline — Purchase Order System

Developer reference for the automated PO creation system. Covers both the **manual UI flow** (preview + create from the BOM page) and the **automated RTB pipeline flow** (POs created automatically during Ready-to-Build webhook runs).

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Shared Library                                │
│                 src/lib/bom-po-create.ts                        │
│                                                                  │
│  resolvePoVendorGroups()  — match BOM items → Zoho vendors      │
│  mergeUnassignedIntoVendor() — move unassigned items to vendor  │
│  createPurchaseOrders()   — create draft POs, persist-as-you-go │
│  parseZohoPurchaseOrders() — defensive JSON parser              │
│  buildReferenceNumber()   — Zoho-safe PO reference string       │
└──────────┬──────────────────────┬───────────────────┬───────────┘
           │                      │                   │
    ┌──────▼──────┐     ┌────────▼────────┐   ┌─────▼──────────┐
    │ PO Preview  │     │  PO Creation    │   │  BOM Pipeline  │
    │ API Route   │     │  API Route      │   │  Orchestrator  │
    │ GET         │     │  POST           │   │                │
    │ /api/bom/   │     │  /api/bom/      │   │  bom-pipeline  │
    │  po-preview │     │   create-po     │   │  .ts           │
    └─────────────┘     └─────────────────┘   └────────────────┘
     (BOM page UI)       (BOM page UI)         (webhook / retry)
```

**Three consumers, one library.** All PO creation logic lives in `bom-po-create.ts`. The API routes and pipeline orchestrator are thin callers.

---

## Data Model

### Prisma Schema

```prisma
model ProjectBomSnapshot {
  // ... existing fields ...
  zohoPurchaseOrders Json?    // Array<ZohoPurchaseOrderEntry>
  // bomData.poVendorGroups   // Frozen vendor grouping (inside bomData JSON)
}

enum BomPipelineStep {
  FETCH_DEAL
  LIST_PDFS
  EXTRACT_BOM
  SAVE_SNAPSHOT
  RESOLVE_CUSTOMER
  CREATE_SO
  CREATE_PO        // ← PO creation step
  NOTIFY
}
```

### `zohoPurchaseOrders` Shape

Stored as JSONB on `ProjectBomSnapshot`. Each entry represents one created Zoho PO:

```ts
interface ZohoPurchaseOrderEntry {
  vendorId: string;      // Zoho vendor contact_id
  vendorName: string;    // Human-readable vendor name
  poId: string;          // Zoho purchaseorder_id
  poNumber: string|null; // Zoho-assigned PO number (may be null for drafts)
  itemCount: number;     // Number of line items on this PO
}
```

### `bomData.poVendorGroups` Shape

Frozen vendor grouping persisted inside `bomData` JSON after the first PO creation attempt. Used for retry idempotency:

```ts
interface PoVendorGroup {
  vendorId: string;
  vendorName: string;
  items: PoLineItem[];
}

interface PoLineItem {
  bomName: string;       // Display name from BOM
  zohoName: string;      // Matched Zoho Inventory item name
  zohoSku?: string;      // Zoho SKU if available
  zohoItemId: string;    // Zoho item_id (used in PO line_items)
  quantity: number;
  description: string;
}
```

---

## How Vendor Resolution Works

`resolvePoVendorGroups(bomData)` in `bom-po-create.ts`:

1. Iterates each BOM item
2. Builds search terms via `buildBomSearchTerms()` (brand+model combinations)
3. Calls `zohoInventory.findItemIdByName()` sequentially per search term until a match is found
4. The matched Zoho item includes `vendor_id` and `vendor_name` (the item's **preferred vendor** in Zoho Inventory)
5. Groups matched items by `vendor_id` → one `PoVendorGroup` per vendor

Items that don't match fall into two buckets:
- **`no_zoho_match`** — no Zoho Inventory item found at all
- **`no_vendor`** — Zoho item found but it has no preferred vendor set

Both are returned as `unassignedItems` and skipped during PO creation.

---

## PO Creation Flow

`createPurchaseOrders(options)` in `bom-po-create.ts`:

### Frozen-Grouping Idempotency

The first time POs are created for a snapshot:
1. `poVendorGroups` is persisted into `bomData` on the snapshot
2. `zohoPurchaseOrders` starts as `[]`

On subsequent retries:
- If `existingPos.length > 0` AND `bomData.poVendorGroups` exists → **use the frozen groups** instead of recomputing from Zoho
- This prevents vendor assignment drift (e.g., if someone changes a preferred vendor in Zoho between attempts)

### Persist-As-You-Go

POs are created **sequentially**, one per vendor. After each successful PO:
1. The new entry is appended to `allPurchaseOrders`
2. The snapshot's `zohoPurchaseOrders` and `bomData.poVendorGroups` are updated immediately

If the process crashes mid-way:
- Already-created POs are persisted in the DB
- On retry, `existingPos` will contain the already-created POs
- Vendors with existing POs are **skipped** (checked by `vendorId`)
- Only missing vendor POs are created

### No `withRetry` Wrapper

The pipeline does **not** wrap `createPurchaseOrders()` in `withRetry()`. The persist-as-you-go pattern makes external retry dangerous (could double-create). The shared library handles its own partial recovery.

### Reference Number Format

Each PO gets a `reference_number` for Zoho (max 50 chars):

```
PROJ-7832 V1 — SolarEdge
```

Built by `buildReferenceNumber(dealName, version, vendorName)`:
- Extracts `PROJ-{id}` from the deal name via regex
- Truncates vendor name to fit within 50-char Zoho limit

---

## Pipeline Integration (RTB Auto PO)

### Trigger Gate

`shouldRunPoCreation()` in `bom-pipeline.ts` (exported, unit-tested):

```ts
function shouldRunPoCreation(
  trigger: string | undefined,
  autoCreatePoOnRtb: boolean,
  existingPosCount: number,
): boolean {
  return (
    (trigger === "WEBHOOK_READY_TO_BUILD" && autoCreatePoOnRtb) ||
    (trigger === "MANUAL" && existingPosCount > 0)
  );
}
```

| Trigger | Flag On | Existing POs | Result |
|---------|---------|-------------|--------|
| `WEBHOOK_READY_TO_BUILD` | `true` | any | **CREATE** — start automatic PO creation |
| `WEBHOOK_READY_TO_BUILD` | `false` | any | skip |
| `MANUAL` | any | > 0 | **CREATE** — continue incomplete PO creation |
| `MANUAL` | any | 0 | skip |
| `WEBHOOK_DESIGN_COMPLETE` | any | any | skip |
| undefined | any | any | skip |

**Key design decisions:**
- MANUAL continuation intentionally bypasses the env flag — if a prior run already created POs, recovery should work regardless
- MANUAL requires `existingPos.length > 0`, not just `poVendorGroups` existing, because `poVendorGroups` can be an empty array (truthy) and the shared lib's frozen-grouping rule also keys off `existingPos.length`
- `WEBHOOK_DESIGN_COMPLETE` never creates POs — that stage is too early to commit procurement

### Pipeline Step Flow

```
Step 6: CREATE_SO  → creates/reuses Zoho Sales Order
Step 7: CREATE_PO  → conditional, best-effort
  ├─ Read snapshot to get existingPos
  ├─ shouldRunPoCreation() gate check
  ├─ If true + Zoho configured:
  │   ├─ resolvePoVendorGroups(bomData)
  │   └─ createPurchaseOrders(...)
  └─ If false: skip silently
Step 8: NOTIFY     → email with SO + PO results
```

PO failures make the pipeline `PARTIAL` but do not block notification.

### Environment Variable

```bash
PIPELINE_AUTO_CREATE_PO_ON_RTB=true   # Enable RTB auto PO creation
# Default: false (safe for staged rollout)
```

---

## API Routes

### `GET /api/bom/po-preview?dealId=X&version=Y`

**File:** `src/app/api/bom/po-preview/route.ts`

Returns vendor grouping preview without creating anything. Used by the BOM page UI to show what POs would be created.

**Response:**
```json
{
  "vendorGroups": [
    {
      "vendorId": "123",
      "vendorName": "SolarEdge",
      "items": [
        { "bomName": "SE10000H", "zohoName": "SolarEdge SE10000H", "zohoItemId": "456", "quantity": 1, "description": "..." }
      ]
    }
  ],
  "unassignedItems": [
    { "name": "Generic Wire", "quantity": 100, "description": "...", "reason": "no_vendor", "zohoItemId": "789" }
  ]
}
```

### `POST /api/bom/create-po`

**File:** `src/app/api/bom/create-po/route.ts`

Creates POs for all vendor groups. Supports partial retry and optional unassigned item merging.

**Request:**
```json
{
  "dealId": "12345",
  "version": 1,
  "unassignedVendorId": "optional-vendor-id"  // merge unassigned items into this vendor
}
```

**Response:**
```json
{
  "purchaseOrders": [
    { "vendorId": "123", "vendorName": "SolarEdge", "poId": "po_001", "poNumber": "PO-0042", "itemCount": 3 }
  ],
  "unassignedItems": [
    { "name": "Generic Wire", "qty": 100 }
  ],
  "failed": [
    { "vendorId": "456", "vendorName": "Enphase", "error": "rate limit exceeded" }
  ]
}
```

**Retry behavior:** If called again after a partial failure, the route reads `existingPos` from the snapshot. Already-created vendor POs are skipped. Only missing vendors are attempted.

---

## Notification Emails

**File:** `src/lib/email.ts` — `sendPipelineNotification()`

RTB pipeline runs include PO results in the notification email:

```ts
purchaseOrders?: Array<{ vendorName: string; poNumber: string | null; itemCount: number }>;
poFailed?: Array<{ vendorName: string; error: string }>;
poUnassignedCount?: number;
```

These fields are **additive and optional** — non-RTB notifications work unchanged.

**Email sections:**
- **Purchase Orders (N):** list of vendor name + PO number + item count
- **PO Failures (N):** red-highlighted vendor + error message
- **Unassigned Items:** count + prompt to assign in BOM page

**Status determination:**
- `succeeded` — SO created, all POs created (or no POs needed)
- `partial` — SO created but PO failures or unassigned items exist
- `failed` — SO creation failed (POs not attempted)

---

## File Map

| File | Purpose |
|------|---------|
| `src/lib/bom-po-create.ts` | **Core shared library** — vendor resolution, PO creation, idempotency, parsing |
| `src/lib/bom-pipeline.ts` | Pipeline orchestrator — `shouldRunPoCreation()` gate + CREATE_PO step |
| `src/lib/email.ts` | `sendPipelineNotification()` — PO summary in emails |
| `src/lib/zoho-inventory.ts` | `findItemIdByName()` returns `vendor_id`/`vendor_name` from preferred vendor |
| `src/lib/bom-search-terms.ts` | `buildBomSearchTerms()` — generates search term variants for Zoho matching |
| `src/app/api/bom/po-preview/route.ts` | Preview API route (GET) |
| `src/app/api/bom/create-po/route.ts` | Creation API route (POST) |
| `src/app/dashboards/bom/page.tsx` | BOM page UI — preview panel, vendor groups, creation buttons |
| `prisma/schema.prisma` | `zohoPurchaseOrders Json?` field, `CREATE_PO` enum value |

### Tests

| File | Coverage |
|------|----------|
| `src/__tests__/lib/bom-po-create.test.ts` | `resolvePoVendorGroups`, `mergeUnassignedIntoVendor`, `buildReferenceNumber` |
| `src/__tests__/api/bom-create-po.test.ts` | Multi-vendor creation, partial retry, unassigned merge, validation |
| `src/__tests__/api/bom-po-preview.test.ts` | Zoho-not-configured guard, successful preview |
| `src/__tests__/lib/bom-pipeline-po-gate.test.ts` | All 8 `shouldRunPoCreation()` gate scenarios |

---

## Common Scenarios

### Happy Path: RTB Webhook

1. HubSpot deal moves to `ready_to_build` stage
2. Webhook fires → pipeline runs with trigger `WEBHOOK_READY_TO_BUILD`
3. Steps 1–6 execute (fetch deal → create SO)
4. Step 7: `shouldRunPoCreation("WEBHOOK_READY_TO_BUILD", true, 0)` → `true`
5. `resolvePoVendorGroups()` matches BOM items to Zoho vendors
6. `createPurchaseOrders()` creates one draft PO per vendor
7. Step 8: notification email includes SO + PO summary

### Partial Failure + Manual Retry

1. RTB run creates PO for Vendor A but fails for Vendor B
2. Snapshot now has: `zohoPurchaseOrders: [{ vendorId: "A", ... }]` and `bomData.poVendorGroups: [A, B]`
3. User clicks "Retry" → pipeline runs with trigger `MANUAL`
4. `shouldRunPoCreation("MANUAL", *, 1)` → `true` (existingPos > 0)
5. `createPurchaseOrders()` sees Vendor A in `existingPos` → skips
6. Creates PO for Vendor B using **frozen** `poVendorGroups` (not recomputed)

### Manual UI Flow (BOM Page)

1. User opens BOM page, clicks "Preview POs"
2. `GET /api/bom/po-preview` → shows vendor groups + unassigned items
3. User optionally selects a vendor for unassigned items
4. User clicks "Create POs"
5. `POST /api/bom/create-po` → creates POs, returns results
6. UI shows created PO numbers per vendor

### Design Complete (No POs)

1. Deal moves to `design_complete` → webhook fires with `WEBHOOK_DESIGN_COMPLETE`
2. Pipeline creates SO as normal
3. `shouldRunPoCreation("WEBHOOK_DESIGN_COMPLETE", *, *)` → `false`
4. PO step skipped entirely
5. Notification only includes SO results

---

## Operational Notes

- **Enabling RTB auto PO:** Set `PIPELINE_AUTO_CREATE_PO_ON_RTB=true` in environment variables
- **Disabling:** Set to `false` or remove — RTB pipeline still runs but skips PO creation
- **Zoho preferred vendor:** Set on each item in Zoho Inventory → Item → Vendor tab. Items without a preferred vendor are skipped during automation
- **Unassigned items:** Visible in notification emails and BOM page UI. Must be assigned manually in Zoho or via the BOM page vendor dropdown
- **PO status:** All auto-created POs are `draft` in Zoho — they need manual confirmation before they become live orders
