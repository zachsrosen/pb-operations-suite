# Scheduler Sub-Job Breakdown View Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in per-system status breakdown view to scheduler cards so ops can see individual PV/ESS/EV sub-job statuses, crews, and dates for multi-system construction deals.

**Architecture:** Extend the `/api/zuper/jobs/lookup` endpoint to return a `subJobs` map alongside the existing `jobs` map (construction category only). Two new components (`SubJobBreakdown`, `ViewModeToggle`) render the breakdown. Both construction-scheduler and master scheduler wire in the toggle and render branch.

**Tech Stack:** Next.js (App Router), React 19, TypeScript, Tailwind v4 (CSS variable tokens), Zuper API

**Spec:** `docs/superpowers/specs/2026-05-03-scheduler-subjob-breakdown-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/scheduler-subjobs.ts` | Create | `SubJobInfo` type, `JobMatchForSubJobs` type, `extractSubJobsFromCandidates()`, `SYSTEM_ORDER`, `SYSTEM_TAGS`, `SYSTEM_TAG_CLASSES`, `zuperStatusToTone()` |
| `src/app/api/zuper/jobs/lookup/route.ts` | Modify | Extract `computeScheduledDays` helper, add `extractSubJobsForCategory` helper, include `subJobs` in response |
| `src/components/scheduler/ViewModeToggle.tsx` | Create | `ViewModeToggle` component + `useViewMode` hook |
| `src/components/scheduler/SubJobBreakdown.tsx` | Create | `SubJobBreakdown` component with `ZuperStatusBadge`, `CrewLabel`, `ScheduleLabel` helpers |
| `src/app/dashboards/construction-scheduler/page.tsx` | Modify | Import/wire toggle + breakdown, store `zuperSubJobs` on `ConstructionProject` |
| `src/app/dashboards/scheduler/page.tsx` | Modify | Import/wire toggle + breakdown, store `zuperSubJobs` on `SchedulerProject` |
| `src/__tests__/api/zuper/jobs/lookup-subjobs.test.ts` | Create | Unit tests for `extractSubJobsForCategory` bucketing logic |

## Chunk 1: Shared types + constants

### Task 1: Create `src/lib/scheduler-subjobs.ts`

**Files:**
- Create: `src/lib/scheduler-subjobs.ts`

- [ ] **Step 1: Create the shared types and constants file**

```ts
// src/lib/scheduler-subjobs.ts
import type { SystemType } from "./zuper-construction";
import { categoryToSystemType } from "./zuper-construction";
import * as Sentry from "@sentry/nextjs";

export type SubJobInfo = {
  systemType: SystemType;
  jobUid: string;
  status: string;
  scheduledDate?: string;
  scheduledEnd?: string;
  scheduledDays?: number;
  assignedTo?: string[];
};

export type JobMatchForSubJobs = {
  jobUid: string;
  status: string;
  statusScore: number;
  addressScore: number;
  categoryName: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  scheduledDays?: number;
  assignedTo?: string[];
};

export const SYSTEM_ORDER: SystemType[] = ["solar", "battery", "ev", "legacy"];

export const SYSTEM_TAGS: Record<SystemType, string> = {
  solar: "PV",
  battery: "ESS",
  ev: "EV",
  legacy: "ALL",
};

export const SYSTEM_TAG_CLASSES: Record<SystemType, string> = {
  solar: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  battery: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  ev: "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30",
  legacy: "bg-zinc-500/15 text-zinc-300 border border-zinc-500/30",
};

/**
 * Map a Zuper job status string to Tailwind classes for consistent badge styling.
 * Matches the tone system from construction-scheduler's getStatusColor (~line 1562).
 */
export function zuperStatusToTone(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("complete")) return "bg-green-500/20 text-green-400 border-green-500/30";
  if (s.includes("scheduled")) return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  if (s.includes("progress") || s.includes("started")) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  if (s.includes("tentative")) return "bg-amber-500/20 text-amber-300 border-amber-500/40";
  if (s.includes("ready")) return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
  if (s.includes("hold")) return "bg-orange-500/20 text-orange-400 border-orange-500/30";
  if (s.includes("unscheduled") || s.includes("new") || s.includes("created") || s.includes("unassigned"))
    return "bg-zinc-500/20 text-zinc-300 border-zinc-500/30";
  return "bg-zinc-500/20 text-muted border-muted/30";
}

export function extractSubJobsFromCandidates(
  dedupedCandidates: JobMatchForSubJobs[],
  projectId: string,
): SubJobInfo[] {
  const bySystem = new Map<string, JobMatchForSubJobs[]>();
  for (const c of dedupedCandidates) {
    const sys = categoryToSystemType(c.categoryName);
    const existing = bySystem.get(sys) ?? [];
    existing.push(c);
    bySystem.set(sys, existing);
  }

  const subJobs: SubJobInfo[] = [];
  for (const [sys, group] of bySystem) {
    group.sort((a, b) => (b.statusScore - a.statusScore) || (b.addressScore - a.addressScore));
    const winner = group[0];

    subJobs.push({
      systemType: sys as SubJobInfo["systemType"],
      jobUid: winner.jobUid,
      status: winner.status || "UNKNOWN",
      scheduledDate: winner.scheduledStart,
      scheduledEnd: winner.scheduledEnd,
      scheduledDays: winner.scheduledDays,
      assignedTo: winner.assignedTo,
    });

    if (group.length > 1) {
      Sentry.addBreadcrumb({
        category: "zuper-lookup",
        message: `Multiple ${sys} jobs matched deal ${projectId}; picked ${winner.jobUid}`,
        level: "warning",
      });
    }
  }

  subJobs.sort((a, b) => SYSTEM_ORDER.indexOf(a.systemType) - SYSTEM_ORDER.indexOf(b.systemType));
  return subJobs;
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit src/lib/scheduler-subjobs.ts 2>&1 | head -20`

