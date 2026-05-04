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
