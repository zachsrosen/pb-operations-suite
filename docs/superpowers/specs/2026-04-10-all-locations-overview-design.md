# All Locations Overview + Compliance Attribution Fix

**Date:** 2026-04-10
**Status:** Approved

Two changes that work together: a new standalone page at `/office-performance/all` showing all 5 PB locations side-by-side, and a fix to how Zuper compliance attributes jobs to the correct location.

---

## 1. Compliance Attribution Fix

### Problem

Compliance scoring attributes jobs based on the **tech's Zuper team assignment**, not the **HubSpot deal's `pb_location`**. A Westminster-team tech working a Centennial deal has that job counted toward Westminster's compliance — but the deal itself shows under Centennial on the office-performance dashboard. The numbers on the same slide are talking about different sets of jobs.

This matters because techs regularly work across locations.

### Solution

Change `computeLocationCompliance()` to attribute jobs by deal location instead of tech team.

**New flow for each Zuper job:**

1. Extract `hubspot_deal_id` from the job's `custom_fields` (reuse `extractHubspotDealId` logic from zuper-sync, including URL-format normalization)
2. Look up that deal's `pb_location` from **`HubSpotProjectCache`** (which has a `pbLocation` column indexed by `dealId`)
3. Normalize the location via `normalizeLocation()` and compare to the target location
4. If matched: attribute the job to that deal's location. **All assigned techs** on the job count toward that location's compliance, regardless of their home team.
5. If not found (no deal link, cache miss, empty pbLocation): fall back to current team-based attribution

**Batch optimization:** Before the job loop, run a single Prisma query to load `HubSpotProjectCache` records into a `Map<dealId, pbLocation>`:
```ts
const projectCache = await prisma.hubSpotProjectCache.findMany({
  select: { dealId: true, pbLocation: true },
});
const dealLocationMap = new Map(projectCache.map(p => [p.dealId, p.pbLocation]));
```
Note: `ZuperJobCache` stores the `hubspotDealId` link but does NOT have `pbLocation`. The location must come from `HubSpotProjectCache`, which is the authoritative deal-to-location cache in this codebase.

### Files Changed

- **`src/lib/compliance-compute.ts`** — Core change. Replace team-based filtering with deal-location filtering + team fallback.
  - Remove `LOCATION_TEAM_FILTERS` as primary filter (keep for fallback)
  - Add `hubspot_deal_id` extraction from job custom fields (reuse `extractHubspotDealId` from zuper-sync or inline)
  - Add `HubSpotProjectCache` batch lookup at start of `computeLocationCompliance()` to build `dealId → pbLocation` map
  - Change job loop: match by deal location first, team second

- **`src/app/api/zuper/compliance/route.ts`** — Has its own copy of the scoring loop. Same deal-location attribution change.

- **`src/lib/compliance-helpers.ts`** — `extractHubspotDealId` helper may need to be exported/shared if not already accessible. The `normalizeHubspotDealIdValue()` function in zuper-sync.ts handles URL-format deal IDs.

### Edge Cases

- **No `hubspot_deal_id` on job:** Falls back to team-based (covers manually-created Zuper jobs)
- **Deal's `pb_location` is empty/null:** Falls back to team-based
- **`ZuperJobCache` miss for a deal ID:** Falls back to team-based
- **Tech appears on multiple locations:** Expected behavior — they get separate stats per location based on which deals they worked

---

## 2. All Locations Overview Page

### Overview

A standalone page at `/office-performance/all` showing all 5 locations side-by-side. TVs navigate directly to this URL; it does not rotate within a per-location carousel.

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

### Aggregate Compliance Grade

`SectionCompliance` currently has no aggregate grade — only per-employee grades. The all-locations overview needs a single grade per category per location.

**Derivation:** Apply `computeGrade()` to the aggregate compliance score, computed from the `SectionCompliance` summary fields using the same penalty-based formula already in use for per-employee scores (changed from the old weighted formula to `onTime% − stuck% − neverStarted%` in commit `3f73fb40`):

```ts
const stuckRate = compliance.totalJobs > 0
  ? compliance.stuckJobs.length / compliance.totalJobs : 0;
const neverStartedRate = compliance.totalJobs > 0
  ? compliance.neverStartedCount / compliance.totalJobs : 0;
const rawOnTime = compliance.onTimePercent >= 0 ? compliance.onTimePercent : 0;
const aggregateScore = Math.max(0, rawOnTime - stuckRate * 100 - neverStartedRate * 100);
const aggregateGrade = computeGrade(aggregateScore);
```

**Where to add it:** Add `aggregateGrade: string` and `aggregateScore: number` to `ComplianceSummaryFull` in `compliance-compute.ts`, computed at the end of `computeLocationCompliance()` alongside the existing summary fields. Then thread it through `SectionCompliance` in `office-performance-types.ts` and the office-performance patch code.

This ensures the all-locations overview and any future aggregate display use the same grade derivation as per-employee rows — no invented rollup rule.

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

### Page Integration

The current office-performance architecture has one page per location (`/office-performance/[location]`) with an `OfficeCarousel` that rotates **sections** within that location (teamResults → surveys → installs → inspections). There is no cross-location rotation mechanism.

The all-locations overview is a **standalone page** at `/office-performance/all`:
- `"all"` added as a recognized slug in the `[location]` dynamic route
- When slug is `"all"`, the page renders `AllLocationsSection` instead of `OfficeCarousel`
- No carousel rotation needed — the all-locations slide is a single static view (auto-refreshes data on the same interval as other pages)
- TVs that want to show this page navigate directly to `/office-performance/all`
- No changes to the existing per-location `OfficeCarousel` component

### Files Created/Changed

- **`src/app/dashboards/office-performance/[location]/AllLocationsSection.tsx`** — New component
- **`src/app/api/office-performance/all/route.ts`** — New API route
- **`src/lib/office-performance-types.ts`** — Add `AllLocationsResponse`, `LocationOverview`, `CategoryOverview` types
- **`src/app/dashboards/office-performance/[location]/page.tsx`** — Handle `"all"` slug

---

## Implementation Order

1. Compliance attribution fix (changes scoring for all consumers)
2. Add aggregate grade to `ComplianceSummaryFull` + `SectionCompliance`
3. All locations API route + types
4. All locations page component (`AllLocationsSection.tsx`)
5. Wire `"all"` slug into `[location]` page route
6. Verify on TV
