# Master Schedule: Service & D&R Overlay + Collapsible Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only service and D&R job overlays to the master scheduler calendar, plus a collapsible project sidebar.

**Architecture:** Zuper jobs fetched via existing `/api/zuper/jobs/by-category` endpoint, mapped to a new `OverlayEvent` type, merged into `displayEvents` alongside forecast ghosts. Sidebar collapse and overlay toggles persisted to localStorage. All changes in a single file — the scheduler page.

**Tech Stack:** Next.js, React Query, Zuper API, localStorage, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-25-master-schedule-service-dnr-design.md`

---

## Chunk 1: Types, State, and Data Fetching

### Task 1: Add OverlayEvent type and type guard

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx:144-154`

- [ ] **Step 1: Add OverlayEvent interface after the ScheduledEvent interface (~line 155)**

```ts
interface OverlayEvent {
  id: string;
  name: string;
  date: string;
  days: number;
  amount: number;
  crew: string;
  address: string;
  location: string;
  eventType: "service" | "dnr";
  eventSubtype: string;
  isOverlay: true;
  isOverdue: false;
  isForecast: false;
  isTentative: false;
  status: string;
}

type DisplayEvent = ScheduledEvent | OverlayEvent;

function isOverlayEvent(e: DisplayEvent): e is OverlayEvent {
  return "isOverlay" in e && e.isOverlay === true;
}
```

- [ ] **Step 2: Add Zuper job response type for the by-category API**

Add after the new `OverlayEvent` interface:

```ts
interface ZuperCategoryJob {
  jobUid: string;
  title: string;
  categoryName: string;
  categoryUid: string;
  statusName: string;
  statusColor: string;
  dueDate: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  customerName: string;
  address: string;
  city: string;
  state: string;
  assignedUser: string;
  teamName: string;
  hubspotDealId: string;
  jobTotal: number;
  createdAt: string;
  workOrderNumber: string;
}
```

- [ ] **Step 3: Verify the build still compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors (existing errors may be present)

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): add OverlayEvent type, DisplayEvent union, and type guard"
```

---

### Task 2: Add overlay toggle state with localStorage persistence

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx:561-573`

- [ ] **Step 1: Add import for normalizeLocation**

At the top imports (~line 11), add:

```ts
import { normalizeLocation } from "@/lib/locations";
```

Also add `countBusinessDaysInclusive` to the existing scheduling-utils import (~line 13-21):

```ts
import {
  addBusinessDaysYmd,
  addDaysYmd,
  countBusinessDaysInclusive,
  getBusinessDatesInSpan as getBusinessDatesInSpanShared,
  getConstructionSpanDaysFromZuper,
  isWeekendDateYmd,
  normalizeZuperBoundaryDates as normalizeZuperBoundaryDatesShared,
  toDateStr,
} from "@/lib/scheduling-utils";
```

Verify `countBusinessDaysInclusive` is exported from `scheduling-utils.ts` first. If not, use inline calculation.

- [ ] **Step 2: Add toggle state after forecast ghost toggle (~line 573)**

```ts
/* ---- service & D&R overlay toggles ---- */
const [showService, setShowService] = useState(false);
const [showDnr, setShowDnr] = useState(false);
useEffect(() => {
  if (localStorage.getItem("scheduler-show-service") === "true") setShowService(true);
  if (localStorage.getItem("scheduler-show-dnr") === "true") setShowDnr(true);
}, []);
const toggleService = useCallback(() => {
  setShowService((prev) => {
    const next = !prev;
    localStorage.setItem("scheduler-show-service", String(next));
    return next;
  });
}, []);
const toggleDnr = useCallback(() => {
  setShowDnr((prev) => {
    const next = !prev;
    localStorage.setItem("scheduler-show-dnr", String(next));
    return next;
  });
}, []);
```

- [ ] **Step 3: Add sidebar collapse state after the overlay toggles**

```ts
/* ---- collapsible sidebar ---- */
const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
useEffect(() => {
  if (localStorage.getItem("scheduler-sidebar-collapsed") === "true") setSidebarCollapsed(true);
}, []);
const toggleSidebar = useCallback(() => {
  setSidebarCollapsed((prev) => {
    const next = !prev;
    localStorage.setItem("scheduler-sidebar-collapsed", String(next));
    return next;
  });
}, []);
```

