# Design Pipeline Funnel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a four-stage funnel dashboard (Sales Closed → Survey Done → DA Sent → DA Approved) in the Executive Suite showing deal count and amount at each stage, with cancelled deals greyed out, monthly cohort breakdown, and location filtering.

**Architecture:** Single API route (`/api/deals/funnel`) fetches all projects via `fetchAllProjects({ activeOnly: false })`, aggregates into funnel stages and monthly cohorts using a pure `buildFunnelData()` function. Dashboard page renders four rows: StatCards, funnel bars, grouped bar chart, and cohort table — all using existing CSS-based visualization patterns (no Recharts).

**Tech Stack:** Next.js API route, React client component, Tailwind CSS bars, `appCache` with parameterized keys, React Query + SSE for real-time updates, existing `StatCard` / `DashboardShell` components.

**Spec:** `docs/superpowers/specs/2026-03-30-design-pipeline-funnel-design.md`

---

## Chunk 1: Backend — API Route, Cache, Query Keys

### Task 1: Funnel Aggregation Logic + Tests

**Files:**
- Create: `src/lib/funnel-aggregation.ts`
- Create: `src/__tests__/lib/funnel-aggregation.test.ts`

This is the core pure function — no network calls, fully testable. Extracted into its own file so the API route stays thin and the logic is independently testable.

**Note:** The `FunnelResponse` type adds a `medianDays` field not in the spec's interface. This is an intentional elaboration — the spec's UI requires "median Y days" in the funnel bar conversion arrows (spec line 103) but the response type didn't include it. The field is added here to carry that data.

- [ ] **Step 1: Write the test file with all core scenarios**

```typescript
// src/__tests__/lib/funnel-aggregation.test.ts
import { buildFunnelData } from "@/lib/funnel-aggregation";
import type { Project } from "@/lib/hubspot";

// Minimal Project factory — only fields the funnel uses
function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: Math.floor(Math.random() * 100000),
    name: "Test Deal",
    stageId: "20461937", // Design & Engineering (active)
    amount: 50000,
    closeDate: "2026-02-15",
    siteSurveyCompletionDate: null,
    designApprovalSentDate: null,
    designApprovalDate: null,
    pbLocation: "Denver Tech Center",
    ...overrides,
  } as Project;
}

describe("buildFunnelData", () => {
  it("returns empty funnel when no projects", () => {
    const result = buildFunnelData([], 6);
    expect(result.summary.salesClosed.count).toBe(0);
    expect(result.cohorts).toHaveLength(0);
  });

  it("counts a deal with closeDate as salesClosed only", () => {
    const projects = [makeProject({ closeDate: "2026-02-10" })];
    const result = buildFunnelData(projects, 6);
    expect(result.summary.salesClosed.count).toBe(1);
    expect(result.summary.salesClosed.amount).toBe(50000);
    expect(result.summary.surveyDone.count).toBe(0);
    expect(result.summary.daSent.count).toBe(0);
    expect(result.summary.daApproved.count).toBe(0);
  });

  it("counts a deal with all milestones through all stages", () => {
    const projects = [
      makeProject({
        closeDate: "2026-02-10",
        siteSurveyCompletionDate: "2026-02-20",
        designApprovalSentDate: "2026-02-28",
        designApprovalDate: "2026-03-05",
      }),
    ];
    const result = buildFunnelData(projects, 6);
    expect(result.summary.salesClosed.count).toBe(1);
    expect(result.summary.surveyDone.count).toBe(1);
    expect(result.summary.daSent.count).toBe(1);
    expect(result.summary.daApproved.count).toBe(1);
  });

  it("tracks cancelled deals separately via stageId 68229433", () => {
    const projects = [
      makeProject({
        closeDate: "2026-02-10",
        siteSurveyCompletionDate: "2026-02-20",
        stageId: "68229433", // Cancelled
      }),
    ];
    const result = buildFunnelData(projects, 6);
    expect(result.summary.salesClosed.cancelledCount).toBe(1);
    expect(result.summary.salesClosed.cancelledAmount).toBe(50000);
    expect(result.summary.surveyDone.cancelledCount).toBe(1);
    // Active counts should be 0
    expect(result.summary.salesClosed.count).toBe(0);
    expect(result.summary.surveyDone.count).toBe(0);
  });

  it("groups deals into monthly cohorts by closeDate", () => {
    const projects = [
      makeProject({ closeDate: "2026-01-15", amount: 30000 }),
      makeProject({ closeDate: "2026-01-20", amount: 40000 }),
      makeProject({ closeDate: "2026-02-10", amount: 50000 }),
    ];
    const result = buildFunnelData(projects, 6);
    const jan = result.cohorts.find((c) => c.month === "2026-01");
    const feb = result.cohorts.find((c) => c.month === "2026-02");
    expect(jan?.salesClosed.count).toBe(2);
    expect(jan?.salesClosed.amount).toBe(70000);
    expect(feb?.salesClosed.count).toBe(1);
    expect(feb?.salesClosed.amount).toBe(50000);
  });

  it("cohorts are sorted newest-first", () => {
    const projects = [
      makeProject({ closeDate: "2026-01-15" }),
      makeProject({ closeDate: "2026-03-10" }),
      makeProject({ closeDate: "2026-02-10" }),
    ];
    const result = buildFunnelData(projects, 6);
    expect(result.cohorts[0].month).toBe("2026-03");
    expect(result.cohorts[1].month).toBe("2026-02");
    expect(result.cohorts[2].month).toBe("2026-01");
  });

  it("filters by location when provided", () => {
    const projects = [
      makeProject({ closeDate: "2026-02-10", pbLocation: "Denver Tech Center" }),
      makeProject({ closeDate: "2026-02-12", pbLocation: "Westminster" }),
    ];
    const result = buildFunnelData(projects, 6, "Westminster");
    expect(result.summary.salesClosed.count).toBe(1);
  });

  it("excludes deals outside the months lookback window", () => {
    const projects = [
      makeProject({ closeDate: "2024-01-01" }), // way outside 6-month window
      makeProject({ closeDate: "2026-03-01" }),
    ];
    const result = buildFunnelData(projects, 6);
    expect(result.summary.salesClosed.count).toBe(1);
  });

  it("computes median days between stages", () => {
    const projects = [
      makeProject({
        closeDate: "2026-02-01",
        siteSurveyCompletionDate: "2026-02-11", // 10 days
      }),
      makeProject({
        closeDate: "2026-02-05",
        siteSurveyCompletionDate: "2026-02-25", // 20 days
      }),
      makeProject({
        closeDate: "2026-02-10",
        siteSurveyCompletionDate: "2026-02-16", // 6 days
      }),
    ];
    const result = buildFunnelData(projects, 6);
    // Median of [6, 10, 20] = 10
    expect(result.medianDays.closedToSurvey).toBe(10);
  });

  it("treats Project Rejected (20461935) as active, not cancelled", () => {
    const projects = [
      makeProject({
        closeDate: "2026-02-10",
        stageId: "20461935", // Project Rejected - Needs Review
      }),
    ];
    const result = buildFunnelData(projects, 6);
    expect(result.summary.salesClosed.count).toBe(1);
    expect(result.summary.salesClosed.cancelledCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern="funnel-aggregation" --no-coverage`
