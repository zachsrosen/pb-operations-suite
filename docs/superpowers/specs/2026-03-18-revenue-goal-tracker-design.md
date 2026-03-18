# Revenue Goal Tracker — Design Spec

**Date**: 2026-03-18
**Requested by**: Tracey Mallory, Zach
**Placement**: Top of Executive Suite landing page (`src/app/suites/executive/page.tsx`)

## Purpose

Track Photon Brothers' $52.5M annual revenue goal across 6 shop groups, with per-group monthly targets, at-a-glance progress visualization, and celebration/miss indicators.

### Metric Semantics

This feature tracks **recognized revenue** — dollars counted when a completion milestone is recorded in HubSpot. This is intentionally different from the existing **scheduled revenue** model used in the executive calendar (`/api/zuper/revenue-calendar`), which spreads deal value across Zuper job business days.

| Concept | Source | Granularity | Purpose |
|---------|--------|-------------|---------|
| Recognized revenue (this feature) | HubSpot completion date fields | Month of completion | "How much have we actually completed against our annual goal?" |
| Scheduled revenue (existing) | Zuper jobs by category | Business days | "What revenue is coming up on the calendar?" |

Both are valid views of revenue. They will show different numbers and that is correct.

---

## Revenue Goal Groups

### Structured Group Config

```typescript
interface RevenueGroupConfig {
  groupKey: string;                    // Stable identifier, DB primary key component
  displayName: string;                 // UI label
  pipelineKeys: string[];              // HubSpot pipeline IDs to include
  locationFilters: string[];           // pb_location values (empty = all locations for that pipeline)
  recognitionStrategies: RecognitionStrategy[];
  annualTarget: number;                // Default annual target in dollars
  color: string;                       // Hex color for charts
}

interface RecognitionStrategy {
  field: string;                       // HubSpot date property name
  amountFraction: number;              // 0.0–1.0, portion of deal amount recognized
  status: "ready" | "discovery-gated"; // Whether the field is confirmed to exist
}
```

### Group Definitions

| `groupKey` | `displayName` | `pipelineKeys` | `locationFilters` | Recognition | Annual Target | Color |
|------------|--------------|----------------|-------------------|-------------|---------------|-------|
| `westminster` | Westminster | `["6900017"]` (project) | `["Westminster"]` | `construction_complete_date` @ 100% | $15M | `#3B82F6` |
| `dtc` | DTC | `["6900017"]` (project) | `["Centennial"]` | `construction_complete_date` @ 100% | $15M | `#10B981` |
| `colorado_springs` | CO Springs | `["6900017"]` (project) | `["Colorado Springs"]` | `construction_complete_date` @ 100% | $7M | `#F59E0B` |
| `california` | California | `["6900017"]` (project) | `["San Luis Obispo", "Camarillo"]` | `construction_complete_date` @ 100% | $7M | `#8B5CF6` |
| `roofing_dnr` | Roofing + D&R | `["21997330", "765928545"]` (D&R + Roofing) | `[]` (all locations) | See multi-strategy below | $7M | `#EC4899` |
| `service` | Service | `["23928924"]` (service) | `[]` (all locations) | Discovery-gated | $1.5M | `#06B6D4` |

**Total**: $52.5M

> **Note on `dtc`**: The `pb_location` value in HubSpot is `"Centennial"`, not `"DTC"`. The display name is `"DTC"` but all data filtering must use the canonical HubSpot value `"Centennial"`.

### Roofing + D&R Multi-Strategy

The `roofing_dnr` group uses a unified UI group with multiple recognition strategies underneath:

```typescript
recognitionStrategies: [
  // D&R pipeline deals
  { field: "detach_completion_date", amountFraction: 0.5, status: "ready" },
  { field: "reset_completion_date",  amountFraction: 0.5, status: "ready" },
  // Roofing pipeline deals
  { field: "TBD",                    amountFraction: 1.0, status: "discovery-gated" },
]
```

D&R deals contribute 50% of deal amount at detach completion and 50% at reset completion. Each half is recognized in the month its completion date falls. Roofing deals are discovery-gated until the HubSpot property name is confirmed.

### Discovery-Gated Groups

