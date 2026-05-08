# Crew Schedule Dashboard

**Date:** 2026-05-07
**Status:** Draft

## Purpose

A read-only dashboard showing where each crew member is working on every day. Ops managers and schedulers currently have to check 7 separate scheduler pages to get the full picture. This view consolidates all crew assignments into one place with two interchangeable view modes.

## Data Sources

**Primary — ScheduleRecord table:**
The canonical source for crew assignments. Each row represents a scheduled assignment with:
- `assignedUser` / `assignedUserUid` — who (nullable — skip records where `assignedUser IS NULL`)
- `scheduledDate` / `scheduledDays` / `scheduledStart` / `scheduledEnd` — when
- `scheduleType` — job type (currently: `"survey"`, `"construction"`, `"inspection"` only)
- `projectId` / `projectName` — deal reference (project name includes proj number, address, customer)
- `status` — scheduled, completed, cancelled, rescheduled

**Note:** ScheduleRecord only covers survey, construction, and inspection types. Service, D&R, and roofing jobs are managed through Zuper/BookedSlot and do not create ScheduleRecords.

**Secondary — BookedSlot table:**
Time-slot-level bookings with `date`, `startTime`, `endTime`, `userName`, `location`, `projectId`, `projectName`. BookedSlot has no `scheduleType` field — job type must be inferred from the booking source or project context (see Job Type Resolution below).

**Supplementary — HubSpot project data:**
Deal value (`amount`) and PB location (`pbLocation`) are not stored on ScheduleRecord/BookedSlot. The API must resolve these from HubSpot project cache or the projects API.

**Crew roster — CrewMember table:**
Active crew members with `name`, `role`, `locations[]`, `teamName`, `isActive`.

## Data Model

No new Prisma models required. The API composes existing tables:

```
CrewMember (roster)
  + ScheduleRecord (assignments by assignedUser + date range)
  + BookedSlot (time slots by userName + date range)
  + HubSpotProjectCache or /api/projects (deal value, PB location)
```

### Merged Assignment Shape

The API returns a unified shape regardless of source:

```ts
interface CrewAssignment {
  id: string;                    // ScheduleRecord.id or BookedSlot.id
  source: "schedule" | "slot";   // which table it came from
  crewMemberName: string;
  date: string;                  // YYYY-MM-DD
  startTime: string | null;      // HH:mm
  endTime: string | null;        // HH:mm
  jobType: string;               // survey, construction, inspection, service, dnr, roofing
  pbLocation: string | null;     // DTC, Westminster, Colorado Springs, SLO, Camarillo (null if unresolvable)
  projectId: string;             // HubSpot deal ID
  projectName: string;           // includes proj#, address, customer
  dealValue: number | null;      // from HubSpot
  status: string;                // scheduled, completed, cancelled, rescheduled
  schedulerPath: string;         // link to relevant scheduler dashboard
}
```

### Deduplication

When both a ScheduleRecord and BookedSlot exist for the same `(userName, date, projectId)`, prefer ScheduleRecord (richer data). Deduplicate by that triple.

### Job Type Resolution

For `ScheduleRecord`-sourced assignments, `jobType` comes directly from `scheduleType` (survey, construction, inspection).

For `BookedSlot`-sourced assignments (which lack a `scheduleType` field), resolve job type via:
1. Check if a matching `ScheduleRecord` exists for the same `(projectId)` — use its `scheduleType`
2. Fall back to the crew member's `role` field: surveyor → survey, technician → construction, inspector → inspection, roofer → roofing, electrician → construction
3. If neither resolves, default to `"unknown"`

### Location Resolution

`pbLocation` resolution chain:
1. `BookedSlot.location` (if source is BookedSlot)
2. `HubSpotProjectCache.pbLocation` (batch lookup by `projectId`)
3. Crew member's primary location (`locations[0]`) as fallback
4. `null` if none resolve

When grouping by location, assignments with `pbLocation: null` appear under an "Other" group.

### Scheduler Link Resolution

Map `jobType` → dashboard path:
- survey → `/dashboards/site-survey-scheduler`
- construction / installation → `/dashboards/construction-scheduler`
- inspection → `/dashboards/inspection-scheduler`
- service → `/dashboards/service-scheduler`
- dnr → `/dashboards/dnr-scheduler`
- roofing → `/dashboards/roofing-scheduler`
- unknown → `/dashboards/scheduler` (master schedule fallback)