Expected: FAIL — module `@/lib/funnel-aggregation` not found

- [ ] **Step 3: Implement `buildFunnelData`**

```typescript
// src/lib/funnel-aggregation.ts
import type { Project } from "@/lib/hubspot";

export interface FunnelStageData {
  count: number;
  amount: number;
  cancelledCount: number;
  cancelledAmount: number;
}

export interface FunnelCohort {
  month: string; // "2026-03"
  salesClosed: FunnelStageData;
  surveyDone: FunnelStageData;
  daSent: FunnelStageData;
  daApproved: FunnelStageData;
}

export interface FunnelMedianDays {
  closedToSurvey: number | null;
  surveyToDaSent: number | null;
  daSentToApproved: number | null;
}

export interface FunnelResponse {
  summary: {
    salesClosed: FunnelStageData;
    surveyDone: FunnelStageData;
    daSent: FunnelStageData;
    daApproved: FunnelStageData;
  };
  cohorts: FunnelCohort[];
  medianDays: FunnelMedianDays;
  generatedAt: string;
}

const CANCELLED_STAGE_ID = "68229433";

function emptyStage(): FunnelStageData {
  return { count: 0, amount: 0, cancelledCount: 0, cancelledAmount: 0 };
}

function daysBetween(a: string, b: string): number {
  // Noon-local parse avoids timezone boundary shifts on YYYY-MM-DD strings
  return Math.round(
    (new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) / (1000 * 60 * 60 * 24)
  );
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function monthKey(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function addToStage(
  stage: FunnelStageData,
  amount: number,
  cancelled: boolean
): void {
  if (cancelled) {
    stage.cancelledCount += 1;
    stage.cancelledAmount += amount;
  } else {
    stage.count += 1;
    stage.amount += amount;
  }
}

export function buildFunnelData(
  projects: Project[],
  months: number,
  location?: string
): FunnelResponse {
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() - months, 1);

  // Filter by closeDate window and optional location
  // Use T12:00:00 noon-local parse to avoid timezone boundary shifts on YYYY-MM-DD strings
  const filtered = projects.filter((p) => {
    if (!p.closeDate) return false;
    if (new Date(p.closeDate + "T12:00:00") < cutoff) return false;
    if (location && location !== "all" && p.pbLocation !== location) return false;
    return true;
  });

  const summary = {
    salesClosed: emptyStage(),
    surveyDone: emptyStage(),
    daSent: emptyStage(),
    daApproved: emptyStage(),
  };

  const cohortMap = new Map<string, FunnelCohort>();
  const daysClosedToSurvey: number[] = [];
  const daysSurveyToDaSent: number[] = [];
  const daysDaSentToApproved: number[] = [];

  for (const p of filtered) {
    const cancelled = p.stageId === CANCELLED_STAGE_ID;
    const amt = p.amount || 0;
    const mk = monthKey(p.closeDate!);

    // Ensure cohort exists
    if (!cohortMap.has(mk)) {
      cohortMap.set(mk, {
        month: mk,
        salesClosed: emptyStage(),
        surveyDone: emptyStage(),
        daSent: emptyStage(),
        daApproved: emptyStage(),
      });
    }
    const cohort = cohortMap.get(mk)!;

    // Sales Closed — always true for deals in the filtered set
    addToStage(summary.salesClosed, amt, cancelled);
    addToStage(cohort.salesClosed, amt, cancelled);

    // Survey Done
    if (p.siteSurveyCompletionDate) {
      addToStage(summary.surveyDone, amt, cancelled);
      addToStage(cohort.surveyDone, amt, cancelled);
      if (!cancelled) {
        daysClosedToSurvey.push(
          daysBetween(p.closeDate!, p.siteSurveyCompletionDate)
        );
      }
    }

    // DA Sent
    if (p.designApprovalSentDate) {
      addToStage(summary.daSent, amt, cancelled);
      addToStage(cohort.daSent, amt, cancelled);
      if (!cancelled && p.siteSurveyCompletionDate) {
        daysSurveyToDaSent.push(
          daysBetween(p.siteSurveyCompletionDate, p.designApprovalSentDate)
        );
      }
    }

    // DA Approved
    if (p.designApprovalDate) {
      addToStage(summary.daApproved, amt, cancelled);
      addToStage(cohort.daApproved, amt, cancelled);
      if (!cancelled && p.designApprovalSentDate) {
        daysDaSentToApproved.push(
          daysBetween(p.designApprovalSentDate, p.designApprovalDate)
        );
      }
    }
  }

  // Sort cohorts newest-first
  const cohorts = [...cohortMap.values()].sort((a, b) =>
    b.month.localeCompare(a.month)
  );

  return {
    summary,
    cohorts,
    medianDays: {
      closedToSurvey: median(daysClosedToSurvey),
      surveyToDaSent: median(daysSurveyToDaSent),
      daSentToApproved: median(daysDaSentToApproved),
    },
    generatedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="funnel-aggregation" --no-coverage`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/funnel-aggregation.ts src/__tests__/lib/funnel-aggregation.test.ts
