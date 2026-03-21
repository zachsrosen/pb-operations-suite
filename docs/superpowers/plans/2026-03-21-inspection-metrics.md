# Inspection Metrics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an inspection metrics dashboard with dual-source validation (computed from deals + HubSpot Location/AHJ rollups), grouped by PB Location and AHJ, with inline drill-downs and action queues.

**Architecture:** Dedicated API route computes metrics from individual deals and fetches pre-aggregated rollups from Location/AHJ custom objects for server-side validation. Client page follows the survey-metrics pattern (DashboardShell, React Query, time window + location filters, inline drill-downs with auto-scroll).

**Tech Stack:** Next.js API route, React Query v5, HubSpot CRM API (deals + custom objects), Zuper job cache, Tailwind CSS with theme tokens.

**Spec:** `docs/superpowers/specs/2026-03-21-inspection-metrics-design.md`

---

**Note:** `RawProject` in `types.ts` and `TransformedProject` in `transforms.ts` are NOT updated in this plan because the inspection-metrics route consumes the `Project` interface from `hubspot.ts` directly (same pattern as survey-metrics). If downstream consumers need these fields on `RawProject`/`TransformedProject`, add them as a separate task.

---

## Chunk 1: Data Layer & Plumbing

### Task 1: Add inspection deal properties to HubSpot client

**Files:**
- Modify: `src/lib/hubspot.ts` (DEAL_PROPERTIES array ~line 569, Project interface ~line 334, deal→Project mapping ~line 909)

- [ ] **Step 1: Add 11 new properties to DEAL_PROPERTIES array**

In `src/lib/hubspot.ts`, find the `// Inspection dates` comment block (~line 569) and add after the existing inspection properties:

```typescript
  // Inspection dates
  "inspections_schedule_date",
  "inspections_completion_date", // pass date
  "final_inspection_status",
  // Inspection dates — NEW
  "inspections_fail_date",
  "inspection_booked_date",
  // Inspection metrics
  "inspection_fail_count",
  "is_inspection_passed_",
  "has_inspection_failed_",
  "first_time_inspection_pass_",
  "inspection_failure_reason",
  "inspection_turnaround_time",
  "has_inspection_failed__not_rejected__",
  "first_time_inspection_pass____not_rejected_",
  "ready_for_inspection_",
```

Note the naming gotcha: `inspections_` (plural) for date fields, `inspection_` (singular) for boolean/text/number. The `first_time_inspection_pass____not_rejected_` has 4 underscores — that's correct.

- [ ] **Step 2: Add 11 new fields to Project interface**

In `src/lib/hubspot.ts`, find the `// Inspection` block on the Project interface (~line 334) and add after `finalInspectionStatus`:

```typescript
  // Inspection
  inspectionScheduleDate: string | null;
  inspectionPassDate: string | null;
  finalInspectionStatus: string | null;
  // Inspection — NEW
  inspectionFailDate: string | null;
  inspectionBookedDate: string | null;
  inspectionFailCount: number | null;
  isInspectionPassed: boolean;
  hasInspectionFailed: boolean;
  isFirstTimeInspectionPass: boolean;
  inspectionFailureReason: string | null;
  inspectionTurnaroundTime: number | null;
  hasInspectionFailedNotRejected: boolean;
  isFirstTimePassNotRejected: boolean;
  readyForInspection: string | null;
```

- [ ] **Step 3: Map new properties in deal→Project builder**

In `src/lib/hubspot.ts`, find the inspection mapping block (~line 909) and add after the existing `finalInspectionStatus` mapping:

```typescript
    inspectionScheduleDate: parseDate(deal.inspections_schedule_date),
    inspectionPassDate: parseDate(deal.inspections_completion_date),
    finalInspectionStatus: deal.final_inspection_status ? String(deal.final_inspection_status) : null,
    // Inspection — NEW
    inspectionFailDate: parseDate(deal.inspections_fail_date),
    inspectionBookedDate: parseDate(deal.inspection_booked_date),
    inspectionFailCount: deal.inspection_fail_count ? Number(deal.inspection_fail_count) : null,
    isInspectionPassed: deal.is_inspection_passed_ === "true",
    hasInspectionFailed: deal.has_inspection_failed_ === "true",
    isFirstTimeInspectionPass: deal.first_time_inspection_pass_ === "true",
    inspectionFailureReason: deal.inspection_failure_reason ? String(deal.inspection_failure_reason) : null,
    inspectionTurnaroundTime: deal.inspection_turnaround_time ? Number(deal.inspection_turnaround_time) : null,
    hasInspectionFailedNotRejected: deal.has_inspection_failed__not_rejected__ === "true",
    isFirstTimePassNotRejected: deal.first_time_inspection_pass____not_rejected_ === "true",
    readyForInspection: deal.ready_for_inspection_ ? String(deal.ready_for_inspection_) : null,
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No errors related to inspection fields. Existing code doesn't reference them yet so nothing breaks.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hubspot.ts
git commit -m "feat(inspection-metrics): add 11 inspection deal properties to HubSpot client"
```