Expected: No errors (or only unrelated upstream errors). Check that `SystemType` import resolves from `./zuper-construction`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/scheduler-subjobs.ts
git commit -m "feat(scheduler): add SubJobInfo type and system tag constants"
```

## Chunk 2: Lookup endpoint extension

### Task 2: Extract `computeScheduledDays` helper in lookup route

**Files:**
- Modify: `src/app/api/zuper/jobs/lookup/route.ts:579-609`

The existing scheduled-days calculation lives inline inside the `for (const [projectId, candidates])` loop (lines 579–609). Extract it into a local function so it can be called once per best candidate AND once per sub-job winner.

- [ ] **Step 1: Add the extracted helper function**

Insert this function INSIDE `handleLookup`, right after the `normalizeInclusiveEndDate` helper (after line 224), before the `extractCustomerName` helper (line 227):

```ts
  // Compute scheduled days for a job, handling business-day logic for construction
  const computeScheduledDays = (job: ZuperJob, jobCategoryName: string): {
    scheduledStart: string | undefined;
    scheduledEnd: string | undefined;
    scheduledDays: number | undefined;
    effectivelyUnscheduled: boolean;
  } => {
    const unscheduled = isEffectivelyUnscheduled(job);
    const start = getScheduledStart(job);
    const end = getScheduledEnd(job);
    let days: number | undefined;

    if (!unscheduled && start && end) {
      const startParsed = parseZuperTimestamp(start);
      const endParsed = parseZuperTimestamp(end);
      if (startParsed && endParsed) {
        const diffMs = endParsed.getTime() - startParsed.getTime();
        if (diffMs / (1000 * 60 * 60 * 24) > 0) {
          const startDate = startOfDay(startParsed);
          const inclusiveEndDate = normalizeInclusiveEndDate(startParsed, endParsed);
          const calendarDaysDiff = Math.round(
            (inclusiveEndDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
          );
          days = Math.max(calendarDaysDiff + 1, 1);
          if (jobCategoryName === JOB_CATEGORIES.CONSTRUCTION ||
              jobCategoryName.toLowerCase().includes("construction")) {
            days = countBusinessDaysInclusive(startDate, inclusiveEndDate);
          }
        }
      }
    }

    return {
      scheduledStart: unscheduled ? undefined : start,
      scheduledEnd: unscheduled ? undefined : end,
      scheduledDays: days,
      effectivelyUnscheduled: unscheduled,
    };
  };
```

- [ ] **Step 2: Replace the inline calculation with the helper call**

Replace the block at lines 579–621 (from `const effectivelyUnscheduled` through the `jobsMap[projectId] = {` assignment) with:

```ts
      const assignedUsers = getAssignedUserNames(best.job);
      const schedule = computeScheduledDays(best.job, best.categoryName);

      jobsMap[projectId] = {
        jobUid: best.job.job_uid!,
        jobTitle: best.job.job_title || "",
        status: getJobStatus(best.job) || "UNKNOWN",
        scheduledDate: schedule.scheduledStart,
        scheduledEnd: schedule.scheduledEnd,
        scheduledDays: schedule.scheduledDays,
        category: best.categoryName,
        matchedBy: best.matchMethod,
        ...(assignedUsers.length > 0 && { assignedTo: assignedUsers }),
      };
```

- [ ] **Step 3: Verify the build compiles**

Run: `npx tsc --noEmit 2>&1 | grep "lookup/route" | head -10`

Expected: No new errors in this file.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/zuper/jobs/lookup/route.ts
git commit -m "refactor(lookup): extract computeScheduledDays helper"
```

### Task 3: Add `extractSubJobsForCategory` and `subJobs` response field

**Files:**
- Modify: `src/app/api/zuper/jobs/lookup/route.ts`

- [ ] **Step 1: Add imports for sub-job helpers**

At the top of the file (line 2), add:

```ts
import { extractSubJobsFromCandidates, type SubJobInfo } from "@/lib/scheduler-subjobs";
```

- [ ] **Step 2: Add the `extractSubJobsForCategory` thin wrapper**

Insert this function inside `handleLookup`, after the `computeScheduledDays` helper. This is a thin adapter that maps the route's `JobMatch` objects to `JobMatchForSubJobs` and delegates to the testable pure function:

```ts
  const extractSubJobsForCategory = (
    cat: string | null,
    dedupedCandidates: JobMatch[],
    projectId: string,
  ): SubJobInfo[] => {
    if (!cat || cat.toLowerCase() !== JOB_CATEGORIES.CONSTRUCTION.toLowerCase()) return [];
    return extractSubJobsFromCandidates(
      dedupedCandidates.map(c => {
        const schedule = computeScheduledDays(c.job, c.categoryName);
        return {
          jobUid: c.job.job_uid!,
          status: getJobStatus(c.job) || "UNKNOWN",
          statusScore: c.statusScore,
          addressScore: c.addressScore,
          categoryName: c.categoryName,
          scheduledStart: schedule.scheduledStart,
          scheduledEnd: schedule.scheduledEnd,
          scheduledDays: schedule.scheduledDays,
          assignedTo: getAssignedUserNames(c.job),
        };
      }),
      projectId,
    );
  };
```

- [ ] **Step 3: Build the `subJobsMap` alongside `jobsMap`**

Right after the `jobsMap` declaration (line ~531), add:

```ts
    const subJobsMap: Record<string, SubJobInfo[]> = {};
```

Inside the `for (const [projectId, candidates])` loop, after the `jobsMap[projectId] = { ... }` assignment, add:

```ts
      const subJobs = extractSubJobsForCategory(targetCategory, dedupedCandidates, projectId);
      if (subJobs.length > 0) {
        subJobsMap[projectId] = subJobs;
      }
```

- [ ] **Step 4: Include `subJobsMap` in the response**

Change the `return NextResponse.json(...)` at line ~624 from:

```ts
    return NextResponse.json({
      configured: true,
      jobs: jobsMap,
      count: Object.keys(jobsMap).length,
    });
```

To:

```ts
    return NextResponse.json({
      configured: true,
      jobs: jobsMap,
      count: Object.keys(jobsMap).length,
      ...(Object.keys(subJobsMap).length > 0 && { subJobs: subJobsMap }),
    });
```

The spread conditional means `subJobs` is only present in the response when there are entries — backwards compatible for survey/inspection callers.

- [ ] **Step 5: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep -i "error" | head -10`

Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/zuper/jobs/lookup/route.ts
git commit -m "feat(lookup): add subJobs map to construction lookup response"
```

## Chunk 3: UI components

### Task 4: Create `ViewModeToggle` component

**Files:**
- Create: `src/components/scheduler/ViewModeToggle.tsx`

- [ ] **Step 1: Create the component file**

```tsx
// src/components/scheduler/ViewModeToggle.tsx
"use client";

import { useState, useEffect, useCallback } from "react";

export type ViewMode = "compact" | "breakdown";

export function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-t-border bg-surface" role="tablist">
      <button
        role="tab"
        aria-selected={value === "compact"}
        className={`px-3 py-1.5 text-xs transition-colors ${
          value === "compact"
            ? "bg-surface-2 text-foreground font-medium"
            : "text-muted hover:text-foreground"
        }`}
        onClick={() => onChange("compact")}
      >
        Compact
      </button>
      <button
        role="tab"
        aria-selected={value === "breakdown"}
        className={`px-3 py-1.5 text-xs transition-colors ${
          value === "breakdown"
            ? "bg-surface-2 text-foreground font-medium"
            : "text-muted hover:text-foreground"
        }`}
        onClick={() => onChange("breakdown")}
      >
        Breakdown
      </button>
    </div>
  );
}

export function useViewMode(storageKey: string): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>("compact");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "breakdown" || stored === "compact") setMode(stored);
    } catch {
      // localStorage unavailable (private browsing) — stay in-memory
    }
  }, [storageKey]);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === storageKey && (e.newValue === "compact" || e.newValue === "breakdown")) {
        setMode(e.newValue);
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [storageKey]);

  const set = useCallback(
    (m: ViewMode) => {
      setMode(m);
      try {
        window.localStorage.setItem(storageKey, m);
      } catch {
        // localStorage unavailable — mode persists in-memory only
      }
    },
    [storageKey],
  );

  return [mode, set];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/scheduler/ViewModeToggle.tsx
git commit -m "feat(scheduler): add ViewModeToggle component + useViewMode hook"
```

### Task 5: Create `SubJobBreakdown` component

**Files:**
- Create: `src/components/scheduler/SubJobBreakdown.tsx`

- [ ] **Step 1: Create the component file**

```tsx
// src/components/scheduler/SubJobBreakdown.tsx
"use client";

import type { SubJobInfo } from "@/lib/scheduler-subjobs";
import { SYSTEM_TAGS, SYSTEM_TAG_CLASSES, zuperStatusToTone } from "@/lib/scheduler-subjobs";

export function SubJobBreakdown({
  subJobs,
  className,
}: {
  subJobs: SubJobInfo[];
  className?: string;
}) {
  if (subJobs.length === 0) return null;
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      {subJobs.map((sj) => (
        <SubJobRow key={sj.jobUid} subJob={sj} />
      ))}
    </div>
  );
}

function SubJobRow({ subJob }: { subJob: SubJobInfo }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[0.65rem] font-semibold tracking-wide min-w-[2.5rem] ${
          SYSTEM_TAG_CLASSES[subJob.systemType]
        }`}
      >
        {SYSTEM_TAGS[subJob.systemType]}
      </span>
      <ZuperStatusBadge status={subJob.status} />
      <CrewLabel names={subJob.assignedTo} />
      <ScheduleLabel start={subJob.scheduledDate} end={subJob.scheduledEnd} />
    </div>
  );
}

