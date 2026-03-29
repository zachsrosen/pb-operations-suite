import { NextRequest, NextResponse } from "next/server";
import { fetchAllProjects, type Project } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import {
  getBaselineTable,
  computeForecast,
  MILESTONE_CHAIN,
  MILESTONE_DATE_FIELD,
  type ForecastBasis,
  type BaselineTable,
} from "@/lib/forecasting";

export const maxDuration = 120;

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
  medianError: number | null;
  meanAbsError: number | null;
  sampleCount: number;
  withinOneWeek: number;
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
  month: string;
  meanAbsError: number | null;
  sampleCount: number;
}

interface AccuracyResponse {
  milestoneAccuracy: Record<string, MilestoneAccuracy>;
  basisDistribution: BasisDistribution;
  monthlyTrend: MonthlyAccuracyPoint[];
  overallAccuracy: {
    medianError: number | null;
    meanAbsError: number | null;
    withinOneWeek: number;
    withinTwoWeeks: number;
    totalProjectsAnalyzed: number;
  };
  lastUpdated: string;
}

// ─── Single-pass precomputation ──────────────────────────────────

function blankProject(p: Project): Project {
  return {
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
}

/**
 * Compute all accuracy metrics in a single pass over projects.
 * Each project gets ONE original forecast and ONE live forecast,
 * reused across milestone accuracy, basis distribution, and monthly trend.
 */
function computeAllMetrics(
  projects: Project[],
  table: BaselineTable,
): Omit<AccuracyResponse, "lastUpdated"> {
  // ── Per-milestone error collection ──
  const milestoneErrors: Record<string, number[]> = {};
  for (let i = 1; i < MILESTONE_CHAIN.length; i++) {
    milestoneErrors[MILESTONE_CHAIN[i]] = [];
  }

  // ── Basis counts ──
  const basisCounts: Record<ForecastBasis, number> = {
    segment: 0,
    location: 0,
    global: 0,
    actual: 0,
    insufficient: 0,
  };

  // ── Monthly trend (install milestone) ──
  const monthlyErrors: Record<string, number[]> = {};

  // ── Single pass ──
  for (const p of projects) {
    // Original forecast (from closeDate only) — computed once per project
    const originalForecast = computeForecast(blankProject(p), table);

    // Live forecast (with actuals) — computed once per project
    const liveForecast = computeForecast(p, table);

    // 1. Milestone accuracy: compare original forecast vs actual
    for (let i = 1; i < MILESTONE_CHAIN.length; i++) {
      const milestone = MILESTONE_CHAIN[i];
      const dateField = MILESTONE_DATE_FIELD[milestone];
      const actual = p[dateField] as string | null;
      if (!actual) continue;

      const forecastDate = originalForecast[milestone]?.date;
      if (!forecastDate) continue;

      milestoneErrors[milestone].push(daysBetween(actual, forecastDate));
    }

    // 2. Basis distribution: count from live forecast
    for (const milestone of MILESTONE_CHAIN) {
      const basis = liveForecast[milestone]?.basis;
      if (basis && basis in basisCounts) {
        basisCounts[basis]++;
      }
    }

    // 3. Monthly trend: install error by construction complete month
    const ccDate = p.constructionCompleteDate;
    if (ccDate) {
      const month = ccDate.substring(0, 7);
      const forecastDate = originalForecast.install?.date;
      if (forecastDate) {
        const error = Math.abs(daysBetween(forecastDate, ccDate));
        (monthlyErrors[month] ??= []).push(error);
      }
    }
  }

  // ── Aggregate milestone accuracy ──
  const milestoneAccuracy: Record<string, MilestoneAccuracy> = {};
  for (let i = 1; i < MILESTONE_CHAIN.length; i++) {
    const milestone = MILESTONE_CHAIN[i];
    const errors = milestoneErrors[milestone];
    const sorted = [...errors].sort((a, b) => a - b);
    const absErrors = errors.map((e) => Math.abs(e));

    milestoneAccuracy[milestone] = {
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

  // ── Aggregate basis distribution ──
  const basisTotal = Object.values(basisCounts).reduce((s, v) => s + v, 0);
  const basisDistribution: BasisDistribution =
    basisTotal === 0
      ? { segment: 0, location: 0, global: 0, actual: 0, insufficient: 0 }
      : {
          segment: Math.round((basisCounts.segment / basisTotal) * 100),
          location: Math.round((basisCounts.location / basisTotal) * 100),
          global: Math.round((basisCounts.global / basisTotal) * 100),
          actual: Math.round((basisCounts.actual / basisTotal) * 100),
          insufficient: Math.round(
            (basisCounts.insufficient / basisTotal) * 100,
          ),
        };

  // ── Aggregate monthly trend ──
  const monthlyTrend = Object.entries(monthlyErrors)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, errors]) => ({
      month,
      meanAbsError: mean(errors),
      sampleCount: errors.length,
    }));

  // ── Overall summary from install milestone ──
  const installAccuracy = milestoneAccuracy.install;

  return {
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
  };
}

// ─── Main Handler ─────────────────────────────────────────────────

export async function GET(_request: NextRequest) {
  try {
    const result = await appCache.getOrFetch<AccuracyResponse>(
      CACHE_KEYS.FORECAST_ACCURACY,
      async () => {
        const { data: baselineTable } = await getBaselineTable();
        const allProjects = await appCache.getOrFetch(
          CACHE_KEYS.PROJECTS_ALL,
          () => fetchAllProjects({ activeOnly: false }),
        );
        const projects = (allProjects.data ?? []) as Project[];

        // Only analyze projects with closeDate + at least reached install
        const analyzable = projects.filter(
          (p) => p.closeDate && p.constructionCompleteDate,
        );

        const metrics = computeAllMetrics(analyzable, baselineTable);

        return {
          ...metrics,
          lastUpdated: new Date().toISOString(),
        };
      },
    );

    return NextResponse.json(result.data);
  } catch (error) {
    console.error("Forecast accuracy API error:", error);
    return NextResponse.json(
      { error: "Failed to compute forecast accuracy" },
      { status: 500 },
    );
  }
}
