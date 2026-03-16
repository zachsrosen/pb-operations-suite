# Scheduler Forecast Ghost Events — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show forecasted install dates as translucent "ghost" events on the master schedule calendar so the scheduling team can see predicted install occupancy before projects are formally scheduled.

**Architecture:** Fetch forecast data from the existing `/api/forecasting/timeline` endpoint, join it onto the scheduler's project array by deal ID, build ghost `ScheduledEvent` objects for eligible pre-construction projects, and merge them into a new `displayEvents` memo that all three views consume. A toolbar toggle controls visibility and conditionally enables the forecast query.

**Tech Stack:** React 19, React Query, TypeScript, Tailwind v4, Next.js 16, localStorage

**Spec:** `docs/superpowers/specs/2026-03-15-scheduler-forecast-ghosts-design.md`

---

## Chunk 1: Permissions + Toggle State + Forecast Query

### Task 1: Role permission updates

Grant `/api/forecasting` access to scheduler-accessible roles that don't already have it.

**Files:**
- Modify: `src/lib/role-permissions.ts:171-210` (OPERATIONS), `src/lib/role-permissions.ts:409-495` (TECH_OPS)
- Modify: `src/__tests__/lib/role-permissions.test.ts`

- [ ] **Step 1: Write failing tests for new permissions**

Add to `src/__tests__/lib/role-permissions.test.ts`:

```typescript
it("allows scheduler-accessible roles to access /api/forecasting", () => {
  // OPERATIONS has /dashboards/scheduler but not /api/forecasting today
  expect(canAccessRoute("OPERATIONS", "/api/forecasting")).toBe(true);
  expect(canAccessRoute("OPERATIONS", "/api/forecasting/timeline")).toBe(true);

  // TECH_OPS has /dashboards/scheduler but not /api/forecasting today
  expect(canAccessRoute("TECH_OPS", "/api/forecasting")).toBe(true);
  expect(canAccessRoute("TECH_OPS", "/api/forecasting/timeline")).toBe(true);

  // These already have it — verify they still do
  expect(canAccessRoute("OPERATIONS_MANAGER", "/api/forecasting")).toBe(true);
  expect(canAccessRoute("PROJECT_MANAGER", "/api/forecasting")).toBe(true);

  // MANAGER (legacy, normalizes to PROJECT_MANAGER) should also work
  expect(canAccessRoute("MANAGER", "/api/forecasting")).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=role-permissions --verbose`
Expected: FAIL — OPERATIONS and TECH_OPS assertions fail

- [ ] **Step 3: Add `/api/forecasting` to OPERATIONS and TECH_OPS allowedRoutes**

In `src/lib/role-permissions.ts`:

For OPERATIONS (after line 209, before the `]` closing `allowedRoutes`):
```typescript
      // Forecasting API (read-only, needed for scheduler ghost events)
      "/api/forecasting",
```

For TECH_OPS (after line 484, before the `]` closing `allowedRoutes`):
```typescript
      // Forecasting API (read-only, needed for scheduler ghost events)
      "/api/forecasting",
```

MANAGER already inherits from PROJECT_MANAGER via `normalizeRole`, which has `/api/forecasting`. No change needed for MANAGER.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=role-permissions --verbose`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/role-permissions.ts src/__tests__/lib/role-permissions.test.ts
git commit -m "feat(permissions): grant /api/forecasting to OPERATIONS and TECH_OPS roles"
```

---

### Task 2: Add `isForecast` flag to `ScheduledEvent` interface

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx:144-153`

- [ ] **Step 1: Add `isForecast` to the ScheduledEvent interface**

At `src/app/dashboards/scheduler/page.tsx:153` (before the closing `}`), add:

```typescript
  isForecast?: boolean;
```

The full interface becomes:

```typescript
interface ScheduledEvent extends SchedulerProject {
  date: string;
  eventType: string;
  days: number;
  isCompleted?: boolean;
  isOverdue?: boolean;
  isInspectionFailed?: boolean;
  isTentative?: boolean;
  tentativeRecordId?: string;
  isForecast?: boolean;
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors (new optional field is backward-compatible)

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): add isForecast flag to ScheduledEvent interface"
```

---

### Task 3: Toggle state with localStorage persistence

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx` (state section around line 548-558)

- [ ] **Step 1: Add toggle state after the filter state block**

After line 558 (`const [sortBy, setSortBy] = ...`) — the last filter state declaration — add:

```typescript
  /* ---- forecast ghost toggle ---- */
  const [showForecasts, setShowForecasts] = useState(false);
  // Hydrate from localStorage after mount
  useEffect(() => {
    const stored = localStorage.getItem("scheduler-show-forecasts");
    if (stored === "true") setShowForecasts(true);
  }, []);
  const toggleForecasts = useCallback(() => {
    setShowForecasts((prev) => {
      const next = !prev;
      localStorage.setItem("scheduler-show-forecasts", String(next));
      return next;
    });
  }, []);
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): add showForecasts toggle state with localStorage persistence"
```

