# Inventory Hub — Design Document

**Date:** 2025-02-13
**Status:** Approved
**Approach:** B — Dedicated Inventory Management System alongside existing Equipment Backlog

## Problem

PB Energy operates a hybrid procurement model: bulk stock of common equipment (modules, inverters) at warehouses that map 1:1 to PB Locations, with specialty items ordered per-project. There is no consistent system for tracking what's physically in each warehouse. The existing Equipment Backlog dashboard shows demand (what projects need) but has no supply side. Operations managers cannot answer "what do we need to buy?" without physically counting stock.

## Solution

A new **Inventory Hub** dashboard at `/dashboards/inventory` that provides:

1. **Stock Overview** — current quantities per SKU per warehouse with demand comparison
2. **Receive & Adjust** — quick-entry form for warehouse staff to record deliveries and corrections
3. **Needs Report** — stage-weighted demand vs. supply gap analysis

The existing Equipment Backlog stays as the demand view. The Inventory Hub is the supply + gap view.

---

## Data Model

### EquipmentSku

Catalog of known equipment types. Auto-populated from HubSpot brand/model combos.

| Field | Type | Purpose |
|-------|------|---------|
| id | String (cuid) | PK |
| category | Enum: MODULE, INVERTER, BATTERY, EV_CHARGER | Equipment type |
| brand | String | e.g., "REC", "Enphase", "Tesla" |
| model | String | e.g., "Alpha Pure 400W", "IQ8M" |
| unitSpec | Float? | Wattage for modules, kW for inverters, kWh for batteries |
| unitLabel | String? | "W", "kW AC", "kWh" |
| isActive | Boolean | Can be retired without deleting |
| createdAt | DateTime | |
| updatedAt | DateTime | |

Unique: `(category, brand, model)`

### InventoryStock

Current on-hand quantity per SKU per warehouse.

| Field | Type | Purpose |
|-------|------|---------|
| id | String (cuid) | PK |
| skuId | String (FK -> EquipmentSku) | Which equipment |
| location | String | PB Location = warehouse |
| quantityOnHand | Int | Current count |
| minStockLevel | Int? | Optional reorder threshold (future alerts) |
| lastCountedAt | DateTime? | Last physical verification |
| updatedAt | DateTime | |

Unique: `(skuId, location)`

### StockTransaction

Audit log of every stock change.

| Field | Type | Purpose |
|-------|------|---------|
| id | String (cuid) | PK |
| stockId | String (FK -> InventoryStock) | Which stock record |
| type | Enum: RECEIVED, ALLOCATED, ADJUSTED, TRANSFERRED, RETURNED | What happened |
| quantity | Int | Positive = added, negative = removed |
| reason | String? | Freeform note |
| projectId | String? | HubSpot deal ID if project-related |
| projectName | String? | For display |
| performedBy | String? | User name/ID |
| createdAt | DateTime | |

---

## Architecture

### Page Structure

New page: `/dashboards/inventory` in the Operations Suite.

Three tabs:
- **Stock Overview** (default) — table of SKU x Location with demand comparison
- **Receive & Adjust** — quick-entry form + recent transactions
- **Needs Report** — stage-weighted gap analysis with CSV export

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| /api/inventory/skus | GET, POST | List/create SKUs |
| /api/inventory/stock | GET | Stock levels with demand join |
| /api/inventory/stock/[id] | PUT | Update stock (creates transaction) |
| /api/inventory/transactions | GET, POST | List/create transactions |
| /api/inventory/needs | GET | Needs report with stage-weighted demand |
| /api/inventory/sync-skus | POST | Auto-populate SKU catalog from HubSpot |

### Data Flow

**SKU Sync:** "Sync SKUs from Projects" button fetches all equipment-context projects, extracts unique (category, brand, model, unitSpec) tuples, upserts into EquipmentSku. Case-insensitive matching, whitespace trimming.

**Demand Calculation:** Piggybacks on existing `fetchAllProjects({ context: "equipment" })` — same cache, same 5-minute TTL. No new HubSpot API calls.

**Stage Weights (configurable):**
- Construction / Ready To Build: 100%
- Permitting & Interconnection: 80%
- Design & Engineering: 50%
- Site Survey: 25%

