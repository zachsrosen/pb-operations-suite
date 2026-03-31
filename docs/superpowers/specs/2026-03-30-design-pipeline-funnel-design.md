# Design Pipeline Funnel — Spec

**Date**: 2026-03-30
**Location**: Executive Suite dashboard
**Route**: `/dashboards/design-pipeline-funnel`

## Purpose

Show leadership a four-stage funnel — Sales Closed → Survey Done → DA Sent → DA Approved — to demonstrate that design approval volume is a function of upstream sales volume and survey throughput, not design team speed. Displays both deal count and deal amount at each stage, with cancelled deals shown as greyed-out stacked segments.

## Data Source

### API Endpoint

`GET /api/deals/funnel`

**Query params:**
- `months` — lookback period in months (default: `6`)
- `location` — PB location filter (optional, omit or `"all"` for company-wide)

**Response:**

```typescript
interface FunnelStageData {
  count: number;
  amount: number;
  cancelledCount: number;
  cancelledAmount: number;
}

interface FunnelCohort {
  month: string; // "2026-03"
  salesClosed: FunnelStageData;
  surveyDone: FunnelStageData;
  daSent: FunnelStageData;
  daApproved: FunnelStageData;
}

interface FunnelResponse {
  summary: {
    salesClosed: FunnelStageData;
    surveyDone: FunnelStageData;
    daSent: FunnelStageData;
    daApproved: FunnelStageData;
  };
  cohorts: FunnelCohort[]; // newest-first
  generatedAt: string;
}
```

### Data Logic

1. Call `fetchAllProjects({ activeOnly: false })` — already scoped to project pipeline (`6900017`).
2. Filter to deals whose `closeDate` falls within the lookback window (`months` param).
3. For each deal, determine stage completion by checking date fields on the `Project` object:
   - **Sales Closed**: `closeDate` is non-null (always true for deals in the result set).
   - **Survey Done**: `siteSurveyCompletionDate` is non-null.
   - **DA Sent**: `designApprovalSentDate` is non-null.
   - **DA Approved**: `designApprovalDate` is non-null.
4. Determine cancelled status: check if `dealStage` maps to the "Project Rejected - Needs Review" stage (`20461935`) or similar cancelled/rejected stage. A cancelled deal still counts toward all stages it reached but is tracked separately in `cancelledCount` / `cancelledAmount`.
5. Group deals by `closeDate` month for cohorts. Aggregate `amount` and count at each stage.
6. Build `summary` by summing across all cohorts.
7. Location filter: if `location` param is provided and not `"all"`, filter deals by `pbLocation` before aggregation.

### Caching

Use the existing server-side cache (`lib/cache.ts`) with key `funnel:design-pipeline` and a 5-minute TTL. Invalidate on SSE `projects` cache key updates.

## UI Layout

Wrapped in `<DashboardShell>` with `accentColor="orange"` and `fullWidth={true}`.

### Filters (top bar)

- **Location**: `MultiSelectFilter` with all PB locations, defaults to "All Locations".
- **Timeframe**: Dropdown — 3 months, 6 months (default), 12 months.

### Row 1: StatCards

Four `StatCard` components in a 4-column grid:

| Card | Color | Primary | Secondary | Tertiary |
|------|-------|---------|-----------|----------|
| Sales Closed | orange | count | $ amount | "X cancelled" |
| Survey Done | blue | count | $ amount | "X% of closed" (conversion from prior stage) |
| DA Sent | purple | count | $ amount | "X% of surveyed" |
| DA Approved | green | count | $ amount | "X% of DA sent" |

Conversion percentages are calculated from the active (non-cancelled) counts of the prior stage.

### Row 2: Funnel Bars

Horizontal bar chart, one bar per stage. Each bar has two segments:
- **Colored segment** (stage color): active deals — shows "count · $amount" label inside.
- **Grey segment** (`bg-zinc-600`): cancelled deals — shows count inside.

Bar width proportional to total count (active + cancelled) relative to Sales Closed total.

Between each bar: a conversion arrow with "X% conversion · avg Y days" showing the stage-to-stage conversion rate and median time between the two date milestones.

**Median days calculation**: For deals that have both date fields, compute the difference in days and take the median.

Legend at bottom: Active (colored) / Cancelled (grey).

### Row 3: Monthly Grouped Bar Chart

Uses Recharts `<BarChart>` with grouped bars (one group per month, 4 bars per group colored by stage). X-axis = month labels, Y-axis = deal count.

Each bar represents total count (active + cancelled) for that stage in that cohort. No stacking within bars here — keep it simple for readability.

Hover tooltip shows: stage name, count, $ amount.

Legend at bottom matching the four stage colors.

### Row 4: Cohort Table

HTML table with one row per month (newest first). Columns:

| Month | Sales Closed | Survey Done | DA Sent | DA Approved |
|-------|-------------|-------------|---------|-------------|

Each cell shows:
- **Count** (bold, stage color)
- **$ amount** (muted)
- **Cancelled count** (grey, only if > 0)
- **Conversion %** from Sales Closed (stage color, small text) — except the Sales Closed column

Alternating row backgrounds for readability.

## Component Structure

```
src/app/dashboards/design-pipeline-funnel/
└── page.tsx          # Full dashboard page
```

No new lib files — the API route handles all aggregation logic. The page component handles rendering with existing UI primitives (`DashboardShell`, `StatCard`, `MultiSelectFilter`).

```
src/app/api/deals/funnel/
└── route.ts          # GET handler
```

## Suite Navigation

Add link to the Executive suite page (`src/app/suites/executive/page.tsx`). Also add to the Design & Engineering suite as a cross-link.

## Dependencies

- `recharts` — already in the project for existing bar charts.
- All other dependencies (React Query, DashboardShell, StatCard, MultiSelectFilter) already exist.

## What This Does NOT Include

- Drill-down into individual deals from the cohort table (future enhancement).
- Export to PDF/CSV (DashboardShell's built-in CSV export will work with the cohort data).
- Per-person attribution (this is about pipeline throughput, not individual performance).
