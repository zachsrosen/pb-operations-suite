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

/** Parse a HubSpot duration property (stored as ms) and convert to days */
function parseMsToDays(val: string | null | undefined): number | null {
  const ms = parseNum(val);
  if (ms === null) return null;
  return Math.round((ms / 86400000) * 10) / 10;
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
    turnaround: parseMsToDays(useAllTime ? p.inspection_turnaround_time : p.inspection_turnaround_time__365_days_),
    outstandingFailed: parseNum(p.outstanding_failed_inspections),
    outstandingFailedNotRejected: parseNum(p.outstanding_failed_inspections__not_rejected_),
    ccPendingInspection: parseNum(p.cc_pending_inspection),
    constructionTurnaround: parseMsToDays(p.construction_turnaround_time__365_),
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
    turnaround: parseMsToDays(use365 ? p.inspection_turnaround_time__365_days_ : p.inspection_turnaround_time),
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

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const daysWindow = parseInt(searchParams.get("days") || "0") || 0;
    const forceRefresh = searchParams.get("refresh") === "true";
    const scope = searchParams.get("scope");

    // Fast path: return only action queue data for execution pages
    if (scope === "pipeline") {
      const { data: allProjects, lastUpdated } = await appCache.getOrFetch<Project[]>(
        CACHE_KEYS.PROJECTS_ALL,
        () => fetchAllProjects({ activeOnly: false }),
        forceRefresh,
      );
      const projects = allProjects || [];

      // Only fetch Zuper jobs for active pipeline-relevant deals
      const pipelineIds: string[] = [];
      for (const p of projects) {
        if (p.isActive && (p.constructionCompleteDate || p.hasInspectionFailed)) {
          pipelineIds.push(String(p.id));
        }
      }
      const zuperJobs = await getCachedZuperJobsByDealIds(pipelineIds, "Construction");
      const zuperByDeal = new Map<string, string>();
      for (const job of zuperJobs) {
        if (job.hubspotDealId) zuperByDeal.set(job.hubspotDealId, job.jobUid);
      }

      const ccPendingInspection = projects
        .filter((p) => p.constructionCompleteDate && !p.inspectionPassDate && p.isActive)
        .map((p) => buildPipelineDeal(p, zuperByDeal))
        .sort((a, b) => (b.daysSinceCc ?? 0) - (a.daysSinceCc ?? 0));

      const outstandingFailed = projects
        .filter((p) => p.hasInspectionFailed && !p.inspectionPassDate && p.isActive)
        .map((p) => buildPipelineDeal(p, zuperByDeal))
        .sort((a, b) => (b.daysSinceLastFail ?? 0) - (a.daysSinceLastFail ?? 0));

      return NextResponse.json({
        ccPendingInspection,
        outstandingFailed,
        lastUpdated: lastUpdated || new Date().toISOString(),
      });
    }

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
