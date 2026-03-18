# Service Catalog + Service SO Creation — Design Spec

**Date:** 2026-03-18
**Phase:** 4 (final phase of Service Suite expansion)
**Status:** Approved
**Author:** Zach + Claude

## Problem

Service coordinators have no way to create Sales Orders for service work. Solar installs go through the BOM-to-SO pipeline, but service deals (site visits, repairs, replacements) either skip SO creation entirely or require manual Zoho entry. This means no inventory tracking, no revenue attribution, and no standardized pricing for service work.

## Solution

Two deliverables:

1. **Service Catalog page** — filtered view of the product catalog scoped to `SERVICE` category, with admin/manager access to add/edit products via the existing catalog management pages.
2. **Service SO creation** — deal-scoped slide-over on the service pipeline, where coordinators pick products + quantities and submit to Zoho. Server resolves all pricing/product data from the database (no client-trusted values).

---

## Section 1: Service Catalog Page

**Path:** `/dashboards/service-catalog`

### Layout

Product table scoped to `EquipmentCategory.SERVICE` only. `ADDER_SERVICES` is excluded — those are solar project line items.

**Columns:** Name, Brand/Model, Description, SKU, Sell Price, Active Status

**Filters:**
- Text search (name, SKU, brand, model)
- Active/Inactive toggle (defaults to active-only)

### Role-Based Behavior

| Role | Capabilities |
|------|-------------|
| All service suite roles | Browse/search/filter products (read-only) |
| ADMIN, OWNER, MANAGER | "Add Product" button, "Edit" action per row |

### Catalog Management

Admin/manager actions link to the existing catalog pages — no new write path:
- "Add Product" → `/dashboards/catalog/new?category=SERVICE`
- "Edit" → `/dashboards/catalog/edit/{id}`

Both pre-fill `category: SERVICE`. The existing `/api/inventory/products` endpoint handles all CRUD.

**Implementation note:** The existing catalog wizard at `/dashboards/catalog/new` may not read a `category` query param for pre-fill. If it doesn't, the link still works but category won't be pre-selected. Verify during implementation and add query param support if needed.

### Inactive Product Handling

- **Catalog page:** Inactive products visible but greyed out with "Inactive" badge. Admins can reactivate.
- **SO product picker:** Inactive products are excluded entirely (filtered server-side).

### Data Source

`GET /api/inventory/products?category=SERVICE&active=true|false`

No new API endpoints needed for the catalog page.

---

## Section 2: Service SO Creation

### Trigger

"Create SO" button on each deal row in the service pipeline table (`/dashboards/service`).

**Button state:**
- Enabled: deal has an associated HubSpot company
- Disabled + tooltip: "Deal must have an associated company to create a Sales Order" when no company association exists

**Company association data:** The current `Deal` type on the service pipeline has no company field. The deals API response must be extended to include `companyId` and `companyName` (fetched via HubSpot deal → company association batch API, same pattern used in `hubspot-tickets.ts`). This is a prerequisite change to both the API route (`/api/deals` or the progressive deals hook) and the `Deal` type interface.

### Slide-Over Panel

Opens on button click. Contains:

**1. Deal Header**
- Deal name, address, stage, amount
- Read from deal row data already in state

**2. Product Picker**
- Searchable list of active `SERVICE` products
- Each row: product name, SKU, sell price
- Click to add to line items (starts at qty=1)
- Data: `GET /api/inventory/products?category=SERVICE&active=true`

**3. Line Item Review**
- Table: name, SKU, unit price, quantity (editable), line total, remove button
- Running total at bottom
- Quantity input: integer, min 1

**4. Submit**
- "Create Sales Order" button
- Client generates a `requestToken` (UUID) per click path — stable across retries of the same submission
- Sends `{ dealId, requestToken, items: [{ productId, quantity }] }` to `POST /api/service/create-so`
- Shows success state with Zoho SO number, or error message on failure

---

## Section 3: SO Creation API

### Endpoint

`POST /api/service/create-so`

