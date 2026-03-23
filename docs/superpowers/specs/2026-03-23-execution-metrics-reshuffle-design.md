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

**Removal from source**: Delete both tables and their supporting sort state, computed data (`pastDueSurveys`, `upcomingSurveys`, `sortedPastDue`, `sortedUpcoming`), and the `renderAwaitingTable()` helper from survey-metrics. Update the stat card for "Past Due" and "Upcoming Surveys" — these summary cards can stay on metrics since they reference the counts, but the drill-down tables move.

### Move 2: Inspection Metrics → Inspections Execution

**Tables moving:**
- **Outstanding Failed Inspections** — projects where inspection failed and hasn't yet passed. Red left accent (`border-l-4 border-l-red-500`). Columns: Project, Customer, PB Location, AHJ, Stage, Amount, Fail Date, Fail Count, Failure Reason, Days Since Fail, Links. Default sort: `daysSinceLastFail` desc (oldest failures first). Color-coded urgency (red >14d, orange >7d, yellow ≤7d).
- **CC Pending Inspection** — construction-complete projects waiting on inspection. Standard border. Columns: Project, Customer, PB Location, AHJ, Stage, Amount, CC Date, Days Since CC, Insp Scheduled, Booked Date, Ready (boolean checkmark), Links. Default sort: `daysSinceCc` desc (oldest CC first). Color-coded elapsed time (red >30d, orange >14d, yellow >7d, emerald ≤7d).

Both tables use `SortHeader` component, `DealLinks` component, `max-h-[500px]` scrollable with sticky headers, `fmtAmount()` and `fmtDateShort()` formatters, and alternating row backgrounds.

**Source file**: `src/app/dashboards/inspection-metrics/page.tsx`
**Target file**: `src/app/dashboards/inspections/page.tsx`

**Placement on target**: After the main project listing, before AHJ stats section (which itself is being moved out — see Move 3). Order: Outstanding Failed first, CC Pending second.

**Removal from source**: Delete both tables, their `failedRows`/`pendingRows` computed arrays, related sort state (`failedSort`, `pendingSort`), and the `DealLinks` component (if not used elsewhere on the page — check first). Keep the "Outstanding Failures" summary stat card on metrics.

### Move 3: Inspections Execution → Inspection Metrics

**Section moving:**
- **AHJ Breakdown** — simple card list showing top 15 AHJs sorted by pending count. Each row shows AHJ name, avg turnaround days, pending count (yellow), passed count (emerald). Clickable to toggle AHJ filter on the main project list. Container: `bg-surface rounded-xl border border-t-border p-4`, scrollable `max-h-[300px]`.

**Source file**: `src/app/dashboards/inspections/page.tsx`
**Target file**: `src/app/dashboards/inspection-metrics/page.tsx`

**Placement on target**: The metrics page already has a "Performance by AHJ" sortable table with drill-down. The execution page's AHJ widget is a simpler summary view. Two options:

- **Option A (recommended)**: Drop the simple widget entirely. The metrics page's existing AHJ table is strictly more capable (sortable, expandable, shows FPR%, electrician/fire requirements). The simple widget was useful as a quick filter on the execution page, but that filtering use case doesn't apply on the metrics page.
- **Option B**: Place the simple widget above the detailed AHJ table as a quick-glance summary. This adds visual weight without clear value since the table already shows the same data and more.

**Recommendation**: Option A — remove the AHJ breakdown widget from inspections execution and don't add it to metrics. The existing "Performance by AHJ" table on metrics already covers this.

**Removal from source**: Delete the AHJ breakdown card and its `ahjStats` computation from the inspections execution page. Also remove the `filterAhjs` state and any filter logic that references it in the main project listing.

## Data Considerations

### Survey tables
The survey metrics page fetches data via `/api/hubspot/survey-metrics?days={daysWindow}` which returns `pastDueSurveys` and `upcomingSurveys` arrays. The site-survey execution page uses `useProjectData` for its main listing. Two options:

- **Option A**: Add a separate fetch to the survey-metrics API from the site-survey page to get past-due and upcoming data.
- **Option B (recommended)**: Compute past-due and upcoming from the existing `useProjectData` results, matching the same logic (scheduled date passed + not completed = past due; scheduled date future + not completed = upcoming). This avoids an extra API call and keeps the data consistent with the main listing's filters.

### Inspection tables
The inspection metrics page computes `failedRows` and `pendingRows` from its own HubSpot fetch (deals with inspection dates in a time window). The inspections execution page fetches projects in the "Inspection" stage. The failed/pending tables need deals that may be in stages beyond "Inspection" (e.g., a failed inspection on a deal that moved back to construction).

- **Recommended**: Add a secondary fetch or expand the existing query to include deals with `inspectionFailDate` set (for failed) and `constructionCompleteDate` set without `inspectionPassDate` (for CC pending), regardless of current stage. This matches what the metrics page currently does.

### Shared components
The `SortHeader`, `DealLinks`, and formatting helpers (`fmtAmount`, `fmtDateShort`) used by the inspection tables should be extracted to a shared location (e.g., `src/components/ui/SortHeader.tsx`, `src/components/ui/DealLinks.tsx`, `src/lib/format-helpers.ts`) if they don't already exist there, to avoid duplication between the metrics and execution pages.

## Resulting Page Layouts

### Site Survey Execution (after)
1. Stat cards (Total, Needs Scheduling, Scheduled, Completed, etc.)
2. Status breakdown table
3. Main project listing with filters
4. **Past Due Surveys table** (red accent)
5. **Upcoming Surveys table** (standard)

### Inspections Execution (after)
1. Stat cards (Total, Pending, Avg Days, Failed)
2. Main project listing with filters
3. **Outstanding Failed Inspections table** (red left accent)
4. **CC Pending Inspection table** (standard)
5. ~~AHJ breakdown~~ (removed)

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
| `src/app/dashboards/site-survey/page.tsx` | Add past-due and upcoming tables + data logic |
| `src/app/dashboards/survey-metrics/page.tsx` | Remove past-due and upcoming tables + `renderAwaitingTable()` |
| `src/app/dashboards/inspections/page.tsx` | Add failed/pending tables, remove AHJ breakdown + `filterAhjs` state |
| `src/app/dashboards/inspection-metrics/page.tsx` | Remove failed/pending tables + related state |
| `src/components/ui/SortHeader.tsx` | Extract shared component (if not already shared) |
| `src/components/ui/DealLinks.tsx` | Extract shared component (if not already shared) |
| `src/lib/format-helpers.ts` | Extract shared formatters (if not already shared) |
