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
- `from_date` / `to_date` derived from the current calendar view window (month start/end, week start/end, or Gantt range)
- Stale time: 2 minutes (matches existing scheduler patterns)
- Refetch on window focus

### 4. Event Mapping

Zuper jobs are mapped into the existing `ScheduledEvent`-compatible shape used by the calendar renderer.

**Mapped fields:**
| Zuper field | Calendar event field |
|-------------|---------------------|
| `job_title` | `title` |
| `scheduled_start_time` or `due_date` | `date` |
| `scheduled_end_time` | `endDate` (if present) |
| `current_job_status` | `status` |
| `assigned_to[0].first_name + last_name` | `assignee` |
| Job category name | `eventSubtype` (e.g., "Service Visit", "Detach") |
| Customer address from job | `address` |

**Additional flags on mapped events:**
- `isReadOnly: true` — prevents drag/drop and scheduling actions
- `isService: true` or `isDnr: true` — for styling and filtering
- `eventType: "service"` or `"dnr"` — for the calendar filter system

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

**Location filtering:** Service and D&R events respect the existing `calendarLocations` multi-select filter. Location is derived from the Zuper job's team assignment or address.

### 6. Click / Detail Popover

Clicking a service or D&R event opens a **read-only detail popover** (not the scheduling modal):

**Contents:**
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
- They are excluded from CSV export (unless we decide otherwise later)

## Files to Modify

1. **`src/app/dashboards/scheduler/page.tsx`** — Main scheduler page:
   - Add toggle state + localStorage persistence for service/D&R
   - Add `useQuery` calls for Zuper jobs by category
   - Add event mapping logic
   - Add toggle buttons to toolbar
   - Add read-only detail popover
   - Implement collapsible sidebar
   - Update `filteredScheduledEvents` to include/exclude overlays

2. **No new API endpoints** — reuses existing `/api/zuper/jobs/by-category`

3. **No database changes** — all state is client-side (localStorage + Zuper API)

## Out of Scope

- Scheduling service/D&R jobs from the master scheduler
- Drag-and-drop for overlay events
- Including overlay events in revenue/capacity metrics
- Creating new API endpoints
- Syncing overlay toggle state across devices (localStorage only)
