# Master Schedule: Service & D&R Overlay + Collapsible Sidebar

**Date:** 2026-03-25
**Status:** Approved

## Summary

Add read-only service and D&R job overlays to the master scheduler calendar, plus a collapsible project sidebar to maximize calendar real estate. Both features use localStorage persistence.

## Context

The master scheduler (`/dashboards/scheduler`) currently shows only solar install pipeline jobs — surveys, construction, and inspections. Service and D&R jobs live on separate scheduler pages (`/dashboards/service-scheduler`, `/dashboards/dnr-scheduler`). Ops needs a single view showing all scheduled work across the organization without leaving the master schedule.

## Design

### 1. Collapsible Project Sidebar

**Current state:** The left sidebar panel containing the project list is always visible, consuming ~350px of horizontal space.

**Change:**
- Add a toggle button (chevron icon) at the top-right corner of the sidebar panel
- Clicking collapses the sidebar to hidden; the calendar grid expands to fill the full width
- When collapsed, a small expand button remains visible at the left edge
- State persisted to `localStorage` key `scheduler-sidebar-collapsed`
- Default: expanded (existing behavior)

### 2. Service & D&R Toggle Buttons

**Location:** Inline with the existing "Forecasts" toggle button in the calendar toolbar.

**Buttons:**
- **"Service"** — purple accent (`purple-400`), dashed-circle indicator matching Forecasts pattern
- **"D&R"** — amber accent (`amber-400`), same dashed-circle indicator style

**Behavior:**
- Both off by default
- Persisted to `localStorage` keys: `scheduler-show-service`, `scheduler-show-dnr`
- Each toggle independently enables/disables its data fetch
- When toggled on and events are present, shows a count badge (e.g., "3 service jobs") matching the Forecasts pattern

### 3. Data Fetching

**Approach:** Reuse the existing `/api/zuper/jobs/by-category` endpoint — the same API the standalone service-scheduler and dnr-scheduler pages already use.

**Service categories (Zuper UIDs):**
- Service Visit: `cff6f839-c043-46ee-a09f-8d0e9f363437`
- Service Revisit: `8a29a1c0-9141-4db6-b8bb-9d9a65e2a1de`

**D&R categories (Zuper UIDs):**
- Detach: `d9d888a1-efc3-4f01-a8d6-c9e867374d71`
- Reset: `43df49e9-3835-48f2-80ca-cc77ad7c3f0d`
- D&R Inspection: `a5e54b76-8b79-4cd7-a960-bad53d24e1c5`

**Query configuration:**
- `enabled` flag tied to the respective toggle state
- Date range: derived from the **visible date span + 1 month buffer on each side**. The anchor depends on the active view:
  - **Month view:** `currentYear`/`currentMonth` → fetch from 1st of prev month to end of next month
  - **Week view:** `weekOffset` → compute the Monday of the target week, then fetch from 1 month before to 1 month after
  - **Gantt view:** 10-business-day range from current Monday → fetch from 1 month before to 1 month after
  - The query `from_date`/`to_date` recomputes when the view or navigation state changes. The 1-month buffer ensures smooth transitions without data gaps.
- Stale time: 2 minutes (matches existing scheduler patterns)
- Refetch on window focus
- On fetch error: silently fail (no toast, no auto-disable). The toggle stays on but no events render. Matches existing forecast toggle error behavior.

### 4. Event Mapping

Overlay events use a new lightweight `OverlayEvent` type — they do NOT use the full `ScheduledEvent` shape (which extends `SchedulerProject` with ~40 HubSpot-specific fields). The calendar renderers (month, week, Gantt) will accept `ScheduledEvent | OverlayEvent` via a union type.

**`OverlayEvent` type:**

The renderers read `name`, `days`, `amount`, `crew`, and `location` directly from display events. `OverlayEvent` must include these fields so it satisfies the shared display contract without requiring runtime guards everywhere.

```ts
interface OverlayEvent {
  id: string;           // jobUid
  name: string;         // job title (aliased to `name` to match renderer reads)
  date: string;         // YYYY-MM-DD from scheduledStart or dueDate
  days: number;         // business-day span: computed from scheduledStart→scheduledEnd, default 1
  amount: number;       // always 0 — overlays have no revenue
  crew: string;         // assignedUser name (renderers read `crew` for display)
  address: string;      // customer address
  location: string;     // canonical location via normalizeLocation(teamName)
  eventType: "service" | "dnr";
  eventSubtype: string; // category name (e.g., "Service Visit", "Detach")
  isOverlay: true;      // discriminator — always true for overlay events
  isOverdue: false;     // never overdue
  isForecast: false;    // not a forecast ghost
  isTentative: false;   // not tentative
  status: string;       // Zuper status name (for detail popover)
}
```