- [ ] **Step 4: Verify build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): add localStorage-persisted toggles for service, D&R, and sidebar collapse"
```

---

### Task 3: Add Zuper overlay data fetching with useQuery

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx` (after sidebar collapse state, before the existing project data fetch)

- [ ] **Step 1: Define Zuper category UID constants**

Add to the constants section (~after line 199, near the `LOCATIONS` const):

```ts
const SERVICE_CATEGORY_UIDS = [
  "cff6f839-c043-46ee-a09f-8d0e9f363437", // Service Visit
  "8a29a1c0-9141-4db6-b8bb-9d9a65e2a1de", // Service Revisit
].join(",");

const DNR_CATEGORY_UIDS = [
  "d9d888a1-efc3-4f01-a8d6-c9e867374d71", // Detach
  "43df49e9-3835-48f2-80ca-cc77ad7c3f0d", // Reset
  "a5e54b76-8b79-4cd7-a960-bad53d24e1c5", // D&R Inspection
].join(",");
```

- [ ] **Step 2: Compute the overlay fetch date range**

Add a `useMemo` after the toggle state that computes the date range based on the current view:

```ts
/* ---- overlay date range (visible span + 1mo buffer each side) ---- */
const overlayDateRange = useMemo(() => {
  const now = new Date();
  let anchor: Date;
  if (currentView === "week") {
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    anchor = new Date(now);
    anchor.setDate(now.getDate() + mondayOffset + weekOffset * 7);
  } else {
    // Month and Gantt views both anchor to currentMonth.
    // Gantt's 10-business-day range fits well within the ±1 month buffer.
    anchor = new Date(currentYear, currentMonth, 1);
  }
  const from = new Date(anchor);
  from.setMonth(from.getMonth() - 1);
  from.setDate(1);
  const to = new Date(anchor);
  to.setMonth(to.getMonth() + 2);
  to.setDate(0); // last day of next month
  return {
    from_date: toDateStr(from),
    to_date: toDateStr(to),
  };
}, [currentView, currentYear, currentMonth, weekOffset]);
```

- [ ] **Step 3: Add useQuery for service jobs**

Add after the date range memo:

```ts
const serviceJobsQuery = useQuery<{ jobs: ZuperCategoryJob[] }>({
  queryKey: ["zuper-service-overlay", overlayDateRange.from_date, overlayDateRange.to_date],
  queryFn: async () => {
    const params = new URLSearchParams({
      categories: SERVICE_CATEGORY_UIDS,
      from_date: overlayDateRange.from_date,
      to_date: overlayDateRange.to_date,
    });
    const res = await fetch(`/api/zuper/jobs/by-category?${params}`);
    if (!res.ok) return { jobs: [] };
    return res.json();
  },
  enabled: showService,
  staleTime: 2 * 60 * 1000,
  refetchOnWindowFocus: true,
});
```

- [ ] **Step 4: Add useQuery for D&R jobs**

```ts
const dnrJobsQuery = useQuery<{ jobs: ZuperCategoryJob[] }>({
  queryKey: ["zuper-dnr-overlay", overlayDateRange.from_date, overlayDateRange.to_date],
  queryFn: async () => {
    const params = new URLSearchParams({
      categories: DNR_CATEGORY_UIDS,
      from_date: overlayDateRange.from_date,
      to_date: overlayDateRange.to_date,
    });
    const res = await fetch(`/api/zuper/jobs/by-category?${params}`);
    if (!res.ok) return { jobs: [] };
    return res.json();
  },
  enabled: showDnr,
  staleTime: 2 * 60 * 1000,
  refetchOnWindowFocus: true,
});
```

- [ ] **Step 5: Add the mapping function that converts Zuper jobs → OverlayEvent[]**

Add after the queries:

