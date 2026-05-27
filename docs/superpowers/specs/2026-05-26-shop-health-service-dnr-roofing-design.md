# Shop Health: Service + D&R/Roofing Sections — Design Spec

**Date:** 2026-05-26
**Author:** Zach Rosen (with Claude)
**Status:** Draft

## Problem

The Weekly Shop Health dashboard tracks only **Project Pipeline** deals. Three other production pipelines have no representation:

- **Service** (HubSpot pipeline `23928924`) — service jobs from contract through completion, plus the separate service ticket pipeline
- **D&R** (`21997330`) — detach/reset jobs for roofing work on existing solar installs (15 stages)
- **Roofing** (`765928545`) — standalone roofing jobs (10 stages)

Shop managers can't see at a glance how many active service jobs they have, how many open tickets, what's stuck in D&R reset-blocked-waiting-on-payment, or how the roofing crew is loaded. The dashboard is supposed to give a single weekly view of shop health and currently it's blind to three real production lines.

## Goals

1. Add a **Service** section that surfaces service deal pipeline state and ticket activity in one view
2. Add a combined **D&R + Roofing** section with throughput summary plus per-pipeline stage breakdowns
3. Surface the most actionable counts in the hero row so they're visible without scrolling
4. Extend the All Locations comparison table so cross-shop comparison includes these pipelines
5. Keep the orchestrator (`shop-health.ts`) lean by extracting new computation into focused files

## Non-Goals

- Service ticket priority queue scoring (the 0–100 score with Critical/High/Medium/Low tiers from `service-priority.ts`) is **not** integrated into shop health. Just raw counts and response metrics.
- D&R and Roofing get a **combined** section, not separate sections. They're related scopes and the dashboard has limited vertical space.
- No new heroes for D&R/Roofing breakdown — just one summary count.
- No changes to bottleneck diagnostics, customer success, or any existing section.
- ATTOM property data, warranty rollups, or other Property Object features are out of scope.

## High-Level Design

### Data Layer

The existing `fetchAllProjects()` in `hubspot.ts` is **hard-coded to the Project pipeline** (`pipeline = PROJECT_PIPELINE_ID`, line 1169) and uses Project-only `INACTIVE_STAGE_IDS` (line 1164). Reusing it would corrupt every caller that depends on Project-only semantics (`fetchAllProjects` powers goals-pipeline, office-performance, and others). We must NOT widen the existing fetcher.

**Approach:** add a new pure-fetcher `fetchDealsByPipelines(pipelineIds: string[], activeOnly: boolean): Promise<Project[]>` next to `fetchAllProjects`. It accepts pipeline IDs and, for active-only mode, computes the per-pipeline non-terminal stage IDs from `STAGE_MAPS` in `deals-pipeline.ts`. Internally it follows the same two-phase pattern (search for IDs, then batch-read properties).

The shop-health orchestrator calls this once with all four pipelines:

```
fetchDealsByPipelines([PROJECT, SERVICE, DNR, ROOFING], activeOnly: true)
  → allDeals → partition by deal.pipelineId →
      projectDeals  (existing flow)
      serviceDeals  (new)
      dnrDeals      (new)
      roofingDeals  (new)
```