---

### Task 2: Add Location custom object to hubspot-custom-objects.ts

**Files:**
- Modify: `src/lib/hubspot-custom-objects.ts`

- [ ] **Step 1: Add Location object type constant and properties**

After the `UTILITY_OBJECT_TYPE` constant (~line 28), add:

```typescript
export const LOCATION_OBJECT_TYPE = "2-50570396";
```

After the `UTILITY_PROPERTIES` array (~line 158), add:

```typescript
/** Location properties relevant to inspection/construction metrics */
export const LOCATION_PROPERTIES = [
  "location_name",
  "pb_location",
  // Inspection rollups
  "inspection_turnaround_time",
  "inspection_turnaround_time__365_days_",
  "inspections_fpr",
  "inspections_first_time_pass_rate__365_days_",
  "fpr_inspections__365___not_rejected_",
  // Note: no all-time "not rejected" FPR variant confirmed on Location object
  // fpr_inspections__365___not_rejected_ is the only one available
  "count_of_inspections_passed",
  "total_inspections_passe_d__365_days_",   // note HubSpot typo: passe_d
  "count_of_inspections_failed",
  "inspections_failed__365_days_",
  "count_of_inspections_passed_1st_time",
  "total_1st_time_passed_inspections__365_days_",
  "outstanding_failed_inspections",
  "outstanding_failed_inspections__not_rejected_",
  "needs_inspection_reinspection",
  "cc_pending_inspection",
  "ready_for_inspection",
  // Construction cross-match
  "construction_turnaround_time__365_",
  "count_of_cc__365_",
  "time_to_cc__365_",
] as const;
```

- [ ] **Step 2: Add LocationRecord type**

After `UtilityRecord` (~line 172), add:

```typescript
export interface LocationRecord {
  id: string;
  properties: Record<string, string | null>;
}
```

- [ ] **Step 3: Add fetchAllLocations function**

After the `fetchAllUtilities` function (~line 318), add:

```typescript
// ---------------------------------------------------------------------------
// Location Fetch Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch all Location records with paginated iteration.
 */
export async function fetchAllLocations(): Promise<LocationRecord[]> {
  const results: LocationRecord[] = [];
  let after: string | undefined;

  do {
    const response = await withRetry(() =>
      hubspotClient.crm.objects.basicApi.getPage(
        LOCATION_OBJECT_TYPE,
        100,
        after,
        [...LOCATION_PROPERTIES],
        undefined,
        undefined,
      )
    );

    results.push(
      ...response.results.map((r) => ({
        id: r.id,
        properties: r.properties as Record<string, string | null>,
      }))
    );
    after = response.paging?.next?.after;
  } while (after);

  return results;
}
```

- [ ] **Step 4: Add 4 new properties to AHJ_PROPERTIES**

In the `AHJ_PROPERTIES` array, after the existing `count_of_inspections_failed` (~line 90), add:

```typescript
  "total_first_time_passed_inspections",
  "total_inspections_passed__365__",
  "total_inspections_scheduled",
```

Note: `fire_inspection_required` is already in `AHJ_PROPERTIES` (~line 64). Do NOT add it again.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/hubspot-custom-objects.ts
git commit -m "feat(inspection-metrics): add Location custom object + AHJ inspection properties"
```

---

### Task 3: Add cache keys and query keys

**Files:**
- Modify: `src/lib/cache.ts` (~line 256)
- Modify: `src/lib/query-keys.ts`

- [ ] **Step 1: Add LOCATIONS_ALL to CACHE_KEYS**

In `src/lib/cache.ts`, in the `CACHE_KEYS` object (~line 262, after `AHJS_ALL`), add:

```typescript
  LOCATIONS_ALL: "locations:all",
```

- [ ] **Step 2: Add inspectionMetrics to query keys**

In `src/lib/query-keys.ts`, in the `stats` block (~line 31, after `daMetrics`), add:

```typescript
    inspectionMetrics: (days: number) => [...queryKeys.stats.root, "inspection-metrics", days] as const,
```

- [ ] **Step 3: Add location and AHJ cache invalidation mappings**

In `src/lib/query-keys.ts`, in the `cacheKeyToQueryKeys` function (~line 88), add before the `// pipelines` comment:

```typescript
  if (serverKey.startsWith("locations")) return [queryKeys.stats.root];
  if (serverKey.startsWith("ahjs")) return [queryKeys.stats.root];
```

This ensures that when location or AHJ server caches update, all `stats`-prefixed React Query keys (including `inspectionMetrics`) get invalidated. This is intentionally broad — it also refetches surveyMetrics/daMetrics/qc, but those are infrequent cache events and the tradeoff is simplicity over precision. The SSE system uses prefix-based invalidation by design.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cache.ts src/lib/query-keys.ts
git commit -m "feat(inspection-metrics): add cache keys and SSE invalidation mappings"
```

---

### Task 4: Add route permissions and page directory

**Files:**
- Modify: `src/lib/page-directory.ts`
- Modify: `src/lib/role-permissions.ts`
- Modify: `src/app/suites/operations/page.tsx`

- [ ] **Step 1: Add to page-directory.ts**

In `src/lib/page-directory.ts`, add in alphabetical order (after `/dashboards/inspections`):

```typescript
  "/dashboards/inspection-metrics",
```

- [ ] **Step 2: Add to role-permissions.ts**

Add `"/dashboards/inspection-metrics"` to every role that has `"/dashboards/construction-metrics"`. Search for `construction-metrics` in the file — there are 7 occurrences. Add the inspection-metrics line immediately after each one:

```typescript
      "/dashboards/construction-metrics",
      "/dashboards/inspection-metrics",
```

The roles are: ADMIN, OWNER, PROJECT_MANAGER, OPERATIONS_MANAGER, OPERATIONS, TECH_OPS, VIEWER (read-only set).

- [ ] **Step 3: Add card to Operations suite Inspections section**

In `src/app/suites/operations/page.tsx`, find the Inspections section (~line 87). After the "Inspections Execution" card (~line 103), add:

```typescript
  {
    href: "/dashboards/inspection-metrics",
    title: "Inspection Metrics",
    description: "Turnaround times, first-time pass rates, and failure tracking by PB Location and AHJ.",
    tag: "METRICS",
    icon: "📊",
    section: "Inspections",
  },
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/page-directory.ts src/lib/role-permissions.ts src/app/suites/operations/page.tsx
git commit -m "feat(inspection-metrics): add route permissions, page directory, ops suite card"
```

---

## Chunk 2: API Route

### Task 5: Create the inspection-metrics API route

**Files:**
- Create: `src/app/api/hubspot/inspection-metrics/route.ts`

This is the biggest task. The route:
1. Fetches projects, Location objects, AHJ objects
2. Computes metrics from deals per PB Location and per AHJ
3. Reads rollup values from Location and AHJ custom objects
4. Validates computed vs rollup (logging divergences)
5. Builds action queues (CC pending inspection, outstanding failures)

- [ ] **Step 1: Create the route file with imports and types**

Create `src/app/api/hubspot/inspection-metrics/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { fetchAllProjects, type Project } from "@/lib/hubspot";
import {
  fetchAllLocations,
  fetchAllAHJs,
  type LocationRecord,
  type AHJRecord,
} from "@/lib/hubspot-custom-objects";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { getCachedZuperJobsByDealIds } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface RollupMetrics {
  fpr: number | null;
  fprNotRejected: number | null;
  passCount: number | null;
  failCount: number | null;
  firstTimePassCount: number | null;
  turnaround: number | null;
  outstandingFailed: number | null;
  outstandingFailedNotRejected: number | null;
  ccPendingInspection: number | null;
  constructionTurnaround: number | null;
}

interface AHJRollupMetrics {
  fpr: number | null;
  passCount: number | null;
  failCount: number | null;
  firstTimePassCount: number | null;
  turnaround: number | null;
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

interface LocationGroup {
  computed: ComputedMetrics;
  rollup: RollupMetrics | null;
  divergence: Record<string, number> | null;
  deals: DealDetail[];
  ahjBreakdown: Record<string, { computed: ComputedMetrics; deals: DealDetail[] }>;
}

interface AHJGroup {
  computed: ComputedMetrics;
  rollup: AHJRollupMetrics | null;
  divergence: Record<string, number> | null;
  deals: DealDetail[];
  ahjId: string;
  location: string;
  electricianRequired: boolean;
  fireInspectionRequired: boolean;
  inspectionRequirements: string | null;
  inspectionNotes: string | null;
}
```

- [ ] **Step 2: Add helper functions**

Append to the same file:

```typescript
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const msPerDay = 86400000;
  const diff = (new Date(b).getTime() - new Date(a).getTime()) / msPerDay;
  return Math.round(diff * 10) / 10;
}

