# Forecast Timeline Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dashboard showing all 10 milestone forecasts for every active project, with filtering and inline drill-down.

**Architecture:** Single API route computes forecasts for all active projects using existing `computeProjectForecasts()` engine, returns structured data. Client page wraps in `DashboardShell` with client-side filtering/sorting and expandable rows.

**Tech Stack:** Next.js API route, React + react-query, Tailwind CSS with theme tokens, existing forecasting engine from `src/lib/forecasting.ts`.

**Spec:** `docs/superpowers/specs/2026-03-15-forecast-timeline-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/app/api/forecasting/timeline/route.ts` | **Create** — API route: fetches active projects + baseline table, computes forecasts, returns `TimelineResponse` |
| `src/__tests__/api/forecasting-timeline.test.ts` | **Create** — Unit tests for API route (variance bucketing, next-milestone selection, empty data) |
| `src/app/dashboards/forecast-timeline/page.tsx` | **Create** — Client dashboard page: hero stats, filter bar, sortable table, inline expand |
| `src/lib/role-permissions.ts` | **Modify** — Add `/dashboards/forecast-timeline` and `/api/forecasting/timeline` to OPERATIONS_MANAGER and PROJECT_MANAGER routes (lines ~262, ~346) |
| `src/app/suites/executive/page.tsx` | **Modify** — Add Forecast Timeline card to Executive suite hub (line ~85) |
| `src/components/DashboardShell.tsx` | **Modify** — Add SUITE_MAP entry (line ~78) |
| `src/components/GlobalSearch.tsx` | **Modify** — Add DASHBOARD_LINKS entry for discoverability via Cmd+K |

---

## Chunk 1: API Route

### Task 1: Create API route

**Files:**
- Create: `src/app/api/forecasting/timeline/route.ts`

- [ ] **Step 1: Create the API route**

Create `src/app/api/forecasting/timeline/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { fetchAllProjects, type Project } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import {
  getBaselineTable,
  computeProjectForecasts,
  MILESTONE_CHAIN,
  MILESTONE_DATE_FIELD,
  type MilestoneKey,
  type ForecastBasis,
} from "@/lib/forecasting";

export const maxDuration = 120;

// ─── Types ────────────────────────────────────────────────────────

interface MilestoneDetail {
  name: string;
  key: MilestoneKey;
  originalForecast: string | null;
  liveForecast: string | null;
  actual: string | null;
  varianceDays: number | null;
  basis: ForecastBasis;
}

interface TimelineProject {
  dealId: string;
  projectNumber: string;
  customerName: string;
  location: string;
  currentStage: string;
  nextMilestone: {
    name: string;
    forecastDate: string | null;
  };
  forecastPto: string | null;
  varianceDays: number | null;
  milestones: MilestoneDetail[];
}

interface TimelineResponse {
  projects: TimelineProject[];
  summary: {
    total: number;
    onTrack: number;
    atRisk: number;
    behind: number;
    noForecast: number;
  };
  lastUpdated: string;
}

// ─── Constants ────────────────────────────────────────────────────

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const MILESTONE_LABELS: Record<MilestoneKey, string> = {
  close: "Close",
  designComplete: "Design Complete",
  permitSubmit: "Permit Submit",
  permitApproval: "Permit Approval",
  icSubmit: "IC Submit",
  icApproval: "IC Approval",
  rtb: "RTB",
  install: "Install",
  inspection: "Inspection",
  pto: "PTO",
};

// ─── Helpers ──────────────────────────────────────────────────────

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T12:00:00").getTime() -
      new Date(a + "T12:00:00").getTime()) /
      MS_PER_DAY,
  );
}

function mapProject(project: Project, table: import("@/lib/forecasting").BaselineTable): TimelineProject {
  const { original, live } = computeProjectForecasts(project, table);

  // Build milestone detail array
  const milestones: MilestoneDetail[] = MILESTONE_CHAIN.map((key) => {
    const dateField = MILESTONE_DATE_FIELD[key];
    const actual = project[dateField] as string | null;
    const origDate = original[key]?.date ?? null;
    const liveDate = live[key]?.date ?? null;

    let varianceDays: number | null = null;
    if (origDate && liveDate) {
      varianceDays = daysBetween(origDate, liveDate);
    }

    return {
      name: MILESTONE_LABELS[key],
      key,
      originalForecast: origDate,
      liveForecast: liveDate,
      actual,
      varianceDays,
      basis: live[key]?.basis ?? "insufficient",
    };
  });

  // Determine next milestone: first in chain without an actual date
  let nextMilestone = { name: "Complete", forecastDate: null as string | null };
  for (const key of MILESTONE_CHAIN) {
    const dateField = MILESTONE_DATE_FIELD[key];
    const actual = project[dateField] as string | null;
    if (!actual) {
      nextMilestone = {
        name: MILESTONE_LABELS[key],
        forecastDate: live[key]?.date ?? null,
      };
      break;
    }
  }

  // PTO variance: live PTO forecast vs original PTO forecast
  const origPto = original.pto?.date ?? null;
  const livePto = live.pto?.date ?? null;
  let varianceDays: number | null = null;
  if (origPto && livePto) {
    varianceDays = daysBetween(origPto, livePto);
  }

  return {
    dealId: String(project.id),
    projectNumber: project.projectNumber,
    customerName: project.name,
    location: project.pbLocation,
    currentStage: project.stage,
    nextMilestone,
    forecastPto: livePto,
    varianceDays,
    milestones,
  };
}

function classifyVariance(days: number | null): "onTrack" | "atRisk" | "behind" | "noForecast" {
  if (days === null) return "noForecast";
  if (days <= 7) return "onTrack";
  if (days <= 14) return "atRisk";
  return "behind";
}

// ─── Main Handler ─────────────────────────────────────────────────

export async function GET(_request: NextRequest) {
  try {
    const { data: baselineTable } = await getBaselineTable();

    const { data: activeProjects } = await appCache.getOrFetch(
      CACHE_KEYS.PROJECTS_ACTIVE,
      () => fetchAllProjects({ activeOnly: true }),
    );

    const projects = (activeProjects ?? []) as Project[];

    // Map each project to timeline format
    const timelineProjects = projects
      .filter((p) => p.closeDate) // Need at least a close date to forecast
      .map((p) => mapProject(p, baselineTable));

    // Build summary
    const summary = { total: timelineProjects.length, onTrack: 0, atRisk: 0, behind: 0, noForecast: 0 };
    for (const tp of timelineProjects) {
      summary[classifyVariance(tp.varianceDays)]++;
    }

    const response: TimelineResponse = {
      projects: timelineProjects,
      summary,
      lastUpdated: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Forecast timeline API error:", error);
    return NextResponse.json(
      { error: "Failed to compute forecast timeline" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Test the API route locally**

Run: `curl -s http://localhost:3000/api/forecasting/timeline | head -c 500`
Expected: JSON with `projects` array and `summary` object

