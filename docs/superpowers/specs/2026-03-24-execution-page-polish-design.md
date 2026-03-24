# Execution Page Polish

**Date**: 2026-03-24
**Status**: Draft

## Problem

The three execution dashboard pages (Site Survey, Construction, Inspections) have inconsistent layouts, too many stat cards mixing operational and analytical metrics, and action tables buried below the main project listing. Operators need to see urgent work first, not scroll past analytics they don't use.

### Current issues
- **8 stat cards** on Survey/Construction (2 rows), 4 on Inspections — inconsistent count
- **Plain div cards** instead of `StatCard` components (inconsistent with metrics pages)
- **Analytical metrics** on execution pages: "Completed: 0", "Avg Turnaround", "Active Statuses" — backwards-looking data that belongs on metrics pages
- **No consistent color system** — number colors are arbitrary across pages (teal, cyan, blue, yellow, purple, amber, red)
- **Status breakdown sections** vary: grid of pills (Survey/Construction) vs vertical scrollable list (Inspections) — different layouts for the same concept
- **Action tables below the main listing** — Past Due Surveys, Failed Inspections, CC Pending sit after the full project table; operators must scroll past everything to find urgent work
- **Construction has no action tables** — no equivalent of past-due or failed-inspection tables

## Design

### Page Flow (all three pages)

```
Filter Bar + Search → StatCards (4) → Status Pill Row → Action Tables → Main Project Table
```

The filter bar stays at the top of the page (its current position). StatCards, status pills, and action tables all sit between the filters and the main table.

### 1. StatCards — 4 per page, consistent slot colors

Replace all plain div stat cards with `StatCard` components. Cut from 8 cards to 4 per page using a universal slot model:

| Slot | Purpose | Color | StatCard `color` prop |
|------|---------|-------|-----------------------|
| **Workload** | Total active projects + dollar value | Page accent (teal for survey, orange for construction/inspections) | `teal` or `orange` |
| **Needs Action** | Primary "do something" bucket | Cyan | `cyan` |
| **In Progress** | Work underway | Yellow | `yellow` |
| **At Risk** | Bottleneck/problem indicator | Red | `red` |

**Per-page card definitions:**

| Slot | Site Survey | Construction | Inspections |
|------|------------|--------------|-------------|
| **Workload** | Total Projects / $value | Total Projects / $value | Total Projects / $value |
| **Needs Action** | Needs Scheduling / $value | Ready To Build / $value | Needs Scheduling / $value |
| **In Progress** | Scheduled / $value | In Construction / $value | Scheduled / $value |
| **At Risk** | On Hold + Past Due (sum) / subtitle: "action needed" | Blocked / Rejected / subtitle: "action needed" | Failed / $value |