## API

### `GET /api/crew-schedule`

**Query params:**
- `startDate` (required) — YYYY-MM-DD, inclusive start of range
- `endDate` (required) — YYYY-MM-DD, inclusive end of range

**Response:**
```json
{
  "crew": [
    {
      "id": "cuid",
      "name": "Drew Perry",
      "role": "surveyor",
      "locations": ["DTC", "Centennial"],
      "teamName": "Godzilla"
    }
  ],
  "assignments": [
    {
      "id": "cuid",
      "source": "schedule",
      "crewMemberName": "Drew Perry",
      "date": "2026-05-07",
      "startTime": "08:00",
      "endTime": "12:00",
      "jobType": "survey",
      "pbLocation": "DTC",
      "projectId": "12345",
      "projectName": "PB-2345 | 123 Main St | Smith",
      "dealValue": 45000,
      "status": "scheduled",
      "schedulerPath": "/dashboards/site-survey-scheduler"
    }
  ],
  "dateRange": { "start": "2026-05-05", "end": "2026-05-09" }
}
```

**Logic:**
1. Fetch active CrewMembers (`isActive: true`)
2. Query ScheduleRecords where `scheduledDate` is in range AND `status NOT IN ('cancelled', 'rescheduled')` AND `assignedUser IS NOT NULL`
3. Query BookedSlots where `date` is in range
4. Deduplicate by `(crewName, date, projectId)` — normalize crew name from `ScheduleRecord.assignedUser` and `BookedSlot.userName`; prefer ScheduleRecord when both exist
5. Collect unique `projectId` values, batch-resolve deal values + `pbLocation` from `HubSpotProjectCache` via single `findMany({ where: { dealId: { in: projectIds } } })` — fall back to null if missing
6. Apply location resolution chain (see Location Resolution above)
7. Apply job type resolution (see Job Type Resolution above)
8. Expand multi-day jobs: use `getBusinessDatesInSpan()` from `scheduling-utils.ts` to generate one assignment entry per business day in the span (`scheduledDate` + `scheduledDays`, skipping weekends)
9. Return crew roster + merged assignments

**Caching:** React Query on client with 2-minute stale time. Add `"crew-schedule"` as a new cache key root in `query-keys.ts` with a `cacheKeyToQueryKeys` entry. Invalidate on the same upstream keys that schedulers use (e.g., `projects`, `schedule-records` if added to SSE emitters). For v1, polling via `refetchInterval: 2 * 60 * 1000` is acceptable without SSE.

**Performance:** Date range is capped at 31 days max. HubSpot cache lookups use a single batch query, not per-assignment.

## UI

### Page: `/dashboards/crew-schedule`

Wrapped in `<DashboardShell title="Crew Schedule" accentColor="blue" fullWidth>`.

### Header Controls

- **Date navigation:** Left/right arrows to shift by one period. "Today" button to reset.
- **Period selector:** Week (default) · 2 Weeks · Month
- **Day drill-down:** Click any day column header (grid) or day label (cards) to filter to that single day. Click again or "Back to week" to return.
- **View toggle:** Grid Table | Calendar Cards (icon toggle, persists in localStorage)
- **Group toggle:** By Location (default) | By Job Type (persists in localStorage)
- **Location filter:** Multi-select dropdown to filter to specific PB locations (defaults to all)

### Grid Table View

Spreadsheet-style layout:

| | Mon 5/5 | Tue 5/6 | Wed 5/7 | Thu 5/8 | Fri 5/9 |
|---|---|---|---|---|---|
| **Westminster** | | | | | |
| Drew Perry | PB-2345 · Survey · $45k | — | PB-2346 · Install · $62k | PB-2346 · Install · $62k | — |
| Joe Lynch | — | PB-2400 · Inspection · $38k | — | — | — |
| **DTC** | | | | | |
| ... | | | | | |

**Cell content (abbreviated):**
- Project name (truncated to ~20 chars)
- Job type badge (color-coded)
- Deal value (compact: $45k)
- Time window if present (8a–12p)

**Cell interactions:**
- Hover: tooltip with full project name, full address, time window, deal value
- Click: navigates to the relevant scheduler dashboard

**Empty cells:** Show "—" in muted text.

**Row grouping:**
- By Location: section headers for each PB location, crew members sorted alphabetically within
- By Job Type: section headers for survey, construction, inspection, service, dnr, roofing