- [ ] **Step 4: Commit**

```bash
git add src/app/api/forecasting/timeline/route.ts
git commit -m "feat(forecast): add /api/forecasting/timeline route"
```

---

### Task 2: Add API route tests

**Files:**
- Create: `src/__tests__/api/forecasting-timeline.test.ts`

- [ ] **Step 1: Create the test file**

Create `src/__tests__/api/forecasting-timeline.test.ts`:

```typescript
import { NextRequest } from "next/server";
import { GET } from "@/app/api/forecasting/timeline/route";

// ─── Mocks ────────────────────────────────────────────────────────

jest.mock("@/lib/hubspot", () => ({
  fetchAllProjects: jest.fn(),
}));

jest.mock("@/lib/cache", () => ({
  appCache: {
    getOrFetch: jest.fn((_key: string, fn: () => unknown) => fn()),
  },
  CACHE_KEYS: { PROJECTS_ACTIVE: "projects:active" },
}));

jest.mock("@/lib/forecasting", () => ({
  getBaselineTable: jest.fn(),
  computeProjectForecasts: jest.fn(),
  MILESTONE_CHAIN: [
    "close", "designComplete", "permitSubmit", "permitApproval",
    "icSubmit", "icApproval", "rtb", "install", "inspection", "pto",
  ],
  MILESTONE_DATE_FIELD: {
    close: "closeDate",
    designComplete: "designCompletionDate",
    permitSubmit: "permitSubmitDate",
    permitApproval: "permitIssueDate",
    icSubmit: "interconnectionSubmitDate",
    icApproval: "interconnectionApprovalDate",
    rtb: "readyToBuildDate",
    install: "constructionCompleteDate",
    inspection: "inspectionPassDate",
    pto: "ptoGrantedDate",
  },
}));

const { fetchAllProjects } = jest.requireMock("@/lib/hubspot");
const { getBaselineTable, computeProjectForecasts } = jest.requireMock("@/lib/forecasting");

function makeRequest(): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/forecasting/timeline"));
}

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 1001,
    name: "Smith Residence",
    projectNumber: "PROJ-1001",
    pbLocation: "Westminster",
    stage: "Design & Engineering",
    closeDate: "2025-01-01",
    designCompletionDate: null,
    permitSubmitDate: null,
    permitIssueDate: null,
    interconnectionSubmitDate: null,
    interconnectionApprovalDate: null,
    readyToBuildDate: null,
    constructionCompleteDate: null,
    inspectionPassDate: null,
    ptoGrantedDate: null,
    ...overrides,
  };
}

function makeForecastSet(overrides: Record<string, { date: string | null; basis: string }> = {}) {
  const defaults: Record<string, { date: string | null; basis: string }> = {
    close: { date: "2025-01-01", basis: "actual" },
    designComplete: { date: "2025-01-20", basis: "segment" },
    permitSubmit: { date: "2025-02-05", basis: "segment" },
    permitApproval: { date: "2025-03-10", basis: "segment" },
    icSubmit: { date: "2025-03-15", basis: "location" },
    icApproval: { date: "2025-04-10", basis: "global" },
    rtb: { date: "2025-04-15", basis: "segment" },
    install: { date: "2025-05-01", basis: "segment" },
    inspection: { date: "2025-05-15", basis: "global" },
    pto: { date: "2025-06-01", basis: "segment" },
  };
  return { ...defaults, ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────

describe("GET /api/forecasting/timeline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getBaselineTable.mockResolvedValue({ data: {} });
  });

  it("returns 500 on error", async () => {
    getBaselineTable.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to compute forecast timeline");
  });

  it("handles empty project list gracefully", async () => {
    fetchAllProjects.mockResolvedValue([]);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toEqual([]);
    expect(body.summary).toEqual({ total: 0, onTrack: 0, atRisk: 0, behind: 0, noForecast: 0 });
  });

  it("excludes projects without closeDate", async () => {
    fetchAllProjects.mockResolvedValue([makeProject({ closeDate: null })]);
    computeProjectForecasts.mockReturnValue({ original: makeForecastSet(), live: makeForecastSet() });
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.projects).toHaveLength(0);
    expect(body.summary.total).toBe(0);
  });

  describe("variance bucketing", () => {
    it("classifies on-track (variance <= 7d)", async () => {
      fetchAllProjects.mockResolvedValue([makeProject()]);
      const origPto = "2025-06-01";
      const livePto = "2025-06-05"; // +4d
      computeProjectForecasts.mockReturnValue({
        original: makeForecastSet({ pto: { date: origPto, basis: "segment" } }),
        live: makeForecastSet({ pto: { date: livePto, basis: "segment" } }),
      });
      const res = await GET(makeRequest());
      const body = await res.json();
      expect(body.summary.onTrack).toBe(1);
      expect(body.projects[0].varianceDays).toBe(4);
    });

    it("classifies ahead-of-schedule (negative variance) as on-track", async () => {
      fetchAllProjects.mockResolvedValue([makeProject()]);
      computeProjectForecasts.mockReturnValue({
        original: makeForecastSet({ pto: { date: "2025-06-15", basis: "segment" } }),
        live: makeForecastSet({ pto: { date: "2025-06-01", basis: "segment" } }),
      });
      const res = await GET(makeRequest());
      const body = await res.json();
      expect(body.summary.onTrack).toBe(1);
      expect(body.projects[0].varianceDays).toBe(-14);
    });

    it("classifies at-risk (variance 8-14d)", async () => {
      fetchAllProjects.mockResolvedValue([makeProject()]);
      computeProjectForecasts.mockReturnValue({
        original: makeForecastSet({ pto: { date: "2025-06-01", basis: "segment" } }),
        live: makeForecastSet({ pto: { date: "2025-06-12", basis: "segment" } }),
      });
      const res = await GET(makeRequest());
      const body = await res.json();
      expect(body.summary.atRisk).toBe(1);
      expect(body.projects[0].varianceDays).toBe(11);
    });

    it("classifies behind (variance > 14d)", async () => {
      fetchAllProjects.mockResolvedValue([makeProject()]);
      computeProjectForecasts.mockReturnValue({
        original: makeForecastSet({ pto: { date: "2025-06-01", basis: "segment" } }),
        live: makeForecastSet({ pto: { date: "2025-07-01", basis: "segment" } }),
      });
      const res = await GET(makeRequest());
      const body = await res.json();
      expect(body.summary.behind).toBe(1);
      expect(body.projects[0].varianceDays).toBe(30);
    });

    it("classifies noForecast when PTO dates are null (insufficient data)", async () => {
      fetchAllProjects.mockResolvedValue([makeProject()]);
      computeProjectForecasts.mockReturnValue({
        original: makeForecastSet({ pto: { date: null, basis: "insufficient" } }),
        live: makeForecastSet({ pto: { date: null, basis: "insufficient" } }),
      });
      const res = await GET(makeRequest());
      const body = await res.json();
      expect(body.summary.noForecast).toBe(1);
      expect(body.projects[0].varianceDays).toBeNull();
    });
  });

  describe("next milestone selection", () => {
    it("selects first milestone without an actual date", async () => {
      const project = makeProject({
        designCompletionDate: "2025-01-20", // completed
        permitSubmitDate: null,             // next milestone
      });
      fetchAllProjects.mockResolvedValue([project]);
      computeProjectForecasts.mockReturnValue({
        original: makeForecastSet(),
        live: makeForecastSet({ permitSubmit: { date: "2025-02-10", basis: "segment" } }),
      });
      const res = await GET(makeRequest());
      const body = await res.json();
      expect(body.projects[0].nextMilestone.name).toBe("Permit Submit");
      expect(body.projects[0].nextMilestone.forecastDate).toBe("2025-02-10");
    });

    it("shows 'Complete' when all milestones have actual dates", async () => {
      const project = makeProject({
        designCompletionDate: "2025-01-20",
        permitSubmitDate: "2025-02-05",
        permitIssueDate: "2025-03-10",
        interconnectionSubmitDate: "2025-03-15",
        interconnectionApprovalDate: "2025-04-10",
        readyToBuildDate: "2025-04-15",
        constructionCompleteDate: "2025-05-01",
        inspectionPassDate: "2025-05-15",
        ptoGrantedDate: "2025-06-01",
      });
      fetchAllProjects.mockResolvedValue([project]);
      computeProjectForecasts.mockReturnValue({
        original: makeForecastSet(),
        live: makeForecastSet(),
      });
      const res = await GET(makeRequest());
      const body = await res.json();
      expect(body.projects[0].nextMilestone.name).toBe("Complete");
    });
  });

  describe("field mappings", () => {
    it("maps Project fields to TimelineProject correctly", async () => {
      const project = makeProject({ id: 42, name: "Garcia Solar", projectNumber: "PROJ-42", pbLocation: "Centennial", stage: "Permitting" });
      fetchAllProjects.mockResolvedValue([project]);
      computeProjectForecasts.mockReturnValue({
        original: makeForecastSet(),
        live: makeForecastSet(),
      });
      const res = await GET(makeRequest());
      const body = await res.json();
      const p = body.projects[0];
      expect(p.dealId).toBe("42");
      expect(p.customerName).toBe("Garcia Solar");
      expect(p.projectNumber).toBe("PROJ-42");
      expect(p.location).toBe("Centennial");
      expect(p.currentStage).toBe("Permitting");
      expect(p.milestones).toHaveLength(10);
    });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx jest src/__tests__/api/forecasting-timeline.test.ts --verbose`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/api/forecasting-timeline.test.ts
