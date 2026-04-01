# Service Suite & D&R+Roofing Suite — Design Spec

**Date:** 2026-03-16
**Status:** Draft
**Author:** Zach + Claude

## Problem

The current "Service + D&R Suite" combines two unrelated workflows (service operations and detach/reset) into a single 5-dashboard suite. Service coordinators — the primary users, split by location — face four compounding pain points:

1. **Tool switching** — Constantly jumping between HubSpot (deals + tickets), Zuper (scheduling), email, and phone with no single view
2. **Tracking overdue items** — No visibility into which tickets/deals are slipping or which customers haven't been contacted
3. **Scheduling coordination** — Getting techs scheduled, managing rescheduling, coordinating customer availability
4. **Volume management** — Too many tickets/requests, hard to know what to work on next

Additionally, roofing is a growing service line that needs its own dashboard presence alongside D&R.

## Solution

Split into two independent suites and expand the Service Suite into a comprehensive coordinator command center.

### Service Suite (8 dashboards)

| # | Dashboard | Phase | Path | Status |
|---|-----------|-------|------|--------|
| 1 | Service Overview | 1 | `/dashboards/service-overview` | New |
| 2 | Service Pipeline | 1 | `/dashboards/service` | Existing |
| 3 | Service Scheduler | 1 | `/dashboards/service-scheduler` | Existing |
| 4 | Equipment Backlog | 1 | `/dashboards/service-backlog` | Existing |
| 5 | Ticket Board | 2 | `/dashboards/service-tickets` | New |
| 6 | Customer History | 3 | `/dashboards/service-customers` | New |
| 7 | Warranty Tracker | 3 | `/dashboards/service-warranty` | New |
| 8 | Service Catalog | 4 | `/dashboards/service-catalog` | New |

### D&R + Roofing Suite (4 dashboards)

| # | Dashboard | Phase | Path | Status |
|---|-----------|-------|------|--------|
| 1 | D&R Pipeline | 1 | `/dashboards/dnr` | Existing |
| 2 | D&R Scheduler | 1 | `/dashboards/dnr-scheduler` | Existing |
| 3 | Roofing Pipeline | 1 | `/dashboards/roofing` | New |
| 4 | Roofing Scheduler | 1 | `/dashboards/roofing-scheduler` | New |

---

## Phase 1 — Suite Split + Service Overview

### Suite Navigation Split

Register two separate suites. All of the following files must be updated:

| File | What to change |
|------|---------------|
| `src/lib/suite-nav.ts` | Split service+D&R entry into **Service Suite** (`/suites/service`, cyan) and **D&R + Roofing Suite** (`/suites/dnr-roofing`, purple). Update `SUITE_SWITCHER_ALLOWLIST` for every role that currently has `/suites/service` to also include `/suites/dnr-roofing`. |
| `src/lib/role-permissions.ts` | Add `/suites/dnr-roofing` and new dashboard paths to permission checks |
| `src/app/page.tsx` | Update home-page `SUITE_LINKS` cards — add D&R+Roofing as separate entry |
| `src/lib/page-directory.ts` | Register all new dashboard routes (`/dashboards/service-overview`, `/dashboards/roofing`, `/dashboards/roofing-scheduler`, etc.) |
| `src/components/DashboardShell.tsx` | Add individual `SUITE_MAP` entries for each new dashboard path (not wildcards): `service-overview`, `service-tickets`, `service-customers`, `service-warranty`, `service-catalog` → `/suites/service`; `roofing`, `roofing-scheduler` → `/suites/dnr-roofing` |
| `src/app/dashboards/service-scheduler/page.tsx` | Update hardcoded back link (currently points to combined suite) |
| `src/app/dashboards/dnr-scheduler/page.tsx` | Update hardcoded back link to point to `/suites/dnr-roofing` |

**Suite-level access** (both suites): ADMIN, OWNER, MANAGER, PROJECT_MANAGER, OPERATIONS, OPERATIONS_MANAGER.