```ts
function mapZuperJobsToOverlays(
  jobs: ZuperCategoryJob[],
  eventType: "service" | "dnr"
): OverlayEvent[] {
  return jobs
    .map((j): OverlayEvent | null => {
      const dateStr = j.scheduledStart
        ? j.scheduledStart.slice(0, 10)
        : j.dueDate
          ? j.dueDate.slice(0, 10)
          : null;
      if (!dateStr) return null;

      // Compute business-day span
      let days = 1;
      if (j.scheduledStart && j.scheduledEnd) {
        const start = new Date(j.scheduledStart.slice(0, 10) + "T12:00:00");
        const end = new Date(j.scheduledEnd.slice(0, 10) + "T12:00:00");
        if (end > start) {
          // Count business days manually
          let count = 0;
          const cursor = new Date(start);
          while (cursor <= end) {
            const dow = cursor.getDay();
            if (dow !== 0 && dow !== 6) count++;
            cursor.setDate(cursor.getDate() + 1);
          }
          if (count > 0) days = count;
        }
      }

      const loc = normalizeLocation(j.teamName) || normalizeLocation(j.city) || "Unknown";

      return {
        id: j.jobUid,
        name: j.title || j.customerName || "Untitled",
        date: dateStr,
        days,
        amount: 0,
        crew: j.assignedUser || "",
        address: j.address || "",
        location: loc,
        eventType,
        eventSubtype: j.categoryName,
        isOverlay: true,
        isOverdue: false,
        isForecast: false,
        isTentative: false,
        status: j.statusName || "",
      };
    })
    .filter((e): e is OverlayEvent => e !== null);
}
```

- [ ] **Step 6: Add the overlay events memo**

Add after the mapping function:

```ts
const overlayEvents = useMemo((): OverlayEvent[] => {
  const service = showService && serviceJobsQuery.data?.jobs
    ? mapZuperJobsToOverlays(serviceJobsQuery.data.jobs, "service")
    : [];
  const dnr = showDnr && dnrJobsQuery.data?.jobs
    ? mapZuperJobsToOverlays(dnrJobsQuery.data.jobs, "dnr")
    : [];
  let combined = [...service, ...dnr];
  // Respect calendar location filter (spec §5)
  if (calendarLocations.length > 0) {
    combined = combined.filter(e => calendarLocations.includes(e.location));
  }
  return combined;
}, [showService, showDnr, serviceJobsQuery.data, dnrJobsQuery.data, calendarLocations]);
```

- [ ] **Step 7: Verify build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): fetch service & D&R jobs from Zuper and map to OverlayEvent"
```

---

## Chunk 2: Display Pipeline Integration

### Task 4: Merge overlay events into displayEvents and update type annotations

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx:1475-1479`

- [ ] **Step 1: Update the displayEvents memo to include overlays**

Find the existing `displayEvents` memo (~line 1475-1479):

```ts
const displayEvents = useMemo((): ScheduledEvent[] => {
  if (forecastGhostEvents.length === 0) return filteredScheduledEvents;
  return [...filteredScheduledEvents, ...forecastGhostEvents];
}, [filteredScheduledEvents, forecastGhostEvents]);
```

Replace with:

```ts
const displayEvents = useMemo((): DisplayEvent[] => {
  const base: DisplayEvent[] = forecastGhostEvents.length === 0
    ? filteredScheduledEvents
    : [...filteredScheduledEvents, ...forecastGhostEvents];
  if (overlayEvents.length === 0) return base;
  return [...base, ...overlayEvents];
}, [filteredScheduledEvents, forecastGhostEvents, overlayEvents]);
```

- [ ] **Step 2: Guard the CSV export against overlay events**

In `exportCSV` (~line 2669), the `eventsToExport` already uses `scheduledEvents` (not `displayEvents`), so overlays are excluded from CSV. Verify this by reading the function. The iCal export (~line 2699) uses `scheduledEvents.filter(...)` — also safe. No changes needed here, just verify.

- [ ] **Step 3: Guard the revenue sidebar against overlay events**

Find `computeRevenueBuckets` (~line 1511) — it operates on events passed to it. Check where it's called. It's called with `displayEvents` in the weekly sidebar computation (~line 1566). Update that call to filter out overlays:

Find the line that filters `displayEvents` for the weekly revenue computation. If it iterates `displayEvents` directly, add a filter:

```ts
const weekEvents = displayEvents.filter((e) => {
```

Change to:

```ts
const weekEvents = displayEvents.filter((e) => {
  if (isOverlayEvent(e)) return false;
```

Add the same guard at each place `displayEvents` feeds into revenue/capacity calculations. Search for `displayEvents.filter` and add `isOverlayEvent` guards where the context is revenue or capacity.

