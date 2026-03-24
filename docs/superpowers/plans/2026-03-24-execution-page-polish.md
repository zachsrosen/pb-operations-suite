# Execution Page Polish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify all three execution dashboard pages (Site Survey, Construction, Inspections) with consistent StatCard hero cards, compact status pill row, action tables above the main listing, and two new construction action tables.

**Architecture:** Each page gets the same structural overhaul: replace 8 plain div stat cards with 4 `StatCard` components using a consistent slot/color model, replace full-section status breakdowns with a shared `StatusPillRow` component, reorder action tables above the main project table, and add construction overdue + loose ends tables. The shared `StatusPillRow` component is built first, then each page is updated independently.

**Tech Stack:** Next.js, React 19, TypeScript, Tailwind v4, `StatCard` from `MetricCard.tsx`, shared `useSort`/`SortHeader`/`DealLinks`/`format-helpers` from the reshuffle PR.

**Spec:** `docs/superpowers/specs/2026-03-24-execution-page-polish-design.md`

---

## Chunk 1: Shared Component + Site Survey

### Task 1: Create StatusPillRow shared component

**Files:**
- Create: `src/components/ui/StatusPillRow.tsx`

- [ ] **Step 1: Create StatusPillRow component**

Create `src/components/ui/StatusPillRow.tsx`:

```tsx
"use client";

import { memo } from "react";

interface StatusPillRowProps {
  stats: Record<string, number>;
  selected: string[];
  onToggle: (status: string) => void;
  getStatusColor: (status: string) => string;
  accentColor: string;
  getDisplayName?: (status: string) => string;
  maxVisible?: number;
}

const RING_CLASSES: Record<string, string> = {
  orange: "ring-orange-500",
  teal: "ring-teal-500",
  green: "ring-green-500",
  blue: "ring-blue-500",
  emerald: "ring-emerald-500",
  cyan: "ring-cyan-500",
};

export const StatusPillRow = memo(function StatusPillRow({
  stats,
  selected,
  onToggle,
  getStatusColor,
  accentColor,
  getDisplayName,
  maxVisible = 8,
}: StatusPillRowProps) {
  const sorted = Object.entries(stats)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  const visible = sorted.slice(0, maxVisible);
  const hiddenCount = sorted.length - visible.length;
  const ringClass = RING_CLASSES[accentColor] || RING_CLASSES.orange;

  return (
    <div className="bg-surface border border-t-border rounded-lg p-3 mb-6">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-muted text-xs mr-1">Status:</span>
        {visible.map(([status, count]) => {
          const isActive = selected.includes(status);
          const colorClass = getStatusColor(status);
          const label = getDisplayName ? getDisplayName(status) : status;
          return (
            <button
              key={status}
              onClick={() => onToggle(status)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors ${colorClass} ${
                isActive ? `ring-1 ${ringClass}` : ""
              }`}
            >
              {label} <span className="font-bold">{count}</span>
            </button>
          );
        })}
        {hiddenCount > 0 && (
          <span className="px-2.5 py-1 rounded-full text-xs text-muted bg-surface-2">
            +{hiddenCount} more
          </span>
        )}
      </div>
    </div>
  );
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep StatusPillRow`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/StatusPillRow.tsx
git commit -m "feat: add StatusPillRow shared component"
```

---

### Task 2: Polish Site Survey Execution page

**Files:**
- Modify: `src/app/dashboards/site-survey/page.tsx`

**Overview:** Replace 8 stat cards with 4 `StatCard`s, replace status grid with `StatusPillRow`, reorder action tables above main project table. The past-due and upcoming tables already exist (added in PR 127) — they just need to move.

- [ ] **Step 1: Add StatCard and StatusPillRow imports**

At `src/app/dashboards/site-survey/page.tsx` line 1–13, add imports for `StatCard` and `StatusPillRow`:

```tsx
import { StatCard } from "@/components/ui/MetricCard";
import { StatusPillRow } from "@/components/ui/StatusPillRow";
```

