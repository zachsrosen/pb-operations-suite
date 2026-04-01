# Preconstruction Metrics Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a preconstruction metrics dashboard combining site survey, design approval, and P&I KPIs with 12-month trend charts, living in the Executive suite.

**Architecture:** Single client-side page consuming the existing `/api/projects?context=executive` endpoint. Filters and metrics computed client-side with `useMemo`. Follows the established pattern from `pi-metrics/page.tsx` and `de-metrics/page.tsx`.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Tailwind v4, Zustand (filter persistence), existing `DashboardShell`/`StatCard`/`MonthlyBarChart`/`MultiSelectFilter` components.

**Spec:** `docs/superpowers/specs/2026-03-23-preconstruction-metrics-design.md`

---

## Chunk 1: Bug Fix and Infrastructure

### Task 1: Fix `aggregateMonthly` timezone bug

**Files:**
- Modify: `src/components/ui/MonthlyBarChart.tsx:61`

**Context:** `aggregateMonthly` parses date-only strings like `"2026-03-01"` with `new Date(item.date)`, which treats them as UTC midnight. In US timezones this shifts first-of-month dates into the previous month. The `isInWindow` helper in `pi-metrics/page.tsx:44` already solves this with `new Date(dateStr + "T12:00:00")`.

- [ ] **Step 1: Write a failing test**

Create `src/__tests__/components/aggregateMonthly.test.ts`:

```ts
import { aggregateMonthly } from "@/components/ui/MonthlyBarChart";

describe("aggregateMonthly", () => {
  beforeEach(() => {
    // Pin system time so the 12-month rolling window is deterministic
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-23T12:00:00"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("buckets first-of-month dates into the correct month", () => {
    // 2026-03-01 should land in March, not February
    const items = [
      { date: "2026-03-01", amount: 1000 },
      { date: "2026-03-15", amount: 2000 },
      { date: "2026-02-28", amount: 500 },
    ];
    const result = aggregateMonthly(items, 12);
    const mar = result.find((r) => r.date.startsWith("2026-03"));
    const feb = result.find((r) => r.date.startsWith("2026-02"));

    expect(mar?.count).toBe(2); // both March dates
    expect(mar?.value).toBe(3000);
    expect(feb?.count).toBe(1); // only Feb 28
    expect(feb?.value).toBe(500);
  });

  it("handles null and undefined dates gracefully", () => {
    const items = [
      { date: null, amount: 100 },
      { date: undefined, amount: 200 },
      { date: "2026-01-15", amount: 300 },
    ];
    const result = aggregateMonthly(items, 12);
    const jan = result.find((r) => r.date.startsWith("2026-01"));
    expect(jan?.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --testPathPattern='aggregateMonthly' --verbose`
Expected: FAIL — March count is 1 instead of 2 (the `2026-03-01` item lands in February)

- [ ] **Step 3: Fix the timezone parsing**

In `src/components/ui/MonthlyBarChart.tsx`, change line 61 from:

```ts
    const d = new Date(item.date);
```

to:

```ts
    const d = new Date(item.date + "T12:00:00");
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --testPathPattern='aggregateMonthly' --verbose`
Expected: PASS

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `npm test -- --verbose`
Expected: All existing tests pass

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/MonthlyBarChart.tsx src/__tests__/components/aggregateMonthly.test.ts
git commit -m "fix: aggregateMonthly timezone mis-bucketing on first-of-month dates"
```

---

### Task 2: Add filter persistence hook

**Files:**
- Modify: `src/stores/dashboard-filters.ts` (append after line 295)

**Context:** Follow the standalone hook pattern used by `useClippingAnalyticsFilters` (lines 284-295) in the same file. The preconstruction page needs `locations` and `leads` filters persisted to localStorage.

- [ ] **Step 1: Add the filter interface and hook**

Append to `src/stores/dashboard-filters.ts`:

```ts
// ===== Preconstruction Metrics filters =====

export interface PreconstMetricsFilters {
  locations: string[];
  leads: string[];
}

const defaultPreconstMetricsFilters: PreconstMetricsFilters = {
  locations: [],
  leads: [],
};

