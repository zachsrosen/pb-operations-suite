# Inspection Metrics Dashboard — Design Spec

**Date:** 2026-03-21
**Location:** `/dashboards/inspection-metrics`
**Suite:** Operations → Inspections section
**Accent:** Green

## Purpose

Inspection turnaround, first-time pass rates, and failure tracking by PB Location and AHJ. Dual-source approach: compute metrics from individual deals AND fetch pre-aggregated rollups from HubSpot Location/AHJ custom objects, validating them against each other server-side before serving.

---

## 1. Data Layer

### 1a. Deal Properties — Already Fetched

These are already in `DEAL_PROPERTIES` and mapped on the `Project` interface:

| HubSpot Property | Project Field | Type |
|---|---|---|
| `inspections_schedule_date` | `inspectionScheduleDate` | `string \| null` |
| `inspections_completion_date` | `inspectionPassDate` | `string \| null` |
| `final_inspection_status` | `finalInspectionStatus` | `string \| null` |
| `forecasted_inspection_date` | `forecastedInspectionDate` | `string \| null` |

### 1b. Deal Properties — Need to Add

Add to `DEAL_PROPERTIES` in `hubspot.ts` and map onto the `Project` interface:

| HubSpot Property | Project Field | Type | Notes |
|---|---|---|---|
| `inspections_fail_date` | `inspectionFailDate` | `string \| null` | Plural "inspections_" prefix |
| `inspection_fail_count` | `inspectionFailCount` | `number \| null` | Singular "inspection_" prefix |
| `is_inspection_passed_` | `isInspectionPassed` | `boolean` | Boolean checkbox |
| `has_inspection_failed_` | `hasInspectionFailed` | `boolean` | Boolean checkbox |
| `first_time_inspection_pass_` | `isFirstTimeInspectionPass` | `boolean` | Boolean checkbox |
| `inspection_failure_reason` | `inspectionFailureReason` | `string \| null` | Textarea |
| `inspection_turnaround_time` | `inspectionTurnaroundTime` | `number \| null` | Calculated equation |
| `inspection_booked_date` | `inspectionBookedDate` | `string \| null` | Date |
| `has_inspection_failed__not_rejected__` | `hasInspectionFailedNotRejected` | `boolean` | Excludes rejected |
| `first_time_inspection_pass____not_rejected_` | `isFirstTimePassNotRejected` | `boolean` | Excludes rejected (note: 4 underscores) |
| `ready_for_inspection_` | `readyForInspection` | `string \| null` | Select dropdown |

**Naming gotcha:** HubSpot uses `inspections_` (plural) for date fields but `inspection_` (singular) for boolean/text/number fields.

### 1c. Location Custom Object (NEW)

Add to `hubspot-custom-objects.ts` alongside existing AHJ and Utility objects.

- **Object type ID:** `2-50570396`
- **Schema:** `p21710069_locations`

**New exports:**
- `LOCATION_OBJECT_TYPE = "2-50570396"`
- `LOCATION_PROPERTIES` — array of property names (inspection-related subset below)
- `LocationRecord { id: string; properties: Record<string, string | null> }`
- `fetchAllLocations(): Promise<LocationRecord[]>` — paginated getPage with rate-limit retry

**Inspection-related Location properties to fetch:**

| Property | Label | Type |
|---|---|---|
| `location_name` | Location Name | text |
| `pb_location` | PB Location | radio |
| `inspection_turnaround_time` | Inspection Turnaround Time | rollup |
| `inspection_turnaround_time__365_days_` | Avg Inspection Turnaround (365) | rollup |
| `inspections_fpr` | Inspections FPR | equation |
| `inspections_first_time_pass_rate__365_days_` | FPR Inspections (365) | equation |
| `fpr_inspections__365___not_rejected_` | FPR Inspections (365) (Not Rejected) | equation |
| `count_of_inspections_passed` | Total Inspections Passed | rollup |
| `total_inspections_passe_d__365_days_` | Passed Inspections (365) | rollup (note typo: `passe_d`) |
| `count_of_inspections_failed` | Total Inspections Failed | rollup |
| `inspections_failed__365_days_` | Failed Inspections (365) | rollup |
| `count_of_inspections_passed_1st_time` | Total 1st Time Passed | rollup |
| `total_1st_time_passed_inspections__365_days_` | 1st Time Passed (365) | rollup (note: `n1st...` variant also exists) |
| `outstanding_failed_inspections` | Outstanding Failed Inspections | rollup |
| `outstanding_failed_inspections__not_rejected_` | Outstanding Failed (Not Rejected) | rollup |
| `needs_inspection_reinspection` | Needs Inspection/Reinspection | equation |
| `cc_pending_inspection` | CC Pending Inspection | rollup |
| `ready_for_inspection` | Ready for Inspection | rollup |
| `construction_turnaround_time__365_` | Construction Turnaround (365) | rollup |
| `count_of_cc__365_` | Count of CC (365) | rollup |
| `time_to_cc__365_` | Time to CC (365) | rollup |