git commit -m "feat(funnel): add buildFunnelData aggregation logic with tests"
```

---

### Task 2: Cache Key + Query Key Registration

**Files:**
- Modify: `src/lib/cache.ts:256-279` (add FUNNEL key + cascade)
- Modify: `src/lib/query-keys.ts:5-106` (add funnel domain + mapping)

- [ ] **Step 1: Add FUNNEL to CACHE_KEYS in `src/lib/cache.ts`**

After the `REVENUE_GOALS` entry (line 271), add:

```typescript
DESIGN_FUNNEL: (months: number, location: string) =>
  `funnel:design-pipeline:${months}:${location}` as const,
```

After the revenue goals cascade subscription (line 279), add:

```typescript
// Funnel cache cascade: invalidate when project data changes
appCache.subscribe((key) => {
  if (key.startsWith("projects:")) {
    appCache.invalidateByPrefix("funnel:design-pipeline:");
  }
});
```

- [ ] **Step 2: Add funnel domain to `src/lib/query-keys.ts`**

After the `peDeals` domain (line 79), add:

```typescript
funnel: {
  root: ["funnel"] as const,
  designPipeline: (months?: number, location?: string) =>
    [...queryKeys.funnel.root, "design-pipeline", months, location] as const,
},
```

In `cacheKeyToQueryKeys()`, before the final `return []` (line 105), add:

```typescript
if (serverKey.startsWith("funnel")) return [queryKeys.funnel.root];
```

- [ ] **Step 3: Run existing tests to verify nothing broke**

Run: `npm test -- --no-coverage`
Expected: All existing tests PASS (no regressions)

- [ ] **Step 4: Commit**

```bash
git add src/lib/cache.ts src/lib/query-keys.ts
git commit -m "feat(funnel): register cache keys and query key factory"
```

---

### Task 3: API Route Handler

**Files:**
- Create: `src/app/api/deals/funnel/route.ts`

- [ ] **Step 1: Create the API route**

```typescript
// src/app/api/deals/funnel/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { requireApiAuth } from "@/lib/api-auth";
import { fetchAllProjects } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { buildFunnelData } from "@/lib/funnel-aggregation";

