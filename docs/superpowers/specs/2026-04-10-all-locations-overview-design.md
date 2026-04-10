# All Locations Overview + Compliance Attribution Fix

**Date:** 2026-04-10
**Status:** Approved

Two changes that work together: a new carousel slide showing all 5 PB locations side-by-side, and a fix to how Zuper compliance attributes jobs to the correct location.

---

## 1. Compliance Attribution Fix

### Problem

Compliance scoring attributes jobs based on the **tech's Zuper team assignment**, not the **HubSpot deal's `pb_location`**. A Westminster-team tech working a Centennial deal has that job counted toward Westminster's compliance — but the deal itself shows under Centennial on the office-performance dashboard. The numbers on the same slide are talking about different sets of jobs.

This matters because techs regularly work across locations.

### Solution

Change `computeLocationCompliance()` to attribute jobs by deal location instead of tech team.

**New flow for each Zuper job:**

1. Extract `hubspot_deal_id` from the job's `custom_fields`
2. Look up that deal's `pb_location` from `ZuperJobCache` (already populated by zuper-sync)
3. If found: attribute the job to that deal's location. **All assigned techs** on the job count toward that location's compliance, regardless of their home team.
4. If not found (no deal link, cache miss): fall back to current team-based attribution

**Batch optimization:** Before the job loop, run a single Prisma query to load all `ZuperJobCache` records with `hubspotDealId` into a `Map<dealId, pbLocation>`. No per-job database queries.

### Files Changed

- **`src/lib/compliance-compute.ts`** — Core change. Replace team-based filtering with deal-location filtering + team fallback.
  - Remove `LOCATION_TEAM_FILTERS` as primary filter (keep for fallback)
  - Add `hubspot_deal_id` extraction from job custom fields (reuse `extractHubspotDealId` from zuper-sync or inline)
  - Add `ZuperJobCache` batch lookup at start of `computeLocationCompliance()`
  - Change job loop: match by deal location first, team second

- **`src/app/api/zuper/compliance/route.ts`** — Has its own copy of the scoring loop. Same deal-location attribution change.

- **`src/lib/compliance-helpers.ts`** — `extractHubspotDealId` helper may need to be exported/shared if not already accessible. The `normalizeHubspotDealIdValue()` function in zuper-sync.ts handles URL-format deal IDs.

### Edge Cases

- **No `hubspot_deal_id` on job:** Falls back to team-based (covers manually-created Zuper jobs)
- **Deal's `pb_location` is empty/null:** Falls back to team-based
- **`ZuperJobCache` miss for a deal ID:** Falls back to team-based
- **Tech appears on multiple locations:** Expected behavior — they get separate stats per location based on which deals they worked

---

## 2. All Locations Carousel Slide

### Overview

A new slide in the office-performance carousel that shows all 5 locations side-by-side. Displayed as the first slide before individual location slides cycle through.

### Route

Same `[location]` dynamic route. When location slug is `"all"`, render the `AllLocationsSection` component instead of per-location sections.

### Layout

Five-column grid, one per location. Each column stacks three category blocks:

```
| Westminster | Centennial | CO Springs | SLO       | Camarillo |
|-------------|------------|------------|-----------|-----------|
| SURVEYS     | SURVEYS    | SURVEYS    | SURVEYS   | SURVEYS   |
|  Completed  |  Completed |  Completed |  Completed|  Completed|
|  Turnaround |  Turnaround|  Turnaround|  Turnaround| Turnaround|
|  On-time %  |  On-time % |  On-time % |  On-time %|  On-time %|
|  Grade      |  Grade     |  Grade     |  Grade    |  Grade    |
|  Stuck      |  Stuck     |  Stuck     |  Stuck    |  Stuck    |
|  This Week  |  This Week |  This Week |  This Week|  This Week|
|-------------|------------|------------|-----------|-----------|
| INSTALLS    | INSTALLS   | INSTALLS   | INSTALLS  | INSTALLS  |
|  (same)     |  (same)    |  (same)    |  (same)   |  (same)   |
|-------------|------------|------------|-----------|-----------|
| INSPECTIONS | INSPECTIONS| INSPECTIONS| INSPECTIONS| INSPECTIONS|
|  (same)     |  (same)    |  (same)    |  (same)   |  (same)   |
```

