import { NextRequest, NextResponse } from "next/server";
import { fetchAllProjects, type Project } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import {
  getBaselineTable,
  computeForecast,
  MILESTONE_CHAIN,
  MILESTONE_DATE_FIELD,
  type MilestoneKey,
  type ForecastBasis,
  type BaselineTable,
} from "@/lib/forecasting";

// ─── Helpers ──────────────────────────────────────────────────────

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24),
  );
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// ─── Types ────────────────────────────────────────────────────────

interface MilestoneAccuracy {
  /** Median signed error in days (positive = forecast was late, negative = early) */
  medianError: number | null;
  /** Mean absolute error in days */
  meanAbsError: number | null;
  /** Number of projects with both forecast + actual for this milestone */
  sampleCount: number;
  /** % of forecasts within 7 days of actual */
  withinOneWeek: number;
  /** % of forecasts within 14 days of actual */
  withinTwoWeeks: number;
}

interface BasisDistribution {
  segment: number;
  location: number;
  global: number;
  actual: number;
  insufficient: number;
}

interface MonthlyAccuracyPoint {
  month: string; // "2025-06"
  meanAbsError: number | null;
  sampleCount: number;
}

// ─── Main Handler ─────────────────────────────────────────────────

export async function GET(_request: NextRequest) {
  try {
    const { data: baselineTable } = await getBaselineTable();
    const allProjects = await appCache.getOrFetch(
      CACHE_KEYS.PROJECTS_ALL,
      () => fetchAllProjects({ activeOnly: false }),
    );
    const projects = allProjects.data ?? [];

    // Only analyze projects that have closeDate + at least one completed milestone
    const analyzable = projects.filter((p) => p.closeDate && p.constructionCompleteDate);

    const milestoneAccuracy = computeMilestoneAccuracy(analyzable, baselineTable);
    const basisDistribution = computeBasisDistribution(analyzable, baselineTable);
    const monthlyTrend = computeMonthlyTrend(analyzable, baselineTable);

    // Overall summary
    const allErrors: number[] = [];
    for (const ma of Object.values(milestoneAccuracy)) {
      // Already aggregated, so use the raw sampleCount as proxy
    }
    // Compute overall from the install milestone (most meaningful)
    const installAccuracy = milestoneAccuracy.install;

    return NextResponse.json({
      milestoneAccuracy,
      basisDistribution,
      monthlyTrend,
      overallAccuracy: {
        medianError: installAccuracy?.medianError ?? null,
        meanAbsError: installAccuracy?.meanAbsError ?? null,
        withinOneWeek: installAccuracy?.withinOneWeek ?? 0,
        withinTwoWeeks: installAccuracy?.withinTwoWeeks ?? 0,
        totalProjectsAnalyzed: installAccuracy?.sampleCount ?? 0,
      },
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Forecast accuracy API error:", error);
    return NextResponse.json(
      { error: "Failed to compute forecast accuracy" },
      { status: 500 },
    );
  }
}

// ─── Computation Functions ────────────────────────────────────────

function computeMilestoneAccuracy(
  projects: Project[],
  table: BaselineTable,
): Record<string, MilestoneAccuracy> {
  const result: Record<string, MilestoneAccuracy> = {};

  // Skip "close" — it's always actual
  for (let i = 1; i < MILESTONE_CHAIN.length; i++) {
    const milestone = MILESTONE_CHAIN[i];
    const dateField = MILESTONE_DATE_FIELD[milestone];

    // For each project, compute original forecast and compare with actual
    const errors: number[] = [];

    for (const p of projects) {
      const actual = p[dateField] as string | null;
      if (!actual) continue;

      // Compute original forecast (from closeDate only, no actuals)
      const blankProject: Project = {
        ...p,
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

      const forecast = computeForecast(blankProject, table);
      const forecastDate = forecast[milestone]?.date;
      if (!forecastDate) continue;

      // positive = forecast was late (forecast > actual), negative = early
      errors.push(daysBetween(actual, forecastDate));
    }

    const sorted = [...errors].sort((a, b) => a - b);
    const absErrors = errors.map((e) => Math.abs(e));

    result[milestone] = {
      medianError: median(sorted),
      meanAbsError: mean(absErrors),
      sampleCount: errors.length,
      withinOneWeek:
        errors.length > 0
          ? Math.round(
              (absErrors.filter((e) => e <= 7).length / errors.length) * 100,
            )
          : 0,
      withinTwoWeeks:
        errors.length > 0
          ? Math.round(
              (absErrors.filter((e) => e <= 14).length / errors.length) * 100,
            )
          : 0,
    };
  }

  return result;
}

function computeBasisDistribution(
  projects: Project[],
  table: BaselineTable,
): BasisDistribution {
  const counts: BasisDistribution = {
    segment: 0,
    location: 0,
    global: 0,
    actual: 0,
    insufficient: 0,
  };

  for (const p of projects) {
    const forecast = computeForecast(p, table);
    for (const milestone of MILESTONE_CHAIN) {
      const basis = forecast[milestone]?.basis as ForecastBasis;
      if (basis && basis in counts) {
        counts[basis]++;
      }
    }
  }

  // Convert to percentages
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  if (total === 0) return counts;

  return {
    segment: Math.round((counts.segment / total) * 100),
    location: Math.round((counts.location / total) * 100),
    global: Math.round((counts.global / total) * 100),
    actual: Math.round((counts.actual / total) * 100),
    insufficient: Math.round((counts.insufficient / total) * 100),
  };
}

function computeMonthlyTrend(
  projects: Project[],
  table: BaselineTable,
): MonthlyAccuracyPoint[] {
  // Group projects by their construction complete month
  const byMonth: Record<string, number[]> = {};

  for (const p of projects) {
    const ccDate = p.constructionCompleteDate;
    if (!ccDate) continue;

    const month = ccDate.substring(0, 7); // "YYYY-MM"

    // Original forecast vs actual for install milestone
    const blankProject: Project = {
      ...p,
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

    const forecast = computeForecast(blankProject, table);
    const forecastDate = forecast.install?.date;
    if (!forecastDate) continue;

    const error = Math.abs(daysBetween(forecastDate, ccDate));
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push(error);
  }

  return Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, errors]) => ({
      month,
      meanAbsError: mean(errors),
      sampleCount: errors.length,
    }));
}