export async function GET(request: NextRequest) {
  tagSentryRequest(request);
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    const searchParams = request.nextUrl.searchParams;
    const months = Math.min(
      24,
      Math.max(1, parseInt(searchParams.get("months") || "6") || 6)
    );
    const location = searchParams.get("location") || "all";

    const cacheKey = CACHE_KEYS.DESIGN_FUNNEL(months, location);

    const { data, cached, stale, lastUpdated } = await appCache.getOrFetch(
      cacheKey,
      async () => {
        const projects = await fetchAllProjects({ activeOnly: false });
        return buildFunnelData(
          projects,
          months,
          location === "all" ? undefined : location
        );
      }
    );

    return NextResponse.json({
      ...data,
      cached,
      stale,
      lastUpdated,
    });
  } catch (error) {
    console.error("Error fetching funnel data:", error);
    Sentry.captureException(error);
    const message =
      error instanceof Error ? error.message : String(error);

    if (message.includes("429") || message.includes("RATE_LIMIT")) {
      return NextResponse.json(
        { error: "HubSpot API rate limited. Please try again shortly.", details: message },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch funnel data", details: message },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify the route compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors in `src/app/api/deals/funnel/route.ts`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/deals/funnel/route.ts
git commit -m "feat(funnel): add GET /api/deals/funnel route"
```

---

### Task 4: Route Permissions + Page Directory + DashboardShell Suite Map

**Files:**
- Modify: `src/lib/role-permissions.ts` (add route to 4 roles)
- Modify: `src/lib/page-directory.ts` (add to APP_PAGE_ROUTES)
- Modify: `src/components/DashboardShell.tsx` (add to SUITE_MAP)

- [ ] **Step 1: Add `/dashboards/design-pipeline-funnel` to role-permissions.ts**

Add the route string `"/dashboards/design-pipeline-funnel"` to the `allowedRoutes` array for these roles:
- ADMIN (has `"*"` wildcard — already covered, skip)
- EXECUTIVE (has `"*"` wildcard — already covered, skip)
- PROJECT_MANAGER — add after the existing executive-related routes
- OPERATIONS_MANAGER — add after existing executive-related routes
- TECH_OPS — add to their `allowedRoutes` array (they access D&E suite dashboards and need the cross-link to work)

The API route `/api/deals/funnel` does NOT need a separate allowlist entry — `canAccessRoute` uses segment-boundary prefix matching, and PM/OPS_MGR already have `/api/deals` in their `allowedRoutes`, which covers `/api/deals/funnel` automatically. For TECH_OPS, also add `/api/deals/funnel` explicitly since they may not have a `/api/deals` prefix entry.

- [ ] **Step 2: Add to page-directory.ts**

Insert `"/dashboards/design-pipeline-funnel"` in alphabetical order in the `APP_PAGE_ROUTES` array — between `/dashboards/design` and `/dashboards/design-engineering`.

- [ ] **Step 3: Add to SUITE_MAP in DashboardShell.tsx**

In `src/components/DashboardShell.tsx`, find the `SUITE_MAP` object (line 13). In the Executive Suite section (around line 76-84), add:

```typescript
"/dashboards/design-pipeline-funnel": { href: "/suites/executive", label: "Executive" },
```

This ensures the page gets the correct "Executive" breadcrumb and back-link in the DashboardShell chrome.

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/role-permissions.ts src/lib/page-directory.ts src/components/DashboardShell.tsx
git commit -m "feat(funnel): register route permissions and page directory entry"
```

---

## Chunk 2: Frontend — Dashboard Page

### Task 5: Dashboard Page Scaffold + StatCards

**Files:**
- Create: `src/app/dashboards/design-pipeline-funnel/page.tsx`

Reference files:
- `src/app/dashboards/executive/page.tsx` — data fetching pattern
- `src/components/ui/MetricCard.tsx` — StatCard props: `label`, `value`, `subtitle`, `color`, `href?`
- `src/hooks/useSSE.ts` — SSE subscription for real-time updates
- `src/lib/query-keys.ts` — query key for React Query

- [ ] **Step 1: Create the page file with imports, data fetching, and StatCards**

```typescript
// src/app/dashboards/design-pipeline-funnel/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { useSSE } from "@/hooks/useSSE";
import { queryKeys } from "@/lib/query-keys";
import { formatCurrencyCompact } from "@/lib/format";
import type { FunnelResponse, FunnelStageData } from "@/lib/funnel-aggregation";

const LOCATIONS = [
  "All Locations",
  "Denver Tech Center",
  "Westminster",
  "Colorado Springs",
  "California",
  "Camarillo",
] as const;

const TIMEFRAMES = [
  { label: "3 months", value: 3 },
  { label: "6 months", value: 6 },
  { label: "12 months", value: 12 },
] as const;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(month: string, includeYear = true): string {
  const [y, m] = month.split("-");
  return includeYear ? `${MONTH_NAMES[parseInt(m) - 1]} ${y}` : `${MONTH_NAMES[parseInt(m) - 1]} ${y.slice(2)}`;
}

export default function DesignPipelineFunnelPage() {
  const [months, setMonths] = useState(6);
  const [location, setLocation] = useState("all");

  const { data, isLoading, error, dataUpdatedAt, refetch } = useQuery<FunnelResponse>({
    queryKey: queryKeys.funnel.designPipeline(months, location),
    queryFn: async () => {
      const params = new URLSearchParams({ months: String(months) });
      if (location !== "all") params.set("location", location);
      const res = await fetch(`/api/deals/funnel?${params}`);
      if (!res.ok) throw new Error("Failed to fetch funnel data");
      return res.json();
    },
  });

  useSSE(() => refetch(), { cacheKeyFilter: "funnel" });

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString()
    : null;

  if (error) {
    return (
      <DashboardShell title="Design Pipeline Funnel" accentColor="orange">
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      </DashboardShell>
    );
  }

  const s = data?.summary;

  // Stage-to-stage conversion percentages (using totals: active + cancelled)
  const closedTotal = s ? s.salesClosed.count + s.salesClosed.cancelledCount : 0;
  const surveyTotal = s ? s.surveyDone.count + s.surveyDone.cancelledCount : 0;
  const daSentTotal = s ? s.daSent.count + s.daSent.cancelledCount : 0;
  const daApprovedTotal = s ? s.daApproved.count + s.daApproved.cancelledCount : 0;

  const surveyPct = closedTotal > 0 ? Math.round((surveyTotal / closedTotal) * 100) : 0;
  const daSentPct = surveyTotal > 0 ? Math.round((daSentTotal / surveyTotal) * 100) : 0;
  const daApprovedPct = daSentTotal > 0 ? Math.round((daApprovedTotal / daSentTotal) * 100) : 0;

  return (
    <DashboardShell
      title="Design Pipeline Funnel"
      accentColor="orange"
      fullWidth
      lastUpdated={lastUpdated}
    >
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="bg-surface border border-t-border rounded-lg px-3 py-1.5 text-sm text-foreground"
        >
          {LOCATIONS.map((loc) => (
            <option key={loc} value={loc === "All Locations" ? "all" : loc}>
              {loc}
            </option>
          ))}
        </select>
        <select
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
          className="bg-surface border border-t-border rounded-lg px-3 py-1.5 text-sm text-foreground"
        >
          {TIMEFRAMES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading || !s ? (
        <LoadingSpinner />
      ) : (
        <>
          {/* Row 1: StatCards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="Sales Closed"
              value={s.salesClosed.count + s.salesClosed.cancelledCount}
              subtitle={`${formatCurrencyCompact(s.salesClosed.amount + s.salesClosed.cancelledAmount)}${s.salesClosed.cancelledCount > 0 ? ` · ${s.salesClosed.cancelledCount} cancelled` : ""}`}
              color="orange"
            />
            <StatCard
              label="Survey Done"
              value={s.surveyDone.count + s.surveyDone.cancelledCount}
              subtitle={`${formatCurrencyCompact(s.surveyDone.amount + s.surveyDone.cancelledAmount)} · ${surveyPct}% of closed`}
              color="blue"
            />
            <StatCard
              label="DA Sent"
              value={s.daSent.count + s.daSent.cancelledCount}
              subtitle={`${formatCurrencyCompact(s.daSent.amount + s.daSent.cancelledAmount)} · ${daSentPct}% of surveyed`}
              color="purple"
            />
            <StatCard
              label="DA Approved"
              value={s.daApproved.count + s.daApproved.cancelledCount}
              subtitle={`${formatCurrencyCompact(s.daApproved.amount + s.daApproved.cancelledAmount)} · ${daApprovedPct}% of DA sent`}
              color="green"
            />
          </div>

          {/* Rows 2-4 added in subsequent tasks */}
          <FunnelBars summary={s} medianDays={data.medianDays} />
          <MonthlyFunnelChart cohorts={data.cohorts} />
          <CohortTable cohorts={data.cohorts} />
        </>
      )}
    </DashboardShell>
  );
}

// Placeholder components — implemented in Tasks 6-8
function FunnelBars({ summary, medianDays }: { summary: FunnelResponse["summary"]; medianDays: FunnelResponse["medianDays"] }) {
  return <div className="mb-6" />;
}
function MonthlyFunnelChart({ cohorts }: { cohorts: FunnelResponse["cohorts"] }) {
  return <div className="mb-6" />;
}
function CohortTable({ cohorts }: { cohorts: FunnelResponse["cohorts"] }) {
  return <div />;
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/design-pipeline-funnel/page.tsx
git commit -m "feat(funnel): scaffold dashboard page with filters and StatCards"
```

---

### Task 6: Funnel Bars Component

**Files:**
- Modify: `src/app/dashboards/design-pipeline-funnel/page.tsx` (replace FunnelBars placeholder)

- [ ] **Step 1: Replace the `FunnelBars` placeholder with the full implementation**

```typescript
function FunnelBars({
  summary,
  medianDays,
}: {
  summary: FunnelResponse["summary"];
  medianDays: FunnelResponse["medianDays"];
}) {
  const stages = [
    { key: "salesClosed", label: "Sales Closed", color: "bg-orange-500", data: summary.salesClosed },
    { key: "surveyDone", label: "Survey Done", color: "bg-blue-500", data: summary.surveyDone },
    { key: "daSent", label: "DA Sent", color: "bg-purple-500", data: summary.daSent },
    { key: "daApproved", label: "DA Approved", color: "bg-green-500", data: summary.daApproved },
  ] as const;

  const maxTotal = stages[0].data.count + stages[0].data.cancelledCount || 1;

  // Stage-to-stage conversion using totals (active + cancelled)
  function total(d: FunnelStageData) { return d.count + d.cancelledCount; }

  const conversions = [
    {
      pct: total(stages[0].data) > 0
        ? Math.round((total(stages[1].data) / total(stages[0].data)) * 100)
        : 0,
      days: medianDays.closedToSurvey,
    },
    {
      pct: total(stages[1].data) > 0
        ? Math.round((total(stages[2].data) / total(stages[1].data)) * 100)
        : 0,
      days: medianDays.surveyToDaSent,
    },
    {
      pct: total(stages[2].data) > 0
        ? Math.round((total(stages[3].data) / total(stages[2].data)) * 100)
        : 0,
      days: medianDays.daSentToApproved,
    },
  ];

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5 mb-6">
      <h3 className="text-sm font-semibold text-foreground/80 mb-4">
        Pipeline Throughput
      </h3>
      {stages.map((stage, i) => {
        const active = stage.data.count;
        const cancelled = stage.data.cancelledCount;
        const total = active + cancelled;
        const widthPct = Math.max(2, (total / maxTotal) * 100);
        const activeWidthPct = total > 0 ? (active / total) * 100 : 100;

        return (
          <div key={stage.key}>
            <div className="flex items-center gap-3 mb-1">
              <span className="w-24 text-xs text-muted text-right shrink-0">
                {stage.label}
              </span>
              <div className="flex h-7" style={{ width: `${widthPct}%` }}>
                <div
                  className={`${stage.color} rounded-l-md flex items-center px-2.5 min-w-0`}
                  style={{ width: `${activeWidthPct}%` }}
                >
                  <span className="text-white text-xs font-semibold truncate">
                    {active} · {formatCurrencyCompact(stage.data.amount)}
                  </span>
                </div>
                {cancelled > 0 && (
                  <div
                    className="bg-zinc-600 rounded-r-md flex items-center justify-center px-1.5 min-w-0"
                    style={{ width: `${100 - activeWidthPct}%` }}
                  >
                    <span className="text-zinc-300 text-[10px]">{cancelled}</span>
                  </div>
                )}
              </div>
            </div>
            {/* Conversion arrow between bars */}
            {i < stages.length - 1 && (
              <div className="flex items-center gap-3 mb-2">
                <span className="w-24" />
                <div className="flex items-center gap-1.5 pl-2 text-muted">
                  <span className="text-base">↓</span>
                  <span className="text-[11px]">
                    {conversions[i].pct}% conversion
                    {conversions[i].days != null && ` · median ${conversions[i].days}d`}
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div className="flex gap-4 mt-3 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 bg-orange-500 rounded-sm" /> Active
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 bg-zinc-600 rounded-sm" /> Cancelled
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/design-pipeline-funnel/page.tsx
git commit -m "feat(funnel): implement funnel bars with conversion arrows"
```

---

### Task 7: Monthly Grouped Bar Chart

**Files:**
- Modify: `src/app/dashboards/design-pipeline-funnel/page.tsx` (replace MonthlyFunnelChart placeholder)

Uses CSS-based bars following the existing `MonthlyBarChart` pattern in the codebase — no Recharts.

- [ ] **Step 1: Replace the `MonthlyFunnelChart` placeholder**

```typescript
function MonthlyFunnelChart({
  cohorts,
}: {
  cohorts: FunnelResponse["cohorts"];
}) {
  // Reverse to chronological order for display (oldest left → newest right)
  const chronological = useMemo(() => [...cohorts].reverse(), [cohorts]);

  const maxCount = useMemo(
    () =>
      Math.max(
        1,
        ...chronological.map(
          (c) => c.salesClosed.count + c.salesClosed.cancelledCount
        )
      ),
    [chronological]
  );

  const STAGE_COLORS = [
    { key: "salesClosed", color: "bg-orange-500", label: "Sales Closed" },
    { key: "surveyDone", color: "bg-blue-500", label: "Survey Done" },
    { key: "daSent", color: "bg-purple-500", label: "DA Sent" },
    { key: "daApproved", color: "bg-green-500", label: "DA Approved" },
  ] as const;

  // Uses shared monthLabel() defined at module scope

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5 mb-6">
      <h3 className="text-sm font-semibold text-foreground/80 mb-4">
        Monthly Cohort Trend
      </h3>
      <div className="flex items-end justify-around gap-2" style={{ height: 160 }}>
        {chronological.map((cohort) => (
          <div key={cohort.month} className="flex flex-col items-center gap-1 flex-1 min-w-0">
            <div className="flex gap-0.5 items-end" style={{ height: 130 }}>
              {STAGE_COLORS.map(({ key, color }) => {
                const d = cohort[key as keyof typeof cohort] as FunnelStageData;
                const total = d.count + d.cancelledCount;
                const heightPct = (total / maxCount) * 100;
                return (
                  <div
                    key={key}
                    className={`${color} rounded-t-sm w-3 transition-all duration-300`}
                    style={{ height: `${Math.max(heightPct, total > 0 ? 3 : 0)}%` }}
                    title={`${STAGE_COLORS.find((s) => s.key === key)?.label}: ${total} · ${formatCurrencyCompact(d.amount + d.cancelledAmount)}`}
                  />
                );
              })}
            </div>
            <span className="text-[10px] text-muted truncate">
              {monthLabel(cohort.month, false)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 mt-3 text-[11px] text-muted">
        {STAGE_COLORS.map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 ${color} rounded-sm`} /> {label}
          </span>
        ))}
      </div>
    </div>
  );
}
```

Note: The `useMemo` import is already in the file from Task 5. The `FunnelStageData` type import is also already present.

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/design-pipeline-funnel/page.tsx
git commit -m "feat(funnel): add monthly grouped bar chart"
```