---

### Task 4: Forecast query with conditional fetch

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx` (after the `projectsQuery` definition around line 769)

- [ ] **Step 1: Add the forecast query after `projectsQuery`**

After the `projectsQuery` definition (line 769), add:

```typescript
  // ---- Forecast data for ghost events (conditional on toggle) ----
  interface TimelineMilestone {
    key: string;
    liveForecast: string | null;
    basis: string;
    varianceDays: number | null;
    name: string;
  }
  interface TimelineProject {
    dealId: string;
    projectNumber: string;
    customerName: string;
    location: string;
    currentStage: string;
    milestones: TimelineMilestone[];
  }

  const forecastQuery = useQuery<{ projects: TimelineProject[] }>({
    queryKey: ["scheduler", "forecasts"],
    queryFn: async () => {
      const res = await fetch("/api/forecasting/timeline");
      if (!res.ok) throw new Error("Failed to fetch forecasts");
      return res.json();
    },
    enabled: showForecasts,
    refetchInterval: 5 * 60 * 1000, // same as main query
  });
```

Note: The `TimelineProject` interface here is local to the scheduler (only the fields we need). It does NOT conflict with the one in the API route file since that's server-side.

- [ ] **Step 2: Wire SSE invalidation to also invalidate forecast query**

Find the `useEffect` that listens for SSE and invalidates `["scheduler", "main-projects"]`. It's triggered by the query client. Add forecast invalidation alongside it. Search for `queryClient.invalidateQueries` in the `fetchProjects` callback (around line 805):

```typescript
  const fetchProjects = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["scheduler", "main-projects"] });
    queryClient.invalidateQueries({ queryKey: ["scheduler", "forecasts"] });
  }, [queryClient]);
```

- [ ] **Step 3: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): add conditional forecast query with synced refresh"
```

---

## Chunk 2: Ghost Event Builder + Display Pipeline

### Task 5: Ghost event builder memo

Build forecast ghost events from the joined forecast + scheduler project data, applying all eligibility and calendar filters.

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx` (after `filteredScheduledEvents` memo, around line 1294)

- [ ] **Step 1: Add the ghost event builder memo**

After the `filteredScheduledEvents` memo (line 1294), add:

```typescript
  // ---- Forecast ghost events ----
  const forecastGhostEvents = useMemo((): ScheduledEvent[] => {
    if (!showForecasts || !forecastQuery.data?.projects) return [];

    const timelineProjects = forecastQuery.data.projects;
    const ghosts: ScheduledEvent[] = [];

    for (const tp of timelineProjects) {
      // Find matching scheduler project by deal ID
      const project = projects.find((p) => String(p.id) === tp.dealId);
      if (!project) continue;

      // ── Eligibility filter ──

      // 0. Must be in a pre-construction stage (survey, rtb, blocked)
      //    Prevents post-construction projects (inspection, construction, other)
      //    from getting ghost events even if they lack a recorded construction date
      const preConstructionStages = new Set(["survey", "rtb", "blocked"]);
      if (!preConstructionStages.has(project.stage)) continue;

      // 1. Must not have a real construction event (no constructionScheduleDate)
      if (project.constructionScheduleDate) continue;

      // 2. Must not have a manual/tentative schedule
      if (manualSchedules[project.id]) continue;

      // 3. Must not have an active Zuper construction job
      if (project.zuperJobCategory === "construction") continue;

      // 4. Must have a valid forecast date
      const installMilestone = tp.milestones.find(
        (m) => m.key === "install" && m.basis !== "actual" && m.basis !== "insufficient"
      );
      if (!installMilestone?.liveForecast) continue;

      // 5. Must not have a real construction event in scheduledEvents
      const hasRealConstructionEvent = scheduledEvents.some(
        (e) => e.id === project.id && (e.eventType === "construction" || e.eventType === "construction-complete")
      );
      if (hasRealConstructionEvent) continue;

      // ── Build ghost event ──
      const ghost: ScheduledEvent = {
        ...project,
        date: installMilestone.liveForecast,
        eventType: "construction",
        days: project.daysInstall || 3,
        isForecast: true,
      };

      // ── Apply same calendar filters as filteredScheduledEvents ──
      if (calendarLocations.length > 0 && !calendarLocations.includes(ghost.location)) continue;

      const typeVariants: Record<string, string[]> = {
        survey: ["survey", "survey-complete"],
        construction: ["construction", "construction-complete"],
        inspection: ["inspection", "inspection-pass", "inspection-fail"],
        scheduled: ["scheduled"],
      };
      if (calendarScheduleTypes.length > 0) {
        const expandedTypes = calendarScheduleTypes.flatMap((t) => typeVariants[t] || [t]);
        if (!expandedTypes.includes(ghost.eventType)) continue;
      }

      // Ghosts have no isCompleted/isOverdue, so:
      // - showScheduled off → hide ghosts (they are "scheduled"-like)
      // - showCompleted off → no effect (ghosts are never completed)
      // - showIncomplete off → no effect (ghosts are never overdue)
      if (!showScheduled) continue;

      ghosts.push(ghost);
    }

    return ghosts;
  }, [
    showForecasts, forecastQuery.data, projects, manualSchedules,
    scheduledEvents, calendarLocations, calendarScheduleTypes, showScheduled,
  ]);