git commit -m "test(forecast): add unit tests for /api/forecasting/timeline route"
```

---

## Chunk 2: Dashboard Page & Permissions

### Task 3: Add permissions for forecast-timeline routes

**Files:**
- Modify: `src/lib/role-permissions.ts:262,346`

- [ ] **Step 1: Add routes to OPERATIONS_MANAGER**

In `src/lib/role-permissions.ts`, find the OPERATIONS_MANAGER `allowedRoutes` section. After the line with `"/dashboards/forecast-accuracy"` (line ~262), add:

```typescript
      "/dashboards/forecast-timeline",
      "/api/forecasting",
```

Note: `/api/forecasting` as a prefix covers both `/api/forecasting/accuracy`, `/api/forecasting/baselines`, and `/api/forecasting/timeline` via the `startsWith` match in `canAccessRoute()`. This also fixes the existing (currently-working-by-luck) forecast-accuracy API access.

- [ ] **Step 2: Add routes to PROJECT_MANAGER**

In the same file, find the PROJECT_MANAGER `allowedRoutes` section. After the line with `"/dashboards/forecast-accuracy"` (line ~346), add:

```typescript
      "/dashboards/forecast-timeline",
      "/api/forecasting",
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/role-permissions.ts
git commit -m "feat(forecast): add forecast-timeline permissions for OPERATIONS_MANAGER and PROJECT_MANAGER"
```

---

### Task 4: Add Executive suite hub card, SUITE_MAP entry, and GlobalSearch entry

**Files:**
- Modify: `src/app/suites/executive/page.tsx:85`
- Modify: `src/components/DashboardShell.tsx:78`
- Modify: `src/components/GlobalSearch.tsx:59`

- [ ] **Step 1: Add Forecast Timeline card to Executive suite hub**

In `src/app/suites/executive/page.tsx`, add a new card after the existing Forecast Accuracy entry (line ~85, before the closing `]`):

```typescript
  {
    href: "/dashboards/forecast-timeline",
    title: "Forecast Timeline",
    description: "All 10 milestone forecasts for every active project with variance tracking.",
    tag: "FORECAST",
    tagColor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    section: "Meta",
  },
