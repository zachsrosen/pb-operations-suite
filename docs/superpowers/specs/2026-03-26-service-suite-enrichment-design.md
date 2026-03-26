# Service Suite Enrichment — Design Spec

**Date**: 2026-03-26
**Source**: Zach / Jessica Service Suite meeting (Mar 26, 2026)
**Scope**: Priority queue improvements (B) + Customer history enrichment (D) + cross-page data enrichment

---

## 1. Goals and Non-Goals

### Goals
- Shared server-side enrichment layer so all service pages return richer deal/ticket data without client-side changes
- Contact-level "last contact" scoring in the priority queue (replacing deal-level)
- Priority reason filtering on the service overview
- `service_type` displayed across all service pages, replacing "project type" on service deals
- Customer history shows Zuper jobs (currently broken — empty cache)
- Equipment backlog resolves product names (currently shows "Unknown")
- Enriched deal/ticket cards across overview, tickets, backlog, pipeline pages

### Non-Goals (deferred to future specs)
- Service schedule enhancements (day view, modal links, revisit colors, all assignees)
- Service backlog stage filtering fix (Inspection/Invoicing incorrectly included)
- Catalog UX (alphabetical sort, sticky headers, inline edit)
- HubSpot workflow automation changes (trigger updates, auto-follow-up tasks)
- New HubSpot properties for schedule start/complete dates

---

## 2. Shared Enrichment Contract

### Canonical Type

All service pages use this single enriched type. Defined once in `lib/service-enrichment.ts`, imported everywhere.

```typescript
/** Base enrichment fields added to any service deal or ticket */
interface ServiceEnrichment {
  serviceType: string | null;
  lastContactDate: string | null;       // from contact hs_last_sales_activity_timestamp
  lastContactSource: "contact" | "deal" | null;  // tracks which source was used
  lineItems: ServiceLineItem[] | null;
  zuperJobs: ServiceZuperJob[] | null;
}

interface ServiceLineItem {
  name: string;
  quantity: number;
  category: string | null;    // MODULE, INVERTER, BATTERY, etc.
  unitPrice: number | null;
}

interface ServiceZuperJob {
  jobUid: string;
  title: string;
  category: string;           // Service Visit, Service Revisit, etc.
  status: string;
  assignedUsers: string[];    // all assigned, not just first
  scheduledDate: string | null;
  completedDate: string | null; // derived: scheduledEnd when status is COMPLETED; requires schema migration (see Section 6)
  zuperUrl: string;            // constructed: `https://app.zuper.co/app/job/${jobUid}` (verify URL pattern during implementation)
}
```

### Enrichment Function

```typescript
/**
 * Enriches a batch of service deals/tickets with contact activity,
 * line items, and Zuper jobs. Operates in batch to avoid N+1.
 */