- [ ] **Step 4: Verify build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): merge overlay events into displayEvents with revenue exclusion"
```

---

### Task 5: Add overlay detail state, color helpers, and popover component

Overlay detail state MUST be defined before the renderer updates (Task 6) reference `setOverlayDetail`.

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx:582-583` (state), and after the detail modal JSX (~line 5100+)

- [ ] **Step 1: Add overlay detail state**

Near the existing `detailModal` state (~line 582):

```ts
const [overlayDetail, setOverlayDetail] = useState<OverlayEvent | null>(null);
```

Also add to the Escape key handler (~line 2766, where `detailModal` is cleared):
```ts
else if (overlayDetail) { setOverlayDetail(null); }
```

- [ ] **Step 2: Add overlay color and badge helpers**

Add near the other color constants/helpers (outside the component, near the top-level functions):

```ts
function getOverlayColorClass(e: DisplayEvent): string | null {
  if (!isOverlayEvent(e)) return null;
  return e.eventType === "service"
    ? "bg-purple-500/20 text-purple-300 border border-dashed border-purple-400"
    : "bg-amber-500/20 text-amber-300 border border-dashed border-amber-400";
}

function getOverlayBadge(e: DisplayEvent): string | null {
  if (!isOverlayEvent(e)) return null;
  return e.eventType === "service" ? "SVC" : "D&R";
}
```

- [ ] **Step 3: Add the overlay detail popover JSX**

After the existing detail modal closing `</div>` (search for the end of the `{detailModal && (` block), add the popover JSX from the spec. (See Task 6 in previous revision for the full JSX — relocated here.)

```tsx
{/* OVERLAY DETAIL POPOVER */}
{overlayDetail && (
  <div
    className="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000]"
    onClick={(e) => { if (e.target === e.currentTarget) setOverlayDetail(null); }}
  >
    <div className={`bg-surface border rounded-xl p-5 max-w-[400px] w-[90%] ${
      overlayDetail.eventType === "service" ? "border-purple-500/50" : "border-amber-500/50"
    }`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold">
          {overlayDetail.eventType === "service" ? "Service Job" : "D&R Job"}
        </h3>
        <span className={`text-[0.65rem] px-2 py-0.5 rounded-full font-medium ${
          overlayDetail.eventType === "service"
            ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
            : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
        }`}>
          {overlayDetail.eventSubtype}
        </span>
      </div>
      <div className="space-y-2 text-[0.75rem]">
        <div className="flex gap-2"><span className="text-muted w-20 shrink-0">Job</span><span className="text-foreground">{overlayDetail.name}</span></div>
        <div className="flex gap-2"><span className="text-muted w-20 shrink-0">Address</span><span className="text-foreground">{overlayDetail.address || "—"}</span></div>
        <div className="flex gap-2"><span className="text-muted w-20 shrink-0">Location</span><span className="text-foreground">{overlayDetail.location}</span></div>
        <div className="flex gap-2"><span className="text-muted w-20 shrink-0">Assigned</span><span className="text-foreground">{overlayDetail.crew || "Unassigned"}</span></div>
        <div className="flex gap-2"><span className="text-muted w-20 shrink-0">Status</span><span className={`font-medium ${overlayDetail.eventType === "service" ? "text-purple-400" : "text-amber-400"}`}>{overlayDetail.status || "—"}</span></div>
        <div className="flex gap-2"><span className="text-muted w-20 shrink-0">Date</span><span className="text-foreground">{formatDateShort(overlayDetail.date)}{overlayDetail.days > 1 ? ` (${overlayDetail.days} days)` : ""}</span></div>
      </div>
      <button onClick={() => setOverlayDetail(null)} className="mt-4 w-full py-1.5 text-[0.7rem] rounded-md bg-background border border-t-border text-muted hover:text-foreground transition-colors">Close</button>
    </div>
  </div>
)}
```

- [ ] **Step 4: Verify build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): add overlay detail state, color helpers, and read-only popover"
```

---

### Task 6: Update all three view renderers to handle DisplayEvent union

Now that `setOverlayDetail`, `getOverlayColorClass`, `getOverlayBadge`, and `isOverlayEvent` are all defined, update the renderers.

The month, week, and Gantt views all iterate `displayEvents` and read fields like `name`, `days`, `amount`, `crew`. Since `OverlayEvent` includes all these fields, the reads work. The key changes are: (a) overlay-specific color classes, (b) sort priority updates, (c) click handler routing, (d) drag guard, and (e) hiding overlays with "Unknown" location from week/Gantt lane views.

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx` (month view ~3700, week view ~3860, Gantt view ~4055)