```

- [ ] **Step 2: Add forecast-timeline to SUITE_MAP**

In `src/components/DashboardShell.tsx`, add after line 78 (`"/dashboards/forecast-accuracy"`):

```typescript
  "/dashboards/forecast-timeline": { href: "/suites/executive", label: "Executive" },
```

- [ ] **Step 3: Add Forecast Timeline to GlobalSearch DASHBOARD_LINKS**

In `src/components/GlobalSearch.tsx`, add after the Forecast Accuracy entry (line ~59):

```typescript
  { name: "Forecast Timeline", path: "/dashboards/forecast-timeline", description: "Milestone forecasts for all active projects" },
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/app/suites/executive/page.tsx src/components/DashboardShell.tsx src/components/GlobalSearch.tsx
git commit -m "feat(forecast): add forecast-timeline to executive hub, SUITE_MAP, and GlobalSearch"
```

---

### Task 5: Create dashboard page

**Files:**
- Create: `src/app/dashboards/forecast-timeline/page.tsx`

- [ ] **Step 1: Create the dashboard page**

Create `src/app/dashboards/forecast-timeline/page.tsx`:

```tsx
"use client";

import { Fragment, useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { ForecastBasisBadge } from "@/components/ui/ForecastBasisBadge";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useSSE } from "@/hooks/useSSE";
import { STAGE_COLORS } from "@/lib/constants";
import type { ForecastBasis } from "@/lib/forecasting";

