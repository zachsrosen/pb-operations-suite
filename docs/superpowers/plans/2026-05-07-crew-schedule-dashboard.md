# Crew Schedule Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only dashboard showing where each crew member is working on every day, with grid table and calendar cards views, location/job-type grouping, and week/month date ranges.

**Architecture:** Single API endpoint (`GET /api/crew-schedule`) merges ScheduleRecord + BookedSlot data with HubSpotProjectCache for deal values. One client page (`/dashboards/crew-schedule`) renders two togglable view modes. No new Prisma models.

**Tech Stack:** Next.js 16 API route, Prisma queries, React Query v5, Tailwind v4 CSS, DashboardShell wrapper.

**Spec:** `docs/superpowers/specs/2026-05-07-crew-schedule-dashboard-design.md`

---

## Chunk 1: API Endpoint + Query Keys

### Task 1: Add query key root for crew schedule

**Files:**
- Modify: `src/lib/query-keys.ts`

- [ ] **Step 1: Add `crewSchedule` key to `queryKeys` object**

In `src/lib/query-keys.ts`, add after the `onCall` block (around line 95):

```ts
crewSchedule: {
  root: ["crewSchedule"] as const,
  list: (startDate: string, endDate: string) =>
    ["crewSchedule", "list", startDate, endDate] as const,
},
```

- [ ] **Step 2: Add SSE mapping in `cacheKeyToQueryKeys`**

In the `cacheKeyToQueryKeys` function, add before the final `return []`:

```ts
if (serverKey.startsWith("crew-schedule")) return [queryKeys.crewSchedule.root];
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/query-keys.ts
git commit -m "feat(crew-schedule): add query key root and SSE mapping"
```

### Task 2: Build the API endpoint

**Files:**
- Create: `src/app/api/crew-schedule/route.ts`

- [ ] **Step 1: Create the API route file**

Create `src/app/api/crew-schedule/route.ts` with the following structure:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { getBusinessDatesInSpan } from "@/lib/scheduling-utils";

const SCHEDULE_TYPE_MAP: Record<string, string> = {
  survey: "/dashboards/site-survey-scheduler",
  construction: "/dashboards/construction-scheduler",
  installation: "/dashboards/construction-scheduler",
  inspection: "/dashboards/inspection-scheduler",
  service: "/dashboards/service-scheduler",
  dnr: "/dashboards/dnr-scheduler",
  roofing: "/dashboards/roofing-scheduler",
};

const ROLE_TO_JOB_TYPE: Record<string, string> = {
  surveyor: "survey",
  technician: "construction",
  inspector: "inspection",
  electrician: "construction",
  roofer: "roofing",
};