**Multi-day span calculation:** If both `scheduledStart` and `scheduledEnd` are present, compute `days` as the count of business days in that range (using existing `countBusinessDaysInclusive` from `scheduling-utils.ts`). Otherwise default to `1`. This ensures month and week renderers correctly spread overlays across multiple calendar cells.

**Location mapping:** Use `normalizeLocation(teamName)` from `lib/locations.ts` to map Zuper team names (e.g., "PB Westminster Ops") to canonical locations ("Westminster"). Falls back to `normalizeLocation(city)` if teamName doesn't match.

**Unresolved locations:** Events where neither `teamName` nor `city` resolve to a canonical location are **dropped from week and Gantt views** (which only render fixed canonical location rows) but **still appear in month view** (which does not use location lanes). This avoids needing a phantom "Unknown" row in lane-based views.

### 5. Event Rendering

**Visual treatment:**
- **Service events:** `bg-purple-500/20` background, `border-purple-400` dashed border, purple text
- **D&R events:** `bg-amber-500/20` background, `border-amber-400` dashed border, amber text
- Dashed border is the universal visual cue for "read-only / overlay" events (distinct from solid-bordered schedulable events)
- Small type badge: "SVC" for service, "D&R" for detach/reset/inspection

**Sort priority (lower = rendered on top):**
- Construction: 0 (highest)
- Inspection: 1
- Survey: 2
- D&R: 3
- Service: 4 (lowest — least likely to conflict with install scheduling decisions)

Sort priority must be added to `WEEK_STAGE_ORDER` and equivalent sort maps in all three view renderers (month, week, Gantt).

**Location filtering:** Service and D&R events respect the existing `calendarLocations` multi-select filter using the canonical location derived from `normalizeLocation(teamName || city)`.

### 6. Click / Detail Popover

Clicking a service or D&R event opens a **separate read-only popover component** — NOT the existing `detailModal` which requires a full `SchedulerProject`. The click handler checks `isOverlay` on the event and routes to the overlay popover instead.

**Overlay popover contents:**
- Job title
- Job type badge (e.g., "Service Visit", "Detach")
- Customer address
- Assigned technician
- Job status
- Scheduled date/time

**No actions** — no schedule, assign, confirm, or cancel buttons. Just informational.

### 7. Interaction Constraints

- Service/D&R events are **not draggable**
- Service/D&R events are **not selectable** for scheduling actions
- They do not appear in the project sidebar list
- They do not count toward revenue buckets or capacity metrics
- They are excluded from CSV and iCal exports

### 8. Data Pipeline Integration

Overlay events are merged at the `displayEvents` level — alongside forecast ghosts — NOT injected into `scheduledEvents` or `filteredScheduledEvents`. This means:
- `scheduledEvents` stays HubSpot-only (existing behavior)
- `filteredScheduledEvents` stays HubSpot-only (existing behavior)
- `displayEvents = [...filteredScheduledEvents, ...forecastGhostEvents, ...overlayEvents]`
- Revenue buckets (`computeRevenueBuckets`) operate on `filteredScheduledEvents` — overlays excluded automatically
- Weekly revenue sidebar must filter out overlay events (check `isOverlay` flag)
- SSE invalidation does not apply to overlay data — Zuper data refreshes via stale time + window focus only

## Files to Modify

1. **`src/app/dashboards/scheduler/page.tsx`** — Main scheduler page:
   - Add `OverlayEvent` type and `isOverlay` type guard
   - Add collapsible sidebar state + localStorage persistence
   - Add toggle state + localStorage persistence for service/D&R
   - Add `useQuery` calls for Zuper jobs by category (enabled by toggles)
   - Add `mapZuperJobToOverlay()` mapping function using `normalizeLocation`
   - Add toggle buttons to toolbar (next to Forecasts)
   - Add read-only overlay detail popover component
   - Update click handlers: check `isOverlay` → route to overlay popover
   - Merge overlay events into `displayEvents` memo (not `scheduledEvents`)
   - Update sort maps in month/week/Gantt renderers with new priority values
   - Add overlay event rendering with dashed border + distinct colors
   - Guard drag/drop handlers against overlay events
   - Exclude overlay events from CSV/iCal export

2. **No new API endpoints** — reuses existing `/api/zuper/jobs/by-category`

3. **No database changes** — all state is client-side (localStorage + Zuper API)

## Out of Scope

- Scheduling service/D&R jobs from the master scheduler
- Drag-and-drop for overlay events
- Including overlay events in revenue/capacity metrics
- Creating new API endpoints
- Syncing overlay toggle state across devices (localStorage only)
- SSE real-time invalidation for overlay data (uses stale time + refetchOnWindowFocus only)
- Adding "Service" / "D&R" to the `calendarScheduleTypes` filter pills (overlays are controlled solely by their toggle buttons)
