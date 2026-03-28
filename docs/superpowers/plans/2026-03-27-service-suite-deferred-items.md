# Service Suite Deferred Items Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement three deferred features from the Jessica meeting: master scheduler service job enhancements (day view, modal links, all assignees), service backlog stage filtering (built tier), and sync modal UX improvements (column ordering, sticky headers, color coding, custom text input).

**Architecture:** Three independent subsystems that can be implemented in parallel. The scheduler work modifies the master scheduler page and the Zuper jobs-by-category API. The backlog work is a single-file client-side reclassification. The sync modal work touches the SyncModal component, the catalog-sync-types module, the selection-to-intents converter, and the sync plan pipeline.

**Tech Stack:** Next.js 16.1, React 19, TypeScript 5, Tailwind v4, HubSpot CRM API, Zuper REST API

**Spec:** `docs/superpowers/specs/2026-03-27-service-suite-deferred-items-design.md`

---

## Chunk 1: Zuper API — All Assignees + Service Backlog Stage Filtering

These are the smallest, most self-contained changes. The API change unblocks the scheduler frontend work in Chunk 2.

### Task 1: Zuper Jobs-by-Category API — Return All Assigned Users

**Files:**
- Modify: `src/app/api/zuper/jobs/by-category/route.ts:70-80` (assignedUser mapping)

- [ ] **Step 1: Update the assigned user extraction to return all users**

In `src/app/api/zuper/jobs/by-category/route.ts`, replace the loop at lines 70-80 that breaks after the first user. Currently:

```typescript
let assignedUser = "";
if (assigned.length > 0) {
  for (const a of assigned) {
    // ... extracts first_name + last_name
    break; // ← only gets first user
  }
}
```

Replace with:

```typescript
const assignedUsers: string[] = [];
for (const a of assigned) {
  const u =
    a?.user_uid ? a : a?.user ? a.user : null;
  if (u) {
    const first = u.first_name || "";
    const last = u.last_name || "";
    const name = `${first} ${last}`.trim();
    if (name) assignedUsers.push(name);
  }
}
```

- [ ] **Step 2: Update the response shape**

In the return object (lines 94-114), change:

```typescript
assignedUser,
```

to:

```typescript
assignedUser: assignedUsers[0] || "",
assignedUsers,
```

This keeps backward compatibility — `assignedUser` still returns the first name for any consumers that rely on it, while `assignedUsers` provides the full array.

- [ ] **Step 3: Verify no type errors**

```bash
npx tsc --noEmit 2>&1 | grep -i "by-category" | head -5
```

Expected: No errors (the response is untyped JSON, so adding a field is safe).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/zuper/jobs/by-category/route.ts
git commit -m "feat: return all assigned users from Zuper jobs-by-category API"
```

---

### Task 2: Service Backlog — Add Built Stage Classification

**Files:**
- Modify: `src/app/dashboards/service-backlog/page.tsx:83-92` (stage constants + classifyStage)
- Reference: `src/app/dashboards/equipment-backlog/page.tsx:63,66-72,460,706-710` (ops backlog pattern)

- [ ] **Step 1: Add BUILT_STAGES and update StageClass type**

In `src/app/dashboards/service-backlog/page.tsx`, replace lines 83-92:

```typescript
const COMPLETED_STAGES = new Set(["Completed", "Cancelled"]);
const IN_PROGRESS_STAGES = new Set(["Work In Progress"]);

type StageClass = "backlog" | "in_progress" | "completed";

function classifyStage(stage: string): StageClass {
  if (COMPLETED_STAGES.has(stage)) return "completed";
  if (IN_PROGRESS_STAGES.has(stage)) return "in_progress";
  return "backlog";
}
```

with:

```typescript
const IN_PROGRESS_STAGES = new Set(["Work In Progress"]);
const BUILT_STAGES = new Set(["Inspection", "Invoicing"]);

type StageClass = "backlog" | "in_progress" | "built";