interface CrewAssignment {
  id: string;
  source: "schedule" | "slot";
  crewMemberName: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  jobType: string;
  pbLocation: string | null;
  projectId: string;
  projectName: string;
  dealValue: number | null;
  status: string;
  schedulerPath: string;
}

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  // authResult is the authenticated user — not needed for this read-only endpoint
  void authResult;

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "startDate and endDate are required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  // Cap date range at 31 days
  const start = new Date(startDate);
  const end = new Date(endDate);
  const dayDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (dayDiff > 31 || dayDiff < 0) {
    return NextResponse.json(
      { error: "Date range must be 0-31 days" },
      { status: 400 }
    );
  }

  if (!prisma) {
    return NextResponse.json({ crew: [], assignments: [], dateRange: { start: startDate, end: endDate } });
  }

  // 1. Fetch active crew members
  const crewMembers = await prisma.crewMember.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      role: true,
      locations: true,
      teamName: true,
    },
    orderBy: { name: "asc" },
  });

  // 2. Query ScheduleRecords in range, excluding cancelled/rescheduled and unassigned
  const scheduleRecords = await prisma.scheduleRecord.findMany({
    where: {
      scheduledDate: { gte: startDate, lte: endDate },
      status: { notIn: ["cancelled", "rescheduled"] },
      assignedUser: { not: null },
    },
    select: {
      id: true,
      assignedUser: true,
      scheduledDate: true,
      scheduledDays: true,
      scheduledStart: true,
      scheduledEnd: true,
      scheduleType: true,
      projectId: true,
      projectName: true,
      status: true,
    },
  });

  // 3. Query BookedSlots in range
  const bookedSlots = await prisma.bookedSlot.findMany({
    where: {
      date: { gte: startDate, lte: endDate },
    },
    select: {
      id: true,
      userName: true,
      date: true,
      startTime: true,
      endTime: true,
      location: true,
      projectId: true,
      projectName: true,
    },
  });

  // 4. Collect unique project IDs and batch-resolve from HubSpotProjectCache
  const allProjectIds = new Set<string>();
  for (const r of scheduleRecords) allProjectIds.add(r.projectId);
  for (const s of bookedSlots) allProjectIds.add(s.projectId);

  const projectCache = new Map<string, { amount: number | null; pbLocation: string | null }>();
  if (allProjectIds.size > 0) {
    const cached = await prisma.hubSpotProjectCache.findMany({
      where: { dealId: { in: [...allProjectIds] } },
      select: { dealId: true, amount: true, pbLocation: true },
    });
    for (const c of cached) {
      projectCache.set(c.dealId, { amount: c.amount, pbLocation: c.pbLocation });
    }
  }

  // Build crew name → role map for job type fallback
  const crewRoleMap = new Map<string, string>();
  const crewLocationMap = new Map<string, string | null>();
  for (const cm of crewMembers) {
    crewRoleMap.set(cm.name, cm.role);
    crewLocationMap.set(cm.name, cm.locations[0] ?? null);
  }

  // Build a set of ScheduleRecord-sourced project IDs → scheduleType for BookedSlot fallback
  const projectTypeMap = new Map<string, string>();
  for (const r of scheduleRecords) {
    if (r.scheduleType) projectTypeMap.set(r.projectId, r.scheduleType);
  }

  // 5. Merge and deduplicate
  const dedupeSet = new Set<string>();
  const assignments: CrewAssignment[] = [];

  function resolveJobType(scheduleType: string | null, projectId: string, crewName: string): string {
    if (scheduleType) return scheduleType;
    const fromProject = projectTypeMap.get(projectId);
    if (fromProject) return fromProject;
    const role = crewRoleMap.get(crewName);
    if (role && ROLE_TO_JOB_TYPE[role]) return ROLE_TO_JOB_TYPE[role];
    return "unknown";
  }

  function resolveLocation(slotLocation: string | null, projectId: string, crewName: string): string | null {
    if (slotLocation) return slotLocation;
    const cached = projectCache.get(projectId);
    if (cached?.pbLocation) return cached.pbLocation;
    return crewLocationMap.get(crewName) ?? null;
  }

  function resolveSchedulerPath(jobType: string): string {
    return SCHEDULE_TYPE_MAP[jobType] ?? "/dashboards/scheduler";
  }

  // Process ScheduleRecords first (preferred source)
  for (const r of scheduleRecords) {
    const crewName = r.assignedUser!;
    const jobType = resolveJobType(r.scheduleType, r.projectId, crewName);
    const location = resolveLocation(null, r.projectId, crewName);
    const cached = projectCache.get(r.projectId);

    // Expand multi-day jobs (scheduledDays > 1) into individual business days.
    // Fractional days (e.g. 0.25 for a 2-hour survey) do NOT expand.
    // getBusinessDatesInSpan(startDate: string, totalDays: number): string[]
    const days = r.scheduledDays ?? 1;
    let dates: string[];

    if (days > 1) {
      const businessDates = getBusinessDatesInSpan(r.scheduledDate, Math.ceil(days));
      dates = businessDates.filter(d => d >= startDate && d <= endDate);
    } else {
      dates = [r.scheduledDate];
    }

    for (const date of dates) {
      const key = `${crewName}|${date}|${r.projectId}`;
      dedupeSet.add(key);

      assignments.push({
        id: r.id,
        source: "schedule",
        crewMemberName: crewName,
        date,
        startTime: r.scheduledStart,
        endTime: r.scheduledEnd,
        jobType,
        pbLocation: location,
        projectId: r.projectId,
        projectName: r.projectName,
        dealValue: cached?.amount ?? null,
        status: r.status,
        schedulerPath: resolveSchedulerPath(jobType),
      });
    }
  }

  // Process BookedSlots (fill gaps)
  for (const s of bookedSlots) {
    const key = `${s.userName}|${s.date}|${s.projectId}`;
    if (dedupeSet.has(key)) continue;
    dedupeSet.add(key);

    const jobType = resolveJobType(null, s.projectId, s.userName);
    const location = resolveLocation(s.location, s.projectId, s.userName);
    const cached = projectCache.get(s.projectId);

    assignments.push({
      id: s.id,
      source: "slot",
      crewMemberName: s.userName,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      jobType,
      pbLocation: location,
      projectId: s.projectId,
      projectName: s.projectName,
      dealValue: cached?.amount ?? null,
      status: "scheduled",
      schedulerPath: resolveSchedulerPath(jobType),
    });
  }

  return NextResponse.json({
    crew: crewMembers,
    assignments,
    dateRange: { start: startDate, end: endDate },
  });
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to crew-schedule route.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/crew-schedule/route.ts
git commit -m "feat(crew-schedule): add API endpoint merging ScheduleRecord + BookedSlot"
```

### Task 3: Add route access for all scheduler-capable roles

**Files:**
- Modify: `src/lib/roles.ts`

- [ ] **Step 1: Add `/dashboards/crew-schedule` and `/api/crew-schedule` to role allowedRoutes**

Add both routes to the `allowedRoutes` arrays for these roles (ADMIN and EXECUTIVE already have `*` wildcard):

1. **OPERATIONS_MANAGER** (line ~135): add after `/dashboards/scheduler`
2. **PROJECT_MANAGER** (line ~287): add after `/dashboards/scheduler`
3. **OPERATIONS** (line ~464): add after `/dashboards/scheduler`
4. **TECH_OPS** (line ~675): add after `/dashboards/scheduler`
5. **ROOFING** (line ~1103): add after `/dashboards/scheduler`
6. **SALES_MANAGER** (line ~1237): add after `/dashboards/scheduler`
7. **SERVICE** (line ~580): add after `/dashboards/service-scheduler`

For each role, add these two lines in the `allowedRoutes` array:
```ts
"/dashboards/crew-schedule",
"/api/crew-schedule",
```

- [ ] **Step 2: Verify the build compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/lib/roles.ts
git commit -m "feat(crew-schedule): grant route access to all scheduler-capable roles"
```

