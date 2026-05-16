# Weekly Shop Health Dashboard

**Date**: 2026-05-16
**Author**: Zach Rosen (IT)
**Origin**: Tracey Mallory's "PB P&L Ownership Framework" presentation, P&L Leadership meeting 2026-05-15
**Status**: Design approved, implementation pending

## Purpose

A per-location dashboard for Shop Directors to review weekly operational health during the new Weekly Operating Rhythm meetings. Maps directly to the 9-section framework Tracey presented, enabling directors to diagnose bottlenecks and own P&L outcomes.

Key message: "Everyone owns a piece. Shop Directors own the outcome."

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Extend office-performance (Approach A) | Reuses ~70% of existing per-location computation |
| V1 scope | 7 of 9 sections (Marketing + Financial deferred) | Marketing data source TBD; financial data needs accounting integration |
| CX metrics | Derive from HubSpot + new SLA tracking | Best available data for V1; formal tracking built alongside |
| Bottleneck entries | Persistent per-shop per-week | Directors fill in during meetings; history enables trend review |
| Location grouping | 4 groups (SLO + Camarillo = California) | Matches existing office-performance grouping |
| Week data | Compute on the fly from deal timestamps | No new cron snapshots; simpler, less DB overhead |
| Access | ADMIN, OWNER, OPERATIONS_MANAGER | Shop Directors = OPS_MGR; leadership = ADMIN/OWNER |
| Suite | Executive Suite | Alongside executive, revenue, command-center dashboards |

## Page Structure

**Route**: `/dashboards/shop-health`
**Shell**: `DashboardShell` with `accentColor="orange"`, `fullWidth={true}`

### Top Controls
- **Location tab bar**: Westminster | Centennial | Colorado Springs | California — defaults to user's `pb_location`, or first tab for ADMIN/OWNER
- **Week selector**: Current week (Mon-Sun) by default, with prev/next arrows. Prior weeks computed on the fly from timestamps
- **"All Locations" toggle**: Shows a comparison table across all 4 groups (like office-performance overview) instead of the 9-section detail view

### Layout
Single-column scrollable page:
1. Hero metrics row (6 StatCards)
2. Section cards in order (Pipeline → Precon/RTB → Scheduling → Operations → Inspections → Bottleneck)
3. Each section is a collapsible card with a header showing section health indicator

## Section 1: Hero Metrics Row

Six `StatCard` components. Each shows current-week value, delta arrow vs prior week, and health color.

| # | Metric | Source | Health Thresholds |
|---|--------|--------|-------------------|
| 1 | Leads | Deferred — placeholder "Coming soon" | N/A |
| 2 | Backlog (weeks) | Backlog-stage deal count / trailing avg weekly installs | Green 4-8wk, yellow 3 or 9-10, red <3 or >10 |
| 3 | Ready-to-Build Jobs | Deals in RTB + RTB-Blocked stages | Green >= 2x weekly capacity, yellow 1-2x, red <1x |
| 4 | Scheduled Installs (2-4 wk) | Deals with install dates in next 14-28 days | Green >= crew capacity, yellow 75-99%, red <75% |
| 5 | Installs Completed | Deals moved to Construction Complete this week | Green >= weekly goal, yellow 80-99%, red <80% |
| 6 | PTOs Received | Deals with ptoGrantedDate this week | Green >= weekly goal, yellow 80-99%, red <80% |

Weekly goals derived from `OfficeGoal` monthly targets / 4.3.

## Section 2: Pipeline Overview

Sourced from HubSpot project pipeline deals filtered to the selected location.