---

### Task 8: Cohort Table

**Files:**
- Modify: `src/app/dashboards/design-pipeline-funnel/page.tsx` (replace CohortTable placeholder)

- [ ] **Step 1: Replace the `CohortTable` placeholder**

```typescript
function CohortTable({ cohorts }: { cohorts: FunnelResponse["cohorts"] }) {
  // Uses shared monthLabel() defined at module scope

  const STAGES = [
    { key: "salesClosed", label: "Sales Closed", textColor: "text-orange-400" },
    { key: "surveyDone", label: "Survey Done", textColor: "text-blue-400" },
    { key: "daSent", label: "DA Sent", textColor: "text-purple-400" },
    { key: "daApproved", label: "DA Approved", textColor: "text-green-400" },
  ] as const;

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5">
      <h3 className="text-sm font-semibold text-foreground/80 mb-3">
        Cohort Detail
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-t-border">
              <th className="text-left py-2 px-2 text-muted font-medium">Month</th>
              {STAGES.map((s) => (
                <th key={s.key} className={`text-center py-2 px-2 font-medium ${s.textColor}`}>
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((cohort, i) => {
              const closedTotal =
                cohort.salesClosed.count + cohort.salesClosed.cancelledCount;

              return (
                <tr
                  key={cohort.month}
                  className={`border-b border-t-border/50 ${i % 2 === 0 ? "bg-surface-2/50" : ""}`}
                >
                  <td className="py-2 px-2 font-semibold text-foreground">
                    {monthLabel(cohort.month)}
                  </td>
                  {STAGES.map((stage) => {
                    const d = cohort[stage.key as keyof typeof cohort] as FunnelStageData;
                    const total = d.count + d.cancelledCount;
                    // Conversion from Sales Closed (not stage-to-stage)
                    const conversionPct =
                      stage.key === "salesClosed" || closedTotal === 0
                        ? null
                        : Math.round((total / closedTotal) * 100);

                    return (
                      <td key={stage.key} className="text-center py-2 px-2">
                        <div className={`font-semibold ${stage.textColor}`}>
                          {total}
                        </div>
                        <div className="text-muted">
                          {formatCurrencyCompact(d.amount + d.cancelledAmount)}
                        </div>
                        {d.cancelledCount > 0 && (
                          <div className="text-zinc-500">
                            {d.cancelledCount} cancelled
                          </div>
                        )}
                        {conversionPct != null && (
                          <div className={`${stage.textColor} text-[10px]`}>
                            {conversionPct}%
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Remove the placeholder components**

Delete the three placeholder function declarations at the bottom of the file (the ones that return empty divs). The real implementations are now inline above them.

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/design-pipeline-funnel/page.tsx
git commit -m "feat(funnel): add cohort table with conversion percentages"
```