**Required Project-type changes** (since `deal.pipelineId` doesn't currently exist):

- Add `pipelineId: string` to the `Project` interface in `hubspot.ts:254`
- Add `pipelineId: deal.pipeline || ""` to the transform around `hubspot.ts:1027`
- Add `pipelineId: ""` default to `deal-reader.ts` (same pattern used for previous Project additions)

The `pipeline` HubSpot property is already in `DEAL_PROPERTIES` (line 540) — no new property to add.

**Tickets**: One new parallel API call. `fetchServiceTickets()` currently takes no args and returns only open tickets (excludes closed stages server-side at `hubspot-tickets.ts:288-313`). To compute `ticketsClosedThisWeek` and `avgResolutionHours`, we need a second function:

- `fetchClosedTicketsSince(sinceIsoDate: string)` — fetches tickets in closed stages with `hs_lastmodifieddate >= sinceIsoDate`. New function in `hubspot-tickets.ts`, follows the same pattern as `fetchServiceTickets` but inverts the stage filter.

Both ticket fetches run in parallel with the deal fetch. Location filtering happens client-side in `computeServiceHealth` using each ticket's existing `_derivedLocation` field (resolved via the existing ticket→deal→pb_location + ticket→company→city fallback chain at `hubspot-tickets.ts:338,440-446`).

### Compute Functions (new files)

**`src/lib/shop-health-service.ts`** (~250 lines)
- Exports `computeServiceHealth(serviceDeals, tickets, goals, weekStart)` → `{ section: ServiceSection, drilldown: ServiceDrilldown }`
- Pure function: no DB or API calls, just computation over inputs
- Handles stage bucketing for service deals and ticket aggregation

**`src/lib/shop-health-dnr-roofing.ts`** (~300 lines)
- Exports `computeDnrRoofingHealth(dnrDeals, roofingDeals, goals, weekStart)` → `{ section: DnrRoofingSection, drilldown: DnrRoofingDrilldown }`
- Pure function with two stage-bucketing helpers: `bucketDnrStages()` and `bucketRoofingStages()`

The orchestrator in `shop-health.ts` partitions deals, calls these compute functions in parallel, and merges results into `ShopHealthData`.

### Types

**`shop-health-types.ts` additions:**

```typescript
export interface ServiceSection {
  // Job pipeline
  activeJobs: number;
  awaitingSiteVisit: number;
  workInProgress: number;
  awaitingInspection: number;

  // Ticket activity
  openTickets: number;
  ticketsCreatedThisWeek: number;
  ticketsClosedThisWeek: number;
  netTicketChange: number;  // created − closed

  // Ticket health
  avgTicketAgeDays: number | null;
  avgResolutionHours: number | null;
  stuckTicketsOver7d: number;
}

export interface DnrRoofingSection {
  // Throughput summary
  dnrActive: number;
  dnrCompletedThisWeek: number;
  roofingActive: number;
  roofingCompletedThisWeek: number;

  // D&R stage breakdown
  dnrPreDetach: number;       // Kickoff/Survey/Design/Permit/Ready for Detach
  dnrDetachInProgress: number;
  dnrRoofingPhase: number;    // Detach Complete - Roofing In Progress
  dnrResetBlocked: number;    // Reset Blocked - Waiting on Payment
  dnrResetPhase: number;      // Ready for Reset + Reset
  dnrCloseout: number;        // Inspection + Closeout

  // Roofing stage breakdown
  roofPreProduction: number;  // On Hold/Color/Material/Confirm/Staged
  roofInProduction: number;
  roofPostProduction: number; // Post Production/Invoice/Closeout Paperwork

  // Aging
  stuckDnrJobs: number;       // >14 days in current stage
  stuckRoofingJobs: number;   // >14 days in current stage

  // Diagnostic (stage label drift)
  unknownDnrStageCount: number;     // deals whose stage didn't match any bucket
  unknownRoofingStageCount: number;
}
```

**`ShopHealthData` gains two new section fields:** `service` and `dnrRoofing`.

**`ShopHealthDrilldown` extension** — new keys for every metric that supports drill-down (most of them). Standard `DrilldownDeal[]` shape, plus new `DrilldownTicket[]` shape for ticket-backed metrics.

```typescript
export interface DrilldownTicket {
  id: string;
  subject: string;
  status: string;
  priority: string | null;
  createDate: string | null;
  lastModified: string | null;
  dealName: string | null;  // resolved from association if available
}
```

**Hero keys** — `ShopHealthHeroes` gains two:
- `openTickets: HeroMetric`
- `dnrRoofingActive: HeroMetric`

### UI Components

**`src/app/dashboards/shop-health/ServiceSection.tsx`** (~120 lines)

Three rows in a responsive grid pattern matching existing sections:

- **Row 1 — Service Job Pipeline** (4 cards): Active Jobs, Awaiting Site Visit, Work In Progress, Awaiting Inspection. All DrilldownMetricCard with deal drill-down.
- **Row 2 — Ticket Activity** (4 cards): Open Tickets (drill to ticket list), Created This Wk, Closed This Wk, Net Change (color-coded: green ≤0, red >0).
- **Row 3 — Ticket Response Health** (3 cards): Avg Ticket Age, Avg Resolution Time, Stuck >7d.

**`src/app/dashboards/shop-health/DnrRoofingSection.tsx`** (~180 lines)

Four rows:

- **Row 1 — Throughput summary** (4 cards): D&R Active, D&R Completed This Wk, Roof Active, Roof Completed This Wk.
- **Row 2 — D&R Stage Breakdown** (6 cards, under `<h4>` sub-header "D&R workflow · active jobs by stage"): Pre-Detach, Detach In Progress, Roofing Phase, Reset Blocked (red if >0), Reset Phase, Closeout.
- **Row 3 — Roofing Stage Breakdown** (3 cards, under sub-header "Roofing workflow · active jobs by stage"): Pre-Production, In Production, Post-Production.
- **Row 4 — Aging** (2 cards): Stuck D&R Jobs (>14d), Stuck Roofing Jobs (>14d).

Drill-down support on every card that maps to a concrete deal set.

**Drill-down ticket display**: `DrilldownMetricCard.tsx:15` currently has a strict `deals?: DrilldownDeal[]` prop with a hard-coded table (columns: name, project#, amount, stage, PM, date). To support tickets without polluting the deal path, refactor the modal body into a render-prop or render-mode:

- Add optional `tickets?: DrilldownTicket[]` prop alongside `deals`
- Internal table renders dynamically based on which prop is non-empty: deal columns OR ticket columns (subject, status, priority, age, dealName-if-resolved)
- Card chrome (title, value, click handler, empty state) is unchanged
- Type-safe: exactly one of `deals` or `tickets` should be provided per usage (enforced at component level)

This is a ~50-line change to the card, not a from-scratch rewrite.

### Hero Row

`HeroMetrics.tsx` grows from 6 to 8 cards. Grid breakpoints adjust:
- `grid-cols-2` (mobile, 4 rows of 2)
- `md:grid-cols-4` (medium, 2 rows of 4)
- `xl:grid-cols-8` (large, 1 row of 8)

New heroes:
- **Open Tickets** — health: green ≤3, yellow ≤10, red >10
- **D&R+Roof Active** — neutral/informational (no goal, no health color)

### All Locations Table

The overview row type and endpoint must be extended in three places (not just the UI):

1. **`shop-health-types.ts:197` — `ShopHealthOverviewRow`** gains three fields:
   - `openTickets: HeroMetric`
   - `dnrActive: HeroMetric`
   - `roofActive: HeroMetric`
2. **The overview computation** (wherever it builds rows — typically `getShopHealthOverviewData()` in `shop-health.ts`) populates these from the new section data
3. **`AllLocationsView.tsx`** — render 3 new columns, sortable, color-coded by count

Table is already responsive-overflow; 3 new columns slot in after the existing Customer Success columns.

### Stage Bucketing

**`bucketDnrStages(stageName: string) → DnrBucket`**

Uses keyword matching against the canonical stage labels from `deals-pipeline.ts`. Explicit mapping (not generic keyword inference) since the D&R pipeline has labels like "Detach Complete - Roofing In Progress" that don't follow simple patterns:

```
"Kickoff" | "Site Survey" | "Design" | "Permit" | "Ready for Detach" → preDetach
"Detach"                                                             → detachInProgress
"Detach Complete - Roofing In Progress"                              → roofingPhase
"Reset Blocked - Waiting on Payment"                                 → resetBlocked
"Ready for Reset" | "Reset"                                          → resetPhase
"Inspection" | "Closeout"                                            → closeout
"Complete" | "Cancelled" | "On-hold"                                 → terminal/excluded
```

**`bucketRoofingStages(stageName: string) → RoofingBucket`**

```
"On Hold" | "Color Selection" | "Material & Labor Order" |
"Confirm Dates" | "Staged"                                → preProduction
"Production"                                              → inProduction
"Post Production" | "Invoice/Collections" |
"Job Close Out Paperwork"                                 → postProduction
"Job Completed"                                           → terminal/excluded
```

Both functions accept the canonical labels and return a discriminated union bucket. If a stage label doesn't match (e.g., HubSpot adds a new stage), it falls through to a default bucket with a warning log — does not throw.

### Caching & Real-Time Updates

- The shop-health response cache key (`shop-health:${locationSlug}:${weekStart}`) is unchanged — that key wraps the whole `ShopHealthData` payload and is fine to reuse since the payload is the same shape, just with new fields
- The **underlying fetcher cache** (`CACHE_KEYS.PROJECTS_ACTIVE`) keeps wrapping the Project-only `fetchAllProjects()` call. The new `fetchDealsByPipelines` call gets a separate cache key (e.g. `CACHE_KEYS.DEALS_ALL_PIPELINES_ACTIVE`) so it doesn't collide with consumers that rely on Project-only semantics
- TTL unchanged (10 min)
- SSE invalidation cascades: existing `deals:*` invalidations now also invalidate the new sections. Add `tickets:*` to the invalidation map so ticket-driven metrics refresh when tickets change.

### Performance

- One additional API parameter (widened pipeline filter) on the deal search — negligible impact
- One additional parallel API call (ticket fetch) — ~100-300ms, runs concurrently with deals
- Stage bucketing is O(n) over deals — negligible
- No DB queries added

Expected total dashboard load time: unchanged ±200ms.

## File Layout

**New files** (line estimates are realistic, not optimistic — each compute fn mirrors existing `computePreconstruction`-style patterns):

```
src/lib/shop-health-service.ts                          ~400 lines
src/lib/shop-health-dnr-roofing.ts                      ~500 lines
src/app/dashboards/shop-health/ServiceSection.tsx       ~150 lines
src/app/dashboards/shop-health/DnrRoofingSection.tsx    ~220 lines
```

**Modified files:**
```
src/lib/hubspot.ts              — add pipelineId to Project type/transform, add fetchDealsByPipelines()
src/lib/hubspot-tickets.ts      — add fetchClosedTicketsSince()
src/lib/deal-reader.ts          — add pipelineId default
src/lib/shop-health.ts          — call new fetcher, partition deals, delegate, merge
src/lib/shop-health-types.ts    — add ServiceSection, DnrRoofingSection, hero keys, drilldown keys, DrilldownTicket, 3 new ShopHealthOverviewRow fields
src/lib/cache.ts                — add CACHE_KEYS.DEALS_ALL_PIPELINES_ACTIVE
src/app/dashboards/shop-health/page.tsx          — render two new SectionCards
src/app/dashboards/shop-health/HeroMetrics.tsx   — render 2 new hero cards, adjust grid
src/app/dashboards/shop-health/AllLocationsView.tsx — add 3 new table columns
src/components/ui/DrilldownMetricCard.tsx        — refactor table body to support tickets prop
```

## Testing Approach

**Unit tests** (Jest):
- `shop-health-service.test.ts` — stage counts, ticket aggregation, edge cases (no tickets, all closed, all old)
- `shop-health-dnr-roofing.test.ts` — both bucketing functions with full stage label coverage, throughput counts, aging calc
- `bucketDnrStages.test.ts` and `bucketRoofingStages.test.ts` — exhaustive coverage of all stage labels including the unknown-stage fallthrough

**Integration test:**
- One existing shop-health snapshot test extended to assert the new section fields exist with expected shape

**Manual QA checklist:**
- View per-location dashboard for each of 5 offices
- Confirm hero row renders 8 cards correctly at mobile/tablet/desktop widths
- Confirm All Locations table renders 3 new columns and sorts correctly
- Click drill-down on every new card, verify modal opens with non-empty deal/ticket list
- Confirm SSE invalidation refreshes the new sections when a deal or ticket changes

## Open Questions & Assumptions

1. **Ticket location filtering**: Assumed tickets resolve to a location via the same chain as existing ticket display — ticket→deal→pb_location, fallback to ticket→company→city/state. If a ticket can't be located, it's excluded from per-location views but included in "All".
2. **Service deal location**: Service deals use the same `pb_location` field as project deals.
3. **Stage label drift**: If HubSpot stage labels change, bucketing functions log a warning and use a default bucket. They do not throw, so the dashboard degrades gracefully.
4. **D&R "On-hold" stage** is treated as **excluded from active** counts (along with Complete and Cancelled). Same as the existing pattern for terminal stages.
5. **"Stuck" threshold of 14 days** is hardcoded for now. Future enhancement could make this configurable per pipeline via `OfficeGoal` table.
6. **`daysSinceStageMovement`** (`hubspot.ts:374`, computed from `hs_v2_date_entered_current_stage`) is populated for all pipelines since the property is included in `DEAL_PROPERTIES`. The aging metric will work for D&R and Roofing without additional property fetches. Verified via existing usage at `hubspot.ts:3463`.
7. **Cancellations**: the existing Pipeline section already tracks Project pipeline cancellations. D&R/Roofing/Service cancellations are NOT separately surfaced — out of scope. Future enhancement.

## Migration & Rollout

- No DB schema changes
- No env var additions
- No feature flag — ships behind the existing dashboard role gates
- Backward compatible: existing data flow unchanged for Project pipeline
- Can be merged and deployed in a single PR

## Success Criteria

After merge, on the Shop Health dashboard:

1. Hero row shows 8 cards including Open Tickets and D&R+Roof Active
2. Service section renders with 11 metrics across 3 rows; all drill-downs work
3. D&R+Roofing section renders with ~15 metrics across 4 rows; stage breakdowns sum correctly to active totals
4. All Locations view shows 3 new columns and they sort correctly
5. Page load time unchanged ±200ms
6. SSE updates refresh new sections when underlying deals or tickets change
