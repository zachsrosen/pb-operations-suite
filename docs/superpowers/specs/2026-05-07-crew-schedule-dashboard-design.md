# Crew Schedule Dashboard

**Date:** 2026-05-07
**Status:** Draft

## Purpose

A read-only dashboard showing where each crew member is working on every day. Ops managers and schedulers currently have to check 7 separate scheduler pages to get the full picture. This view consolidates all crew assignments into one place with two interchangeable view modes.

## Data Sources

**Primary — ScheduleRecord table:**
The canonical source for crew assignments. Each row represents a scheduled assignment with:
- `assignedUser` / `assignedUserUid` — who
- `scheduledDate` / `scheduledDays` / `scheduledStart` / `scheduledEnd` — when
- `scheduleType` — job type (survey, construction, inspection)
- `projectId` / `projectName` — deal reference (project name includes proj number, address, customer)
- `status` — scheduled, completed, cancelled, rescheduled

**Secondary — BookedSlot table:**
Time-slot-level bookings with `date`, `startTime`, `endTime`, `userName`, `location`, `projectId`, `projectName`. Used to fill gaps where ScheduleRecord doesn't have time windows.

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
  pbLocation: string;            // DTC, Westminster, Colorado Springs, SLO, Camarillo
  projectId: string;             // HubSpot deal ID
  projectName: string;           // includes proj#, address, customer
  dealValue: number | null;      // from HubSpot
  status: string;                // scheduled, completed, cancelled, rescheduled
  schedulerPath: string;         // link to relevant scheduler dashboard
}
```

### Deduplication

When both a ScheduleRecord and BookedSlot exist for the same `(userName, date, projectId)`, prefer ScheduleRecord (richer data). Deduplicate by that triple.

### Scheduler Link Resolution

Map `scheduleType` → dashboard path:
- survey → `/dashboards/site-survey-scheduler`
- construction / installation → `/dashboards/construction-scheduler`
- inspection → `/dashboards/inspection-scheduler`
- service → `/dashboards/service-scheduler`
- dnr → `/dashboards/dnr-scheduler`
- roofing → `/dashboards/roofing-scheduler`

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
2. Query ScheduleRecords where `scheduledDate` is in range AND `status != 'cancelled'`
3. Query BookedSlots where `date` is in range
4. Deduplicate by `(userName, date, projectId)` — prefer ScheduleRecord
5. Batch-resolve deal values from HubSpotProjectCache (fall back to null if missing)
6. Resolve `pbLocation` from BookedSlot.location or HubSpotProjectCache
7. Return crew roster + merged assignments

**Caching:** React Query on client with 2-minute stale time. SSE invalidation on `schedule-records` cache key.

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
- ADMIN, OWNER — already have `*` wildcard
- PROJECT_MANAGER, OPERATIONS_MANAGER, OPERATIONS, TECH_OPS — add to their allowedRoutes arrays

### Suite Nav

Add a card in the Operations suite (and any other suite that links to scheduler pages):
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
  src/lib/roles.ts        — add /dashboards/crew-schedule to allowedRoutes
  src/lib/suite-nav.ts    — add card to Operations suite (and others with scheduler links)
```

## Non-Goals

- No drag-and-drop or inline editing — this is read-only
- No Zuper job sync from this view — that happens in the individual schedulers
- No Google Calendar integration — this shows internal PB schedule data only
- No crew availability/capacity planning — that's the optimizer's job
- No mobile-optimized layout in v1 (can follow up)

## Edge Cases

- **Crew with multiple assignments on one day:** Show all assignments in the cell (stacked in grid, multiple cards in cards view)
- **Multi-day jobs:** Repeat the assignment in each day's cell across the span
- **Crew in multiple locations:** Show under their primary location (first in `locations[]`); assignment's `pbLocation` may differ from home location
- **Cancelled/rescheduled jobs:** Filtered out by default (`status != 'cancelled'`). Rescheduled shows only the new date.
- **No deal value available:** Show "—" instead of dollar amount
- **Large month view:** Grid table may be wide; use horizontal scroll with sticky crew name column