**Auth:** All service suite roles (ADMIN, OWNER, MANAGER, OPERATIONS, OPERATIONS_MANAGER, PROJECT_MANAGER, TECH_OPS).

### Request Body

```json
{
  "dealId": "12345",
  "requestToken": "uuid-from-client",
  "items": [
    { "productId": "cuid123", "quantity": 2 },
    { "productId": "cuid456", "quantity": 1 }
  ]
}
```

### Server Flow

1. **Auth check** via `requireApiAuth()`.
2. **Idempotency:** Attempt `prisma.serviceSoRequest.create()` with the `requestToken`. If a unique constraint violation occurs (P2002), load the existing record — if it has `zohoSoId`, return it as a successful idempotency hit; if it's still DRAFT/FAILED, return its current state. This avoids the race condition where two concurrent requests both pass a check-then-create guard.
3. **Product resolution:** Load each `InternalProduct` by `productId`. Validate:
   - Product exists
   - `category === SERVICE`
   - `isActive === true`
   - Reject with 400 if any fail, listing which products are invalid
4. **Zoho customer resolution:** (see Section 3a below)
5. **Create `ServiceSoRequest`** record with status `DRAFT`, server-resolved line items.
6. **Build Zoho SO payload:**
   - `customer_id`: from step 4
   - `reference_number`: deal name (max 50 chars)
   - `salesorder_number`: omitted — let Zoho auto-assign
   - `line_items`: each with `item_id` (from `InternalProduct.zohoItemId` if set, omitted if not), `name`, `quantity`
   - `custom_fields`: `[{ label: "HubSpot Deal ID", value: dealId }]`
   - `notes`: deal address context (concatenated from `address`, `city`, `state`, `postalCode` fields — no single `fullAddress` field exists)
   - `status`: `"draft"`
7. **Call `zohoInventory.createSalesOrder()`**
8. **On success:** Update record → `zohoSoId`, `zohoSoNumber`, status `SUBMITTED`.
9. **On failure:** Update record → `errorMessage`, status `FAILED`. Return error to client.

### Section 3a: Zoho Customer Resolution

Server derives customer from the deal's associated HubSpot company:

