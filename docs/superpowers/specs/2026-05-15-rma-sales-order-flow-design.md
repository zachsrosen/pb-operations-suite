# RMA Sales Order Flow — Design Spec

## Problem

RMA (Return Merchandise Authorization) inventory accounting is fully manual today. When a service job requires equipment replacement, there is no automated path from the HubSpot service ticket to a Zoho Inventory Sales Order tracking parts going out and defective parts coming back. Techs and service managers manually create SOs in Zoho, with no traceability back to the ticket.

## Goal

Build an RMA flow that lets a tech select replacement and defective parts from the product catalog on a service ticket, create a tagged Zoho Sales Order for the outbound replacement, and capture the defective-return data for future inventory reconciliation.

## Phasing

- **Phase 1** (this spec): Manual RMA part picker on service ticket detail → Zoho SO creation. Data model captures both outbound and inbound items.
- **Phase 2** (future): Tesla PowerHub auto-detection — `ReturnMerchandiseAuthorization` alerts auto-create service tickets pre-populated with faulted equipment.
- **Phase 3** (future): Full inventory loop — inbound defective tracking, vendor RMA submission, two-way Zoho accounting.

## Decision Log

| Decision | Rationale |
|----------|-----------|
| New `RmaOrder` model (not extending `TicketBomSnapshot`) | RMA lifecycle differs from BOM extraction — no PDF, no Claude, bidirectional, potential auto-trigger. Separate model avoids overloading `TicketBomSnapshot`. |
| Capture both outbound + inbound items from day one | Phase 3 needs the defective-return data. Cheaper to capture at creation time than backfill later. |
| Parts come from `InternalProduct` catalog, not HubSpot quotes | No existing HubSpot quote integration; catalog search already works. Replacement may be a different model than the original. |
| Warehouse resolved from ticket location | Same pattern as regular BOM SO flow via `pbLocation`. |
| SO number format: `SO-RMA-{rmaOrderId}` | Unique per RMA order (not per ticket — a ticket can have multiple RMAs). Distinguishes from regular BOM SOs (`SO-PROJ-XXXX`, `SO-T-XXXX`) in Zoho. |

---

## Data Model

### New enum: `RmaStatus`

```prisma
enum RmaStatus {
  DRAFT            // Parts selected, no SO yet
  SO_CREATED       // Zoho SO created for outbound replacement
  RETURN_PENDING   // Phase 3: waiting for defective parts back
  CLOSED           // Complete — defective parts received
}
```

### New model: `RmaOrder`

```prisma
model RmaOrder {
  id            String    @id @default(cuid())
  ticketId      String    // HubSpot ticket ID
  ticketSubject String    // Snapshot for display

  status        RmaStatus @default(DRAFT)

  // Outbound — replacement parts going to customer
  outboundItems Json      // RmaLineItem[]
  zohoSoId      String?   // Zoho Sales Order ID once created
  zohoSoNumber  String?   // e.g. "SO-RMA-cm1abc2de" (unique per RMA order)

  // Inbound — defective parts being returned (Phase 3 fulfillment)
  inboundItems     Json?     // RmaLineItem[]
  returnReceivedAt DateTime? // When defective parts were received back

  // Tesla auto-detection (Phase 2)
  powerhubAlertId String?   // Links to PowerhubAlert if auto-triggered
  autoDetected    Boolean   @default(false)

  // Tracking
  createdBy  String   // user email
  pbLocation String?  // For Zoho warehouse resolution
  notes      String?  @db.Text

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([ticketId])
  @@index([status])
  @@index([zohoSoId])
  @@index([powerhubAlertId])
}
```

### RmaLineItem shape (JSON)

```typescript
interface RmaLineItem {
  productId: string;       // InternalProduct.id
  brand: string;
  model: string;
  category: EquipmentCategory;
  quantity: number;
  unitSpecLabel?: string | null; // Formatted from InternalProduct.unitSpec (Float) + unitLabel (String), e.g. "400W", "13.5kWh"
  zohoItemId?: string | null; // InternalProduct.zohoItemId for SO creation
  hubspotProductId?: string | null;
  condition?: string | null; // Phase 3: "defective", "damaged", etc.
}
```

### Schema change: `PowerhubAlertSeverity` (Phase 2 prep)

```prisma
enum PowerhubAlertSeverity {
  INFORMATIONAL
  PERFORMANCE
  CRITICAL
  RMA  // NEW — mapped from Tesla's "ReturnMerchandiseAuthorization"
}
```

Phase 1 adds the enum value. Phase 2 changes the sync code to use it.