function classifyStage(stage: string): StageClass {
  if (BUILT_STAGES.has(stage)) return "built";
  if (IN_PROGRESS_STAGES.has(stage)) return "in_progress";
  return "backlog";
}
```

- [ ] **Step 2: Update the three-way project split to include "built"**

At lines 419-430, the existing split destructures into `{ backlogProjects, inProgressProjects, completedProjects }`. Replace the entire `useMemo` with a four-way split:

```typescript
const { backlogProjects, inProgressProjects, builtProjects } = useMemo(() => {
  const backlog: Project[] = [];
  const inProgress: Project[] = [];
  const built: Project[] = [];
  for (const p of filteredProjects) {
    const cls = classifyStage(p.stage);
    if (cls === "built") built.push(p);
    else if (cls === "in_progress") inProgress.push(p);
    else backlog.push(p);
  }
  return { backlogProjects: backlog, inProgressProjects: inProgress, builtProjects: built };
}, [filteredProjects]);
```

Also update the `displayProjects` memo (~line 434-438) to remove the `completedProjects` reference:

```typescript
const displayProjects = useMemo(() => {
  if (!activeStatFilter) return filteredProjects;
  if (activeStatFilter === "backlog") return backlogProjects;
  if (activeStatFilter === "in_progress") return inProgressProjects;
  return filteredProjects;
}, [filteredProjects, backlogProjects, inProgressProjects, activeStatFilter]);
```

- [ ] **Step 3: Add builtTotals memo**

Near line 468 (where `backlogTotals` and `inProgressTotals` are computed), add:

```typescript
const builtTotals = useMemo(() => aggregateEquipment(builtProjects), [builtProjects]);
```

- [ ] **Step 4: Update all `"completed"` references**

There are two places that check for `"completed"`:

1. Stage breakdown table exclusion (~line 500):
   Change `if (classifyStage(p.stage) === "completed") continue;` to `if (classifyStage(p.stage) === "built") continue;`

2. CSV export (~line 559):
   Change `classifyStage(p.stage) === "completed" ? "Completed" : ...` to use the new three-tier classification:
   ```typescript
   Status: classifyStage(p.stage) === "built" ? "Built" : classifyStage(p.stage) === "in_progress" ? "In Progress" : "Backlog",
   ```

Search for any other `"completed"` references in this file and update them similarly.

- [ ] **Step 5: Add the green built summary line**

After the StatRow components (~line 712), add the built summary line matching the ops backlog pattern (reference: `equipment-backlog/page.tsx:706-710`):

```tsx
{builtTotals.projects > 0 && (
  <div className="text-xs text-muted mb-6 text-center">
    <span className="text-green-400">{builtTotals.projects}</span> built projects not shown
    ({builtTotals.modules.toLocaleString()} modules, {builtTotals.inverters.toLocaleString()} inverters, {builtTotals.batteries.toLocaleString()} batteries)
  </div>
)}
```

- [ ] **Step 6: Verify headline stat totals exclude built**

The `backlogTotals` memo now uses `backlogProjects` which only contains `"backlog"` classified projects (from Step 2). Verify `backlogTotals` and `inProgressTotals` do NOT include built projects by checking that their source arrays come from the updated split.

- [ ] **Step 7: Verify build**

```bash
npx tsc --noEmit 2>&1 | grep -i "service-backlog" | head -5
```

Expected: No type errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboards/service-backlog/page.tsx
git commit -m "feat: reclassify Inspection/Invoicing as built in service backlog"
```

---

## Chunk 2: Master Scheduler — Overlay Enhancements + Day View

### Task 3: Overlay Event Interface — Add hubspotDealId and assignedUsers

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx:158-175` (OverlayEvent interface)
- Modify: `src/app/dashboards/scheduler/page.tsx:483-531` (mapZuperJobsToOverlays function)

- [ ] **Step 1: Extend the OverlayEvent interface**

In `src/app/dashboards/scheduler/page.tsx`, find the `OverlayEvent` interface (~line 158). Add two new fields:

```typescript
hubspotDealId?: string;
assignedUsers: string[];
```

- [ ] **Step 2: Update ZuperCategoryJob interface to include assignedUsers**

Find the `ZuperCategoryJob` interface (~line 183). Add the new field from the API:

```typescript
assignedUsers?: string[];
```

This matches the response shape added in Task 1.

- [ ] **Step 3: Update mapZuperJobsToOverlays to pass through new fields**

In the `mapZuperJobsToOverlays` function (~line 483), update the overlay event construction to include:

```typescript
hubspotDealId: j.hubspotDealId || undefined,
assignedUsers: j.assignedUsers || [j.assignedUser].filter(Boolean),
crew: (j.assignedUsers || [j.assignedUser].filter(Boolean)).join(", ") || j.assignedUser || "",
```

The `crew` field is kept for backward compatibility with any existing rendering that reads it.

- [ ] **Step 4: Verify no type errors**

```bash
npx tsc --noEmit 2>&1 | grep -i "scheduler" | head -5
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat: add hubspotDealId and assignedUsers to OverlayEvent"
```

---

### Task 4: Overlay Calendar Card — Show All Assignees

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx:4065-4083` (overlay event card rendering)

- [ ] **Step 1: Update the assignee display on calendar cards**

Find where the overlay event card renders the crew/assigned user (~line 4065-4083). The current display shows a single name. Replace with:

```tsx
{isOverlayEvent(ev) && ev.assignedUsers && ev.assignedUsers.length > 0 && (
  <span className="text-[0.45rem] opacity-60">
    {ev.assignedUsers[0].split(" ")[0]}
    {ev.assignedUsers.length > 1 && ` +${ev.assignedUsers.length - 1}`}
  </span>
)}
```

