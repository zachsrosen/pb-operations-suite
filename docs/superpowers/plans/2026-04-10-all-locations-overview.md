# All Locations Overview + Compliance Attribution Fix — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Zuper compliance to attribute jobs by HubSpot deal location (not tech team), add an aggregate compliance grade, and build a standalone `/office-performance/all` page showing all 5 locations side-by-side.

**Architecture:** The compliance attribution fix changes `computeLocationCompliance()` to look up each Zuper job's `hubspot_deal_id` in `HubSpotProjectCache` to resolve `pbLocation`, falling back to team-based filtering when no deal link exists. A new aggregate grade is computed on `ComplianceSummaryFull` using the existing penalty formula. The all-locations page fetches data for all 5 locations in parallel via a new `/api/office-performance/all` route.

**Tech Stack:** Next.js 16.1, React 19, TypeScript 5, Prisma 7.3 (Neon Postgres), Tailwind v4, React Query v5

**Spec:** `docs/superpowers/specs/2026-04-10-all-locations-overview-design.md`

---

## Chunk 1: Compliance Attribution Fix

### Task 1: Extract and export `extractHubspotDealId` for shared use

The deal-ID extraction logic lives in `zuper-sync.ts` as a module-private function. Compliance needs the same logic.

**Files:**
- Modify: `src/lib/compliance-helpers.ts`
- Reference: `src/lib/zuper-sync.ts:24-73` (existing `normalizeHubspotDealIdValue` + `extractHubspotDealId`)

- [ ] **Step 1: Add `extractHubspotDealIdFromJob` to compliance-helpers.ts**

Add at the bottom of the constants/helpers section (after `CATEGORY_UID_TO_NAME`, around line 80). This is a self-contained copy rather than importing from zuper-sync to avoid pulling in that module's dependencies.

```typescript
/**
 * Normalize a raw hubspot deal ID value — may be a plain numeric ID
 * or a full HubSpot URL like https://app.hubspot.com/contacts/.../record/0-3/12345.
 */
function normalizeHubspotDealIdValue(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) return trimmed;
  const urlMatch = trimmed.match(/\/record\/[^/]+\/(\d+)/);
  if (urlMatch) return urlMatch[1];
  const tailMatch = trimmed.match(/(\d{5,})(?!.*\d)/);
  if (tailMatch) return tailMatch[1];
  return undefined;
}

/**
 * Extract the HubSpot deal ID from a Zuper job's custom_fields or tags.
 * Returns the numeric deal ID as a string, or undefined if not found.
 */
export function extractHubspotDealIdFromJob(
  job: Record<string, unknown>
): string | undefined {
  // 1. Check custom_fields array
  const customFields = job.custom_fields;
  if (Array.isArray(customFields)) {
    for (const field of customFields) {
      const label = String(field?.label || "").toLowerCase();
      if (label.includes("hubspot") || label.includes("deal_id") || label.includes("deal id")) {
        const val = String(field?.value || "").trim();
        const normalized = normalizeHubspotDealIdValue(val);
        if (normalized) return normalized;
      }
    }
  }

  // 2. Check job_tags for patterns like hs:12345 or deal:12345
  const tags = job.job_tags;
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      const match = String(tag).match(/^(?:hs|deal)[:\-](\d+)$/i);
      if (match) return match[1];
    }
  }

  return undefined;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | grep compliance-helpers`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/compliance-helpers.ts