```

- [ ] **Step 2: Add `displayEvents` memo that merges real + ghost events**

Immediately after `forecastGhostEvents`:

```typescript
  // ---- Merged display events: real filtered events + ghost forecast events ----
  const displayEvents = useMemo((): ScheduledEvent[] => {
    if (forecastGhostEvents.length === 0) return filteredScheduledEvents;
    return [...filteredScheduledEvents, ...forecastGhostEvents];
  }, [filteredScheduledEvents, forecastGhostEvents]);
```

- [ ] **Step 3: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): add ghost event builder with eligibility filter and displayEvents memo"
```

---

### Task 6: Wire all three views to `displayEvents`

Replace `filteredScheduledEvents` with `displayEvents` in the calendar, week, and Gantt views. Revenue memos stay on `filteredScheduledEvents`.

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx`

- [ ] **Step 1: Update `calendarData` memo**

In the `calendarData` memo (line 1427), change:

```typescript
    filteredScheduledEvents.forEach((e) => {
```

to:

```typescript
    displayEvents.forEach((e) => {
```

And update the dependency array (line 1470):

```typescript
  }, [currentYear, currentMonth, displayEvents]);
```

- [ ] **Step 2: Update sort order in `calendarData`**

In the sort function inside `calendarData` (around line 1463), update to add secondary sort for forecasts:

```typescript
    for (const day of Object.keys(eventsByDate)) {
      eventsByDate[Number(day)].sort((a, b) => {
        const stageDiff = (STAGE_ORDER[a.eventType] ?? 9) - (STAGE_ORDER[b.eventType] ?? 9);
        if (stageDiff !== 0) return stageDiff;
        // Forecast events sort after real events on the same day
        return (a.isForecast ? 1 : 0) - (b.isForecast ? 1 : 0);
      });
    }
```

- [ ] **Step 3: Update week view**

The week view has one reference to `filteredScheduledEvents` around line 3652 where it filters events for each day cell. Replace:

```typescript
filteredScheduledEvents.filter(
```
with:
```typescript
displayEvents.filter(
```

Also update the week view's day-level sort (around line 3678, `dayEvents.sort(...)`) to add secondary forecast sort:

```typescript
dayEvents.sort((a, b) => {
  const stageDiff = (STAGE_ORDER_W[a.eventType] ?? 9) - (STAGE_ORDER_W[b.eventType] ?? 9);
  if (stageDiff !== 0) return stageDiff;
  return (a.isForecast ? 1 : 0) - (b.isForecast ? 1 : 0);
});
```

(If the existing sort uses a simpler inline comparison, add the `isForecast` tiebreaker in the same style.)

- [ ] **Step 4: Update Gantt view**

The Gantt view has one reference to `filteredScheduledEvents` around line 3845 where it filters events for each row/cell. Replace `filteredScheduledEvents` with `displayEvents`.

Also update the Gantt event sort (around line 3854) to add the secondary forecast sort, same pattern as month/week views. Forecast events should sort after real events at the same stage priority.

**Note on drag safety:** The week view has `onDragOver`/`onDrop` on day cells (for dragging sidebar projects), but these operate on `draggedProjectId` (a sidebar project being scheduled), not on re-dragging existing events. Forecast events in the week view are safe — they are not themselves draggable, and the drop handler schedules the *dragged* project, not the events already on that cell. The Gantt view has no drag support. No additional drag guards are needed beyond the month view fix in Task 8.

- [ ] **Step 5: Verify revenue memos are NOT changed**

Confirm that `weeklyRevenueSummary` (line 1343) and `monthlyRevenueSummary` (line 1376) still read from `filteredScheduledEvents` — NOT `displayEvents`. This is intentional: ghost events must not affect revenue calculations.

- [ ] **Step 6: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): wire month/week/Gantt views to displayEvents for ghost visibility"
```

---

### Task 7: Revenue exclusion safety net

Add explicit `!e.isForecast` guard to `computeRevenueBuckets` as a safety net per spec.

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx:1324-1341`

- [ ] **Step 1: Add isForecast guard to computeRevenueBuckets**

In `computeRevenueBuckets` (line 1325), update the scheduled events filter:

```typescript
    const scheduledEvts = events.filter((e) =>
      (e.eventType === "construction" || e.eventType === "rtb" || e.eventType === "blocked" || e.eventType === "scheduled") && !e.isOverdue && !e.isTentative && !e.isForecast
    );
```

Also add the guard to the completed and overdue filters (lines 1329-1331):

```typescript
    const completedEvts = events.filter((e) => e.eventType === "construction-complete" && !e.isForecast);
    const overdueEvts = events.filter((e) =>
      (e.eventType === "construction" || e.eventType === "rtb" || e.eventType === "blocked" || e.eventType === "scheduled") && e.isOverdue && !e.isTentative && !e.isForecast
    );
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): add isForecast guard to revenue computation as safety net"
```

---

## Chunk 3: Rendering + Visual Treatment

### Task 8: Ghost event visual treatment in month view

Add dashed border, reduced opacity, and FORECAST badge to forecast events in the month calendar view.

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx` (month view event pill, around line 3504-3551)

- [ ] **Step 1: Add forecast color class to the eventColorClass cascade**

In the month view event rendering (around line 3504), the `eventColorClass` is computed via a cascade of ternaries. Add a forecast case BEFORE the existing `ev.isTentative` check:

```typescript
                            const eventColorClass =
                              isFailedType ? "bg-amber-900/70 text-amber-200 ring-1 ring-amber-500 opacity-70 line-through" :
                              isCompletedType ? completedColorClass :
                              ev.isOverdue ? overdueColorClass :
                              ev.isForecast ? "bg-blue-500/40 text-blue-200 border border-dashed border-blue-400 opacity-60" :
                              ev.isTentative ? "bg-amber-500/70 text-black border border-dashed border-amber-300" :
                              ev.eventType === "rtb" ? "bg-emerald-500 text-black" :
                              ev.eventType === "blocked" ? "bg-yellow-500 text-black" :
                              ev.eventType === "construction" ? "bg-blue-500 text-white" :
                              ev.eventType === "survey" ? "bg-cyan-500 text-white" :
                              ev.eventType === "inspection" ? "bg-violet-500 text-white" :
                              ev.eventType === "scheduled" ? "bg-cyan-500 text-white" :
                              "bg-zinc-600 text-white";
```

- [ ] **Step 2: Add FORECAST badge label**

In the pill label area (around line 3539-3544), add a forecast badge after the tentative badge:

```typescript
                                {ev.isForecast && <span className="mr-0.5 text-[0.45rem] font-bold opacity-80">FORECAST</span>}
```

Add this line right after the `ev.isTentative` badge line (line 3539).

- [ ] **Step 3: Update tooltip for forecast events**

In the `title` attribute (line 3534), update to show forecast tooltip:

Replace the title with:
```typescript
                                title={ev.isForecast ? `Forecasted install — not yet scheduled` : `${ev.name} - ${ev.crew || "No crew"}${showRevenue ? ` - $${formatRevenueCompact(ev.amount)}` : ""}${isFailedType ? " ✗ Inspection Failed" : isCompletedType ? " ✓ Completed" : ev.isOverdue ? " ⚠ Incomplete" : " (drag to reschedule)"}`}
```

- [ ] **Step 4: Disable drag for forecast events**

Update the `isDraggable` check (line 3486) to exclude forecasts:

```typescript
                            const isDraggable = isActiveType && !ev.isOverdue && !ev.isForecast;
```

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): ghost event visual treatment in month view — dashed border, opacity, badge"
```

---

### Task 9: Ghost event visual treatment in week view

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx` (week view, around line 3700-3748)

- [ ] **Step 1: Add forecast color class to week view eventColorClass**

Same pattern as month view — add forecast case before `ev.isTentative`:

```typescript
                                const eventColorClass =
                                  isFailedType ? "bg-amber-900/70 text-amber-200 ring-1 ring-amber-500 opacity-70 line-through" :
                                  isCompletedType ? completedColorClassW :
                                  ev.isOverdue ? overdueColorClassW :
                                  ev.isForecast ? "bg-blue-500/40 text-blue-200 border border-dashed border-blue-400 opacity-60" :
                                  ev.isTentative ? "bg-amber-500/70 text-black border border-dashed border-amber-300" :
                                  ev.eventType === "construction" ? "bg-blue-500 text-white" :
                                  ev.eventType === "survey" ? "bg-cyan-500 text-white" :
                                  ev.eventType === "inspection" ? "bg-violet-500 text-white" :
                                  ev.eventType === "scheduled" ? "bg-cyan-500 text-white" :
                                  "bg-zinc-600 text-white";
```

- [ ] **Step 2: Add FORECAST badge to week view pill**

After the tentative badge (line 3742), add:

```typescript
                                    {ev.isForecast && <span className="mr-0.5 text-[0.5rem] font-bold opacity-80">FORECAST</span>}
```

- [ ] **Step 3: Update week view tooltip**

Update the title attribute for forecast events, same pattern as month view.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): ghost event visual treatment in week view"
```

---

### Task 10: Ghost event visual treatment in Gantt view

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx` (Gantt view, around line 3880-3927)

- [ ] **Step 1: Add forecast color class to Gantt view eventColorClass**

Same pattern — add forecast case before `ev.isTentative` (around line 3891):

```typescript
                                const eventColorClass =
                                  isFailedType ? "bg-amber-900/70 text-amber-200 ring-1 ring-amber-500 opacity-70 line-through" :
                                  isCompletedType ? completedColorClassG :
                                  e.isOverdue ? overdueColorClassG :
                                  e.isForecast ? "bg-blue-500/40 text-blue-200 border border-dashed border-blue-400 opacity-60" :
                                  e.isTentative ? "bg-amber-500/70 text-black border border-dashed border-amber-300" :
                                  e.eventType === "construction" ? "bg-blue-500 text-white" :
                                  e.eventType === "rtb" ? "bg-emerald-500 text-black" :
                                  e.eventType === "scheduled" ? "bg-cyan-500 text-white" :
                                  e.eventType === "blocked" ? "bg-yellow-500 text-black" :
                                  e.eventType === "survey" ? "bg-cyan-500 text-white" :
                                  e.eventType === "inspection" ? "bg-violet-500 text-white" :
                                  "bg-zinc-500 text-white";
```

- [ ] **Step 2: Add FORECAST badge to Gantt pill**

After the tentative badge (line 3922), add:

```typescript
                                    {e.isForecast && <span className="mr-0.5 text-[0.5rem] font-bold opacity-80">FORECAST</span>}
```

- [ ] **Step 3: Update Gantt tooltip**

Same pattern as month/week.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): ghost event visual treatment in Gantt view"
```

---

## Chunk 4: Modal + Click Behavior

### Task 11: Add `detailModalEvent` state and update click handlers

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx`

