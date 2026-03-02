# Intelligence Suite Dissolution + Forecast Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a QC-data-driven forecasting engine, retrofit all forecast-dependent dashboards, then dissolve the Intelligence Suite by redistributing dashboards to their natural homes.

**Architecture:** Shared forecasting module (`src/lib/forecasting.ts`) computes milestone forecasts from historical QC data segmented by location/AHJ/utility. Forecasts are computed at transform-time on `TransformedProject`, cached via `appCache` with daily refresh. Suite dissolution happens in phases — safe moves first, forecast-dependent dashboards held for evaluation.

**Tech Stack:** Next.js 16.1, TypeScript, appCache (CacheStore), HubSpot Project data, Jest for testing.

---

## Phase 1: Forecasting Engine

### Task 1: QC Baseline Builder — Types and Interface

**Files:**
- Create: `src/lib/forecasting.ts`
- Test: `src/__tests__/lib/forecasting.test.ts`

**Context:** The milestone chain is: Close → Design Complete → Permit Submit → Permit Approval → IC Submit → IC Approval → RTB → Install → Inspection → PTO. We compute median days between each consecutive pair from completed projects, segmented by `(location, AHJ, utility)` with fallback hierarchy.

The HubSpot `Project` interface (in `src/lib/hubspot.ts:280-360`) already has all milestone date fields:
- `closeDate` (line 294)
- `designCompletionDate` (line 302) — maps to "Design Complete"
- `permitSubmitDate` (line 317)
- `permitIssueDate` (line 318) — maps to "Permit Approval"
- `interconnectionSubmitDate` (line 322) — maps to "IC Submit"
- `interconnectionApprovalDate` (line 323) — maps to "IC Approval"
- `readyToBuildDate` (line 327) — maps to "RTB"
- `constructionCompleteDate` (line 329) — maps to "Install" (construction complete = installed)
- `inspectionPassDate` (line 334)
- `ptoGrantedDate` (line 339)

**Step 1: Write the failing test for types and baseline builder**

```ts
// src/__tests__/lib/forecasting.test.ts
import type { Project } from "@/lib/hubspot";
import {
  MILESTONE_CHAIN,
  type MilestoneKey,
  type SegmentKey,
  type BaselineEntry,
  type BaselineTable,
  buildBaselineTable,
} from "@/lib/forecasting";

function makeCompletedProject(overrides: Partial<Project> = {}): Project {
  // A fully completed project with all milestone dates set
  return {
    id: 1,
    name: "Test | Smith",
    projectNumber: "PROJ-0001",
    pbLocation: "Westminster",
    ahj: "Boulder County",
    utility: "Xcel",
    projectType: "Residential",
    stage: "PTO",
    stageId: "pto",
    amount: 50000,
    url: "https://hubspot.com/deal/1",
    tags: [],
    isParticipateEnergy: false,
    participateEnergyStatus: null,
    isSiteSurveyScheduled: true,
    isSiteSurveyCompleted: true,
    isDASent: true,
    isDesignApproved: true,
    isDesignDrafted: true,
    isDesignCompleted: true,
    isPermitSubmitted: true,
    isPermitIssued: true,
    isInterconnectionSubmitted: true,
    isInterconnectionApproved: true,
    threeceEvStatus: null,
    threeceBatteryStatus: null,
    sgipStatus: null,
    pbsrStatus: null,
    cpaStatus: null,
    closeDate: "2025-01-01",
    siteSurveyScheduleDate: null,
    siteSurveyCompletionDate: null,
    siteSurveyStatus: null,
    designCompletionDate: "2025-01-15",
    designApprovalDate: null,
    designDraftDate: null,
    designApprovalSentDate: null,
    designStartDate: null,
    dateReturnedFromDesigners: null,
    daRevisionCounter: null,
    asBuiltRevisionCounter: null,
    permitRevisionCounter: null,
    interconnectionRevisionCounter: null,
    totalRevisionCount: null,
    designStatus: null,
    layoutStatus: null,
    permitSubmitDate: "2025-01-20",
    permitIssueDate: "2025-02-10",
    permittingStatus: null,
    interconnectionSubmitDate: "2025-01-25",
    interconnectionApprovalDate: "2025-02-15",
    interconnectionStatus: null,
    readyToBuildDate: "2025-02-20",
    constructionScheduleDate: null,
    constructionCompleteDate: "2025-03-15",
    constructionStatus: null,
    inspectionScheduleDate: null,
    inspectionPassDate: "2025-03-25",
    finalInspectionStatus: null,
    ptoSubmitDate: null,
    ptoGrantedDate: "2025-04-10",
    ptoStatus: null,
    forecastedInstallDate: null,
    forecastedInspectionDate: null,
    forecastedPtoDate: null,
    daysToInstall: null,
    daysToInspection: null,
    daysToPto: null,
    daysSinceClose: 365,
    daysSinceStageMovement: 0,
    stagePriority: 0,
    isRtb: false,
    isSchedulable: false,
    isActive: false,
    isBlocked: false,
    priorityScore: 0,
    expectedDaysForInstall: 0,
    daysForInstallers: 0,
    installCrew: null,
    projectManager: null,
    surveyor: null,
    equipment: {
      modules: { brand: "", model: "", count: 0, wattage: 0, productName: "" },
      inverter: { brand: "", model: "", count: 0, sizeKwac: 0, productName: "" },
      battery: { brand: "", model: "", count: 0, sizeKwh: 0, expansionCount: 0, productName: "", expansionProductName: "", expansionModel: "" },
      evCount: 0,
      systemSizeKwdc: 0,
      systemSizeKwac: 0,
    },
    // Time metrics (all null for factory — the baseline builder doesn't use these)
    siteSurveyTurnaroundTime: null,
    timeDAReadyToSent: null,
    daTurnaroundTime: null,
    timeToSubmitPermit: null,
    timeToSubmitInterconnection: null,
    daToRtb: null,
    constructionTurnaroundTime: null,
    timeCcToPto: null,
    timeToCc: null,
    timeToDa: null,
    timeToPto: null,
    interconnectionTurnaroundTime: null,
    permitTurnaroundTime: null,
    timeRtbToConstructionSchedule: null,
    designTurnaroundTime: null,
    projectTurnaroundTime: null,
    timeToRtb: null,
    timeRtbToCc: null,
    daToCc: null,
    daToPermit: null,
    ...overrides,
  } as Project;
}

describe("MILESTONE_CHAIN", () => {
  it("has 10 milestones in the correct order", () => {
    expect(MILESTONE_CHAIN).toEqual([
      "close",
      "designComplete",
      "permitSubmit",
      "permitApproval",
      "icSubmit",
      "icApproval",
      "rtb",
      "install",
      "inspection",
      "pto",
    ]);
  });
});

describe("buildBaselineTable", () => {
  it("computes median days between milestones for a segment", () => {
    // 5 identical projects = reliable segment
    const projects = Array.from({ length: 5 }, (_, i) =>
      makeCompletedProject({ id: i + 1 })
    );

    const table = buildBaselineTable(projects);
    const segKey = "Westminster|Boulder County|Xcel";
    const entry = table[segKey];

    expect(entry).toBeDefined();
    expect(entry.sampleCount).toBe(5);
    // Close (Jan 1) → Design Complete (Jan 15) = 14 days
    expect(entry.pairs.close_to_designComplete.median).toBe(14);
    // Design Complete (Jan 15) → Permit Submit (Jan 20) = 5 days
    expect(entry.pairs.designComplete_to_permitSubmit.median).toBe(5);
  });

  it("falls back to location segment when full segment has < 5 projects", () => {
    // 3 projects in full segment (below threshold)
    const projects = Array.from({ length: 3 }, (_, i) =>
      makeCompletedProject({ id: i + 1 })
    );

    const table = buildBaselineTable(projects);
    const fullKey = "Westminster|Boulder County|Xcel";
    const locKey = "Westminster||";

    // Full segment should NOT exist (< 5 data points)
    expect(table[fullKey]).toBeUndefined();
    // Location fallback should NOT exist either (3 < 5)
    expect(table[locKey]).toBeUndefined();
    // But global SHOULD exist (3 >= 3 for global minimum)
    expect(table["global"]).toBeDefined();
  });

  it("includes p25 and p75 confidence bands", () => {
    const projects = Array.from({ length: 10 }, (_, i) => {
      // Vary the design complete date to get spread
      const designDay = 10 + i * 2; // 10, 12, 14, ..., 28
      const designDate = `2025-01-${String(designDay).padStart(2, "0")}`;
      return makeCompletedProject({
        id: i + 1,
        designCompletionDate: designDate,
      });
    });

    const table = buildBaselineTable(projects);
    const segKey = "Westminster|Boulder County|Xcel";
    const pair = table[segKey].pairs.close_to_designComplete;

    expect(pair.p25).toBeDefined();
    expect(pair.p75).toBeDefined();
    expect(pair.p25).toBeLessThanOrEqual(pair.median);
    expect(pair.p75).toBeGreaterThanOrEqual(pair.median);
  });

  it("skips milestone pairs where either date is null", () => {
    const projects = Array.from({ length: 5 }, (_, i) =>
      makeCompletedProject({
        id: i + 1,
        ptoGrantedDate: null, // PTO not yet granted
      })
    );

    const table = buildBaselineTable(projects);
    const segKey = "Westminster|Boulder County|Xcel";
    const pair = table[segKey]?.pairs.inspection_to_pto;

    // Pair should have no data
    expect(pair?.median).toBeNull();
    expect(pair?.sampleCount).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="forecasting" --no-coverage`
