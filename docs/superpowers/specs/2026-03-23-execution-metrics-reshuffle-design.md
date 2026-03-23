# Execution / Metrics Table Reshuffle

**Date**: 2026-03-23
**Status**: Draft

## Problem

Actionable tables (past due surveys, failed inspections, CC pending) live on analytics/metrics pages where they're buried under performance charts. Meanwhile, the execution pages that operators actually work from lack this operational context. Conversely, AHJ stats on the inspections execution page are analytical and belong with the other AHJ performance data on the metrics page.

## Changes

### Move 1: Survey Metrics → Site Survey Execution

**Tables moving:**
- **Past Due Surveys** — surveys where scheduled date has passed but survey is not complete. Red accent border (`border-red-500/30`). Columns: Project, Customer, Location, Surveyor, Stage, Amount, Scheduled, Days Overdue, Links. Default sort: `daysUntil` asc (most overdue first). Color-coded overdue severity (red >7d, orange >3d, yellow ≤3d).
- **Upcoming Surveys** — surveys scheduled for a future date. Standard border. Same columns but "Days Until" instead of "Days Overdue". Color-coded proximity (emerald ≤1d, yellow ≤3d, muted >3d). Default sort: `daysUntil` asc (soonest first).

Both tables use `renderAwaitingTable()` helper with `isPastDue` flag, `max-h-[500px]` scrollable, sticky headers, alternating row backgrounds, and emerald-colored empty states.

**Source file**: `src/app/dashboards/survey-metrics/page.tsx`
**Target file**: `src/app/dashboards/site-survey/page.tsx`

**Placement on target**: After the main project listing table, before page end. Order: Past Due first, Upcoming second.

**Removal from source**: Delete both tables and their supporting sort state, computed data (`pastDueSurveys`, `upcomingSurveys`, `sortedPastDue`, `sortedUpcoming`), and the `renderAwaitingTable()` helper from survey-metrics. The summary stat cards for "Past Due" and "Upcoming Surveys" counts stay on metrics — only the drill-down tables move.

### Move 2: Inspection Metrics → Inspections Execution

**Tables moving:**
- **Outstanding Failed Inspections** — projects where inspection failed and hasn't yet passed. Red left accent (`border-l-4 border-l-red-500`). Columns: Project, Customer, PB Location, AHJ, Stage, Amount, Fail Date, Fail Count, Failure Reason, Days Since Fail, Links. Default sort: `daysSinceLastFail` desc (oldest failures first). Color-coded urgency (red >14d, orange >7d, yellow ≤7d).
- **CC Pending Inspection** — construction-complete projects waiting on inspection. Standard border. Columns: Project, Customer, PB Location, AHJ, Stage, Amount, CC Date, Days Since CC, Insp Scheduled, Booked Date, Ready (boolean checkmark), Links. Default sort: `daysSinceCc` desc (oldest CC first). Color-coded elapsed time (red >30d, orange >14d, yellow >7d, emerald ≤7d).

Both tables use `SortHeader` component, `DealLinks` component, `max-h-[500px]` scrollable with sticky headers, `fmtAmount()` and `fmtDateShort()` formatters, and alternating row backgrounds.

**Source file**: `src/app/dashboards/inspection-metrics/page.tsx`
**Target file**: `src/app/dashboards/inspections/page.tsx`

**Placement on target**: After the main project listing. Order: Outstanding Failed first, CC Pending second.

**Removal from source**: Delete both tables, their `failedRows`/`pendingRows` computed arrays, related sort state (`failedSort`, `pendingSort`), and the `DealLinks` component (if not used elsewhere on the page — check first). Keep the "Outstanding Failures" summary stat card on metrics.

### Move 3: Remove AHJ Breakdown from Inspections Execution

The AHJ breakdown widget (top-15 card list, click-to-filter) is removed from the inspections execution page. The inspection metrics page already has a full "Performance by AHJ" sortable table with drill-down that is strictly more capable (sortable, expandable, shows FPR%, electrician/fire requirements). No need to duplicate.

**What to remove from `src/app/dashboards/inspections/page.tsx`:**
- The AHJ breakdown card JSX (the `bg-surface rounded-xl` container with top-15 AHJ rows)
- The `ahjStats` computation (`useMemo` that groups `filteredProjects` by AHJ)

**What to keep:**
- The `filterAhjs` state variable — it drives the AHJ `MultiSelectFilter` dropdown in the filter bar, which is useful for operators (filter by jurisdiction). The dropdown, its state, and its references in `hasActiveFilters` / `clearAllFilters` / `filteredProjects` all stay. Only the breakdown card widget goes.

## Data Considerations

### Survey tables

The site-survey execution page uses `useProjectData` for its main listing. Compute past-due and upcoming from these results rather than adding a separate API call:

```
// Normalize both dates to local midnight to avoid mid-day classification errors
const schedDate = new Date(scheduledDate + "T00:00:00");
const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
const daysUntil = Math.floor((schedDate.getTime() - todayMidnight.getTime()) / 86400000);
pastDue  = daysUntil < 0 && !siteSurveyCompletionDate
upcoming = daysUntil >= 0 && !siteSurveyCompletionDate
```

**Important**: The main project listing currently filters out completed surveys. Past-due and upcoming must be computed from the **unfiltered** `projects` array (before the completion filter), not from `filteredProjects`.