### 1d. AHJ Custom Object (EXISTS)

Already in `hubspot-custom-objects.ts`. The following inspection properties are already in `AHJ_PROPERTIES`:

| Property | Label | Type |
|---|---|---|
| `inspection_turnaround_time` | Inspection Turnaround Time | rollup |
| `inspection_turnaround_time__365_days_` | Inspection Turnaround (365) | rollup |
| `inspections_fpr` | Inspections FPR | equation |
| `count_of_inspections_passed` | Total Inspections Passed | rollup |
| `count_of_inspections_failed` | Total Inspections Failed | rollup |
| `total_first_time_passed_inspections` | Total 1st Time Passed | rollup |
| `total_inspections_passed__365__` | Passed (365) | rollup |
| `total_inspections_scheduled` | Total Scheduled | rollup |
| `electrician_required_for_inspection_` | Electrician Required? | checkbox |
| `fire_inspection_required` | Fire Inspection Required? | checkbox |
| `inspection_requirements` | Inspection Requirements | checkbox |
| `inspection_notes` | Inspection Notes | textarea |

**AHJ → Deal association:** Resolve via existing `fetchAHJsForDeal()` or batch lookup by iterating `project.ahj` name matching against `fetchAllAHJs()`.

---

## 2. API Route

**Path:** `/api/hubspot/inspection-metrics`
**Method:** GET
**Query params:** `?days=N` (time window, default 0 = all time), `?refresh=true` (bypass cache)

### Data Flow

1. Fetch all projects via `appCache.getOrFetch(CACHE_KEYS.PROJECTS_ALL, fetchAllProjects({activeOnly: false}), forceRefresh)`
2. Fetch Location custom objects via `fetchAllLocations()` (new, cached separately)
3. Fetch AHJ custom objects via `fetchAllAHJs()` (existing)
4. Resolve Zuper jobs: `getCachedZuperJobsByDealIds(dealIds, "Construction")` — inspection jobs are under construction Zuper category
5. Filter projects to those with `inspectionPassDate` in time window (for stats)
6. Filter active projects for action queues (CC pending inspection, outstanding failures)

### Computed Metrics (per group — location or AHJ)

For each group, compute from individual deals:

- **count** — number of inspections completed in window
- **avgTurnaround** — average days from `inspectionBookedDate` → `inspectionPassDate` (fall back to `inspectionTurnaroundTime` if dates missing)
- **fpr** — `firstTimePassCount / count * 100` using `isFirstTimeInspectionPass`
- **fprNotRejected** — same but using `isFirstTimePassNotRejected`
- **passCount** — count where `isInspectionPassed`
- **failCount** — count where `hasInspectionFailed`
- **firstTimePassCount** — count where `isFirstTimeInspectionPass`
- **avgCcToInspectionPass** — average days from `constructionCompleteDate` → `inspectionPassDate`

### Rollup Values (per group)

For locations, read from Location custom object. For AHJs, read from AHJ custom object. Use the 365-day variants when `days` param is ≤ 365, all-time variants otherwise.

### Validation

Compare computed vs rollup for each group. Key comparisons:

| Metric | Computed From | Rollup Property (Location) | Rollup Property (AHJ) |
|---|---|---|---|
| FPR | `firstTimePassCount / count` | `inspections_first_time_pass_rate__365_days_` | `inspections_fpr` |
| Pass Count | `count(isInspectionPassed)` | `total_inspections_passe_d__365_days_` | `total_inspections_passed__365__` |
| Fail Count | `count(hasInspectionFailed)` | `inspections_failed__365_days_` | `count_of_inspections_failed` |
| Turnaround | `avg(inspectionTurnaroundTime)` | `inspection_turnaround_time__365_days_` | `inspection_turnaround_time__365_days_` |

