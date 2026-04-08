# Office Performance Dashboards — Deal Drill-Down + Compliance

**Goal:** Add always-visible deal lists and Zuper compliance data to every section of the office performance TV carousel. Remove non-ops leaderboards (PM/designer/deal owner). Replace with ops-relevant data: overdue deal rankings and crew assignment summaries.

**Context:** Follows v2 visual overhaul (PR #144). The dashboards show aggregate metrics but provide no way to verify or drill into the underlying data. Sections with zero MTD activity appear empty. This spec adds the raw deal/job data that backs each metric.

---

## New Types

### DealRow

Represents a single project in the deal list. Pre-sorted and pre-capped server-side.

```typescript
export interface DealRow {
  name: string;           // Deal/project name (from HubSpot)
  stage: string;          // Current pipeline stage
  daysInStage: number;    // Days since last stage movement
  overdue: boolean;       // Forecasted date passed without completion
  assignedUser?: string;  // Zuper assigned user name (from ZuperJobCache)
}
```

### SectionCompliance

Zuper compliance summary for a job category within a location.

```typescript
export interface SectionCompliance {
  onTimePercent: number;           // % of completed jobs finished on-time
  stuckJobs: ComplianceJob[];      // Jobs in "on our way"/"started"/"in progress" too long
  neverStartedCount: number;       // Scheduled but unstarted jobs
}

export interface ComplianceJob {
  name: string;           // Job title or linked deal name
  assignedUser?: string;  // Who is assigned
  daysSinceScheduled?: number;  // How long it's been stuck/waiting
}
```

## Type Changes

### PipelineData

Remove `pmLeaderboard`, `designerLeaderboard`, `ownerLeaderboard` fields. Also remove the `PipelinePersonStat` interface from `office-performance-types.ts` (nothing else references it). Remove the PM-based achievements from `recentWins` generation in `buildPipelineData()`. Add:

```typescript
deals: DealRow[];      // Top ~12 projects sorted by: overdue first, then days-in-stage desc
totalCount: number;    // Total projects (for "+N more" display)
```

No compliance block on Pipeline (it shows HubSpot projects, not Zuper jobs). The Pipeline deal list omits the `assignedUser` column since most early-stage projects won't have Zuper jobs linked — showing "—" for 80% of rows adds noise.

### SurveyData

Add:

```typescript
deals: DealRow[];                   // Active survey-stage projects
totalCount: number;
compliance?: SectionCompliance;     // Site Survey job compliance
```

### InstallData

Add:

```typescript
deals: DealRow[];                   // Active install-stage projects
totalCount: number;
compliance?: SectionCompliance;     // Construction job compliance
```

Note: RTB-stage projects appear in the deal list but won't have Construction Zuper jobs yet (that's the point of RTB — waiting to be scheduled). The compliance block only reflects projects with actual Zuper jobs.

### InspectionData

Add:

```typescript
deals: DealRow[];                   // Active inspect-stage projects
totalCount: number;
compliance?: SectionCompliance;     // Inspection job compliance
```

## Data Layer Changes

### Deal List Population

In `getOfficePerformanceData()`, the `locationProjects` array (from `fetchAllProjects`) already contains all fields needed for `DealRow`:

- `name` → deal name (already available as project name)
- `stage` → current stage (already available, normalized)
- `daysInStage` → `daysSinceStageMovement` field (already on `ProjectForMetrics`)
- `overdue` → reuse the same overdue logic from `buildPipelineData()` (forecast vs completion date checks)
- `assignedUser` → join to `ZuperJobCache` via `hubspotDealId` matching `String(project.id)`

**Zuper user join:** For each deal, query `ZuperJobCache` for the relevant job category:
- Pipeline: most recent job of any category linked to that deal
- Surveys: "Site Survey" jobs
- Installs: "Construction" jobs
- Inspections: "Inspection" jobs

Use the existing `assignedUsers` JSON field on `ZuperJobCache`. Take the first assigned user's name.

**Sorting:** Overdue projects first (sorted by days overdue desc), then non-overdue sorted by days-in-stage desc.

**Cap:** 12 rows max. Include a `totalCount` field so the UI can show "+N more".

### Stage-to-Section Mapping

Each section shows deals in relevant stages:

| Section | Stages Included |
|---------|----------------|
| Pipeline | All active stages (Survey through PTO) |
| Surveys | Survey stage only |
| Installs | RTB, Install (ready-to-build and construction) |
| Inspections | Inspect, PTO (inspection through final) |

### Compliance Population

Build compliance from `ZuperJobCache` data (not the live Zuper API — avoids rate limits and latency). Do not reuse the functions in `compliance-helpers.ts` directly since those call the live Zuper search API via `fetchJobsForCategory()`. Instead, define local status constant sets matching the same values, and query `ZuperJobCache` which stores statuses in its own casing.

**Status matching:** `ZuperJobCache.jobStatus` may store values in different casing than the lowercase constants in `compliance-helpers.ts`. Normalize all status comparisons to lowercase (`.toLowerCase()`) before matching against:

- `STUCK_STATUSES` = ["on our way", "started", "in progress"]
- `NEVER_STARTED_STATUSES` = ["new", "scheduled", "unassigned", "ready to schedule", "ready to build", "ready for inspection"]
- `COMPLETED_STATUSES` = ["completed", "construction complete", "passed", "partial pass", "failed"]