git commit -m "feat(compliance): add extractHubspotDealIdFromJob helper for deal-location attribution"
```

---

### Task 2: Change `computeLocationCompliance()` to attribute by deal location

**Files:**
- Modify: `src/lib/compliance-compute.ts:92-425`

- [ ] **Step 1: Add imports and deal-location lookup**

At the top of `compliance-compute.ts`, update imports:

Add `extractHubspotDealIdFromJob` and `AssignedUser` to the existing compliance-helpers import:

```typescript
import {
  STUCK_STATUSES,
  NEVER_STARTED_STATUSES,
  COMPLETED_STATUSES,
  GRACE_MS,
  getStatusName,
  getCompletedTimeFromHistory,
  getOnOurWayTime,
  getStartedTime,
  extractAssignedUsers,
  filterAssignedUsersByTeam,
  computeGrade,
  fetchJobsForCategory,
  extractHubspotDealIdFromJob,
  type AssignedUser,
} from "@/lib/compliance-helpers";
```

Add `prisma` to the existing `@/lib/db` import:

```typescript
import { getActiveCrewMembers, prisma } from "@/lib/db";
```

Add a new import for `normalizeLocation`:

```typescript
import { normalizeLocation } from "@/lib/locations";
```

- [ ] **Step 2: Add deal-location map before the job loop**

Inside `computeLocationCompliance()`, after fetching jobs from Zuper (after the `fetchJobsForCategory` call, around line 120) and before the job loop, add:

```typescript
  // Build deal ID → pbLocation lookup from HubSpotProjectCache.
  // This lets us attribute jobs to the correct location by their linked
  // HubSpot deal, rather than by the tech's team assignment.
  const projectCacheRows = await prisma.hubSpotProjectCache.findMany({
    select: { dealId: true, pbLocation: true },
  });
  const dealLocationMap = new Map<string, string>();
  for (const row of projectCacheRows) {
    if (row.pbLocation) {
      dealLocationMap.set(row.dealId, row.pbLocation);
    }
  }
```

- [ ] **Step 3: Replace team-based filtering with deal-location attribution**

In the job loop (currently lines ~175-180), replace the team-based filtering:

**Current code:**
```typescript
    const assignedUsers = extractAssignedUsers(job, assignmentOptions);
    const filteredUsers = filterAssignedUsersByTeam(assignedUsers, teamFilter);

    // Skip jobs with no users matching this location's team
    if (filteredUsers.length === 0) continue;
```

**New code:**
```typescript
    const assignedUsers = extractAssignedUsers(job, assignmentOptions);

    // Attribute job by HubSpot deal location when possible, fall back to team.
    // `AssignedUser` is imported from compliance-helpers (added in Step 1).
    let filteredUsers: AssignedUser[];
    const dealId = extractHubspotDealIdFromJob(job as Record<string, unknown>);
    const dealPbLocation = dealId ? dealLocationMap.get(dealId) : undefined;
    const normalizedDealLocation = dealPbLocation
      ? normalizeLocation(dealPbLocation)
      : null;

    if (normalizedDealLocation) {
      // Deal has a known location — attribute to that location
      if (normalizedDealLocation !== location) continue; // wrong location, skip
      // All assigned users count toward this location regardless of team
      filteredUsers = assignedUsers;
    } else {
      // No deal link or unknown location — fall back to team-based filtering
      filteredUsers = filterAssignedUsersByTeam(assignedUsers, teamFilter);
      if (filteredUsers.length === 0) continue;
    }
```

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | grep compliance-compute`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/compliance-compute.ts
git commit -m "fix(compliance): attribute jobs by HubSpot deal pb_location, fall back to team"
```

---

### Task 3: Add aggregate grade to `ComplianceSummaryFull` and `SectionCompliance`

**Files:**
- Modify: `src/lib/compliance-compute.ts` (type + computation)
- Modify: `src/lib/office-performance-types.ts` (SectionCompliance type)
- Modify: `src/lib/office-performance.ts` (thread aggregate grade)

- [ ] **Step 1: Add fields to ComplianceSummaryFull**

In `compliance-compute.ts`, add to the `ComplianceSummaryFull` interface (around line 52-64):

```typescript
  /** Aggregate compliance score: onTime% - stuck% - neverStarted% (floor 0) */
  aggregateScore: number;
  /** Letter grade from aggregateScore */
  aggregateGrade: string;
```

- [ ] **Step 2: Compute aggregate grade in the summary block**

In `computeLocationCompliance()`, find the aggregate summary block (around line 387-423). The `aggMeasurable` and `oowTotal` variables are computed on lines ~387-388, then the `const summary: ComplianceSummaryFull = { ... }` literal follows.

Add the aggregate score computation **between** the `oowTotal` line and the `const summary` declaration — BEFORE the summary object is constructed, so the values can be included in the literal:

```typescript
  const aggMeasurable = aggAcc.onTimeCompletions + aggAcc.lateCompletions;
  const oowTotal = aggAcc.oowOnTime + aggAcc.oowLate;

  // Aggregate compliance score — same penalty formula as per-employee
  const aggOnTimePercent = aggMeasurable > 0
    ? Math.round((aggAcc.onTimeCompletions / aggMeasurable) * 100) : -1;
  const aggStuckRate = aggAcc.totalJobs > 0 ? aggAcc.stuckJobs / aggAcc.totalJobs : 0;
  const aggNeverStartedRate = aggAcc.totalJobs > 0 ? aggAcc.neverStartedJobs / aggAcc.totalJobs : 0;
  const aggRawOnTime = aggOnTimePercent >= 0 ? aggOnTimePercent : 0;
  const aggregateScore = Math.max(
    0,
    Math.round((aggRawOnTime - aggStuckRate * 100 - aggNeverStartedRate * 100) * 10) / 10
  );