**Phase 2 implementation note:** `powerhub-sync.ts` lines 554–558 have a hardcoded TypeScript annotation `const severity: "CRITICAL" | "PERFORMANCE" | "INFORMATIONAL"` that maps all unknown severities (including `ReturnMerchandiseAuthorization`) to `INFORMATIONAL`. Phase 2 must update this annotation to include `"RMA"` and add the mapping. Phase 1 adds a `// TODO(Phase 2 RMA): map ReturnMerchandiseAuthorization → RMA here` comment at that location.

**Duplicate prevention:** Phase 2 must enforce at the application layer that only one auto-detected `RmaOrder` is created per `powerhubAlertId` (check before insert). The `@@index([powerhubAlertId])` supports this lookup.

---

## API Routes

All routes under `/api/service/rma/`. No additional `allowedRoutes` changes needed — `/api/service/rma` is covered by the existing `/api/service` prefix already present for SERVICE, OPERATIONS, OPERATIONS_MANAGER, PROJECT_MANAGER, ADMIN, and OWNER/EXECUTIVE roles.

### `POST /api/service/rma`

Create an RMA order in DRAFT status.

**Request body:**
```typescript
{
  ticketId: string;
  ticketSubject: string;
  outboundItems: RmaLineItem[];
  inboundItems?: RmaLineItem[];
  pbLocation?: string | null;
  notes?: string | null;
}
```

**Validation:**
- `ticketId` required, non-empty
- `outboundItems` must have at least one item
- Each item's `productId` must exist in `InternalProduct`
- Snapshots `brand`, `model`, `category`, `unitSpec`, `zohoItemId`, `hubspotProductId` from the `InternalProduct` row at creation time (point-in-time snapshot, not a live reference)

**Response:** `RmaOrder` row.

### `POST /api/service/rma/[id]/create-so`

Create a Zoho Sales Order from a DRAFT RMA order.