Service and Roofing (within `roofing_dnr`) will:
- Show configured targets in the admin table and hero section
- Display `$0` actuals with a subtle "recognition field not configured" badge
- Light up with real data once the HubSpot property names are wired in
- Require only a config change (adding the field name), not a code change

### Pre-Implementation Discovery Step

The D&R property names `detach_completion_date` and `reset_completion_date` are referenced in the SOP guide but are not yet wired into any HubSpot fetch list in the codebase. Before implementation:

1. **Verify property internal names** via HubSpot Settings > Properties or the HubSpot Properties API (`GET /crm/v3/properties/deals`)
2. Confirm the internal names match what the SOP guide documents (labels like "Detach Completion Date" may have different internal names like `detach_completion_date` or `hs_detach_completion_date`)
3. Also check for Service and Roofing completion date properties while in the portal

---

## D&R Recognition Edge Cases

| Scenario | Behavior |
|----------|----------|
| Detach complete, reset not yet done | 50% recognized in detach month. Reset 50% recognized whenever it completes. |
| Detach and reset in different months | Each half counts in its respective month. Normal. |
| Deal amount changes after recognition | Recalculate from current deal amount. Always use live HubSpot `amount`. |
| Cancelled D&R deal | Excluded from actuals regardless of completion dates. Cancelled = $0. |
| Backfilled/edited dates | Actuals recompute from current HubSpot data. No month-close freeze on actuals. |

**Design choice**: Actuals are always a live query against current HubSpot state. No frozen-month reconciliation. Goal targets can freeze (via redistribution), but actuals are truth-from-source.

### Deal Exclusion Rules

Deals in terminal/cancelled stages are excluded from revenue recognition regardless of completion dates:

| Pipeline | Excluded Stages |
|----------|----------------|
| Project (6900017) | `68229433` = "Cancelled" |
| D&R (21997330) | `52474745` = "Cancelled" |
| Service (23928924) | `56217769` = "Cancelled" |
| Roofing (765928545) | N/A (discovery-gated; exclusion rules will be defined when the recognition field is configured) |

A deal with a backfilled completion date that later moves to a cancelled/lost stage will be removed from actuals on the next query.

---

## Data Model

### Prisma: `RevenueGoal`

```prisma
model RevenueGoal {
  id        String   @id @default(cuid())
  year      Int
  groupKey  String   // e.g., "westminster", "dtc", "roofing_dnr"
  month     Int      // 1–12
  target    Decimal  // Base target in dollars (Decimal for currency precision)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  updatedBy String?  // User ID who last edited

  @@unique([year, groupKey, month])
  @@index([year])
}
```

**Seeding**: On first access for a year, if zero rows exist for that year, auto-seed with even split (`annualTarget / 12`) for all 6 groups x 12 months = 72 rows. Partial configurations (e.g., 36 of 72 rows exist) are not auto-completed — admin fills the rest manually.

---

## Target System: Base vs Effective

Two distinct target values per group per month:

### Base Target
- Stored in `RevenueGoal` table
- Set by admin via config page
- Defaults to even split of annual target
- Never auto-modified by the system

### Effective Target
- Computed on the fly at query time, never persisted
- For **closed months**: equals base target (frozen)
- For **current month and future months**:

```
ytd_shortfall = sum(base_targets for closed months) - sum(actuals for closed months)
remaining_months = current month + future months (i.e., 12 - closed_months)
effective = base_target + (ytd_shortfall / remaining_months)
```

The current open month participates in redistribution — its effective target adjusts based on prior shortfall/surplus, same as future months. This is what `currentMonthOnTarget` compares against for fireworks.

### Rules
- **Month closure**: A month is "closed" when the current date is past its last day. On March 18, 2026, January and February are closed. March becomes closed on April 1.
- **Surplus redistributes too**: If ahead of pace, future effective targets decrease. Fireworks get easier to trigger.
- **Admin edits respected**: Redistribution layers on top of base targets. `effective = base + shortfall_share`.
- **No persistence**: Effective target is always derived. Changing a base target or recognizing new revenue immediately updates all future effective targets.

---

## API

### `GET /api/revenue-goals?year=2026`