---

### Task 9: Suite Navigation Links

**Files:**
- Modify: `src/app/suites/executive/page.tsx` (add funnel card to LINKS array)
- Modify: `src/app/suites/design-engineering/page.tsx` (add cross-link card)

- [ ] **Step 1: Add funnel card to Executive suite**

In `src/app/suites/executive/page.tsx`, find the LINKS array and add this card. Place it after the "Sales Pipeline" card or wherever the "Sales" section or pipeline analytics cards are grouped:

```typescript
{
  href: "/dashboards/design-pipeline-funnel",
  title: "Design Pipeline Funnel",
  description: "Sales → Survey → DA Sent → DA Approved throughput with monthly cohorts and conversion rates.",
  tag: "PIPELINE",
  icon: "📊",
  section: "Pipeline Analytics",
},
```

Use the existing `section` names if "Pipeline Analytics" doesn't exist — check the actual section strings in the file and match the most appropriate one.

- [ ] **Step 2: Add cross-link to Design & Engineering suite**

In `src/app/suites/design-engineering/page.tsx`, add this card to the LINKS array. Place it at the end or in a "Cross-References" or "Related Views" section:

```typescript
{
  href: "/dashboards/design-pipeline-funnel",
  title: "Design Pipeline Funnel",
  description: "Sales-to-DA throughput funnel — shows upstream volume driving design workload.",
  tag: "CROSS-REF",
  icon: "📊",
  section: "Related Views",
},
```

If there's no "Related Views" section already, use whatever section grouping pattern exists in the file.

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No type errors

- [ ] **Step 4: Verify the page loads in dev**

Run: `npm run dev` and navigate to `/dashboards/design-pipeline-funnel`.
Expected: Page loads with filter dropdowns, StatCards (may show zeros if no data), and the empty-state funnel bars/chart/table.

- [ ] **Step 5: Commit**

```bash
git add src/app/suites/executive/page.tsx src/app/suites/design-engineering/page.tsx
git commit -m "feat(funnel): add suite navigation links to Executive and D&E suites"
```

---

## Final Verification

After all tasks are complete:

- [ ] Run full test suite: `npm test -- --no-coverage`
- [ ] Run type check: `npx tsc --noEmit`
- [ ] Run lint: `npm run lint`
- [ ] Manual smoke test: open `/dashboards/design-pipeline-funnel` in dev, verify all 4 rows render with real data, test location and timeframe filters