```

Then include the fields **inside** the `const summary` object literal (alongside the existing fields):

```typescript
  const summary: ComplianceSummaryFull = {
    totalJobs: aggAcc.totalJobs,
    completedJobs: aggAcc.completedJobs,
    onTimePercent: aggOnTimePercent,  // ← use the pre-computed variable now
    // ... rest of existing fields ...
    aggregateScore,
    aggregateGrade: computeGrade(aggregateScore),
  };
```

**Note:** Since `aggOnTimePercent` is now computed before the summary, replace the inline `aggMeasurable > 0 ? Math.round((...) * 100) : -1` expression in the summary's `onTimePercent` field with just `aggOnTimePercent` to avoid duplication.

- [ ] **Step 3: Add `aggregateGrade` to `SectionCompliance` in office-performance-types.ts**

Add to the `SectionCompliance` interface:

```typescript
  /** Location-level aggregate compliance grade */
  aggregateGrade: string;
  /** Location-level aggregate compliance score */
  aggregateScore: number;
```

- [ ] **Step 4: Thread aggregate grade through office-performance.ts**

In `office-performance.ts`, in each of the three compliance-patching blocks (lines ~1622-1660), add the new fields. For example, in the survey compliance patch:

```typescript
      aggregateGrade: surveyCompliance.summary.aggregateGrade,
      aggregateScore: surveyCompliance.summary.aggregateScore,
```

Same for install and inspection patches.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "(compliance-compute|office-performance)"` 
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/compliance-compute.ts src/lib/office-performance-types.ts src/lib/office-performance.ts
git commit -m "feat(compliance): add aggregate compliance grade to summary"
```

---

### Task 2.5: Apply deal-location attribution to `zuper/compliance/route.ts`

The spec calls out that `src/app/api/zuper/compliance/route.ts` has its own copy of the scoring loop, separate from `compliance-compute.ts`. It uses `filterAssignedUsersByTeam` in 5 places (lines ~256, ~584, ~767, ~853, ~956). The same deal-location-first attribution must be applied here.

**Key difference from Task 2:** This route filters by `teamFilter` (a lowercase team name string from query params, e.g., `"westminster"`), not a canonical location name. The deal-location logic must map team filter values to canonical locations.

**Files:**
- Modify: `src/app/api/zuper/compliance/route.ts`

- [ ] **Step 1: Add imports**

Add `extractHubspotDealIdFromJob` to the existing `compliance-helpers` import, add `prisma` to the `db` import, and add `normalizeLocation`:

```typescript
import { getActiveCrewMembers, prisma } from "@/lib/db";
import {
  // ... existing imports ...
  extractHubspotDealIdFromJob,
} from "@/lib/compliance-helpers";
import { normalizeLocation } from "@/lib/locations";
```

- [ ] **Step 2: Add team→location mapping and deal-location map**

Add a constant mapping team filter strings to canonical locations (above the GET handler or at the top of the file near constants):

```typescript
/** Map team filter strings to the canonical locations that team serves. */
const TEAM_TO_CANONICAL_LOCATIONS: Record<string, string[]> = {
  "westminster": ["Westminster"],
  "centennial": ["Centennial"],
  "colorado springs": ["Colorado Springs"],
  "san luis obispo": ["San Luis Obispo", "Camarillo"],
  "camarillo": ["Camarillo"], // defensive — Camarillo crew is on SLO team but has its own canonical location
};
```

Then inside the GET handler, after the existing `assignmentOptions` setup and before the first loop, add the deal-location lookup:

```typescript
    // Build deal ID → pbLocation lookup from HubSpotProjectCache
    const projectCacheRows = await prisma.hubSpotProjectCache.findMany({
      select: { dealId: true, pbLocation: true },
    });
    const dealLocationMap = new Map<string, string>();
    for (const row of projectCacheRows) {
      if (row.pbLocation) {
        dealLocationMap.set(row.dealId, row.pbLocation);
      }
    }

    // Resolve which canonical locations are valid for the current team filter
    const validLocationsForTeam = teamFilter
      ? new Set(TEAM_TO_CANONICAL_LOCATIONS[teamFilter] || [])
      : null; // null = no team filter, accept all