**Grid class**: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-grid mb-6`

**Cards removed** (per page):
- Survey: Completed, In Site Survey Stage, Avg Survey Turnaround, Active Statuses
- Construction: Completed, Avg Days in Construction, Active Statuses, Scheduled (merged conceptually — RTB is the "needs action" bucket, In Construction is "in progress")
- Inspections: Avg Days Pending / avg turnaround (the "0d avg turnaround" subtitle was also showing the ms-to-days bug), Pending Inspection (replaced by the more specific Needs Scheduling + Scheduled split)

**Subtitle convention**: Workload shows dollar value (`$2.2M`). Needs Action and In Progress show dollar value where available. At Risk shows contextual subtitle ("action needed" for survey/construction, dollar value for inspections Failed).

**Survey "At Risk" card detail**: The value is the **sum** of on-hold count + filtered past-due count: `onHoldCount + filteredPastDue.length`. On-hold = projects where `siteSurveyStatus` contains "hold", "waiting", or "pending" (existing logic). Past-due = `filteredPastDue.length` from the survey classification memo (respects active location/search filters). Single number displayed, not slash-separated.

**Inspections card computations**:
- **Needs Scheduling**: `stage === 'Inspection' && !inspectionScheduleDate && !inspectionPassDate` — projects in the inspection stage with no inspection date set yet
- **Scheduled**: `inspectionScheduleDate && !inspectionPassDate` — has an inspection date, waiting for the result (may include projects in other stages that have an inspection booked)

**Construction "At Risk" card detail**: Count of projects where `constructionStatus?.toLowerCase()` contains "blocked" or "rejected". Does **not** include `stage === 'RTB - Blocked'` — that stage is already captured in the "Ready To Build" Needs Action card. This avoids double-counting.

### 2. Status Pill Row — compact, click-to-filter

Replace the full-section status breakdown (grid on Survey/Construction, vertical list on Inspections) with a single horizontal row of status pills with counts.

```
Status: [Scheduled 14] [In Progress 8] [Crew Assigned 6] [On Hold 5] [Waiting 3]
```

**Implementation:**
- Container: `flex flex-wrap gap-2 items-center` inside a `bg-surface border border-t-border rounded-lg p-3 mb-6`
- Each pill: `px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer` with status-specific background/text colors
- Active state (selected): `ring-1 ring-{accent}-500` (matches existing click-to-filter pattern)
- Clicking a pill toggles the corresponding status filter (same behavior as current breakdown sections)
- Pills sorted by count descending, capped at top 8 statuses (remaining collapsed into "+N more" pill)
- "Status:" label prefix in `text-muted text-xs`

**`StatusPillRow` component props:**
```ts
interface StatusPillRowProps {
  stats: Record<string, number>;         // status name → count
  selected: string[];                     // currently selected statuses
  onToggle: (status: string) => void;     // toggle a status filter
  getStatusColor: (status: string) => string; // returns tailwind color classes for a status
  getDisplayName?: (status: string) => string; // optional display name mapping
  maxVisible?: number;                    // default 8, remaining collapsed into "+N more"
}
```

**What to remove:**
- Survey: The full `grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6` status grid section
- Construction: The full `grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6` status grid section
- Inspections: The `space-y-2 max-h-[300px] overflow-y-auto` vertical status list

### 3. Action Tables — urgent work above the main listing

Move action tables from below the main project table to above it. These are the "do this first" lists.

**Site Survey:**
- **Past Due Surveys** (red left accent) — already exists, currently below table. Move up.
- **Upcoming Surveys** (standard) — already exists, currently below table. Move up.

**Construction (new):**
- **Construction Overdue** (red left accent) — projects where `constructionScheduleDate` is 3+ days ago and no `constructionCompleteDate`. Both dates normalized to local midnight (`new Date(date + "T00:00:00")`) to avoid timezone rollover issues. `constructionScheduleDate` must be non-null (projects without a schedule date are excluded). Computed from `useProjectData` results via a `useMemo` that produces an augmented array with `daysOverdue` field. Columns: Project, Customer, Location, Stage, Amount, Scheduled Date, Days Overdue, Links. Sort: days overdue descending. Imports needed: `useSort`, `sortRows`, `SortHeader`, `DealLinks`, `fmtAmount`, `fmtDateShort` from shared locations.
- **Loose Ends** (orange left accent) — projects where `constructionStatus?.toLowerCase().includes('loose ends')` (matches "Loose Ends Remaining" and any future variations). Computed from `useProjectData` results. Columns: Project, Customer, Location, Stage, Amount, Links. Sort: by deal amount descending.

**Inspections:**
- **Outstanding Failed Inspections** (red left accent) — already exists, currently below Install Photo Review. Move up (before Install Photo Review).
- **CC Pending Inspection** (standard) — already exists, currently below Install Photo Review. Move up (before Install Photo Review).

**Table styling**: All action tables use shared `SortHeader`, `DealLinks`, and `format-helpers` from the reshuffle PR. Consistent styling: `bg-surface border border-t-border rounded-xl overflow-hidden mb-6`, with `max-h-[500px] overflow-y-auto` and sticky headers.

**Filter interaction**: Action tables apply the page's active location and search filters. Stage/status filters do NOT apply — action tables define their own criteria (overdue, failed, loose ends) which may span multiple stages/statuses.

**Empty state**: When no items match, hide the table entirely (don't show an empty container).

### 4. Filter Bar — unchanged (stays at top)

Keep existing `MultiSelectFilter` dropdown pattern at the top of the page (current position). No changes to filter components, search bar, or Refresh button.

**Ordering within the filter bar stays as-is:**
- Survey: Search, Location, Stage, Site Survey Status
- Construction: Search, Location, Stage, Construction Status
- Inspections: Search, AHJ, Location, Inspection Status

### 5. Main Project Table — unchanged

Keep existing table structure, columns, sort behavior, and 100-row cap. No changes.

### 6. Inspections: Install Photo Review — moves below action tables

The collapsible Install Photo Review accordion moves below the action tables (Failed, CC Pending). The action tables are more urgent; photo review is a tool used on a per-project basis.

## Resulting Page Layouts

### Site Survey Execution (after)
1. Filter bar (Search, Location, Stage, Status dropdowns) + Refresh
2. `StatCard` × 4: Total Projects, Needs Scheduling, Scheduled, On Hold + Past Due
3. Status pill row (compact, click-to-filter)
4. Past Due Surveys table (red accent)
5. Upcoming Surveys table
6. Main project table

### Construction Execution (after)
1. Filter bar (Search, Location, Stage, Status dropdowns) + Refresh
2. `StatCard` × 4: Total Projects, Ready To Build, In Construction, Blocked/Rejected
3. Status pill row (compact, click-to-filter)
4. Construction Overdue table (red accent) — **new**
5. Loose Ends table (orange accent) — **new**
6. Main project table

### Inspections Execution (after)
1. Filter bar (Search, AHJ, Location, Status dropdowns) + Refresh
2. `StatCard` × 4: Total Projects, Needs Scheduling, Scheduled, Failed
3. Status pill row (compact, click-to-filter)
4. Outstanding Failed Inspections table (red accent)
5. CC Pending Inspection table
6. Install Photo Review (collapsible accordion)
7. Main project table

## Files Touched

| File | Action |
|------|--------|
| `src/app/dashboards/site-survey/page.tsx` | Replace stat cards with `StatCard`, replace status grid with pill row, reorder action tables above main table |
| `src/app/dashboards/construction/page.tsx` | Replace stat cards with `StatCard`, replace status grid with pill row, add overdue + loose ends tables, add shared imports (`useSort`, `SortHeader`, `DealLinks`, `fmtAmount`, `fmtDateShort`) |
| `src/app/dashboards/inspections/page.tsx` | Replace stat cards with `StatCard` (new Needs Scheduling + Scheduled cards), replace status list with pill row, reorder action tables above Install Photo Review, add `lastUpdated` to DashboardShell |
| `src/components/ui/StatusPillRow.tsx` | New shared component for the compact status pill row (props: `stats`, `selected`, `onToggle`, `getStatusColor`, `getDisplayName?`, `maxVisible?`) |