Log divergences > 5% with `[Inspection Metrics] Validation:` prefix. Include in response as `validation` object for development visibility.

### Response Shape

```typescript
interface InspectionMetricsResponse {
  byLocation: Record<string, LocationGroup>;
  byAHJ: Record<string, AHJGroup>;
  totals: {
    computed: ComputedMetrics;
    rollup: RollupMetrics | null;
    divergence: Record<string, number> | null;
  };
  ccPendingInspection: PipelineDeal[];
  outstandingFailed: PipelineDeal[];
  daysWindow: number;
  lastUpdated: string;
}

interface LocationGroup {
  computed: ComputedMetrics;
  rollup: RollupMetrics | null;
  divergence: Record<string, number> | null;
  deals: DealDetail[];
  // Nested AHJ breakdown for this location
  ahjBreakdown: Record<string, {
    computed: ComputedMetrics;
    deals: DealDetail[];
  }>;
}

interface AHJGroup {
  computed: ComputedMetrics;
  rollup: AHJRollupMetrics | null;
  divergence: Record<string, number> | null;
  deals: DealDetail[];
  ahjId: string;
  location: string; // PB Location this AHJ falls under
  // AHJ-specific config flags
  electricianRequired: boolean;
  fireInspectionRequired: boolean;
  inspectionRequirements: string | null;
  inspectionNotes: string | null;
}

interface ComputedMetrics {
  count: number;
  avgTurnaround: number | null;
  fpr: number | null;
  fprNotRejected: number | null;
  passCount: number;
  failCount: number;
  firstTimePassCount: number;
  avgCcToInspectionPass: number | null;
}

interface DealDetail {
  dealId: string;
  projectNumber: string;
  name: string;
  url: string;
  pbLocation: string;
  ahj: string;
  stage: string;
  amount: number;
  constructionCompleteDate: string | null;
  inspectionScheduleDate: string | null;
  inspectionBookedDate: string | null;
  inspectionPassDate: string | null;
  inspectionFailDate: string | null;
  inspectionFailCount: number | null;
  inspectionFailureReason: string | null;
  isFirstTimePass: boolean;
  inspectionTurnaroundDays: number | null;
  ccToInspectionDays: number | null;
  finalInspectionStatus: string | null;
  zuperJobUid: string | null;
}

interface PipelineDeal {
  dealId: string;
  projectNumber: string;
  name: string;
  url: string;
  pbLocation: string;
  ahj: string;
  stage: string;
  amount: number;
  constructionCompleteDate: string | null;
  inspectionScheduleDate: string | null;
  inspectionBookedDate: string | null;
  inspectionFailDate: string | null;
  inspectionFailCount: number | null;
  inspectionFailureReason: string | null;
  readyForInspection: string | null;
  daysSinceCc: number | null;
  daysSinceLastFail: number | null;
  zuperJobUid: string | null;
}
```

### Action Queue Filters

- **ccPendingInspection:** `constructionCompleteDate` exists AND no `inspectionPassDate` AND not in `EXCLUDED_PIPELINE_STAGES` AND `isActive`. Sorted by `daysSinceCc` descending.
- **outstandingFailed:** `hasInspectionFailed` is true AND no `inspectionPassDate` AND not in `EXCLUDED_PIPELINE_STAGES` AND `isActive`. Sorted by `daysSinceLastFail` descending.

---

## 3. Dashboard Page

### Filters Bar

- **Time window:** 30 / 60 / 90 / 180 / All buttons (applies to stats sections only)
- **PB Location:** Location filter buttons (same pattern as survey-metrics). Applies to all sections.

### Summary Cards (4-card grid)

| Card | Value | Color Logic |
|---|---|---|
| Avg CC → Inspection Pass | Days | Green ≤ 14d, Yellow ≤ 21d, Orange ≤ 30d, Red > 30d |
| Inspections Passed | Count in window | Neutral |
| First-Time Pass Rate | Percentage | Green ≥ 90%, Yellow ≥ 75%, Orange ≥ 60%, Red < 60% |
| Outstanding Failures | Active failed count | Red if > 0, Green if 0 |

