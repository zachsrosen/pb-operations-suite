import { NextRequest, NextResponse } from "next/server";
import { fetchAllProjects, type Project } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";

// Time metric keys on the Project interface
const TIME_METRICS = [
  "siteSurveyTurnaroundTime",
  "timeDAReadyToSent",
  "daTurnaroundTime",
  "timeToSubmitPermit",
  "timeToSubmitInterconnection",
  "daToRtb",
  "constructionTurnaroundTime",
  "timeCcToPto",
  "timeToCc",
  "timeToDa",
  "timeToPto",
  "interconnectionTurnaroundTime",
  "permitTurnaroundTime",
  "timeRtbToConstructionSchedule",
  "designTurnaroundTime",
  "projectTurnaroundTime",
  "timeToRtb",
  "timeRtbToCc",
  "daToCc",
  "daToPermit",
] as const;

type TimeMetricKey = (typeof TIME_METRICS)[number];

interface MetricAverages {
  count: number;
  [key: string]: number | null;
}

/** Calculate days between two date strings. Returns null if either is missing. */
function daysBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (isNaN(ms) || ms < 0) return null;
  return ms / (1000 * 60 * 60 * 24);
}

function calculateAverages(projects: Project[]): MetricAverages {
  const result: MetricAverages = { count: projects.length };

  for (const metric of TIME_METRICS) {
    // Recalculate constructionTurnaroundTime from schedule → complete dates
    const values = projects
      .map((p) =>
        metric === "constructionTurnaroundTime"
          ? daysBetween(p.constructionScheduleDate, p.constructionCompleteDate)
          : p[metric],
      )
      .filter((v): v is number => v !== null && v !== undefined && !isNaN(v) && v >= 0);

    result[`avg_${metric}`] = values.length > 0
      ? Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10
      : null;
    result[`count_${metric}`] = values.length;
  }

  return result;
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

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const daysWindow = parseInt(searchParams.get("days") || "0") || 0;
    const forceRefresh = searchParams.get("refresh") === "true";

    // Fetch all projects (QC metrics need historical data too)
    const { data: allProjects, lastUpdated } = await appCache.getOrFetch<Project[]>(
      CACHE_KEYS.PROJECTS_ALL,
      () => fetchAllProjects({ activeOnly: false }),
      forceRefresh
    );

    let projects = allProjects || [];

    // Filter by construction complete date window (not closeDate)
    if (daysWindow > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysWindow);
      const cutoffStr = cutoff.toISOString().split("T")[0];

      projects = projects.filter((p) => {
        if (!p.constructionCompleteDate) return false;
        return p.constructionCompleteDate >= cutoffStr;
      });
    } else {
      // All time — still require construction complete date to exist
      projects = projects.filter((p) => !!p.constructionCompleteDate);
    }

    // Group by location
    const byLocationGroups = groupBy(projects, (p) => p.pbLocation || "Unknown");
    const byLocation: Record<string, MetricAverages> = {};
    for (const [loc, locProjects] of Object.entries(byLocationGroups)) {
      if (loc === "Unknown") continue;
      byLocation[loc] = calculateAverages(locProjects);
    }

    // Group by utility (for interconnection tables)
    const byUtilityGroups = groupBy(projects, (p) => p.utility || "Unknown");
    const byUtility: Record<string, MetricAverages> = {};
    for (const [util, utilProjects] of Object.entries(byUtilityGroups)) {
      if (util === "Unknown") continue;
      byUtility[util] = calculateAverages(utilProjects);
    }

    // Totals
    const totals = calculateAverages(projects);

    // Jobs currently in construction (from full project set, not filtered)
    const now = new Date();
    const inConstruction = (allProjects || [])
      .filter((p) => p.stage === "Construction" && p.constructionScheduleDate)
      .map((p) => {
        const schedDate = new Date(p.constructionScheduleDate!);
        const daysInConstruction = Math.round((now.getTime() - schedDate.getTime()) / (1000 * 60 * 60 * 24));
        return {
          projectNumber: p.projectNumber,
          name: p.name,
          pbLocation: p.pbLocation || "Unknown",
          constructionScheduleDate: p.constructionScheduleDate,
          daysInConstruction,
        };
      })
      .sort((a, b) => b.daysInConstruction - a.daysInConstruction);

    return NextResponse.json({
      byLocation,
      byUtility,
      totals,
      inConstruction,
      daysWindow: daysWindow || "all",
      lastUpdated,
    });
  } catch (error) {
    console.error("QC Metrics API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch QC metrics" },
      { status: 500 }
    );
  }
}