**Type annotations to update:**
- `eventsByDate` in month view (~line 1626): change from `Record<number, (ScheduledEvent & { dayNum: number; totalCalDays: number })[]>` to `Record<number, (DisplayEvent & { dayNum: number; totalCalDays: number })[]>`
- `dayEvents` in week view (~line 3882): change from `{ event: ScheduledEvent; dayNum: number }[]` to `{ event: DisplayEvent; dayNum: number }[]`

- [ ] **Step 1: Update month view type annotation and event rendering**

Find `eventsByDate` type (~line 1626):
```ts
const eventsByDate: Record<number, (ScheduledEvent & { dayNum: number; totalCalDays: number })[]> = {};
```
Change `ScheduledEvent` to `DisplayEvent`.

In the month view `dayEvents.map((ev, ei) => { ... })` block, apply these changes:

**Color class** — add overlay as the first condition before the existing chain:
```ts
const overlayColor = getOverlayColorClass(ev);
const eventColorClass = overlayColor ? overlayColor :
  isFailedType ? ...existing chain...
```

**Drag guard** — find `isDraggable`:
```ts
const isDraggable = isActiveType && !ev.isOverdue && !ev.isForecast && !isOverlayEvent(ev);
```

**Click handler** — route overlays to overlay popover:
```ts
onClick={(e) => {
  e.stopPropagation();
  if (isOverlayEvent(ev)) { setOverlayDetail(ev); return; }
  const proj = projects.find((pr) => pr.id === ev.id) || null;
  setDetailModal(proj);
  setDetailModalEvent(ev);
}}
```

**Badge label** — after forecast/tentative/completed labels:
```tsx
{isOverlayEvent(ev) && <span className="mr-0.5 text-[0.45rem] font-bold opacity-80">{getOverlayBadge(ev)}</span>}
```

- [ ] **Step 2: Update week view type annotation and event rendering**

Find `dayEvents` type (~line 3882):
```ts
const dayEvents: { event: ScheduledEvent; dayNum: number }[] = [];
```
Change `ScheduledEvent` to `DisplayEvent`.

The week view filters by location row (`e.location !== loc`), so "Unknown" overlays are naturally excluded.

Apply the same overlay color, badge, and click handler changes as month view. Week view events are not draggable, so no drag guard needed.

- [ ] **Step 3: Update Gantt view event rendering**

Same as week view — location-lane filtering already excludes "Unknown" overlays. Apply:
- Overlay color branch in `eventColorClass`
- Overlay badge label
- Click handler routing to `setOverlayDetail`

- [ ] **Step 4: Update sort maps in ALL THREE views**

Find each sort `order` object (there are three — one per view) and add overlay types:

```ts
const order: Record<string, number> = {
  construction: 0, "construction-complete": 0,
  inspection: 1, "inspection-pass": 1, "inspection-fail": 1,
  survey: 2, "survey-complete": 2,
  dnr: 3,
  service: 4,
};
```

**Locations of sort maps to update:**
- Month view: search for `WEEK_STAGE_ORDER` or inline `order` record near month event sorting
- Week view: search for sort `order` record near ~line 3900
- Gantt view: ~line 4088

All three must include `dnr: 3` and `service: 4`.

- [ ] **Step 5: Verify build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): render overlay events in month/week/Gantt with distinct styling"
```

---

## Chunk 3: UI Controls and Collapsible Sidebar

### Task 7: Add Service and D&R toggle buttons to the calendar toolbar

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx:3587-3606` (after the Forecasts toggle button)

- [ ] **Step 1: Add the Service toggle button**

After the Forecasts toggle button and its count badge (~line 3606, after the `{showForecasts && forecastGhostEvents.length > 0 && ( ... )}` block), add:

```tsx
<button
  onClick={toggleService}
  className={`flex items-center gap-1 px-1.5 py-1 text-[0.6rem] font-medium rounded border transition-colors ${
    showService
      ? "border-purple-400 text-purple-400 bg-purple-500/10"
      : "border-t-border text-muted opacity-60 hover:border-muted"
  }`}
>
  <span className={`w-2.5 h-2.5 rounded-full border border-dashed flex items-center justify-center shrink-0 ${
    showService ? "border-purple-400" : "border-t-border"
  }`}>
    {showService && <span className="w-1 h-1 rounded-full bg-purple-400" />}
  </span>
  Service
</button>
{showService && overlayEvents.filter(e => e.eventType === "service").length > 0 && (
  <span className="text-[0.55rem] text-purple-400/70 ml-0.5">
    {overlayEvents.filter(e => e.eventType === "service").length} service job{overlayEvents.filter(e => e.eventType === "service").length !== 1 ? "s" : ""}
  </span>
)}
```

- [ ] **Step 2: Add the D&R toggle button**

Immediately after the Service toggle and its count badge:

```tsx
<button
  onClick={toggleDnr}
  className={`flex items-center gap-1 px-1.5 py-1 text-[0.6rem] font-medium rounded border transition-colors ${
    showDnr
      ? "border-amber-400 text-amber-400 bg-amber-500/10"
      : "border-t-border text-muted opacity-60 hover:border-muted"
  }`}
>
  <span className={`w-2.5 h-2.5 rounded-full border border-dashed flex items-center justify-center shrink-0 ${
    showDnr ? "border-amber-400" : "border-t-border"
  }`}>
    {showDnr && <span className="w-1 h-1 rounded-full bg-amber-400" />}
  </span>
  D&R
</button>
{showDnr && overlayEvents.filter(e => e.eventType === "dnr").length > 0 && (
  <span className="text-[0.55rem] text-amber-400/70 ml-0.5">
    {overlayEvents.filter(e => e.eventType === "dnr").length} D&R job{overlayEvents.filter(e => e.eventType === "dnr").length !== 1 ? "s" : ""}
  </span>
)}
```

- [ ] **Step 3: Verify build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): add Service and D&R toggle buttons to calendar toolbar"
```

---

### Task 8: Implement collapsible sidebar

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx:2829-2837`

- [ ] **Step 1: Update the grid layout to respect sidebar collapse**

Find the grid layout (~line 2829-2833):

```tsx
<div className={`grid h-full max-[900px]:h-auto max-[900px]:grid-cols-[1fr] ${
  revenueSidebarOpen
    ? "grid-cols-[360px_1fr_200px] max-[1400px]:grid-cols-[320px_1fr_180px] max-[1100px]:grid-cols-[300px_1fr]"
    : "grid-cols-[360px_1fr_32px] max-[1100px]:grid-cols-[320px_1fr] max-[900px]:grid-cols-[1fr]"
}`}>
```

Replace with:

```tsx
<div className={`grid h-full max-[900px]:h-auto max-[900px]:grid-cols-[1fr] ${
  sidebarCollapsed
    ? (revenueSidebarOpen
        ? "grid-cols-[0px_1fr_200px] max-[1400px]:grid-cols-[0px_1fr_180px] max-[1100px]:grid-cols-[0px_1fr]"
        : "grid-cols-[0px_1fr_32px] max-[1100px]:grid-cols-[0px_1fr] max-[900px]:grid-cols-[1fr]")
    : (revenueSidebarOpen
        ? "grid-cols-[360px_1fr_200px] max-[1400px]:grid-cols-[320px_1fr_180px] max-[1100px]:grid-cols-[300px_1fr]"
        : "grid-cols-[360px_1fr_32px] max-[1100px]:grid-cols-[320px_1fr] max-[900px]:grid-cols-[1fr]")
}`}>
```

- [ ] **Step 2: Hide the sidebar aside when collapsed**

Find the `<aside>` (~line 2837):

```tsx
<aside className="bg-surface border-r border-t-border flex flex-col overflow-hidden max-[900px]:max-h-[50vh] max-[900px]:border-r-0 max-[900px]:border-b">
```

Replace with:

```tsx
<aside className={`bg-surface border-r border-t-border flex flex-col overflow-hidden max-[900px]:max-h-[50vh] max-[900px]:border-r-0 max-[900px]:border-b transition-all duration-200 ${
  sidebarCollapsed ? "w-0 min-w-0 border-r-0 opacity-0 pointer-events-none" : ""
}`}>
```