```

- [ ] **Step 3: Add a helper function for deal-location filtering**

Since this pattern is used 5 times, add a local helper to avoid repetition:

```typescript
    /** Apply deal-location attribution, falling back to team-based filtering. */
    function applyDealLocationFilter(
      job: Record<string, unknown>,
      assignedUsers: { userUid: string; userName: string; teamNames: string[] }[],
    ): { users: typeof assignedUsers; skip: boolean } {
      if (!teamFilter) {
        // No team filter — accept all users (existing behavior)
        return { users: assignedUsers, skip: false };
      }

      const dealId = extractHubspotDealIdFromJob(job);
      const dealPbLocation = dealId ? dealLocationMap.get(dealId) : undefined;
      const normalizedDealLocation = dealPbLocation
        ? normalizeLocation(dealPbLocation)
        : null;

      if (normalizedDealLocation && validLocationsForTeam) {
        if (validLocationsForTeam.has(normalizedDealLocation)) {
          // Deal location matches this team's territory — include ALL techs on the job
          return { users: assignedUsers, skip: false };
        } else {
          // Deal location is known but doesn't match this team — skip
          return { users: [], skip: true };
        }
      }

      // No deal location — fall back to team-based filtering
      const filtered = filterAssignedUsersByTeam(assignedUsers, teamFilter);
      return { users: filtered, skip: filtered.length === 0 };
    }
```

- [ ] **Step 4: Replace team filtering in all 5 loops**

For each of the 5 `filterAssignedUsersByTeam` call sites, replace with the helper. Example for the first instance (~line 256):

**Current:**
```typescript
      const filteredAssignedUsers = filterAssignedUsersByTeam(assignedUsers, teamFilter);
```

**New:**
```typescript
      const { users: filteredAssignedUsers, skip: skipJob } = applyDealLocationFilter(
        job as Record<string, unknown>,
        assignedUsers
      );
```

**Important per-loop notes:**
- **Loop 1 (~line 256):** Does NOT skip on empty `filteredAssignedUsers` (it tracks filter options for categories/teams). Do NOT add a `continue` for `skipJob` here — let the existing empty-check logic handle it.
- **Loops 2-5 (~lines 584, 767, 853, 956):** All have `if (filteredAssignedUsers.length === 0) continue;` right after. Replace that with `if (skipJob || filteredAssignedUsers.length === 0) continue;` or simply `if (skipJob) continue;` since the helper already sets `skip: true` when `users` is empty.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "zuper/compliance"`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/app/api/zuper/compliance/route.ts
git commit -m "fix(compliance): apply deal-location attribution to zuper compliance route"
```

---

## Chunk 2: All Locations Overview Page

### Task 4: Add types for the all-locations response

**Files:**
- Modify: `src/lib/office-performance-types.ts`

- [ ] **Step 1: Add overview types**

Add at the bottom of `office-performance-types.ts`:

```typescript
/** Overview metrics for a single category at a single location */
export interface CategoryOverview {
  completedMtd: number;
  avgDays: number;
  scheduledThisWeek: number;
  onTimePercent: number;
  grade: string;
  stuckCount: number;
}

/** Overview metrics for a single location across all categories */
export interface LocationOverview {
  location: string;
  surveys: CategoryOverview;
  installs: CategoryOverview & { kwInstalledMtd: number };
  inspections: CategoryOverview & {
    firstPassRate: number;
  };
}