### Metrics Per Location Per Category

**Surveys:**
| Metric | Source field |
|--------|-------------|
| Completed MTD | `surveys.completedMtd` |
| Avg turnaround | `surveys.avgTurnaroundDays` |
| On-time % | `surveys.compliance.onTimePercent` |
| Grade | `surveys.compliance` aggregate grade |
| Stuck | `surveys.compliance.stuckJobs.length` |
| Scheduled this week | `surveys.scheduledThisWeek` |

**Installs:**
| Metric | Source field |
|--------|-------------|
| Completed MTD | `installs.completedMtd` |
| Avg days/install | `installs.avgDaysPerInstall` |
| On-time % | `installs.compliance.onTimePercent` |
| Grade | `installs.compliance` aggregate grade |
| Stuck | `installs.compliance.stuckJobs.length` |
| Scheduled this week | `installs.scheduledThisWeek` |

**Inspections:**
| Metric | Source field |
|--------|-------------|
| Passed MTD | `inspections.completedMtd` |
| CC → Passed (days) | `inspections.avgCcToPtoDays` |
| First-pass rate | `inspections.firstPassRate` |
| On-time % | `inspections.compliance.onTimePercent` |
| Grade | `inspections.compliance` aggregate grade |
| Stuck | `inspections.compliance.stuckJobs.length` |
| Scheduled this week | `inspections.scheduledThisWeek` |

### Color Coding

- Grades: `gradeColor()` — A=green, B=blue, C=yellow, D=orange, F=red
- On-time % / first-pass rate: `onTimeColor()` — ≥90 green, ≥75 yellow, else red
- Stuck: `stuckColor()` — 0=green, ≤2=yellow, else red
- Instant visual scanning: green wall = good, any red pops out

---

## 3. Data Architecture

### New API Route: `/api/office-performance/all`

Single server route that:
1. Calls `getOfficePerformanceData()` for all 5 locations in parallel
2. Strips response to overview metrics only (no deal lists, leaderboards, per-employee breakdowns)
3. Caches assembled result with 5-minute TTL via `lib/cache.ts`

**Response shape:**
```ts
interface AllLocationsResponse {
  locations: LocationOverview[];
  lastUpdated: string;
}

interface LocationOverview {
  location: string;
  surveys: CategoryOverview;
  installs: CategoryOverview & { kwInstalledMtd: number };
  inspections: CategoryOverview & {
    firstPassRate: number;
    avgCcToPtoDays: number;
  };
}

interface CategoryOverview {
  completedMtd: number;
  avgDays: number; // turnaround for surveys, days/install, CC→passed
  scheduledThisWeek: number;
  onTimePercent: number;
  grade: string;
  stuckCount: number;
}
```

### Carousel Integration

- `"all"` added as a URL slug in the location mapping
- Prepended to the carousel's location rotation list
- `AllLocationsSection.tsx` renders when slug = `"all"`
- No changes to existing per-location sections

### Files Created/Changed

- **`src/app/dashboards/office-performance/[location]/AllLocationsSection.tsx`** — New component
- **`src/app/api/office-performance/all/route.ts`** — New API route
- **`src/lib/office-performance-types.ts`** — Add `AllLocationsResponse`, `LocationOverview`, `CategoryOverview` types
- **`src/app/dashboards/office-performance/[location]/page.tsx`** — Handle `"all"` slug

---

## Implementation Order

1. Compliance attribution fix (changes scoring for all consumers)
2. All locations API route + types
3. All locations carousel slide component
4. Wire into carousel rotation
5. Verify on TV