---

## Chunk 2: Dashboard Page — Grid Table View

### Task 4: Create the crew schedule dashboard page with grid table view

**Files:**
- Create: `src/app/dashboards/crew-schedule/page.tsx`

- [ ] **Step 1: Create the page with header controls, data fetching, and grid table**

Create `src/app/dashboards/crew-schedule/page.tsx`:

```tsx
"use client";

import React, { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { MultiSelectFilter, type FilterOption } from "@/components/ui/MultiSelectFilter";
import { queryKeys } from "@/lib/query-keys";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import Link from "next/link";
```

Wrap in `<DashboardShell title="Crew Schedule" accentColor="blue" fullWidth>`.

The page must implement:

**Loading state:** Skeleton grid matching the view mode (use `Skeleton` from `@/components/ui/Skeleton`).
**Empty states:**
- No crew: "No active crew members found"
- No assignments in range: Show crew roster with all cells showing "—" or "Available" cards

**State:**
- `period`: `"week" | "2weeks" | "month"` — default `"week"`
- `viewMode`: `"grid" | "cards"` — persisted in localStorage key `"crew-schedule-view"`
- `groupBy`: `"location" | "jobType"` — persisted in localStorage key `"crew-schedule-group"`
- `baseDate`: Date — initialized to current Monday
- `selectedDay`: `string | null` — for day drill-down (YYYY-MM-DD or null)
- `locationFilter`: `string[]` — selected locations (default: all)

**Date range computation:**
- `startDate` / `endDate` derived from `baseDate` + `period`
- Week: Monday–Friday of `baseDate` week
- 2 Weeks: Monday–Friday spanning 2 weeks
- Month: 1st–last of `baseDate`'s month
- When `selectedDay` is set, override range to just that day
- Navigation arrows shift `baseDate` by one period. "Today" resets to current week's Monday.

**Data fetching:**
```tsx
const { data, isLoading } = useQuery({
  queryKey: queryKeys.crewSchedule.list(startDate, endDate),
  queryFn: async () => {
    const res = await fetch(`/api/crew-schedule?startDate=${startDate}&endDate=${endDate}`);
    if (!res.ok) throw new Error("Failed to fetch crew schedule");
    return res.json();
  },
  refetchInterval: 2 * 60 * 1000,
});
```

**Grid table rendering:**
- Columns: one per business day in the range (use `getBusinessDatesInSpan` or simple iteration skipping weekends)
- Rows: crew members grouped by location (default) or job type
- Section headers: bold row spanning all columns with location/job-type name
- Today's column: `bg-blue-50 dark:bg-blue-950/20` background
- Sticky first column (crew name) with `sticky left-0 z-10`

**Cell content (abbreviated):**
- Project name truncated to 20 chars
- Job type as a colored badge: survey=blue, construction=orange, inspection=green, service=purple, dnr=rose, roofing=rose
- Deal value formatted as `$45k` (divide by 1000, round)
- Time window if present: `8a–12p`
- Empty cells: `"—"` in `text-muted`

**Cell interactions:**
- Hover: title attribute with full project name + deal value + time window
- Click: `<Link href={assignment.schedulerPath}>` wrapping the cell content

**Day drill-down:**
- Click column header date → sets `selectedDay` to that date
- Shows expanded detail for that day (full project name, full time, full deal value, location)
- "Back to [period]" button clears `selectedDay`