function ZuperStatusBadge({ status }: { status: string }) {
  const tone = zuperStatusToTone(status);
  const label = status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.6rem] font-semibold tracking-wide min-w-[5rem] justify-center border ${tone}`}
    >
      {label}
    </span>
  );
}

function CrewLabel({ names }: { names?: string[] }) {
  if (!names || names.length === 0) return <span className="text-muted min-w-[5rem]">—</span>;

  const abbreviated = names.slice(0, 2).map((name) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length < 2) return name;
    return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
  });

  const overflow = names.length > 2 ? ` +${names.length - 2}` : "";
  return (
    <span className="text-muted min-w-[5rem] truncate">
      {abbreviated.join(", ")}
      {overflow}
    </span>
  );
}

function ScheduleLabel({ start, end }: { start?: string; end?: string }) {
  if (!start) return <span className="text-muted text-right min-w-[4rem]">—</span>;

  const fmt = (iso: string) => {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso.slice(5, 10);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const startFmt = fmt(start);
  const endFmt = end ? fmt(end) : null;

  const label =
    !endFmt || endFmt === startFmt ? startFmt : `${startFmt}–${endFmt}`;

  return <span className="text-muted text-right min-w-[4rem]">{label}</span>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/scheduler/SubJobBreakdown.tsx
git commit -m "feat(scheduler): add SubJobBreakdown component with PV/ESS/EV tags"
```

## Chunk 4: Wire into construction scheduler

### Task 6: Wire toggle + breakdown into construction scheduler

**Files:**
- Modify: `src/app/dashboards/construction-scheduler/page.tsx`

- [ ] **Step 1: Add imports**

At the top of the file, after the existing imports, add:

```ts
import type { SubJobInfo } from "@/lib/scheduler-subjobs";
import { ViewModeToggle, useViewMode } from "@/components/scheduler/ViewModeToggle";
import { SubJobBreakdown } from "@/components/scheduler/SubJobBreakdown";
```

- [ ] **Step 2: Add `zuperSubJobs` to `ConstructionProject` interface**

In the `ConstructionProject` interface (line ~76), add after `zuperAssignedTo?: string[];` (line 97):

```ts
  zuperSubJobs?: SubJobInfo[];
```

- [ ] **Step 3: Store `subJobs` from lookup response**

Inside the Zuper lookup decoration block (line ~436, inside `if (zuperData.jobs)`), after the `for (const project of transformed)` loop's existing assignments, add after line ~445 (after the `assignedTo` assignment):

```ts
              }
              // Store sub-jobs for breakdown view
              const subJobs = zuperData.subJobs?.[project.id];
              if (subJobs?.length) {
                project.zuperSubJobs = subJobs;
              }
```

Look for the exact location: after the `if (Array.isArray(zuperJob.assignedTo))` block inside the `if (zuperJob)` branch, add the `subJobs` read INSIDE the same `for (const project of transformed)` loop but OUTSIDE the `if (zuperJob)` check — because a project could have subJobs even if the best-candidate job wasn't stored in `zuperJob`.

More precisely: in the loop body at ~line 434–448, after the closing brace of `if (zuperJob) { ... }`, add:

```ts
              // Store sub-jobs from breakdown payload
              const subJobs = zuperData.subJobs?.[project.id];
              if (subJobs?.length) {
                project.zuperSubJobs = subJobs;
              }
```

- [ ] **Step 4: Add `useViewMode` hook call**

Inside the component function, near the other `useState` calls (around line 357–365), add:

```ts
  const [viewMode, setViewMode] = useViewMode("scheduler:viewMode:construction");
```

- [ ] **Step 5: Add `ViewModeToggle` to the toolbar**

In the toolbar JSX, right BEFORE the `{/* Availability Toggle */}` comment (line ~1776), add:

```tsx
            <ViewModeToggle value={viewMode} onChange={setViewMode} />
```

- [ ] **Step 6: Add breakdown render branch on the card list view**

In the LEFT SIDEBAR card (around line 1997–2021), find the block starting with:

```tsx
                      <div className="flex items-center gap-2 mt-2">
```

Wrap the existing status badge content in a conditional:

```tsx
                      {viewMode === "breakdown" && project.zuperSubJobs?.length ? (
                        <div className="mt-2">
                          <SubJobBreakdown subJobs={project.zuperSubJobs} />
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mt-2">
                          {/* existing overdue badge, status badge, size, days, batteries */}
                          {isInstallOverdue(project, manualSchedules[project.id]) && (
                            <span className="text-xs px-1.5 py-0.5 rounded border bg-red-500/20 text-red-400 border-red-500/30 font-medium">
                              ⚠ Overdue
                            </span>
                          )}
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${getStatusColor(project.installStatus)}`}>
                            {project.installStatus}
                          </span>
                          {project.systemSize > 0 && (
                            <span className="text-xs text-muted">
                              {project.systemSize.toFixed(1)}kW
                            </span>
                          )}
                          {project.installDays > 0 && (
                            <span className="text-xs text-blue-400">
                              {project.installDays}d
                            </span>
                          )}
                          {project.batteries > 0 && (
                            <span className="text-xs text-purple-400">
                              {project.batteries} batt
                            </span>
                          )}
                        </div>
                      )}