function daysSince(date: string | null): number | null {
  if (!date) return null;
  const msPerDay = 86400000;
  return Math.round((Date.now() - new Date(date).getTime()) / msPerDay);
}

function safeAvg(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null && !isNaN(v));
  if (!valid.length) return null;
  return Math.round((valid.reduce((s, v) => s + v, 0) / valid.length) * 10) / 10;
}

function safePercent(num: number, denom: number): number | null {
  if (denom === 0) return null;
  return Math.round((num / denom) * 1000) / 10;
}

function parseNum(val: string | null | undefined): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

function buildDealDetail(p: Project, zuperByDeal: Map<string, string>): DealDetail {
  return {
    dealId: String(p.id),
    projectNumber: p.projectNumber,
    name: p.name,
    url: p.url,
    pbLocation: p.pbLocation || "Unknown",
    ahj: p.ahj || "Unknown",
    stage: p.stage || "Unknown",
    amount: p.amount || 0,
    constructionCompleteDate: p.constructionCompleteDate,
    inspectionScheduleDate: p.inspectionScheduleDate,
    inspectionBookedDate: p.inspectionBookedDate,
    inspectionPassDate: p.inspectionPassDate,
    inspectionFailDate: p.inspectionFailDate,
    inspectionFailCount: p.inspectionFailCount,
    inspectionFailureReason: p.inspectionFailureReason,
    isFirstTimePass: p.isFirstTimeInspectionPass,
    inspectionTurnaroundDays: p.inspectionTurnaroundTime ?? daysBetween(p.inspectionBookedDate, p.inspectionPassDate),
    ccToInspectionDays: daysBetween(p.constructionCompleteDate, p.inspectionPassDate),
    finalInspectionStatus: p.finalInspectionStatus,
    zuperJobUid: zuperByDeal.get(String(p.id)) || null,
  };
}

function buildPipelineDeal(p: Project, zuperByDeal: Map<string, string>): PipelineDeal {
  return {
    dealId: String(p.id),
    projectNumber: p.projectNumber,
    name: p.name,
    url: p.url,
    pbLocation: p.pbLocation || "Unknown",
    ahj: p.ahj || "Unknown",
    stage: p.stage || "Unknown",
    amount: p.amount || 0,
    constructionCompleteDate: p.constructionCompleteDate,
    inspectionScheduleDate: p.inspectionScheduleDate,
    inspectionBookedDate: p.inspectionBookedDate,
    inspectionFailDate: p.inspectionFailDate,
    inspectionFailCount: p.inspectionFailCount,
    inspectionFailureReason: p.inspectionFailureReason,
    readyForInspection: p.readyForInspection,
    daysSinceCc: daysSince(p.constructionCompleteDate),
    daysSinceLastFail: daysSince(p.inspectionFailDate),
    zuperJobUid: zuperByDeal.get(String(p.id)) || null,
  };
}

function computeGroupMetrics(projects: Project[]): ComputedMetrics {
  const turnarounds = projects.map((p) =>
    p.inspectionTurnaroundTime ?? daysBetween(p.inspectionBookedDate, p.inspectionPassDate)
  );
  const ccToPass = projects.map((p) =>
    daysBetween(p.constructionCompleteDate, p.inspectionPassDate)
  );
  const passCount = projects.filter((p) => p.isInspectionPassed).length;
  const failCount = projects.filter((p) => p.hasInspectionFailed).length;
  const firstTimePassCount = projects.filter((p) => p.isFirstTimeInspectionPass).length;
  const fprNotRejectedCount = projects.filter((p) => p.isFirstTimePassNotRejected).length;

  return {
    count: projects.length,
    avgTurnaround: safeAvg(turnarounds),
    fpr: safePercent(firstTimePassCount, projects.length),
    fprNotRejected: safePercent(fprNotRejectedCount, projects.length),
    passCount,
    failCount,
    firstTimePassCount,
    avgCcToInspectionPass: safeAvg(ccToPass),
  };
}
```

- [ ] **Step 3: Add rollup extraction and validation functions**

Append to the same file:

```typescript
// ---------------------------------------------------------------------------
// Rollup extraction
// ---------------------------------------------------------------------------

