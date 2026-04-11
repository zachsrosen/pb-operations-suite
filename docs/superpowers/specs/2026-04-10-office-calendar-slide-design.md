# Office Calendar Carousel Slide — Design Spec

**Date**: 2026-04-10
**Requested by**: David Raichart (Owner)
**Status**: Draft

---

## Overview

Add a new **Calendar** slide to the per-location office-performance TV carousel. The slide shows a full-month read-only calendar with all scheduled events for that location — surveys, installs, inspections, roofing, D&R, and service jobs — mirroring the master scheduler's data.

Appears on every location's carousel (Westminster, Centennial, Colorado Springs, San Luis Obispo, Camarillo).

---

## Layout

### Header

- **Month & Year** (e.g., "April 2026")
- **Summary counts**: "12 Surveys · 8 Installs · 5 Inspections" — one count per event type with colored dots matching the event colors

### Month Grid

Standard 7-column calendar (Sun–Sat), 5-6 rows depending on the month.

**Day cell structure:**

```
┌─ Wed 16 ───────────────────┐
│ ▌ Smith — Survey           │  ← cyan left border, customer name + type
│   John D.                  │  ← assignee (first name + last initial)
│ ▌ Jones — Install D1/3     │  ← blue, day 1 of 3-day install
│   DTC Alpha                │  ← crew name
│ +1 more                    │  ← overflow indicator
└────────────────────────────┘
```

**Day number styling:**
- Today: highlighted with accent ring/background
- Weekends: slightly dimmer text
- Days outside current month: hidden or very faint

### Multi-Day Events (Repeated Pills)

Construction installs that span multiple days render a pill in **each** day cell:

- **Day 1 cell**: Full pill with customer name + crew + "D1/3" label
- **Day 2+ cells**: Continuation pill — colored bar with "D2/3", "D3/3" labels, no customer name
- Week boundary crossings (Sat → Sun) are handled naturally since each day is independent
- Each pill counts toward that day's overflow threshold

### Event Pills

Each event is a small pill with a colored left border:

| Element | Content |
|---|---|
| **Line 1** | Customer name + event type label (e.g., "Smith — Survey") |
| **Line 2** | Assignee name (first name + last initial) or crew name |

**Overflow**: If a day has more events than fit (threshold: 3-4 visible), show "+N more" in muted text.

### Legend

Bottom of the slide, a horizontal row of color swatches with labels:

`● Survey  ● Install  ● Inspection  ● RTB  ● Blocked  ● Service  ● D&R`

---

## Event Types & Colors

Matches the master scheduler's color scheme exactly:

| Event Type | Left Border Color | Background | Text Color |
|---|---|---|---|
| **Survey** | `cyan-500` (#06b6d4) | `bg-cyan-500/15` | `text-cyan-300` |
| **Install** | `blue-500` (#3b82f6) | `bg-blue-500/15` | `text-blue-300` |
| **Inspection** | `violet-500` (#8b5cf6) | `bg-violet-500/15` | `text-violet-300` |
| **RTB** | `emerald-500` (#10b981) | `bg-emerald-500/15` | `text-emerald-300` |
| **Blocked** | `yellow-500` (#eab308) | `bg-yellow-500/15` | `text-yellow-300` |
| **Service** | `purple-500` (#a855f7) | `bg-purple-500/15` | `text-purple-300` |
| **D&R** | `amber-500` (#f59e0b) | `bg-amber-500/15` | `text-amber-300` |

**Completed events**: Same color at 30% opacity, text at 70% opacity (faded).

**Overdue events**: Full color at 60% opacity + `ring-2 ring-red-500`.

**Failed inspections**: `bg-amber-900/70 text-amber-200 ring-1 ring-amber-500` + line-through on name.

---

## Data Source

### API

Combines two existing endpoints (no new API route needed):

1. `/api/projects?context=scheduling` — surveys, installs, inspections, RTB, blocked
2. `/api/zuper/jobs/by-category` — service and D&R jobs from Zuper (two calls, same endpoint the master scheduler uses)

Both are fetched client-side. The component merges results into a unified `CalendarEvent[]` and filters by location.

**Zuper fetch details** — The `/api/zuper/jobs/by-category` route accepts `categories` (comma-separated UIDs), `from_date`, and `to_date` query params. The component makes two calls matching the master scheduler pattern (`scheduler/page.tsx` lines 1106-1138):

```
Service:  /api/zuper/jobs/by-category?categories=SERVICE_CATEGORY_UIDS&from_date=...&to_date=...
D&R:      /api/zuper/jobs/by-category?categories=DNR_CATEGORY_UIDS&from_date=...&to_date=...
```

Category UIDs from `src/lib/zuper.ts` `JOB_CATEGORY_UIDS`:
- **Service**: `SERVICE_VISIT` + `SERVICE_REVISIT`
- **D&R**: `DETACH` + `RESET` + `DNR_INSPECTION`

Date range: first day of current month → last day of current month.

### Event Generation

Follows the same logic as the master scheduler (`src/app/dashboards/scheduler/page.tsx` lines 1473-1612):

For each project where `pbLocation` matches the current carousel location:

1. **Survey event** — if `siteSurveyScheduleDate` exists
   - `eventType`: `"survey"` or `"survey-complete"` if `siteSurveyCompletionDate` exists
   - `days`: 1
   
2. **Construction event** — if `constructionScheduleDate` exists (or Zuper-matched construction job has a start date)
   - **Date priority**: Prefer Zuper job `startDate` (from matched construction-category job) over HubSpot `constructionScheduleDate`. The master scheduler normalizes Zuper dates and uses them when available (see `normalizedZuperDates.startDate` in scheduler lines 1506-1514).
   - `eventType`: `"construction"` or `"construction-complete"` if `constructionCompleteDate` exists
   - `days`: from project's `expectedDaysForInstall` or `daysForInstallers`, default 1
   
3. **Inspection event** — if `inspectionScheduleDate` exists
   - `eventType`: `"inspection"`, `"inspection-pass"`, or `"inspection-fail"`
   - `days`: 1
   
4. **RTB/Blocked fallback** — if project is in RTB or Blocked stage with a `scheduleDate` but no `constructionScheduleDate`
   - `eventType`: `"rtb"` or `"blocked"`
   - `days`: from project install days, default 1

### Overdue Logic

Replicates the master scheduler's `isOverdueCheck()` exactly. Key semantics: dates are midnight-normalized, and an event is **not** overdue on its scheduled day — only the day **after**.

```
if not completed:
  normalize all dates to midnight (strip time)
  today = midnight of current day

  for construction:
    endDate = startDate + ceil(days)
    overdue if endDate < today        // overdue the day AFTER the last install day
  for others (survey, inspection):
    overdue if scheduleDate < today   // overdue the day AFTER the scheduled date
```

The shared `calendar-events.ts` utility should import or replicate the scheduler's exact overdue check to avoid off-by-one divergence.

### Customer Name Extraction

Same as master scheduler: `name.split(" | ")[1] || name` — extracts customer name from "PROJ-001 | Customer Name" format.

### Assignee Display

- **Construction**: Show `installCrew` (e.g., "DTC Alpha", "WESTY Bravo")
- **Survey/Inspection**: Show assignee from project data if available, otherwise omit
- **Service/D&R**: Show `assignedUser` or `teamName` from Zuper job data
- **Format**: First name + last initial (e.g., "John D.") when showing individual names

### Location Filtering

Filter projects by `pbLocation` matching the canonical location name for the current carousel page. Uses the same `normalizeLocation()` function from `@/lib/locations`.

For Zuper jobs: filter by `city`/`state` or `teamName` prefix matching the location (same heuristic the master scheduler's Zuper overlay uses).

---

## Architecture

### No New API Route

Unlike the goals-pipeline slide, this slide does NOT need a new server-side data fetcher or API route. It combines two existing endpoints (see Data Source above). Both are fetched client-side. The component merges results into a unified `CalendarEvent[]` and filters by location.

### New Component: `CalendarSection.tsx`

Single new file: `src/app/dashboards/office-performance/[location]/CalendarSection.tsx`

**Responsibilities:**
- Fetch project data via `useQuery` to `/api/projects?context=scheduling`
- Fetch Zuper service/D&R jobs via two `useQuery` calls to `/api/zuper/jobs/by-category` (one for service UIDs, one for D&R UIDs)
- Filter all data by location matching current carousel location
- Transform projects + Zuper jobs into unified `CalendarEvent[]` (same logic as master scheduler)
- Render month grid with event pills
- Handle multi-day event repetition across day cells

**Props:**
```typescript
interface CalendarSectionProps {
  location: string;  // Canonical location name (e.g., "Westminster")
}
```

### Event Generation Utility

Extract the event generation logic into a shared utility rather than duplicating the master scheduler's inline logic:

New file: `src/lib/calendar-events.ts`

```typescript
interface CalendarEvent {
  id: string;            // project ID + event type for uniqueness
  projectId: string;
  name: string;          // Customer name (extracted from project name)
  date: string;          // YYYY-MM-DD start date
  days: number;          // Duration (1 for surveys/inspections, N for construction)
  eventType: "survey" | "construction" | "inspection" | "rtb" | "blocked" | "service" | "dnr" | "survey-complete" | "construction-complete" | "inspection-pass" | "inspection-fail";
  assignee: string;      // Crew name or individual assignee
  isCompleted: boolean;
  isOverdue: boolean;
  isFailed: boolean;
  amount: number;        // Deal revenue
}

export function generateCalendarEvents(projects: Project[]): CalendarEvent[];
export function generateZuperCalendarEvents(jobs: ZuperJob[], type: "service" | "dnr"): CalendarEvent[];
export function getCustomerName(fullName: string): string;
export function formatAssignee(project: Project, eventType: string): string;
```

### Carousel Integration

Add to `office-performance-types.ts`:
- `"calendar"` added to `CarouselSection` type union
- Entry in `CAROUSEL_SECTIONS` array (after "pipeline", before "surveys")
- Entry in `SECTION_COLORS` — `"#14b8a6"` (teal, distinct calendar accent)
- Entry in `SECTION_LABELS` — `"CALENDAR"`

Add to `OfficeCarousel.tsx`:
- Import `CalendarSection`
- Add `"calendar"` case to `renderSection()`

### Query Keys

The calendar component has its own query keys — it does **not** share cache with the master scheduler (which uses `["scheduler", "main-projects"]`). This is intentional: the carousel runs on separate TV pages and should manage its own refetch/stale lifecycle.

Add to `src/lib/query-keys.ts`:

```typescript
officeCalendar: {
  root: ["office-calendar"] as const,
  projects: (location: string) =>
    [...queryKeys.officeCalendar.root, "projects", location] as const,
  serviceJobs: (location: string) =>
    [...queryKeys.officeCalendar.root, "service-jobs", location] as const,
  dnrJobs: (location: string) =>
    [...queryKeys.officeCalendar.root, "dnr-jobs", location] as const,
},
```

---

## Month Grid Rendering

### Grid Structure

CSS Grid with 7 columns. Each row represents a week.

```
grid-template-columns: repeat(7, 1fr)
```

Day cells have:
- Fixed minimum height to maintain grid structure
- Overflow hidden with "+N more" indicator
- Day number top-left, events stacked below

### Multi-Day Events

Multi-day construction events use a **per-day repeat** strategy rather than CSS grid spanning. Each day of a multi-day event gets its own pill inside that day's cell:

- **Day 1**: Full pill with customer name + crew — labeled "D1/3" (or "D1/2", etc.)
- **Day 2+**: Continuation pill — colored bar with "D2/3" label, no customer name
- **Last day**: "D3/3" label

This approach is chosen because:
1. Day cells use `overflow: hidden` for the "+N more" indicator — a spanning element inside one cell cannot cross into sibling cells without breaking this
2. Multi-day events that cross week boundaries (Sat → Sun) would require splitting anyway
3. Per-day repeat keeps each cell self-contained, making stacking and overflow counting straightforward

### Event Stacking

Within a single day cell:
- Events stack vertically in chronological order
- Maximum 3-4 visible events per cell (dependent on cell height at render time)
- Overflow shows "+N more" counter in muted text at bottom of cell

---

## Resolved Questions

1. **Service & D&R data** — **Include them.** The component makes two additional fetches to `/api/zuper/jobs/by-category` (one for service category UIDs, one for D&R category UIDs — same pattern as the master scheduler) and merges those into the calendar events alongside project-pipeline events. The legend shows all 7 event types. Service/D&R jobs use Zuper job data (customer name from job, technician/crew from assignment) rather than HubSpot project data.

2. **Month navigation** — **Current month only.** The slide always shows the current calendar month. No month navigation — this is a TV carousel with no user interaction during auto-rotation.

3. **Carousel position** — **After Pipeline, before Surveys.** The section order in `CAROUSEL_SECTIONS` becomes: `teamResults → goals → pipeline → calendar → surveys → installs → inspections → allLocations`.