This shows "Mike" for one assignee, "Mike +1" for two, "Mike +2" for three, etc.

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat: show abbreviated assignee count on overlay calendar cards"
```

---

### Task 5: Overlay Detail Modal — Links + Full Assignee List

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx:5685-5719` (overlay detail modal)
- Reference: `src/app/dashboards/scheduler/page.tsx:781` (zuperWebBaseUrl state)

- [ ] **Step 1: Update the Assigned To field in the modal**

In the overlay detail modal (~line 5685-5719), find the existing crew/assigned display (likely `overlayDetail.crew` at ~line 5709). **Remove the existing crew display** and replace it with:

```tsx
<div>
  <span className="text-muted text-xs">Assigned To</span>
  <p className="text-sm text-foreground">
    {overlayDetail.assignedUsers && overlayDetail.assignedUsers.length > 0
      ? overlayDetail.assignedUsers.join(", ")
      : "Unassigned"}
  </p>
</div>
```

- [ ] **Step 2: Add Zuper and HubSpot link buttons**

At the bottom of the overlay detail modal (before the closing `</div>`), add:

```tsx
<div className="flex gap-2 mt-4 pt-3 border-t border-border">
  <a
    href={`${zuperWebBaseUrl}/jobs/${overlayDetail.id}/details`}
    target="_blank"
    rel="noopener noreferrer"
    className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors"
  >
    Open in Zuper
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  </a>
  {overlayDetail.hubspotDealId && (
    <a
      href={`https://app.hubspot.com/contacts/21710069/deal/${overlayDetail.hubspotDealId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors"
    >
      Open in HubSpot
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  )}
</div>
```

Note: Portal ID `21710069` is hardcoded matching the existing pattern in this file (~line 637).

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat: add Zuper/HubSpot links and full assignee list to overlay modal"
```

---

### Task 6: Day View — View Toggle and State

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx:656` (currentView state)
- Modify: `src/app/dashboards/scheduler/page.tsx:3746-3763` (view toggle buttons)
- Modify: `src/app/dashboards/scheduler/page.tsx:3005-3007` (keyboard shortcuts)

- [ ] **Step 1: Add "day" to the currentView type**

At ~line 656, update the state type:

```typescript
const [currentView, setCurrentView] = useState<"calendar" | "week" | "day" | "gantt">("calendar");
```

- [ ] **Step 2: Add day-specific state**

Near the other date state variables, add:

```typescript
const [selectedDay, setSelectedDay] = useState<string | null>(null); // "YYYY-MM-DD"
```

- [ ] **Step 3: Update view toggle buttons**

At ~line 3747-3749, add "day" to the button definitions array:

```typescript
const views = [
  { key: "calendar" as const, label: "Month" },
  { key: "week" as const, label: "Week" },
  { key: "day" as const, label: "Day" },
  { key: "gantt" as const, label: "Gantt" },
];
```

- [ ] **Step 4: Update keyboard shortcuts**

At ~line 3005-3007, update to include day view:

```typescript
if (e.key === "1") setCurrentView("calendar");
if (e.key === "2") setCurrentView("week");
if (e.key === "3") setCurrentView("day");
if (e.key === "4") setCurrentView("gantt");
```

- [ ] **Step 5: Add click-to-day-view on month grid date numbers**

Find where date numbers are rendered on the month grid (~line 3997-4001). The date number (`{day}`) is currently rendered inside a cell that calls `handleDayClick(dateStr)` (which opens the scheduling modal). Do NOT replace that handler — it's needed for the scheduling workflow.

Instead, make the **date number itself** a separate clickable element that navigates to day view, while the cell background retains its existing click behavior:

```tsx
<span
  className="cursor-pointer hover:text-emerald-400 transition-colors"
  onClick={(e) => {
    e.stopPropagation(); // Don't trigger the cell's handleDayClick
    setSelectedDay(dateStr);
    setCurrentView("day");
  }}
>
  {day}
</span>
```

This lets clicking the number go to day view, while clicking elsewhere in the cell still opens the scheduling modal.

- [ ] **Step 6: Add day navigation helpers**

Add navigation functions near the other navigation logic:

```typescript
const navigateDay = useCallback((offset: number) => {
  if (!selectedDay) return;
  const d = new Date(selectedDay + "T12:00:00");
  d.setDate(d.getDate() + offset);
  setSelectedDay(d.toISOString().split("T")[0]);
}, [selectedDay]);

// Default selectedDay to today when entering day view without a selection
useEffect(() => {
  if (currentView === "day" && !selectedDay) {
    setSelectedDay(new Date().toISOString().split("T")[0]);
  }
}, [currentView, selectedDay]);
```

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat: add day view state, toggle, keyboard shortcuts, and date click entry"
```

---

