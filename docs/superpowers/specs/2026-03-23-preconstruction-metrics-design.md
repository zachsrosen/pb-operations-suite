# Preconstruction Metrics Dashboard — Design Spec

**Date**: 2026-03-23
**Route**: `/dashboards/preconstruction-metrics`
**Suite**: Executive (blue accent)

## Overview

A single dashboard combining Site Survey, Design Approval, and Permitting & Interconnection metrics into a preconstruction performance view. Provides time-windowed KPI counts with 12-month trend charts, grouped by phase.

## Data Source

Uses the existing `/api/projects?context=executive` endpoint via `useProjectData`. No new API endpoints required. All 8 metrics map to existing `RawProject` date fields.

## Metrics & Field Mapping

| Metric | RawProject Field | Phase |
|--------|-----------------|-------|
| Surveys Scheduled | `siteSurveyScheduleDate` | Site Survey |
| Surveys Completed | `siteSurveyCompletionDate` | Site Survey |
| DAs Sent | `designApprovalSentDate` | Design Approval |
| DAs Approved | `designApprovalDate` | Design Approval |
| Permits Submitted | `permitSubmitDate` | Permitting |
| Permits Issued | `permitIssueDate` | Permitting |
| IC Submitted | `interconnectionSubmitDate` | Interconnection |
| IC Approved | `interconnectionApprovalDate` | Interconnection |

Each metric counts projects where the corresponding date falls within the selected time window. Revenue subtotals (`p.amount || 0`) are shown as StatCard subtitles, defaulting missing amounts to zero.

## Layout

### Controls (top)

1. **Time window selector** — pill buttons: 30d, 60d, 90d, 180d, 1y, Custom (with date range inputs). Matches P&I metrics pattern (`TIME_PRESETS`, `isInWindow` callback).
2. **Location multi-select** — `MultiSelectFilter` over `p.pbLocation`.
3. **Lead multi-select** (labeled "Preconstruction Lead") — cross-phase filter combining `siteSurveyor`, `designLead`, `permitLead`, `interconnectionsLead`. A project matches if ANY of its leads match the selected values. This is intentionally a project-level filter, not a per-section filter — selecting a permit lead will still affect survey and DA counts for that person's projects.
4. **Clear All** button when any filter is active.

All filters use blue accent color to match the executive suite.

### Section 1 — Site Survey

- **2 StatCards** in a `grid-cols-2` row:
  - Surveys Scheduled (count + revenue subtitle)
  - Surveys Completed (count + revenue subtitle)
- **MonthlyBarChart** (12 months): two series — scheduled vs completed per month.

### Section 2 — Design Approval

- **2 StatCards** in a `grid-cols-2` row:
  - DAs Sent (count + revenue subtitle)
  - DAs Approved (count + revenue subtitle)
- **MonthlyBarChart** (12 months): two series — sent vs approved per month.

### Section 3 — Permitting & Interconnection

- **4 StatCards** in a `grid-cols-2 md:grid-cols-4` row:
  - Permits Submitted, Permits Issued, IC Submitted, IC Approved (each with count + revenue subtitle)
- **2 MonthlyBarCharts** side by side in a `grid-cols-1 lg:grid-cols-2` row:
  - "Permits (12 months)" — submitted (primary) vs issued (secondary)
  - "Interconnection (12 months)" — submitted (primary) vs approved (secondary)

Note: `MonthlyBarChart` supports exactly two series (`data` + `secondaryData`), so P&I is split into two charts.

### DashboardShell wrapper

```tsx
<DashboardShell
  title="Preconstruction Metrics"
  accentColor="blue"
  lastUpdated={lastUpdated}
  exportData={{ data: exportRows, filename: "preconstruction-metrics.csv" }}
  fullWidth
/>
```

## Filter Persistence

Add a `usePreconstMetricsFilters` hook to `src/stores/dashboard-filters.ts` following the standalone pattern (like `useClippingAnalyticsFilters`):

