import { NextRequest, NextResponse } from "next/server";
import { fetchAllProjects, type Project } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import {
  getBaselineTable,
  computeProjectForecasts,
  MILESTONE_CHAIN,
  MILESTONE_DATE_FIELD,
  type MilestoneKey,
  type ForecastBasis,
} from "@/lib/forecasting";

export const maxDuration = 120;

// ─── Types ────────────────────────────────────────────────────────

interface MilestoneDetail {
  name: string;
  key: MilestoneKey;
  originalForecast: string | null;
  liveForecast: string | null;
  actual: string | null;
  varianceDays: number | null;
  basis: ForecastBasis;
}

interface TimelineProject {
  dealId: string;
  projectNumber: string;
  customerName: string;
  location: string;
  currentStage: string;
  nextMilestone: {
    name: string;
    forecastDate: string | null;
  };
  forecastPto: string | null;
  varianceDays: number | null;
  milestones: MilestoneDetail[];
}

interface TimelineResponse {
  projects: TimelineProject[];
  summary: {
    total: number;
    onTrack: number;
    atRisk: number;
    behind: number;
    noForecast: number;
  };
  lastUpdated: string;
}

// ─── Constants ────────────────────────────────────────────────────

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const MILESTONE_LABELS: Record<MilestoneKey, string> = {
  close: "Close",
  designComplete: "Design Complete",
  permitSubmit: "Permit Submit",
  permitApproval: "Permit Approval",
  icSubmit: "IC Submit",
  icApproval: "IC Approval",
  rtb: "RTB",
  install: "Install",
  inspection: "Inspection",
  pto: "PTO",
};

// ─── Helpers ──────────────────────────────────────────────────────

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T12:00:00").getTime() -
      new Date(a + "T12:00:00").getTime()) /
      MS_PER_DAY,
  );
}

function mapProject(project: Project, table: import("@/lib/forecasting").BaselineTable): TimelineProject {
  const { original, live } = computeProjectForecasts(project, table);

  // Build milestone detail array
  const milestones: MilestoneDetail[] = MILESTONE_CHAIN.map((key) => {
    const dateField = MILESTONE_DATE_FIELD[key];
    const actual = project[dateField] as string | null;
    const origDate = original[key]?.date ?? null;
    const liveDate = live[key]?.date ?? null;

    let varianceDays: number | null = null;
    if (origDate && liveDate) {
      varianceDays = daysBetween(origDate, liveDate);
    }

    return {
      name: MILESTONE_LABELS[key],
      key,
      originalForecast: origDate,
      liveForecast: liveDate,
      actual,
      varianceDays,
      basis: live[key]?.basis ?? "insufficient",
    };
  });

  // Determine next milestone: first in chain without an actual date
  let nextMilestone = { name: "Complete", forecastDate: null as string | null };
  for (const key of MILESTONE_CHAIN) {
    const dateField = MILESTONE_DATE_FIELD[key];
    const actual = project[dateField] as string | null;
    if (!actual) {
      nextMilestone = {
        name: MILESTONE_LABELS[key],
        forecastDate: live[key]?.date ?? null,
      };
      break;
    }
  }

  // PTO variance: live PTO forecast vs original PTO forecast
  const origPto = original.pto?.date ?? null;
  const livePto = live.pto?.date ?? null;
  let varianceDays: number | null = null;
  if (origPto && livePto) {
    varianceDays = daysBetween(origPto, livePto);
  }

  return {
    dealId: String(project.id),
    projectNumber: project.projectNumber,
    customerName: project.name,
    location: project.pbLocation,
    currentStage: project.stage,
    nextMilestone,
    forecastPto: livePto,
    varianceDays,
    milestones,
  };
}

function classifyVariance(days: number | null): "onTrack" | "atRisk" | "behind" | "noForecast" {
  if (days === null) return "noForecast";
  if (days <= 7) return "onTrack";
  if (days <= 14) return "atRisk";
  return "behind";
}

// ─── Main Handler ─────────────────────────────────────────────────

export async function GET(_request: NextRequest) {
  try {
    const { data: baselineTable } = await getBaselineTable();

    const { data: activeProjects } = await appCache.getOrFetch(
      CACHE_KEYS.PROJECTS_ACTIVE,
      () => fetchAllProjects({ activeOnly: true }),
    );

    const projects = (activeProjects ?? []) as Project[];

    // Map each project to timeline format
    const timelineProjects = projects
      .filter((p) => p.closeDate) // Need at least a close date to forecast
      .map((p) => mapProject(p, baselineTable));

    // Build summary
    const summary = { total: timelineProjects.length, onTrack: 0, atRisk: 0, behind: 0, noForecast: 0 };
    for (const tp of timelineProjects) {
      summary[classifyVariance(tp.varianceDays)]++;
    }

    const response: TimelineResponse = {
      projects: timelineProjects,
      summary,
      lastUpdated: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Forecast timeline API error:", error);
    return NextResponse.json(
      { error: "Failed to compute forecast timeline" },
      { status: 500 },
    );
  }
}