- [ ] **Step 3: Add expand button to the calendar header when sidebar is collapsed**

In the calendar header area (find the section that contains the view toggle buttons and calendar nav — near the top of the main calendar panel), add a sidebar expand button:

Find the calendar panel header (should be inside the `<main>` or second grid column). Near the start of the calendar controls, add:

```tsx
{sidebarCollapsed && (
  <button
    onClick={toggleSidebar}
    className="px-1.5 py-1 text-[0.65rem] rounded border border-t-border text-muted hover:text-foreground hover:border-orange-500 transition-colors mr-1"
    title="Show project sidebar"
  >
    ▶ Queue
  </button>
)}
```

- [ ] **Step 4: Add collapse button to the sidebar header**

Find the sidebar header (~line 2839-2860). In the flex row that contains the title and buttons, add a collapse button:

After the existing "Back" link button and before/near the export button (~line 2857), add:

```tsx
<button
  onClick={toggleSidebar}
  className="px-1.5 py-1.5 text-[0.7rem] rounded-md bg-background border border-t-border text-foreground/80 hover:border-orange-500 hover:text-orange-400 transition-colors"
  title="Collapse sidebar"
>
  ◀
</button>
```

- [ ] **Step 5: Verify build compiles and test manually**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): collapsible project sidebar with localStorage persistence"
```

---

## Chunk 4: Type Safety Cleanup and Final Verification

### Task 9: Fix any TypeScript errors from DisplayEvent union

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx`

The switch from `ScheduledEvent[]` to `DisplayEvent[]` for `displayEvents` may cause type errors in places that expect `ScheduledEvent`. These need targeted fixes.

- [ ] **Step 1: Find all type errors**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "scheduler/page.tsx"`

For each error:
- If the code accesses a `SchedulerProject`-specific field (like `hubspotUrl`, `stage`, `systemSize`, etc.) on a `displayEvents` element, add an `isOverlayEvent` guard to skip overlays
- If the code passes `displayEvents` to a function expecting `ScheduledEvent[]`, either narrow the type first or update the function signature

Common patterns to fix:
- `displayEvents.forEach(e => { ... e.stage ... })` → add `if (isOverlayEvent(e)) return;` at the top
- Anywhere `displayEvents` is typed as `ScheduledEvent[]` → change to `DisplayEvent[]`
- The `eventsByDate` in month view — update its type from `Record<number, (ScheduledEvent & ...)[]>` to `Record<number, ((ScheduledEvent | OverlayEvent) & ...)[]>`

- [ ] **Step 2: Verify all type errors are resolved**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "scheduler/page.tsx"`
Expected: No errors from scheduler page

- [ ] **Step 3: Run the full build to verify nothing else broke**

Run: `npm run build 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "fix(scheduler): resolve TypeScript errors from DisplayEvent union type"
```

---

### Task 10: Manual smoke test

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Test overlay toggles**

1. Open `/dashboards/scheduler`
2. Verify Service and D&R toggle buttons appear next to Forecasts
3. Click Service — verify purple events appear on the calendar (if any are scheduled)
4. Click D&R — verify amber events appear
5. Verify count badges update
6. Refresh the page — verify toggle state persists from localStorage

- [ ] **Step 3: Test sidebar collapse**

1. Click the collapse button on the sidebar
2. Verify sidebar hides and calendar expands
3. Verify "▶ Queue" button appears
4. Click it — verify sidebar reappears
5. Refresh — verify collapse state persists

- [ ] **Step 4: Test overlay detail popover**

1. Click a service or D&R event
2. Verify the read-only popover appears with job details
3. Verify clicking a regular install event still opens the normal detail modal
4. Close the popover with the Close button and by clicking the backdrop

- [ ] **Step 5: Test view switching**

1. Switch to week view — verify overlays appear in location lanes (but not for "Unknown" locations)
2. Switch to Gantt view — same verification
3. Switch back to month view — verify overlays still show

- [ ] **Step 6: Test location filtering**

1. Select a specific location in the calendar location filter
2. Verify only overlays for that location appear
3. Clear the filter — verify all overlays return

- [ ] **Step 7: Final commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): service & D&R overlays + collapsible sidebar — complete"
```