**New query function:** `getZuperJobsByLocation()` currently filters on `completedDate` (only returns completed jobs). Compliance needs stuck and never-started jobs which have no `completedDate`. Add a new function `getZuperJobsForCompliance()` that queries `ZuperJobCache` without the `completedDate` filter:

```typescript
async function getZuperJobsForCompliance(
  location: string,
  category: string,
  dealIds: string[]
): Promise<CachedJob[]>
```

This queries by `jobCategory` + `hubspotDealId IN dealIds`, returns all jobs regardless of completion status. Filter to location via the same `HubSpotProjectCache` join pattern used in `getZuperJobsByLocation()` — or more efficiently, accept pre-filtered `dealIds` that are already known to be in the target location.

**On-time %:** Of completed jobs (status in `COMPLETED_STATUSES`) in the current month, percentage where `completedDate <= scheduledEnd + 1 day` (grace period constant: `GRACE_MS = 86_400_000`).

**Stuck jobs:** Active jobs with lowercase status in `STUCK_STATUSES`. Include job name (or linked deal name), assigned user, and days since scheduled start.

**Never-started count:** Active jobs with lowercase status in `NEVER_STARTED_STATUSES` that are past their `scheduledStart` date.

### Zuper User Batch Query

To populate `assignedUser` on deal rows without N+1 queries:

1. Collect all `project.id` values for the location
2. Single query: `ZuperJobCache.findMany({ where: { hubspotDealId: { in: dealIds } } })`
3. Build a `Map<dealId, { category, assignedUser }>` for O(1) lookups
4. This same query result feeds both deal row population and compliance calculation

### PipelinePersonStat Removal

Remove `buildPipelinePersonLeaderboard()` function and its callers. Remove the `pmLeaderboard`, `designerLeaderboard`, `ownerLeaderboard` fields from `PipelineData`. Remove the `PipelinePersonStat` interface from `office-performance-types.ts`. Remove the PM-based achievement detection from `recentWins` in `buildPipelineData()`. Remove the corresponding UI panels from `PipelineSection.tsx`.

## UI Changes

### DealList Component (New)

Compact table component for TV readability. Fixed columns, no horizontal scroll.

```
| Deal Name              | Stage    | Days | ⚠️ | Assigned     |
|------------------------|----------|------|-----|--------------|
| Smith 10.2kW           | Inspect  | 14d  | ⚠️  | Mike Torres  |
| Jones Residential      | Install  | 9d   |     | —            |
| ...                    |          |      |     |              |
| +36 more projects      |          |      |     |              |
```

- Text size: `text-sm` for readability on TV at distance
- Overdue rows get a subtle red-tinted left border or background
- Overdue flag: ⚠️ icon in its own narrow column
- Missing assigned user: show "—"
- "+N more" footer when `totalCount > deals.length`
- Staggered row entrance animation (reuse pattern from Leaderboard)

### ComplianceBlock Component (New)

Compact compliance summary rendered below the deal list on Surveys, Installs, and Inspections sections.

Layout: horizontal row of 3 stats + optional stuck job list.

```
✅ 91% on-time  |  ⚠️ 2 stuck  |  🔴 1 never started

Stuck: "Martinez 8.5kW" (Mike T, 3d) · "Chen Solar" (unassigned, 7d)
```

- Green/yellow/red coloring based on thresholds:
  - On-time: ≥90% green, ≥75% yellow, <75% red
  - Stuck: 0 green, 1-2 yellow, 3+ red
  - Never-started: 0 green, 1+ yellow
- Stuck job names shown inline (they're usually few)
- If no compliance data available (no Zuper jobs), don't render

### PipelineSection Changes

- Remove PM/designer/owner panels from the right 2 columns
- Replace with `DealList` showing all active projects ranked by urgency
- Hide the Assigned column on Pipeline (most early-stage deals have no Zuper job — showing "—" for 80% of rows adds noise). `DealList` accepts a `showAssigned?: boolean` prop (default true).
- Keep stage distribution bars on left 3 columns
- Layout becomes: stage bars (left 3 cols) + deal list (right 2 cols)

### SurveysSection Changes

- Below metric cards: `DealList` for survey-stage deals
- Below deal list: `ComplianceBlock` for Site Survey compliance
- Surveyor leaderboard stays at bottom (when populated)

### InstallsSection Changes

- Below metric cards: `DealList` for install-stage deals
- Below deal list: `ComplianceBlock` for Construction compliance
- Installer/electrician leaderboards stay at bottom

### InspectionsSection Changes

- Below metric cards: `DealList` for inspect-stage deals
- Below deal list: `ComplianceBlock` for Inspection compliance
- Inspection tech leaderboard stays at bottom

## Performance Considerations

- The Zuper job batch query adds 1 additional DB query per `getOfficePerformanceData()` call (cached with appCache at 5-min TTL)
- Compliance queries reuse the same batch result — no additional DB calls
- Deal lists are pre-sorted and pre-capped server-side to keep payload small
- No new external API calls (all data comes from ZuperJobCache and existing HubSpot fetch)

## Testing

- Unit test `buildDealRows()` with overdue sorting, cap at 12, assignedUser join
- Unit test compliance calculation: on-time %, stuck detection, never-started count
- Unit test stage-to-section mapping
- Existing `buildPipelineData` tests updated to remove PM/designer/owner assertions
- Verify Pipeline section renders deal list instead of person leaderboards
- Verify compliance block renders on Surveys/Installs/Inspections
- Verify empty states (no deals, no compliance data)