```ts
export interface PreconstMetricsFilters {
  locations: string[];
  leads: string[];
}

const defaultPreconstMetricsFilters: PreconstMetricsFilters = {
  locations: [],
  leads: [],
};

export function usePreconstMetricsFilters() {
  const raw = useDashboardFilters(
    (s) => s.filters["preconst-metrics"]
  ) as PreconstMetricsFilters | undefined;
  const setFilters = useDashboardFilters((s) => s.setFilters);
  return {
    filters: raw ?? defaultPreconstMetricsFilters,
    setFilters: (f: PreconstMetricsFilters) => setFilters("preconst-metrics", f),
    clearFilters: () => useDashboardFilters.getState().clearFilters("preconst-metrics"),
  };
}
```

The lead filter option list is the union of all unique values across `siteSurveyor`, `designLead`, `permitLead`, and `interconnectionsLead`. Duplicate names (e.g., same person in multiple roles) appear once.

## CSV Export

Export respects active location/lead filters but ignores the time window, matching the existing metrics-page pattern (e.g., pi-metrics exports `filteredProjects`, not time-windowed subsets). Rows include filtered projects that have any preconstruction date set, with columns:
- name, stage, pbLocation, amount
- siteSurveyScheduleDate, siteSurveyCompletionDate, siteSurveyor
- designApprovalSentDate, designApprovalDate, designLead
- permitSubmitDate, permitIssueDate, permitLead
- interconnectionSubmitDate, interconnectionApprovalDate, interconnectionsLead

## Activity Tracking

Call `trackDashboardView("preconstruction-metrics", { projectCount })` on first load, matching existing metrics page pattern.

## Suite Registration

Add entry to the Executive suite page (`src/app/suites/executive/page.tsx`):

```ts
{
  href: "/dashboards/preconstruction-metrics",
  title: "Preconstruction Metrics",
  description: "Survey, design approval, permitting, and interconnection KPIs with 12-month trends.",
  tag: "PRECON",
  icon: "🏗️",
  section: "Executive Views",
}
```

## Files to Create/Modify

| Action | File |
|--------|------|
| **Create** | `src/app/dashboards/preconstruction-metrics/page.tsx` |
| **Modify** | `src/stores/dashboard-filters.ts` — add `PreconstMetricsFilters` + hook |
| **Modify** | `src/app/suites/executive/page.tsx` — add card entry |
| **Modify** | `src/lib/role-permissions.ts` — add route to PM and OPS_MGR allowed routes |
| **Modify** | `src/__tests__/lib/role-permissions.test.ts` — add test for new route access |
| **Modify** | `src/components/ui/MonthlyBarChart.tsx` — fix timezone bug in `aggregateMonthly` |

## Component Dependencies (all existing)

- `DashboardShell` — page frame
- `StatCard` from `MetricCard.tsx` — KPI cards
- `MonthlyBarChart` + `aggregateMonthly` — trend charts (fix timezone bug as part of this work, see below)
- `MultiSelectFilter` — filter dropdowns
- `useProjectData` — data fetching
- `useActivityTracking` — view tracking
- `formatMoney` from `lib/format` — revenue formatting

## Bug Fix: `aggregateMonthly` Timezone Mis-bucketing

`aggregateMonthly` in `MonthlyBarChart.tsx` (line 61) parses date-only strings with `new Date(item.date)`, which treats them as UTC midnight. In US timezones this shifts first-of-month dates into the previous month (e.g., `"2026-03-01"` → Feb 28 EST).

Fix: change line 61 from `new Date(item.date)` to `new Date(item.date + "T12:00:00")`, matching the local-noon approach already used by `isInWindow` in pi-metrics. This is a one-line change that fixes all existing consumers of `aggregateMonthly` across the app.

## Out of Scope

- Turnaround time calculations (existing de-metrics and pi-metrics pages already cover this)
- Drill-down tables (keep this page focused on high-level KPI counts and trends)
- New API endpoints (all data available from existing projects endpoint)