// ─── Types ────────────────────────────────────────────────────────

interface MilestoneDetail {
  name: string;
  key: string;
  originalForecast: string | null;
  liveForecast: string | null;
  actual: string | null;
  varianceDays: number | null;
  basis: ForecastBasis;
}

interface TimelineProject {
  dealId: string;
  projectNumber: string;
  customerName: string;
  location: string;
  currentStage: string;
  nextMilestone: { name: string; forecastDate: string | null };
  forecastPto: string | null;
  varianceDays: number | null;
  milestones: MilestoneDetail[];
}

interface TimelineData {
  projects: TimelineProject[];
  summary: {
    total: number;
    onTrack: number;
    atRisk: number;
    behind: number;
    noForecast: number;
  };
  lastUpdated: string;
}

// ─── Helpers ──────────────────────────────────────────────────────

function varianceLabel(days: number | null): string {
  if (days === null) return "—";
  if (days <= 0) return days === 0 ? "On Track" : `${days}d`;
  if (days <= 7) return "On Track";
  return `+${days}d`;
}

function varianceColor(days: number | null): string {
  if (days === null) return "text-muted";
  if (days <= 7) return "text-green-500";
  if (days <= 14) return "text-amber-500";
  return "text-red-500";
}

function varianceBucket(days: number | null): "onTrack" | "atRisk" | "behind" | "noForecast" {
  if (days === null) return "noForecast";
  if (days <= 7) return "onTrack";
  if (days <= 14) return "atRisk";
  return "behind";
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  const date = new Date(d + "T12:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function stagePillColor(stage: string): string {
  const entry = STAGE_COLORS[stage];
  return entry?.tw ?? "bg-zinc-500";
}

// ─── Sub-components ───────────────────────────────────────────────

function MilestoneDetailPanel({ milestones }: { milestones: MilestoneDetail[] }) {
  return (
    <div className="bg-surface-2 border border-t-border rounded-lg p-4 mt-1">
      <div className="flex justify-between items-center mb-3">
        <span className="text-xs text-muted font-medium">Milestone Forecast Detail</span>
        <div className="flex gap-3 text-[10px]">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
            <span className="text-muted">Actual</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-muted">Segment</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-violet-500" />
            <span className="text-muted">Location</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-zinc-500" />
            <span className="text-muted">Global</span>
          </span>
        </div>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted text-[10px] uppercase border-b border-t-border">
            <th className="text-left py-1.5 px-2">Milestone</th>
            <th className="text-center py-1.5 px-2">Basis</th>
            <th className="text-center py-1.5 px-2">Original</th>
            <th className="text-center py-1.5 px-2">Live</th>
            <th className="text-center py-1.5 px-2">Actual</th>
            <th className="text-right py-1.5 px-2">Variance</th>
          </tr>
        </thead>
        <tbody>
          {milestones.map((m) => {
            const isCompleted = m.basis === "actual";
            const isNext = !isCompleted && milestones.findIndex(
              (ms) => ms.basis !== "actual"
            ) === milestones.indexOf(m);

            return (
              <tr
                key={m.key}
                className={`border-b border-t-border/50 ${
                  isNext ? "bg-orange-500/5" : ""
                }`}
              >
                <td className={`py-1.5 px-2 font-medium ${
                  isCompleted ? "text-green-500" : isNext ? "text-orange-400" : "text-muted"
                }`}>
                  {m.name}
                </td>
                <td className="py-1.5 px-2 text-center">
                  <ForecastBasisBadge basis={m.basis} />
                </td>
                <td className="py-1.5 px-2 text-center text-muted">
                  {formatDate(m.originalForecast)}
                </td>
                <td className={`py-1.5 px-2 text-center ${
                  isNext ? "text-orange-400" : "text-muted"
                }`}>
                  {formatDate(m.liveForecast)}
                </td>
                <td className={`py-1.5 px-2 text-center ${
                  m.actual ? "text-green-500" : "text-muted"
                }`}>
                  {formatDate(m.actual)}
                </td>
                <td className={`py-1.5 px-2 text-right font-medium ${varianceColor(m.varianceDays)}`}>
                  {varianceLabel(m.varianceDays)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────

export default function ForecastTimelinePage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data, isLoading, error, refetch } = useQuery<TimelineData>({
    queryKey: ["forecasting", "timeline"],
    queryFn: async () => {
      const res = await fetch("/api/forecasting/timeline");
      if (!res.ok) throw new Error("Failed to fetch forecast timeline");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  useSSE(() => refetch(), {
    url: "/api/stream",
    cacheKeyFilter: "projects",
  });

  useEffect(() => {
    if (!isLoading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("forecast-timeline", {});
    }
  }, [isLoading, trackDashboardView]);

  // ── Filter state ──
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [ptoMonthFilter, setPtoMonthFilter] = useState("all");
  const [varianceFilter, setVarianceFilter] = useState("all");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [sortField, setSortField] = useState<string>("varianceDays");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // ── Derived filter options ──
  const locations = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.projects.map((p) => p.location))].filter(Boolean).sort();
  }, [data]);

  const stages = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.projects.map((p) => p.currentStage))].filter(Boolean).sort();
  }, [data]);

  const ptoMonths = useMemo(() => {
    if (!data) return [];
    const months = new Set<string>();
    for (const p of data.projects) {
      if (p.forecastPto) months.add(p.forecastPto.substring(0, 7));
    }
    return [...months].sort();
  }, [data]);

  // ── Filtered + sorted projects ──
  const filteredProjects = useMemo(() => {
    if (!data) return [];
    let result = data.projects;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.projectNumber.toLowerCase().includes(q) ||
          p.customerName.toLowerCase().includes(q),
      );
    }
    if (locationFilter !== "all") {
      result = result.filter((p) => p.location === locationFilter);
    }
    if (stageFilter !== "all") {
      result = result.filter((p) => p.currentStage === stageFilter);
    }
    if (ptoMonthFilter !== "all") {
      result = result.filter((p) => p.forecastPto?.startsWith(ptoMonthFilter));
    }
    if (varianceFilter !== "all") {
      result = result.filter((p) => varianceBucket(p.varianceDays) === varianceFilter);
    }

    // Sort
    result = [...result].sort((a, b) => {
      let aVal: number | string | null = null;
      let bVal: number | string | null = null;

      switch (sortField) {
        case "projectNumber":
          aVal = a.projectNumber;
          bVal = b.projectNumber;
          break;
        case "location":
          aVal = a.location;
          bVal = b.location;
          break;
        case "currentStage":
          aVal = a.currentStage;
          bVal = b.currentStage;
          break;
        case "forecastPto":
          aVal = a.forecastPto ?? "9999";
          bVal = b.forecastPto ?? "9999";
          break;
        case "varianceDays":
        default:
          aVal = a.varianceDays ?? -9999;
          bVal = b.varianceDays ?? -9999;
          break;
      }

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      const numA = aVal as number;
      const numB = bVal as number;
      return sortDir === "asc" ? numA - numB : numB - numA;
    });

    return result;
  }, [data, search, locationFilter, stageFilter, ptoMonthFilter, varianceFilter, sortField, sortDir]);

  function handleSort(field: string) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function sortIndicator(field: string) {
    if (sortField !== field) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  // ── Export data ──
  const exportData = useMemo(() => {
    return filteredProjects.map((p) => ({
      Project: p.projectNumber,
      Customer: p.customerName,
      Location: p.location,
      Stage: p.currentStage,
      "Next Milestone": p.nextMilestone.name,
      "Next Milestone Date": p.nextMilestone.forecastDate ?? "",
      "Forecast PTO": p.forecastPto ?? "",
      "Variance (days)": p.varianceDays ?? "",
    }));
  }, [filteredProjects]);

  if (isLoading) return <LoadingSpinner message="Computing forecasts for all projects…" />;
  if (error || !data)
    return <ErrorState message={error ? String(error) : "Failed to load forecast data"} />;

  const { summary } = data;

  return (
    <DashboardShell
      title="Forecast Timeline"
      subtitle="Milestone forecasts for all active projects"
      accentColor="blue"
      fullWidth
      lastUpdated={data.lastUpdated}
      exportData={{ data: exportData, filename: "forecast-timeline.csv" }}
    >
      {/* ── Hero Stats ───────────────────────────────────────── */}
      <div className={`grid gap-4 mb-6 stagger-grid ${
        summary.noForecast > 0 ? "grid-cols-2 md:grid-cols-5" : "grid-cols-2 md:grid-cols-4"
      }`}>
        <StatCard
          label="Active Projects"
          value={summary.total}
          subtitle="With close date"
          color="blue"
        />
        <StatCard
          label="On Track"
          value={summary.onTrack}
          subtitle={`${summary.total > 0 ? Math.round((summary.onTrack / summary.total) * 100) : 0}%`}
          color="emerald"
        />
        <StatCard
          label="At Risk"
          value={summary.atRisk}
          subtitle={`${summary.total > 0 ? Math.round((summary.atRisk / summary.total) * 100) : 0}% · 8-14d behind`}
          color="yellow"
        />
        <StatCard
          label="Behind"
          value={summary.behind}
          subtitle={`${summary.total > 0 ? Math.round((summary.behind / summary.total) * 100) : 0}% · >14d`}
          color="red"
        />
        {summary.noForecast > 0 && (
          <StatCard
            label="No Forecast"
            value={summary.noForecast}
            subtitle="Insufficient data"
            color="purple"
          />
        )}
      </div>

      {/* ── Filter Bar ───────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input
          type="text"
          placeholder="Search projects…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-surface border border-t-border rounded-md px-3 py-1.5 text-sm text-foreground placeholder:text-muted w-48 outline-none focus:ring-1 focus:ring-blue-500"
        />
        <select
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          className="bg-surface border border-t-border rounded-md px-2 py-1.5 text-sm text-foreground outline-none"
        >
          <option value="all">All Locations</option>
          {locations.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="bg-surface border border-t-border rounded-md px-2 py-1.5 text-sm text-foreground outline-none"
        >
          <option value="all">All Stages</option>
          {stages.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={ptoMonthFilter}
          onChange={(e) => setPtoMonthFilter(e.target.value)}
          className="bg-surface border border-t-border rounded-md px-2 py-1.5 text-sm text-foreground outline-none"
        >
          <option value="all">PTO: All Months</option>
          {ptoMonths.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select
          value={varianceFilter}
          onChange={(e) => setVarianceFilter(e.target.value)}
          className="bg-surface border border-t-border rounded-md px-2 py-1.5 text-sm text-foreground outline-none"
        >
          <option value="all">All Variance</option>
          <option value="onTrack">On Track</option>
          <option value="atRisk">At Risk (8-14d)</option>
          <option value="behind">Behind (14d+)</option>
          <option value="noForecast">No Forecast</option>
        </select>
        <span className="text-xs text-muted ml-auto">
          Showing {filteredProjects.length} of {summary.total}
        </span>
      </div>

      {/* ── Table ─────────────────────────────────────────────── */}
      <div className="bg-surface border border-t-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-2 text-muted text-xs uppercase tracking-wide">
              <th
                className="text-left py-2.5 px-4 cursor-pointer hover:text-foreground"
                onClick={() => handleSort("projectNumber")}
              >
                Project{sortIndicator("projectNumber")}
              </th>
              <th
                className="text-left py-2.5 px-3 cursor-pointer hover:text-foreground"
                onClick={() => handleSort("location")}
              >
                Location{sortIndicator("location")}
              </th>
              <th
                className="text-left py-2.5 px-3 cursor-pointer hover:text-foreground"
                onClick={() => handleSort("currentStage")}
              >
                Stage{sortIndicator("currentStage")}
              </th>
              <th className="text-center py-2.5 px-3">Next Milestone</th>
              <th
                className="text-center py-2.5 px-3 cursor-pointer hover:text-foreground"
                onClick={() => handleSort("forecastPto")}
              >
                Forecast PTO{sortIndicator("forecastPto")}
              </th>
              <th
                className="text-right py-2.5 px-4 cursor-pointer hover:text-foreground"
                onClick={() => handleSort("varianceDays")}
              >
                Variance{sortIndicator("varianceDays")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredProjects.map((p) => (
              <Fragment key={p.dealId}>
                <tr
                  className={`border-b border-t-border/50 cursor-pointer transition-colors hover:bg-surface-2 ${
                    expandedRow === p.dealId ? "bg-surface-2" : ""
                  }`}
                  onClick={() =>
                    setExpandedRow((prev) => (prev === p.dealId ? null : p.dealId))
                  }
                >
                  <td className="py-2.5 px-4">
                    <div className="text-foreground font-medium">
                      {expandedRow === p.dealId ? "▾ " : "▸ "}
                      {p.projectNumber}
                    </div>
                    <div className="text-xs text-muted">{p.customerName}</div>
                  </td>
                  <td className="py-2.5 px-3 text-foreground/80">{p.location}</td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs text-white ${stagePillColor(p.currentStage)}`}
                    >
                      {p.currentStage}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <div className="text-foreground/80">{p.nextMilestone.name}</div>
                    <div className="text-xs text-muted">
                      {p.nextMilestone.forecastDate ? `~${formatDate(p.nextMilestone.forecastDate)}` : "—"}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-center text-foreground/80">
                    {formatDate(p.forecastPto)}
                  </td>
                  <td className={`py-2.5 px-4 text-right font-medium ${varianceColor(p.varianceDays)}`}>
                    {varianceLabel(p.varianceDays)}
                  </td>
                </tr>
                {expandedRow === p.dealId && (
                  <tr key={`${p.dealId}-detail`} className="bg-surface-2">
                    <td colSpan={6} className="px-4 pb-4">
                      <MilestoneDetailPanel milestones={p.milestones} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {filteredProjects.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-muted">
                  No projects match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors (or only pre-existing warnings)

- [ ] **Step 3: Verify the page loads in dev**

1. Ensure `npm run dev` is running
2. Navigate to `http://localhost:3000/dashboards/forecast-timeline`
3. Expected: Page loads with hero stats, filter bar, and project table
4. Click a row to verify inline expand works

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/forecast-timeline/page.tsx
git commit -m "feat(forecast): add forecast timeline dashboard page"
```

---

## Chunk 3: Verify & Deploy

### Task 6: Full build verification

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: No new errors

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds, forecast-timeline page compiles

- [ ] **Step 3: Final commit if lint/build required fixes**

Only if changes were needed to fix lint/build:
```bash
git add -A
git commit -m "fix(forecast): address lint/build issues in forecast timeline"
```

- [ ] **Step 4: Push and deploy**

```bash
git push
```

Verify on deployed site that `/dashboards/forecast-timeline` loads with real data.
