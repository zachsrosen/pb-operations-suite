# Forecast Schedule Page — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a dedicated forecast-only calendar dashboard at `/dashboards/forecast-schedule` showing all forecast ghosts (including overdue on original dates) with a pipeline breakdown sidebar.

**Architecture:** Create a shared module (`src/lib/forecast-ghosts.ts`) with pure functions for forecast ghost generation. The new page uses this module directly. The main scheduler keeps its existing inline ghost builder unchanged — a future follow-up can migrate it to the shared module once both implementations are stable and proven equivalent. This avoids a risky refactor of the 5500-line scheduler page.

**Tech Stack:** Next.js page component, React Query, shared forecast ghost module, DashboardShell, Tailwind theme tokens.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/forecast-ghosts.ts` | **Create** | Shared forecast ghost generation: types, eligibility, ghost builder, stage/location helpers |
| `src/app/dashboards/forecast-schedule/page.tsx` | **Create** | Forecast-only calendar page with pipeline sidebar |
| `src/components/DashboardShell.tsx` | **Modify** | Add route → suite mapping for breadcrumb |
| `src/app/suites/operations/page.tsx` | **Modify** | Add nav card for Forecast Schedule |
| `src/__tests__/lib/forecast-ghosts.test.ts` | **Create** | Tests for shared forecast ghost module |

**Not modified:** `src/app/dashboards/scheduler/page.tsx` — the main scheduler's inline ghost builder stays as-is. Migration to the shared module is a future follow-up.

---

## Chunk 1: Shared Forecast Ghost Module

### Task 1: Create shared types and stage helpers

**Files:**
- Create: `src/lib/forecast-ghosts.ts`
- Test: `src/__tests__/lib/forecast-ghosts.test.ts`

- [ ] **Step 1: Write failing tests for stage mapping**

```typescript
// src/__tests__/lib/forecast-ghosts.test.ts
import { mapRawStage, mapStage, PRE_CONSTRUCTION_STAGES, normalizeLocation } from "@/lib/forecast-ghosts";