### Task 7: Day View — Time Grid Component

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx` (add day view rendering in the view switch)

- [ ] **Step 1: Build the day view time grid**

Find the conditional rendering block that switches between calendar/week/gantt views (search for `currentView === "calendar"` or the view switching logic). Add a new branch for `currentView === "day"`:

```tsx
{currentView === "day" && selectedDay && (() => {
  const HOUR_HEIGHT = 60; // px per hour slot
  const START_HOUR = 6;
  const END_HOUR = 20; // 8 PM
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

  // Collect all events for this day
  // Note: use `displayEvents` (the existing filtered+sorted event list) for project events,
  // and `overlayEvents` for service/D&R overlay events. Both use `date: string` for the event date.
  const dayProjects = (displayEvents || []).filter((ev) => ev.date === selectedDay);
  const dayOverlays = overlayEvents.filter((ev) => ev.date === selectedDay);

  // Parse event times for positioning
  type TimeBlock = {
    event: typeof filteredEvents[number] | OverlayEvent;
    isOverlay: boolean;
    startHour: number;
    duration: number; // hours
  };

  function parseTimeBlock(
    ev: { scheduledTime?: string; date?: string; days?: number },
    isOverlay: boolean,
    rawEvent: TimeBlock["event"],
  ): TimeBlock {
    let startHour = -1; // -1 means "all day"
    if ("scheduledTime" in ev && ev.scheduledTime) {
      const [h, m] = ev.scheduledTime.split(":").map(Number);
      if (!isNaN(h)) startHour = h + (m || 0) / 60;
    }
    // Overlay events default to 1 hour. Project events without a time go to "unscheduled" row
    // (startHour will be -1), so duration is irrelevant for placement. If they do have a time,
    // default to 1 hour since project `days` represents calendar days, not hours.
    return { event: rawEvent, isOverlay, startHour, duration: 1 };
  }

  const allBlocks: TimeBlock[] = [
    ...dayProjects.map((ev) => parseTimeBlock(ev, false, ev)),
    ...dayOverlays.map((ev) => parseTimeBlock(ev, true, ev)),
  ];

  const scheduled = allBlocks.filter((b) => b.startHour >= START_HOUR && b.startHour < END_HOUR);
  const unscheduled = allBlocks.filter((b) => b.startHour < START_HOUR || b.startHour >= END_HOUR);

  // Overlap layout: group overlapping events, assign fractional widths
  function computeColumns(blocks: TimeBlock[]): (TimeBlock & { col: number; totalCols: number })[] {
    if (blocks.length === 0) return [];
    const sorted = [...blocks].sort((a, b) => a.startHour - b.startHour);
    const result: (TimeBlock & { col: number; totalCols: number })[] = [];
    const columns: TimeBlock[][] = [];

    for (const block of sorted) {
      let placed = false;
      for (let c = 0; c < columns.length; c++) {
        const lastInCol = columns[c][columns[c].length - 1];
        if (lastInCol.startHour + lastInCol.duration <= block.startHour) {
          columns[c].push(block);
          result.push({ ...block, col: c, totalCols: 0 });
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push([block]);
        result.push({ ...block, col: columns.length - 1, totalCols: 0 });
      }
    }

    // Set totalCols for all overlapping groups
    for (const r of result) {
      r.totalCols = columns.length;
    }
    return result;
  }

  const laid = computeColumns(scheduled);

  const dayDate = new Date(selectedDay + "T12:00:00");
  const dayLabel = dayDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex flex-col h-full">
      {/* Day navigation header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <button
          onClick={() => navigateDay(-1)}
          className="px-2 py-1 text-xs rounded bg-surface hover:bg-surface-2 text-foreground"
        >
          ← Prev
        </button>
        <div className="text-sm font-medium text-foreground">{dayLabel}</div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setSelectedDay(new Date().toISOString().split("T")[0]);
            }}
            className="px-2 py-1 text-xs rounded bg-surface hover:bg-surface-2 text-foreground"
          >
            Today
          </button>
          <button
            onClick={() => navigateDay(1)}
            className="px-2 py-1 text-xs rounded bg-surface hover:bg-surface-2 text-foreground"
          >
            Next →
          </button>
        </div>
      </div>

      {/* Unscheduled / all-day row */}
      {unscheduled.length > 0 && (
        <div className="px-4 py-2 border-b border-border bg-surface">
          <div className="text-[0.6rem] text-muted uppercase tracking-wide mb-1">All Day / Unscheduled</div>
          <div className="flex flex-wrap gap-1">
            {unscheduled.map((block, i) => {
              const ev = block.event;
              const isOv = block.isOverlay;
              return (
                <button
                  key={`unsched-${i}`}
                  onClick={() => isOv ? setOverlayDetail(ev as OverlayEvent) : handleEventClick(ev)}
                  className={`px-2 py-1 rounded text-[0.6rem] border ${
                    isOv
                      ? (ev as OverlayEvent).eventType === "service"
                        ? "bg-purple-500/20 text-purple-300 border-dashed border-purple-400"
                        : "bg-amber-500/20 text-amber-300 border-dashed border-amber-400"
                      : "bg-blue-500/20 text-blue-300 border-blue-500/30"
                  }`}
                >
                  {ev.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Time grid */}
      <div className="flex-1 overflow-y-auto relative">
        {allBlocks.length === 0 && (
          <div className="flex items-center justify-center h-full text-muted text-sm">
            No scheduled jobs
          </div>
        )}
        {allBlocks.length > 0 && (
          <div className="relative" style={{ height: hours.length * HOUR_HEIGHT }}>
            {/* Hour lines */}
            {hours.map((hour) => (
              <div
                key={hour}
                className="absolute left-0 right-0 border-t border-border/50 flex"
                style={{ top: (hour - START_HOUR) * HOUR_HEIGHT }}
              >
                <span className="text-[0.6rem] text-muted w-12 -mt-2 text-right pr-2">
                  {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                </span>
              </div>
            ))}

            {/* Event blocks */}
            <div className="absolute left-14 right-2 top-0" style={{ height: hours.length * HOUR_HEIGHT }}>
              {laid.map((block, i) => {
                const ev = block.event;
                const isOv = block.isOverlay;
                const top = (block.startHour - START_HOUR) * HOUR_HEIGHT;
                const height = Math.max(block.duration * HOUR_HEIGHT, 24);
                const width = `${100 / block.totalCols}%`;
                const left = `${(block.col / block.totalCols) * 100}%`;

                const colorClass = isOv
                  ? (ev as OverlayEvent).eventType === "service"
                    ? "bg-purple-500/20 text-purple-300 border-l-2 border-purple-500"
                    : "bg-amber-500/20 text-amber-300 border-l-2 border-amber-500"
                  : "bg-blue-500/20 text-blue-300 border-l-2 border-blue-500";

                return (
                  <button
                    key={`day-${i}`}
                    className={`absolute rounded-r px-1.5 py-0.5 text-left overflow-hidden cursor-pointer hover:brightness-125 transition-all ${colorClass}`}
                    style={{ top, height, width, left }}
                    onClick={() => isOv ? setOverlayDetail(ev as OverlayEvent) : handleEventClick(ev)}
                  >
                    <div className="text-[0.6rem] font-medium truncate">{ev.name}</div>
                    {isOv && (ev as OverlayEvent).assignedUsers?.length > 0 && (
                      <div className="text-[0.5rem] opacity-70 truncate">
                        {(ev as OverlayEvent).assignedUsers.join(", ")}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
})()}
```

- [ ] **Step 2: Add arrow key navigation for day view**

In the keyboard shortcut handler (~line 3005), add day view navigation for both plain and alt+arrow keys:

```typescript
if (currentView === "day") {
  if (e.key === "ArrowLeft") { navigateDay(-1); e.preventDefault(); }
  if (e.key === "ArrowRight") { navigateDay(1); e.preventDefault(); }
}
```

Also find the alt+arrow handler (~line 3008-3014) and add a `"day"` branch:

```typescript
if (currentView === "day") {
  if (e.key === "ArrowLeft") navigateDay(-1);
  if (e.key === "ArrowRight") navigateDay(1);
}
```

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat: add day view with hour-by-hour timeline and overlap layout"
```

---

## Chunk 3: Sync Modal — Column Ordering, Sticky Headers, Color Coding

### Task 8: System Column Ordering — Internal Pinned, External Alphabetized

**Files:**
- Modify: `src/components/catalog/SyncModal.tsx:713` (system columns loop in thead)
- Modify: `src/components/catalog/SyncModal.tsx:951` (system columns loop in tbody)
- Reference: `src/lib/catalog-sync-types.ts:13` (EXTERNAL_SYSTEMS array)

- [ ] **Step 1: Sort external systems alphabetically**

In `src/components/catalog/SyncModal.tsx`, find where `EXTERNAL_SYSTEMS` is used to iterate system columns. The Internal column is already rendered separately before the loop (~line 710-711 for thead, and separately in tbody).

The `EXTERNAL_SYSTEMS` array from `catalog-sync-types.ts` may not be alphabetically ordered. Create a sorted copy at the top of `SyncModal.tsx`:

```typescript
const SORTED_SYSTEMS = [...EXTERNAL_SYSTEMS].sort((a, b) => a.localeCompare(b));
```

Then replace `EXTERNAL_SYSTEMS.map(` with `SORTED_SYSTEMS.map(` in:
1. The thead loop (~line 713)
2. The tbody row loop (~line 951)
3. Any other iteration over system columns in the component

- [ ] **Step 2: Verify the Internal column still renders first**

Internal is rendered as its own column before the system loop. Verify this is the case by reading lines 710-711 (thead) and the equivalent in tbody. No changes needed if Internal is already a separate column.

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit 2>&1 | grep -i "SyncModal" | head -5
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/catalog/SyncModal.tsx
git commit -m "feat: sort sync modal system columns alphabetically with Internal pinned first"
```

---

### Task 9: Sticky Header Row with System Color Coding

**Files:**
- Modify: `src/components/catalog/SyncModal.tsx:705-732` (thead rendering)
- Modify: `src/components/catalog/SyncModal.tsx:951` (tbody column cells)

- [ ] **Step 1: Define system color map**

Add at the top of `SyncModal.tsx` (near the other constants):

```typescript
const SYSTEM_COLORS: Record<string, { border: string; headerBg: string; colBg: string }> = {
  internal: { border: "border-t-2 border-emerald-500", headerBg: "bg-emerald-500/10", colBg: "bg-emerald-500/5" },
  hubspot: { border: "border-t-2 border-orange-500", headerBg: "bg-orange-500/10", colBg: "bg-orange-500/5" },
  zoho: { border: "border-t-2 border-red-500", headerBg: "bg-red-500/10", colBg: "bg-red-500/5" },
  zuper: { border: "border-t-2 border-purple-500", headerBg: "bg-purple-500/10", colBg: "bg-purple-500/5" },
};
```

- [ ] **Step 2: Make thead sticky and apply color coding to header cells**

Update the `<thead>` tag (~line 705) to be sticky:

```tsx
<thead className="sticky top-0 z-10 bg-surface-elevated">
```

Update the Internal column header (~line 710-711) to include its color:

```tsx
<th className={`... ${SYSTEM_COLORS.internal.border} ${SYSTEM_COLORS.internal.headerBg}`}>
```

Update the external system column headers in the loop (~line 713) to include their color:

```tsx
<th className={`... ${SYSTEM_COLORS[sys]?.border || ""} ${SYSTEM_COLORS[sys]?.headerBg || ""}`}>
```

- [ ] **Step 3: Apply subtle column tint to tbody cells**

In the tbody, update the Internal cell component (~line 1085) and External cell component (~line 1193) to include the column background tint:

For Internal cells:
```tsx
<td className={`... ${SYSTEM_COLORS.internal.colBg}`}>
```

For External cells (in the loop):
```tsx
<td className={`... ${SYSTEM_COLORS[sys]?.colBg || ""}`}>
```

- [ ] **Step 4: Verify the sticky header works with the scrollable container**

The modal's scrollable container is at ~line 663 (`overflow-y-auto`). The table's horizontal scroll container is at ~line 703. The `sticky top-0` on thead should work within the `overflow-y-auto` parent. Verify the `thead` z-index is high enough that it sits above cell content.

- [ ] **Step 5: Commit**

```bash
git add src/components/catalog/SyncModal.tsx
git commit -m "feat: add sticky header row and system color coding to sync modal"
```

---

## Chunk 4: Sync Modal — Custom Text Input

### Task 10: Type System — Add customValue to FieldIntent

**Files:**
- Modify: `src/lib/catalog-sync-types.ts:19-25` (FieldIntent interface)

- [ ] **Step 1: Add customValue field to FieldIntent**

In `src/lib/catalog-sync-types.ts`, update the `FieldIntent` interface (~line 19):

```typescript
export interface FieldIntent {
  direction: Direction;
  mode: SelectionMode;
  updateInternalOnPull: boolean;
  /** When present, this user-typed value overrides any system source. */
  customValue?: string;
}
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit 2>&1 | tail -5
```

Expected: No errors — the field is optional, so existing code is unaffected.

- [ ] **Step 3: Commit**

```bash
git add src/lib/catalog-sync-types.ts
git commit -m "feat: add optional customValue field to FieldIntent type"
```

---

### Task 11: Selection-to-Intents — Handle "custom" Source

**Files:**
- Modify: `src/lib/selection-to-intents.ts:20-29` (CellSelection type)
- Modify: `src/lib/selection-to-intents.ts:60-108` (selectionToIntents function)
- Modify: `src/lib/selection-to-intents.ts:242-303` (getDropdownOptions function)

- [ ] **Step 1: Update DropdownOption value type**

In `src/lib/selection-to-intents.ts`, update the `DropdownOption` interface (~line 41-46) to include `"custom"`:

```typescript
export interface DropdownOption {
  value: "keep" | "internal" | "custom" | ExternalSystem;
  label: string;
  projectedValue: string | number | null;
  disabled?: boolean;
}
```

- [ ] **Step 2: Extend CellSelection source type**

Update the `CellSelection` interface (~line 20-29) to accept `"custom"`:

```typescript
export interface CellSelection {
  system: ExternalSystem;
  externalField: string;
  source: "keep" | "internal" | "custom" | ExternalSystem;
  isInternalColumn?: boolean;
}
```

- [ ] **Step 3: Handle "custom" in selectionToIntents**

In the `selectionToIntents` function (~line 60-108), add a branch for the `"custom"` source. Find the switch/if chain that handles different source values and add:

```typescript
if (sel.source === "custom") {
  // Resolve the internal field name from the mapping edge so we can look up
  // the custom value by row-level field key (keyed by internalField, not externalField)
  const edge = mappings.find((m) => m.externalField === sel.externalField && m.system === sel.system);
  const internalFieldKey = edge?.internalField || sel.externalField;
  intent = {
    direction: "push",
    mode: "manual",
    updateInternalOnPull: false,
    customValue: customValues?.[internalFieldKey] || "",
  };
}
```

Update the function signature to accept an optional `customValues` parameter:

```typescript
export function selectionToIntents(
  selections: CellSelection[],
  mappings: FieldMappingEdge[],
  customValues?: Record<string, string>,
): Record<ExternalSystem, Record<string, FieldIntent>>
```

- [ ] **Step 4: Update getDropdownOptions to include "Custom..." option**

In `getDropdownOptions` (~line 242-303), add a "Custom..." option at the end of the returned options array:

```typescript
options.push({
  value: "custom",
  label: customValues?.[fieldName] ? `Custom: "${customValues[fieldName]}"` : "Custom...",
  projectedValue: customValues?.[fieldName] || null,
  disabled: false,
});
```

When a custom value already exists for this row, the label shows the value; otherwise it shows "Custom...".

Update the function signature to accept `customValues` and `fieldName`:

```typescript
export function getDropdownOptions(
  // ... existing params
  customValues?: Record<string, string>,
  fieldName?: string,
): DropdownOption[]
```

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: May see errors in SyncModal.tsx if it doesn't pass `customValues` yet — that's expected and fixed in the next task.

- [ ] **Step 5: Commit**

```bash
git add src/lib/selection-to-intents.ts
git commit -m "feat: handle custom source in selection-to-intents with customValues param"
```

---

### Task 12: SyncModal UI — Custom Value State and Input

**Files:**
- Modify: `src/components/catalog/SyncModal.tsx:26` (SelectionMap type)
- Modify: `src/components/catalog/SyncModal.tsx:293` (selections state)
- Modify: `src/components/catalog/SyncModal.tsx:1085-1109` (InternalCell select)
- Modify: `src/components/catalog/SyncModal.tsx:1193-1219` (ExternalCell select)

- [ ] **Step 1: Extend SelectionMap to allow "custom"**

At ~line 26, update:

```typescript
type SelectionMap = Record<string, "keep" | "internal" | "custom" | ExternalSystem>;
```

- [ ] **Step 2: Add customValues state**

Near the selections state (~line 293), add:

```typescript
const [customValues, setCustomValues] = useState<Record<string, string>>({});
```

- [ ] **Step 3: Add a CustomValueInput component**

Add a small inline component within SyncModal (or above it):

```typescript
function CustomValueInput({
  fieldName,
  currentValue,
  onConfirm,
  onCancel,
}: {
  fieldName: string;
  currentValue: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(currentValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConfirm(value);
          if (e.key === "Escape") onCancel();
        }}
        onBlur={() => onConfirm(value)}
        className="w-full px-1.5 py-0.5 text-xs bg-surface border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500"
        placeholder="Type custom value..."
      />
      <button
        onClick={onCancel}
        className="text-muted hover:text-foreground text-xs flex-shrink-0"
        title="Cancel"
      >
        ×
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Track which cells are in "custom input" mode**

Add state to track which cells are showing the text input:

```typescript
const [editingCustom, setEditingCustom] = useState<string | null>(null); // "{system}:{field}" or "internal:{field}"
```

- [ ] **Step 5: Update the cell rendering to show custom input when active**

In both InternalCell and ExternalCell components, wrap the existing `<select>` with a conditional:

```tsx
{editingCustom === `${systemKey}:${fieldName}` ? (
  <CustomValueInput
    fieldName={fieldName}
    currentValue={customValues[fieldName] || ""}
    onConfirm={(val) => {
      if (val.trim()) {
        setCustomValues((prev) => ({ ...prev, [fieldName]: val }));
        // Set this cell's selection to "custom"
        setSelections((prev) => ({ ...prev, [`${systemKey}:${fieldName}`]: "custom" }));
      } else {
        // Empty value — clear custom and revert all "custom" selections on this row to "keep"
        setCustomValues((prev) => {
          const next = { ...prev };
          delete next[fieldName];
          return next;
        });
        // Revert all cells on this row that selected "custom" to "keep"
        setSelections((prev) => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            if (key.endsWith(`:${fieldName}`) && next[key] === "custom") {
              next[key] = "keep";
            }
          }
          return next;
        });
      }
      setEditingCustom(null);
    }}
    onCancel={() => {
      setEditingCustom(null);
      // If no custom value exists, revert selection to "keep"
      if (!customValues[fieldName]) {
        setSelections((prev) => ({ ...prev, [`${systemKey}:${fieldName}`]: "keep" }));
      }
    }}
  />
) : (
  <select /* ... existing select ... */>
    {/* existing options */}
  </select>
)}
```

- [ ] **Step 6: Add "Custom..." option to dropdown and handle selection**

In the `<select>` onChange handler, detect when "custom" is selected and switch to input mode:

```typescript
onChange={(e) => {
  const val = e.target.value;
  if (val === "custom") {
    setEditingCustom(`${systemKey}:${fieldName}`);
    return;
  }
  // ... existing selection logic
}}
```

Add the "Custom..." option at the bottom of each select's options, with a visual separator:

```tsx
<option disabled>──────</option>
<option value="custom">Custom...</option>
```

- [ ] **Step 7: Show "Custom" as a source option in sibling dropdowns when a custom value exists**

In `getDropdownOptions` calls, pass `customValues` so that when a custom value exists for a field, all system columns on that row see "Custom" as an option with the typed value as the projected result.

Update all `getDropdownOptions(...)` calls to include `customValues`:

```typescript
getDropdownOptions(/* ... existing args */, customValues)
```

- [ ] **Step 8: Pass customValues through to selectionToIntents**

Find where `selectionToIntents` is called (likely in the sync/submit handler). This is where `SelectionMap` entries are converted to `CellSelection[]` before calling `selectionToIntents`. Ensure that when a selection has `source === "custom"`, it is included in the `CellSelection` array with `source: "custom"`:

```typescript
// When building CellSelection[] from SelectionMap:
for (const [key, source] of Object.entries(selections)) {
  // ... existing logic for "keep", "internal", external systems ...
  // The "custom" source passes through as-is:
  cellSelections.push({
    system,
    externalField: field,
    source, // "custom" flows through here
    isInternalColumn,
  });
}
```

Then pass `customValues` to `selectionToIntents`:

```typescript
const intents = selectionToIntents(cellSelections, mappings, customValues);
```

- [ ] **Step 9: Verify build**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add src/components/catalog/SyncModal.tsx
git commit -m "feat: add custom text input with row-level value propagation to sync modal"
```

---

### Task 13: Sync Plan Backend — Accept Custom Values

**Files:**
- Modify: `src/lib/catalog-sync-plan.ts:251-298` (derivePlan)
- Modify: `src/lib/catalog-sync-plan.ts:360-420` (derivePushOperations)
- Modify: `src/lib/catalog-sync-plan.ts:260-268` (computeEffectiveState)
- Reference: `src/lib/catalog-sync-types.ts:62-85` (SyncOperation — already has `value` field on push/pull)

The `SyncOperation` type already has a `value` field on both `pull` and `push` kinds — no type changes needed there. The key insight is:

- Custom values with `direction: "push"` go through `derivePushOperations` (NOT `derivePullOperations`)
- Custom values that update Internal go through `computeEffectiveState` as patches
- The `push` kind's `value` field already carries the write value

- [ ] **Step 1: Handle customValue in derivePushOperations**

In `derivePushOperations` (~line 360), when iterating intents for a system, check for `customValue` on the intent. If present, use it as the push value instead of reading from `effectiveState`:

```typescript
for (const [field, intent] of Object.entries(systemIntents)) {
  if (intent.direction !== "push") continue;

  const mapping = findMapping(field, system, activeMappings);
  if (!mapping) continue;

  // Custom value overrides the effective state
  const value = intent.customValue !== undefined
    ? intent.customValue
    : effectiveState[mapping.internalField] ?? null;

  pushes.push({
    kind: "push",
    system,
    externalField: field,
    value,
    source: "manual",
  });
}
```

- [ ] **Step 2: Handle customValue for internal patch in computeEffectiveState**

In `computeEffectiveState` (~line 260), after computing the base internal patch from pulls, also check intents for custom values that should patch the internal record. When `isInternalColumn` is true (set by the SyncModal for Internal column selections), the custom value should be written to `internalPatch`:

```typescript
// After existing pull-based patch logic, add:
for (const [system, systemIntents] of Object.entries(intents)) {
  for (const [field, intent] of Object.entries(systemIntents)) {
    if (intent.customValue !== undefined && intent.updateInternalOnPull) {
      const mapping = findMapping(field, system, activeMappings);
      if (mapping) {
        internalPatch[mapping.internalField] = intent.customValue;
      }
    }
  }
}
```

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: No errors.

- [ ] **Step 4: Run existing sync tests (if any)**

```bash
npm test -- --testPathPattern="catalog-sync" --verbose 2>&1 | tail -20
```

Expected: All existing tests pass (the new field is optional and doesn't break existing flows).

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog-sync-plan.ts
git commit -m "feat: support custom value overrides in sync plan derivation and execution"
```

---

### Task 14: Build Verification and Full Test

**Files:** All modified files

- [ ] **Step 1: Run full TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Run all tests**

```bash
npm test -- --verbose 2>&1 | tail -30
```

Expected: All tests pass.

- [ ] **Step 3: Run production build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Run lint**

```bash
npm run lint
```

Expected: No lint errors in modified files.

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add <specific-files-that-were-fixed>
git commit -m "fix: address build/lint issues from service suite deferred items"
```