**Stock Updates:** All changes go through StockTransaction. `quantityOnHand` updated via Prisma atomic `increment`/`decrement`. Append-only transaction log for full audit trail.

**Allocation:** Creates ALLOCATED transaction with negative quantity and projectId. Allocated stock no longer counts as available in Needs Report.

---

## UI Design

### Visual Integration

- Wrapped in DashboardShell
- Theme tokens: bg-surface, bg-surface-2, text-foreground, text-muted, border-t-border, shadow-card
- Existing MetricCard/StatCard components for stat cards
- MultiSelectFilter for location/category filtering
- Tab bar styled like Equipment Backlog's Summary/Projects toggle

### Stock Overview Tab

- **Stat cards:** Total SKUs, Total Units On Hand, SKUs Below Min Level, Total Pipeline Demand
- **Table:** Category icon | Brand | Model | Spec | Location | On Hand | Pipeline Demand | Gap | Last Counted
- **Gap column:** Red chip for shortfalls, green for surplus, muted for balanced
- **Category badges:** Solar panel (modules), lightning bolt (inverters), battery (batteries), plug (EV chargers)
- **Last Counted:** Relative time with amber warning if > 30 days or never
- **Empty state:** "No inventory tracked yet" with prominent sync button

### Receive & Adjust Tab

- **SKU selector:** Searchable dropdown grouped by category
- **Location selector:** PB Locations from constants
- **Quantity field:** Number input with +/- stepper buttons
- **Transaction type:** Radio buttons — Received (green), Adjusted (amber), Returned (blue), Allocated (orange)
- **Allocated type:** Shows project search field (autocomplete from project API)
- **Recent transactions:** Compact table, newest first, color-coded type badges
- **Success feedback:** Green toast notification, auto-dismiss

### Needs Report Tab

- **Stage weight controls:** Inline sliders/inputs at top, pre-filled with defaults
- **Table grouped by category** with collapsible sections and subtotals
- **Expandable rows:** Per-location breakdown (demand + stock + gap per warehouse)
- **Suggested Order column:** Bold when > 0, dash when nothing needed
- **Visual summary bar:** Horizontal stacked bar showing % sufficient vs. shortfall
- **CSV export** with full per-location detail

### Responsive

- Tables scroll horizontally, frozen first column on small screens
- Receive form stacks vertically on mobile/tablet
- Stat cards: 2-col on tablet, 1-col on mobile

---

## Permissions

| Action | Roles |
|--------|-------|
| View inventory | ADMIN, OWNER, MANAGER, OPERATIONS, OPERATIONS_MANAGER, PROJECT_MANAGER, VIEWER |
| Receive & Adjust | ADMIN, OWNER, MANAGER, OPERATIONS, OPERATIONS_MANAGER |
| Sync SKUs / manage catalog | ADMIN, OWNER, MANAGER |

Enforced at API level via getServerSession + role check. Read-only roles see Stock Overview and Needs Report but not the intake form.

## Activity Tracking

New ActivityType enum values:
- INVENTORY_RECEIVED
- INVENTORY_ADJUSTED
- INVENTORY_ALLOCATED
- INVENTORY_TRANSFERRED
- INVENTORY_SKU_SYNCED

Flows into existing ActivityLog system.

## Edge Cases

- **SKU matching:** Case-insensitive, whitespace-trimmed matching on (category, brand, model)
- **Untracked equipment:** Projects with SKUs not in catalog shown as "Untracked" rows with quick-add button
- **Negative stock:** Allocations can push below 0 (overallocated) — highlighted in red
- **New SKU+location:** Auto-creates InventoryStock record on first receive
- **Retired SKUs:** Marked isActive=false, hidden from dropdowns, visible in history
- **Concurrent edits:** Atomic increment/decrement via Prisma, no race conditions
- **Stale demand:** Same 5-min cache as Equipment Backlog, timestamp shown, manual refresh available

## Explicitly Out of Scope

- Purchase order creation/tracking
- Supplier/vendor management
- Automated reorder alerts (minStockLevel field exists for future use)
- Barcode/QR scanning
- Transfer between warehouses UI (transaction type defined, no UI)
- Equipment lifecycle tracking (installed, RMA'd)