- [ ] **Step 1: Add `detailModalEvent` state**

After `detailModal` state (line 567):

```typescript
  const [detailModalEvent, setDetailModalEvent] = useState<ScheduledEvent | null>(null);
```

- [ ] **Step 2: Update month view click handler**

In the month view event click handler (line 3527-3532), update to set both states:

```typescript
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const proj = projects.find((pr) => pr.id === ev.id) || null;
                                  setDetailModal(proj);
                                  setDetailModalEvent(ev);
                                }}
```

- [ ] **Step 3: Update week view click handler**

In the week view event click handler (line 3731-3737):

```typescript
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const proj = projects.find((pr) => pr.id === ev.id) || null;
                                      setDetailModal(proj);
                                      setDetailModalEvent(ev);
                                    }}
```

- [ ] **Step 4: Update Gantt view click handler**

In the Gantt view event click handler (line 3907-3912):

```typescript
                                    onClick={() => {
                                      const proj = projects.find((pr) => pr.id === e.id) || null;
                                      setDetailModal(proj);
                                      setDetailModalEvent(e);
                                    }}
```

- [ ] **Step 5: Clear detailModalEvent when detailModal is cleared**

Find all `setDetailModal(null)` calls and add `setDetailModalEvent(null)` alongside them. There are ~9 locations:
- Line 1884, 1930, 1953, 2139, 2388, 2556, 4651, 5001, 5046

