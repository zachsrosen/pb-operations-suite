/**
 * QC-data-driven Forecasting Engine
 *
 * Computes milestone forecasts from historical project completion data,
 * segmented by (location, AHJ, utility) with fallback hierarchy:
 *   1. Full segment (location + AHJ + utility) — min 5 samples
 *   2. Location only — min 5 samples
 *   3. Global — min 3 samples
 *   4. Insufficient data
 *
 * Replaces the old static FORECAST_OFFSETS (closeDate + 90/120/150 days).
 */

import type { Project } from "@/lib/hubspot";
import { fetchAllProjects } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";

// ─── Milestone Chain ───────────────────────────────────────────────

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

// ─── Segment Keys ──────────────────────────────────────────────────

export type SegmentKey = string; // "location|ahj|utility" or "location||" or "global"

function fullSegmentKey(p: Project): SegmentKey {
  return `${p.pbLocation}|${p.ahj}|${p.utility}`;
}

function locationSegmentKey(p: Project): SegmentKey {
  return `${p.pbLocation}||`;
}

const GLOBAL_KEY: SegmentKey = "global";

// ─── Baseline Types ────────────────────────────────────────────────

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

// ─── Forecast Types ────────────────────────────────────────────────

export type ForecastBasis =
  | "segment"
  | "location"
  | "global"
  | "actual"
  | "insufficient";

export interface ForecastedMilestone {
  date: string | null;
  basis: ForecastBasis;
}

export type ForecastSet = Record<MilestoneKey, ForecastedMilestone>;

export interface ProjectForecasts {
  original: ForecastSet;
  live: ForecastSet;
}

// ─── Constants ─────────────────────────────────────────────────────

const MIN_SEGMENT_SAMPLES = 5;
const MIN_GLOBAL_SAMPLES = 3;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

// ─── Helpers ───────────────────────────────────────────────────────

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T12:00:00").getTime() -
      new Date(a + "T12:00:00").getTime()) /
      MS_PER_DAY,
  );
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
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

// ─── Baseline Builder ──────────────────────────────────────────────

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

function buildSegmentEntry(projects: Project[]): BaselineEntry {
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

/**
 * Build the baseline table from completed projects.
 * Groups by full segment (location+AHJ+utility), location-only, and global.
 * Requires minimum sample counts at each level.
 */
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

// ─── Forecast Calculator ───────────────────────────────────────────

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

/**
 * Compute forecast dates for a project using the baseline table.
 * Uses actual dates when milestones are completed, chains from the last
 * known date using segment-appropriate medians for remaining milestones.
 */
export function computeForecast(
  project: Project,
  table: BaselineTable,
): ForecastSet {
  const result = {} as Record<MilestoneKey, ForecastedMilestone>;
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

/**
 * Compute both forecast sets for a project.
 * - `original`: What we'd forecast from closeDate alone (no actuals)
 * - `live`: What we forecast now, using completed milestones as anchors
 */
export function computeProjectForecasts(
  project: Project,
  table: BaselineTable,
): ProjectForecasts {
  // Live forecast uses actual dates where available
  const live = computeForecast(project, table);

  // Original forecast pretends no milestones are completed
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

// ─── Cached Baseline Table ─────────────────────────────────────────

/**
 * Get the cached baseline table, rebuilding from QC data if stale.
 * Fetches ALL projects (including inactive) to maximize historical data.
 * Filters to projects completed in the last 12 months that have
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
          p.constructionCompleteDate, // Must have at least installed
      );

      return buildBaselineTable(completed);
    },
  );
}