```

The key is to WRAP the existing `<div className="flex items-center gap-2 mt-2">...</div>` block (lines 1997–2021) in a ternary. When breakdown mode is active AND the project has subJobs, render `<SubJobBreakdown>`; otherwise render the existing inline badge JSX exactly as-is.

- [ ] **Step 7: Add breakdown render branch on the TABLE view**

In the table view (line ~2178–2188), find the status cell:

```tsx
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-xs px-2 py-1 rounded border ${getStatusColor(project.installStatus)}`}>
                                  {project.installStatus}
                                </span>
```

Wrap in a similar conditional:

```tsx
                            <td className="px-4 py-3">
                              {viewMode === "breakdown" && project.zuperSubJobs?.length ? (
                                <SubJobBreakdown subJobs={project.zuperSubJobs} />
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <span className={`text-xs px-2 py-1 rounded border ${getStatusColor(project.installStatus)}`}>
                                    {project.installStatus}
                                  </span>
                                  {overdue && (
                                    <span className="text-xs px-1.5 py-0.5 rounded border bg-red-500/20 text-red-400 border-red-500/30 font-medium">
                                      Overdue
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
```

- [ ] **Step 8: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep "construction-scheduler" | head -10`

Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add src/app/dashboards/construction-scheduler/page.tsx
git commit -m "feat(construction-scheduler): wire sub-job breakdown toggle + rendering"
```

## Chunk 5: Wire into master scheduler

### Task 7: Wire toggle + breakdown into master scheduler

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx`

The master scheduler uses a **calendar/timeline layout**, not a card list. The `zuperJobStatus` is stored on projects but isn't rendered as a visible badge on the calendar. The breakdown should appear in the **detail modal** (which opens when you click a calendar event).

- [ ] **Step 1: Add imports**

At the top of the file, after existing imports, add:

```ts
import type { SubJobInfo } from "@/lib/scheduler-subjobs";
import { ViewModeToggle, useViewMode } from "@/components/scheduler/ViewModeToggle";
import { SubJobBreakdown } from "@/components/scheduler/SubJobBreakdown";
```

- [ ] **Step 2: Add `zuperSubJobs` to `SchedulerProject` interface**

In the `SchedulerProject` interface (line ~68), after `zuperAssignedTo?: string[];` (which is after `zuperScheduledEnd`), add:

```ts
  zuperSubJobs?: SubJobInfo[];
```

- [ ] **Step 3: Store `subJobs` from the construction lookup response**

Inside the Zuper lookup decoration block (lines ~1053–1077). The code loops through three category results (`survey`, `construction`, `inspection`). For CONSTRUCTION specifically, we also read `subJobs`.

After the existing decoration loop (line ~1077, before the `} catch (zuperErr)` block), add a SECOND pass that reads `subJobs` from the construction result. Use `categories.indexOf` instead of a hardcoded index to stay resilient if the order changes:

```ts
        // Read subJobs from construction lookup
        const constructionIdx = categories.indexOf("construction");
        const constructionData = constructionIdx >= 0 ? results[constructionIdx] : null;
        if (constructionData?.subJobs) {
          for (const project of transformed) {
            const subJobs = constructionData.subJobs[project.id];
            if (subJobs?.length) {
              project.zuperSubJobs = subJobs;
            }
          }
        }
```

- [ ] **Step 4: Add `useViewMode` hook**

Inside the component function, near the other useState calls (around line 832–852), add:

```ts
  const [viewMode, setViewMode] = useViewMode("scheduler:viewMode:master");
```

- [ ] **Step 5: Add `ViewModeToggle` to the calendar controls**

In the filter row (around line 4252), find the `<div className="ml-auto flex flex-wrap items-center gap-1">` that contains the Scheduled/Incomplete/Completed checkboxes. Add the toggle BEFORE that div:

```tsx
            <ViewModeToggle value={viewMode} onChange={setViewMode} />
            <div className="ml-auto flex flex-wrap items-center gap-1">
```

- [ ] **Step 6: Add breakdown in the detail modal**

In the detail modal (around line 5900–5917), the "Status" row shows the deal stage. Add the sub-job breakdown AFTER the Status `ModalRow`:

Find the block:
```tsx
                  );
                })()}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[0.7rem] text-muted w-20">Links</span>
```

Insert before the `<div className="flex items-center gap-2 mt-1">` (the Links row):

```tsx
                {viewMode === "breakdown" && detailModal.zuperSubJobs?.length && (
                  <div className="mt-2 ml-[5.5rem]">
                    <SubJobBreakdown subJobs={detailModal.zuperSubJobs} />
                  </div>
                )}
```

The `ml-[5.5rem]` aligns with the modal's label-value layout (the "Status" label is ~5.5rem wide).

- [ ] **Step 7: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep "scheduler/page" | head -10`

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(master-scheduler): wire sub-job breakdown toggle + detail modal"
```

## Chunk 6: Unit tests

### Task 8: Write unit tests for `extractSubJobsForCategory`

**Files:**
- Create: `src/__tests__/api/zuper/jobs/lookup-subjobs.test.ts`

Since `extractSubJobsForCategory` is a local function inside `handleLookup`, we can't import it directly. Instead, test the behavior via the exported `SubJobInfo` type and the `zuperStatusToTone` helper from `scheduler-subjobs.ts`. For the endpoint behavior, we test by exercising `handleLookup` with mock data. However, given the endpoint's complexity (it calls Zuper API, DB cache, etc.), a more practical approach is to test the bucketing logic by extracting it as a pure function.

`extractSubJobsFromCandidates` and `JobMatchForSubJobs` already live in `src/lib/scheduler-subjobs.ts` (created in Task 1). The route delegates to it via the thin `extractSubJobsForCategory` wrapper (added in Task 3). Tests can import and exercise the pure function directly.

- [ ] **Step 1: Write the test file**

```ts
// src/__tests__/api/zuper/jobs/lookup-subjobs.test.ts
import { extractSubJobsFromCandidates, type JobMatchForSubJobs } from "@/lib/scheduler-subjobs";
import { JOB_CATEGORIES } from "@/lib/zuper";

// Mock Sentry so breadcrumbs don't throw
jest.mock("@sentry/nextjs", () => ({
  addBreadcrumb: jest.fn(),
}));

const makeCand = (
  overrides: Partial<JobMatchForSubJobs> & { categoryName: string },
): JobMatchForSubJobs => ({
  jobUid: `uid-${Math.random().toString(36).slice(2, 6)}`,
  status: "SCHEDULED",
  statusScore: 10,
  addressScore: 20,
  scheduledStart: "2026-05-12T08:00:00Z",
  scheduledEnd: "2026-05-13T17:00:00Z",
  scheduledDays: 2,
  assignedTo: ["Joe Diaz"],
  ...overrides,
});