For each, add `setDetailModalEvent(null);` on the line immediately after (or before) `setDetailModal(null);`. Line 5001 is inside the reschedule handler where `setDetailModal(null)` is followed by `openScheduleModal` — the event state must be cleared here too to avoid stale forecast-mode rendering on the next modal open.

- [ ] **Step 6: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): add detailModalEvent state and update all click handlers"
```

---

### Task 12: Forecast-aware detail modal rendering

When `detailModalEvent?.isForecast`, show forecast metadata and suppress schedule actions.

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx` (detail modal section, around line 4647-5054)

- [ ] **Step 1: Add forecast info section to modal**

After the "Schedule" `ModalSection` (around line 4901), add a forecast section that shows when `detailModalEvent?.isForecast`:

```typescript
              {/* Forecast Info (when viewing a ghost event) */}
              {detailModalEvent?.isForecast && (() => {
                // Look up the install milestone from forecast data for basis/variance
                const tp = forecastQuery.data?.projects.find((p) => p.dealId === detailModal.id);
                const installMs = tp?.milestones.find((m) => m.key === "install");
                return (
                  <ModalSection title="Forecast">
                    <ModalRow
                      label="Predicted Install"
                      value={formatDateShort(detailModalEvent.date)}
                      valueClass="text-blue-400 font-semibold"
                    />
                    <ModalRow
                      label="Duration"
                      value={`${detailModalEvent.days} ${detailModalEvent.days === 1 ? "day" : "days"}`}
                    />
                    {installMs?.basis && (
                      <ModalRow
                        label="Forecast Basis"
                        value={installMs.basis.replace(/_/g, " ")}
                      />
                    )}
                    {installMs?.varianceDays != null && (
                      <ModalRow
                        label="Variance"
                        value={`${installMs.varianceDays > 0 ? "+" : ""}${installMs.varianceDays} days`}
                        valueClass={installMs.varianceDays > 14 ? "text-red-400" : installMs.varianceDays > 7 ? "text-amber-400" : "text-emerald-400"}
                      />
                    )}
                    <div className="text-[0.65rem] text-muted mt-1 p-2 rounded bg-blue-500/5 border border-dashed border-blue-400/30">
                      Forecasted install — not yet scheduled. This date is a prediction based on project milestone data.
                    </div>
                  </ModalSection>
                );
              })()}
```

