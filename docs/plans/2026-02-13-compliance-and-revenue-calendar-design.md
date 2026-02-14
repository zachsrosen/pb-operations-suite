# Zuper Compliance Dashboard & Executive Revenue Calendar

**Date**: 2026-02-13
**Status**: Approved

## Feature 1: Zuper Compliance Dashboard

### Purpose
Per-user accountability metrics for Zuper field service job status updates. Tracks on-time completion, stale jobs, and never-started jobs to surface who's keeping their statuses current.

### API: `/api/zuper/compliance`

**Data source**: Zuper API only (no HubSpot needed)

**Flow**:
1. Fetch jobs across all field categories (Site Survey, Construction, Inspection, D&R, Service) for configurable date range (default 30d)
2. Group by `assigned_to` user
3. Compute per-user metrics:
   - **On-time %** — `completed_time <= scheduled_end_time` (1-day grace)
   - **Late completions** — completed after scheduled end
   - **Stale jobs** — currently "On Our Way" or "Started" with `scheduled_end_time` passed
   - **Never started** — scheduled in past, still "New"/"Scheduled"/"Unassigned"
   - **Avg days to complete** — `scheduled_start_time` → `completed_time`
   - **Total jobs by category**
   - **Compliance grade** — A (90%+), B (75%+), C (60%+), D (45%+), F (<45%)

**Grade formula** (weighted score):
- 50%: on-time completion rate
- 30%: inverse stale rate (1 - stale/total)
- 20%: inverse never-started rate (1 - neverStarted/total)

### Page: `/dashboards/zuper-compliance`

- `DashboardShell` accentColor="red"
- Date range picker: 7d / 14d / 30d / 60d / 90d
- Filters: team, category
- **Top stat cards**: total jobs, overall on-time %, total stale, total never-started, avg completion days
- **User scorecard table**: User | Team | Total Jobs | On-Time % | Late | Stale | Never Started | Avg Days | Grade
  - Sortable, color-coded grades (green A/B, yellow C, red D/F)
  - Click row → expand per-category breakdown
- **Stale jobs list**: all currently-stuck jobs with Zuper links

---

## Feature 2: Executive Revenue Calendar

### Purpose
Monthly calendar showing daily revenue throughput from scheduled field work. Shows deal values for construction, detach, reset, and service jobs.

### API: `/api/zuper/revenue-calendar`

**Data sources**: Zuper (jobs) + HubSpot (deal amounts)

**Flow**:
1. Fetch Zuper jobs for Construction, Detach, Reset, Service Visit categories for the target month (±1 week buffer)
2. Extract `hubspot-{dealId}` tags → batch-fetch HubSpot deals for `amount` + `dealname`
3. Build per-day aggregates and individual job entries

**Response shape**:
```typescript
{
  dailyTotals: Record<string, {
    totalValue: number,
    construction: { count: number, value: number },
    detach: { count: number, value: number },
    reset: { count: number, value: number },
    service: { count: number, value: number },
  }>,
  jobs: CalendarJob[],
  monthTotals: { totalValue, totalJobs, byCategory },
  lastUpdated: string
}
```

### Page: `/dashboards/executive-calendar`

- `DashboardShell` accentColor="green"
- Month navigation (prev/next, month/year display)
- Filters: location/team, category

**Layout**:
- **Top stat cards**: Total Revenue Scheduled | Construction $ | D&R $ | Service $ | Total Jobs
- **Monthly calendar grid**: 7-col (Sun-Sat)
  - Each day: bold dollar total, colored category dots, job count
  - Click day → detail panel with job list (project, category, value, crew, status, Zuper link)
  - Today highlighted with accent border
- **Weekly revenue bar chart**: stacked bars by category per week

**Category colors**:
- Construction: blue-500
- Detach: purple-500
- Reset: orange-500
- Service: emerald-500