/** Response shape for /api/office-performance/all */
export interface AllLocationsResponse {
  locations: LocationOverview[];
  lastUpdated: string;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | grep office-performance-types`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/office-performance-types.ts
git commit -m "feat(office-perf): add AllLocationsResponse types"
```

---

### Task 5: Create the `/api/office-performance/all` API route

**Files:**
- Create: `src/app/api/office-performance/all/route.ts`
- Reference: `src/app/api/office-performance/[location]/route.ts` (pattern to follow)
- Reference: `src/lib/office-performance.ts` (`getOfficePerformanceData`)
- Reference: `src/lib/locations.ts` (`CANONICAL_LOCATIONS`)

- [ ] **Step 1: Create the route directory**

Run: `mkdir -p src/app/api/office-performance/all`

- [ ] **Step 2: Write the API route**

Create `src/app/api/office-performance/all/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { CANONICAL_LOCATIONS } from "@/lib/locations";
import { getOfficePerformanceData } from "@/lib/office-performance";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import type {
  AllLocationsResponse,
  LocationOverview,
  OfficePerformanceData,
} from "@/lib/office-performance-types";

function stripToOverview(data: OfficePerformanceData): LocationOverview {
  const surveyCompliance = data.surveys.compliance;
  const installCompliance = data.installs.compliance;
  const inspectionCompliance = data.inspections.compliance;

  return {
    location: data.location,
    surveys: {
      completedMtd: data.surveys.completedMtd,
      avgDays: data.surveys.avgTurnaroundDays,
      scheduledThisWeek: data.surveys.scheduledThisWeek,
      onTimePercent: surveyCompliance?.onTimePercent ?? -1,
      grade: surveyCompliance?.aggregateGrade ?? "—",
      stuckCount: surveyCompliance?.stuckJobs.length ?? 0,
    },
    installs: {
      completedMtd: data.installs.completedMtd,
      avgDays: data.installs.avgDaysPerInstall,
      scheduledThisWeek: data.installs.scheduledThisWeek,
      onTimePercent: installCompliance?.onTimePercent ?? -1,
      grade: installCompliance?.aggregateGrade ?? "—",
      stuckCount: installCompliance?.stuckJobs.length ?? 0,
      kwInstalledMtd: data.installs.kwInstalledMtd,
    },
    inspections: {
      completedMtd: data.inspections.completedMtd,
      avgDays: data.inspections.avgCcToPtoDays,
      scheduledThisWeek: data.inspections.scheduledThisWeek,
      onTimePercent: inspectionCompliance?.onTimePercent ?? -1,
      grade: inspectionCompliance?.aggregateGrade ?? "—",
      stuckCount: inspectionCompliance?.stuckJobs.length ?? 0,
      firstPassRate: data.inspections.firstPassRate,
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";

    // Use CACHE_KEYS.OFFICE_PERFORMANCE("all") — same pattern as per-location routes
    const cacheKey = CACHE_KEYS.OFFICE_PERFORMANCE("all");

    const { data, cached, stale, lastUpdated } =
      await appCache.getOrFetch<AllLocationsResponse>(
        cacheKey,
        async () => {
          // Fetch all locations in parallel
          const locationData = await Promise.all(
            CANONICAL_LOCATIONS.map((loc) =>
              getOfficePerformanceData(loc).catch((err) => {
                console.error(`[office-perf/all] Failed to fetch ${loc}:`, err);
                return null;
              })
            )
          );

          const locations: LocationOverview[] = locationData
            .filter((d): d is OfficePerformanceData => d !== null)
            .map(stripToOverview);

          return {
            locations,
            lastUpdated: new Date().toISOString(),
          };
        },
        forceRefresh  // 3rd arg is boolean, not options object
      );

    return NextResponse.json({ ...data, cached, stale, lastUpdated });
  } catch (error) {
    console.error("[office-perf/all] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch all-locations data" },
      { status: 500 }
    );
  }
}
```

**Note:** The `appCache.getOrFetch` signature is `getOrFetch<T>(key, fetcher, forceRefresh?)` where `forceRefresh` is a boolean (not an options object). The TTL is set at `CacheStore` construction time (default 5 min). The return shape is `{ data, cached, stale, lastUpdated }` — spread `data` into the response to match the per-location route pattern.

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "office-performance/all"`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/app/api/office-performance/all/route.ts
git commit -m "feat(office-perf): add /api/office-performance/all route"
```

---

### Task 6: Build the `AllLocationsSection` component

**Files:**
- Create: `src/app/dashboards/office-performance/[location]/AllLocationsSection.tsx`
- Reference: `src/app/dashboards/office-performance/[location]/ComplianceBlock.tsx` (color helpers)

- [ ] **Step 1: Create the component**

Create `src/app/dashboards/office-performance/[location]/AllLocationsSection.tsx`:

```tsx
"use client";

import type { LocationOverview } from "@/lib/office-performance-types";
import CountUp from "./CountUp";

interface AllLocationsSectionProps {
  locations: LocationOverview[];
}

function gradeColor(grade: string): string {
  switch (grade) {
    case "A": return "#22c55e";
    case "B": return "#3b82f6";
    case "C": return "#eab308";
    case "D": return "#f97316";
    default: return "#ef4444";
  }
}

function onTimeColor(pct: number): string {
  if (pct < 0) return "#475569";
  if (pct >= 90) return "#22c55e";
  if (pct >= 75) return "#eab308";
  return "#ef4444";
}

function stuckColor(count: number): string {
  if (count === 0) return "#22c55e";
  if (count <= 2) return "#eab308";
  return "#ef4444";
}

function MetricRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-baseline text-sm py-0.5">
      <span className="text-slate-500 text-xs">{label}</span>
      <span className="font-semibold text-slate-200">{children}</span>
    </div>
  );
}

function CategoryBlock({
  title,
  titleColor,
  loc,
  category,
  extraRows,
}: {
  title: string;
  titleColor: string;
  loc: LocationOverview;
  category: "surveys" | "installs" | "inspections";
  extraRows?: React.ReactNode;
}) {
  const data = loc[category];
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] font-bold tracking-wider mb-1.5" style={{ color: titleColor }}>
        {title}
      </div>
      <MetricRow label="Completed">
        <CountUp value={data.completedMtd} className="text-sm font-bold text-slate-200" />
      </MetricRow>
      <MetricRow label="Avg Days">
        <CountUp value={data.avgDays} decimals={1} className="text-sm font-bold text-slate-200" />
      </MetricRow>
      <MetricRow label="On-time">
        <span style={{ color: onTimeColor(data.onTimePercent) }}>
          {data.onTimePercent >= 0 ? `${data.onTimePercent}%` : "—"}
        </span>
      </MetricRow>
      <MetricRow label="Grade">
        <span className="text-base font-bold" style={{ color: gradeColor(data.grade) }}>
          {data.grade}
        </span>
      </MetricRow>
      <MetricRow label="Stuck">
        <span style={{ color: stuckColor(data.stuckCount) }}>{data.stuckCount}</span>
      </MetricRow>
      <MetricRow label="This Week">
        <CountUp value={data.scheduledThisWeek} className="text-sm font-bold text-slate-200" />
      </MetricRow>
      {extraRows}
    </div>
  );
}

export default function AllLocationsSection({ locations }: AllLocationsSectionProps) {
  return (
    <div className="flex flex-col h-full px-6 py-5 overflow-hidden">
      {/* Header */}
      <div className="text-center mb-4 flex-shrink-0">
        <h1 className="text-2xl font-extrabold text-white tracking-tight">
          ALL LOCATIONS — PERFORMANCE OVERVIEW
        </h1>
        <div className="text-xs text-slate-500 mt-1">
          Score = On-time% − Stuck% − Not-started% · A ≥90 · B ≥80 · C ≥70 · D ≥60 · F &lt;60
        </div>
      </div>

      {/* Five-column location grid */}
      <div className="grid grid-cols-5 gap-4 flex-1 min-h-0">
        {locations.map((loc) => (
          <div key={loc.location} className="flex flex-col gap-2 overflow-hidden">
            {/* Location header */}
            <div className="text-center px-2 py-2 rounded-xl bg-white/[0.04] border border-white/5">
              <div className="text-lg font-bold text-white">{loc.location}</div>
            </div>

            {/* Survey block */}
            <CategoryBlock
              title="SURVEYS"
              titleColor="#3b82f6"
              loc={loc}
              category="surveys"
            />

            {/* Install block */}
            <CategoryBlock
              title="INSTALLS"
              titleColor="#22c55e"
              loc={loc}
              category="installs"
              extraRows={
                <MetricRow label="kW Installed">
                  <CountUp
                    value={(loc.installs as LocationOverview["installs"]).kwInstalledMtd}
                    decimals={1}
                    className="text-sm font-bold text-slate-200"
                  />
                </MetricRow>
              }
            />

            {/* Inspection block */}
            <CategoryBlock
              title="INSPECTIONS"
              titleColor="#06b6d4"
              loc={loc}
              category="inspections"
              extraRows={
                <MetricRow label="Pass Rate">
                  <span style={{
                    color: onTimeColor(
                      (loc.inspections as LocationOverview["inspections"]).firstPassRate
                    ),
                  }}>
                    {(loc.inspections as LocationOverview["inspections"]).firstPassRate > 0
                      ? `${(loc.inspections as LocationOverview["inspections"]).firstPassRate}%`
                      : "—"}
                  </span>
                </MetricRow>
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | grep AllLocationsSection`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/office-performance/\[location\]/AllLocationsSection.tsx
git commit -m "feat(office-perf): add AllLocationsSection component"
```

---

### Task 7: Wire the `"all"` slug into the page route

**Files:**
- Modify: `src/app/dashboards/office-performance/[location]/page.tsx`
- Modify: `src/lib/locations.ts` (optional — add "all" to slug map)

- [ ] **Step 1: Update page.tsx to handle "all" slug**

The page needs a branch: if slug is `"all"`, fetch from `/api/office-performance/all` and render `AllLocationsSection`. Otherwise, keep existing behavior.

Add the `AllLocationsSection` import at the top:

```typescript
import AllLocationsSection from "./AllLocationsSection";
import type { AllLocationsResponse } from "@/lib/office-performance-types";
```

Then, early in the component — **before** the `if (!canonicalLocation)` check (around line 62), add the "all" branch:

```typescript
  // "All locations" overview — standalone page, no carousel
  if (slug === "all") {
    return <AllLocationsOverviewPage />;
  }
```

Then add the `AllLocationsOverviewPage` function above or below the main component in the same file:

```typescript
function AllLocationsOverviewPage() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.officePerformance.location("all"),
    queryFn: async (): Promise<AllLocationsResponse> => {
      const res = await fetch("/api/office-performance/all?refresh=true");
      if (!res.ok) throw new Error("Failed to fetch all-locations data");
      // The API returns { locations, lastUpdated, cached, stale } — spread at root level
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="h-screen w-screen flex items-center justify-center" style={{
        background: "linear-gradient(135deg, #1e293b, #0f172a)",
        color: "#e2e8f0",
        fontFamily: "system-ui, sans-serif",
      }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <div className="text-lg font-semibold">All Locations</div>
          <div className="text-slate-400 text-sm mt-1">Loading performance data...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden" style={{
      background: "linear-gradient(135deg, #1e293b, #0f172a)",
      fontFamily: "system-ui, sans-serif",
    }}>
      <AllLocationsSection locations={data.locations} />
    </div>
  );
}
```

**Note:** `queryKeys.officePerformance.location("all")` already works — it's `(slug: string) => [root, slug]`. The `AllLocationsResponse` type includes `locations` and `lastUpdated` at the root level.

- [ ] **Step 2: Add `"all"` query key to query-keys.ts**

Check `src/lib/query-keys.ts` — the existing `officePerformance.location(slug)` pattern should already work with `"all"` as a string parameter. No change needed if it's a generic `(slug: string) => [...]` factory.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "(office-performance|AllLocations)"`
Expected: No errors