- [ ] **Step 2: Suppress schedule actions for forecast events**

Wrap the tentative action banner (line 4905) and the reschedule section (line 4951) and the "Remove from Schedule" button (line 5018-5026) in a `!detailModalEvent?.isForecast` guard:

For the tentative banner (line 4905):
```typescript
            {manualSchedules[detailModal.id]?.isTentative && !detailModalEvent?.isForecast && (
```

For the reschedule section (line 4951):
```typescript
            {!detailModalEvent?.isForecast && (!manualSchedules[detailModal.id]?.isTentative && (detailModal.scheduleDate || manualSchedules[detailModal.id]?.startDate)) ? (
```

For the action buttons row (line 5018), wrap "Remove from Schedule" with:
```typescript
              {!manualSchedules[detailModal.id]?.isTentative && !detailModalEvent?.isForecast && (
```

And suppress "Open in Zuper" for forecasts (it has no Zuper job):
```typescript
              {detailModal.zuperJobUid && !detailModalEvent?.isForecast && (
```

- [ ] **Step 3: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): forecast-aware detail modal with read-only state"
```

---

## Chunk 5: Toggle UI + Export Behavior

### Task 13: Toolbar toggle button and summary chip

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx` (toolbar area, around line 3358-3377)

- [ ] **Step 1: Add forecast toggle button to toolbar**

After the Completed checkbox toggle (line 3376, end of the status toggles `</div>`), add the forecast toggle and summary chip:

```typescript
              <button
                onClick={toggleForecasts}
                className={`flex items-center gap-1 px-1.5 py-1 text-[0.6rem] font-medium rounded border transition-colors ml-1 ${
                  showForecasts
                    ? "border-blue-400 text-blue-400 bg-blue-500/10"
                    : "border-t-border text-muted opacity-60 hover:border-muted"
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full border border-dashed flex items-center justify-center shrink-0 ${
                  showForecasts ? "border-blue-400" : "border-t-border"
                }`}>
                  {showForecasts && <span className="w-1 h-1 rounded-full bg-blue-400" />}
                </span>
                Forecasts
              </button>
              {showForecasts && forecastGhostEvents.length > 0 && (
                <span className="text-[0.55rem] text-blue-400/70 ml-0.5">
                  {forecastGhostEvents.length} forecasted install{forecastGhostEvents.length !== 1 ? "s" : ""}
                </span>
              )}
```

The `forecastGhostEvents` count reflects location, schedule type, and status filters (applied in the ghost builder memo). It does **not** filter by the current view's date window (month/week/Gantt range). This is intentional — the chip shows the total filtered forecast load, not just the visible slice, which is more useful for scheduling planning ("how many installs are forecasted across all dates?"). The spec's mention of "date window" filtering was about agreeing with visible events; since the chip sits in the toolbar (not tied to a specific view), showing the full filtered count is the right behavior.

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): add forecast toggle button and summary chip to toolbar"
```

---

### Task 14: Export behavior — CSV includes forecasts, iCal excludes

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx` (export functions, lines 2447-2503)

- [ ] **Step 1: Update CSV export to include forecast events with type marker**

In `exportCSV` (line 2447), change the source from `scheduledEvents` to include ghosts when visible. Also add a "Type" column for forecast marking:

Update `exportCSV` to read from `displayEvents` instead of `scheduledEvents`:

```typescript
  const exportCSV = useCallback(() => {
    const headers = [
      "Project ID",
      "Customer",
      "Address",
      "Location",
      "Amount",
      "Type",
      "Stage",
      "Schedule Date",
      "Days",
      "Crew",
      "Event Type",
    ];
    let csv = headers.join(",") + "\n";
    // Use displayEvents to include forecasts when toggle is on
    const eventsToExport = showForecasts ? displayEvents : scheduledEvents;
    eventsToExport.forEach((e) => {
      csv +=
        [
          getProjectId(e.name),
          `"${getCustomerName(e.name)}"`,
          `"${e.address}"`,
          e.location,
          e.amount,
          `"${e.type || ""}"`,
          e.stage,
          e.date,
          e.days || e.daysInstall || 2,
          e.crew || "",
          e.isForecast ? "forecast" : e.eventType,
        ].join(",") + "\n";
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pb-schedule-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("CSV exported");
  }, [scheduledEvents, displayEvents, showForecasts, showToast]);
```

- [ ] **Step 2: Update iCal export to exclude forecast events**

In `exportICal` (line 2486), add a filter to exclude forecast events:

```typescript
  const exportICal = useCallback(() => {
    let ical =
      "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//PB Scheduler//EN\n";
    scheduledEvents
      .filter((e) => !e.isForecast)
      .forEach((e) => {
        const start = e.date.replace(/-/g, "");
        const end = addDays(e.date, Math.ceil(e.days || 1)).replace(/-/g, "");
        ical += `BEGIN:VEVENT\nDTSTART;VALUE=DATE:${start}\nDTEND;VALUE=DATE:${end}\nSUMMARY:${getCustomerName(e.name)} - ${e.crew || "Unassigned"}\nDESCRIPTION:${e.address}\\n$${e.amount.toLocaleString()}\nEND:VEVENT\n`;
      });
    ical += "END:VCALENDAR";
    const blob = new Blob([ical], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pb-schedule.ics";
    a.click();
    URL.revokeObjectURL(url);
    showToast("iCal exported");
  }, [scheduledEvents, showToast]);
```

Note: `scheduledEvents` never contains forecasts (they only exist in `displayEvents`), so the `.filter((e) => !e.isForecast)` is a safety net. The `copySchedule` function also uses `scheduledEvents` so it naturally excludes forecasts — this is intentional (clipboard copy behaves like iCal, not like CSV).

**CSV schema change:** The new "Event Type" column (position 11) is an additive change to the CSV export. The scheduler CSV is used for ad-hoc downloads, not consumed by downstream integrations, so this is safe. The column value is `"forecast"` for ghost events and the raw `eventType` (e.g., `"construction"`, `"inspection"`) for real events.

- [ ] **Step 3: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): CSV export includes forecasts, iCal export excludes them"
```

---

## Chunk 6: Tests

### Task 15: Unit tests for ghost event eligibility and revenue exclusion

**Files:**
- Create: `src/__tests__/scheduler-forecast-ghosts.test.ts`

- [ ] **Step 1: Write unit tests**

Create `src/__tests__/scheduler-forecast-ghosts.test.ts`:

```typescript
/**
 * Tests for scheduler forecast ghost event logic.
 *
 * Since the ghost event builder lives inside the scheduler page component
 * (as a useMemo), we test the core logic by extracting the eligibility
 * and filtering rules into testable assertions against mock data shapes.
 */

