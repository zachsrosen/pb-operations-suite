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
      const statusCode = (error as { code?: number })?.code;
      const isRateLimit = statusCode === 429 ||
        (error instanceof Error &&
        (error.message.includes("429") || error.message.includes("RATE") || error.message.includes("secondly")));
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
  if (!onDays.has(currentDow)) {
    return {
      group,
      calendarDaysToComplete: crewDaysRequired, // fallback
      fitClassification: "needs_handoff",
      pauseDays: 0,
      handoffRequired: true,
    };
  }

  // Walk the group's calendar: consume one crew-day per ON day, count total
  // elapsed calendar days. We only advance past a day if work remains, so the
  // final work-day is counted but not overshot.
  calendarDays = 1; // start day counts as day 1

  while (remaining > 0) {
    if (onDays.has(currentDow)) {
      remaining--;
      consecutiveOffDays = 0;
    } else {
      pauseDays++;
      consecutiveOffDays++;
      if (consecutiveOffDays >= 2) {
        spansMultipleBlocks = true;
      }
    }
    if (remaining > 0) {
      calendarDays++;
      currentDow = (currentDow + 1) % 7;
    }
  }

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

// Default assignment: for 2-crew locations, assign based on start day
function assignGroup(startDow: number, location: string, cospGroup: Group = "A"): Group {
  if (location === "Colorado Springs") return cospGroup;
  if (startDow === 0) return "A"; // Sunday guard — anomalous data, not expected in practice
  if (startDow === 1 || startDow === 2) return "A"; // Mon, Tue -> A
  if (startDow === 5 || startDow === 6) return "B"; // Fri, Sat -> B
  return startDow === 3 ? "A" : "B"; // Wed->A, Thu->B as tiebreaker
}

// -- Crew capacity constants --
const CREWS_PER_LOCATION: Record<string, number> = {
  Westminster: 2,
  Centennial: 2,
  "Colorado Springs": 1,
};

const ANALYSIS_WEEKS = 26; // ~6 months of data
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
  crewDaysPerWeek: number;
  demandPressure: number;    // crew-days demanded / crew-days available (>100% = more work than one crew can handle)
  dayOfWeekDistribution: Record<string, number>;
  monthlyBreakdown: Record<string, { count: number; revenue: number; crewDays: number }>;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarizeLocation(records: InstallRecord[], location: string): LocationSummary {
  const filtered = records.filter((r) => r.location === location);
  const crewDays = filtered.map((r) => r.crewDaysRequired);
  const crews = CREWS_PER_LOCATION[location] ?? 1;

  const monthly: Record<string, { count: number; revenue: number; crewDays: number }> = {};
  const dowDist: Record<string, number> = {};

  for (const r of filtered) {
    if (!monthly[r.monthKey]) monthly[r.monthKey] = { count: 0, revenue: 0, crewDays: 0 };
    monthly[r.monthKey].count++;
    monthly[r.monthKey].revenue += r.amount;
    monthly[r.monthKey].crewDays += r.crewDaysRequired;
    dowDist[r.startDayName] = (dowDist[r.startDayName] ?? 0) + 1;
  }

  const totalCrewDays = crewDays.reduce((a, b) => a + b, 0);
  const crewDaysPerWeek = totalCrewDays / ANALYSIS_WEEKS;
  const capacityPerWeek = crews * CURRENT_DAYS_PER_CREW;
  // Demand pressure: ratio of crew-days demanded to single-crew capacity.
  // Values >100% are expected — that's why locations have multiple crews.
  const demandPressure = capacityPerWeek > 0 ? (crewDaysPerWeek / capacityPerWeek) * 100 : 0;

  return {
    location,
    totalInstalls: filtered.length,
    avgCrewDays: crewDays.length ? crewDays.reduce((a, b) => a + b, 0) / crewDays.length : 0,
    medianCrewDays: crewDays.length ? median(crewDays) : 0,
    totalRevenue: filtered.reduce((a, r) => a + r.amount, 0),
    avgRevenue: filtered.length ? filtered.reduce((a, r) => a + r.amount, 0) / filtered.length : 0,
    crewDaysPerWeek,
    demandPressure,
    dayOfWeekDistribution: dowDist,
    monthlyBreakdown: monthly,
  };
}

// -- Decision Rubric --
interface ScenarioScore {
  label: string;
  installCoverage: number;
  handoffRate: number;
  revenueCapacity: number;
  darkDays: number;
  weightedScore: number;
}

type LocationGroups = Record<string, Group[]>;

function defaultLocationGroups(cospGroup: Group): LocationGroups {
  return {
    Westminster: ["A", "B"],
    Centennial: ["A", "B"],
    "Colorado Springs": [cospGroup],
  };
}