### Section 1: Performance by PB Location

Table columns: PB Location, Inspections, Avg Turnaround (days), FPR (%), Fail Count, Avg CC → Pass (days).

Click any row to expand drill-down inline below the row. Auto-scrolls into view.

**Drill-down** has a toggle: **Show Deals** vs **Show AHJs in {location}**.

- **Show Deals:** Sortable table with all DealDetail fields — Project, Customer, AHJ, Stage, Amount, CC Date, Booked Date, Pass Date, Fail Date, Fail Count, Failure Reason, Turnaround, CC → Pass, Links (HubSpot + Zuper).
- **Show AHJs:** Sub-table showing AHJs within that location with their computed stats (Inspections, Avg Turnaround, FPR, Fail Count). Each AHJ row is clickable to drill further into its deals.

### Section 2: Performance by AHJ

Table columns: AHJ, PB Location, Inspections, Avg Turnaround (days), FPR (%), Fail Count, Electrician Required, Fire Inspection Required.

Click any row to expand deal-level drill-down inline below. Same deal columns as the location drill-down.

### Section 3: Outstanding Failed Inspections

Red left-border accent. Plain English header description: _"Active projects where inspection has failed and hasn't yet passed. These need reinspection or resolution."_

Sortable columns: Project, Customer, PB Location, AHJ, Stage, Amount, Fail Date, Fail Count, Failure Reason, Days Since Fail, Links (HubSpot + Zuper).

Filtered by PB Location when location filter is active. Excludes Project Complete / Cancelled.

### Section 4: CC Pending Inspection

Standard border. Plain English header description: _"Construction complete projects waiting on inspection scheduling or results."_

Sortable columns: Project, Customer, PB Location, AHJ, Stage, Amount, CC Date, Days Since CC, Inspection Scheduled, Booked Date, Ready for Inspection, Links (HubSpot + Zuper).

Sorted by Days Since CC descending by default. Filtered by PB Location. Excludes Project Complete / Cancelled.

---

## 4. Drill-Down UX

Drill-down panels appear **inline below the clicked row** (not at page bottom). When a drill-down opens:

1. The clicked row gets a highlighted left border accent
2. A detail panel renders directly below it in the table
3. The page auto-scrolls so the panel is visible
4. Clicking the same row again collapses it
5. Clicking a different row moves the drill-down

This pattern applies to both the PB Location table (Section 1) and the AHJ table (Section 2).

---

## 5. Operations Suite Integration

Add to the Inspections section of `/suites/operations/page.tsx`:

```typescript
{
  href: "/dashboards/inspection-metrics",
  title: "Inspection Metrics",
  description: "Inspection turnaround, first-time pass rates, and failure tracking by PB Location and AHJ.",
  tag: "METRICS",
}
```

Add `/dashboards/inspection-metrics` to:
- `page-directory.ts`
- `role-permissions.ts` — same roles as `construction-metrics` and `survey-metrics`
- `query-keys.ts` — `inspectionMetrics: (days: number) => [...queryKeys.stats.root, "inspection-metrics", days] as const`

---

## 6. Files Changed

| File | Change |
|---|---|
| `src/lib/hubspot.ts` | Add 11 new deal properties to `DEAL_PROPERTIES`, map to `Project` interface |
| `src/lib/types.ts` | Add 11 new fields to `RawProject` |
| `src/lib/transforms.ts` | Map new fields to `TransformedProject` (if needed downstream) |
| `src/lib/hubspot-custom-objects.ts` | Add `LOCATION_OBJECT_TYPE`, `LOCATION_PROPERTIES`, `LocationRecord`, `fetchAllLocations()` |
| `src/app/api/hubspot/inspection-metrics/route.ts` | **New** — API route |
| `src/app/dashboards/inspection-metrics/page.tsx` | **New** — Dashboard page |
| `src/lib/query-keys.ts` | Add `inspectionMetrics` key |
| `src/lib/page-directory.ts` | Add `/dashboards/inspection-metrics` |
| `src/lib/role-permissions.ts` | Add to same roles as construction-metrics |
| `src/app/suites/operations/page.tsx` | Add card to Inspections section |