**Today column:** Highlighted with a subtle accent background.

**Multi-day jobs:** When `scheduledDays > 1`, the assignment appears in each day's cell for the span.

### Calendar Cards View

Same date range, same grouping, but each day is rendered as a vertical column and assignments appear as stacked cards:

```
┌─────────────────────┐
│ Drew Perry          │
│ PB-2345             │
│ Survey · $45k       │
│ 8:00a – 12:00p      │
│ Westminster          │
│ [View →]            │
└─────────────────────┘
```

**Card content:**
- Crew member name (bold header)
- Project name
- Job type badge + deal value
- Time window
- PB location
- Link to scheduler

**Cards** are color-coded by job type using existing tag color conventions (blue for survey, orange for construction, etc.)

**Unassigned crew:** Crew members with no assignments for a day appear as a muted "Available" card at the bottom of their location group.

### Day Drill-Down

When a single day is selected, both views expand to show full detail:
- Full project name (no truncation)
- Full time window
- Full deal value
- PB location
- Direct link to scheduler

The grid table becomes a single-column detailed list. The calendar cards become larger with more room.

### Empty / Loading States

- **Loading:** Skeleton grid matching the selected view mode
- **No crew:** "No active crew members found"
- **No assignments in range:** Show the crew roster with all empty/available states

## Access Control

### Route Access

Add `/dashboards/crew-schedule` to `allowedRoutes` for every role that currently has access to any scheduler dashboard:
- ADMIN, EXECUTIVE — already have `*` wildcard (OWNER normalizes to EXECUTIVE)
- PROJECT_MANAGER, OPERATIONS_MANAGER, OPERATIONS, TECH_OPS, ROOFING, SALES_MANAGER — add to their allowedRoutes arrays

### Suite Nav

Add a card to the Operations suite page (`src/app/suites/operations/page.tsx`) and any other suite page that links to scheduler dashboards (Service, D&R+Roofing):
```ts
{
  href: "/dashboards/crew-schedule",
  title: "Crew Schedule",
  description: "See where every crew member is working each day.",
  tag: "SCHEDULING",
  tagColor: "blue"
}
```

### API Auth

`GET /api/crew-schedule` uses `requireApiAuth()` — same pattern as other scheduling endpoints. No additional role gating needed beyond middleware route checks.

## File Plan

```
New files:
  src/app/api/crew-schedule/route.ts          — API endpoint
  src/app/dashboards/crew-schedule/page.tsx    — Dashboard page

Modified files:
  src/lib/roles.ts                          — add /dashboards/crew-schedule to allowedRoutes for PM, OPS_MGR, OPS, TECH_OPS, ROOFING, SALES_MANAGER
  src/app/suites/operations/page.tsx        — add Crew Schedule card
  src/app/suites/service/page.tsx           — add Crew Schedule card (if service suite links schedulers)
  src/app/suites/dnr-roofing/page.tsx       — add Crew Schedule card
  src/lib/query-keys.ts                     — add crew-schedule cache key root
```

## Non-Goals

- No drag-and-drop or inline editing — this is read-only
- No Zuper job sync from this view — that happens in the individual schedulers
- No Google Calendar integration — this shows internal PB schedule data only
- No crew availability/capacity planning — that's the optimizer's job
- No mobile-optimized layout in v1 (can follow up)

## Edge Cases

- **Crew with multiple assignments on one day:** Show all assignments in the cell (stacked in grid, multiple cards in cards view)
- **Multi-day jobs:** Use `getBusinessDatesInSpan()` to expand `scheduledDate + scheduledDays` into individual business days (skips weekends). Each day gets its own assignment entry in the grid. Fractional days (e.g., 0.25 for a 2-hour survey) do NOT expand — they appear only on `scheduledDate`.
- **Crew in multiple locations:** Show under their primary location (first in `locations[]`); assignment's `pbLocation` may differ from home location. When grouping by location, the assignment appears under its `pbLocation`, not the crew member's home location.
- **Cancelled/rescheduled jobs:** Both `status = 'cancelled'` and `status = 'rescheduled'` are excluded from the query. Only the new ScheduleRecord (with `status = 'scheduled'`) for a rescheduled job is shown.
- **No deal value available:** Show "—" instead of dollar amount
- **Large month view:** Grid table may be wide; use horizontal scroll with sticky crew name column