function extractLocationRollup(
  loc: LocationRecord,
  useAllTime: boolean,
): RollupMetrics {
  const p = loc.properties;
  return {
    fpr: parseNum(useAllTime ? p.inspections_fpr : p.inspections_first_time_pass_rate__365_days_),
    // Only 365-day variant available for FPR Not Rejected — no all-time equivalent
    fprNotRejected: parseNum(p.fpr_inspections__365___not_rejected_),
    passCount: parseNum(useAllTime ? p.count_of_inspections_passed : p.total_inspections_passe_d__365_days_),
    failCount: parseNum(useAllTime ? p.count_of_inspections_failed : p.inspections_failed__365_days_),
    firstTimePassCount: parseNum(useAllTime ? p.count_of_inspections_passed_1st_time : p.total_1st_time_passed_inspections__365_days_),
    turnaround: parseNum(useAllTime ? p.inspection_turnaround_time : p.inspection_turnaround_time__365_days_),
    outstandingFailed: parseNum(p.outstanding_failed_inspections),
    outstandingFailedNotRejected: parseNum(p.outstanding_failed_inspections__not_rejected_),
    ccPendingInspection: parseNum(p.cc_pending_inspection),
    constructionTurnaround: parseNum(p.construction_turnaround_time__365_),
  };
}