- [ ] **Step 4: Run lint on all touched files**

Run: `npx eslint src/app/dashboards/office-performance/\[location\]/page.tsx src/app/dashboards/office-performance/\[location\]/AllLocationsSection.tsx src/app/api/office-performance/all/route.ts src/lib/compliance-compute.ts src/lib/compliance-helpers.ts src/lib/office-performance-types.ts src/lib/office-performance.ts`
Expected: No errors (warnings OK if pre-existing)

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/office-performance/\[location\]/page.tsx
git commit -m "feat(office-perf): wire /office-performance/all page route"
```

---

### Task 8: Verify end-to-end

- [ ] **Step 1: Build check**

Run: `npm run build`
Expected: Successful build with no errors in the office-performance or compliance files.

- [ ] **Step 2: Manual verification**

Navigate to `http://localhost:3000/dashboards/office-performance/all` in a browser and verify:
- All 5 locations render in columns
- Each column shows Surveys / Installs / Inspections blocks
- Grades are colored correctly
- Numbers populate (or show loading → data)

- [ ] **Step 3: Verify existing per-location pages still work**

Navigate to `http://localhost:3000/dashboards/office-performance/westminster` and verify:
- Compliance grades still display
- No regressions in the per-employee breakdown

- [ ] **Step 4: Final commit and push**

```bash
git push origin main
```
