import { NextRequest, NextResponse } from "next/server";
import { fetchAllProjects, type Project } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { getCachedZuperJobsByDealIds } from "@/lib/db";

const SURVEY_METRIC = "siteSurveyTurnaroundTime" as const;

interface MetricAverages {
  count: number;
  avg: number | null;
}

// Stages to exclude from pipeline tables (completed/cancelled projects)
const EXCLUDED_STAGES = [
  "Project Complete",
  "Cancelled",
  "Closed Lost",
  "Closed Won",
  "Lost",
];

interface DealDetail {
  dealId: string;
  projectNumber: string;
  name: string;
  url: string;
  pbLocation: string;
  surveyor: string;
  stage: string;
  amount: number;
  siteSurveyScheduleDate: string | null;
  siteSurveyCompletionDate: string | null;
  turnaroundDays: number | null;
  zuperJobUid: string | null;
}

function calculateAvg(projects: Project[]): MetricAverages {
  const values = projects
    .map((p) => p[SURVEY_METRIC] as number | null | undefined)
    .filter((v): v is number => v !== null && v !== undefined && !isNaN(v) && v >= 0);

  return {
    count: projects.length,
    avg:
      values.length > 0
        ? Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10
        : null,
  };
}

function buildDealDetails(
  projects: Project[],
  zuperByDeal: Map<string, string>
): DealDetail[] {
  return projects.map((p) => {
    const raw = p[SURVEY_METRIC] as number | null | undefined;
    const turnaroundDays =
      raw !== undefined && raw !== null && !isNaN(raw) && raw >= 0
        ? Math.round(raw * 10) / 10
        : null;
    return {
      dealId: String(p.id),
      projectNumber: p.projectNumber,
      name: p.name,
      url: p.url,
      pbLocation: p.pbLocation || "Unknown",
      surveyor: p.siteSurveyor || "Unknown",
      stage: p.stage || "Unknown",
      amount: p.amount ?? 0,
      siteSurveyScheduleDate: p.siteSurveyScheduleDate,
      siteSurveyCompletionDate: p.siteSurveyCompletionDate,
      turnaroundDays,
      zuperJobUid: zuperByDeal.get(String(p.id)) || (p.zuperUid || null),
    };
  });
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

    const { data: allProjects, lastUpdated } = await appCache.getOrFetch<Project[]>(
      CACHE_KEYS.PROJECTS_ALL,
      () => fetchAllProjects({ activeOnly: false }),
      forceRefresh
    );

    let projects = allProjects || [];

    // Filter by survey completion date window
    if (daysWindow > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysWindow);
      const cutoffStr = cutoff.toISOString().split("T")[0];

      projects = projects.filter((p) => {
        if (!p.siteSurveyCompletionDate) return false;
        return p.siteSurveyCompletionDate >= cutoffStr;
      });
    } else {
      // All time — still require survey completion date to exist
      projects = projects.filter((p) => !!p.siteSurveyCompletionDate);
    }

    // Fetch Zuper site survey jobs for all filtered deals
    const dealIds = projects.map((p) => String(p.id));
    const zuperJobs = await getCachedZuperJobsByDealIds(dealIds, "Site Survey");
    const zuperByDeal = new Map<string, string>();
    for (const job of zuperJobs) {
      if (job.hubspotDealId) zuperByDeal.set(job.hubspotDealId, job.jobUid);
    }

    // Group by location
    const byLocationGroups = groupBy(projects, (p) => p.pbLocation || "Unknown");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byLocation: Record<string, any> = {};
    for (const [loc, locProjects] of Object.entries(byLocationGroups)) {
      if (loc === "Unknown") continue;
      byLocation[loc] = {
        ...calculateAvg(locProjects),
        deals: buildDealDetails(locProjects, zuperByDeal),
      };
    }

    // Group by surveyor
    const bySurveyorGroups = groupBy(projects, (p) => p.siteSurveyor || "Unknown");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bySurveyor: Record<string, any> = {};
    for (const [name, surveyorProjects] of Object.entries(bySurveyorGroups)) {
      if (name === "Unknown" || !name) continue;
      bySurveyor[name] = {
        ...calculateAvg(surveyorProjects),
        deals: buildDealDetails(surveyorProjects, zuperByDeal),
      };
    }

    // Totals
    const totals = calculateAvg(projects);

    // Projects with survey scheduled but not completed — split into upcoming vs past due
    const now = new Date();
    const allAwaiting = (allProjects || [])
      .filter(
        (p) =>
          p.isSiteSurveyScheduled &&
          !p.isSiteSurveyCompleted &&
          p.siteSurveyScheduleDate &&
          !EXCLUDED_STAGES.some((s) => s.toLowerCase() === (p.stage || "").toLowerCase())
      )
      .map((p) => {
        const schedDate = new Date(p.siteSurveyScheduleDate!);
        const daysUntil = Math.round(
          (schedDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
        return {
          dealId: String(p.id),
          projectNumber: p.projectNumber,
          name: p.name,
          url: p.url,
          pbLocation: p.pbLocation || "Unknown",
          surveyor: p.siteSurveyor || "Unassigned",
          stage: p.stage || "Unknown",
          amount: p.amount ?? 0,
          siteSurveyScheduleDate: p.siteSurveyScheduleDate,
          daysUntil, // positive = future, negative = past due
          zuperJobUid: zuperByDeal.get(String(p.id)) || (p.zuperUid || null),
        };
      });

    // Upcoming: schedule date in the future (daysUntil >= 0), sorted soonest first
    const upcomingSurveys = allAwaiting
      .filter((p) => p.daysUntil >= 0)
      .sort((a, b) => a.daysUntil - b.daysUntil);

    // Past due: schedule date already passed (daysUntil < 0), sorted most overdue first
    const pastDueSurveys = allAwaiting
      .filter((p) => p.daysUntil < 0)
      .sort((a, b) => a.daysUntil - b.daysUntil);

    return NextResponse.json({
      byLocation,
      bySurveyor,
      totals: { ...totals, deals: buildDealDetails(projects, zuperByDeal) },
      upcomingSurveys,
      pastDueSurveys,
      daysWindow: daysWindow || "all",
      lastUpdated,
    });
  } catch (error) {
    console.error("Survey Metrics API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch survey metrics" },
      { status: 500 }
    );
  }
}
