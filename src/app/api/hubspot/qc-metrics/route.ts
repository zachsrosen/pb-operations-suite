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

function calculateAverages(projects: Project[]): MetricAverages {
  const result: MetricAverages = { count: projects.length };

  for (const metric of TIME_METRICS) {
    const values = projects
      .map((p) => p[metric])
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

    // Filter by time window if specified
    if (daysWindow > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysWindow);
      const cutoffStr = cutoff.toISOString().split("T")[0];

      projects = projects.filter((p) => {
        if (!p.closeDate) return false;
        return p.closeDate >= cutoffStr;
      });
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

    return NextResponse.json({
      byLocation,
      byUtility,
      totals,
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
