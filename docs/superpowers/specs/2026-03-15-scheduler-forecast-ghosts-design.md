# Scheduler Forecast Ghost Events — Design Spec

Show forecasted install dates as ghost events on the master schedule calendar, giving the scheduling team visibility into predicted install occupancy before projects are formally scheduled.

## Context

The master schedule (`src/app/dashboards/scheduler/page.tsx`) shows actual scheduled events (construction, survey, inspection) from HubSpot and Zuper across calendar, week, and Gantt views. The forecasting engine (`src/lib/forecasting.ts`) already produces per-project install forecasts using QC-driven segment medians, and `TransformedProject` carries `forecast_install` — consumed by the PE, Revenue, At-Risk, and Forecast Timeline dashboards. But the scheduler has no forecast integration today.

## Architecture

### Data source

Fetch from the existing `/api/forecasting/timeline` endpoint. No new API routes needed.

### Query strategy

- React Query key: `["scheduler", "forecasts"]`
- **Conditional fetch**: `enabled: showForecasts` — when the toggle is off, no request is made
- **Synchronized refresh**: uses the same `refetchInterval` and SSE invalidation as the main `["scheduler", "main-projects"]` query so ghost events stay in sync with real events
- **Stale time**: matches the main scheduler query, not the timeline dashboard's independent 5-minute window

### Join strategy

Forecast data is joined onto the scheduler's existing `projects` array by matching `timelineProject.dealId` to `String(schedulerProject.id)`. This gives ghost events access to the full `SchedulerProject` shape: `name`, `location`, `amount`, `daysInstall`, crew fields, etc.

### Ghost event construction

For each matched project, build a full `ScheduledEvent` object:

| Field | Source |
|-------|--------|
| `eventType` | `"construction"` (reuses existing type) |
| `isForecast` | `true` (new boolean flag on `ScheduledEvent`) |
| `date` | `milestones.find(m => m.key === "install" && m.basis !== "actual" && m.basis !== "insufficient")?.liveForecast` |
| `days` | `project.daysInstall` (per-project duration), fallback `3` |
| All other fields | From the matched `SchedulerProject` |

### Eligibility filter (which projects get ghost events)

A project gets a ghost install event when ALL of these are true:

1. **Pre-construction stage**: the scheduler project has no real construction event generated (uses the scheduler's normalized stage values, not raw HubSpot labels)
2. **No `constructionScheduleDate`** set on the project
3. **No manual/tentative schedule** in `manualSchedules` state for the same project
4. **No active Zuper construction job** (`zuperJobCategory !== "construction"`)
5. **Forecast available**: the timeline response has a `liveForecast` date for the `install` milestone with `basis !== "actual"` and `basis !== "insufficient"`

This prevents duplicate events where a project already has a real or tentative schedule.

### Injection point

Ghost events are concatenated **after** `filteredScheduledEvents` is computed from `scheduledEvents`. They bypass the `seenKeys` deduplication in `scheduledEvents` entirely — the eligibility filter above is the sole deduplication mechanism for ghosts. This is intentional: ghost events are a separate layer controlled by the toggle, not part of the core event pipeline.

The merge happens in a new `useMemo` that combines `filteredScheduledEvents` + `forecastEvents` (when toggle is on) into a `displayEvents` array. All three views (month, week, Gantt) read from `displayEvents` instead of `filteredScheduledEvents` directly.

**Revenue memos stay on `filteredScheduledEvents`**: `weeklyRevenueSummary` and `monthlyRevenueSummary` continue to read from `filteredScheduledEvents` (not `displayEvents`). This naturally excludes ghost events from revenue calculations without any additional `!e.isForecast` guard in those memos. Only `computeRevenueBuckets` needs the explicit gate as a safety net.

## Rendering

### Visual treatment (all three views)

- **Dashed border**: `border-dashed` on the event pill
- **Reduced opacity**: `opacity-60`
- **`FORECAST` badge**: small inline badge on the pill label (e.g., `"Turner FORECAST"`) — fits the existing customer-name label model
- **Tooltip**: `"Forecasted install — not yet scheduled"` (replaces the existing title string for forecast events)

### Calendar filter interaction

Forecast ghosts reuse `eventType: "construction"`, so they flow through existing stage filters naturally. Additional rules:

- Ghost events have neither `isCompleted` nor `isOverdue` set, so they are naturally hidden when `showScheduled` is off (the existing filter already excludes non-completed, non-overdue events). This is intentional — ghost events are a scheduling-layer concern and should disappear alongside real scheduled events. No special `isForecast` logic needed for this filter.
- Respect location and other active calendar filters
- The summary chip count reflects forecast events visible after all calendar filters are applied

### Sort order

Forecast events use the same construction sort priority. On the same day, forecast events sort **after** real construction events (secondary sort: `isForecast` last).

### Click behavior

- Forecast events **are clickable** for read-only context
- Add a **separate** `detailModalEvent` state (`ScheduledEvent | null`) alongside the existing `detailModal` (`SchedulerProject | null`). This avoids refactoring all 15+ `detailModal.X` references in the modal JSX. The three view click handlers set both: `setDetailModal(project); setDetailModalEvent(ev);`
- When `detailModalEvent?.isForecast === true`, the modal:
  - Shows forecast metadata: predicted date, forecast basis, variance
  - Displays a "Not yet scheduled" state
  - **Suppresses**: "Remove from Schedule", "Reschedule", and Zuper sync actions

### Exclusion rules

| Behavior | Forecast events |
|----------|----------------|
| Revenue counting | **Excluded** — `computeRevenueBuckets` adds `&& !e.isForecast` to its construction filter. `queueRevenue` (project-based sum) is unaffected since ghosts are events, not projects. |
| Drag/drop | **Disabled** — month view drag handlers gate on `!event.isForecast`. Week view has no drag support. Gantt drag (if any) also gates. |
| Zuper sync | **No** — forecast events never trigger job creation/updates |
| Export/CSV | **Included** — marked as `type: "forecast"` in export rows |

## Toggle UX

### Toolbar button

- **Label**: "Forecasts" with a dashed-circle icon
- **Position**: in the scheduler toolbar alongside existing view switcher and filter controls
- **Default state**: off
- **Persistence**: `localStorage` key `scheduler-show-forecasts`

### Summary chip

When the toggle is on, display `"N forecasted installs"` next to the toggle. The count reflects forecast events visible after all calendar filters (location, schedule type, date window) are applied — so the chip agrees with the visible grid.

## Files touched

| File | Change |
|------|--------|
| `src/app/dashboards/scheduler/page.tsx` | Add `isForecast` to `ScheduledEvent`, toggle state, forecast query, ghost event builder, rendering gates across month/week/Gantt views, modal context expansion |
| `src/app/api/forecasting/timeline/route.ts` | No changes (existing API) |
| `src/lib/forecasting.ts` | No changes (existing engine) |

## Testing

- **Unit**: ghost event builder produces valid `ScheduledEvent` objects from joined data
- **Unit**: eligibility filter correctly excludes projects with real schedules, tentative schedules, and Zuper jobs
- **Unit**: revenue aggregation skips `isForecast` events
- **Integration**: toggle on → forecast query fires; toggle off → no fetch
- **Visual**: ghost events render with dashed borders, reduced opacity, and FORECAST badge
- **Visual**: clicking a ghost event opens modal in read-only mode without schedule actions

## Out of scope

- Forecasting other milestones on the calendar (survey, inspection) — install only for now
- Forecast confidence intervals or range display
- Auto-scheduling from forecast dates