| Metric | Computation |
|--------|-------------|
| Contracts Signed (weekly) | Deals with `closedate` in selected week |
| Total Backlog (# jobs, $) | Deals in stages: Site Survey through RTB-Blocked |
| Backlog in Weeks | Backlog count / trailing 8-week avg completions per week |
| Avg System Margin at Sale | Mean of `system_margin` property on deals closed this week |
| Cancellation Rate | Deals moved to "Cancelled" or "Lost" this week / total active deals |

Visual: backlog-in-weeks gauge with 4-8 week target band highlighted.

## Section 3: Preconstruction & RTB

| Metric | Computation |
|--------|-------------|
| Jobs in Design | Count of deals in "Design & Engineering" stage |
| Jobs Submitted for Permit | Count in "Permitting & Interconnection" stage |
| Permits Approved (this week) | Deals that moved OUT of Permitting this week |
| Avg Days: Sale -> Permit | Mean of (permit_submit_date - closedate) for deals permitted this week |
| Total Ready Jobs | Count in "Ready To Build" + "RTB - Blocked" |
| Jobs Aging > 2 Weeks | Deals in Design/Permitting/RTB with `daysSinceStageMovement > 14` |

### Customer Experience Sub-Section

Derived from HubSpot data where possible; new tracking for change orders and escalations.

| Metric | Source | New Work Required |
|--------|--------|-------------------|
| Avg Response Time | HubSpot `notes_last_contacted` vs last inbound activity | Derivation logic only |
| Proactive Update Cadence | % of active deals with a note/email in last 7 days | Query HubSpot engagement timeline |
| Issue Resolution Time | Avg days open for service tickets linked to project deals | Cross-reference ticket data |
| Change Orders per Job | New: track via HubSpot note tag or custom property | New `change_order_count` property on deals |
| Escalations (# and aging) | New: track via custom property + flag | New `escalation_date` and `is_escalated` properties |

**V1 pragmatism**: Response time and update cadence can be derived from existing HubSpot data. Change orders and escalations require new HubSpot custom properties — include property creation in implementation but expect data to be sparse initially.

## Section 4: Scheduling

| Metric | Computation |
|--------|-------------|
| Jobs Scheduled Next 2 Weeks | Deals with install dates in next 14 days |
| Jobs Scheduled Next 4 Weeks | Deals with install dates in next 28 days |
| Schedule Accuracy | Installs completed on their originally scheduled date / total completed this week |
| % Crew Capacity Filled | Scheduled installs for next 2 weeks / (crew count x 2 weeks of workdays) |

Uses existing crew capacity config from `executive-shared.ts` (per-location crew counts and monthly targets).

## Section 5: Operations

| Metric | Computation |
|--------|-------------|
| Installs Completed (this week) | Deals with construction_complete_date in selected week |
| Installs Planned vs Actual | Count of installs that were scheduled for this week vs actually completed |
| Crew Utilization % | Actual installs / available crew-days this week |
| Cost per Install | Deferred — requires labor cost data not in HubSpot. Show placeholder. |

## Section 6: Inspections / Closeout

| Metric | Computation |
|--------|-------------|
| Jobs Awaiting Inspection | Deals in "Inspection" stage |
| Inspections Passed (this week) | Deals with `inspectionPassDate` in selected week |
| Days Install -> Inspection | Avg of (inspectionPassDate - construction_complete_date) for inspections this week |
| PTOs Received | Deals with `ptoGrantedDate` in selected week |

Existing fields: `inspectionPassDate`, `inspectionFailDate`, `ptoGrantedDate`, `inspectionTurnaroundTime` — all available in the Project interface.

## Section 7: Bottleneck & Actions (Persistent)

Editable form saved per location per week. Shop Directors fill in during the weekly meeting.

| Field | Type |
|-------|------|
| Current Constraint | Free text — what's the #1 bottleneck this week? |
| Root Cause | Free text — why is it happening? |
| Action Plan | Free text — what will be done to fix it? |
| Owner | Dropdown — select from team members at this location |

### Diagnostic Framework (read-only reference)
Display the bottleneck attribution map from Tracey's slide 16 as a reference panel:
- No leads -> Marketing
- No backlog -> Sales
- No approvals -> Preconstruction
- No schedule -> PM
- Low installs -> Ops
- No closeout -> Inspections

### Data Model

```prisma
model ShopHealthBottleneck {
  id          String   @id @default(cuid())
  location    String   // normalized location name
  weekStart   DateTime // Monday of the week (truncated to date)
  constraint  String?  // current constraint text
  rootCause   String?  // root cause text
  actionPlan  String?  // action plan text
  owner       String?  // owner name or user ID
  createdBy   String   // user ID who created/last edited
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([location, weekStart])
  @@index([location])
  @@index([weekStart])
}
```

Auto-save on field blur. Previous weeks' entries are read-only (viewable when navigating to prior weeks).

## API Design

### GET /api/shop-health/[location]

Returns all dashboard data for a single location group.

**Query params**: `week` (ISO date string for week start, defaults to current week Monday)

**Response shape**:
```typescript
interface ShopHealthData {
  location: string;
  weekStart: string; // ISO date
  weekEnd: string;

  // Hero metrics with deltas
  heroes: {
    leads: HeroMetric | null; // null = deferred
    backlogWeeks: HeroMetric;
    readyToBuild: HeroMetric;
    scheduledInstalls: HeroMetric;
    installsCompleted: HeroMetric;
    ptosReceived: HeroMetric;
  };

  // Section data
  pipeline: PipelineSection;
  preconstruction: PreconstructionSection;
  scheduling: SchedulingSection;
  operations: OperationsSection;
  inspections: InspectionsSection;

  // Bottleneck (may be null if not yet filled in)
  bottleneck: ShopHealthBottleneck | null;

  // Meta
  lastUpdated: string;
  goals: { monthly: number; weekly: number }; // from OfficeGoal
}

interface HeroMetric {
  value: number;
  priorWeek: number | null;
  delta: number | null; // value - priorWeek
  health: 'green' | 'yellow' | 'red';
  target: number | null;
}
```

### GET /api/shop-health/overview

Returns comparison data for all 4 location groups — used by the "All Locations" toggle.

### POST /api/shop-health/bottleneck

Create or update a bottleneck entry for a location + week.

**Body**: `{ location, weekStart, constraint?, rootCause?, actionPlan?, owner? }`
**Auth**: ADMIN, OWNER, OPERATIONS_MANAGER only. Uses upsert on `(location, weekStart)`.

### GET /api/shop-health/bottleneck?location=X&weeks=N

Returns the last N weeks of bottleneck entries for a location (default N=4).

## Data Layer: lib/shop-health.ts

New module that orchestrates data for the dashboard. Does NOT duplicate office-performance queries — calls `getOfficePerformanceData()` and augments with:

1. **Backlog-in-weeks calculation**: backlog deal count / trailing 8-week avg weekly completions
2. **Week-bounded metrics**: Filters deals by date ranges for "this week" and "prior week" to compute deltas
3. **CX metrics**: Queries HubSpot engagement timeline for response times and update cadence
4. **Health scoring**: Applies threshold rules to each hero metric using OfficeGoal targets
5. **Bottleneck reads**: Queries `ShopHealthBottleneck` for the selected week

Key function: `getShopHealthData(location: string, weekStart: Date): Promise<ShopHealthData>`

## Client: hooks/useShopHealthData.ts

React Query hook wrapping the API call. Stale time: 2 minutes. Refetch on window focus. SSE invalidation on `shop-health:*` cache keys.

```typescript
function useShopHealthData(location: string, weekStart: Date) {
  return useQuery({
    queryKey: queryKeys.shopHealth(location, weekStart),
    queryFn: () => fetchShopHealthData(location, weekStart),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}
```

## Role & Route Configuration

- Add `/dashboards/shop-health` to `allowedRoutes` for ADMIN, OWNER, OPERATIONS_MANAGER in `src/lib/roles.ts`
- Add dashboard card to Executive Suite page (`src/app/suites/executive/page.tsx`)
- Add to suite-nav links for Executive Suite in `src/lib/suite-nav.ts`

## Files to Create/Modify

### New Files
- `src/app/dashboards/shop-health/page.tsx` — main dashboard page
- `src/app/api/shop-health/[location]/route.ts` — location-specific data API
- `src/app/api/shop-health/overview/route.ts` — all-locations comparison API
- `src/app/api/shop-health/bottleneck/route.ts` — bottleneck CRUD API
- `src/lib/shop-health.ts` — data orchestration and computation
- `src/hooks/useShopHealthData.ts` — React Query hook
- `prisma/migrations/XXXX_add_shop_health_bottleneck/migration.sql` — new table

### Modified Files
- `prisma/schema.prisma` — add `ShopHealthBottleneck` model
- `src/lib/roles.ts` — add route to ADMIN, OWNER, OPS_MGR allowedRoutes
- `src/lib/suite-nav.ts` — add to Executive Suite links
- `src/app/suites/executive/page.tsx` — add dashboard card
- `src/lib/query-keys.ts` — add `shopHealth` key factory

## Deferred to V2

- **Section 1: Marketing** — needs marketing data source (HubSpot Marketing Hub or external)
- **Section 8: Financial Snapshot** — needs accounting integration for gross margin and labor cost
- **Cost per Install** (Section 5) — requires labor cost data
- **Historical snapshots** — weekly cron for time-series if on-the-fly computation proves too slow
- **Automated bottleneck detection** — AI-driven identification of constraints from metric patterns
- **Email digest** — weekly summary email sent to Shop Directors before the meeting