**Header bar:**
- Left: `<` prev / "Today" / `>` next buttons
- Center: period selector pills (Week · 2 Weeks · Month)
- Right: view toggle (Grid | Cards icons), group toggle (Location | Job Type), location `MultiSelectFilter`

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/crew-schedule/page.tsx
git commit -m "feat(crew-schedule): add dashboard page with grid table view"
```

---

## Chunk 3: Calendar Cards View

### Task 5: Add calendar cards view mode

**Files:**
- Modify: `src/app/dashboards/crew-schedule/page.tsx`

- [ ] **Step 1: Add the calendar cards rendering branch**

Inside the page component, when `viewMode === "cards"`, render an alternative layout:

**Structure:**
- Columns per day (same date range as grid)
- Each column contains cards grouped by location or job type
- Each card shows:
  - Crew member name (bold)
  - Project name
  - Job type badge + deal value
  - Time window
  - PB location
  - `<Link>` to scheduler → "View" arrow link

**Card styling:**
- `bg-surface` with `border-l-4` colored by job type (same color map as grid badges)
- `rounded-lg shadow-card p-3`
- Crew name in `text-foreground font-medium`
- Details in `text-muted text-sm`

**Unassigned crew:**
- Crew members with no assignments for a day render as a muted card: `bg-surface-2 opacity-60` with text "Available"
- Placed at the bottom of their location group

**Day drill-down in cards mode:**
- Same trigger (click day header)
- Cards expand to show full detail (no truncation)

- [ ] **Step 2: Verify both view modes render correctly (build check)**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/crew-schedule/page.tsx
git commit -m "feat(crew-schedule): add calendar cards view mode"
```

---

## Chunk 4: Suite Nav + Final Wiring

### Task 6: Add crew schedule card to suite pages

**Files:**
- Modify: `src/app/suites/operations/page.tsx`
- Modify: `src/app/suites/service/page.tsx`
- Modify: `src/app/suites/dnr-roofing/page.tsx`

- [ ] **Step 1: Add card to Operations suite**

In `src/app/suites/operations/page.tsx`, add to `BASE_LINKS` in the "Scheduling & Planning" section (after the Master Schedule card):

```ts
{
  href: "/dashboards/crew-schedule",
  title: "Crew Schedule",
  description: "See where every crew member is working each day across all locations.",
  tag: "SCHEDULING",
  tagColor: "blue",
  icon: "👥",
  section: "Scheduling & Planning",
},
```

- [ ] **Step 2: Add card to Service suite**

In `src/app/suites/service/page.tsx`, add to `BASE_LINKS` after the service-scheduler card:

```ts
{
  href: "/dashboards/crew-schedule",
  title: "Crew Schedule",
  description: "See where every crew member is working each day.",
  tag: "SCHEDULING",
  tagColor: "blue",
  icon: "👥",
  section: "Scheduling",
},
```

- [ ] **Step 3: Add card to D&R + Roofing suite**

In `src/app/suites/dnr-roofing/page.tsx`, add to `LINKS` after the roofing-scheduler card:

```ts
{
  href: "/dashboards/crew-schedule",
  title: "Crew Schedule",
  description: "See where every crew member is working each day.",
  tag: "SCHEDULING",
  tagColor: "blue",
  icon: "👥",
},
```

- [ ] **Step 4: Commit**

```bash
git add src/app/suites/operations/page.tsx src/app/suites/service/page.tsx src/app/suites/dnr-roofing/page.tsx
git commit -m "feat(crew-schedule): add suite navigation cards"
```

### Task 7: Build verification and type check

**Files:** (none new)

- [ ] **Step 1: Run full type check**

Run: `npx tsc --noEmit`
Expected: Clean — no errors.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: Clean or only pre-existing warnings.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Successful build. The crew-schedule page should appear in the build output.

- [ ] **Step 4: Commit any lint/build fixes if needed**

```bash
git add -A
git commit -m "fix(crew-schedule): address lint/build issues"
```

### Task 8: Manual verification in dev server

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify the page loads**

Navigate to `http://localhost:3000/dashboards/crew-schedule`. Verify:
- DashboardShell renders with "Crew Schedule" title
- Header controls (date nav, period selector, view toggle, group toggle, location filter) are present
- Grid table shows crew members grouped by location
- Switching to cards view works
- Date navigation (prev/next/today) works
- Period switching (week/2weeks/month) works
- Group toggle (location/job type) works
- Day drill-down works (click column header → expanded single day → back button)
- Cell hover shows tooltip with full details
- Cell click navigates to relevant scheduler

- [ ] **Step 3: Verify suite navigation**

Navigate to `/suites/operations`. Verify "Crew Schedule" card appears in "Scheduling & Planning" section.
Check `/suites/service` and `/suites/dnr-roofing` for the card as well.

- [ ] **Step 4: Verify role access**

Log in as a non-admin user with OPERATIONS role. Verify `/dashboards/crew-schedule` is accessible (not blocked by middleware).