**Filter interaction**: After computing the raw past-due and upcoming lists from unfiltered projects, apply the page's active filters (location, search, surveyor) before rendering. This keeps the tables consistent with whatever the operator has selected in the filter bar. Status filter does **not** apply to these tables — they define their own status criteria (past-due vs upcoming).

The `surveyor` / `siteSurveyor` field should be available on `RawProject` — verify the field name matches what the metrics API returns and map if needed.

### Inspection tables

The inspections execution page currently only fetches projects in the "Inspection" stage. The failed/pending tables need deals across all stages (a failed inspection might be on a deal that moved back to construction, CC-pending deals are pre-inspection).

**Approach**: Add a secondary fetch to `/api/hubspot/inspection-metrics` from the inspections execution page to get the `outstandingFailed` and `ccPendingInspection` arrays. These are "current state" lists (not time-window scoped), so no `days` parameter is needed. Replicating the server-side logic client-side from `useProjectData` would be fragile — the API already handles cross-stage filtering correctly.

**Slim payload**: The full metrics response includes location/AHJ performance tables, turnaround stats, and drill-down data that the execution page doesn't need. Add a `scope=pipeline` query parameter (or similar) to the inspection-metrics API that returns only the `outstandingFailed` and `ccPendingInspection` arrays, skipping the expensive aggregation work.

**Refresh**: The inspections page's existing Refresh action must refetch both the main project query and the secondary metrics query. Wire both React Query keys to the refresh handler.

**Filter interaction**: The failed/pending arrays come from the secondary API (cross-stage, unfiltered). After fetching, apply the page's active location and AHJ filters before rendering. Search filter applies too (match on project number or customer name). The page's "Inspection Status" filter does **not** apply to these tables — they span multiple stages by definition and have their own status semantics (failed-not-passed, CC-without-pass).

### Shared components

Extract to shared locations to avoid duplication:

**`SortHeader`** — the two existing implementations have different APIs:
- survey-metrics: `onSort` prop, nullable `currentKey`, larger padding, green hover
- inspection-metrics: `onToggle` prop, non-nullable `currentKey`, smaller padding, neutral hover

Shared version should use:
- `onSort` as the callback prop name
- `currentKey: string | null` (nullable)
- A `compact` boolean to control sizing (compact = inspection-style `px-3 py-2 text-xs`, default = survey-style `px-4 py-3`)
- Neutral hover by default (consistent with dashboard conventions)

**`useSort`** — also diverges (default direction on new key: `"desc"` in survey, `"asc"` in inspection). Shared version should accept an optional `defaultDir` parameter, defaulting to `"asc"`.

**`sortRows`** — inspection-metrics version is strictly more capable (handles booleans). Use that as the shared base.

**`DealLinks`** — currently hardcodes the HubSpot portal ID (`21710069`). Shared version should accept either a full `url` prop or use the portal ID from env/constant. Also use `DealLinks` for the survey tables (replacing inline link JSX from `renderAwaitingTable()`).

**Formatters** (`fmtAmount`, `fmtDateShort`) — extract to `src/lib/format-helpers.ts`.

## Resulting Page Layouts

### Site Survey Execution (after)
1. Stat cards (Total, Needs Scheduling, Scheduled, Completed, etc.)
2. Status breakdown table
3. Main project listing with filters
4. **Past Due Surveys table** (red accent)
5. **Upcoming Surveys table** (standard)

### Inspections Execution (after)
1. Stat cards (Total, Pending, Avg Days, Failed)
2. Main project listing with filters + AHJ filter dropdown (kept)
3. **Outstanding Failed Inspections table** (red left accent)
4. **CC Pending Inspection table** (standard)
5. ~~AHJ breakdown card~~ (removed)

### Survey Metrics (after)
1. Stat cards (Avg Turnaround, Completed, Upcoming count, Past Due count)
2. Turnaround by Office table (with drill-down)
3. Turnaround by Surveyor table (with drill-down)
4. ~~Past Due Surveys table~~ (removed)
5. ~~Upcoming Surveys table~~ (removed)

### Inspection Metrics (after)
1. Stat cards (Avg CC to Pass, Passed, FPR%, Outstanding Failures count)
2. Performance by PB Location table (with drill-down)
3. Performance by AHJ table (with drill-down)
4. ~~Outstanding Failed Inspections table~~ (removed)
5. ~~CC Pending Inspection table~~ (removed)

## Files Touched

| File | Action |
|------|--------|
| `src/app/dashboards/site-survey/page.tsx` | Add past-due and upcoming tables, compute from unfiltered projects |
| `src/app/dashboards/survey-metrics/page.tsx` | Remove past-due and upcoming tables + `renderAwaitingTable()` |
| `src/app/dashboards/inspections/page.tsx` | Add failed/pending tables via metrics API fetch, remove AHJ breakdown card + `ahjStats` memo (keep `filterAhjs` state and AHJ dropdown) |
| `src/app/dashboards/inspection-metrics/page.tsx` | Remove failed/pending tables + related state |
| `src/app/api/hubspot/inspection-metrics/route.ts` | Add `scope=pipeline` fast path returning only `outstandingFailed` + `ccPendingInspection` |
| `src/components/ui/SortHeader.tsx` | New shared component (superset API with `compact` prop) |
| `src/components/ui/DealLinks.tsx` | New shared component (configurable portal ID) |
| `src/lib/format-helpers.ts` | New shared formatters (`fmtAmount`, `fmtDateShort`) |
| `src/hooks/useSort.ts` | New shared hook (with `defaultDir` parameter) |