**Access**: `ADMIN`, `OWNER`, `OPERATIONS_MANAGER`, `PROJECT_MANAGER` (matches executive suite page access). Role check is performed in the route handler via `requireApiAuth()` + explicit role guard, independent of any middleware or hook-level gating.

**Response**:

```typescript
interface RevenueGoalResponse {
  year: number;
  groups: RevenueGroupResult[];
  companyTotal: {
    annualTarget: number;
    ytdActual: number;
    ytdPaceExpected: number;
    paceStatus: "ahead" | "on_pace" | "behind";
  };
  lastUpdated: string;
}

interface RevenueGroupResult {
  groupKey: string;
  displayName: string;
  color: string;
  annualTarget: number;
  ytdActual: number;
  ytdPaceExpected: number;
  paceStatus: "ahead" | "on_pace" | "behind";
  discoveryGated: boolean;        // true if any recognition strategy is gated
  months: MonthResult[];
}

interface MonthResult {
  month: number;                  // 1–12
  baseTarget: number;
  effectiveTarget: number;
  actual: number;
  closed: boolean;                // true if month is in the past
  hit: boolean;                   // actual >= effectiveTarget && closed
  missed: boolean;                // actual < effectiveTarget && closed
  currentMonthOnTarget: boolean;  // actual >= effectiveTarget && !closed && isCurrentMonth (for fireworks)
}
```

### `GET /api/revenue-goals/config?year=2026`

**Access**: `ADMIN` only

Returns base targets for admin editing.

### `PUT /api/revenue-goals/config`

**Access**: `ADMIN` only

Upserts base targets. Audit logged.

### Data Fetching Strategy

- The revenue goals API makes its own HubSpot search queries with explicit property lists — it does not reuse existing `DEAL_PROPERTIES` arrays or shared fetch functions
- Query HubSpot for deals in relevant pipelines with completion dates in the target year
- Single search per pipeline with date range filter on completion fields
- Group and aggregate in application code
- Server-side TTL cache (same pattern as executive endpoints)
- React Query on client with 5-minute stale time
- SSE invalidation when deals update

---

## Pace Definition

Pace is **straight-line by closed months**:

```
expected_pace = (closed_months / 12) * annual_target
```

On March 18, 2026 (2 months closed): expected pace = 2/12 = 16.67% of annual target.

### Pace Status

| Status | Condition | Visual |
|--------|-----------|--------|
| Ahead | `ytdActual > 1.05 * expectedPace` | Green pulse dot |
| On pace | `0.95 * expectedPace <= ytdActual <= 1.05 * expectedPace` | No indicator |
| Behind | `ytdActual < 0.95 * expectedPace` | Amber dot + "behind by $X" |

The 5% band applies symmetrically: within +/-5% of expected pace is "on pace." This prevents noisy status flips from small fluctuations.

No business-day weighting or seasonal adjustment to pace. Seasonality is handled by the configurable base targets, not the pace calculation.

---

## UI Components

### Placement

Top of executive suite landing page (`src/app/suites/executive/page.tsx`), above existing dashboard link cards. First thing users see.

