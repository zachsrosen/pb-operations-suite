# 4x10 Crew Rotation Analysis — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a spreadsheet model and interactive HTML playground that analyze whether a 4-day/10-hour crew rotation can match or beat current 5-day/8-hour install throughput across 3 Colorado locations.

**Architecture:** Three-stage pipeline: (1) TypeScript script queries HubSpot for 6 months of completed install data, computes metrics, and writes a JSON data file; (2) Python script reads that JSON and generates a 4-tab Excel workbook; (3) the JSON is embedded into a self-contained HTML playground with SVG visualizations and live controls. The simulation engine (business-day math, calendar walking, fit classification, decision rubric scoring) lives in the TypeScript extraction script so both deliverables consume identical pre-computed results.

**Tech Stack:** TypeScript (HubSpot API via existing `searchWithRetry`), Python 3 + openpyxl (Excel generation, following existing `scripts/generate-*.py` pattern), vanilla HTML/CSS/JS + inline SVG (playground)

**Spec:** `docs/superpowers/specs/2026-03-25-4x10-crew-rotation-analysis-design.md`

**Security note:** The playground HTML is a local-only analysis tool opened from the filesystem, not served to external users. All data is self-generated from trusted HubSpot sources. DOM content is built from this trusted data using template literals — no untrusted user input is rendered.

---

## Chunk 1: Data Extraction & Simulation Engine

### Task 1: HubSpot Data Extraction Script

**Files:**
- Create: `scripts/4x10-extract-install-data.ts`
- Read: `src/lib/hubspot.ts` (lines 123-163 for `searchWithRetry`, lines 502-650 for `DEAL_PROPERTIES`)
- Read: `src/lib/locations.ts` (for `normalizeLocation`)

This script queries HubSpot for completed installs and writes a JSON file with raw + computed metrics.

- [ ] **Step 1: Create the script skeleton with HubSpot client setup**