**Note on TECH_OPS:** TECH_OPS currently has direct dashboard access to `service-scheduler`, `dnr-scheduler`, `service-backlog`, `service`, and `dnr` in `role-permissions.ts` (lines 440-449). These individual dashboard routes must be preserved even though TECH_OPS is not in the suite-level access list. Add new roofing dashboard routes (`/dashboards/roofing`, `/dashboards/roofing-scheduler`) to TECH_OPS's `allowedRoutes` to maintain parity with existing D&R/service access.

### Service Overview — Priority Queue Command Center

The hero dashboard for coordinators. Layout:

1. **KPI Strip** (top): Open Tickets, Active Deals, Overdue Items, Scheduled Today
2. **Priority Queue** (main): Unified sorted list of tickets + deals needing attention
3. **Bottom bar**: Today's schedule sidebar + location filter

#### Priority Scoring Engine

New module `src/lib/service-priority.ts`. Scores each item 0–100:

| Tier | Score | Triggers |
|------|-------|----------|
| Critical | 75–100 | System down, safety issue, warranty expiring <7 days, SLA breach |
| High | 50–74 | No customer contact >3 days, overdue scheduled work, high-value customer |
| Medium | 25–49 | Stuck in stage >3 days, pending inspection, needs scheduling |
| Low | 0–24 | On track, recently contacted, confirmed appointments |

#### Manual Priority Overrides

Prisma model `ServicePriorityOverride`:
- Keyed on `(itemId, itemType)` — unique per item
- Fields: `overridePriority`, `setBy`, `reason`, `expiresAt`
- Coordinators can pin/boost any item; override persists until expiry or significant data change

#### Cache & Refresh

- Cache key: `service:priority-queue`
- **New cascade invalidation logic** (does not exist today — must be built):
  - Register a **singleton app-level** `appCache.subscribe()` listener in a shared module (e.g., `src/lib/service-priority-cache.ts`), NOT inside the API route handler. Route handlers are request-scoped; cache subscriptions are process-local and long-lived. The API route only reads/rebuilds `service:priority-queue`.
  - Phase 1: listener watches `deals:service` only (the only upstream key that exists today via `CACHE_KEYS.DEALS("service")`)
  - Phase 2: add `service-tickets:*` to the watch list when ticket cache keys are created
  - Note: `zuper:jobs:*` cache keys do not exist today. If Zuper data is added to `appCache` in the future, add those prefixes to the watcher. Until then, Zuper schedule changes are picked up on next full queue rebuild (acceptable for best-effort freshness)
- **Debounced at 500ms** — new application-level debounce (not in `CacheStore` today). When the cascade listener fires, set a 500ms timer; reset on subsequent fires within the window. Only applies to cascade-triggered invalidation — manual user refreshes bypass debounce and rebuild immediately
- Client: `useSSE` with `cacheKeyFilter: "service:priority-queue"`
- Freshness model: best-effort single-instance (matches existing SSE architecture)

### Roofing Pipeline + Scheduler

Clone D&R Pipeline and D&R Scheduler patterns. Pipeline constants already exist in `deals-pipeline.ts`:

```
Roofing stages: On Hold → Color Selection → Material & Labor Order →
Confirm Dates → Staged → Production → Post Production →
Invoice/Collections → Job Close Out Paperwork → Job Completed
```

Roofing Zuper job categories already exist in `src/lib/zuper.ts` (`JOB_CATEGORY_UIDS`):
- `WALK_ROOF`: `b3289bad-d618-47c7-b592-43454b655982`
- `MID_ROOF_INSTALL`: `18f08c0d-f767-4e4a-8970-7c67597f4b4a`
- `ROOF_FINAL`: `92caf51d-1a53-4679-9b64-ba316ccb870d`