**Layout integration**: `SuitePageShell` currently has no slot for custom content above the card grid. Implementation must add a `heroContent?: ReactNode` prop to `SuitePageShell` that renders between the suite switcher block and the sections card grid. This is a minimal change — one optional prop, one conditional render block. All other suite pages are unaffected (they don't pass it).

**Access**: Does NOT use `useExecutiveData` hook (which restricts to ADMIN/OWNER). Fetches from `/api/revenue-goals` directly with its own access check matching the suite page roles.

### Hero Section — Two Variants

Both variants are built and rendered with a toggle switch to compare. After the team picks a winner, the other is removed.

#### Variant A: Progress Rings

- 2x3 grid of circular SVG gauges
- Each ring shows: YTD percentage (large center text), dollar amount (smaller), group name + annual target below
- Ring fill animates on load (CSS transition)
- Color-coded per group

#### Variant B: Thermometer Bars

- Company-wide hero bar at top: full-width horizontal progress bar with pace marker (vertical line at expected position)
- 6 stacked horizontal bars below, one per group
- Each bar shows: group name (left), dollar progress text (right), colored fill
- Pace marker on hero bar: dashed vertical line labeled "expected pace"

### Monthly Breakdown Chart (Shared)

Below the hero section. Grouped bar chart showing all 12 months:

- One bar per group per month (grouped, not stacked — readability over density)
- Effective target shown as a horizontal line or subtle bar overlay
- **Green glow + checkmark**: months where a group hit its effective target
- **Red tint + "missed" badge**: closed months where actual < effective target
- **Fireworks**: canvas-based confetti burst (2–3 seconds) triggered when a group hits its monthly effective target
  - Triggers on `currentMonthOnTarget === true` (the current, not-yet-closed month where actual >= effectiveTarget)
  - Does NOT use the `hit` boolean (which requires `closed === true`)
  - Fires once per browser session via `sessionStorage` flag keyed by `fireworks:{groupKey}:{year}-{month}`
  - New session = animation replays
  - Only triggers for the current month, not retroactively for past months

### Pace Indicators

Each group in the hero section shows a small status indicator:
- Green pulse dot = ahead of pace
- Nothing = on pace (within 5%)
- Amber dot + "behind by $X" subtitle = behind pace

---

## Admin Config Page

Route: `/dashboards/revenue-goals` (linked from admin suite)
Access: `ADMIN` only

### UI
- Year selector at top (default: current year)
- Editable table: rows = 6 groups, columns = Jan–Dec + Annual Total
- Each cell is an editable dollar input
- "Reset to even" button per group row (annual / 12)
- "Set annual" input per group that auto-fills monthly cells with even split
- Save button persists to `RevenueGoal` table
- Changes audit logged via `REVENUE_GOAL_UPDATED` activity type (new enum value) with user ID and timestamp

### Behavior
- On first load for a new year, auto-seeds even split from default annual targets
- Editing a cell updates only the base target; effective targets recalculate automatically
- Annual total column is read-only (sum of monthly cells)

---

## Technical Notes

### HubSpot Properties Required

Properties that must be fetched (add to pipeline-specific property lists if not already present):

| Property | Pipeline | Status |
|----------|----------|--------|
| `construction_complete_date` | Project (6900017) | Exists in HubSpot; fetched by `fetchAllProjects()` but NOT by `/api/deals` endpoints |
| `detach_completion_date` | D&R (21997330) | Needs to be added to fetch list |
| `reset_completion_date` | D&R (21997330) | Needs to be added to fetch list |
| Service TBD | Service (23928924) | Discovery-gated |
| Roofing TBD | Roofing (765928545) | Discovery-gated |

### Caching

- **Server-side**: TTL cache. Add `REVENUE_GOALS: (year: number) => \`revenue-goals:${year}\`` to the `CACHE_KEYS` constant in `lib/cache.ts`
- **Client-side**: React Query with 5-minute stale time. Add `revenueGoals: (year: number) => ["revenue-goals", year] as const` to `queryKeys` in `lib/query-keys.ts`
- **SSE invalidation**: Uses `appCache.subscribe()` to register a listener that calls `appCache.invalidateByPrefix("revenue-goals")` when the invalidated key starts with `deals:`. This invalidates all cached years (not just current year), since the feature is year-selectable and an admin may be viewing/editing a non-current year. Piggybacks on existing deal invalidation. The 5-minute TTL provides the reliability floor.
- Add `revenue-goals` to `cacheKeyToQueryKeys` mapping in `query-keys.ts`: `if (serverKey.startsWith("revenue-goals")) return [queryKeys.revenueGoals.root];` (before the fallback `return []`)

### HubSpot Search Limits

HubSpot search API caps at 10,000 results per query (100 per page x 100 pages). For a single year of completed deals per pipeline, current volumes are well within this limit. If PB scales significantly, the approach can be partitioned by quarter or location.

### No New External API Calls

All data comes from HubSpot deals already accessible via existing API patterns. The only new data source is the `RevenueGoal` Prisma table for targets.

---

## Out of Scope

- Scheduled revenue integration (existing system, intentionally separate)
- Per-deal revenue drill-down (click a group to see individual deals) — future enhancement
- Multi-year comparison — future enhancement
- PDF/email export of goal progress — future enhancement
- Service and Roofing actuals (discovery-gated, will be enabled via config when fields are confirmed)