1. Fetch deal → company association via HubSpot associations API
2. If no company: fail with 400 "Deal must have an associated company"
3. Load company properties: `name`, `domain`
4. Search Zoho customers by `contact_name` (the Zoho field name) matching the HubSpot company name. Use `zohoInventory.searchCustomers()` if available, otherwise `listCustomers()` filtered client-side. Note: `listCustomers()` paginates serially (200/page) which can be slow with many customers — cap at 5 pages (1000 customers) and log a warning if exhausted without match.
5. If single match: use that `contact_id` (Zoho's customer ID field)
6. If multiple matches: filter by `email` field (optional on `ZohoVendor`) matching the domain from the deal's primary contact. If `email` is absent or still ambiguous, take most recently created + log warning.
7. If no match: add a `createContact()` method to `zoho-inventory.ts` (it does not currently exist). Uses the Zoho Inventory Contacts API `POST /contacts` with `contact_name`, `email`, `contact_type: "customer"`. This is the only new Zoho API method needed.
8. Store resolved `zohoCustomerId` on the `ServiceSoRequest` record

**Performance note:** The customer lookup adds 1-5 Zoho API calls to the SO creation path. For Phase 4 this is acceptable given service SO volume is low. Future enhancement: persist a durable HubSpot company → Zoho customer mapping to avoid repeated lookups and eliminate the pagination risk.

### Unmatched Zoho Items

If an `InternalProduct` has no `zohoItemId`, the line item goes into the SO with `name` only (no `item_id`). Zoho accepts this as a non-inventory line item. This matches the existing BOM-to-SO behavior for unmatched items.

### Business Logic Module

Core logic lives in `src/lib/service-so-create.ts`, not in the route handler. The route handles auth + request parsing + response formatting. The module handles:
- Product resolution + validation
- Zoho customer resolution
- Zoho SO creation
- `ServiceSoRequest` record management

---

## Section 4: Data Model

### New Prisma Enum

```prisma
enum ServiceSoStatus {
  DRAFT
  SUBMITTED
  FAILED
}
```

### New Prisma Model

```prisma
model ServiceSoRequest {
  id              String          @id @default(cuid())
  dealId          String
  requestToken    String          @unique
  zohoSoId        String?
  zohoSoNumber    String?
  zohoCustomerId  String?
  lineItems       Json            // Server-resolved: [{ productId, name, sku, quantity, unitPrice }]
  totalAmount     Float
  status          ServiceSoStatus @default(DRAFT)
  errorMessage    String?
  createdBy       String          // User email (consistent with project convention)
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  @@index([dealId])
  @@index([createdBy])
}
```

### Migration

Standard `prisma migrate dev` — no data migration needed (new table).

---

## Section 5: Route Wiring + Permissions

### New Files

| File | Purpose |
|------|---------|
| `src/app/dashboards/service-catalog/page.tsx` | Catalog browsing page (SERVICE products) |
| `src/app/api/service/create-so/route.ts` | SO creation endpoint |
| `src/lib/service-so-create.ts` | SO creation logic (product resolution, Zoho customer, Zoho SO) |

### Modified Files

| File | Change |
|------|--------|
| `src/app/dashboards/service/page.tsx` | Add `companyId`/`companyName` to Deal type, "Create SO" button + slide-over panel |
| `src/lib/role-permissions.ts` | Add `/dashboards/service-catalog` to service suite roles (API route already covered by prefix) |
| `src/app/suites/service/page.tsx` | Add Service Catalog card to landing page |
| `src/lib/zoho-inventory.ts` | Add `createContact()` method for Zoho customer creation |
| `prisma/schema.prisma` | Add `ServiceSoStatus` enum + `ServiceSoRequest` model |
| Service deals API (progressive deals hook) | Extend response to include company association data |

### Permission Matrix

| Route | Roles |
|-------|-------|
| `/dashboards/service-catalog` | ADMIN, OWNER, MANAGER, OPERATIONS, OPERATIONS_MANAGER, PROJECT_MANAGER, TECH_OPS |
| Catalog add/edit buttons | ADMIN, OWNER, MANAGER only (links to existing catalog pages) |
| `/api/service/create-so` | ADMIN, OWNER, MANAGER, OPERATIONS, OPERATIONS_MANAGER, PROJECT_MANAGER, TECH_OPS |
| "Create SO" button on pipeline | All above (disabled when no company association) |

**Note on `/api/service` prefix:** The existing `canAccessRoute` logic prefix-matches, so roles with `/api/service` in their `allowedRoutes` already have access to `/api/service/create-so`. Only `/dashboards/service-catalog` needs explicit addition to `role-permissions.ts`. The `DashboardShell.tsx` `SUITE_MAP` entry for `service-catalog` already exists from Phase 1 setup.

### Suite Landing Page

Add card to `src/app/suites/service/page.tsx`:
```
Service Catalog — Browse service products, pricing, and availability
```

---

## Out of Scope

- Warranty Tracker (Phase 3 — deferred, can be picked up later)
- SO editing / cancellation
- "Recent Service SOs" view on catalog or deal detail
- Stage-based SO automation (future: trigger SO creation when deal hits a specific stage)
- Durable HubSpot company → Zoho customer mapping
- Stock tracking for service products
- HubSpot product linking for service items

---

## Verification Criteria

1. Service Catalog page loads with SERVICE products only, filters work
2. Admin sees add/edit controls; coordinator does not
3. "Create SO" button appears on service pipeline deal rows
4. Button disabled with tooltip when deal has no company
5. Slide-over opens with product picker, quantities work, total updates
6. Submit creates SO in Zoho, returns SO number
7. Idempotency: same `requestToken` returns existing SO, no duplicate
8. Product with no `zohoItemId` creates name-only line item in Zoho
9. `ServiceSoRequest` record created with correct status transitions
10. Inactive products excluded from SO picker, greyed in catalog
11. Prisma migration runs clean
12. TypeScript compiles, lint passes, build succeeds