interface SimulatedInstall extends InstallRecord {
  assignedGroup: Group;
  simPauseAllowed: SimulationResult;
  simNoPause: SimulationResult;
}

function scoreScenario(
  label: string,
  simInstalls: SimulatedInstall[],
  allowPause: boolean,
  cospGroup: Group,
  locationGroups?: LocationGroups
): ScenarioScore {
  const groups = locationGroups ?? defaultLocationGroups(cospGroup);

  const adjusted = simInstalls.map((si) => {
    const locGroups = groups[si.location] ?? ["A"];
    let group: Group;

    if (locGroups.length === 1) {
      group = locGroups[0];
    } else {
      const cospG = groups["Colorado Springs"]?.[0] ?? "A";
      group = assignGroup(si.startDayOfWeek, si.location, cospG);
      if (!locGroups.includes(group)) {
        group = locGroups[0];
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
  const revenuePerWeek = coverableRevenue / ANALYSIS_WEEKS;

  // Dark days: Mon(1)-Sat(6) per location with zero crew coverage.
  // Skip Sunday (0) — neither group works Sundays.
  // Denominator of 6 (not 6×locations) intentionally weights COSP dark days
  // heavily since that's the primary lever in this analysis.
  let totalDarkDays = 0;
  for (const [, crewGroups] of Object.entries(groups)) {
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
  const maxRevenue = adjusted.reduce((sum, a) => sum + a.amount, 0) / ANALYSIS_WEEKS;
  const revNorm = maxRevenue > 0 ? revenuePerWeek / maxRevenue : 1;
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

async function main() {
  console.log("Fetching completed installs from HubSpot...");

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  // HubSpot date property filters require millisecond timestamps (not ISO strings)
  const sinceDate = String(sixMonthsAgo.getTime());
  const farPastDate = String(new Date("2020-01-01T00:00:00Z").getTime());

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
              operator: FilterOperatorEnum.Gte,
              value: farPastDate,
            },
          ],
        },
      ],
      properties: PROPERTIES,
      limit: 100,
      ...(after ? { after } : {}),
      sorts: [{ propertyName: "install_schedule_date", direction: "ASCENDING" }] as unknown as string[],
    });

    const results = (response.results ?? []) as HubSpotDeal[];
    allDeals.push(...results);
    after = response.paging?.next?.after;
  } while (after);

  console.log(`Fetched ${allDeals.length} deals with both schedule + complete dates`);

  // -- Process deals into InstallRecords --
  const installs: InstallRecord[] = [];

  for (const deal of allDeals) {
    const p = deal.properties;
    const location = normalizeLocation(p.pb_location);
    if (!location || !COLORADO_LOCATIONS.includes(location)) continue;

    const scheduleDate = p.install_schedule_date;
    const completeDate = p.construction_complete_date;
    if (!scheduleDate || !completeDate) continue;

    const start = new Date(scheduleDate + "T12:00:00");
    const end = new Date(completeDate + "T12:00:00");
    if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;
    if (end < start) continue;

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

  // -- Simulation: run each install through both pause policies --
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

  // -- Aggregations --
  const locationSummaries = COLORADO_LOCATIONS.map((loc) => summarizeLocation(installs, loc));

  // -- Fit distribution --
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

  // -- Scenario scoring --
  const scenarios = [
    scoreScenario("COSP Group A (pause OK)", simulated, true, "A"),
    scoreScenario("COSP Group B (pause OK)", simulated, true, "B"),
    scoreScenario("COSP Group A (no pause)", simulated, false, "A"),
    scoreScenario("COSP Group B (no pause)", simulated, false, "B"),
  ];

  // -- 6th crew scenarios (3 locations x 2 groups x 2 COSP groups = 12) --
  const sixthCrewScenarios: ScenarioScore[] = [];
  for (const addTo of COLORADO_LOCATIONS) {
    for (const addGroup of ["A", "B"] as Group[]) {
      for (const cospG of ["A", "B"] as Group[]) {
        const augmentedGroups: LocationGroups = {
          Westminster: ["A", "B"],
          Centennial: ["A", "B"],
          "Colorado Springs": [cospG],
        };
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
    console.log(`  ${loc.location}: ${loc.totalInstalls} installs, ${loc.demandPressure.toFixed(0)}% demand pressure`);
  }
  console.log(`\nFit (pause OK): ${fitDistPause.fitsInBlock} block + ${fitDistPause.fitsWithPause} pause + ${fitDistPause.needsHandoff} handoff`);
  console.log(`Fit (no pause): ${fitDistNoPause.fitsInBlock} block + ${fitDistNoPause.needsHandoff} handoff`);
  for (const s of scenarios) {
    console.log(`  ${s.label}: score ${s.weightedScore.toFixed(1)}`);
  }
}

main().catch(console.error);