Expected: FAIL — module `@/lib/forecasting` does not exist

**Step 3: Write the types and baseline builder**

```ts
// src/lib/forecasting.ts
import type { Project } from "@/lib/hubspot";

// --- Milestone Chain ---

export const MILESTONE_CHAIN = [
  "close",
  "designComplete",
  "permitSubmit",
  "permitApproval",
  "icSubmit",
  "icApproval",
  "rtb",
  "install",
  "inspection",
  "pto",
] as const;

export type MilestoneKey = (typeof MILESTONE_CHAIN)[number];

/** Maps MilestoneKey → Project date field name */
const MILESTONE_DATE_FIELD: Record<MilestoneKey, keyof Project> = {
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
};

// --- Segment Keys ---

export type SegmentKey = string; // "location|ahj|utility" or "location||" or "global"

function fullSegmentKey(p: Project): SegmentKey {
  return `${p.pbLocation}|${p.ahj}|${p.utility}`;
}

function locationSegmentKey(p: Project): SegmentKey {
  return `${p.pbLocation}||`;
}

const GLOBAL_KEY: SegmentKey = "global";

// --- Baseline Types ---

export interface PairStats {
  median: number | null;
  p25: number | null;
  p75: number | null;
  sampleCount: number;
}

export interface BaselineEntry {
  sampleCount: number;
  pairs: Record<string, PairStats>;
}

export type BaselineTable = Record<SegmentKey, BaselineEntry>;

// --- Constants ---

const MIN_SEGMENT_SAMPLES = 5;
const MIN_GLOBAL_SAMPLES = 3;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

// --- Helpers ---

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) / MS_PER_DAY
  );
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
}

function pairKey(from: MilestoneKey, to: MilestoneKey): string {
  return `${from}_to_${to}`;
}

// --- Baseline Builder ---

function computePairStats(durations: number[]): PairStats {
  if (durations.length === 0) {
    return { median: null, p25: null, p75: null, sampleCount: 0 };
  }
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    median: median(sorted),
    p25: percentile(sorted, 25),
    p75: percentile(sorted, 75),
    sampleCount: sorted.length,
  };
}

function buildSegmentEntry(
  projects: Project[],
): BaselineEntry {
  const pairs: Record<string, PairStats> = {};

  for (let i = 0; i < MILESTONE_CHAIN.length - 1; i++) {
    const from = MILESTONE_CHAIN[i];
    const to = MILESTONE_CHAIN[i + 1];
    const fromField = MILESTONE_DATE_FIELD[from];
    const toField = MILESTONE_DATE_FIELD[to];

    const durations: number[] = [];
    for (const p of projects) {
      const fromDate = p[fromField] as string | null;
      const toDate = p[toField] as string | null;
      if (fromDate && toDate) {
        const days = daysBetween(fromDate, toDate);
        if (days >= 0) durations.push(days); // skip negative (data errors)
      }
    }

    pairs[pairKey(from, to)] = computePairStats(durations);
  }

  return { sampleCount: projects.length, pairs };
}

export function buildBaselineTable(projects: Project[]): BaselineTable {
  const table: BaselineTable = {};

  // Group by full segment
  const fullGroups: Record<SegmentKey, Project[]> = {};
  const locationGroups: Record<SegmentKey, Project[]> = {};

  for (const p of projects) {
    const fk = fullSegmentKey(p);
    const lk = locationSegmentKey(p);
    (fullGroups[fk] ??= []).push(p);
    (locationGroups[lk] ??= []).push(p);
  }

  // Full segments (location + AHJ + utility)
  for (const [key, group] of Object.entries(fullGroups)) {
    if (group.length >= MIN_SEGMENT_SAMPLES) {
      table[key] = buildSegmentEntry(group);
    }
  }

  // Location-only fallback
  for (const [key, group] of Object.entries(locationGroups)) {
    if (group.length >= MIN_SEGMENT_SAMPLES) {
      table[key] = buildSegmentEntry(group);
    }
  }

  // Global fallback
  if (projects.length >= MIN_GLOBAL_SAMPLES) {
    table[GLOBAL_KEY] = buildSegmentEntry(projects);
  }

  return table;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="forecasting" --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/forecasting.ts src/__tests__/lib/forecasting.test.ts
git commit -m "feat(forecasting): add QC baseline builder with segment fallback hierarchy"
```

---

### Task 2: Forecast Calculator

**Files:**
- Modify: `src/lib/forecasting.ts`
- Test: `src/__tests__/lib/forecasting.test.ts`

**Context:** Given a project and a baseline table, produce `original_forecast` (immutable snapshot) and `live_forecast` (updated as milestones complete). Each forecasted date has a `basis` field: `"segment"`, `"location"`, `"global"`, `"actual"`, or `"insufficient"`.

**Step 1: Write the failing test**

Append to `src/__tests__/lib/forecasting.test.ts`:

```ts
import {
  // ... existing imports ...
  computeForecast,
  type ForecastSet,
  type ForecastedMilestone,
} from "@/lib/forecasting";

describe("computeForecast", () => {
  function makeBasicTable(): BaselineTable {
    // Simple table: every pair takes 14 days
    const pairs: Record<string, PairStats> = {};
    for (let i = 0; i < MILESTONE_CHAIN.length - 1; i++) {
      const from = MILESTONE_CHAIN[i];
      const to = MILESTONE_CHAIN[i + 1];
      pairs[`${from}_to_${to}`] = { median: 14, p25: 10, p75: 18, sampleCount: 10 };
    }
    return {
      "Westminster|Boulder County|Xcel": { sampleCount: 10, pairs },
      global: { sampleCount: 100, pairs },
    };
  }

  it("chains forecast dates from closeDate using segment data", () => {
    const table = makeBasicTable();
    const project = makeCompletedProject({
      closeDate: "2025-06-01",
      // Clear all milestone dates so everything is forecasted
      designCompletionDate: null,
      permitSubmitDate: null,
      permitIssueDate: null,
      interconnectionSubmitDate: null,
      interconnectionApprovalDate: null,
      readyToBuildDate: null,
      constructionCompleteDate: null,
      inspectionPassDate: null,
      ptoGrantedDate: null,
    });

    const forecast = computeForecast(project, table);

    // Close is always actual (from closeDate)
    expect(forecast.close.date).toBe("2025-06-01");
    expect(forecast.close.basis).toBe("actual");

    // Design Complete = close + 14 days = Jun 15
    expect(forecast.designComplete.date).toBe("2025-06-15");
    expect(forecast.designComplete.basis).toBe("segment");

    // Install = close + (14 * 7) = 98 days = Sep 7
    expect(forecast.install.date).toBe("2025-09-07");
    expect(forecast.install.basis).toBe("segment");

    // PTO = close + (14 * 9) = 126 days = Oct 5
    expect(forecast.pto.date).toBe("2025-10-05");
    expect(forecast.pto.basis).toBe("segment");
  });

  it("uses actual dates when milestones are completed", () => {
    const table = makeBasicTable();
    const project = makeCompletedProject({
      closeDate: "2025-06-01",
      designCompletionDate: "2025-06-10", // actually completed early
      // Rest null
      permitSubmitDate: null,
      permitIssueDate: null,
      interconnectionSubmitDate: null,
      interconnectionApprovalDate: null,
      readyToBuildDate: null,
      constructionCompleteDate: null,
      inspectionPassDate: null,
      ptoGrantedDate: null,
    });

    const forecast = computeForecast(project, table);

    expect(forecast.designComplete.date).toBe("2025-06-10");
    expect(forecast.designComplete.basis).toBe("actual");

    // Permit Submit should chain from actual design date (Jun 10 + 14)
    expect(forecast.permitSubmit.date).toBe("2025-06-24");
    expect(forecast.permitSubmit.basis).toBe("segment");
  });

  it("falls back to location segment when full segment unavailable", () => {
    const pairs: Record<string, PairStats> = {};
    for (let i = 0; i < MILESTONE_CHAIN.length - 1; i++) {
      const from = MILESTONE_CHAIN[i];
      const to = MILESTONE_CHAIN[i + 1];
      pairs[`${from}_to_${to}`] = { median: 20, p25: 15, p75: 25, sampleCount: 8 };
    }
    const table: BaselineTable = {
      // No full segment for this project — only location fallback
      "Westminster||": { sampleCount: 8, pairs },
      global: { sampleCount: 100, pairs },
    };

    const project = makeCompletedProject({
      closeDate: "2025-06-01",
      designCompletionDate: null,
      permitSubmitDate: null,
      permitIssueDate: null,
      interconnectionSubmitDate: null,
      interconnectionApprovalDate: null,
      readyToBuildDate: null,
      constructionCompleteDate: null,
      inspectionPassDate: null,
      ptoGrantedDate: null,
    });

    const forecast = computeForecast(project, table);
    expect(forecast.designComplete.basis).toBe("location");
    expect(forecast.designComplete.date).toBe("2025-06-21"); // Jun 1 + 20
  });

  it("returns insufficient when no baseline data exists", () => {
    const table: BaselineTable = {}; // empty table

    const project = makeCompletedProject({
      closeDate: "2025-06-01",
      designCompletionDate: null,
      permitSubmitDate: null,
      permitIssueDate: null,
      interconnectionSubmitDate: null,
      interconnectionApprovalDate: null,
      readyToBuildDate: null,
      constructionCompleteDate: null,
      inspectionPassDate: null,
      ptoGrantedDate: null,
    });

    const forecast = computeForecast(project, table);
    expect(forecast.designComplete.basis).toBe("insufficient");
    expect(forecast.designComplete.date).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="forecasting" --no-coverage`
Expected: FAIL — `computeForecast` not exported

**Step 3: Write the forecast calculator**

Add to `src/lib/forecasting.ts`:

```ts
// --- Forecast Types ---

export type ForecastBasis = "segment" | "location" | "global" | "actual" | "insufficient";

export interface ForecastedMilestone {
  date: string | null;
  basis: ForecastBasis;
}

export type ForecastSet = Record<MilestoneKey, ForecastedMilestone>;

// --- Forecast Calculator ---

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function resolveSegment(
  project: Project,
  table: BaselineTable,
): { entry: BaselineEntry; basis: ForecastBasis } | null {
  // Try full segment first
  const fullKey = fullSegmentKey(project);
  if (table[fullKey]) return { entry: table[fullKey], basis: "segment" };

  // Try location fallback
  const locKey = locationSegmentKey(project);
  if (table[locKey]) return { entry: table[locKey], basis: "location" };

  // Try global
  if (table[GLOBAL_KEY]) return { entry: table[GLOBAL_KEY], basis: "global" };

  return null;
}

export function computeForecast(
  project: Project,
  table: BaselineTable,
): ForecastSet {
  const result: Partial<ForecastSet> = {};
  const segment = resolveSegment(project, table);

  // Close is always actual
  const closeDate = project.closeDate;
  result.close = closeDate
    ? { date: closeDate, basis: "actual" }
    : { date: null, basis: "insufficient" };

  // Walk the chain forward from close
  let lastDate = closeDate;

  for (let i = 1; i < MILESTONE_CHAIN.length; i++) {
    const milestone = MILESTONE_CHAIN[i];
    const prev = MILESTONE_CHAIN[i - 1];
    const dateField = MILESTONE_DATE_FIELD[milestone];
    const actualDate = project[dateField] as string | null;

    if (actualDate) {
      // Milestone completed — use actual date
      result[milestone] = { date: actualDate, basis: "actual" };
      lastDate = actualDate;
      continue;
    }

    // Need to forecast
    if (!lastDate || !segment) {
      result[milestone] = { date: null, basis: "insufficient" };
      continue;
    }

    const pk = pairKey(prev, milestone);
    const pairStats = segment.entry.pairs[pk];

    if (!pairStats || pairStats.median === null) {
      result[milestone] = { date: null, basis: "insufficient" };
      continue;
    }

    const forecastDate = addDays(lastDate, pairStats.median);
    result[milestone] = { date: forecastDate, basis: segment.basis };
    lastDate = forecastDate;
  }

  return result as ForecastSet;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="forecasting" --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/forecasting.ts src/__tests__/lib/forecasting.test.ts
git commit -m "feat(forecasting): add forecast calculator with segment fallback and basis tracking"
```

---

### Task 3: Live Recalculation + Original/Live Forecast Pair

**Files:**
- Modify: `src/lib/forecasting.ts`
- Test: `src/__tests__/lib/forecasting.test.ts`

**Context:** Each project gets two forecast sets: `original_forecast` (locked at first computation) and `live_forecast` (recomputed as milestones complete). `computeForecast` already handles live calculation by using actual dates when present. We need a function that produces both sets from a single project.

**Step 1: Write the failing test**

```ts
import {
  // ... existing ...
  computeProjectForecasts,
  type ProjectForecasts,
} from "@/lib/forecasting";

describe("computeProjectForecasts", () => {
  function makeBasicTable(): BaselineTable {
    const pairs: Record<string, PairStats> = {};
    for (let i = 0; i < MILESTONE_CHAIN.length - 1; i++) {
      const from = MILESTONE_CHAIN[i];
      const to = MILESTONE_CHAIN[i + 1];
      pairs[`${from}_to_${to}`] = { median: 14, p25: 10, p75: 18, sampleCount: 10 };
    }
    return {
      "Westminster|Boulder County|Xcel": { sampleCount: 10, pairs },
      global: { sampleCount: 100, pairs },
    };
  }

  it("original forecast ignores actuals, live forecast uses them", () => {
    const table = makeBasicTable();
    const project = makeCompletedProject({
      closeDate: "2025-06-01",
      designCompletionDate: "2025-06-10", // completed early (day 10 vs forecast day 15)
      permitSubmitDate: null,
      permitIssueDate: null,
      interconnectionSubmitDate: null,
      interconnectionApprovalDate: null,
      readyToBuildDate: null,
      constructionCompleteDate: null,
      inspectionPassDate: null,
      ptoGrantedDate: null,
    });

    const { original, live } = computeProjectForecasts(project, table);

    // Original: designComplete forecasted from close + 14 = Jun 15
    expect(original.designComplete.date).toBe("2025-06-15");
    expect(original.designComplete.basis).toBe("segment");

    // Live: designComplete is actual Jun 10
    expect(live.designComplete.date).toBe("2025-06-10");
    expect(live.designComplete.basis).toBe("actual");

    // Original: permitSubmit = Jun 15 + 14 = Jun 29
    expect(original.permitSubmit.date).toBe("2025-06-29");

    // Live: permitSubmit = Jun 10 + 14 = Jun 24 (chains from actual)
    expect(live.permitSubmit.date).toBe("2025-06-24");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="forecasting" --no-coverage`