- [ ] **Step 2: Add atRiskCount to stats memo**

In the `stats` useMemo (around line 187–227), add computation for the At Risk card. After the existing stats computation, add:

```tsx
// At Risk: distinct union of on-hold + past-due projects
const onHoldIds = new Set(
  filteredProjects
    .filter(p => {
      const status = (p.siteSurveyStatus || "").toLowerCase();
      return status.includes("hold") || status.includes("waiting") || status.includes("pending");
    })
    .map(p => p.id)
);
const pastDueIds = new Set(filteredPastDue.map(p => p.id));
const atRiskIds = new Set([...onHoldIds, ...pastDueIds]);
```

Add `atRiskCount: atRiskIds.size` to the returned stats object. Update the useMemo deps to include `filteredPastDue`.

- [ ] **Step 3: Replace stat card grids with StatCard components**

Delete both stat card grids (lines ~388–435) and replace with:

```tsx
{/* Summary Stats */}
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-grid mb-6">
  <StatCard
    label="Total Projects"
    value={stats.total}
    subtitle={formatMoney(stats.totalValue)}
    color="teal"
  />
  <StatCard
    label="Needs Scheduling"
    value={stats.needsScheduling.length}
    subtitle={formatMoney(stats.needsScheduling.reduce((s: number, p: RawProject) => s + (p.amount || 0), 0))}
    color="cyan"
  />
  <StatCard
    label="Scheduled"
    value={stats.scheduled.length}
    subtitle={formatMoney(stats.scheduled.reduce((s: number, p: RawProject) => s + (p.amount || 0), 0))}
    color="yellow"
  />
  <StatCard
    label="On Hold / Past Due"
    value={stats.atRiskCount}
    subtitle="action needed"
    color="red"
  />
</div>
```

- [ ] **Step 4: Replace status breakdown grid with StatusPillRow**

Delete the status breakdown section (lines ~437–466) and replace with:

```tsx
<StatusPillRow
  stats={stats.siteSurveyStatusStats}
  selected={filterSiteSurveyStatuses}
  onToggle={(status) => {
    if (filterSiteSurveyStatuses.includes(status)) {
      setFilterSiteSurveyStatuses(filterSiteSurveyStatuses.filter(s => s !== status));
    } else {
      setFilterSiteSurveyStatuses([...filterSiteSurveyStatuses, status]);
    }
  }}
  getStatusColor={getSiteSurveyStatusColor}
  getDisplayName={getDisplayName}
  accentColor="teal"
/>
```

Note: The `onToggle` callback uses the page's existing filter state setter. If the page uses a filter store (`useSiteSurveyFilters`), use `setFilters({ ...filters, siteSurveyStatuses: ... })` instead.

- [ ] **Step 5: Reorder — move action tables above main project table**

The Past Due Surveys table (lines ~542–591) and Upcoming Surveys table (lines ~593–642) currently sit below the main project table (lines ~468–541). Cut both action table blocks and paste them above the main project table section, so the order becomes:

1. StatusPillRow
2. Past Due Surveys table (if any)
3. Upcoming Surveys table (if any)
4. Main project table

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep site-survey`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboards/site-survey/page.tsx
git commit -m "feat: polish site-survey execution — StatCard, pill row, reorder tables"
```

---

## Chunk 2: Construction Execution

### Task 3: Polish Construction Execution page

**Files:**
- Modify: `src/app/dashboards/construction/page.tsx`

**Overview:** Replace 8 stat cards with 4 `StatCard`s, replace status grid with `StatusPillRow`, add two new action tables (Construction Overdue + Loose Ends). Construction currently has NO action tables and does NOT import the shared sort/table utilities — those need to be added.

- [ ] **Step 1: Add new imports**

At `src/app/dashboards/construction/page.tsx` line 1–10, add:

```tsx
import { StatCard } from "@/components/ui/MetricCard";
import { StatusPillRow } from "@/components/ui/StatusPillRow";
import { useSort, sortRows } from "@/hooks/useSort";
import { SortHeader } from "@/components/ui/SortHeader";
import { DealLinks } from "@/components/ui/DealLinks";
import { fmtAmount, fmtDateShort } from "@/lib/format-helpers";
```

- [ ] **Step 2: Update stats memo — fix blocked/rejected to use constructionStatus only**

In the `stats` useMemo (around line 123–157), ensure the blocked/rejected count uses `constructionStatus` only (not stage). If the existing code also checks `stage === 'RTB - Blocked'`, remove that from the blocked count (it's already in `readyToBuild`). The blocked count should be:

```tsx
const blockedRejected = filteredProjects.filter(p => {
  const status = (p.constructionStatus || "").toLowerCase();
  return status.includes("blocked") || status.includes("rejected");
});
```

Add `blockedRejected` to the returned stats object.

- [ ] **Step 3: Add overdue and loose ends memos**

After the `stats` useMemo, add two new useMemo hooks:

```tsx
// Construction Overdue: scheduled 3+ days ago, not completed
const overdueProjects = useMemo(() => {
  if (!projects) return [];
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  return projects
    .filter((p) => {
      if (!p.constructionScheduleDate || p.constructionCompleteDate) return false;
      const schedDate = new Date(p.constructionScheduleDate + "T00:00:00");
      const daysAgo = Math.floor((todayMidnight.getTime() - schedDate.getTime()) / 86400000);
      return daysAgo >= 3;
    })
    .map((p) => {
      const schedDate = new Date(p.constructionScheduleDate + "T00:00:00");
      const todayMid = new Date();
      todayMid.setHours(0, 0, 0, 0);
      const daysOverdue = Math.floor((todayMid.getTime() - schedDate.getTime()) / 86400000);
      return { ...p, daysOverdue };
    });
}, [projects]);

// Loose Ends: constructionStatus contains "loose ends"
const looseEndsProjects = useMemo(() => {
  if (!projects) return [];
  return projects.filter(
    (p) => (p.constructionStatus || "").toLowerCase().includes("loose ends")
  );
}, [projects]);
```

Note: These use the raw `projects` array (unfiltered by status/stage), then apply location + search filters before rendering (same pattern as the survey action tables).

- [ ] **Step 4: Add filtered memos for action tables**

```tsx
const filteredOverdue = useMemo(() => {
  return overdueProjects.filter((p) => {
    if (filterLocations.length > 0 && !filterLocations.includes(p.pbLocation || "")) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !(p.name || "").toLowerCase().includes(q) &&
        !(p.pbLocation || "").toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });
}, [overdueProjects, filterLocations, searchQuery]);

const filteredLooseEnds = useMemo(() => {
  return looseEndsProjects.filter((p) => {
    if (filterLocations.length > 0 && !filterLocations.includes(p.pbLocation || "")) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !(p.name || "").toLowerCase().includes(q) &&
        !(p.pbLocation || "").toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });
}, [looseEndsProjects, filterLocations, searchQuery]);

const overdueSort = useSort("daysOverdue", "desc");
const looseEndsSort = useSort("amount", "desc");
```

- [ ] **Step 5: Replace stat card grids with StatCard components**

Delete both stat card grids (lines ~317–360) and replace with:

```tsx
{/* Summary Stats */}
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-grid mb-6">
  <StatCard
    label="Total Projects"
    value={stats.total}
    subtitle={formatMoney(stats.totalValue)}
    color="orange"
  />
  <StatCard
    label="Ready To Build"
    value={stats.readyToBuild.length}
    subtitle={formatMoney(stats.readyToBuild.reduce((s: number, p: RawProject) => s + (p.amount || 0), 0))}
    color="cyan"
  />
  <StatCard
    label="In Construction"
    value={stats.inConstruction.length}
    subtitle={formatMoney(stats.inConstruction.reduce((s: number, p: RawProject) => s + (p.amount || 0), 0))}
    color="yellow"
  />
  <StatCard
    label="Blocked / Rejected"
    value={stats.blockedRejected.length}
    subtitle="action needed"
    color="red"
  />
</div>
```

- [ ] **Step 6: Replace status breakdown grid with StatusPillRow**

Delete the status breakdown section (lines ~362–391) and replace with:

```tsx
<StatusPillRow
  stats={stats.constructionStatusStats}
  selected={filterConstructionStatuses}
  onToggle={(status) => {
    if (filterConstructionStatuses.includes(status)) {
      setFilterConstructionStatuses(filterConstructionStatuses.filter(s => s !== status));
    } else {
      setFilterConstructionStatuses([...filterConstructionStatuses, status]);
    }
  }}
  getStatusColor={getConstructionStatusColor}
  getDisplayName={getDisplayName}
  accentColor="orange"
/>
```

- [ ] **Step 7: Add Construction Overdue table**

Insert before the main project table. Only render if `filteredOverdue.length > 0`:

```tsx
{filteredOverdue.length > 0 && (
  <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-6 border-l-4 border-l-red-500">
    <div className="px-5 py-4 border-b border-t-border">
      <h2 className="text-lg font-semibold text-foreground">
        Construction Overdue
        <span className="ml-2 text-sm font-normal text-muted">({filteredOverdue.length})</span>
      </h2>
      <p className="text-sm text-muted mt-0.5">
        Scheduled construction date was 3+ days ago without completion
      </p>
    </div>
    <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-t-border bg-surface-2/80 backdrop-blur-sm">
            <SortHeader label="Project" sortKey="name" currentKey={overdueSort.sortKey} currentDir={overdueSort.sortDir} onSort={overdueSort.toggle} compact />
            <SortHeader label="Customer" sortKey="name" currentKey={overdueSort.sortKey} currentDir={overdueSort.sortDir} onSort={overdueSort.toggle} compact />
            <SortHeader label="Location" sortKey="pbLocation" currentKey={overdueSort.sortKey} currentDir={overdueSort.sortDir} onSort={overdueSort.toggle} compact />
            <SortHeader label="Stage" sortKey="stage" currentKey={overdueSort.sortKey} currentDir={overdueSort.sortDir} onSort={overdueSort.toggle} compact />
            <SortHeader label="Amount" sortKey="amount" currentKey={overdueSort.sortKey} currentDir={overdueSort.sortDir} onSort={overdueSort.toggle} compact />
            <SortHeader label="Scheduled" sortKey="constructionScheduleDate" currentKey={overdueSort.sortKey} currentDir={overdueSort.sortDir} onSort={overdueSort.toggle} compact />
            <SortHeader label="Days Overdue" sortKey="daysOverdue" currentKey={overdueSort.sortKey} currentDir={overdueSort.sortDir} onSort={overdueSort.toggle} compact />
            <th className="px-3 py-2 text-xs font-medium text-muted text-center">Links</th>
          </tr>
        </thead>
        <tbody>
          {sortRows(filteredOverdue, overdueSort.sortKey, overdueSort.sortDir).map((p, i) => (
            <tr key={p.id} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
              <td className="px-3 py-2 font-mono text-foreground">{p.projectNumber || p.name}</td>
              <td className="px-3 py-2 text-foreground truncate max-w-[180px]">{p.name}</td>
              <td className="px-3 py-2 text-muted">{p.pbLocation || "--"}</td>
              <td className="px-3 py-2 text-muted">{p.stage || "--"}</td>
              <td className="px-3 py-2 text-muted">{fmtAmount(p.amount)}</td>
              <td className="px-3 py-2 text-muted">{fmtDateShort(p.constructionScheduleDate)}</td>
              <td className={`px-3 py-2 font-mono font-medium ${p.daysOverdue > 14 ? "text-red-400" : p.daysOverdue > 7 ? "text-orange-400" : "text-yellow-400"}`}>
                {p.daysOverdue}d
              </td>
              <td className="px-3 py-2 text-center">
                <DealLinks dealId={String(p.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)}
```

- [ ] **Step 8: Add Loose Ends table**

Insert after the overdue table, before the main project table. Only render if `filteredLooseEnds.length > 0`:

```tsx
{filteredLooseEnds.length > 0 && (
  <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-6 border-l-4 border-l-orange-500">
    <div className="px-5 py-4 border-b border-t-border">
      <h2 className="text-lg font-semibold text-foreground">
        Loose Ends
        <span className="ml-2 text-sm font-normal text-muted">({filteredLooseEnds.length})</span>
      </h2>
      <p className="text-sm text-muted mt-0.5">
        Projects with construction status indicating loose ends remaining
      </p>
    </div>
    <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-t-border bg-surface-2/80 backdrop-blur-sm">
            <SortHeader label="Project" sortKey="name" currentKey={looseEndsSort.sortKey} currentDir={looseEndsSort.sortDir} onSort={looseEndsSort.toggle} compact />
            <SortHeader label="Customer" sortKey="name" currentKey={looseEndsSort.sortKey} currentDir={looseEndsSort.sortDir} onSort={looseEndsSort.toggle} compact />
            <SortHeader label="Location" sortKey="pbLocation" currentKey={looseEndsSort.sortKey} currentDir={looseEndsSort.sortDir} onSort={looseEndsSort.toggle} compact />
            <SortHeader label="Stage" sortKey="stage" currentKey={looseEndsSort.sortKey} currentDir={looseEndsSort.sortDir} onSort={looseEndsSort.toggle} compact />
            <SortHeader label="Amount" sortKey="amount" currentKey={looseEndsSort.sortKey} currentDir={looseEndsSort.sortDir} onSort={looseEndsSort.toggle} compact />
            <th className="px-3 py-2 text-xs font-medium text-muted text-center">Links</th>
          </tr>
        </thead>
        <tbody>
          {sortRows(filteredLooseEnds, looseEndsSort.sortKey, looseEndsSort.sortDir).map((p, i) => (
            <tr key={p.id} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
              <td className="px-3 py-2 font-mono text-foreground">{p.projectNumber || p.name}</td>
              <td className="px-3 py-2 text-foreground truncate max-w-[180px]">{p.name}</td>
              <td className="px-3 py-2 text-muted">{p.pbLocation || "--"}</td>
              <td className="px-3 py-2 text-muted">{p.stage || "--"}</td>
              <td className="px-3 py-2 text-muted">{fmtAmount(p.amount)}</td>
              <td className="px-3 py-2 text-center">
                <DealLinks dealId={String(p.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)}
```

- [ ] **Step 9: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep construction`
Expected: No errors

- [ ] **Step 10: Commit**

```bash
git add src/app/dashboards/construction/page.tsx
git commit -m "feat: polish construction execution — StatCard, pill row, overdue + loose ends tables"
```

---

## Chunk 3: Inspections Execution

### Task 4: Polish Inspections Execution page

**Files:**
- Modify: `src/app/dashboards/inspections/page.tsx`

**Overview:** Replace 4 stat cards with 4 `StatCard`s (new Needs Scheduling + Scheduled split), replace status list with `StatusPillRow`, reorder action tables above Install Photo Review. The action tables already exist — they just need to move up. Also add `lastUpdated` to DashboardShell.

- [ ] **Step 1: Add StatCard and StatusPillRow imports**

At `src/app/dashboards/inspections/page.tsx` imports section, add:

```tsx
import { StatCard } from "@/components/ui/MetricCard";
import { StatusPillRow } from "@/components/ui/StatusPillRow";
```

- [ ] **Step 2: Add new stat computations**

In the `stats` useMemo (around line 361–424), add two new buckets:

```tsx
const needsScheduling = filteredProjects.filter(
  p => p.stage === "Inspection" && !p.inspectionScheduleDate && !p.inspectionPassDate
);
const inspectionScheduled = filteredProjects.filter(
  p => p.inspectionScheduleDate && !p.inspectionPassDate
);
```

Add both to the returned stats object: `needsScheduling`, `inspectionScheduled`.

- [ ] **Step 3: Replace stat cards with StatCard components**

Delete the existing stat card grid (lines ~575–597) and replace with:

```tsx
{/* Summary Stats */}
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-grid mb-6">
  <StatCard
    label="Total Projects"
    value={stats.total}
    subtitle={formatMoney(stats.totalValue)}
    color="orange"
  />
  <StatCard
    label="Needs Scheduling"
    value={stats.needsScheduling.length}
    subtitle={formatMoney(stats.needsScheduling.reduce((s: number, p: RawProject) => s + (p.amount || 0), 0))}
    color="cyan"
  />
  <StatCard
    label="Scheduled"
    value={stats.inspectionScheduled.length}
    subtitle={formatMoney(stats.inspectionScheduled.reduce((s: number, p: RawProject) => s + (p.amount || 0), 0))}
    color="yellow"
  />
  <StatCard
    label="Failed"
    value={stats.inspectionFailed.length}
    subtitle={formatMoney(stats.inspectionFailed.reduce((s: number, p: RawProject) => s + (p.amount || 0), 0))}
    color="red"
  />
</div>
```

- [ ] **Step 4: Replace status breakdown with StatusPillRow**

Delete the "By Inspection Status" section (lines ~599–634) and replace with:

```tsx
<StatusPillRow
  stats={stats.inspectionStatusStats}
  selected={filterInspectionStatuses}
  onToggle={(status) => {
    if (filterInspectionStatuses.includes(status)) {
      setFilterInspectionStatuses(filterInspectionStatuses.filter(s => s !== status));
    } else {
      setFilterInspectionStatuses([...filterInspectionStatuses, status]);
    }
  }}
  getStatusColor={getInspectionStatusColor}
  getDisplayName={getDisplayName}
  accentColor="orange"
/>
```

- [ ] **Step 5: Reorder — action tables above Install Photo Review**

Currently the page order is: Status Breakdown → Install Photo Review → Failed Table → CC Pending Table → Main Table.

Reorder to: StatusPillRow → Failed Table → CC Pending Table → Install Photo Review → Main Table.

Cut the Outstanding Failed table (lines ~981–1034) and CC Pending table (lines ~1036–1096) and paste them above the Install Photo Review section (line ~636). The Install Photo Review accordion moves below both action tables.

- [ ] **Step 6: Add lastUpdated to DashboardShell**

Find the `<DashboardShell>` opening tag and add `lastUpdated={lastUpdated}` prop. The `lastUpdated` value should already be available from the `useProjectData` hook — verify it's destructured.

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep inspections`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboards/inspections/page.tsx
git commit -m "feat: polish inspections execution — StatCard, pill row, reorder tables"
```

---

## Chunk 4: Verification + Cleanup

### Task 5: Full build verification

- [ ] **Step 1: Run TypeScript check across all modified files**

Run: `npx tsc --noEmit --pretty`
Expected: 0 errors in modified files

- [ ] **Step 2: Run ESLint**

Run: `npm run lint`
Expected: No new errors (pre-existing warnings OK)

- [ ] **Step 3: Run tests**

Run: `npm run test`
Expected: All tests pass

- [ ] **Step 4: Visual verification checklist**

Open each page in the dev server and verify:
- [ ] Site Survey: 4 StatCards (teal/cyan/yellow/red), pill row, past-due + upcoming above main table
- [ ] Construction: 4 StatCards (orange/cyan/yellow/red), pill row, overdue + loose ends above main table
- [ ] Inspections: 4 StatCards (orange/cyan/yellow/red), pill row, failed + CC pending above photo review above main table
- [ ] All StatusPillRows are clickable and filter the main tables
- [ ] Action tables respect location + search filters only (not stage/status)
- [ ] Inspections action tables also respect AHJ filter
- [ ] Empty action tables are hidden entirely

- [ ] **Step 5: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "fix: address verification feedback"
```