describe("extractSubJobsFromCandidates", () => {
  it("returns 3 sub-jobs for a PV+ESS+EV deal in stable order", () => {
    const result = extractSubJobsFromCandidates(
      [
        makeCand({ categoryName: JOB_CATEGORIES.EV_INSTALL, jobUid: "ev-1" }),
        makeCand({ categoryName: JOB_CATEGORIES.SOLAR_INSTALL, jobUid: "solar-1" }),
        makeCand({ categoryName: JOB_CATEGORIES.BATTERY_INSTALL, jobUid: "batt-1" }),
      ],
      "deal-123",
    );
    expect(result).toHaveLength(3);
    expect(result.map(s => s.systemType)).toEqual(["solar", "battery", "ev"]);
    expect(result.map(s => s.jobUid)).toEqual(["solar-1", "batt-1", "ev-1"]);
  });

  it("returns 1 sub-job for a solar-only deal", () => {
    const result = extractSubJobsFromCandidates(
      [makeCand({ categoryName: JOB_CATEGORIES.SOLAR_INSTALL, jobUid: "solar-only" })],
      "deal-456",
    );
    expect(result).toHaveLength(1);
    expect(result[0].systemType).toBe("solar");
  });

  it("returns 1 legacy sub-job for a pre-split Construction job", () => {
    const result = extractSubJobsFromCandidates(
      [makeCand({ categoryName: JOB_CATEGORIES.CONSTRUCTION, jobUid: "legacy-1" })],
      "deal-789",
    );
    expect(result).toHaveLength(1);
    expect(result[0].systemType).toBe("legacy");
  });

  it("returns empty array for no candidates", () => {
    expect(extractSubJobsFromCandidates([], "deal-000")).toEqual([]);
  });

  it("picks highest statusScore when multiple jobs in same bucket", () => {
    const Sentry = require("@sentry/nextjs");
    const result = extractSubJobsFromCandidates(
      [
        makeCand({ categoryName: JOB_CATEGORIES.SOLAR_INSTALL, jobUid: "solar-low", statusScore: 5, status: "COMPLETED" }),
        makeCand({ categoryName: JOB_CATEGORIES.SOLAR_INSTALL, jobUid: "solar-high", statusScore: 20, status: "STARTED" }),
      ],
      "deal-dup",
    );
    expect(result).toHaveLength(1);
    expect(result[0].jobUid).toBe("solar-high");
    expect(result[0].status).toBe("STARTED");
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: "warning", message: expect.stringContaining("Multiple solar") }),
    );
  });

  it("preserves assigned crew and schedule data", () => {
    const result = extractSubJobsFromCandidates(
      [
        makeCand({
          categoryName: JOB_CATEGORIES.SOLAR_INSTALL,
          assignedTo: ["Joe Diaz", "Mike Chen"],
          scheduledStart: "2026-05-14T08:00:00Z",
          scheduledEnd: "2026-05-15T17:00:00Z",
          scheduledDays: 2,
        }),
      ],
      "deal-crew",
    );
    expect(result[0].assignedTo).toEqual(["Joe Diaz", "Mike Chen"]);
    expect(result[0].scheduledDate).toBe("2026-05-14T08:00:00Z");
    expect(result[0].scheduledDays).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx jest src/__tests__/api/zuper/jobs/lookup-subjobs.test.ts --verbose 2>&1 | tail -30`

Expected: All 6 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/api/zuper/jobs/lookup-subjobs.test.ts
git commit -m "test(lookup): add unit tests for sub-job bucketing logic"
```

## Chunk 7: Final verification

### Task 9: Full build check + type check

- [ ] **Step 1: Run TypeScript compilation**

Run: `npx tsc --noEmit 2>&1 | tail -20`

Expected: No new errors (some pre-existing warnings may appear; check they're unrelated to our changes).

- [ ] **Step 2: Run full test suite**

Run: `npm run test 2>&1 | tail -30`

Expected: All tests pass, including the new `lookup-subjobs.test.ts`.

- [ ] **Step 3: Run linter**

Run: `npm run lint 2>&1 | tail -20`

Expected: No new lint errors in our changed files.

- [ ] **Step 4: Commit any lint fixes if needed**

```bash
git add -u
git commit -m "fix: lint cleanup for sub-job breakdown"
```

### Task 10: Visual verification on dev server

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Navigate to construction scheduler**

Open `http://localhost:3000/dashboards/construction-scheduler` in browser. Verify:
- The Compact/Breakdown toggle appears in the toolbar next to the sort dropdown
- Compact mode looks identical to pre-change (single status badge per card)
- Breakdown mode shows PV/ESS/EV tags with status, crew, and dates per sub-job
- Toggle state persists across page reload (localStorage)

- [ ] **Step 3: Navigate to master scheduler**

Open `http://localhost:3000/dashboards/scheduler` in browser. Verify:
- The toggle appears near the Scheduled/Incomplete/Completed filter checkboxes
- Click a construction-stage calendar event to open the detail modal
- Breakdown mode shows sub-job rows in the modal below the Status row
- Compact mode shows the modal unchanged

- [ ] **Step 4: Final commit if any tweaks needed**

```bash
git add -u
git commit -m "fix: visual polish for sub-job breakdown"
```

---

## Part 2: Multi-Row Schedule Modal

**Goal:** When a deal has 2+ construction sub-jobs, the schedule modal shows per-sub-job controls instead of the single-job modal. Default "Same for all" mode with toggle to "Schedule separately" for independent dates/crew/days/notes per sub-job.

**Spec:** `docs/superpowers/specs/2026-05-03-scheduler-subjob-breakdown-design.md` (Part 2 section)

### Part 2 File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/components/scheduler/SubJobScheduleModal.tsx` | Create | Modal with same/separate modes, confirmation overlay, per-sub-job form rows |
| `src/app/dashboards/construction-scheduler/page.tsx` | Modify | Open SubJobScheduleModal for 2+ sub-job deals, add submit handler |
| `src/app/dashboards/scheduler/page.tsx` | Modify | Same pattern for master scheduler |

## Chunk 8: SubJobScheduleModal component

### Task 11: Create `SubJobScheduleModal` component

**Files:**
- Create: `src/components/scheduler/SubJobScheduleModal.tsx`

- [ ] **Step 1: Create the modal component**

```tsx
// src/components/scheduler/SubJobScheduleModal.tsx
"use client";

import { useState, useCallback } from "react";
import type { SubJobInfo } from "@/lib/scheduler-subjobs";
import { SYSTEM_TAGS, SYSTEM_TAG_CLASSES } from "@/lib/scheduler-subjobs";
import type { SystemType } from "@/lib/zuper-construction";

// ---------- Types ----------

export type PerSubJobSchedule = {
  jobUid: string;
  systemType: SystemType;
  startDate: string;
  endDate: string;
  installDays: number;
  assigneeNames: string[];
  notes: string;
};

type CrewOption = {
  name: string;
  uid?: string;
};

type SubJobScheduleModalProps = {
  subJobs: SubJobInfo[];
  projectName: string;
  availableCrew: CrewOption[];
  defaultDate?: string;
  defaultInstallDays?: number;
  onSubmit: (schedules: PerSubJobSchedule[]) => Promise<void>;
  onClose: () => void;
};

// ---------- Helpers ----------

function formatDateInput(isoOrCustom?: string): string {
  if (!isoOrCustom) return "";
  // Handle both ISO strings and "YYYY-MM-DD" formats
  const d = new Date(isoOrCustom);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function computeEndDate(startDate: string, installDays: number): string {
  if (!startDate || installDays <= 0) return startDate;
  const start = new Date(startDate + "T08:00:00");
  if (!Number.isFinite(start.getTime())) return startDate;
  // Add (installDays - 1) calendar days for the end date
  const end = new Date(start);
  end.setDate(end.getDate() + Math.max(installDays - 1, 0));
  return end.toISOString().slice(0, 10);
}

function initPerJobState(
  subJobs: SubJobInfo[],
  defaultDate?: string,
  defaultInstallDays?: number,
): Map<string, PerSubJobSchedule> {
  const map = new Map<string, PerSubJobSchedule>();
  for (const sj of subJobs) {
    const startDate = formatDateInput(sj.scheduledDate) || defaultDate || "";
    const days = sj.scheduledDays ?? defaultInstallDays ?? 1;
    map.set(sj.jobUid, {
      jobUid: sj.jobUid,
      systemType: sj.systemType,
      startDate,
      endDate: startDate ? computeEndDate(startDate, days) : "",
      installDays: days,
      assigneeNames: sj.assignedTo ?? [],
      notes: "",
    });
  }
  return map;
}

// ---------- Component ----------

export function SubJobScheduleModal({
  subJobs,
  projectName,
  availableCrew,
  defaultDate,
  defaultInstallDays,
  onSubmit,
  onClose,
}: SubJobScheduleModalProps) {
  const [mode, setMode] = useState<"same" | "separate">("same");
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [submitting, setSubmitting] = useState(false);

  // "Same for all" shared state
  const firstSj = subJobs[0];
  const [sharedDate, setSharedDate] = useState(
    formatDateInput(firstSj?.scheduledDate) || defaultDate || ""
  );
  const [sharedDays, setSharedDays] = useState(
    firstSj?.scheduledDays ?? defaultInstallDays ?? 1
  );
  const [sharedCrew, setSharedCrew] = useState<string[]>(
    firstSj?.assignedTo ?? []
  );
  const [sharedNotes, setSharedNotes] = useState("");

  // "Schedule separately" per-job state
  const [perJob, setPerJob] = useState(() =>
    initPerJobState(subJobs, defaultDate, defaultInstallDays)
  );

  const toggleCrew = useCallback((name: string, checked: boolean) => {
    setSharedCrew((prev) =>
      checked ? [...prev, name] : prev.filter((n) => n !== name)
    );
  }, []);

  const togglePerJobCrew = useCallback(
    (jobUid: string, name: string, checked: boolean) => {
      setPerJob((prev) => {
        const next = new Map(prev);
        const entry = { ...next.get(jobUid)! };
        entry.assigneeNames = checked
          ? [...entry.assigneeNames, name]
          : entry.assigneeNames.filter((n) => n !== name);
        next.set(jobUid, entry);
        return next;
      });
    },
    []
  );

  const updatePerJob = useCallback(
    (jobUid: string, updates: Partial<PerSubJobSchedule>) => {
      setPerJob((prev) => {
        const next = new Map(prev);
        const entry = { ...next.get(jobUid)!, ...updates };
        // Auto-compute end date when start or days change
        if (updates.startDate !== undefined || updates.installDays !== undefined) {
          entry.endDate = computeEndDate(entry.startDate, entry.installDays);
        }
        next.set(jobUid, entry);
        return next;
      });
    },
    []
  );

  // When switching from "same" to "separate", seed per-job from shared
  const switchToSeparate = useCallback(() => {
    setPerJob((prev) => {
      const next = new Map(prev);
      for (const sj of subJobs) {
        const existing = next.get(sj.jobUid);
        if (existing) {
          next.set(sj.jobUid, {
            ...existing,
            startDate: sharedDate,
            endDate: computeEndDate(sharedDate, sharedDays),
            installDays: sharedDays,
            assigneeNames: [...sharedCrew],
            notes: sharedNotes,
          });
        }
      }
      return next;
    });
    setMode("separate");
  }, [subJobs, sharedDate, sharedDays, sharedCrew, sharedNotes]);

  // Build final schedule array
  const buildSchedules = (): PerSubJobSchedule[] => {
    if (mode === "same") {
      return subJobs.map((sj) => ({
        jobUid: sj.jobUid,
        systemType: sj.systemType,
        startDate: sharedDate,
        endDate: computeEndDate(sharedDate, sharedDays),
        installDays: sharedDays,
        assigneeNames: [...sharedCrew],
        notes: sharedNotes,
      }));
    }
    return subJobs.map((sj) => perJob.get(sj.jobUid)!);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit(buildSchedules());
    } finally {
      setSubmitting(false);
    }
  };

  const schedules = buildSchedules();
  const canSubmit =
    mode === "same"
      ? !!sharedDate && sharedCrew.length > 0
      : subJobs.every((sj) => {
          const entry = perJob.get(sj.jobUid);
          return entry && !!entry.startDate && entry.assigneeNames.length > 0;
        });

  // ---------- Confirmation view ----------
  if (step === "confirm") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="bg-surface-elevated rounded-xl border border-t-border shadow-card p-6 max-w-lg w-full mx-4">
          <h3 className="text-lg font-semibold text-foreground mb-4">
            Confirm Schedule
          </h3>
          <div className="space-y-2 mb-6">
            {schedules.map((s) => (
              <div key={s.jobUid} className="flex items-start gap-2 text-sm">
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[0.65rem] font-semibold tracking-wide min-w-[2.5rem] justify-center ${
                    SYSTEM_TAG_CLASSES[s.systemType]
                  }`}
                >
                  {SYSTEM_TAGS[s.systemType]}
                </span>
                <span className="text-foreground">
                  {s.startDate}
                  {s.installDays > 1 &&
                    ` – ${s.endDate}`}
                  , {s.assigneeNames.join(" + ")} ({s.installDays}d)
                </span>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setStep("form")}
              className="px-4 py-2 text-sm text-muted hover:text-foreground"
              disabled={submitting}
            >
              Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
            >
              {submitting ? "Scheduling..." : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Form view ----------
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface-elevated rounded-xl border border-t-border shadow-card p-6 max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">
            Schedule Construction — {projectName}
          </h3>
          <button onClick={onClose} className="text-muted hover:text-foreground text-xl">
            ×
          </button>
        </div>

        {/* Mode toggle */}
        <button
          onClick={mode === "same" ? switchToSeparate : () => setMode("same")}
          className="text-xs text-blue-400 hover:text-blue-300 mb-4 block"
        >
          {mode === "same" ? "Schedule separately ▸" : "◂ Same for all"}
        </button>

        {mode === "same" ? (
          /* ===== SAME FOR ALL ===== */
          <div className="space-y-4">
            {/* Date */}
            <div>
              <label className="text-xs text-muted block mb-1">Date</label>
              <input
                type="date"
                value={sharedDate}
                onChange={(e) => setSharedDate(e.target.value)}
                className="w-full bg-surface border border-t-border rounded px-3 py-2 text-sm text-foreground"
              />
            </div>

            {/* Install days */}
            <div>
              <label className="text-xs text-muted block mb-1">Install Days</label>
              <input
                type="number"
                min={1}
                max={14}
                value={sharedDays}
                onChange={(e) => setSharedDays(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24 bg-surface border border-t-border rounded px-3 py-2 text-sm text-foreground"
              />
            </div>

            {/* Crew */}
            <div>
              <label className="text-xs text-muted block mb-1">Crew</label>
              <div className="flex flex-wrap gap-2">
                {availableCrew.map((c) => (
                  <label key={c.name} className="flex items-center gap-1.5 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={sharedCrew.includes(c.name)}
                      onChange={(e) => toggleCrew(c.name, e.target.checked)}
                      className="accent-orange-500"
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="text-xs text-muted block mb-1">Notes</label>
              <textarea
                value={sharedNotes}
                onChange={(e) => setSharedNotes(e.target.value)}
                rows={2}
                className="w-full bg-surface border border-t-border rounded px-3 py-2 text-sm text-foreground resize-none"
                placeholder="Installer notes..."
              />
            </div>

            {/* Sub-job chips */}
            <div className="flex items-center gap-2 pt-2 border-t border-t-border">
              <span className="text-xs text-muted">Scheduling:</span>
              {subJobs.map((sj) => (
                <span
                  key={sj.jobUid}
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[0.65rem] font-semibold tracking-wide ${
                    SYSTEM_TAG_CLASSES[sj.systemType]
                  }`}
                >
                  {SYSTEM_TAGS[sj.systemType]}
                </span>
              ))}
            </div>
          </div>
        ) : (
          /* ===== SCHEDULE SEPARATELY ===== */
          <div className="space-y-4">
            {subJobs.map((sj) => {
              const entry = perJob.get(sj.jobUid)!;
              return (
                <div
                  key={sj.jobUid}
                  className="border border-t-border rounded-lg p-3 space-y-3"
                >
                  {/* Header */}
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[0.65rem] font-semibold tracking-wide ${
                        SYSTEM_TAG_CLASSES[sj.systemType]
                      }`}
                    >
                      {SYSTEM_TAGS[sj.systemType]}
                    </span>
                    <span className="text-sm text-foreground font-medium">
                      {sj.systemType === "solar"
                        ? "Solar"
                        : sj.systemType === "battery"
                        ? "Battery"
                        : sj.systemType === "ev"
                        ? "EV Charger"
                        : "Construction"}
                    </span>
                  </div>

                  {/* Date + Days row */}
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="text-xs text-muted block mb-1">Date</label>
                      <input
                        type="date"
                        value={entry.startDate}
                        onChange={(e) =>
                          updatePerJob(sj.jobUid, { startDate: e.target.value })
                        }
                        className="w-full bg-surface border border-t-border rounded px-3 py-2 text-sm text-foreground"
                      />
                    </div>
                    <div className="w-24">
                      <label className="text-xs text-muted block mb-1">Days</label>
                      <input
                        type="number"
                        min={1}
                        max={14}
                        value={entry.installDays}
                        onChange={(e) =>
                          updatePerJob(sj.jobUid, {
                            installDays: Math.max(1, parseInt(e.target.value) || 1),
                          })
                        }
                        className="w-full bg-surface border border-t-border rounded px-3 py-2 text-sm text-foreground"
                      />
                    </div>
                  </div>

                  {/* Crew */}
                  <div>
                    <label className="text-xs text-muted block mb-1">Crew</label>
                    <div className="flex flex-wrap gap-2">
                      {availableCrew.map((c) => (
                        <label
                          key={c.name}
                          className="flex items-center gap-1.5 text-sm text-foreground"
                        >
                          <input
                            type="checkbox"
                            checked={entry.assigneeNames.includes(c.name)}
                            onChange={(e) =>
                              togglePerJobCrew(sj.jobUid, c.name, e.target.checked)
                            }
                            className="accent-orange-500"
                          />
                          {c.name}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="text-xs text-muted block mb-1">Notes</label>
                    <textarea
                      value={entry.notes}
                      onChange={(e) =>
                        updatePerJob(sj.jobUid, { notes: e.target.value })
                      }
                      rows={2}
                      className="w-full bg-surface border border-t-border rounded px-3 py-2 text-sm text-foreground resize-none"
                      placeholder="Installer notes..."
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-t-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={() => setStep("confirm")}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
          >
            Schedule
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/scheduler/SubJobScheduleModal.tsx
git commit -m "feat(scheduler): add SubJobScheduleModal with same/separate modes"
```

## Chunk 9: Wire modal into construction scheduler

### Task 12: Open SubJobScheduleModal for multi-sub-job deals

**Files:**
- Modify: `src/app/dashboards/construction-scheduler/page.tsx`

- [ ] **Step 1: Add import**

Add to the existing imports:

```ts
import { SubJobScheduleModal, type PerSubJobSchedule } from "@/components/scheduler/SubJobScheduleModal";
```

- [ ] **Step 2: Add modal state**

Near the other modal states (around line 365, near `scheduleModal`), add:

```ts
const [subJobScheduleModal, setSubJobScheduleModal] = useState<{
  subJobs: SubJobInfo[];
  project: ConstructionProject;
  date: string;
} | null>(null);
```

- [ ] **Step 3: Update calendar click handler**

In the function that handles clicking a calendar slot to schedule (the handler that sets `scheduleModal`), add a branch: if the project has 2+ sub-jobs, open the new modal instead.

Find the existing `setScheduleModal(...)` call inside the calendar click handler and wrap it:

```ts
// Check for multi-sub-job scheduling
const subJobs = project.zuperSubJobs;
if (subJobs && subJobs.length >= 2) {
  setSubJobScheduleModal({ subJobs, project, date: clickedDate });
  return;
}
// Existing single-job modal
setScheduleModal(/* existing code */);
```

- [ ] **Step 4: Add submit handler**

Add a handler function near the other schedule handlers:

```ts
const handleSubJobScheduleSubmit = async (schedules: PerSubJobSchedule[]) => {
  const results = await Promise.allSettled(
    schedules.map(async (s) => {
      const startDateTime = `${s.startDate} 08:00:00`;
      const endDateTime = `${s.endDate} 17:00:00`;
      const res = await fetch("/api/zuper/jobs/schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: subJobScheduleModal!.project.id,
          projectName: subJobScheduleModal!.project.name,
          startDateTime,
          endDateTime,
          assigneeNames: s.assigneeNames,
          installDays: s.installDays,
          installerNotes: s.notes || undefined,
          scheduleType: "installation",
          rescheduleOnly: true,
          targetJobUid: s.jobUid,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return { systemType: s.systemType, ok: true };
    })
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected");

  if (failed.length === 0) {
    addToast(`All ${succeeded} sub-jobs scheduled`, "success");
  } else if (succeeded > 0) {
    addToast(`${succeeded} scheduled, ${failed.length} failed`, "warning");
  } else {
    addToast(`All ${failed.length} sub-jobs failed to schedule`, "error");
  }

  setSubJobScheduleModal(null);
  refreshData();
};
```

- [ ] **Step 5: Render the modal**

Add to the JSX, near where the existing schedule modal is rendered:

```tsx
{subJobScheduleModal && (
  <SubJobScheduleModal
    subJobs={subJobScheduleModal.subJobs}
    projectName={subJobScheduleModal.project.name}
    availableCrew={availableConstructionAssignees.map((name) => ({ name }))}
    defaultDate={subJobScheduleModal.date}
    defaultInstallDays={subJobScheduleModal.project.installDays || undefined}
    onSubmit={handleSubJobScheduleSubmit}
    onClose={() => setSubJobScheduleModal(null)}
  />
)}
```

- [ ] **Step 6: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboards/construction-scheduler/page.tsx
git commit -m "feat(construction-scheduler): wire SubJobScheduleModal for multi-sub-job deals"
```

## Chunk 10: Wire modal into master scheduler

### Task 13: Open SubJobScheduleModal for multi-sub-job deals (master scheduler)

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx`

- [ ] **Step 1: Add import**

```ts
import { SubJobScheduleModal, type PerSubJobSchedule } from "@/components/scheduler/SubJobScheduleModal";
```

- [ ] **Step 2: Add modal state**

Near the other modal states (around line 860, near `scheduleModal`), add:

```ts
const [subJobScheduleModal, setSubJobScheduleModal] = useState<{
  subJobs: SubJobInfo[];
  project: SchedulerProject;
} | null>(null);
```

- [ ] **Step 3: Update schedule modal open logic**

In the construction schedule modal open handler (the function that sets `scheduleModal` when a construction event is clicked or a "Schedule" button is pressed), add the same branch:

```ts
const subJobs = project.zuperSubJobs;
if (subJobs && subJobs.length >= 2) {
  setSubJobScheduleModal({ subJobs, project });
  return;
}
// Existing single-job modal
setScheduleModal(/* existing code */);
```

- [ ] **Step 4: Add submit handler**

Same pattern as construction scheduler, adapted for master scheduler's `project` shape:

```ts
const handleSubJobScheduleSubmit = async (schedules: PerSubJobSchedule[]) => {
  const results = await Promise.allSettled(
    schedules.map(async (s) => {
      const startDateTime = `${s.startDate} 08:00:00`;
      const endDateTime = `${s.endDate} 17:00:00`;
      const res = await fetch("/api/zuper/jobs/schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: subJobScheduleModal!.project.id,
          projectName: subJobScheduleModal!.project.name,
          startDateTime,
          endDateTime,
          assigneeNames: s.assigneeNames,
          installDays: s.installDays,
          installerNotes: s.notes || undefined,
          scheduleType: "installation",
          rescheduleOnly: true,
          targetJobUid: s.jobUid,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return { systemType: s.systemType, ok: true };
    })
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected");

  if (failed.length === 0) {
    addToast(`All ${succeeded} sub-jobs scheduled`, "success");
  } else if (succeeded > 0) {
    addToast(`${succeeded} scheduled, ${failed.length} failed`, "warning");
  } else {
    addToast(`All ${failed.length} sub-jobs failed to schedule`, "error");
  }

  setSubJobScheduleModal(null);
  refreshData();
};
```

- [ ] **Step 5: Render the modal**

```tsx
{subJobScheduleModal && (
  <SubJobScheduleModal
    subJobs={subJobScheduleModal.subJobs}
    projectName={subJobScheduleModal.project.name}
    availableCrew={constructionAssigneeNames.map((name) => ({ name }))}
    defaultDate={scheduleDate || undefined}
    defaultInstallDays={undefined}
    onSubmit={handleSubJobScheduleSubmit}
    onClose={() => setSubJobScheduleModal(null)}
  />
)}
```

- [ ] **Step 6: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(master-scheduler): wire SubJobScheduleModal for multi-sub-job deals"
```

## Chunk 11: Support `targetJobUid` in schedule API

### Task 14: Accept `targetJobUid` in the schedule endpoint

**Files:**
- Modify: `src/app/api/zuper/jobs/schedule/route.ts`

The schedule endpoint currently finds the Zuper job by searching for the deal's construction job. When the frontend sends `targetJobUid`, the endpoint should use that specific job instead of searching. This lets the modal schedule a specific sub-job (e.g., the Battery job) without the endpoint picking a different one.

- [ ] **Step 1: Parse `targetJobUid` from the request body**

In the PUT handler, after parsing the existing body fields, add:

```ts
const targetJobUid = body.targetJobUid as string | undefined;
```

- [ ] **Step 2: Use `targetJobUid` to skip job search when provided**

In the job matching logic (where it searches for the existing Zuper job by deal ID), add an early exit:

```ts
// If a specific job UID was provided (multi-sub-job scheduling), use it directly
if (targetJobUid) {
  existingJob = { job_uid: targetJobUid };
  // Skip the normal job-matching logic
}
```

The exact insertion point depends on the route structure. Find where `existingJob` is assigned from the candidate search and add this as a priority check before the search runs.

- [ ] **Step 3: When `targetJobUid` is set, skip sibling cascade**

When the frontend is explicitly scheduling each sub-job, the cascade should not fire (it would duplicate work). Add a guard:

```ts
// Skip sibling cascade when the frontend is scheduling specific sub-jobs
if (isInstallationLookup && !targetJobUid) {
  // existing sibling cascade logic...
}
```

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/zuper/jobs/schedule/route.ts
git commit -m "feat(schedule-api): accept targetJobUid for direct sub-job scheduling"
```

## Chunk 12: Final verification (Part 2)

### Task 15: Full build + test + visual check

- [ ] **Step 1: Run TypeScript compilation**

Run: `npx tsc --noEmit 2>&1 | tail -20`

Expected: 0 errors.

- [ ] **Step 2: Run full test suite**

Run: `npm run test 2>&1 | tail -30`

Expected: All tests pass.

- [ ] **Step 3: Run linter**

Run: `npm run lint 2>&1 | tail -20`

Expected: No new lint errors.

- [ ] **Step 4: Visual verification on dev server**

Start `npm run dev` and verify:

1. **Construction scheduler** (`/dashboards/construction-scheduler`):
   - Click a calendar slot for a deal with 2+ sub-jobs
   - New SubJobScheduleModal appears (not old modal)
   - "Same for all" mode shows single controls + sub-job chips
   - Click "Schedule separately" — per-sub-job rows expand
   - Fill in different dates/crew per sub-job
   - Click Schedule → confirmation overlay shows per-line summary
   - Click Confirm → sub-jobs schedule independently
   - Single sub-job deals still use the old modal

2. **Master scheduler** (`/dashboards/scheduler`):
   - Same test flow as above
   - Editable date input feeds into modal's `defaultDate`

- [ ] **Step 5: Commit any fixes**

```bash
git add -u
git commit -m "fix: visual polish for SubJobScheduleModal"
```