```typescript
// scripts/4x10-extract-install-data.ts
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Client } from "@hubspot/api-client";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals/index.js";
import * as fs from "fs";

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN!,
});

// Rate-limit retry wrapper (mirrors src/lib/hubspot.ts searchWithRetry)
async function searchWithRetry(
  searchRequest: Parameters<typeof hubspotClient.crm.deals.searchApi.doSearch>[0],
  maxRetries = 5
) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await hubspotClient.crm.deals.searchApi.doSearch(searchRequest);
    } catch (error: unknown) {
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes("429") || error.message.includes("rate") || error.message.includes("secondly"));
      const statusCode = (error as { code?: number })?.code;
      if ((isRateLimit || statusCode === 429) && attempt < maxRetries - 1) {
        const base = Math.pow(2, attempt) * 1100;
        const jitter = Math.random() * 400;
        const delay = Math.round(base + jitter);
        console.log(`[hubspot] Rate limited (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

const PROJECT_PIPELINE_ID = "6900017";

const PROPERTIES = [
  "hs_object_id",
  "dealname",
  "amount",
  "dealstage",
  "pb_location",
  "install_schedule_date",
  "construction_complete_date",
  "project_number",
];

const COLORADO_LOCATIONS = ["Westminster", "Centennial", "Colorado Springs"];

// Location normalization (inline, matches src/lib/locations.ts)
const LOCATION_ALIASES: Record<string, string> = {
  dtc: "Centennial",
  centennial: "Centennial",
  "denver tech": "Centennial",
  westminster: "Westminster",
  westy: "Westminster",
  "colorado springs": "Colorado Springs",
  cosp: "Colorado Springs",
  "co springs": "Colorado Springs",
  pueblo: "Colorado Springs",
};

function normalizeLocation(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (COLORADO_LOCATIONS.includes(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  for (const [alias, canonical] of Object.entries(LOCATION_ALIASES)) {
    if (lower === alias || lower.includes(alias)) return canonical;
  }
  return null;
}

async function main() {
  console.log("Fetching completed installs from HubSpot...");
  // next steps fill this in
}

main().catch(console.error);
```

- [ ] **Step 2: Run to verify HubSpot connection**

Run: `npx tsx scripts/4x10-extract-install-data.ts`
Expected: "Fetching completed installs from HubSpot..." prints without error

- [ ] **Step 3: Add the HubSpot search with pagination**

Add inside `main()` after the console.log:

```typescript
const sixMonthsAgo = new Date();
sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
const sinceDate = sixMonthsAgo.toISOString().split("T")[0];

type HubSpotDeal = {
  id: string;
  properties: Record<string, string | null>;
};

const allDeals: HubSpotDeal[] = [];
let after: string | undefined;

do {
  const response = await searchWithRetry({
    filterGroups: [
      {
        filters: [
          {
            propertyName: "pipeline",
            operator: FilterOperatorEnum.Eq,
            value: PROJECT_PIPELINE_ID,
          },
          {
            propertyName: "install_schedule_date",
            operator: FilterOperatorEnum.Gte,
            value: sinceDate,
          },
          {
            propertyName: "construction_complete_date",
            operator: FilterOperatorEnum.HasProperty,
          },
        ],
      },
    ],
    properties: PROPERTIES,
    limit: 100,
    after: after ?? "0",
    sorts: [{ propertyName: "install_schedule_date", direction: "ASCENDING" as const }],
  });

  const results = (response.results ?? []) as HubSpotDeal[];
  allDeals.push(...results);
  after = response.paging?.next?.after;
} while (after);

console.log(`Fetched ${allDeals.length} deals with both schedule + complete dates`);
```

- [ ] **Step 4: Run to verify deal fetch count**

Run: `npx tsx scripts/4x10-extract-install-data.ts`
Expected: "Fetched N deals with both schedule + complete dates" (expect 50-200)

- [ ] **Step 5: Add business-day calculation and deal processing**

Add before `main()`:

```typescript
// Count business days (Mon-Fri) between two dates, inclusive of start, exclusive of end
function businessDaysBetween(start: Date, end: Date): number {
  let count = 0;
  const current = new Date(start);
  while (current < end) {
    const dow = current.getDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return Math.max(count, 1); // minimum 1 day
}

function getDayOfWeek(date: Date): number {
  return date.getDay(); // 0=Sun ... 6=Sat
}

function getDayName(dow: number): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow];
}

interface InstallRecord {
  dealId: string;
  dealName: string;
  projectNumber: string | null;
  location: string;
  amount: number;
  installScheduleDate: string;     // YYYY-MM-DD
  constructionCompleteDate: string; // YYYY-MM-DD
  crewDaysRequired: number;        // Metric 1: Mon-Fri business days
  elapsedCalendarDays: number;     // Actual calendar days (start to complete, inclusive)
  startDayOfWeek: number;          // 0-6
  startDayName: string;            // Mon, Tue, etc.
  monthKey: string;                // YYYY-MM
}
```

Add at end of `main()` after the fetch loop:

```typescript
const installs: InstallRecord[] = [];

for (const deal of allDeals) {
  const p = deal.properties;
  const location = normalizeLocation(p.pb_location);
  if (!location || !COLORADO_LOCATIONS.includes(location)) continue;

  const scheduleDate = p.install_schedule_date;
  const completeDate = p.construction_complete_date;
  if (!scheduleDate || !completeDate) continue;

  const start = new Date(scheduleDate);
  const end = new Date(completeDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;
  if (end < start) continue; // skip negative spans (same-day = valid 1-day install)

  const crewDays = businessDaysBetween(start, end);
  const elapsedCalendar = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  const startDow = getDayOfWeek(start);

  installs.push({
    dealId: deal.id,
    dealName: p.dealname ?? "",
    projectNumber: p.project_number ?? null,
    location,
    amount: parseFloat(p.amount ?? "0") || 0,
    installScheduleDate: scheduleDate,
    constructionCompleteDate: completeDate,
    crewDaysRequired: crewDays,
    elapsedCalendarDays: elapsedCalendar,
    startDayOfWeek: startDow,
    startDayName: getDayName(startDow),
    monthKey: scheduleDate.substring(0, 7),
  });
}

console.log(`Processed ${installs.length} valid Colorado installs`);
```

- [ ] **Step 6: Run to verify processing**

Run: `npx tsx scripts/4x10-extract-install-data.ts`
Expected: "Processed N valid Colorado installs" (subset of fetched deals)

- [ ] **Step 7: Commit data extraction**

```bash
git add scripts/4x10-extract-install-data.ts
git commit -m "feat: add HubSpot install data extraction for 4x10 analysis"
```

---

### Task 2: Simulation Engine

**Files:**
- Modify: `scripts/4x10-extract-install-data.ts`

The simulation replays each historical install onto the Group A/B rotation calendar.

- [ ] **Step 1: Add rotation calendar and simulation types**

Add before `main()`:

```typescript
// Group A = Mon-Thu (days 1,2,3,4), Group B = Wed-Sat (days 3,4,5,6)
const GROUP_A_DAYS = new Set([1, 2, 3, 4]); // Mon, Tue, Wed, Thu
const GROUP_B_DAYS = new Set([3, 4, 5, 6]); // Wed, Thu, Fri, Sat

type Group = "A" | "B";

function getGroupDays(group: Group): Set<number> {
  return group === "A" ? GROUP_A_DAYS : GROUP_B_DAYS;
}

type FitClassification = "fits_in_block" | "fits_with_pause" | "needs_handoff";

interface SimulationResult {
  group: Group;
  calendarDaysToComplete: number;
  fitClassification: FitClassification;
  pauseDays: number;           // OFF days the install spans
  handoffRequired: boolean;
}

// Simulate one install on the 4x10 rotation
// allowPause=true: install can pause over OFF days (same crew resumes)
// allowPause=false: any gap = needs handoff
function simulateInstall(
  crewDaysRequired: number,
  startDayOfWeek: number,
  group: Group,
  allowPause: boolean
): SimulationResult {
  const onDays = getGroupDays(group);
  let remaining = crewDaysRequired;
  let currentDow = startDayOfWeek;
  let calendarDays = 0;
  let pauseDays = 0;
  let spansMultipleBlocks = false;
  let consecutiveOffDays = 0;

  // If start day is not an ON day for this group, it's an immediate mismatch
  // In practice we assign based on start day, but handle gracefully
  if (!onDays.has(currentDow)) {
    return {
      group,
      calendarDaysToComplete: crewDaysRequired, // fallback
      fitClassification: "needs_handoff",
      pauseDays: 0,
      handoffRequired: true,
    };
  }

  // calendarDays counts total elapsed days from start to finish (inclusive).
  // Day 1 = the start day itself, so we begin at 1 and increment on each
  // subsequent day we step through (whether ON or OFF).
  calendarDays = 1; // start day counts as day 1

  while (remaining > 0) {
    if (onDays.has(currentDow)) {
      remaining--;
      consecutiveOffDays = 0;
    } else {
      pauseDays++;
      consecutiveOffDays++;
      if (consecutiveOffDays >= 2) {
        // 2+ consecutive OFF days means we've crossed into the weekend gap
        spansMultipleBlocks = true;
      }
    }
    if (remaining > 0) {
      calendarDays++;
      currentDow = (currentDow + 1) % 7;
    }
  }
  // Examples:
  // 1-day install starting Mon (Group A): remaining=0 after first iteration, calendarDays=1. Correct.
  // 2-day install starting Mon (Group A): Mon consumed, Tue consumed, calendarDays=2. Correct.
  // 3-day install starting Wed (Group A): Wed consumed, Thu consumed, Fri(OFF)+Sat(OFF)+Sun(OFF) skipped,
  //   Mon consumed, calendarDays=6. Correct (Wed-Mon inclusive = 6 calendar days).

  let fitClassification: FitClassification;
  if (pauseDays === 0) {
    fitClassification = "fits_in_block";
  } else if (allowPause) {
    fitClassification = spansMultipleBlocks ? "fits_with_pause" : "fits_in_block";
  } else {
    fitClassification = "needs_handoff";
  }

  return {
    group,
    calendarDaysToComplete: calendarDays,
    fitClassification,
    pauseDays,
    handoffRequired: fitClassification === "needs_handoff",
  };
}
```

- [ ] **Step 2: Add default group assignment logic**

Add before `main()`:

```typescript
// Default assignment: for 2-crew locations, assign based on start day
// Mon-Tue starts -> Group A, Fri-Sat starts -> Group B, Wed-Thu -> whichever has capacity
// For COSP (1 crew), default to Group A
function assignGroup(startDow: number, location: string, cospGroup: Group = "A"): Group {
  if (location === "Colorado Springs") return cospGroup;
  // Sunday (0) shouldn't happen under 5x8, but remap to Monday (Group A) as guard
  if (startDow === 0) return "A";
  // 2-crew locations: assign by start day
  if (startDow === 1 || startDow === 2) return "A"; // Mon, Tue -> A
  if (startDow === 5 || startDow === 6) return "B"; // Fri, Sat -> B
  // Wed (3) or Thu (4) -> split evenly, alternate
  return startDow === 3 ? "A" : "B"; // Wed->A, Thu->B as tiebreaker
}
```

- [ ] **Step 3: Add the simulation loop in main()**

Add at end of `main()`:

```typescript
// -- Simulation: run each install through both pause policies --

interface SimulatedInstall extends InstallRecord {
  assignedGroup: Group;
  simPauseAllowed: SimulationResult;
  simNoPause: SimulationResult;
}

const simulated: SimulatedInstall[] = installs.map((install) => {
  const group = assignGroup(install.startDayOfWeek, install.location);
  return {
    ...install,
    assignedGroup: group,
    simPauseAllowed: simulateInstall(install.crewDaysRequired, install.startDayOfWeek, group, true),
    simNoPause: simulateInstall(install.crewDaysRequired, install.startDayOfWeek, group, false),
  };
});

console.log(`Simulated ${simulated.length} installs on 4x10 calendar`);
```

- [ ] **Step 4: Run to verify simulation**

Run: `npx tsx scripts/4x10-extract-install-data.ts`
Expected: "Simulated N installs on 4x10 calendar"

- [ ] **Step 5: Commit simulation engine**

```bash
git add scripts/4x10-extract-install-data.ts
git commit -m "feat: add 4x10 rotation simulation engine"
```

---

### Task 3: Aggregation, Scoring & JSON Output

**Files:**
- Modify: `scripts/4x10-extract-install-data.ts`

Aggregate results and compute the decision rubric score.

- [ ] **Step 1: Add aggregation functions**

Add before `main()`:

```typescript
// -- Crew capacity constants --
const CREWS_PER_LOCATION: Record<string, number> = {
  Westminster: 2,
  Centennial: 2,
  "Colorado Springs": 1,
};

// Current: 5 days/week x 8 hrs = 40 hrs/crew/week
// Proposed: 4 days/week x 10 hrs = 40 hrs/crew/week
const CURRENT_DAYS_PER_CREW = 5;
const PROPOSED_DAYS_PER_CREW = 4;
const CURRENT_HRS_PER_DAY = 8;
const PROPOSED_HRS_PER_DAY = 10;

interface LocationSummary {
  location: string;
  totalInstalls: number;
  avgCrewDays: number;
  medianCrewDays: number;
  totalRevenue: number;
  avgRevenue: number;
  crewDaysPerWeek: number;    // current capacity
  utilization: number;         // % of capacity used
  dayOfWeekDistribution: Record<string, number>; // day name -> count
  monthlyBreakdown: Record<string, { count: number; revenue: number; crewDays: number }>;
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarizeLocation(records: InstallRecord[], location: string): LocationSummary {
  const filtered = records.filter((r) => r.location === location);
  const crewDays = filtered.map((r) => r.crewDaysRequired);
  const crews = CREWS_PER_LOCATION[location] ?? 1;

  // Monthly breakdown
  const monthly: Record<string, { count: number; revenue: number; crewDays: number }> = {};
  const dowDist: Record<string, number> = {};

  for (const r of filtered) {
    if (!monthly[r.monthKey]) monthly[r.monthKey] = { count: 0, revenue: 0, crewDays: 0 };
    monthly[r.monthKey].count++;
    monthly[r.monthKey].revenue += r.amount;
    monthly[r.monthKey].crewDays += r.crewDaysRequired;
    dowDist[r.startDayName] = (dowDist[r.startDayName] ?? 0) + 1;
  }

  // Avg crew-days used per week (total crew-days / weeks in range)
  const weeks = 26; // ~6 months
  const totalCrewDays = crewDays.reduce((a, b) => a + b, 0);
  const crewDaysPerWeek = totalCrewDays / weeks;
  const capacityPerWeek = crews * CURRENT_DAYS_PER_CREW;
  const utilization = capacityPerWeek > 0 ? (crewDaysPerWeek / capacityPerWeek) * 100 : 0;

  return {
    location,
    totalInstalls: filtered.length,
    avgCrewDays: crewDays.length ? crewDays.reduce((a, b) => a + b, 0) / crewDays.length : 0,
    medianCrewDays: crewDays.length ? median(crewDays) : 0,
    totalRevenue: filtered.reduce((a, r) => a + r.amount, 0),
    avgRevenue: filtered.length ? filtered.reduce((a, r) => a + r.amount, 0) / filtered.length : 0,
    crewDaysPerWeek,
    utilization,
    dayOfWeekDistribution: dowDist,
    monthlyBreakdown: monthly,
  };
}
```

- [ ] **Step 2: Add decision rubric scoring**

Add before `main()`:

```typescript
// -- Decision Rubric --
// Install coverage: 40%, Handoff rate: 25%, Revenue-weighted capacity: 20%, Dark days: 15%

interface ScenarioScore {
  label: string;
  installCoverage: number;    // 0-1: % installs without handoff
  handoffRate: number;        // 0-1: % needing handoff (lower = better)
  revenueCapacity: number;    // total $ of coverable installs per week
  darkDays: number;           // days/week with zero coverage at any location
  weightedScore: number;      // 0-100
}

// Per-location group assignment: maps location -> array of group labels for each crew
type LocationGroups = Record<string, Group[]>;

// Default assignment: 1 per group at 2-crew locations, COSP configurable
function defaultLocationGroups(cospGroup: Group): LocationGroups {
  return {
    Westminster: ["A", "B"],
    Centennial: ["A", "B"],
    "Colorado Springs": [cospGroup],
  };
}

function scoreScenario(
  label: string,
  simInstalls: SimulatedInstall[],
  allowPause: boolean,
  cospGroup: Group,
  locationGroups?: LocationGroups
): ScenarioScore {
  const groups = locationGroups ?? defaultLocationGroups(cospGroup);

  // Re-simulate each install using assignGroup for consistent tie-breaking.
  // This ensures the scorer uses the exact same Wed->A / Thu->B rule as the
  // base simulation, avoiding bias toward Group A on overlap days.
  const adjusted = simInstalls.map((si) => {
    const locGroups = groups[si.location] ?? ["A"];
    let group: Group;

    if (locGroups.length === 1) {
      // Single-crew location (COSP): use the one available group
      group = locGroups[0];
    } else {
      // Multi-crew location: use assignGroup tie-break rules
      // (Mon/Tue -> A, Fri/Sat -> B, Wed -> A, Thu -> B, Sun -> A)
      const cospG = groups["Colorado Springs"]?.[0] ?? "A";
      group = assignGroup(si.startDayOfWeek, si.location, cospG);
      // Verify the assigned group is actually available at this location
      // (handles what-if scenarios where both crews are in the same group)
      if (!locGroups.includes(group)) {
        group = locGroups[0]; // fall back to first available
      }
    }

    const sim = simulateInstall(si.crewDaysRequired, si.startDayOfWeek, group, allowPause);
    return { ...si, assignedGroup: group, simResult: sim };
  });

  const total = adjusted.length;
  const noHandoff = adjusted.filter((a) => !a.simResult.handoffRequired).length;
  const handoffs = total - noHandoff;
  const coverableRevenue = adjusted
    .filter((a) => !a.simResult.handoffRequired)
    .reduce((sum, a) => sum + a.amount, 0);
  const weeks = 26;
  const revenuePerWeek = coverableRevenue / weeks;

  // Dark days: dynamically computed from actual group assignments
  // For each location, check Mon-Sat (1-6): a day is "dark" if no crew's group covers it
  let totalDarkDays = 0;
  for (const [loc, crewGroups] of Object.entries(groups)) {
    const coveredDays = new Set<number>();
    for (const g of crewGroups) {
      for (const d of getGroupDays(g)) coveredDays.add(d);
    }
    for (let d = 1; d <= 6; d++) {
      if (!coveredDays.has(d)) totalDarkDays++;
    }
  }

  const installCoverage = total > 0 ? noHandoff / total : 1;
  const handoffRate = total > 0 ? handoffs / total : 0;

  // Normalize revenue capacity to 0-1 scale (use max possible as denominator)
  const maxRevenue = adjusted.reduce((sum, a) => sum + a.amount, 0) / weeks;
  const revNorm = maxRevenue > 0 ? revenuePerWeek / maxRevenue : 1;

  // Normalize dark days: 0 dark = 1.0, 6 dark = 0.0
  const darkNorm = 1 - totalDarkDays / 6;

  const weightedScore =
    installCoverage * 40 + (1 - handoffRate) * 25 + revNorm * 20 + darkNorm * 15;

  return {
    label,
    installCoverage,
    handoffRate,
    revenueCapacity: revenuePerWeek,
    darkDays: totalDarkDays,
    weightedScore,
  };
}
```

- [ ] **Step 3: Add JSON output generation in main()**

Add at end of `main()`:

```typescript
// -- Aggregations --
const locationSummaries = COLORADO_LOCATIONS.map((loc) => summarizeLocation(installs, loc));

// -- Fit distribution (pause allowed) --
const fitDistPause = {
  fitsInBlock: simulated.filter((s) => s.simPauseAllowed.fitClassification === "fits_in_block").length,
  fitsWithPause: simulated.filter((s) => s.simPauseAllowed.fitClassification === "fits_with_pause").length,
  needsHandoff: simulated.filter((s) => s.simPauseAllowed.fitClassification === "needs_handoff").length,
};
const fitDistNoPause = {
  fitsInBlock: simulated.filter((s) => s.simNoPause.fitClassification === "fits_in_block").length,
  fitsWithPause: 0,
  needsHandoff: simulated.filter((s) => s.simNoPause.fitClassification === "needs_handoff").length,
};

// -- Scenario scoring (COSP group x pause policy) --
const scenarios = [
  scoreScenario("COSP Group A (pause OK)", simulated, true, "A"),
  scoreScenario("COSP Group B (pause OK)", simulated, true, "B"),
  scoreScenario("COSP Group A (no pause)", simulated, false, "A"),
  scoreScenario("COSP Group B (no pause)", simulated, false, "B"),
];

// Determine best COSP group for 6th crew cross-product
const bestCospGroup = scenarios[0].weightedScore >= scenarios[1].weightedScore ? "A" as Group : "B" as Group;

// -- 6th crew scenarios (3 locations x 2 groups x 2 COSP groups = 12 scenarios) --
const sixthCrewScenarios: ScenarioScore[] = [];
for (const addTo of COLORADO_LOCATIONS) {
  for (const addGroup of ["A", "B"] as Group[]) {
    for (const cospG of ["A", "B"] as Group[]) {
      const augmentedGroups: LocationGroups = {
        Westminster: ["A", "B"],
        Centennial: ["A", "B"],
        "Colorado Springs": [cospG],
      };
      // Add the 6th crew to the target location
      augmentedGroups[addTo] = [...augmentedGroups[addTo], addGroup];
      sixthCrewScenarios.push(
        scoreScenario(
          `+1 crew ${addTo} Grp ${addGroup}, COSP Grp ${cospG}`,
          simulated, true, cospG, augmentedGroups
        )
      );
    }
  }
}

// -- Turnaround compression scenarios --
const compressionScenarios = [1, 2].map((compress) => {
  const compressed = simulated.map((si) => {
    const newCrewDays = Math.max(1, si.crewDaysRequired - compress);
    return {
      ...si,
      crewDaysRequired: newCrewDays,
      simPauseAllowed: simulateInstall(newCrewDays, si.startDayOfWeek, si.assignedGroup, true),
      simNoPause: simulateInstall(newCrewDays, si.startDayOfWeek, si.assignedGroup, false),
    };
  });
  return {
    compressionDays: compress,
    score: scoreScenario(`-${compress} day compression (pause OK)`, compressed, true, "A"),
    fitDistPause: {
      fitsInBlock: compressed.filter((s) => s.simPauseAllowed.fitClassification === "fits_in_block").length,
      fitsWithPause: compressed.filter((s) => s.simPauseAllowed.fitClassification === "fits_with_pause").length,
      needsHandoff: compressed.filter((s) => s.simPauseAllowed.fitClassification === "needs_handoff").length,
    },
  };
});

// -- Build output JSON --
const output = {
  metadata: {
    generatedAt: new Date().toISOString(),
    dateRange: {
      from: installs.length ? installs[0].installScheduleDate : null,
      to: installs.length ? installs[installs.length - 1].installScheduleDate : null,
    },
    totalDeals: allDeals.length,
    validInstalls: installs.length,
  },
  currentState: {
    locationSummaries,
    overall: {
      totalInstalls: installs.length,
      avgCrewDays: installs.length
        ? installs.reduce((a, r) => a + r.crewDaysRequired, 0) / installs.length
        : 0,
      medianCrewDays: median(installs.map((r) => r.crewDaysRequired)),
      totalRevenue: installs.reduce((a, r) => a + r.amount, 0),
      totalCrewDaysPerWeek: Object.entries(CREWS_PER_LOCATION).reduce(
        (sum, [, c]) => sum + c * CURRENT_DAYS_PER_CREW,
        0
      ),
      totalCrewHoursPerWeek: Object.entries(CREWS_PER_LOCATION).reduce(
        (sum, [, c]) => sum + c * CURRENT_DAYS_PER_CREW * CURRENT_HRS_PER_DAY,
        0
      ),
    },
    crewDaysDistribution: (() => {
      const dist: Record<number, number> = {};
      for (const i of installs) {
        dist[i.crewDaysRequired] = (dist[i.crewDaysRequired] ?? 0) + 1;
      }
      return dist;
    })(),
  },
  proposedModel: {
    fitDistribution: { pauseAllowed: fitDistPause, noPause: fitDistNoPause },
    scenarios,
    sixthCrewScenarios,
    compressionScenarios,
    overall: {
      totalCrewDaysPerWeek: Object.entries(CREWS_PER_LOCATION).reduce(
        (sum, [, c]) => sum + c * PROPOSED_DAYS_PER_CREW,
        0
      ),
      totalCrewHoursPerWeek: Object.entries(CREWS_PER_LOCATION).reduce(
        (sum, [, c]) => sum + c * PROPOSED_DAYS_PER_CREW * PROPOSED_HRS_PER_DAY,
        0
      ),
      operatingDays: 6,
    },
  },
  // Raw install data for playground embedding
  installs: simulated.map((si) => ({
    dealId: si.dealId,
    dealName: si.dealName,
    projectNumber: si.projectNumber,
    location: si.location,
    amount: si.amount,
    installScheduleDate: si.installScheduleDate,
    constructionCompleteDate: si.constructionCompleteDate,
    crewDaysRequired: si.crewDaysRequired,
    elapsedCalendarDays: si.elapsedCalendarDays,
    startDayOfWeek: si.startDayOfWeek,
    startDayName: si.startDayName,
    monthKey: si.monthKey,
    assignedGroup: si.assignedGroup,
    simPauseAllowed: si.simPauseAllowed,
    simNoPause: si.simNoPause,
  })),
};

const outPath = "scripts/4x10-analysis-data.json";
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`\nOutput written to ${outPath}`);

// Print summary
console.log("\n-- Summary --");
console.log(`Total installs: ${installs.length}`);
console.log(`Avg crew-days: ${output.currentState.overall.avgCrewDays.toFixed(1)}`);
console.log(`Median crew-days: ${output.currentState.overall.medianCrewDays}`);
for (const loc of locationSummaries) {
  console.log(`  ${loc.location}: ${loc.totalInstalls} installs, ${loc.utilization.toFixed(0)}% utilization`);
}
console.log(`\nFit (pause OK): ${fitDistPause.fitsInBlock} block + ${fitDistPause.fitsWithPause} pause + ${fitDistPause.needsHandoff} handoff`);
console.log(`Fit (no pause): ${fitDistNoPause.fitsInBlock} block + ${fitDistNoPause.needsHandoff} handoff`);
for (const s of scenarios) {
  console.log(`  ${s.label}: score ${s.weightedScore.toFixed(1)}`);
}
```

- [ ] **Step 4: Run full extraction + simulation**

Run: `npx tsx scripts/4x10-extract-install-data.ts`
Expected: JSON file written to `scripts/4x10-analysis-data.json` with summary printed

- [ ] **Step 5: Spot-check the JSON output**

Open `scripts/4x10-analysis-data.json` and verify:
- `metadata.validInstalls` > 0
- `currentState.locationSummaries` has 3 entries
- `proposedModel.fitDistribution.pauseAllowed` numbers sum to total installs
- `proposedModel.scenarios` has 4 entries with different scores
- `installs` array has raw records

- [ ] **Step 6: Commit aggregation and JSON output**

```bash
git add scripts/4x10-extract-install-data.ts
git commit -m "feat: add aggregation, scoring, and JSON output for 4x10 analysis"
```

---

## Chunk 2: Spreadsheet Generation

### Task 4: Excel Workbook — Tab 1 (Current State)

**Files:**
- Create: `scripts/4x10-generate-xlsx.py`
- Read: `scripts/4x10-analysis-data.json` (generated by Task 3)
- Read: `scripts/generate-2026-so-xlsx.py` (reference for openpyxl patterns)
- Output: `reports/4x10-crew-rotation-analysis.xlsx`

- [ ] **Step 1: Create the Python script skeleton with styling constants**

```python
# scripts/4x10-generate-xlsx.py
import json
import sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side, numbers
from openpyxl.utils import get_column_letter

# -- Load data --
with open("scripts/4x10-analysis-data.json") as f:
    data = json.load(f)

# -- Style constants --
HEADER_FONT = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
HEADER_FILL = PatternFill("solid", fgColor="1F4E79")
ACCENT_FILL = PatternFill("solid", fgColor="2E75B6")
DATA_FONT = Font(name="Calibri", size=10)
BOLD_FONT = Font(name="Calibri", bold=True, size=10)
NUM_FONT = Font(name="Calibri", size=10)
BORDER = Border(
    bottom=Side(style="thin", color="D9D9D9"),
    right=Side(style="thin", color="D9D9D9"),
)
ALT_FILL = PatternFill("solid", fgColor="F2F7FC")
GREEN_FILL = PatternFill("solid", fgColor="E2EFDA")
YELLOW_FILL = PatternFill("solid", fgColor="FFF2CC")
RED_FILL = PatternFill("solid", fgColor="FCE4EC")
ORANGE_FILL = PatternFill("solid", fgColor="F4B084")

CURRENCY_FMT = '"$"#,##0'
PERCENT_FMT = "0.0%"
DECIMAL_FMT = "0.0"
INT_FMT = "#,##0"

def set_cell(ws, row, col, value=None, font=None, fill=None, fmt=None, align=None):
    cell = ws.cell(row=row, column=col, value=value)
    if font: cell.font = font
    if fill: cell.fill = fill
    if fmt: cell.number_format = fmt
    if align: cell.alignment = align
    cell.border = BORDER
    return cell

def write_header_row(ws, row, headers, widths):
    for col, (header, width) in enumerate(zip(headers, widths), 1):
        set_cell(ws, row, col, header, font=HEADER_FONT, fill=HEADER_FILL,
                 align=Alignment(horizontal="center", vertical="center"))
        ws.column_dimensions[get_column_letter(col)].width = width
    ws.row_dimensions[row].height = 24

wb = Workbook()
print("Generating 4x10 Crew Rotation Analysis workbook...")
```

- [ ] **Step 2: Add Tab 1 -- Current State**

Add after the skeleton code. This tab includes: location summary table, day-of-week distribution, monthly breakdown, and weekly capacity headline. The implementation follows the same `set_cell` / `write_header_row` pattern as `generate-2026-so-xlsx.py`.

**Section A: Location Summary Table**
- Headers: Location | Installs | Avg Duration (days) | Median Duration | Total Revenue | Avg Revenue | Utilization
- Widths: 22, 12, 18, 16, 18, 16, 14
- One row per `data["currentState"]["locationSummaries"]`, alternating `ALT_FILL`
- Totals row with `ACCENT_FILL` and white bold font

**Section B: Day-of-Week Distribution**
- Title row: "INSTALL START DAY DISTRIBUTION"
- Headers: Location | Mon | Tue | Wed | Thu | Fri | Sat
- One row per location, values from `loc["dayOfWeekDistribution"]`

**Section C: Monthly Breakdown**
- Title row: "MONTHLY BREAKDOWN"
- Headers: Month | Location | Installs | Crew-Days Used | Revenue
- Iterate sorted months, then locations, skip empty months

**Section D: Weekly Capacity Headline**
- Title: "WEEKLY CAPACITY"
- Two rows: Crew-days/week and Crew-hours/week from `overall`

Print: `"  Tab 1: Current State done"`

- [ ] **Step 3: Run to verify Tab 1 generates**

Run: `python3 scripts/4x10-generate-xlsx.py`
Expected: "Tab 1: Current State done" (script may error on missing save -- that's fine for now)

- [ ] **Step 4: Commit Tab 1**

```bash
git add scripts/4x10-generate-xlsx.py
git commit -m "feat: add Tab 1 (Current State) to 4x10 analysis workbook"
```

---

### Task 5: Excel Workbook — Tabs 2-4

**Files:**
- Modify: `scripts/4x10-generate-xlsx.py`

- [ ] **Step 1: Add Tab 2 -- Proposed Model**

New sheet with 5 sections:

**Section 1: Coverage Calendar**
- Headers: Location | Crew | Mon | Tue | Wed | Thu | Fri | Sat
- Rows: Westminster Crew 1 (A), Westminster Crew 2 (B), Centennial Crew 1 (A), Centennial Crew 2 (B), Colorado Springs Crew 1 (TBD)
- ON cells get `GREEN_FILL`, "?" cells get `YELLOW_FILL`, blank cells no fill

**Section 2: Install Fit Analysis (Pause Allowed)**
- Headers: Classification | Count | Percentage
- 3 data rows: Fits in Block (`GREEN_FILL`) / Fits with Pause (`YELLOW_FILL`) / Needs Handoff (`RED_FILL`)
- Total row with `ACCENT_FILL`

**Section 3: Install Fit Analysis (No Pause)**
- Same structure, 2 data rows: Fits in Block / Needs Handoff

**Section 4: Avg Calendar Span Comparison**
- Headers: Metric | Current (5x8) | Proposed (4x10) | Change
- Row 1: "Avg elapsed calendar days" -- current = avg of actual calendar days from `installScheduleDate` to `constructionCompleteDate` (compute in Python: `(date2 - date1).days + 1` for each install, includes weekends). Proposed = avg of `simPauseAllowed.calendarDaysToComplete`. This is the true apples-to-apples comparison: how many calendar days does the customer wait?
- Row 2: "Avg crew-days required" -- avg `crewDaysRequired` (same in both models, since total work doesn't change)
- Change column: green if proposed is fewer calendar days (faster for customer)

**Section 5: Capacity Comparison**
- Headers: Metric | Current (5x8) | Proposed (4x10) | Change
- Rows: Crew-days/week, Crew-hours/week, Operating days
- Change column: green fill for positive, red for negative, yellow for zero

**Section 6: Per-Install Detail Table** (scrollable data dump)
- Headers: Project # | Deal Name | Location | Amount | Schedule Date | Complete Date | Crew-Days | Start Day | Group | Fit (Pause) | Fit (No Pause) | Calendar Days
- One row per install from `data["installs"]` array
- Color-code fit classification cells: green/yellow/red
- Auto-filter enabled on the header row

Print: `"  Tab 2: Proposed Model done"`

- [ ] **Step 2: Add Tab 3 -- Scenarios**

New sheet with:
1. COSP group assignment comparison -- table of 4 scenarios (A/B x pause/no-pause) with columns: Scenario, Install Coverage, Handoff Rate, Revenue/Week, Dark Days, Score. Highlight best score row green.
2. 6th crew placement -- table of 12 scenarios (3 locations x 2 crew groups x 2 COSP groups) with same columns. Highlight best.
3. Turnaround compression -- table showing -1 and -2 day compression with fit distribution and scores.

Print: `"  Tab 3: Scenarios done"`

- [ ] **Step 3: Add Tab 4 -- Executive Summary**

New sheet with:
1. Headline comparison table: 5 rows (crew-hours, crew-days, operating days, weekend length, Saturday coverage) x Current/Proposed/Change columns
2. Install fit headline: large percentage "X% of installs handled by same crew"
3. Best scenario recommendation with score
4. Bulleted pros list (4 items)
5. Bulleted risks list (4 items)

Print: `"  Tab 4: Executive Summary done"`

- [ ] **Step 4: Add save at end of script**

```python
import os
os.makedirs("reports", exist_ok=True)

# -- Save --
out_path = "reports/4x10-crew-rotation-analysis.xlsx"
wb.save(out_path)
print(f"\nWorkbook saved to {out_path}")
```

- [ ] **Step 5: Run full workbook generation**

Run: `python3 scripts/4x10-generate-xlsx.py`
Expected: All 4 tabs generate, file saved to `reports/4x10-crew-rotation-analysis.xlsx`

- [ ] **Step 6: Open and spot-check the workbook**

Open `reports/4x10-crew-rotation-analysis.xlsx` in a spreadsheet app. Verify:
- Tab 1 has location data, day-of-week distribution, monthly breakdown
- Tab 2 has coverage calendar, fit distribution tables, capacity comparison
- Tab 3 has COSP scenario comparison, 6th crew options, compression scenarios
- Tab 4 has headline comparison, recommendation, pros/risks

- [ ] **Step 7: Commit spreadsheet generator**

```bash
git add scripts/4x10-generate-xlsx.py
git commit -m "feat: add complete 4-tab Excel workbook for 4x10 analysis"
```

---

## Chunk 3: Interactive Playground

### Task 6: HTML Playground

**Files:**
- Create: `scripts/4x10-playground-template.html` (committed template with `__DATA_PLACEHOLDER__`)
- Output: `reports/4x10-crew-rotation-playground.html` (generated with real data, gitignored)

The template is a single self-contained HTML file with inline CSS, SVG charts, and the simulation engine re-implemented in vanilla JS. All data comes from trusted internal HubSpot sources and is embedded at build time into a separate output file.

- [ ] **Step 1: Create the HTML template with layout, styles, and controls panel**

Create `scripts/4x10-playground-template.html` with:
- Header bar (title, subtitle)
- 2-column grid layout: 340px controls panel (sticky) + flexible visualization area
- Controls panel containing:
  - Schedule toggle (Current 5x8 / Proposed 4x10) -- button group
  - Crew assignment dropdowns (5 crews: Westminster 1/2, Centennial 1/2, COSP) -- only visible in Proposed mode
  - Turnaround compression slider (0 to -2 days)
  - Pause tolerance checkbox (default on)
  - 6th crew toggle with location + group selectors
- CSS variables for colors matching PB brand (blue-900, orange-500, green-500, etc.)
- `__DATA_PLACEHOLDER__` token in the script section for data inlining

Data placeholder: `const DATA = __DATA_PLACEHOLDER__;`

- [ ] **Step 2: Add the JS simulation engine**

Inside the script tag, **copy the TypeScript simulation logic verbatim, changing only syntax** (TS types removed, `const` stays, same variable names). This ensures behavioral parity between the pre-computed JSON and live playground calculations.

Functions to port (direct 1:1 translation from `scripts/4x10-extract-install-data.ts`):

```javascript
// Copy these exactly from the TypeScript version, removing type annotations:
const GROUP_A = new Set([1, 2, 3, 4]);
const GROUP_B = new Set([3, 4, 5, 6]);
function getGroupDays(g) { return g === 'A' ? GROUP_A : GROUP_B; }

// simulateInstall -> simulate (same logic, same edge cases)
function simulate(crewDays, startDow, group, allowPause) {
  // MUST preserve: consecutiveOffDays >= 2 check, spansMultipleBlocks flag,
  // immediate-return when start day not in group's ON days,
  // Sunday (dow=0) remapping to Monday
  // ... (copy from TS, remove type annotations)
}
```

Additional playground-only functions:
- `scoreConfig(results, darkDays)` -- same 40/25/20/15 weights, same normalization (revenue / maxRevenue, 1 - darkDays/6)
- `getConfig()` -- reads all DOM control values into a config object
- `recalc()` -- reads config, dispatches to `renderCurrent()` or `renderProposed()`

**Critical: the `simulate` function must handle these edge cases identically to TypeScript:**
1. Start day not an ON day for the group -> immediate `needs_handoff`
2. `consecutiveOffDays >= 2` sets `spansMultipleBlocks = true`
3. `allowPause=false` with any pause days -> `needs_handoff`
4. `Math.max(crewDays, 1)` floor (minimum 1 day)

- [ ] **Step 3: Add the Current State renderer**

`renderCurrent(container)` function that builds DOM content showing:
- Metrics row: 5 metric cards (total installs, avg duration, total revenue, crew-days/week, crew-hours/week)
- Weekly calendar grid (all locations, Mon-Fri all green, Sat gray)
- Location breakdown table
- Duration distribution bar chart (using inline styles for bar heights)

- [ ] **Step 4: Add the Proposed Model renderer**

`renderProposed(container, cfg)` function that:
1. Reads crew group assignments from config
2. Re-simulates all installs with current config (compression, pause toggle, group assignments)
3. Computes fit distribution and rubric score
4. Renders:
   - Metrics row with rubric score gauge (color-coded: green >= 80, yellow >= 60, red < 60)
   - Weekly coverage calendar (Group A blue, Group B amber, overlap gradient, OFF gray)
   - Install fit donut chart (SVG circle segments) with legend
   - Capacity comparison side-by-side bars (current blue vs proposed orange)
   - Decision rubric breakdown (horizontal progress bars for each factor)

- [ ] **Step 5: Add SVG helper functions**

Implement:
- `renderDonut(fits, total)` -- SVG donut with 3 segments (green/yellow/red), center percentage
- `renderCapacityBars(propDays, propHours)` -- side-by-side bar comparison
- `renderDurationBars(dist)` -- histogram of crew-day durations
- `renderRubricBars(scoring)` -- 4 horizontal progress bars with labels and scores

- [ ] **Step 6: Commit playground template**

The template at `scripts/4x10-playground-template.html` contains `__DATA_PLACEHOLDER__` — no real data, safe to commit. The generated output goes to a separate path.

```bash
git add scripts/4x10-playground-template.html
git commit -m "feat: add interactive 4x10 crew rotation simulator playground template"
```

---

### Task 7: Data Inlining

**Files:**
- Read: `scripts/4x10-playground-template.html` (committed template, never modified)
- Read: `scripts/4x10-analysis-data.json` (generated data)
- Write: `reports/4x10-crew-rotation-playground.html` (generated output, gitignored)

The template and output are separate files. The template always retains `__DATA_PLACEHOLDER__` so the pipeline is idempotent — rerun anytime to refresh data.

- [ ] **Step 1: Inline data from template to output**

```bash
node -e "
const fs = require('fs');
const data = fs.readFileSync('scripts/4x10-analysis-data.json', 'utf8');
const template = fs.readFileSync('scripts/4x10-playground-template.html', 'utf8');
const output = template.replace('__DATA_PLACEHOLDER__', data);
fs.writeFileSync('reports/4x10-crew-rotation-playground.html', output);
console.log('Playground generated at reports/4x10-crew-rotation-playground.html');
"
```

Expected: "Playground generated at reports/4x10-crew-rotation-playground.html"

- [ ] **Step 2: Open and test the playground in a browser**

Open `reports/4x10-crew-rotation-playground.html`. Verify:
- Current 5x8 view shows metrics, calendar, location table, duration histogram
- Toggle to Proposed 4x10: calendar updates, fit donut appears, capacity bars show, rubric breakdown renders
- Change crew group assignments: calendar and fit analysis update live
- Toggle pause: handoff % changes
- Move compression slider: fit improves
- Enable 6th crew: location options appear, metrics update
- Rubric score changes with each control adjustment

- [ ] **Step 3: Verify template is untouched**

```bash
grep '__DATA_PLACEHOLDER__' scripts/4x10-playground-template.html
```

Expected: Match found (template still has placeholder — confirms it was not overwritten)

---

## Chunk 4: End-to-End Verification

### Task 8: Full Pipeline Run & Cross-Check

**Files:**
- All scripts from Tasks 1-7

- [ ] **Step 1: Run the full pipeline end-to-end**

```bash
cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite

# Step 1: Extract data
npx tsx scripts/4x10-extract-install-data.ts

# Step 2: Generate spreadsheet
python3 scripts/4x10-generate-xlsx.py

# Step 3: Generate playground from template (template is never modified)
node -e "
const fs = require('fs');
const data = fs.readFileSync('scripts/4x10-analysis-data.json', 'utf8');
const template = fs.readFileSync('scripts/4x10-playground-template.html', 'utf8');
const output = template.replace('__DATA_PLACEHOLDER__', data);
fs.writeFileSync('reports/4x10-crew-rotation-playground.html', output);
console.log('Playground generated');
"
```

- [ ] **Step 2: Verify spreadsheet output**

Open `reports/4x10-crew-rotation-analysis.xlsx`:
- Tab 1: Location data populated, monthly breakdown shows 6 months
- Tab 2: Fit distribution numbers match JSON `proposedModel.fitDistribution`
- Tab 3: Scenario scores match JSON `proposedModel.scenarios`
- Tab 4: Pros/risks readable, recommendation highlighted

- [ ] **Step 3: Verify playground output**

Open `reports/4x10-crew-rotation-playground.html`:
- Data loads (not showing `__DATA_PLACEHOLDER__`)
- All controls work
- Numbers in playground match spreadsheet (same source JSON)
- Rubric scores match between Tab 3 and playground gauge

- [ ] **Step 4: Cross-check data consistency**

Verify these match across all three artifacts:
- Total install count: JSON `metadata.validInstalls` = Tab 1 total = playground metric card
- Fit distribution: JSON `proposedModel.fitDistribution.pauseAllowed` = Tab 2 table = playground donut
- Best scenario score: JSON highest `scenarios[].weightedScore` = Tab 3 highlighted row = playground gauge

- [ ] **Step 5: Add generated analysis artifacts to .gitignore**

The JSON, XLSX, and playground HTML all contain real deal data (names, amounts, project numbers). Only the scripts (code) should be committed; the generated output stays local.

```bash
cat >> .gitignore << 'EOF'

# 4x10 analysis -- generated artifacts contain real HubSpot deal data
scripts/4x10-analysis-data.json
reports/4x10-crew-rotation-analysis.xlsx
reports/4x10-crew-rotation-playground.html
EOF
```

- [ ] **Step 6: Final commit (scripts + template only, not generated data)**

```bash
git add scripts/4x10-extract-install-data.ts scripts/4x10-generate-xlsx.py scripts/4x10-playground-template.html .gitignore
git commit -m "feat: add 4x10 crew rotation analysis scripts

Includes HubSpot extraction + simulation (TS), Excel workbook generator (Python),
and HTML playground template. Run pipeline to generate reports locally.
Generated reports are gitignored (contain real deal data)."
```