Expected: FAIL — `computeProjectForecasts` not exported

**Step 3: Implement computeProjectForecasts**

Add to `src/lib/forecasting.ts`:

```ts
export interface ProjectForecasts {
  original: ForecastSet;
  live: ForecastSet;
}

/**
 * Compute both forecast sets for a project.
 * - `original`: What we'd forecast from closeDate alone (no actuals considered)
 * - `live`: What we forecast now, considering completed milestones
 */
export function computeProjectForecasts(
  project: Project,
  table: BaselineTable,
): ProjectForecasts {
  // Live forecast uses actual dates where available
  const live = computeForecast(project, table);

  // Original forecast pretends no milestones are completed
  // Create a "blank" version of the project with only closeDate
  const blankProject: Project = {
    ...project,
    designCompletionDate: null,
    permitSubmitDate: null,
    permitIssueDate: null,
    interconnectionSubmitDate: null,
    interconnectionApprovalDate: null,
    readyToBuildDate: null,
    constructionCompleteDate: null,
    inspectionPassDate: null,
    ptoGrantedDate: null,
  };
  const original = computeForecast(blankProject, table);

  return { original, live };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="forecasting" --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/forecasting.ts src/__tests__/lib/forecasting.test.ts
git commit -m "feat(forecasting): add original/live forecast pair computation"
```

---

### Task 4: Baseline Cache Integration

**Files:**
- Modify: `src/lib/forecasting.ts`
- Modify: `src/lib/cache.ts` (add cache key)
- Test: `src/__tests__/lib/forecasting.test.ts`

**Context:** The QC baseline table should be cached in `appCache` with a 24-hour TTL. The existing cache uses `CacheStore.getOrFetch()` with configurable TTL. See `src/lib/cache.ts` for the pattern. Add a `CACHE_KEYS.FORECAST_BASELINES` key and a `getBaselineTable()` function that fetches all projects, filters to completed ones (last 12 months), and builds the table.

**Step 1: Write the failing test**

```ts
import { getBaselineTable } from "@/lib/forecasting";

// Mock the cache and hubspot modules
jest.mock("@/lib/cache", () => ({
  appCache: {
    getOrFetch: jest.fn(),
  },
  CACHE_KEYS: {
    FORECAST_BASELINES: "forecast:baselines",
  },
}));

jest.mock("@/lib/hubspot", () => ({
  fetchAllProjects: jest.fn(),
}));

describe("getBaselineTable", () => {
  it("fetches all projects and builds baseline from completed ones", async () => {
    const { appCache } = require("@/lib/cache");
    const { fetchAllProjects } = require("@/lib/hubspot");

    const completedProjects = Array.from({ length: 5 }, (_, i) =>
      makeCompletedProject({ id: i + 1 })
    );

    // Mock the cache to call the fetcher directly
    appCache.getOrFetch.mockImplementation(
      async (_key: string, fetcher: () => Promise<unknown>) => ({
        data: await fetcher(),
        cached: false,
        stale: false,
        lastUpdated: new Date().toISOString(),
      })
    );
    fetchAllProjects.mockResolvedValue(completedProjects);

    const { data: table } = await getBaselineTable();

    expect(table).toBeDefined();
    expect(fetchAllProjects).toHaveBeenCalledWith({ activeOnly: false });
    // Should have at least global entry
    expect(table.global).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="forecasting" --no-coverage`
Expected: FAIL — `getBaselineTable` not exported

**Step 3: Add cache key and implement getBaselineTable**

In `src/lib/cache.ts`, add to `CACHE_KEYS`:
```ts
FORECAST_BASELINES: "forecast:baselines",
```

In `src/lib/forecasting.ts`, add:

```ts
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { fetchAllProjects } from "@/lib/hubspot";

const BASELINE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get the cached baseline table, rebuilding from QC data if stale.
 * Fetches ALL projects (including inactive) to maximize historical data.
 * Filters to projects with closeDate in the last 12 months that have
 * at least reached construction complete (install milestone).
 */
export async function getBaselineTable() {
  return appCache.getOrFetch<BaselineTable>(
    CACHE_KEYS.FORECAST_BASELINES,
    async () => {
      const allProjects = await fetchAllProjects({ activeOnly: false });

      // Filter to completed projects from last 12 months
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 1);
      const cutoffStr = cutoff.toISOString().split("T")[0];

      const completed = allProjects.filter(
        (p) =>
          p.closeDate &&
          p.closeDate >= cutoffStr &&
          p.constructionCompleteDate // Must have at least installed
      );

      return buildBaselineTable(completed);
    },
    false, // don't force refresh
    BASELINE_TTL_MS,
  );
}
```

> **Note to implementer:** Check if `appCache.getOrFetch` accepts a custom TTL parameter. If not, you may need to add one to `CacheStore.getOrFetch()` in `src/lib/cache.ts`. The current implementation uses a fixed `DEFAULT_TTL` of 5 minutes — the baseline should use 24 hours instead. Look at lines ~78-117 of `cache.ts` for the method signature.

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="forecasting" --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/forecasting.ts src/lib/cache.ts src/__tests__/lib/forecasting.test.ts
git commit -m "feat(forecasting): add baseline cache with 24h TTL"
```

---

### Task 5: Baselines API Endpoint

**Files:**
- Create: `src/app/api/forecasting/baselines/route.ts`
- Test: `src/__tests__/api/forecasting-baselines.test.ts`

**Context:** Debug/transparency endpoint that returns the current QC baseline table. Follow the pattern from `src/app/api/hubspot/qc-metrics/route.ts` — GET handler that uses `appCache.getOrFetch`, returns JSON.

**Step 1: Write the failing test**

```ts
// src/__tests__/api/forecasting-baselines.test.ts
import { NextRequest } from "next/server";
import { GET } from "@/app/api/forecasting/baselines/route";

jest.mock("@/lib/forecasting", () => ({
  getBaselineTable: jest.fn(),
}));

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost:3000/api/forecasting/baselines");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