**Flow:**
1. Load `RmaOrder` — must be in `DRAFT` status
2. **Idempotency guard:** If `rmaOrder.zohoSoId` is already set, return the existing SO immediately (same pattern as `createTicketSalesOrder` in `bom-so-create.ts` line ~120)
3. Auto-resolve Zoho customer from ticket → deal → company association (same chain as `bom-so-create.ts` lines 273–291). If `customerId` is provided in the request body, use it as an override; otherwise auto-resolve. If resolution fails and no override provided, return 422 with instructions to provide `customerId`.
4. Build `ZohoSalesOrderPayload`:
   - `salesorder_number`: `SO-RMA-{rmaOrder.id}` (unique per RMA order, not per ticket)
   - `reference_number`: `Ticket ${ticketId} | ${ticketSubject}`.slice(0, 50) (matches existing ticket SO format, respects Zoho's 50-char limit)
   - `notes`: "RMA — Replacing: {inbound item summaries}. Sending: {outbound item summaries}."
   - `custom_fields`: `[{ label: "RMA", value: "true" }, { label: "HubSpot Ticket Record ID", value: ticketId }]`
   - `line_items`: map `outboundItems` → `{ item_id: zohoItemId, name: "brand model", quantity, warehouse_id }`
   - `warehouse_id`: resolved from `pbLocation` using existing warehouse mapping
5. Call `zohoInventory.createSalesOrder(payload)`
6. **Crash recovery:** If the Zoho call succeeds but the DB update fails (crash between steps 5 and 7), the next retry hits the idempotency guard. If Zoho returns "already exists", recover the SO ID from `zohoInventory.getSalesOrder()` by searching for the SO number (same recovery path as `bom-so-create.ts` lines 649–695).
7. Update `RmaOrder`: `zohoSoId`, `zohoSoNumber`, `status` → `SO_CREATED`
8. Log activity: `ActivityType.RMA_SO_CREATED` (new enum value)

**Error handling:** If Zoho call fails for reasons other than "already exists", return error but don't change status. Tech can retry.

**Request body:**
```typescript
{
  customerId?: string; // Optional Zoho customer ID override. Auto-resolved from ticket if omitted.
}
```

### `GET /api/service/rma?ticketId=X`

List all RMA orders for a given ticket. Returns `RmaOrder[]` ordered by `createdAt desc`.

### `GET /api/service/rma/[id]`

Single RMA order detail.

---

## Shared SO Helper

Extract reusable Zoho SO plumbing from `bom-so-create.ts` into `lib/zoho-so-helpers.ts`:

- `resolveZohoWarehouse(pbLocation: string | null | undefined): string | undefined` — location → warehouse ID mapping. Logs `console.warn` on unknown locations (consistent with existing behavior).
- `buildZohoLineItems(items: RmaLineItem[], warehouseId?: string): ZohoSalesOrderLineItem[]` — map product snapshots to Zoho format

The existing `createTicketSalesOrder` and `createSalesOrder` continue to work unchanged. The RMA route calls the helpers directly + `zohoInventory.createSalesOrder()`.

This is NOT a refactor of the existing functions — just extracting small utilities that both paths can use.

---

## UI — Service Ticket Detail

### Location

On the service ticket detail panel in `/dashboards/service-tickets/page.tsx`, add an **RMA section** below the timeline. Gated on a new feature flag: `NEXT_PUBLIC_RMA_ENABLED`.

### States

**No RMAs (empty):**
- "No RMAs" text + "Create RMA" button

**RMA creation flow** (inline accordion, not a modal or separate page):

1. **Defective items** — "What's being replaced?"
   - Product search input querying `/api/catalog/search`
   - Results shown as rows: brand, model, category badge, unitSpec
   - Click to add, set quantity
   - Can add multiple items

2. **Replacement items** — "What's being sent?"
   - Same product picker
   - Pre-populated with the same items from step 1 (tech can change model/qty)
   - Can add different items

3. **Review** — "Confirm RMA"
   - Two-column layout: "Defective (returning)" | "Replacement (sending)"
   - Location auto-filled from ticket, editable
   - Optional notes field
   - "Save as Draft" button → `POST /api/service/rma`

**DRAFT state:**
- Card showing outbound/inbound items summary
- "Create Sales Order" button → `POST /api/service/rma/[id]/create-so`
- Customer auto-resolved from ticket associations. If resolution fails, shows a customer picker (same Zoho customer list as BOM SO flow via `GET /api/bom/zoho-customers`) before retrying with `customerId` override.

**SO_CREATED state:**
- Green status badge
- Link to Zoho SO (using `getZohoSalesOrderUrl`)
- Item summary (read-only)

### Component structure

```
src/components/service/
  RmaSection.tsx          — Container: fetches RMAs for ticket, manages create/list state
  RmaCreateFlow.tsx       — 3-step inline form (defective → replacement → review)
  RmaProductPicker.tsx    — Search + select products from catalog
  RmaOrderCard.tsx        — Displays a single RMA order (draft/created states)
```

---

## Activity Tracking

Two new `ActivityType` enum values:

- **`RMA_ORDER_CREATED`** — logged when a draft RMA is saved (`POST /api/service/rma`), with metadata: `{ ticketId, rmaOrderId, outboundCount, inboundCount }`
- **`RMA_SO_CREATED`** — logged when the Zoho SO is created (`POST /api/service/rma/[id]/create-so`), with metadata: `{ ticketId, rmaOrderId, zohoSoId, zohoSoNumber, itemCount }`

---

## Role Access

No `allowedRoutes` changes needed. The middleware uses prefix matching, and `/api/service/rma` is covered by the existing `/api/service` prefix present for: ADMIN, OWNER/EXECUTIVE, PROJECT_MANAGER, OPERATIONS_MANAGER, OPERATIONS, and SERVICE.

---

## Feature Flag

`NEXT_PUBLIC_RMA_ENABLED` — controls UI visibility. API routes return 404 when `RMA_ENABLED` env var is falsy (server-side check).

Add both `NEXT_PUBLIC_RMA_ENABLED` and `RMA_ENABLED` to `.env.example` with default values of `false`.

---

## Phase 2 — Tesla Auto-Detection (not built, modeled)

When Phase 2 ships:
1. `PowerhubAlertSeverity.RMA` enum value is already in the schema
2. `powerhub-sync.ts` maps `"ReturnMerchandiseAuthorization"` → `RMA` instead of `INFORMATIONAL`
3. New handler watches for `PowerhubAlert` rows with `severity: RMA` + `isActive: true`
4. Looks up `PowerhubSite.propertyId` → `HubSpotPropertyCache` → `contactLinks` → creates HubSpot service ticket
5. Pre-creates `RmaOrder` in DRAFT with `autoDetected: true`, `powerhubAlertId` set, `inboundItems` populated from device lookup
6. Tech reviews auto-created ticket, adjusts replacement items, creates SO

No code for this in Phase 1 — just the data model fields (`powerhubAlertId`, `autoDetected`) and enum value.

---

## Phase 3 — Return Tracking (not built, modeled)

When Phase 3 ships:
1. After SO_CREATED, a "Mark Return Pending" action → status `RETURN_PENDING`
2. When defective parts arrive, "Confirm Receipt" → `returnReceivedAt` set, status → `CLOSED`
3. Zoho inventory adjustment or purchase return for defective items
4. `RmaLineItem.condition` field used to categorize returns

No code for this in Phase 1 — just the model fields (`returnReceivedAt`, status values, `condition`).

---

## Not in Scope

- HubSpot quote integration
- Zoho purchase returns / credit notes for defective items
- Automated vendor RMA submission
- RMA reporting dashboard
- Editing an RMA after SO creation
- Multiple SOs per RMA order