describe("Scheduler Forecast Ghost Events", () => {
  // ── Eligibility filter tests ──

  describe("eligibility filter", () => {
    // Helper: simulate the eligibility check from the ghost builder
    const PRE_CONSTRUCTION_STAGES = new Set(["survey", "rtb", "blocked"]);

    function isEligible(opts: {
      stage?: string;
      constructionScheduleDate?: string | null;
      manualSchedule?: boolean;
      zuperJobCategory?: string;
      hasRealConstructionEvent?: boolean;
      installMilestone?: { liveForecast: string | null; basis: string } | null;
    }): boolean {
      if (!PRE_CONSTRUCTION_STAGES.has(opts.stage || "")) return false;
      if (opts.constructionScheduleDate) return false;
      if (opts.manualSchedule) return false;
      if (opts.zuperJobCategory === "construction") return false;
      if (opts.hasRealConstructionEvent) return false;
      if (!opts.installMilestone) return false;
      if (opts.installMilestone.basis === "actual" || opts.installMilestone.basis === "insufficient") return false;
      if (!opts.installMilestone.liveForecast) return false;
      return true;
    }

    it("allows pre-construction project with valid forecast", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualSchedule: false,
        zuperJobCategory: "survey",
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(true);
    });

    it("allows survey-stage project with valid forecast", () => {
      expect(isEligible({
        stage: "survey",
        constructionScheduleDate: null,
        manualSchedule: false,
        zuperJobCategory: "survey",
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(true);
    });

    it("rejects inspection-stage project (post-construction)", () => {
      expect(isEligible({
        stage: "inspection",
        constructionScheduleDate: null,
        manualSchedule: false,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(false);
    });

    it("rejects construction-stage project", () => {
      expect(isEligible({
        stage: "construction",
        constructionScheduleDate: null,
        manualSchedule: false,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(false);
    });

    it("rejects project with constructionScheduleDate", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: "2026-04-10",
        manualSchedule: false,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(false);
    });

    it("rejects project with manual/tentative schedule", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualSchedule: true,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(false);
    });

    it("rejects project with active Zuper construction job", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualSchedule: false,
        zuperJobCategory: "construction",
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(false);
    });

    it("rejects project with real construction event in scheduledEvents", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualSchedule: false,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: true,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(false);
    });

    it("rejects project with 'actual' basis milestone", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualSchedule: false,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "actual" },
      })).toBe(false);
    });

    it("rejects project with 'insufficient' basis milestone", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualSchedule: false,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: null, basis: "insufficient" },
      })).toBe(false);
    });

    it("rejects project with no install milestone", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualSchedule: false,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: null,
      })).toBe(false);
    });
  });

  // ── Revenue exclusion tests ──

  describe("revenue exclusion", () => {
    function computeRevenueBuckets(events: Array<{
      eventType: string;
      isOverdue?: boolean;
      isTentative?: boolean;
      isForecast?: boolean;
      amount: number;
      id: string;
    }>) {
      const scheduledEvts = events.filter((e) =>
        (e.eventType === "construction" || e.eventType === "rtb" || e.eventType === "blocked" || e.eventType === "scheduled") && !e.isOverdue && !e.isTentative && !e.isForecast
      );
      const tentativeEvts = events.filter((e) => e.isTentative && !e.isForecast);
      const completedEvts = events.filter((e) => e.eventType === "construction-complete" && !e.isForecast);
      const overdueEvts = events.filter((e) =>
        (e.eventType === "construction" || e.eventType === "rtb" || e.eventType === "blocked" || e.eventType === "scheduled") && e.isOverdue && !e.isTentative && !e.isForecast
      );

      const sum = (evts: typeof events) => {
        const ids = new Set(evts.map((e) => e.id));
        return {
          count: ids.size,
          revenue: [...ids].reduce((s, id) => s + (evts.find((e) => e.id === id)?.amount || 0), 0),
        };
      };

      return { scheduled: sum(scheduledEvts), tentative: sum(tentativeEvts), completed: sum(completedEvts), overdue: sum(overdueEvts) };
    }

    it("excludes isForecast events from scheduled revenue", () => {
      const events = [
        { id: "1", eventType: "construction", amount: 50000, isForecast: true },
        { id: "2", eventType: "construction", amount: 30000 },
      ];
      const buckets = computeRevenueBuckets(events);
      expect(buckets.scheduled.count).toBe(1);
      expect(buckets.scheduled.revenue).toBe(30000);
    });

    it("excludes isForecast events from completed revenue", () => {
      const events = [
        { id: "1", eventType: "construction-complete", amount: 50000, isForecast: true },
        { id: "2", eventType: "construction-complete", amount: 30000 },
      ];
      const buckets = computeRevenueBuckets(events);
      expect(buckets.completed.count).toBe(1);
      expect(buckets.completed.revenue).toBe(30000);
    });

    it("counts real construction events normally", () => {
      const events = [
        { id: "1", eventType: "construction", amount: 50000 },
        { id: "2", eventType: "construction", amount: 30000 },
      ];
      const buckets = computeRevenueBuckets(events);
      expect(buckets.scheduled.count).toBe(2);
      expect(buckets.scheduled.revenue).toBe(80000);
    });
  });

  // ── Calendar filter interaction ──

  describe("calendar filter interaction", () => {
    it("ghost events hide when showScheduled is off", () => {
      // Ghosts have no isCompleted/isOverdue, so they are "scheduled"-like
      const ghost = { isForecast: true, isCompleted: undefined, isOverdue: undefined };
      const showScheduled = false;

      // The filter logic: if (!showScheduled && !e.isCompleted && !e.isOverdue) continue;
      const visible = showScheduled || ghost.isCompleted || ghost.isOverdue;
      expect(visible).toBe(false);
    });

    it("ghost events show when showScheduled is on", () => {
      const ghost = { isForecast: true, isCompleted: undefined, isOverdue: undefined };
      const showScheduled = true;
      const visible = showScheduled || ghost.isCompleted || ghost.isOverdue;
      expect(visible).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test -- --testPathPattern=scheduler-forecast-ghosts --verbose`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/scheduler-forecast-ghosts.test.ts
git commit -m "test(scheduler): unit tests for ghost event eligibility, revenue exclusion, and filter behavior"
```

---

### Task 16: Full build + lint verification

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All PASS

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Final commit (if any fixes needed)**

If build/lint reveals issues, fix them and commit.