describe("GET /api/forecasting/baselines", () => {
  it("returns the baseline table", async () => {
    const { getBaselineTable } = require("@/lib/forecasting");
    getBaselineTable.mockResolvedValue({
      data: {
        global: {
          sampleCount: 100,
          pairs: { close_to_designComplete: { median: 14, p25: 10, p75: 18, sampleCount: 80 } },
        },
      },
      cached: true,
      stale: false,
      lastUpdated: "2025-01-01T00:00:00Z",
    });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.baselines).toBeDefined();
    expect(body.baselines.global).toBeDefined();
    expect(body.cached).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="forecasting-baselines" --no-coverage`
Expected: FAIL — module not found

**Step 3: Implement the route**

```ts
// src/app/api/forecasting/baselines/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getBaselineTable } from "@/lib/forecasting";

export async function GET(_request: NextRequest) {
  try {
    const { data, cached, stale, lastUpdated } = await getBaselineTable();

    // Compute summary stats for the response
    const segmentCount = Object.keys(data).length;
    const globalEntry = data.global;
    const totalSamples = globalEntry?.sampleCount ?? 0;

    return NextResponse.json({
      baselines: data,
      summary: {
        segmentCount,
        totalCompletedProjects: totalSamples,
      },
      cached,
      stale,
      lastUpdated,
    });
  } catch (error) {
    console.error("Forecast baselines API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch forecast baselines" },
      { status: 500 },
    );
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="forecasting-baselines" --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add src/app/api/forecasting/baselines/route.ts src/__tests__/api/forecasting-baselines.test.ts
git commit -m "feat(forecasting): add GET /api/forecasting/baselines endpoint"
```

---

### Task 6: Integrate Forecasts into TransformedProject

**Files:**
- Modify: `src/lib/types.ts` — add forecast fields to `TransformedProject`
- Modify: `src/lib/transforms.ts` — replace `FORECAST_OFFSETS` with forecasting engine
- Modify: `src/__tests__/lib/transforms.test.ts` — update tests

**Context:** Currently `transforms.ts` (lines 28–53) computes `forecast_install/inspection/pto` using `FORECAST_OFFSETS` (`closeDate + 90/120/150`). Replace this with the forecasting engine's output. The `TransformedProject` type (in `types.ts:123-148`) needs new fields for the full forecast set with basis indicators.

**Step 1: Update the TransformedProject type**

In `src/lib/types.ts`, add after the existing forecast fields:

```ts
// New forecast engine fields (replaces old forecast_install/inspection/pto)
forecast: {
  original: Record<string, { date: string | null; basis: string }>;
  live: Record<string, { date: string | null; basis: string }>;
} | null;
```

Keep the old `forecast_install`, `forecast_inspection`, `forecast_pto` fields for backwards compatibility during Phase 2, but source them from the engine instead of static offsets.

**Step 2: Update transforms.ts**

Replace the `FORECAST_OFFSETS` logic with a call to the forecasting engine. The transform function needs access to the baseline table — pass it as an optional parameter:

```ts
import { type BaselineTable, computeProjectForecasts, MILESTONE_CHAIN } from "@/lib/forecasting";
import type { Project } from "@/lib/hubspot";

// Remove or deprecate FORECAST_OFFSETS
/** @deprecated Use forecasting engine instead. Kept temporarily for backwards compatibility. */
export const FORECAST_OFFSETS = { install: 90, inspection: 120, pto: 150 } as const;

export function transformProject(
  p: RawProject,
  baselineTable?: BaselineTable | null,
): TransformedProject {
  // ... existing code up to forecast section ...

  // NEW: Use forecasting engine if baseline table available
  let forecast: TransformedProject["forecast"] = null;
  let forecastInstall: string | null = null;
  let forecastInspection: string | null = null;
  let forecastPto: string | null = null;

  if (baselineTable && p.closeDate) {
    // Cast RawProject to Project-like shape for the forecasting engine
    const { original, live } = computeProjectForecasts(p as unknown as Project, baselineTable);
    forecast = { original, live };

    // Backwards compat: populate old fields from live forecast
    forecastInstall = live.install?.date ?? null;
    forecastInspection = live.inspection?.date ?? null;
    forecastPto = live.pto?.date ?? null;
  } else {
    // Fallback to old static offsets if no baseline table
    forecastInstall = p.forecastedInstallDate || p.constructionScheduleDate ||
      (closeDate ? addDays(closeDate, FORECAST_OFFSETS.install) : null);
    forecastInspection = p.forecastedInspectionDate ||
      (closeDate ? addDays(closeDate, FORECAST_OFFSETS.inspection) : null);
    forecastPto = p.forecastedPtoDate ||
      (closeDate ? addDays(closeDate, FORECAST_OFFSETS.pto) : null);
  }

  // ... rest of transform using forecastInstall/forecastInspection/forecastPto ...
  // Add `forecast` to returned object
}
```

> **Important note to implementer:** `RawProject` and `Project` have different shapes. You'll need to map `RawProject` fields to the field names expected by `MILESTONE_DATE_FIELD` in `forecasting.ts`, or adjust the forecasting module to accept either shape. The cleanest approach: have `transformProject` accept an optional pre-computed `ProjectForecasts` object rather than computing inside the transform. The API route would compute forecasts from the raw `Project` objects and pass them down.

**Step 3: Update tests**

Update `src/__tests__/lib/transforms.test.ts` to test both paths:
1. Without baseline table — falls back to old offsets (backwards compat)
2. With baseline table — uses engine forecasts

**Step 4: Run tests**

Run: `npm test -- --testPathPattern="transforms" --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/transforms.ts src/__tests__/lib/transforms.test.ts
git commit -m "feat(forecasting): integrate forecast engine into TransformedProject"
```

---

### Task 7: Wire Forecasts into Projects API

**Files:**
- Modify: `src/app/api/projects/route.ts`
- Test: `src/__tests__/api/projects.test.ts`

**Context:** The projects API route (`src/app/api/projects/route.ts`) currently serves raw `Project` objects with `forecastInstall/forecastInspection/forecastPto` that use the old `closeDate + 90/120/150` fallback (computed in `hubspot.ts:759-780`). Wire in the baseline table so the API response includes engine-derived forecasts.

**Step 1: Load baseline table in the API route**

In `src/app/api/projects/route.ts`, add:

```ts
import { getBaselineTable } from "@/lib/forecasting";

// Inside the GET handler, after fetching projects:
const { data: baselineTable } = await getBaselineTable();

// When transforming projects, pass the baseline table:
const transformed = projects.map((p) => transformProject(p, baselineTable));
```

**Step 2: Remove old fallback from hubspot.ts**

In `src/lib/hubspot.ts`, remove lines 758-780 (the `closeDate + 90/120/150` fallback logic in `transformDealToProject`). Instead, set `forecastInstall/forecastInspection/forecastPto` to only the **explicit** HubSpot values (or null):

```ts
// Replace lines 760-780 with:
const forecastInstall = explicitForecastInstall; // no fallback
const forecastInspection = explicitForecastInspection; // no fallback
const forecastPto = explicitForecastPto; // no fallback
```

The forecasting engine in `transforms.ts` now handles all fallback logic.

**Step 3: Update API tests**

Update `src/__tests__/api/projects.test.ts` to mock `getBaselineTable` and verify forecasts appear in the response.

**Step 4: Run tests**

Run: `npm test -- --testPathPattern="projects" --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add src/app/api/projects/route.ts src/lib/hubspot.ts src/__tests__/api/projects.test.ts
git commit -m "feat(forecasting): wire baseline table into projects API, remove static fallbacks from hubspot.ts"
```

---

### Task 8: Remove FORECAST_OFFSETS Entirely

**Files:**
- Modify: `src/lib/transforms.ts` — remove deprecated constant
- Modify: `src/lib/hubspot.ts` — verify no remaining references
- Modify: `src/__tests__/lib/transforms.test.ts` — remove offset import

**Step 1: Search for remaining references**

Run: `grep -r "FORECAST_OFFSETS\|closeDate.*90\|closeDate.*120\|closeDate.*150" src/`

Remove every reference found.

**Step 2: Remove the constant and fallback path**

Delete `FORECAST_OFFSETS` from `transforms.ts`. Remove the `else` branch in `transformProject` that uses it. If no baseline table is available, forecast fields should be `null` (not fake dates).

**Step 3: Update tests**

Remove `FORECAST_OFFSETS` import from test file. Update any test that expected static offset behavior.

**Step 4: Run full test suite**

Run: `npm test --no-coverage`
Expected: PASS (no remaining references to static offsets)

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(forecasting): remove FORECAST_OFFSETS static fallbacks entirely"
```

---

## Phase 2: Retrofit Existing Dashboards

### Task 9: Add Forecast Basis Visual Indicators

**Files:**
- Create: `src/components/ui/ForecastBasis.tsx`
- Test: Manual (visual component)

**Context:** All forecast-dependent dashboards should visually distinguish forecast basis. Create a shared component for this.

**Step 1: Create the component**

```tsx
// src/components/ui/ForecastBasis.tsx
"use client";

import type { ForecastBasis } from "@/lib/forecasting";

const BASIS_CONFIG: Record<ForecastBasis, { label: string; className: string; tooltip: string }> = {
  actual: { label: "", className: "", tooltip: "Actual completion date" },
  segment: { label: "", className: "", tooltip: "Forecast based on similar projects (location + AHJ + utility)" },
  location: { label: "~", className: "text-amber-400", tooltip: "Forecast based on location data (less precise)" },
  global: { label: "~", className: "text-orange-400", tooltip: "Forecast based on global averages (least precise)" },
  insufficient: { label: "—", className: "text-muted", tooltip: "Insufficient data for forecast" },
};

export function ForecastDate({
  date,
  basis,
  className = "",
}: {
  date: string | null;
  basis: ForecastBasis;
  className?: string;
}) {
  const config = BASIS_CONFIG[basis];

  if (basis === "insufficient" || !date) {
    return (
      <span className={`${config.className} ${className}`} title={config.tooltip}>
        —
      </span>
    );
  }

  return (
    <span className={`${config.className} ${className}`} title={config.tooltip}>
      {config.label}{formatDate(date)}
    </span>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
```

**Step 2: Commit**

```bash
git add src/components/ui/ForecastBasis.tsx
git commit -m "feat(ui): add ForecastDate component with basis visual indicators"
```

---

### Task 10: Retrofit At-Risk Dashboard

**Files:**
- Modify: `src/app/dashboards/at-risk/page.tsx`

**Context:** The at-risk dashboard (lines 67–130) computes risk scores using `days_to_install`, `days_to_inspection`, `days_to_pto` from `TransformedProject`. These are now sourced from the forecasting engine (Task 6). The main change: show forecast basis indicators alongside risk items so users know confidence level.

**Step 1: Import ForecastDate component**

Add `import { ForecastDate } from "@/components/ui/ForecastBasis"` to the dashboard.

**Step 2: Add basis indicators to risk items**

Where the dashboard shows forecast dates (in the project cards/rows), wrap dates with `<ForecastDate>` using the project's `forecast.live.*` basis field.

**Step 3: Add "insufficient" handling**

If a project's forecast basis is `"insufficient"`, exclude it from risk scoring (don't count "Insufficient data" as overdue).

**Step 4: Test manually and commit**

```bash
git add src/app/dashboards/at-risk/page.tsx
git commit -m "feat(at-risk): retrofit with forecast engine basis indicators"
```

---

### Task 11: Retrofit Remaining Forecast-Dependent Dashboards

**Files:**
- Modify: `src/app/dashboards/timeline/page.tsx`
- Modify: `src/app/dashboards/pipeline/page.tsx`
- Modify: `src/app/dashboards/optimizer/page.tsx`
- Modify: `src/app/dashboards/pe/page.tsx`
- Modify: `src/app/dashboards/alerts/page.tsx`

**Context:** Each dashboard uses `forecast_install`, `forecast_inspection`, or `forecast_pto` from `TransformedProject`. Replace raw date display with `<ForecastDate>` component. Handle `"insufficient"` basis gracefully.

For each dashboard:
1. Import `ForecastDate` from `@/components/ui/ForecastBasis`
2. Replace raw date strings with `<ForecastDate date={...} basis={...} />`
3. Handle `null` forecasts with "Insufficient data" messaging
4. Test manually

**Step 1: Retrofit timeline dashboard**

The timeline dashboard uses forecast dates for Gantt bar endpoints. Update bar rendering to use `project.forecast.live` dates and show basis indicators in tooltips.

**Step 2: Retrofit pipeline dashboard**

Pipeline Overview uses forecast dates for overdue counts. Update overdue logic to skip `"insufficient"` projects.

**Step 3: Retrofit optimizer dashboard**

Pipeline Optimizer uses forecasts for scheduling. Show `"Insufficient data"` instead of fake dates.

**Step 4: Retrofit PE dashboard**

PE Dashboard uses forecast dates for PE-specific milestone tracking. Add basis indicators.

**Step 5: Retrofit alerts dashboard**

Alerts dashboard uses `days_to_install < -7` for overdue alerts. Skip projects where forecast basis is `"insufficient"`.

**Step 6: Commit**

```bash
git add src/app/dashboards/timeline/page.tsx src/app/dashboards/pipeline/page.tsx \
  src/app/dashboards/optimizer/page.tsx src/app/dashboards/pe/page.tsx \
  src/app/dashboards/alerts/page.tsx
git commit -m "feat(dashboards): retrofit timeline, pipeline, optimizer, PE, and alerts with forecast engine"
```

---

## Phase 3a: Move Obvious-Fit Dashboards

### Task 12: Move D&E Dept Analytics to D&E Suite

**Files:**
- Modify: `src/app/suites/design-engineering/page.tsx` — add card
- Modify: `src/components/DashboardShell.tsx` — update SUITE_MAP
- Modify: `src/app/suites/intelligence/page.tsx` — remove card

**Step 1: Add card to D&E Suite**

In `src/app/suites/design-engineering/page.tsx`, add to the LINKS array in the Analytics section:

```ts
{
  href: "/dashboards/design-engineering",
  title: "D&E Dept Analytics",
  description: "Cross-state design analytics, status breakdowns, and ops clarification queue.",
  tag: "ANALYTICS",
  tagColor: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  section: "Analytics",
},
```

**Step 2: Update DashboardShell SUITE_MAP**

In `src/components/DashboardShell.tsx`, move `"design-engineering"` from Intelligence suite's list to D&E suite's list in SUITE_MAP.

**Step 3: Remove from Intelligence Suite**

In `src/app/suites/intelligence/page.tsx`, remove the D&E Dept Analytics card (lines 87-93 approximately).

**Step 4: Commit**

```bash
git add src/app/suites/design-engineering/page.tsx src/components/DashboardShell.tsx \
  src/app/suites/intelligence/page.tsx
git commit -m "refactor(suites): move D&E Dept Analytics from Intelligence to D&E Suite"
```

---

### Task 13: Move P&I Dept Analytics to P&I Suite

**Files:**
- Modify: `src/app/suites/permitting-interconnection/page.tsx` — add card
- Modify: `src/components/DashboardShell.tsx` — update SUITE_MAP
- Modify: `src/app/suites/intelligence/page.tsx` — remove card

**Step 1: Add card to P&I Suite**

```ts
{
  href: "/dashboards/permitting-interconnection",
  title: "P&I Dept Analytics",
  description: "Combined P&I analytics, turnaround times, and action-needed views.",
  tag: "ANALYTICS",
  tagColor: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  section: "Analytics",
},
```

**Step 2: Update DashboardShell SUITE_MAP**

Move `"permitting-interconnection"` from Intelligence to P&I in SUITE_MAP.

**Step 3: Remove from Intelligence Suite**

Remove the P&I Dept Analytics card from `intelligence/page.tsx`.

**Step 4: Commit**

```bash
git add src/app/suites/permitting-interconnection/page.tsx src/components/DashboardShell.tsx \
  src/app/suites/intelligence/page.tsx
git commit -m "refactor(suites): move P&I Dept Analytics from Intelligence to P&I Suite"
```

---

### Task 14: Move Incentives to P&I Suite

**Files:**
- Modify: `src/app/suites/permitting-interconnection/page.tsx` — add card
- Modify: `src/components/DashboardShell.tsx` — update SUITE_MAP
- Modify: `src/app/suites/intelligence/page.tsx` — remove card

**Step 1: Add card to P&I Suite**

```ts
{
  href: "/dashboards/incentives",
  title: "Incentives",
  description: "Rebate and incentive program tracking and application status.",
  tag: "INCENTIVES",
  tagColor: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  section: "Programs",
},
```

**Step 2: Update SUITE_MAP**

Move `"incentives"` from Intelligence to P&I in SUITE_MAP.

**Step 3: Remove from Intelligence Suite**

Remove the Incentives card from `intelligence/page.tsx`.

**Step 4: Commit**

```bash
git add src/app/suites/permitting-interconnection/page.tsx src/components/DashboardShell.tsx \
  src/app/suites/intelligence/page.tsx
git commit -m "refactor(suites): move Incentives from Intelligence to P&I Suite"
```

---

### Task 15: Move Sales Pipeline to Executive Suite

**Files:**
- Modify: `src/app/suites/executive/page.tsx` — add card
- Modify: `src/components/DashboardShell.tsx` — update SUITE_MAP
- Modify: `src/app/suites/intelligence/page.tsx` — remove card

**Step 1: Add card to Executive Suite**

```ts
{
  href: "/dashboards/sales",
  title: "Sales Pipeline",
  description: "Active deals, funnel visualization, and proposal tracking.",
  tag: "SALES",
  tagColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  section: "Sales",
},
```

**Step 2: Update SUITE_MAP and remove from Intelligence**

**Step 3: Commit**

```bash
git add src/app/suites/executive/page.tsx src/components/DashboardShell.tsx \
  src/app/suites/intelligence/page.tsx
git commit -m "refactor(suites): move Sales Pipeline from Intelligence to Executive Suite"
```

---

### Task 16: Move PE Dashboard to Executive Suite

**Files:**
- Modify: `src/app/suites/executive/page.tsx` — add card
- Modify: `src/components/DashboardShell.tsx` — update SUITE_MAP
- Modify: `src/app/suites/intelligence/page.tsx` — remove card

**Step 1: Add card to Executive Suite**

```ts
{
  href: "/dashboards/pe",
  title: "PE Dashboard",
  description: "Participate Energy milestone tracking and compliance monitoring.",
  tag: "PE",
  tagColor: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  section: "Programs",
},
```

**Step 2: Update SUITE_MAP and remove from Intelligence**

**Step 3: Commit**

```bash
git add src/app/suites/executive/page.tsx src/components/DashboardShell.tsx \
  src/app/suites/intelligence/page.tsx
git commit -m "refactor(suites): move PE Dashboard from Intelligence to Executive Suite"
```

---

### Task 17: Move Zuper Compliance to Executive Suite

**Files:**
- Modify: `src/app/suites/executive/page.tsx` — add card
- Modify: `src/components/DashboardShell.tsx` — update SUITE_MAP
- Modify: `src/app/suites/admin/page.tsx` — remove card

**Step 1: Add card to Executive Suite**

```ts
{
  href: "/dashboards/zuper-compliance",
  title: "Zuper Compliance",
  description: "Per-user compliance scorecards and crew-composition comparisons.",
  tag: "COMPLIANCE",
  tagColor: "bg-red-500/20 text-red-400 border-red-500/30",
  section: "Field Performance",
},
```

**Step 2: Update SUITE_MAP**

Move `"zuper-compliance"` from Admin to Executive in SUITE_MAP.

**Step 3: Remove from Admin Suite**

Remove the Zuper Compliance card from `admin/page.tsx` (lines 47-53).

**Step 4: Commit**

```bash
git add src/app/suites/executive/page.tsx src/components/DashboardShell.tsx \
  src/app/suites/admin/page.tsx
git commit -m "refactor(suites): move Zuper Compliance from Admin to Executive Suite"
```

---

### Task 18: Move Project Management to D&E Suite

**Files:**
- Modify: `src/app/suites/design-engineering/page.tsx` — add card
- Modify: `src/components/DashboardShell.tsx` — update SUITE_MAP
- Modify: `src/app/suites/intelligence/page.tsx` — remove card

**Context:** Project Management dashboard shows PM workload, DA backlog, and stuck deals — overlaps with D&E team workflows.

**Step 1: Add card to D&E Suite**

```ts
{
  href: "/dashboards/project-management",
  title: "Project Management",
  description: "PM workload, DA backlog, stuck deals, and revenue tracking.",
  tag: "PM",
  tagColor: "bg-green-500/20 text-green-400 border-green-500/30",
  section: "Analytics",
},
```

**Step 2: Update SUITE_MAP and remove from Intelligence**

**Step 3: Commit**

```bash
git add src/app/suites/design-engineering/page.tsx src/components/DashboardShell.tsx \
  src/app/suites/intelligence/page.tsx
git commit -m "refactor(suites): move Project Management from Intelligence to D&E Suite"
```

---

### Task 19: Update Role Allowlists for Moved Dashboards

**Files:**
- Modify: `src/lib/suite-nav.ts` — ensure Intelligence remains accessible during transition

**Context:** `SUITE_SWITCHER_ALLOWLIST` in `suite-nav.ts` (lines 55-82) controls which roles see which suites. Since we're keeping Intelligence Suite alive during Phase 3b evaluation, no allowlist changes needed yet. But verify that roles which had Intelligence access also have access to the destination suites.

**Step 1: Audit allowlists**

Check that:
- D&E Suite: accessible by same roles that could see Intelligence dashboards
- P&I Suite: accessible by same roles
- Executive Suite: accessible by ADMIN, OWNER (already true)

**Step 2: If any gaps, update allowlists**

Look for roles that have `/suites/intelligence` but not the destination suite. Add missing entries.

**Step 3: Commit if changes**

```bash
git add src/lib/suite-nav.ts
git commit -m "refactor(nav): update role allowlists for dashboard redistributions"
```

---

## Phase 3b: Evaluate Forecast-Dependent Dashboards

### Task 20: Slim Down Intelligence Suite

**Files:**
- Modify: `src/app/suites/intelligence/page.tsx`

**Context:** After Phase 3a moves, Intelligence Suite should only contain forecast-dependent dashboards held for evaluation:
- At-Risk Projects
- QC Metrics
- Alerts
- Timeline View
- Pipeline Overview
- Pipeline Optimizer

Plus the Capacity Planning dashboard (cut candidate).

**Step 1: Remove all cards that were moved in Phase 3a**

Remove: D&E Dept Analytics, P&I Dept Analytics, Incentives, Sales Pipeline, PE Dashboard, Project Management.

**Step 2: Update sections**

Rename sections to reflect the slimmed-down focus. Suggested:
- "Risk & Quality": At-Risk Projects, QC Metrics, Alerts
- "Pipeline & Forecasting": Timeline View, Pipeline Overview, Pipeline Optimizer
- "Deprecated": Capacity Planning (with note about rebuild)

**Step 3: Update subtitle**

```ts
subtitle="Forecast-dependent dashboards under evaluation. Will be redistributed or cut."
```

**Step 4: Commit**

```bash
git add src/app/suites/intelligence/page.tsx
git commit -m "refactor(intelligence): slim to forecast-dependent dashboards only"
```

---

### Task 21: Cut Capacity Planning Dashboard

**Files:**
- Modify: `src/app/suites/intelligence/page.tsx` — remove card
- Modify: `src/components/DashboardShell.tsx` — remove from SUITE_MAP

**Context:** Per design doc: "WEAK — gap counter labeled 'AI Optimizer.' Rebuild later if needed."

**Step 1: Remove card from Intelligence Suite**

Remove the Capacity Planning card from `intelligence/page.tsx`.

**Step 2: Remove from SUITE_MAP**

Remove `"capacity"` from Intelligence entry in DashboardShell SUITE_MAP.

**Step 3: Do NOT delete the dashboard page**

Keep `src/app/dashboards/capacity/page.tsx` — it may be rebuilt later. Just de-list it from navigation.

**Step 4: Commit**

```bash
git add src/app/suites/intelligence/page.tsx src/components/DashboardShell.tsx
git commit -m "refactor(intelligence): de-list Capacity Planning dashboard (weak, rebuild later)"
```

---

## Phase 4: Forecast Accuracy Dashboard + Final Cleanup

### Task 22: Build Forecast Accuracy Dashboard

**Files:**
- Create: `src/app/dashboards/forecast-accuracy/page.tsx`
- Create: `src/app/api/forecasting/accuracy/route.ts`
- Modify: `src/app/suites/executive/page.tsx` — add card
- Modify: `src/components/DashboardShell.tsx` — add to SUITE_MAP

**Context:** New Executive Suite dashboard showing how well the forecasting model predicts reality. Uses completed projects to compare `original_forecast` vs actual dates.

**Step 1: Create the accuracy API route**

```ts
// src/app/api/forecasting/accuracy/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fetchAllProjects } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { getBaselineTable, computeProjectForecasts, MILESTONE_CHAIN } from "@/lib/forecasting";

export async function GET(request: NextRequest) {
  try {
    const { data: baselineTable } = await getBaselineTable();
    const { data: allProjects } = await appCache.getOrFetch(
      CACHE_KEYS.PROJECTS_ALL,
      () => fetchAllProjects({ activeOnly: false }),
    );

    // Only analyze projects with actual completion dates
    const completed = (allProjects || []).filter(
      (p) => p.closeDate && p.constructionCompleteDate
    );

    // Compute accuracy metrics for each milestone
    const milestoneAccuracy: Record<string, {
      medianError: number | null;
      meanError: number | null;
      sampleCount: number;
      withinOneWeek: number; // % of forecasts within 7 days
      withinTwoWeeks: number;
    }> = {};

    // ... Implementation: for each completed project, compare
    // original forecast dates vs actual dates. Compute error distributions.

    return NextResponse.json({
      milestoneAccuracy,
      // basisDistribution: what % used segment/location/global
      // driftTracking: how much did live change from original
      // monthlyTrend: accuracy improvement over time
    });
  } catch (error) {
    console.error("Forecast accuracy API error:", error);
    return NextResponse.json({ error: "Failed to compute accuracy" }, { status: 500 });
  }
}
```

> **Note to implementer:** The full implementation of accuracy metrics is substantial. Start with median absolute error per milestone, then iterate on the other sections (basis distribution, drift, monthly trend). Use `DashboardShell` wrapper, `MetricCard` for hero stats, and the standard dashboard patterns.

**Step 2: Create the dashboard page**

Follow the standard dashboard pattern from `CLAUDE.md`:
- Wrap in `<DashboardShell title="Forecast Accuracy" accentColor="cyan" ...>`
- Use `StatCard` for overall accuracy
- Use `MetricCard` for per-milestone breakdowns
- Use tables for per-segment accuracy

**Step 3: Add to Executive Suite**

```ts
{
  href: "/dashboards/forecast-accuracy",
  title: "Forecast Accuracy",
  description: "How well the forecasting model predicts reality across milestones and segments.",
  tag: "META",
  tagColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  section: "Meta",
},
```

**Step 4: Add to SUITE_MAP**

Add `"forecast-accuracy"` to Executive suite's list in DashboardShell SUITE_MAP.

**Step 5: Commit**

```bash
git add src/app/dashboards/forecast-accuracy/page.tsx src/app/api/forecasting/accuracy/route.ts \
  src/app/suites/executive/page.tsx src/components/DashboardShell.tsx
git commit -m "feat(dashboards): add Forecast Accuracy dashboard to Executive Suite"
```

---

### Task 23: Remove Intelligence Suite from Navigation

**Files:**
- Modify: `src/lib/suite-nav.ts` — remove entry + allowlist references
- Modify: `src/components/DashboardShell.tsx` — remove from SUITE_MAP
- Modify: `src/app/suites/intelligence/page.tsx` — add redirect

**Context:** This is the FINAL step. Only do this after Phase 3b evaluation confirms all dashboards have been redistributed or cut.

**Step 1: Remove from SUITE_NAV_ENTRIES**

In `suite-nav.ts`, delete the Intelligence Suite entry (lines 30-34):
```ts
// DELETE THIS BLOCK:
{
  href: "/suites/intelligence",
  title: "Intelligence Suite",
  shortLabel: "Intelligence",
  description: "Risk analysis, QC, capacity planning, and pipeline analytics.",
},
```

**Step 2: Remove from all SUITE_SWITCHER_ALLOWLIST entries**

Remove `"/suites/intelligence"` from every role's allowlist in `suite-nav.ts` (lines 55-82).

**Step 3: Remove from DashboardShell SUITE_MAP**

Delete the entire Intelligence suite entry from SUITE_MAP.

**Step 4: Add redirect**

Replace `src/app/suites/intelligence/page.tsx` content with a redirect:

```tsx
import { redirect } from "next/navigation";

export default function IntelligenceSuitePage() {
  redirect("/suites/operations");
}
```

**Step 5: Run build to verify no broken references**

Run: `npm run build`
Expected: BUILD SUCCESS

**Step 6: Commit**

```bash
git add src/lib/suite-nav.ts src/components/DashboardShell.tsx \
  src/app/suites/intelligence/page.tsx
git commit -m "refactor(suites): remove Intelligence Suite from navigation, add redirect"
```

---

### Task 24: Final Redistribution of Held Dashboards

**Files:**
- Modify: suite pages for destination suites
- Modify: `src/components/DashboardShell.tsx` — SUITE_MAP updates

**Context:** After Phase 3b evaluation with real forecast data, move remaining dashboards to their final homes per the design doc:
- At-Risk Projects → Operations (Risk & Quality section)
- QC Metrics → Operations (Risk & Quality section)
- Pipeline Overview → Executive (Forecasting section)
- Timeline View → Executive (Forecasting section)
- Pipeline Optimizer → Operations (Scheduling Intelligence section)
- Alerts → Merge into At-Risk (remove standalone)

**This task is intentionally deferred.** Execute only after the forecasting engine has been live for 2+ weeks and the team has evaluated each dashboard's usefulness with real data.

For each dashboard:
1. Add card to destination suite's `page.tsx`
2. Update SUITE_MAP in `DashboardShell.tsx`
3. Verify role access

**Commit per dashboard move** with pattern:
```bash
git commit -m "refactor(suites): move [Dashboard] from Intelligence to [Destination] Suite"
```

---

## Summary of All Commits

| Phase | Task | Commit Message |
|-------|------|----------------|
| 1 | 1 | `feat(forecasting): add QC baseline builder with segment fallback hierarchy` |
| 1 | 2 | `feat(forecasting): add forecast calculator with segment fallback and basis tracking` |
| 1 | 3 | `feat(forecasting): add original/live forecast pair computation` |
| 1 | 4 | `feat(forecasting): add baseline cache with 24h TTL` |
| 1 | 5 | `feat(forecasting): add GET /api/forecasting/baselines endpoint` |
| 1 | 6 | `feat(forecasting): integrate forecast engine into TransformedProject` |
| 1 | 7 | `feat(forecasting): wire baseline table into projects API, remove static fallbacks` |
| 1 | 8 | `refactor(forecasting): remove FORECAST_OFFSETS static fallbacks entirely` |
| 2 | 9 | `feat(ui): add ForecastDate component with basis visual indicators` |
| 2 | 10 | `feat(at-risk): retrofit with forecast engine basis indicators` |
| 2 | 11 | `feat(dashboards): retrofit timeline, pipeline, optimizer, PE, alerts with forecast engine` |
| 3a | 12 | `refactor(suites): move D&E Dept Analytics from Intelligence to D&E Suite` |
| 3a | 13 | `refactor(suites): move P&I Dept Analytics from Intelligence to P&I Suite` |
| 3a | 14 | `refactor(suites): move Incentives from Intelligence to P&I Suite` |
| 3a | 15 | `refactor(suites): move Sales Pipeline from Intelligence to Executive Suite` |
| 3a | 16 | `refactor(suites): move PE Dashboard from Intelligence to Executive Suite` |
| 3a | 17 | `refactor(suites): move Zuper Compliance from Admin to Executive Suite` |
| 3a | 18 | `refactor(suites): move Project Management from Intelligence to D&E Suite` |
| 3a | 19 | `refactor(nav): update role allowlists for dashboard redistributions` |
| 3b | 20 | `refactor(intelligence): slim to forecast-dependent dashboards only` |
| 3b | 21 | `refactor(intelligence): de-list Capacity Planning dashboard` |
| 4 | 22 | `feat(dashboards): add Forecast Accuracy dashboard to Executive Suite` |
| 4 | 23 | `refactor(suites): remove Intelligence Suite from navigation, add redirect` |
| 4 | 24 | (deferred — per-dashboard commits after evaluation period) |