describe("forecast-ghosts", () => {
  describe("mapStage", () => {
    it("maps standard HubSpot stage names", () => {
      expect(mapStage("Site Survey")).toBe("survey");
      expect(mapStage("Ready To Build")).toBe("rtb");
      expect(mapStage("RTB - Blocked")).toBe("blocked");
      expect(mapStage("Construction")).toBe("construction");
      expect(mapStage("Inspection")).toBe("inspection");
    });

    it("returns 'other' for unknown stages", () => {
      expect(mapStage("Close Out")).toBe("other");
      expect(mapStage("")).toBe("other");
      expect(mapStage(null)).toBe("other");
    });
  });

  describe("mapRawStage", () => {
    it("maps D&E variants to 'design'", () => {
      expect(mapRawStage("Design & Engineering")).toBe("design");
      expect(mapRawStage("D&E")).toBe("design");
    });

    it("maps P&I variants to 'permitting'", () => {
      expect(mapRawStage("Permitting & Interconnection")).toBe("permitting");
      expect(mapRawStage("P&I")).toBe("permitting");
    });

    it("falls through to mapStage for other stages", () => {
      expect(mapRawStage("Site Survey")).toBe("survey");
      expect(mapRawStage("Ready To Build")).toBe("rtb");
    });
  });

  describe("PRE_CONSTRUCTION_STAGES", () => {
    it("includes all five pre-construction stages", () => {
      expect(PRE_CONSTRUCTION_STAGES.has("survey")).toBe(true);
      expect(PRE_CONSTRUCTION_STAGES.has("rtb")).toBe(true);
      expect(PRE_CONSTRUCTION_STAGES.has("blocked")).toBe(true);
      expect(PRE_CONSTRUCTION_STAGES.has("design")).toBe(true);
      expect(PRE_CONSTRUCTION_STAGES.has("permitting")).toBe(true);
    });

    it("excludes post-construction stages", () => {
      expect(PRE_CONSTRUCTION_STAGES.has("construction")).toBe(false);
      expect(PRE_CONSTRUCTION_STAGES.has("inspection")).toBe(false);
      expect(PRE_CONSTRUCTION_STAGES.has("other")).toBe(false);
    });
  });

  describe("normalizeLocation", () => {
    it("returns the trimmed value", () => {
      expect(normalizeLocation("Denver")).toBe("Denver");
    });

    it("maps DTC to Centennial", () => {
      expect(normalizeLocation("DTC")).toBe("Centennial");
    });

    it("returns Unknown for empty/null", () => {
      expect(normalizeLocation("")).toBe("Unknown");
      expect(normalizeLocation(null)).toBe("Unknown");
      expect(normalizeLocation(undefined)).toBe("Unknown");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand --runTestsByPath src/__tests__/lib/forecast-ghosts.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement types and helpers**

```typescript
// src/lib/forecast-ghosts.ts

// ── Types ──────────────────────────────────────────────────────

export interface TimelineMilestone {
  key: string;
  liveForecast: string | null;
  basis: string;
  varianceDays: number | null;
  name: string;
}

export interface TimelineProject {
  dealId: string;
  projectNumber: string;
  customerName: string;
  location: string;
  currentStage: string;
  milestones: TimelineMilestone[];
}

export interface RawProjectMinimal {
  id: string;
  name: string;
  stage: string;
  amount?: number;
  pbLocation?: string;
  city?: string;
  address?: string;
  projectType?: string;
  constructionScheduleDate?: string;
  siteSurveyScheduleDate?: string;
  siteSurveyCompletionDate?: string;
  isParticipateEnergy?: boolean;
  url?: string;
  ahj?: string;
  utility?: string;
  expectedDaysForInstall?: number;
  daysToInstall?: number | null;
  daysForElectricians?: number;
  roofersCount?: number;
  electriciansCount?: number;
  installDifficulty?: number;
  installNotes?: string;
  equipment?: {
    systemSizeKwdc?: number;
    modules?: { count?: number; brand?: string; model?: string; wattage?: number };
    inverter?: { count?: number; brand?: string; model?: string; sizeKwac?: number };
    battery?: { count?: number; expansionCount?: number; sizeKwh?: number; brand?: string };
    evCount?: number;
  };
}

export interface ForecastGhost {
  id: string;
  name: string;
  date: string;
  stage: string;
  location: string;
  amount: number;
  isForecast: true;
  eventType: "construction";
  days: number;
  address: string;
  type: string;
  systemSize: number;
  moduleCount: number;
  inverterCount: number;
  batteries: number;
  ahj: string;
  utility: string;
  hubspotUrl: string;
  isPE: boolean;
  installNotes: string;
  difficulty: number;
}

// ── Stage helpers ──────────────────────────────────────────────

const STAGE_MAP: Record<string, string> = {
  "Site Survey": "survey",
  "Ready To Build": "rtb",
  "RTB - Blocked": "blocked",
  Construction: "construction",
  Inspection: "inspection",
};

export function mapStage(stageRaw?: string | null): string {
  const stage = (stageRaw || "").trim();
  if (!stage) return "other";
  const direct = STAGE_MAP[stage];
  if (direct) return direct;
  const normalized = stage.toLowerCase();
  if (normalized === "site survey" || normalized === "survey") return "survey";
  if (normalized === "ready to build" || normalized === "rtb") return "rtb";
  if (normalized === "rtb - blocked" || normalized === "blocked") return "blocked";
  if (normalized === "construction") return "construction";
  if (normalized === "inspection") return "inspection";
  return "other";
}

export function mapRawStage(stageRaw: string): string {
  const s = (stageRaw || "").toLowerCase();
  if (s.includes("design") || s.includes("d&e") || s.includes("engineering")) return "design";
  if (s.includes("permit") || s.includes("interconnection") || s.includes("p&i")) return "permitting";
  return mapStage(stageRaw);
}

export const PRE_CONSTRUCTION_STAGES = new Set(["survey", "rtb", "blocked", "design", "permitting"]);

export function normalizeLocation(location?: string | null): string {
  const value = (location || "").trim();
  if (!value) return "Unknown";
  if (value === "DTC") return "Centennial";
  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --runInBand --runTestsByPath src/__tests__/lib/forecast-ghosts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/forecast-ghosts.ts src/__tests__/lib/forecast-ghosts.test.ts
git commit -m "feat: create forecast-ghosts shared module with stage helpers and types"
```

### Task 2: Add `buildForecastGhosts` function

**Files:**
- Modify: `src/lib/forecast-ghosts.ts`
- Test: `src/__tests__/lib/forecast-ghosts.test.ts`

- [ ] **Step 1: Write failing tests for `buildForecastGhosts`**

Add to test file after the existing describe blocks:

```typescript
import { buildForecastGhosts, type ForecastGhost } from "@/lib/forecast-ghosts";

describe("buildForecastGhosts", () => {
  const mkTimeline = (dealId: string, forecastDate: string | null, basis = "segment_median"): TimelineProject => ({
    dealId,
    projectNumber: `PROJ-${dealId}`,
    customerName: "Test",
    location: "Denver",
    currentStage: "RTB",
    milestones: [{ key: "install", liveForecast: forecastDate, basis, varianceDays: 5, name: "Install" }],
  });

  const mkRaw = (id: string, stage: string, overrides?: Partial<RawProjectMinimal>): RawProjectMinimal => ({
    id,
    name: `PROJ-${id} Test`,
    stage,
    amount: 50000,
    pbLocation: "Denver",
    address: "123 Main St",
    ...overrides,
  });

  it("generates ghost for eligible raw project", () => {
    const ghosts = buildForecastGhosts({
      timelineProjects: [mkTimeline("1", "2026-05-15")],
      rawProjects: [mkRaw("1", "Ready To Build")],
      scheduledEventIds: new Set(),
      manualInstallationIds: new Set(),
    });
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].date).toBe("2026-05-15");
    expect(ghosts[0].isForecast).toBe(true);
    expect(ghosts[0].stage).toBe("survey"); // mapRawStage("Ready To Build") -> mapStage -> "survey"... wait
  });

  it("skips project with constructionScheduleDate", () => {
    const ghosts = buildForecastGhosts({
      timelineProjects: [mkTimeline("1", "2026-05-15")],
      rawProjects: [mkRaw("1", "Ready To Build", { constructionScheduleDate: "2026-04-01" })],
      scheduledEventIds: new Set(),
      manualInstallationIds: new Set(),
    });
    expect(ghosts).toHaveLength(0);
  });

  it("generates ghost for D&E project", () => {
    const ghosts = buildForecastGhosts({
      timelineProjects: [mkTimeline("2", "2026-07-01")],
      rawProjects: [mkRaw("2", "Design & Engineering")],
      scheduledEventIds: new Set(),
      manualInstallationIds: new Set(),
    });
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].stage).toBe("design");
  });

  it("generates ghost for P&I project", () => {
    const ghosts = buildForecastGhosts({
      timelineProjects: [mkTimeline("3", "2026-08-01")],
      rawProjects: [mkRaw("3", "Permitting & Interconnection")],
      scheduledEventIds: new Set(),
      manualInstallationIds: new Set(),
    });
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].stage).toBe("permitting");
  });

  it("skips project with real construction event", () => {
    const ghosts = buildForecastGhosts({
      timelineProjects: [mkTimeline("1", "2026-05-15")],
      rawProjects: [mkRaw("1", "Ready To Build")],
      scheduledEventIds: new Set(["1"]),
      manualInstallationIds: new Set(),
    });
    expect(ghosts).toHaveLength(0);
  });

  it("skips project with manual installation schedule", () => {
    const ghosts = buildForecastGhosts({
      timelineProjects: [mkTimeline("1", "2026-05-15")],
      rawProjects: [mkRaw("1", "Ready To Build")],
      scheduledEventIds: new Set(),
      manualInstallationIds: new Set(["1"]),
    });
    expect(ghosts).toHaveLength(0);
  });

  it("skips project with actual basis milestone", () => {
    const ghosts = buildForecastGhosts({
      timelineProjects: [mkTimeline("1", "2026-05-15", "actual")],
      rawProjects: [mkRaw("1", "Ready To Build")],
      scheduledEventIds: new Set(),
      manualInstallationIds: new Set(),
    });
    expect(ghosts).toHaveLength(0);
  });

  it("skips project with no forecast date", () => {
    const ghosts = buildForecastGhosts({
      timelineProjects: [mkTimeline("1", null)],
      rawProjects: [mkRaw("1", "Ready To Build")],
      scheduledEventIds: new Set(),
      manualInstallationIds: new Set(),
    });
    expect(ghosts).toHaveLength(0);
  });

  it("populates all ForecastGhost fields from raw project", () => {
    const ghosts = buildForecastGhosts({
      timelineProjects: [mkTimeline("1", "2026-05-15")],
      rawProjects: [mkRaw("1", "RTB - Blocked", {
        amount: 75000,
        ahj: "Denver County",
        utility: "Xcel",
        installDifficulty: 4,
        installNotes: "Steep roof",
        equipment: { systemSizeKwdc: 10.5, modules: { count: 28 }, inverter: { count: 1 }, battery: { count: 2 } },
      })],
      scheduledEventIds: new Set(),
      manualInstallationIds: new Set(),
    });
    expect(ghosts).toHaveLength(1);
    const g = ghosts[0];
    expect(g.amount).toBe(75000);
    expect(g.ahj).toBe("Denver County");
    expect(g.utility).toBe("Xcel");
    expect(g.difficulty).toBe(4);
    expect(g.installNotes).toBe("Steep roof");
    expect(g.systemSize).toBe(10.5);
    expect(g.moduleCount).toBe(28);
    expect(g.batteries).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand --runTestsByPath src/__tests__/lib/forecast-ghosts.test.ts`
Expected: FAIL — `buildForecastGhosts` not exported

- [ ] **Step 3: Implement `buildForecastGhosts`**

Add to `src/lib/forecast-ghosts.ts`:

```typescript
// ── Builder input ──────────────────────────────────────────────

export interface BuildForecastGhostsInput {
  timelineProjects: TimelineProject[];
  rawProjects: RawProjectMinimal[];
  /** Set of project IDs that have real construction/construction-complete events */
  scheduledEventIds: Set<string>;
  /** Set of project IDs with manual installation schedules */
  manualInstallationIds: Set<string>;
}

// ── Builder ────────────────────────────────────────────────────

export function buildForecastGhosts(input: BuildForecastGhostsInput): ForecastGhost[] {
  const { timelineProjects, rawProjects, scheduledEventIds, manualInstallationIds } = input;
  const ghosts: ForecastGhost[] = [];

  for (const tp of timelineProjects) {
    const raw = rawProjects.find((r) => String(r.id) === tp.dealId);
    if (!raw) continue;

    const stage = mapRawStage(raw.stage);

    // Eligibility filter
    if (!PRE_CONSTRUCTION_STAGES.has(stage)) continue;
    if (raw.constructionScheduleDate) continue;
    if (manualInstallationIds.has(String(raw.id))) continue;
    if (scheduledEventIds.has(String(raw.id))) continue;

    const installMilestone = tp.milestones.find(
      (m) => m.key === "install" && m.basis !== "actual" && m.basis !== "insufficient"
    );
    if (!installMilestone?.liveForecast) continue;

    ghosts.push({
      id: String(raw.id),
      name: raw.name,
      date: installMilestone.liveForecast,
      stage,
      location: normalizeLocation(raw.pbLocation || raw.city),
      amount: raw.amount || 0,
      isForecast: true,
      eventType: "construction",
      days: raw.expectedDaysForInstall || raw.daysToInstall || 3,
      address: raw.address || "",
      type: raw.projectType || "Solar",
      systemSize: raw.equipment?.systemSizeKwdc || 0,
      moduleCount: raw.equipment?.modules?.count || 0,
      inverterCount: raw.equipment?.inverter?.count || 0,
      batteries: raw.equipment?.battery?.count || 0,
      ahj: raw.ahj || "",
      utility: raw.utility || "",
      hubspotUrl: raw.url || `https://app.hubspot.com/contacts/21710069/record/0-3/${raw.id}`,
      isPE: raw.isParticipateEnergy || false,
      installNotes: raw.installNotes || "",
      difficulty: raw.installDifficulty || 3,
    });
  }

  return ghosts;
}
```

Note: This builder always uses `rawProjects` (not the scheduler's enriched `SchedulerProject`). The main scheduler's inline builder continues to use its own dual-path logic. This keeps the shared module simple and avoids the type mismatch issue.

- [ ] **Step 4: Fix the test assertion — `mapRawStage("Ready To Build")` returns "rtb" not "survey"**

The `mkTimeline` test helper's first test should expect `stage: "rtb"`:

```typescript
  it("generates ghost for eligible raw project", () => {
    // ...
    expect(ghosts[0].stage).toBe("rtb");
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest --runInBand --runTestsByPath src/__tests__/lib/forecast-ghosts.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/forecast-ghosts.ts src/__tests__/lib/forecast-ghosts.test.ts
git commit -m "feat: add buildForecastGhosts pure function with full test coverage"
```

---

## Chunk 2: Forecast Schedule Page

### Task 3: Create page shell with data fetching

**Files:**
- Create: `src/app/dashboards/forecast-schedule/page.tsx`

- [ ] **Step 1: Create the page with DashboardShell, useQuery, and ghost generation**

```typescript
"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import {
  buildForecastGhosts,
  normalizeLocation,
  type TimelineProject,
  type RawProjectMinimal,
  type ForecastGhost,
} from "@/lib/forecast-ghosts";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const STAGE_LABELS: Record<string, string> = {
  survey: "Survey",
  rtb: "RTB",
  blocked: "Blocked",
  design: "D&E",
  permitting: "P&I",
};

const STAGE_COLORS: Record<string, string> = {
  survey: "bg-cyan-500",
  rtb: "bg-blue-500",
  blocked: "bg-red-500",
  design: "bg-purple-500",
  permitting: "bg-amber-500",
};

function formatRevenueCompact(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${Math.round(amount / 1_000)}K`;
  return String(Math.round(amount));
}

export default function ForecastSchedulePage() {
  useActivityTracking();
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());

  // Filters
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedStages, setSelectedStages] = useState<string[]>([]);

  // Data fetching — same endpoints as main scheduler's forecastQuery
  const { data, isLoading, error } = useQuery<{
    timelineProjects: TimelineProject[];
    rawProjects: RawProjectMinimal[];
    lastUpdated: string;
  }>({
    queryKey: ["forecast-schedule"],
    queryFn: async () => {
      const [timelineRes, rawRes] = await Promise.all([
        fetch("/api/forecasting/timeline"),
        fetch("/api/projects"),
      ]);
      if (!timelineRes.ok) throw new Error("Failed to fetch forecasts");
      const timeline = await timelineRes.json();
      const raw = rawRes.ok ? await rawRes.json() : { projects: [] };
      return {
        timelineProjects: timeline.projects,
        rawProjects: raw.projects,
        lastUpdated: new Date().toISOString(),
      };
    },
    refetchInterval: 5 * 60 * 1000,
  });

  // Build all forecast ghosts (including overdue — this page shows everything)
  const allGhosts = useMemo((): ForecastGhost[] => {
    if (!data) return [];
    return buildForecastGhosts({
      timelineProjects: data.timelineProjects,
      rawProjects: data.rawProjects,
      scheduledEventIds: new Set(), // This page doesn't have scheduler event context
      manualInstallationIds: new Set(),
    });
  }, [data]);

  // Apply filters — affect BOTH calendar and sidebar
  const filteredGhosts = useMemo(() => {
    return allGhosts.filter((g) => {
      if (selectedLocations.length > 0 && !selectedLocations.includes(g.location)) return false;
      if (selectedStages.length > 0 && !selectedStages.includes(g.stage)) return false;
      return true;
    });
  }, [allGhosts, selectedLocations, selectedStages]);

  // Overdue split (local date)
  const todayLocal = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const overdueGhosts = useMemo(() => filteredGhosts.filter((g) => g.date < todayLocal), [filteredGhosts, todayLocal]);

  // Available filter options (derived from unfiltered ghosts)
  const allLocations = useMemo(() => [...new Set(allGhosts.map((g) => g.location))].sort(), [allGhosts]);
  const allStages = useMemo(() => [...new Set(allGhosts.map((g) => g.stage))].sort(), [allGhosts]);

  // Pipeline breakdown — computed from filteredGhosts
  const stageBreakdown = useMemo(() => {
    const map: Record<string, { count: number; revenue: number }> = {};
    for (const g of filteredGhosts) {
      if (!map[g.stage]) map[g.stage] = { count: 0, revenue: 0 };
      map[g.stage].count++;
      map[g.stage].revenue += g.amount;
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredGhosts]);

  const locationBreakdown = useMemo(() => {
    const map: Record<string, { count: number; revenue: number }> = {};
    for (const g of filteredGhosts) {
      if (!map[g.location]) map[g.location] = { count: 0, revenue: 0 };
      map[g.location].count++;
      map[g.location].revenue += g.amount;
    }
    return Object.entries(map).sort(([, a], [, b]) => b.revenue - a.revenue);
  }, [filteredGhosts]);

  // Calendar data
  // ... (see Step 2 for calendar grid implementation)

  // Render shell, filters, calendar grid, and sidebar
  // ... (see Steps 2-4 for full rendering)

  return (
    <DashboardShell title="Forecast Schedule" accentColor="blue" lastUpdated={data?.lastUpdated}>
      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorState message="Failed to load forecast data" />
      ) : (
        <div>Placeholder — see Steps 2-4</div>
      )}
    </DashboardShell>
  );
}
```

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds (page renders placeholder)

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/forecast-schedule/page.tsx
git commit -m "feat: add forecast schedule page shell with data fetching and ghost generation"
```

### Task 4: Add calendar grid rendering

**Files:**
- Modify: `src/app/dashboards/forecast-schedule/page.tsx`

- [ ] **Step 1: Add calendar grid computation**

Add a `calendarData` useMemo. Unlike the main scheduler's weekday-only grid, this page uses a full 7-day grid so weekend forecast dates are not dropped:

```typescript
const calendarData = useMemo(() => {
  const firstDay = new Date(currentYear, currentMonth, 1);
  const lastDay = new Date(currentYear, currentMonth + 1, 0);
  const startDay = firstDay.getDay(); // 0=Sun through 6=Sat
  const daysInMonth = lastDay.getDate();
  return { startDay, daysInMonth };
}, [currentYear, currentMonth]);
```

- [ ] **Step 2: Add calendar grid JSX**

Replace the placeholder `<div>` with the full layout: a flex container with the calendar grid (left) and sidebar (right). The calendar uses a 7-column full-week grid (Sun–Sat) so weekend forecast dates are preserved. Weekend columns are visually muted (`opacity-50 bg-surface-2`) to signal they're non-working days while still showing the data. Each cell shows forecast ghost pills with blue dashed styling. Overdue ghosts use amber dashed border.

Ghost pill rendering pattern (from main scheduler lines 3738-3770):
- Future ghosts: `bg-blue-500/40 text-blue-200 border border-dashed border-blue-400 opacity-60`
- Overdue ghosts: `bg-amber-500/30 text-amber-200 border border-dashed border-amber-500 opacity-70`
- Each pill shows project name truncated, with a FORECAST or OVERDUE tag

Month navigation: prev/next buttons and a "Today" button to jump back to current month.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/forecast-schedule/page.tsx
git commit -m "feat: add calendar grid with forecast ghost rendering and month navigation"
```

### Task 5: Add filter controls and pipeline sidebar

**Files:**
- Modify: `src/app/dashboards/forecast-schedule/page.tsx`

- [ ] **Step 1: Add filter controls above the calendar**

Add location and stage multi-select filter buttons (same pill-toggle pattern used in the main scheduler for `calendarLocations` and `calendarScheduleTypes`). Each filter button toggles its value in/out of the selected array.

- [ ] **Step 2: Add pipeline sidebar**

The sidebar (right of calendar) contains:

1. **Overdue callout** (if any overdue ghosts exist):
   - Amber background, shows count and total revenue
   - Same pattern as PR #102's shared callout in the main scheduler

2. **By Stage** section:
   - Each stage row: colored dot + label + count + revenue
   - Stages: Survey, RTB, Blocked, D&E, P&I

3. **By Location** section:
   - Each location row: name + count + revenue
   - Sorted by revenue descending

4. **Totals** at bottom:
   - Total forecasted count and revenue

Sidebar uses theme tokens: `bg-surface`, `border-t-border`, `text-foreground`, `text-muted`.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/forecast-schedule/page.tsx
git commit -m "feat: add filter controls and pipeline breakdown sidebar"
```

### Task 6: Add navigation, route mapping, and role permissions

**Files:**
- Modify: `src/components/DashboardShell.tsx` (line ~14, near other scheduler entries)
- Modify: `src/app/suites/operations/page.tsx`
- Modify: `src/lib/role-permissions.ts`

- [ ] **Step 1: Add route → suite mapping in DashboardShell**

Add to the `SUITE_MAP` object:

```typescript
"/dashboards/forecast-schedule": { href: "/suites/operations", label: "Operations" },
```

- [ ] **Step 2: Add nav card in Operations suite**

Add to the `LINKS` array in the "Scheduling" section:

```typescript
{
  href: "/dashboards/forecast-schedule",
  title: "Forecast Schedule",
  description: "Calendar view of all forecasted installs by stage and location with pipeline breakdown.",
  tag: "FORECAST",
  section: "Scheduling",
},
```

- [ ] **Step 3: Add route to role permissions**

In `src/lib/role-permissions.ts`, add `"/dashboards/forecast-schedule"` to every role's `allowedRoutes` array that already has `"/dashboards/scheduler"`. This gives the forecast page the same access as the main scheduler. The roles that have `/dashboards/scheduler` are: ADMIN, OWNER, MANAGER, OPERATIONS, OPERATIONS_MANAGER, PROJECT_MANAGER, TECH_OPS.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/components/DashboardShell.tsx src/app/suites/operations/page.tsx src/lib/role-permissions.ts
git commit -m "feat: add Forecast Schedule to navigation, Operations suite, and role permissions"
```

---

## Implementation Notes

### Filter behavior
Location and stage filters apply to **both** the calendar grid and the sidebar totals. When you filter to "Denver" + "D&E", the sidebar shows only Denver D&E forecast counts/revenue, and the calendar shows only those ghosts. The `filteredGhosts` array is the single source of truth for both.

### Overdue rendering
On this page (unlike the main scheduler), overdue ghosts render on their original predicted dates. They use an amber border variant to visually distinguish "forecasts that should have happened by now" from future forecasts.

### Scheduler unchanged
The main scheduler's inline ghost builder (`allForecastGhosts` useMemo) stays as-is. Both implementations share the same eligibility logic conceptually, but the scheduler version includes scheduler-specific concerns (enriched `SchedulerProject`, calendar filters, `zuperJobCategory` checks). A future follow-up can migrate the scheduler to the shared module once both are stable.

### Already-scheduled signal coverage
The shared `buildForecastGhosts` checks `raw.constructionScheduleDate` to skip projects that are already scheduled in HubSpot. The forecast page passes empty sets for `scheduledEventIds` and `manualInstallationIds` because it doesn't have the scheduler's Zuper enrichment or tentative schedule DB context. This means:
- **Covered:** Projects with `constructionScheduleDate` set in HubSpot (the primary case)
- **Not covered:** Projects with only a Zuper construction job match or a tentative manual schedule in the DB

This is an acceptable trade-off for a planning/visibility tool. The forecast page may show a small number of extra ghosts for edge cases where a project was scheduled via Zuper but HubSpot wasn't updated yet. These are rare and self-correcting (once HubSpot is updated, the ghost disappears).

### Role access
The page is added to `src/lib/role-permissions.ts` with the same role access as `/dashboards/scheduler` (ADMIN, OWNER, MANAGER, OPERATIONS, OPERATIONS_MANAGER, PROJECT_MANAGER, TECH_OPS). Middleware enforces this via `ROLE_PERMISSIONS.allowedRoutes`.

### What this does NOT include
- No drag-and-drop scheduling (read-only forecast view)
- No crew assignment or manual schedule interaction
- No weekly/monthly revenue breakdown (the pipeline sidebar replaces this)
- No SSE real-time updates (forecasts refresh on 5-minute interval)