async function enrichServiceItems(
  items: { itemId: string; itemType: "deal" | "ticket"; contactIds: string[] }[],
  options?: { includeLineItems?: boolean; includeZuperJobs?: boolean }
): Promise<Map<string, ServiceEnrichment>>
```

- Accepts a batch of deal/ticket IDs with their type and associated contact IDs
- `itemType` controls behavior: tickets skip line item resolution and use ticket→contact associations instead of deal→contact
- Returns a Map keyed by item ID
- Options allow pages to skip expensive lookups they don't need
- Each API route calls this once for its full result set, then merges into its response

---

## 3. Field Derivation Rules

### `serviceType`

**Source**: HubSpot property `service_type` on the deal or ticket record.

**Prerequisite**: Verify `service_type` exists as a custom property on deals and tickets in the PB HubSpot portal. The property is not currently fetched by any API route. During implementation, check the property exists via `GET /crm/v3/properties/deals` before adding it to fetch lists. If it doesn't exist, create it as a dropdown/select property with appropriate options (Site Visit, Revisit, Remote Troubleshooting, etc.).

**Precedence** (if multiple sources disagree):
1. Ticket `service_type` (most specific to the work being done)
2. Deal `service_type` (set at deal creation)
3. Zuper job category (fallback if HubSpot properties are empty)
4. `null` if none available

**Display**: Colored badge. Replaces "project type" wherever it appeared on service deals.

### `lastContactDate`

**Source**: Contact-level `hs_last_sales_activity_timestamp`.

**Prerequisite**: Verify this property is populated on contacts in the PB HubSpot portal before implementation. This is a standard HubSpot property that tracks sales engagement activity (logged calls, emails, meetings — not marketing). Run a sample query of ~20 service deal contacts during implementation to confirm the field has values. If it's empty on most contacts, fall back to `notes_last_contacted` on the contact (not the deal) as the primary source.

**Resolution**:
1. Resolve deal/ticket → contact associations (batch read; tickets use ticket→contact, deals use deal→contact)
2. Batch-read `hs_last_sales_activity_timestamp` from associated contacts
3. If multiple contacts, use the most recent timestamp
4. **Fallback**: If no associated contacts or field is empty, fall back to deal-level `notes_last_contacted`
5. Track which source was used in `lastContactSource` for transparency

**Scoring impact**: The priority queue scoring function (`scorePriorityItem`) uses this timestamp for the "Last Contact Recency" factor (up to 35 pts). Existing thresholds (>7 days = +35, >3 days = +25, >1 day = +5) remain unchanged.

### `lineItems`

**Source**: HubSpot line item associations on the deal.

**Resolution**:
1. Batch-read deal → line item associations
2. For each line item, read: `name`, `quantity`, `price`, `hs_product_id`
3. If `hs_product_id` exists, look up `InternalProduct` for category
4. If no InternalProduct match, use line item `description` or `name` for display
5. `null` if deal has no line items (not an error — some service deals legitimately have none)

### `zuperJobs`

**Source**: Zuper API via `ZuperJobCache`.

**Resolution**: See Section 6 (Bug Fix: Zuper Jobs) for the cache population strategy. Once the cache is populated:
1. Query `ZuperJobCache` by `hubspotDealId` matching any of the contact's associated deal IDs
2. Fallback: name/address heuristic search (existing code in `customer-resolver.ts`)
3. Return all matched jobs with full metadata
4. `null` only if cache is empty AND heuristic finds nothing

---

## 4. Route-by-Route Rollout

### 4a. Priority Queue (`/api/service/priority-queue`)

**Changes**:
- Add `service_type` to deal properties fetch list
- Call `enrichServiceItems()` with `{ includeLineItems: false, includeZuperJobs: false }` (only need contact activity + service type here)
- Update `scorePriorityItem()` to accept contact-level `lastContactDate` instead of deal-level `notes_last_contacted`
- Add `reasons` categories to response for filtering

**New response fields**:
```json
{
  "queue": [{
    "item": { "...existing...", "serviceType": "Site Visit" },
    "lastContactDate": "2026-03-20T...",
    "lastContactSource": "contact",
    "reasonCategories": ["no_contact", "stuck_in_stage"]
  }],
  "reasonCategories": ["no_contact", "warranty_expiring", "stuck_in_stage", "high_value", "stage_urgency"]
}
```

**Reason category mapping** (derived from scoring code branches in `scorePriorityItem`):

| Scoring branch | Maps to category |
|---|---|
| Warranty expired / ≤7 days / ≤30 days | `warranty_expiring` |
| No contact >1 day / >3 days / >7 days | `no_contact` |
| Stuck in stage >3 days / >7 days | `stuck_in_stage` |
| Deal value >$5k / >$10k | `high_value` |
| Inspection/Invoicing urgency / active >5 days | `stage_urgency` |

Each item gets all categories that contributed to its score (not just the highest). This is deterministic — derived from which scoring branches added points, not from the free-text reason strings.

**Frontend changes** (service-overview page):
- Add `service_type` column to priority queue table
- Add reason category multi-select filter (alongside existing tier/location/owner filters)
- Filter logic: show item if any of its `reasonCategories` intersect with selected filter values

### 4b. Customer History (`/api/service/customers/[contactId]`)

**Changes**:
- Call `enrichServiceItems()` with `{ includeLineItems: true, includeZuperJobs: true }` for all associated deals
- Merge enrichment data into existing `ContactDetail` response
- Fix Zuper jobs bug (see Section 6)

**Enhanced response shape** (additions to existing fields):
```json
{
  "deals": [{
    "...existing...",
    "serviceType": "Revisit",
    "lastContactDate": "2026-03-22T...",
    "daysInStage": 4,
    "lineItems": [{ "name": "Powerwall 3", "quantity": 1, "category": "BATTERY" }],
    "hubspotUrl": "https://app.hubspot.com/..."
  }],
  "tickets": [{
    "...existing...",
    "serviceType": "Remote Troubleshooting",
    "daysInStage": 2
  }],
  "jobs": [{
    "...existing (but now actually populated)...",
    "assignedUsers": ["Christian Garcia", "Jerry Torres"],
    "completedDate": null
  }]
}
```

**`daysInStage` derivation**: Calculated as `Math.floor((now - hs_lastmodifieddate) / 86400000)`. This uses last-modified as a proxy for "when the stage last changed." If HubSpot `hs_date_entered_<stageId>` properties are available and populated for the service pipeline, prefer those for accuracy — but verify during implementation since these are pipeline-specific and may not exist for all stages.

**Frontend changes** (service-customers page):
- Deal cards: add service type badge, days in stage, line items summary, HubSpot link
- Ticket cards: add service type badge, days in stage
- Job cards: add assigned technicians, completion status

### 4c. Service Tickets (`/api/service/tickets`)

**Changes**:
- Add `service_type` to `TICKET_PROPERTIES` in `hubspot-tickets.ts`
- Pass through to `EnrichedTicketItem` response
- No line items or Zuper jobs needed on this route

**Frontend changes** (service-tickets page):
- Kanban cards: add service type badge below priority
- Detail slide-over: add service type in header area

### 4d. Service Backlog (`/api/service/equipment` → consumed by `service-backlog` page)

**Note**: The `/api/service/equipment` endpoint is consumed by `/dashboards/service-backlog/page.tsx`, not the project-level `equipment-backlog` page.

**Changes**:
- Call `enrichServiceItems()` with `{ includeLineItems: true, includeZuperJobs: false }`
- Replace deal-property-based equipment names with line-item-resolved names
- Add `service_type` to response

**Frontend changes** (service-backlog page):
- Equipment names resolved from line items instead of showing "Unknown"
- Add service type badge to deal cards

---

## 5. Failure, Caching, and Performance

### Failure Behavior

Enrichment is **additive, never blocking**. If any enrichment sub-step fails:
- `serviceType`: falls through precedence chain, worst case `null`
- `lastContactDate`: falls back to deal-level, worst case `null` (scores as "no contact" — conservative, acceptable)
- `lineItems`: returns `null`, pages show existing deal-property fallback or "No line items"
- `zuperJobs`: returns `null`, customer history shows empty jobs section (same as today)

Each page must render correctly with all enrichment fields as `null`. No page should error because enrichment failed.

### Batching Strategy

The enrichment function operates on the **full result set** of each API route, not per-row:

1. **Contact resolution**: Single batch HubSpot associations call for all deal IDs → contact IDs
2. **Contact properties**: Single batch-read of `hs_last_sales_activity_timestamp` for all unique contact IDs
3. **Line items**: Single batch HubSpot associations call for all deal IDs → line item IDs, then single batch-read of line item properties
4. **Zuper jobs**: Single Prisma query with `hubspotDealId IN (...)` for all deal IDs

Maximum additional API calls per route: 3-4 batch calls regardless of result set size. No N+1.

HubSpot batch-read limit is 100 IDs per call. If result set exceeds 100 contacts or line items, chunk into multiple batch calls (existing `chunk()` pattern in `hubspot.ts`). Chunks process sequentially to stay within HubSpot rate limits — no parallel chunk execution.

### Caching

- Priority queue already caches at `service:priority-queue` with cascade invalidation — no change needed
- Contact-level `hs_last_sales_activity_timestamp` is fetched fresh each time (part of the batch call, not separately cached)
- `ZuperJobCache` is the cache for Zuper jobs — populated by sync (see Section 6)
- Line items are not cached separately — fetched per request as part of the batch enrichment

---

## 6. Bug Fixes

### Bug Fix A: Zuper Jobs Not Appearing in Customer History

**Root Cause**: The `ZuperJobCache` table is **partially populated** — the `cacheZuperJob()` function in `lib/db.ts` is called when jobs are created or rescheduled through the PB Operations Suite scheduling UI (4 call sites: schedule, confirm, book, reschedule routes). However, jobs created directly in Zuper (not via the suite) are never cached. For service jobs — which are often created in Zuper directly — this means most service jobs are missing from the cache.

**Fix**:
1. Create a full Zuper job sync function in `lib/zuper-sync.ts` (or extend existing `lib/zuper.ts`)
2. Fetch all Zuper jobs via the Zuper API (paginated), filtered to service categories
3. For each job, extract the HubSpot deal ID from job custom fields or tags
4. Upsert into `ZuperJobCache` (existing `cacheZuperJob()` already handles deduplication via upsert on `jobUid`)
5. Expose as an API endpoint (`/api/zuper/sync-cache`) callable by cron
6. Run on a schedule (every 30 minutes for service-sensitive freshness) plus on-demand trigger
7. The existing `resolveContactDetail()` code then works as-is — it just needs more complete data in the table

**Migration**: Add `completedDate DateTime?` column to `ZuperJobCache` model. Populated from `scheduledEnd` when job status is COMPLETED, or from Zuper API `completed_at` field if available. Existing columns cover all other needed fields.

### Bug Fix B: "Unknown" Equipment Names on Backlog

**Root Cause**: The equipment API (`/api/service/equipment`) derives product names from deal properties `modules`, `inverter`, `battery`, `battery_expansion`. These HubSpot properties are **empty or unpopulated** on most service deals. When empty, `String(deal.modules ?? "")` returns `""`, and the frontend `formatProduct()` function falls back to `"Unknown"`.

**Fix**:
The enrichment layer (Section 2) resolves line items via HubSpot associations, which returns actual product names. The equipment backlog route will use `enrichServiceItems({ includeLineItems: true })` and derive equipment names from line item data instead of deal properties.

Fallback chain for equipment display name:
1. Line item product name (from HubSpot line item `name` property)
2. InternalProduct name (if line item has `hs_product_id` → InternalProduct lookup)
3. Deal property (`modules`, `inverter`, etc.) — existing behavior
4. Brand + Model concatenation (from deal properties like `module_brand` + `module_model`)
5. `"Unknown"` — only if all above are empty

This eliminates most "Unknown" cases since line items typically have product names even when deal properties don't.

---

## 7. Testing and Regression Checks

### Unit Tests
- `scorePriorityItem()` with contact-level vs deal-level fallback timestamps
- `enrichServiceItems()` batch function with partial failures (some contacts missing, some line items empty)
- `serviceType` precedence logic (ticket > deal > Zuper > null)
- `formatProduct()` fallback chain (line item > InternalProduct > deal property > brand+model > Unknown)

### Integration Tests
- Priority queue API returns `reasonCategories` and `serviceType`
- Customer history API returns non-empty `jobs` array when `ZuperJobCache` has data
- Equipment backlog API returns resolved product names instead of "Unknown"
- All service APIs still render correctly when enrichment returns all `null` values (graceful degradation)

### Manual QA
- Verify priority queue re-scores correctly after switching to contact-level last contact
- Verify reason filter correctly narrows the queue
- Verify customer history shows Zuper jobs after cache sync
- Verify equipment backlog shows real product names
- Verify service type displays on all 4-5 service pages
- Verify no regression on existing filters (tier, location, owner)