function extractAHJRollup(
  ahj: AHJRecord,
  daysWindow: number,
): AHJRollupMetrics | null {
  const p = ahj.properties;

  // Only return rollup for windows that match available data
  // AHJ has: all-time FPR, all-time fail count, all-time first time pass count
  // AHJ has: 365-day passed count, 365-day turnaround
  const useAllTime = daysWindow === 0;
  const use365 = daysWindow === 365;

  // If window is 30/60/90/180 — no matching rollup data, return null
  if (!useAllTime && !use365) return null;

  return {
    fpr: useAllTime ? parseNum(p.inspections_fpr) : null,
    passCount: use365 ? parseNum(p.total_inspections_passed__365__) : parseNum(p.count_of_inspections_passed),
    failCount: useAllTime ? parseNum(p.count_of_inspections_failed) : null,
    firstTimePassCount: useAllTime ? parseNum(p.total_first_time_passed_inspections) : null,
    turnaround: parseNum(use365 ? p.inspection_turnaround_time__365_days_ : p.inspection_turnaround_time),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateMetrics(
  computed: ComputedMetrics,
  rollup: { fpr?: number | null; passCount?: number | null; failCount?: number | null; turnaround?: number | null } | null,
  label: string,
): Record<string, number> | null {
  if (!rollup) return null;

  const divergences: Record<string, number> = {};

  const checks: [string, number | null, number | null][] = [
    ["fpr", computed.fpr, rollup.fpr ?? null],
    ["passCount", computed.passCount, rollup.passCount ?? null],
    ["failCount", computed.failCount, rollup.failCount ?? null],
    ["turnaround", computed.avgTurnaround, rollup.turnaround ?? null],
  ];

  for (const [metric, comp, roll] of checks) {
    if (comp === null || roll === null) continue;
    const diff = Math.abs(comp - roll);
    const base = Math.max(Math.abs(comp), Math.abs(roll), 1);
    const pctDiff = (diff / base) * 100;
    if (pctDiff > 5) {
      divergences[metric] = Math.round(pctDiff * 10) / 10;
      console.log(
        `[Inspection Metrics] Validation: ${label} ${metric} diverges by ${divergences[metric]}% — computed=${comp}, rollup=${roll}`
      );
    }
  }

  return Object.keys(divergences).length > 0 ? divergences : null;
}
```

- [ ] **Step 4: Add the GET handler**

Append to the same file:

```typescript
// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const daysWindow = parseInt(searchParams.get("days") || "0") || 0;
    const forceRefresh = searchParams.get("refresh") === "true";

    // 1. Fetch all data sources in parallel
    const [
      { data: allProjects, lastUpdated },
      { data: locationRecords },
      { data: ahjRecords },
    ] = await Promise.all([
      appCache.getOrFetch<Project[]>(
        CACHE_KEYS.PROJECTS_ALL,
        () => fetchAllProjects({ activeOnly: false }),
        forceRefresh,
      ),
      appCache.getOrFetch<LocationRecord[]>(
        CACHE_KEYS.LOCATIONS_ALL,
        () => fetchAllLocations(),
        forceRefresh,
      ),
      appCache.getOrFetch<AHJRecord[]>(
        CACHE_KEYS.AHJS_ALL,
        () => fetchAllAHJs(),
        forceRefresh,
      ),
    ]);

    const projects = allProjects || [];
    const locations = locationRecords || [];
    const ahjs = ahjRecords || [];

    // 2. Build Location lookup by pb_location
    const locationByPbLocation = new Map<string, LocationRecord>();
    for (const loc of locations) {
      const pbLoc = loc.properties.pb_location;
      if (pbLoc) locationByPbLocation.set(pbLoc, loc);
    }

    // 3. Build AHJ lookup by record_name
    const ahjByName = new Map<string, AHJRecord>();
    for (const ahj of ahjs) {
      const name = ahj.properties.record_name;
      if (name) ahjByName.set(name, ahj);
    }

    // 4. Filter projects for stats (completed inspections in window)
    const useAllTime = daysWindow === 0;
    let statsProjects: Project[];

    if (useAllTime) {
      statsProjects = projects.filter((p) => !!p.inspectionPassDate);
    } else {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysWindow);
      const cutoffStr = cutoff.toISOString().split("T")[0];
      statsProjects = projects.filter(
        (p) => p.inspectionPassDate && p.inspectionPassDate >= cutoffStr,
      );
    }

    // 5. Fetch Zuper jobs for all relevant deals
    const allRelevantIds = new Set<string>();
    for (const p of statsProjects) allRelevantIds.add(String(p.id));
    // Also include active projects for action queues
    for (const p of projects) {
      if (p.isActive && (p.constructionCompleteDate || p.hasInspectionFailed)) {
        allRelevantIds.add(String(p.id));
      }
    }
    const zuperJobs = await getCachedZuperJobsByDealIds([...allRelevantIds], "Construction");
    const zuperByDeal = new Map<string, string>();
    for (const job of zuperJobs) {
      if (job.hubspotDealId) zuperByDeal.set(job.hubspotDealId, job.jobUid);
    }

    // 6. Group stats projects by PB Location
    const byLocGroups = groupBy(statsProjects, (p) => p.pbLocation || "Unknown");
    const byLocation: Record<string, LocationGroup> = {};

    for (const [loc, locProjects] of Object.entries(byLocGroups)) {
      if (loc === "Unknown") continue;

      const computed = computeGroupMetrics(locProjects);
      const locRecord = locationByPbLocation.get(loc);
      const rollup = locRecord ? extractLocationRollup(locRecord, useAllTime) : null;
      const divergence = validateMetrics(computed, rollup, `Location:${loc}`);

      // AHJ breakdown within this location
      const ahjGroups = groupBy(locProjects, (p) => p.ahj || "Unknown");
      const ahjBreakdown: Record<string, { computed: ComputedMetrics; deals: DealDetail[] }> = {};
      for (const [ahjName, ahjProjects] of Object.entries(ahjGroups)) {
        if (ahjName === "Unknown") continue;
        ahjBreakdown[ahjName] = {
          computed: computeGroupMetrics(ahjProjects),
          deals: ahjProjects.map((p) => buildDealDetail(p, zuperByDeal)),
        };
      }

      byLocation[loc] = {
        computed,
        rollup,
        divergence,
        deals: locProjects.map((p) => buildDealDetail(p, zuperByDeal)),
        ahjBreakdown,
      };
    }

    // 7. Group stats projects by AHJ (top-level)
    const byAhjGroups = groupBy(statsProjects, (p) => p.ahj || "Unknown");
    const byAHJ: Record<string, AHJGroup> = {};

    // AHJ → Location majority-vote mapping
    const ahjLocationVotes = new Map<string, Map<string, number>>();
    for (const p of projects) {
      if (!p.ahj || !p.pbLocation) continue;
      if (!ahjLocationVotes.has(p.ahj)) ahjLocationVotes.set(p.ahj, new Map());
      const votes = ahjLocationVotes.get(p.ahj)!;
      votes.set(p.pbLocation, (votes.get(p.pbLocation) || 0) + 1);
    }
    function getAhjLocation(ahjName: string): string {
      const votes = ahjLocationVotes.get(ahjName);
      if (!votes || votes.size === 0) return "Unknown";
      let bestLoc = "Unknown";
      let bestCount = 0;
      for (const [loc, count] of votes) {
        if (count > bestCount) { bestLoc = loc; bestCount = count; }
      }
      return bestLoc;
    }

    for (const [ahjName, ahjProjects] of Object.entries(byAhjGroups)) {
      if (ahjName === "Unknown") continue;

      const computed = computeGroupMetrics(ahjProjects);
      const ahjRecord = ahjByName.get(ahjName);
      const rollup = ahjRecord ? extractAHJRollup(ahjRecord, daysWindow) : null;
      const divergence = validateMetrics(computed, rollup, `AHJ:${ahjName}`);

      byAHJ[ahjName] = {
        computed,
        rollup,
        divergence,
        deals: ahjProjects.map((p) => buildDealDetail(p, zuperByDeal)),
        ahjId: ahjRecord?.id || "",
        location: getAhjLocation(ahjName),
        electricianRequired: ahjRecord?.properties.electrician_required_for_inspection_ === "true",
        fireInspectionRequired: ahjRecord?.properties.fire_inspection_required === "true",
        inspectionRequirements: ahjRecord?.properties.inspection_requirements || null,
        inspectionNotes: ahjRecord?.properties.inspection_notes || null,
      };
    }

    // 8. Totals
    const totalsComputed = computeGroupMetrics(statsProjects);
    // Sum location rollups for total validation
    let totalsRollup: RollupMetrics | null = null;
    if (locations.length > 0) {
      const allRollups = locations
        .filter((l) => l.properties.pb_location)
        .map((l) => extractLocationRollup(l, useAllTime));
      totalsRollup = {
        fpr: safeAvg(allRollups.map((r) => r.fpr)),
        fprNotRejected: safeAvg(allRollups.map((r) => r.fprNotRejected)),
        passCount: allRollups.reduce((s, r) => s + (r.passCount ?? 0), 0),
        failCount: allRollups.reduce((s, r) => s + (r.failCount ?? 0), 0),
        firstTimePassCount: allRollups.reduce((s, r) => s + (r.firstTimePassCount ?? 0), 0),
        turnaround: safeAvg(allRollups.map((r) => r.turnaround)),
        outstandingFailed: allRollups.reduce((s, r) => s + (r.outstandingFailed ?? 0), 0),
        outstandingFailedNotRejected: allRollups.reduce((s, r) => s + (r.outstandingFailedNotRejected ?? 0), 0),
        ccPendingInspection: allRollups.reduce((s, r) => s + (r.ccPendingInspection ?? 0), 0),
        constructionTurnaround: safeAvg(allRollups.map((r) => r.constructionTurnaround)),
      };
    }
    const totalsDivergence = validateMetrics(totalsComputed, totalsRollup, "Totals");

    // 9. Action queues — from ALL active projects, not just stats window
    const ccPendingInspection = projects
      .filter((p) =>
        p.constructionCompleteDate &&
        !p.inspectionPassDate &&
        p.isActive
      )
      .map((p) => buildPipelineDeal(p, zuperByDeal))
      .sort((a, b) => (b.daysSinceCc ?? 0) - (a.daysSinceCc ?? 0));

    const outstandingFailed = projects
      .filter((p) =>
        p.hasInspectionFailed &&
        !p.inspectionPassDate &&
        p.isActive
      )
      .map((p) => buildPipelineDeal(p, zuperByDeal))
      .sort((a, b) => (b.daysSinceLastFail ?? 0) - (a.daysSinceLastFail ?? 0));

    return NextResponse.json({
      byLocation,
      byAHJ,
      totals: {
        computed: totalsComputed,
        rollup: totalsRollup,
        divergence: totalsDivergence,
      },
      ccPendingInspection,
      outstandingFailed,
      daysWindow,
      lastUpdated: lastUpdated || new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Inspection Metrics] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch inspection metrics" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 6: Test the API route locally**

Run: `curl -s "http://localhost:3000/api/hubspot/inspection-metrics?days=365" | jq '.totals.computed'`
Expected: JSON with `count`, `avgTurnaround`, `fpr`, `passCount`, `failCount` values.

Also check: `curl -s "http://localhost:3000/api/hubspot/inspection-metrics?days=365" | jq '.totals.divergence'`
Expected: Either `null` (good — no divergence) or an object with metric names and percentages.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/hubspot/inspection-metrics/route.ts
git commit -m "feat(inspection-metrics): create API route with dual-source validation"
```

---

## Chunk 3: Dashboard Page

### Task 6: Create the inspection-metrics dashboard page

**Files:**
- Create: `src/app/dashboards/inspection-metrics/page.tsx`

This is a large file. Build it incrementally — summary cards first, then stats tables, then drill-downs, then action queues.

- [ ] **Step 1: Create the page with imports, types, hooks, and summary cards**

Create `src/app/dashboards/inspection-metrics/page.tsx`. Follow the survey-metrics pattern. Start with:
- `"use client"` directive
- Imports: useState, useEffect, useMemo, useRef, useQuery, DashboardShell, queryKeys, useActivityTracking
- Types mirroring the API response (inline — same as survey-metrics)
- Color threshold helpers for FPR and turnaround
- `useSort` custom hook (same pattern as pending-approval page)
- `SortHeader` component
- Main component: fetches via React Query, renders DashboardShell with green accent
- Filters bar: time window buttons (30/60/90/180/365/All) + PB Location filter buttons
- 4 summary cards: Avg CC → Inspection Pass, Inspections Passed, First-Time Pass Rate, Outstanding Failures

Use `StatCard` from `@/components/ui/MetricCard` for the summary cards. Use the same filter button pattern from survey-metrics. Note: time window buttons include 365 (unlike survey-metrics which stops at 180) — this is intentional because 365-day rollups provide exact parity with HubSpot custom object validation data.

**Important — all hooks before early returns.** This was the React #310 bug in da-metrics. Put all `useState`, `useMemo`, `useRef`, `useQuery` at the top of the component, before any `if (loading)` / `if (error)` early returns.

- [ ] **Step 2: Add Section 1 — Performance by PB Location table**

Table with columns: PB Location, Inspections, Avg Turnaround, FPR (%), Fail Count, Avg CC → Pass.

Clickable rows that expand a drill-down panel inline below the row. Use a `drillDown` state: `{ type: 'location' | 'ahj', key: string, subView: 'deals' | 'ahjs' } | null`. Clicking the same row collapses it.

The drill-down panel appears as a `<tr>` with `colSpan` spanning all columns, containing the detail content. Use a `ref` and `scrollIntoView({ behavior: "smooth", block: "nearest" })` when drill-down opens.

Drill-down has a toggle: "Show Deals" vs "Show AHJs in {location}".

- [ ] **Step 3: Add Section 2 — Performance by AHJ table**

Table with columns: AHJ, PB Location, Inspections, Avg Turnaround, FPR (%), Fail Count, Electrician Required, Fire Inspection Required.

Clickable rows with inline drill-down showing DealDetail rows.

Apply PB Location filter using the `location` field from each AHJ group.

- [ ] **Step 4: Add Section 3 — Outstanding Failed Inspections**

Red left-border. Header description: "Active projects where inspection has failed and hasn't yet passed. These need reinspection or resolution."

Sortable columns: Project, Customer, PB Location, AHJ, Stage, Amount, Fail Date, Fail Count, Failure Reason, Days Since Fail, Links.

Filter by PB Location.

- [ ] **Step 5: Add Section 4 — CC Pending Inspection**

Standard border. Header description: "Construction complete projects waiting on inspection scheduling or results."

Sortable columns: Project, Customer, PB Location, AHJ, Stage, Amount, CC Date, Days Since CC, Inspection Scheduled, Booked Date, Ready for Inspection, Links.

Default sort: Days Since CC descending. Filter by PB Location.

- [ ] **Step 6: Add empty states**

- Stats sections (no inspections in window): muted text
- Action queues (zero items): green check icon with positive message
- Drill-down (zero deals): muted text

- [ ] **Step 7: Verify TypeScript compiles and page renders**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No errors.

Then navigate to `http://localhost:3000/dashboards/inspection-metrics` and verify:
- Summary cards render with data
- PB Location table shows locations
- AHJ table shows AHJs
- Click location row → drill-down expands inline, auto-scrolls
- Toggle between "Show Deals" and "Show AHJs" in location drill-down
- Click AHJ row → deal drill-down expands
- Location filter buttons filter all sections
- Time window buttons change stats
- Action queue tables render

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboards/inspection-metrics/page.tsx
git commit -m "feat(inspection-metrics): create dashboard page with drill-downs and action queues"
```

---

## Chunk 4: Verification & Polish

### Task 7: End-to-end verification

- [ ] **Step 1: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean — 0 errors.

- [ ] **Step 2: Run ESLint**

Run: `npx eslint src/app/api/hubspot/inspection-metrics/route.ts src/app/dashboards/inspection-metrics/page.tsx --fix`
Expected: Clean or auto-fixed.

- [ ] **Step 3: Run existing tests**

Run: `npm test`
Expected: All existing tests pass. No new tests needed for this feature (API route is a thin aggregation layer over existing tested modules; page is UI-only).

- [ ] **Step 4: Verify role-permissions consistency**

Run: `grep -c "inspection-metrics" src/lib/role-permissions.ts`
Expected: 7 (same count as `construction-metrics`).

- [ ] **Step 5: Verify page-directory entry**

Run: `grep "inspection-metrics" src/lib/page-directory.ts`
Expected: One line with `/dashboards/inspection-metrics`.

- [ ] **Step 6: Verify Operations suite card**

Navigate to `http://localhost:3000/suites/operations` and confirm "Inspection Metrics" appears in the Inspections section with the METRICS tag.

- [ ] **Step 7: Final commit if any polish needed**

```bash
git add -A
git commit -m "chore(inspection-metrics): lint fixes and polish"
```