**Phase 1 scope: Read-only calendar view only.** Shows existing Zuper roofing jobs on a calendar (same pattern as D&R Scheduler's read view). Does NOT include interactive scheduling actions (slot-finding, assisted scheduling, availability management). The shared scheduling type model in `jobs/schedule/route.ts` and `assisted-scheduling/route.ts` currently only maps `survey`, `installation`, and `inspection` — expanding it for roofing is deferred to a future phase.

---

## Phase 2 — HubSpot Tickets Integration

### Prerequisites
- HubSpot private app needs `tickets` read scope added (admin action)
- HubSpot private app needs `tickets.write` scope for Ticket Board bulk actions (assign, status change, notes)

### Ticket API Module

New `src/lib/hubspot-tickets.ts` — parallel to `hubspot.ts`:
- Uses same `@hubspot/api-client` and `searchWithRetry()` pattern
- Properties: subject, content, priority, status, pipeline stage, create date, last activity, owner
- **Associations to fetch:** contacts AND deals AND companies. Deals are needed to derive location (`pb_location` on deal properties) and to power the "linked deals" panel in the Ticket Board detail view. Companies provide fallback location context.
- **Location derivation for tickets:** Ticket → associated deal → `pb_location` property. Fallback: Ticket → associated company → company address. If neither exists, location = "Unknown".

### Namespacing

Existing `admin/tickets` = internal bug reports (Prisma `BugReport`). All HubSpot service ticket resources use separate namespace:

| Resource | Name |
|----------|------|
| API routes | `/api/service-tickets/` |
| Cache keys | `service-tickets:all`, `service-tickets:pipeline` |
| Query keys | `serviceTickets*` |
| Module | `hubspot-tickets.ts` |

### Ticket Board Dashboard

`/dashboards/service-tickets` — Kanban-style view:
- Columns from custom ticket pipeline stages (discovered via API)
- Filters: location, priority, owner/assignee
- Click → detail panel: customer info, linked deals, activity timeline
- Bulk actions: assign, change status, add notes — via `PATCH /api/service-tickets/[id]` which proxies to HubSpot `PATCH /crm/v3/objects/tickets/{id}` (requires `tickets.write` scope)

### Priority Queue Merge

Update `service-priority.ts` to score tickets alongside deals. Update cascade invalidation.

---

## Phase 3 — Customer History + Warranty

### Customer Identity Resolver

New `src/lib/customer-resolver.ts`.

**Canonical grouping: Company ID + normalized service address.**

| Scenario | Resolution |
|----------|-----------|
| Company exists | Group by Company ID + normalized address |
| No company | Group by normalized address (street + zip) — see normalizer spec below |
| Multi-site company | Separate grouping per address |
| Spouse/partner contacts | Both associate to same Company → same group |

**Resolution chain:**
1. Contact → Company ID + address
2. Company + address → all associated Contacts
3. Contacts → Deal IDs + Ticket IDs (via HubSpot associations API)
4. Deal IDs → Zuper jobs (via `hubspotDealId` custom field)
5. Fallback: orphaned Zuper jobs matched by customer name + address

**Address Normalizer** (`normalizeAddress()`):
- Lowercase all text
- Expand abbreviations: `St.` → `Street`, `Ave` → `Avenue`, `Dr` → `Drive`, `Blvd` → `Boulevard`, `Ct` → `Court`, `Ln` → `Lane`, `Rd` → `Road`, `Pl` → `Place`, `Cir` → `Circle`
- Strip trailing periods, extra whitespace, unit/apt/suite suffixes for grouping key
- Normalize directionals: `N` → `North`, `S` → `South`, `E` → `East`, `W` → `West`
- Grouping key: `{normalized_street}|{zip5}` (first 5 digits of postal code)
- Example: `"123 Main St."` and `"123 Main Street"` both produce `"123 main street|80202"`

### Customer History Dashboard

`/dashboards/service-customers`:
- Search by customer name, email, phone, address
- Grouping header: "Smith Residence — 1234 Main St, Denver"
- Timeline: chronological touchpoints across tickets, deals, Zuper jobs, warranty events
- Summary cards: total visits, open issues, warranty status, system details
- Links to HubSpot contact/company records

### Warranty Tracker Dashboard

`/dashboards/service-warranty`:
- Table of systems under warranty
- Columns: customer, system type, install date, warranty expiration, status
- Alert indicators: 30/60/90-day expiration warnings
- Filters: location, warranty status, equipment type
- Data source: warranty properties on original install deals in HubSpot

---

## Phase 4 — Service Catalog + Sales Orders

### Service Catalog

`/dashboards/service-catalog` — filtered view of existing product catalog:
- Reuses `src/lib/zoho-inventory.ts` product data
- Category/tag-based filtering for service-relevant products
- Same catalog UI patterns from `/dashboards/catalog`

### Service SO Creation

New `src/lib/service-so-create.ts` — **direct line-item entry** (not BOM-based):
- Coordinator picks products from filtered catalog + enters quantities
- No BOM snapshots, versioning, or solar post-processing
- Shared: Zoho item matching + SO creation API from `zoho-inventory.ts`

**Idempotency via request token:**

| Field | Purpose |
|-------|---------|
| `requestToken` | Client-generated UUID per click path — must remain stable across retries of the same submission (e.g., network timeout → retry sends same token, not a new one) |
| `dealId` | Associates SO to deal — multiple SOs per deal allowed |
| `zohoSoId` | Set after Zoho submission — null while DRAFT |
| `status` | DRAFT → SUBMITTED (or FAILED) |

Flow: Client sends `requestToken` → server checks for existing → creates draft if new → submits to Zoho → writes `zohoSoId` back.

---

## Database Schema Additions

```prisma
model ServicePriorityOverride {
  id               String    @id @default(cuid())
  itemId           String
  itemType         String    // "deal" | "ticket"
  overridePriority String    // "critical" | "high" | "medium" | "low"
  setBy            String
  reason           String?
  expiresAt        DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@unique([itemId, itemType])
}

model ServiceOrder {
  id           String   @id @default(cuid())
  dealId       String
  requestToken String   @unique
  lineItems    Json     // Array<{ zohoItemId: string, name: string, quantity: number, unitPrice: number }>
  zohoSoId     String?
  status       String   @default("DRAFT")
  createdBy    String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

---

## Key Files

### To Reuse
- `src/lib/hubspot.ts` — `searchWithRetry()`, `hubspotClient`, rate-limit patterns
- `src/lib/deals-pipeline.ts` — Pipeline IDs + stage maps (service, roofing already defined)
- `src/lib/zuper.ts` — Zuper types, job categories, API helpers
- `src/lib/cache.ts` — `appCache`, `CACHE_KEYS`, subscribe/invalidate
- `src/hooks/useSSE.ts` — SSE subscription pattern
- `src/lib/zoho-inventory.ts` — Product matching, SO creation
- `src/components/DashboardShell.tsx` — Dashboard wrapper
- `src/components/ui/MetricCard.tsx` — Stat/Metric/Summary cards

### To Create
- `src/lib/service-priority.ts` — Priority scoring engine
- `src/lib/hubspot-tickets.ts` — HubSpot Tickets API module
- `src/lib/customer-resolver.ts` — Customer identity resolution
- `src/lib/service-so-create.ts` — Service SO creation (thin wrapper)
- 5 new dashboard pages + 1 new suite landing page
- New API routes:
  - `/api/service/priority-queue/route.ts` — GET priority queue data (Phase 1)
  - `/api/service/priority-queue/overrides/route.ts` — POST create/update priority override (Phase 1)
  - `/api/service/priority-queue/overrides/[itemType]/[itemId]/route.ts` — DELETE remove override (Phase 1)
  - `/api/service-tickets/route.ts` — GET HubSpot ticket listing (Phase 2)
  - `/api/service-tickets/[id]/route.ts` — GET single ticket detail, PATCH update ticket (assign, status, notes) (Phase 2). Requires HubSpot `tickets.write` scope.
  - `/api/service/customers/route.ts` — Customer search/listing (Phase 3)
  - `/api/service/customers/[id]/route.ts` — Customer detail + timeline (Phase 3)
  - `/api/service/warranty/route.ts` — Warranty data (Phase 3)
  - `/api/service/create-so/route.ts` — Service SO creation (Phase 4)

### To Modify
- `src/lib/suite-nav.ts` — Suite split
- `src/components/DashboardShell.tsx` — Breadcrumb updates
- `src/lib/cache.ts` — New cache keys + cascade listener
- `src/lib/query-keys.ts` — New query key entries
- `prisma/schema.prisma` — 2 new models