export function usePreconstMetricsFilters() {
  const raw = useDashboardFilters(
    (s) => s.filters["preconst-metrics"]
  ) as PreconstMetricsFilters | undefined;
  const setFilters = useDashboardFilters((s) => s.setFilters);
  return {
    filters: raw ?? defaultPreconstMetricsFilters,
    setFilters: (f: PreconstMetricsFilters) => setFilters("preconst-metrics", f),
    clearFilters: () =>
      useDashboardFilters.getState().clearFilters("preconst-metrics"),
  };
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/stores/dashboard-filters.ts
git commit -m "feat: add preconstruction metrics filter persistence hook"
```

---

### Task 3: Add role permission for the new route

**Files:**
- Modify: `src/lib/role-permissions.ts:318` (OPERATIONS_MANAGER executive dashboards section)
- Modify: `src/lib/role-permissions.ts:418` (PROJECT_MANAGER executive dashboards section)
- Modify: `src/lib/role-permissions.ts:86-188` (MANAGER legacy role, mirrors PROJECT_MANAGER)
- Modify: `src/__tests__/lib/role-permissions.test.ts`

**Context:** ADMIN and EXECUTIVE have wildcard `"*"` routes so they already have access. PM, OPS_MGR, and MANAGER (legacy for PM) need the new route added to their explicit `allowedRoutes` arrays. The route goes in the "Executive dashboards" section of each role.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/lib/role-permissions.test.ts`:

```ts
  // Preconstruction metrics access
  it("allows OPERATIONS_MANAGER to access preconstruction metrics", () => {
    expect(canAccessRoute("OPERATIONS_MANAGER", "/dashboards/preconstruction-metrics")).toBe(true);
  });

  it("allows PROJECT_MANAGER to access preconstruction metrics", () => {
    expect(canAccessRoute("PROJECT_MANAGER", "/dashboards/preconstruction-metrics")).toBe(true);
  });

  it("blocks OPERATIONS from preconstruction metrics", () => {
    expect(canAccessRoute("OPERATIONS", "/dashboards/preconstruction-metrics")).toBe(false);
  });

  it("blocks SALES from preconstruction metrics", () => {
    expect(canAccessRoute("SALES", "/dashboards/preconstruction-metrics")).toBe(false);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --testPathPattern='role-permissions' --verbose`
Expected: FAIL — PM and OPS_MGR tests fail (route not in allowedRoutes yet)

- [ ] **Step 3: Add the route to OPERATIONS_MANAGER**

In `src/lib/role-permissions.ts`, in the OPERATIONS_MANAGER `allowedRoutes` array, add after `"/dashboards/forecast-timeline"` (line 318):

```ts
      "/dashboards/preconstruction-metrics",
```

- [ ] **Step 4: Add the route to PROJECT_MANAGER**

In `src/lib/role-permissions.ts`, in the PROJECT_MANAGER `allowedRoutes` array, add after `"/dashboards/forecast-timeline"` (line 418):

```ts
      "/dashboards/preconstruction-metrics",
```

- [ ] **Step 5: Add the route to MANAGER (legacy)**

In `src/lib/role-permissions.ts`, in the MANAGER `allowedRoutes` array. MANAGER mirrors PM but doesn't have executive dashboards listed — add it alongside the other metrics dashboards, after `"/dashboards/survey-metrics"` (line 124):

```ts
      "/dashboards/preconstruction-metrics",
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --testPathPattern='role-permissions' --verbose`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/role-permissions.ts src/__tests__/lib/role-permissions.test.ts
git commit -m "feat: grant PM and OPS_MGR access to preconstruction-metrics route"
```

---

## Chunk 2: Dashboard Page

### Task 4: Create the preconstruction metrics page

**Files:**
- Create: `src/app/dashboards/preconstruction-metrics/page.tsx`

**Context:** This is the main deliverable. Follow the pattern from `src/app/dashboards/pi-metrics/page.tsx` closely. Key differences: blue accent (not cyan), unified lead filter across 4 fields, 3 phase sections with StatCards + MonthlyBarCharts.

- [ ] **Step 1: Create the page file**

Create `src/app/dashboards/preconstruction-metrics/page.tsx`:

```tsx
"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter, FilterOption } from "@/components/ui/MultiSelectFilter";
import { MonthlyBarChart, aggregateMonthly } from "@/components/ui/MonthlyBarChart";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { usePreconstMetricsFilters } from "@/stores/dashboard-filters";

const TIME_PRESETS = [30, 60, 90, 180, 365] as const;
type TimePreset = (typeof TIME_PRESETS)[number];

export default function PreconstMetricsPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading, lastUpdated } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("preconstruction-metrics", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  // ---- Time window ----
  const [timePreset, setTimePreset] = useState<TimePreset | "custom">(90);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const isInWindow = useCallback(
    (dateStr: string | null | undefined): boolean => {
      if (!dateStr) return false;
      const d = new Date(dateStr + "T12:00:00");
      if (isNaN(d.getTime())) return false;

      if (timePreset === "custom") {
        if (!customFrom && !customTo) return true;
        const from = customFrom ? new Date(customFrom + "T00:00:00") : new Date(0);
        const to = customTo ? new Date(customTo + "T23:59:59") : new Date();
        return d >= from && d <= to;
      }

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - timePreset);
      return d >= cutoff;
    },
    [timePreset, customFrom, customTo]
  );

  const timeWindowLabel = useMemo(() => {
    if (timePreset === "custom") {
      if (!customFrom && !customTo) return "All time";
      if (customFrom && customTo) return `${customFrom} → ${customTo}`;
      if (customFrom) return `From ${customFrom}`;
      return `Until ${customTo}`;
    }
    return timePreset === 365 ? "Last 1 year" : `Last ${timePreset} days`;
  }, [timePreset, customFrom, customTo]);

  // ---- Persisted filters ----
  const { filters: persistedFilters, setFilters: setPersisted, clearFilters } = usePreconstMetricsFilters();

  const hasActiveFilters =
    persistedFilters.locations.length > 0 ||
    persistedFilters.leads.length > 0;

  // ---- Build filter option lists ----
  const locationOptions: FilterOption[] = useMemo(() => {
    const locs = new Set<string>();
    safeProjects.forEach((p) => { if (p.pbLocation) locs.add(p.pbLocation); });
    return Array.from(locs).sort().map((loc) => ({ value: loc, label: loc }));
  }, [safeProjects]);

  const leadOptions: FilterOption[] = useMemo(() => {
    const names = new Set<string>();
    safeProjects.forEach((p) => {
      if (p.siteSurveyor) names.add(p.siteSurveyor);
      if (p.designLead) names.add(p.designLead);
      if (p.permitLead) names.add(p.permitLead);
      if (p.interconnectionsLead) names.add(p.interconnectionsLead);
    });
    return Array.from(names).sort().map((name) => ({ value: name, label: name }));
  }, [safeProjects]);

  // ---- Filtered projects ----
  const filteredProjects = useMemo(() => {
    let result = safeProjects;
    if (persistedFilters.locations.length > 0) {
      result = result.filter((p) => persistedFilters.locations.includes(p.pbLocation || ""));
    }
    if (persistedFilters.leads.length > 0) {
      result = result.filter((p) => {
        const projectLeads = [p.siteSurveyor, p.designLead, p.permitLead, p.interconnectionsLead];
        return projectLeads.some((lead) => lead && persistedFilters.leads.includes(lead));
      });
    }
    return result;
  }, [safeProjects, persistedFilters]);

  // ---- Metrics (windowed) ----
  const surveyMetrics = useMemo(() => ({
    scheduled: {
      count: filteredProjects.filter((p) => isInWindow(p.siteSurveyScheduleDate)).length,
      revenue: filteredProjects.filter((p) => isInWindow(p.siteSurveyScheduleDate)).reduce((s, p) => s + (p.amount || 0), 0),
    },
    completed: {
      count: filteredProjects.filter((p) => isInWindow(p.siteSurveyCompletionDate)).length,
      revenue: filteredProjects.filter((p) => isInWindow(p.siteSurveyCompletionDate)).reduce((s, p) => s + (p.amount || 0), 0),
    },
  }), [filteredProjects, isInWindow]);

  const daMetrics = useMemo(() => ({
    sent: {
      count: filteredProjects.filter((p) => isInWindow(p.designApprovalSentDate)).length,
      revenue: filteredProjects.filter((p) => isInWindow(p.designApprovalSentDate)).reduce((s, p) => s + (p.amount || 0), 0),
    },
    approved: {
      count: filteredProjects.filter((p) => isInWindow(p.designApprovalDate)).length,
      revenue: filteredProjects.filter((p) => isInWindow(p.designApprovalDate)).reduce((s, p) => s + (p.amount || 0), 0),
    },
  }), [filteredProjects, isInWindow]);

  const permitMetrics = useMemo(() => ({
    submitted: {
      count: filteredProjects.filter((p) => isInWindow(p.permitSubmitDate)).length,
      revenue: filteredProjects.filter((p) => isInWindow(p.permitSubmitDate)).reduce((s, p) => s + (p.amount || 0), 0),
    },
    issued: {
      count: filteredProjects.filter((p) => isInWindow(p.permitIssueDate)).length,
      revenue: filteredProjects.filter((p) => isInWindow(p.permitIssueDate)).reduce((s, p) => s + (p.amount || 0), 0),
    },
  }), [filteredProjects, isInWindow]);

  const icMetrics = useMemo(() => ({
    submitted: {
      count: filteredProjects.filter((p) => isInWindow(p.interconnectionSubmitDate)).length,
      revenue: filteredProjects.filter((p) => isInWindow(p.interconnectionSubmitDate)).reduce((s, p) => s + (p.amount || 0), 0),
    },
    approved: {
      count: filteredProjects.filter((p) => isInWindow(p.interconnectionApprovalDate)).length,
      revenue: filteredProjects.filter((p) => isInWindow(p.interconnectionApprovalDate)).reduce((s, p) => s + (p.amount || 0), 0),
    },
  }), [filteredProjects, isInWindow]);

  // ---- Monthly trends (12 months) ----
  const surveyScheduledTrend = useMemo(
    () => aggregateMonthly(
      filteredProjects.filter((p) => p.siteSurveyScheduleDate).map((p) => ({ date: p.siteSurveyScheduleDate!, amount: p.amount || 0 })),
      12
    ),
    [filteredProjects]
  );
  const surveyCompletedTrend = useMemo(
    () => aggregateMonthly(
      filteredProjects.filter((p) => p.siteSurveyCompletionDate).map((p) => ({ date: p.siteSurveyCompletionDate!, amount: p.amount || 0 })),
      12
    ),
    [filteredProjects]
  );

  const daSentTrend = useMemo(
    () => aggregateMonthly(
      filteredProjects.filter((p) => p.designApprovalSentDate).map((p) => ({ date: p.designApprovalSentDate!, amount: p.amount || 0 })),
      12
    ),
    [filteredProjects]
  );
  const daApprovedTrend = useMemo(
    () => aggregateMonthly(
      filteredProjects.filter((p) => p.designApprovalDate).map((p) => ({ date: p.designApprovalDate!, amount: p.amount || 0 })),
      12
    ),
    [filteredProjects]
  );

  const permitSubmitTrend = useMemo(
    () => aggregateMonthly(
      filteredProjects.filter((p) => p.permitSubmitDate).map((p) => ({ date: p.permitSubmitDate!, amount: p.amount || 0 })),
      12
    ),
    [filteredProjects]
  );
  const permitIssueTrend = useMemo(
    () => aggregateMonthly(
      filteredProjects.filter((p) => p.permitIssueDate).map((p) => ({ date: p.permitIssueDate!, amount: p.amount || 0 })),
      12
    ),
    [filteredProjects]
  );

  const icSubmitTrend = useMemo(
    () => aggregateMonthly(
      filteredProjects.filter((p) => p.interconnectionSubmitDate).map((p) => ({ date: p.interconnectionSubmitDate!, amount: p.amount || 0 })),
      12
    ),
    [filteredProjects]
  );
  const icApprovedTrend = useMemo(
    () => aggregateMonthly(
      filteredProjects.filter((p) => p.interconnectionApprovalDate).map((p) => ({ date: p.interconnectionApprovalDate!, amount: p.amount || 0 })),
      12
    ),
    [filteredProjects]
  );

  // ---- Export (respects filters, ignores time window) ----
  const exportRows = useMemo(
    () => filteredProjects
      .filter((p) =>
        p.siteSurveyScheduleDate || p.siteSurveyCompletionDate ||
        p.designApprovalSentDate || p.designApprovalDate ||
        p.permitSubmitDate || p.permitIssueDate ||
        p.interconnectionSubmitDate || p.interconnectionApprovalDate
      )
      .map((p) => ({
        name: p.name,
        stage: p.stage,
        pbLocation: p.pbLocation || "",
        amount: p.amount || 0,
        siteSurveyScheduleDate: p.siteSurveyScheduleDate || "",
        siteSurveyCompletionDate: p.siteSurveyCompletionDate || "",
        siteSurveyor: p.siteSurveyor || "",
        designApprovalSentDate: p.designApprovalSentDate || "",
        designApprovalDate: p.designApprovalDate || "",
        designLead: p.designLead || "",
        permitSubmitDate: p.permitSubmitDate || "",
        permitIssueDate: p.permitIssueDate || "",
        permitLead: p.permitLead || "Unknown",
        interconnectionSubmitDate: p.interconnectionSubmitDate || "",
        interconnectionApprovalDate: p.interconnectionApprovalDate || "",
        interconnectionsLead: p.interconnectionsLead || "Unknown",
      })),
    [filteredProjects]
  );

  return (
    <DashboardShell
      title="Preconstruction Metrics"
      accentColor="blue"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "preconstruction-metrics.csv" }}
      fullWidth
    >
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <MultiSelectFilter
          label="Location"
          options={locationOptions}
          selected={persistedFilters.locations}
          onChange={(v) => setPersisted({ ...persistedFilters, locations: v })}
          placeholder="All Locations"
          accentColor="blue"
        />
        <MultiSelectFilter
          label="Preconstruction Lead"
          options={leadOptions}
          selected={persistedFilters.leads}
          onChange={(v) => setPersisted({ ...persistedFilters, leads: v })}
          placeholder="All Leads"
          accentColor="blue"
        />
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-xs text-muted hover:text-foreground px-3 py-2 border border-t-border rounded-lg hover:border-muted transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Time Window Toggle */}
      <div className="flex items-center gap-2 flex-wrap mb-6">
        <span className="text-xs text-muted mr-1">Time window:</span>
        {TIME_PRESETS.map((d) => (
          <button
            key={d}
            onClick={() => setTimePreset(d)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              timePreset === d
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                : "bg-surface-2 text-muted hover:text-foreground border border-transparent"
            }`}
          >
            {d === 365 ? "1y" : `${d}d`}
          </button>
        ))}
        <button
          onClick={() => setTimePreset("custom")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            timePreset === "custom"
              ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
              : "bg-surface-2 text-muted hover:text-foreground border border-transparent"
          }`}
        >
          Custom
        </button>
        {timePreset === "custom" && (
          <>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="px-2 py-1.5 rounded-lg text-xs bg-surface-2 text-foreground border border-t-border"
            />
            <span className="text-xs text-muted">→</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="px-2 py-1.5 rounded-lg text-xs bg-surface-2 text-foreground border border-t-border"
            />
          </>
        )}
        <span className="text-xs text-muted ml-auto">{timeWindowLabel}</span>
      </div>

      {/* ── Section 1: Site Survey ── */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-3">Site Survey</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 stagger-grid mb-4">
          <StatCard
            label="Surveys Scheduled"
            value={loading ? "—" : String(surveyMetrics.scheduled.count)}
            subtitle={loading ? undefined : formatMoney(surveyMetrics.scheduled.revenue)}
            color="blue"
          />
          <StatCard
            label="Surveys Completed"
            value={loading ? "—" : String(surveyMetrics.completed.count)}
            subtitle={loading ? undefined : formatMoney(surveyMetrics.completed.revenue)}
            color="emerald"
          />
        </div>
        <MonthlyBarChart
          title="Surveys (12 months)"
          data={surveyScheduledTrend}
          secondaryData={surveyCompletedTrend}
          primaryLabel="scheduled"
          secondaryLabel="completed"
          months={12}
          accentColor="blue"
        />
      </div>

      {/* ── Section 2: Design Approval ── */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-3">Design Approval</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 stagger-grid mb-4">
          <StatCard
            label="DAs Sent"
            value={loading ? "—" : String(daMetrics.sent.count)}
            subtitle={loading ? undefined : formatMoney(daMetrics.sent.revenue)}
            color="purple"
          />
          <StatCard
            label="DAs Approved"
            value={loading ? "—" : String(daMetrics.approved.count)}
            subtitle={loading ? undefined : formatMoney(daMetrics.approved.revenue)}
            color="emerald"
          />
        </div>
        <MonthlyBarChart
          title="Design Approvals (12 months)"
          data={daSentTrend}
          secondaryData={daApprovedTrend}
          primaryLabel="sent"
          secondaryLabel="approved"
          months={12}
          accentColor="purple"
        />
      </div>

      {/* ── Section 3: Permitting & Interconnection ── */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-3">Permitting & Interconnection</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-grid mb-4">
          <StatCard
            label="Permits Submitted"
            value={loading ? "—" : String(permitMetrics.submitted.count)}
            subtitle={loading ? undefined : formatMoney(permitMetrics.submitted.revenue)}
            color="cyan"
          />
          <StatCard
            label="Permits Issued"
            value={loading ? "—" : String(permitMetrics.issued.count)}
            subtitle={loading ? undefined : formatMoney(permitMetrics.issued.revenue)}
            color="emerald"
          />
          <StatCard
            label="IC Submitted"
            value={loading ? "—" : String(icMetrics.submitted.count)}
            subtitle={loading ? undefined : formatMoney(icMetrics.submitted.revenue)}
            color="blue"
          />
          <StatCard
            label="IC Approved"
            value={loading ? "—" : String(icMetrics.approved.count)}
            subtitle={loading ? undefined : formatMoney(icMetrics.approved.revenue)}
            color="emerald"
          />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MonthlyBarChart
            title="Permits (12 months)"
            data={permitSubmitTrend}
            secondaryData={permitIssueTrend}
            primaryLabel="submitted"
            secondaryLabel="issued"
            months={12}
            accentColor="cyan"
          />
          <MonthlyBarChart
            title="Interconnection (12 months)"
            data={icSubmitTrend}
            secondaryData={icApprovedTrend}
            primaryLabel="submitted"
            secondaryLabel="approved"
            months={12}
            accentColor="blue"
          />
        </div>
      </div>
    </DashboardShell>
  );
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Verify dev server renders the page**

Run: `npm run dev` (if not already running)
Visit: `http://localhost:3000/dashboards/preconstruction-metrics`
Expected: Page renders with DashboardShell, filter controls, 3 sections with StatCards and MonthlyBarCharts. Data populates from the projects API.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/preconstruction-metrics/page.tsx
git commit -m "feat: add preconstruction metrics dashboard page"
```

---

## Chunk 3: Suite Registration and Verification

### Task 5: Register in executive suite

**Files:**
- Modify: `src/app/suites/executive/page.tsx:6-95` (LINKS array)

**Context:** Add a card entry for the new page in the Executive suite landing page, in the "Executive Views" section alongside Revenue, Executive Summary, and Revenue Calendar.

- [ ] **Step 1: Add the card entry**

In `src/app/suites/executive/page.tsx`, add a new entry to the `LINKS` array after the Revenue Calendar entry (after the object ending at approximately line 31):

```ts
  {
    href: "/dashboards/preconstruction-metrics",
    title: "Preconstruction Metrics",
    description: "Survey, design approval, permitting, and interconnection KPIs with 12-month trends.",
    tag: "PRECON",
    icon: "🏗️",
    section: "Executive Views",
  },
```

- [ ] **Step 2: Verify the executive suite page renders**

Visit: `http://localhost:3000/suites/executive`
Expected: New "Preconstruction Metrics" card appears in the "Executive Views" section. Clicking it navigates to `/dashboards/preconstruction-metrics`.

- [ ] **Step 3: Commit**

```bash
git add src/app/suites/executive/page.tsx
git commit -m "feat: add preconstruction metrics card to executive suite"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test -- --verbose`
Expected: All tests pass, including the new `aggregateMonthly` and `role-permissions` tests.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No lint errors

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Manual smoke test**

1. Visit `/dashboards/preconstruction-metrics` — all 3 sections render with data
2. Toggle time windows (30d, 90d, 365d) — StatCard counts change
3. Select a location filter — all sections update
4. Select a lead filter — counts reflect projects where that person is any preconstruction lead
5. Click "Clear All" — filters reset
6. Export CSV — file downloads with filtered data
7. Visit `/suites/executive` — new card is visible and clickable
8. Log in as a non-PM/non-admin user — verify route is blocked (403 redirect)
