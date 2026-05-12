/**
 * Transforms raw GoalsPipelineData into per-office email props
 * for the GoalsWeeklyDigest template.
 *
 * Returns one set of props per dashboard location group (4 offices).
 */

import type { GoalsPipelineData, GoalRow } from "@/lib/goals-pipeline-types";
import { DASHBOARD_LOCATION_GROUPS } from "@/lib/dashboard-location-groups";
import { sumGoalRows } from "@/lib/goals-pipeline-aggregate";
import type {
  GoalLineItem,
  GoalsWeeklyDigestProps,
  OfficeBreakdown,
} from "@/emails/GoalsWeeklyDigest";

// ---------------------------------------------------------------------------
// Goal key → email label mapping (matches the dashboard DEPARTMENTS order)
// ---------------------------------------------------------------------------

interface GoalDef {
  key: keyof GoalsPipelineData["goals"];
  label: string;
  format: "currency" | "count";
}

const GOAL_DEFS: GoalDef[] = [
  { key: "sales",       label: "Sales Closed",             format: "currency" },
  { key: "surveys",     label: "Surveys Completed",        format: "currency" },
  { key: "da",          label: "Design Approvals",         format: "currency" },
  { key: "permits",     label: "Permits Issued",           format: "currency" },
  { key: "cc",          label: "Construction Completions", format: "currency" },
  { key: "inspections", label: "Inspections Passed",       format: "currency" },
  { key: "pto",         label: "PTO Granted",              format: "currency" },
  { key: "reviews",     label: "5-Star Reviews",           format: "count"    },
];

// Dashboard slug → office performance URL path
const SLUG_TO_PATH: Record<string, string> = {
  westminster: "westminster",
  centennial: "centennial",
  "colorado-springs": "colorado-springs",
  california: "california",
};

// ---------------------------------------------------------------------------
// Month names
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ---------------------------------------------------------------------------
// Snapshot type: what we store in GoalsDigestSnapshot.goals JSON
// ---------------------------------------------------------------------------

export interface GoalsSnapshotValues {
  sales: number;
  surveys: number;
  da: number;
  permits: number;
  cc: number;
  inspections: number;
  pto: number;
  reviews: number;
}

export function extractSnapshotValues(
  goals: GoalsPipelineData["goals"],
): GoalsSnapshotValues {
  return {
    sales: goals.sales.current,
    surveys: goals.surveys.current,
    da: goals.da.current,
    permits: goals.permits.current,
    cc: goals.cc.current,
    inspections: goals.inspections.current,
    pto: goals.pto.current,
    reviews: goals.reviews.current,
  };
}

// ---------------------------------------------------------------------------
// Build email-ready data
// ---------------------------------------------------------------------------

function rowToLineItem(
  row: GoalRow,
  def: GoalDef,
  priorValues?: GoalsSnapshotValues,
): GoalLineItem {
  const priorVal = priorValues
    ? priorValues[def.key as keyof GoalsSnapshotValues]
    : undefined;
  const weekDelta =
    priorVal !== undefined ? row.current - priorVal : 0;
  const inStretchZone = row.current > row.target && row.stretchTarget > row.target;

  return {
    label: def.label,
    current: row.current,
    baseTarget: row.target,
    stretchTarget: row.stretchTarget,
    percent: row.percent,
    weekDelta,
    pace: row.color,
    inStretchZone,
    format: def.format,
  };
}

/** One result per office, ready to render and send */
export interface PerOfficeDigest {
  /** Dashboard location group slug */
  slug: string;
  /** Display name: "Westminster", "Centennial", etc. */
  label: string;
  /** Props for GoalsWeeklyDigest component */
  props: GoalsWeeklyDigestProps;
}

export function buildPerOfficeDigests(opts: {
  /** Per-canonical-location data (5 locations) */
  perLocationData: GoalsPipelineData[];
  /** Prior week's snapshot per canonical location */
  priorSnapshots: Record<string, GoalsSnapshotValues>;
  /** Prior week's "all" snapshot */
  priorAllSnapshot?: GoalsSnapshotValues;
  /** Base dashboard URL (e.g. https://pbtechops.com) */
  baseUrl: string;
  /** Reference date for the week label */
  referenceDate?: Date;
}): PerOfficeDigest[] {
  const { perLocationData, priorSnapshots, priorAllSnapshot, baseUrl, referenceDate } = opts;

  if (perLocationData.length === 0) {
    throw new Error("buildPerOfficeDigests: no location data provided");
  }

  const ref = perLocationData[0];
  const month = ref.month;
  const year = ref.year;
  const daysInMonth = ref.daysInMonth;
  const dayOfMonth = ref.dayOfMonth;

  // Company-wide rollup for the "context" section in each email
  const allGoalRows = sumGoalRows(
    perLocationData.map((d) => d.goals),
    dayOfMonth,
    daysInMonth,
  );
  const companyGoals: GoalLineItem[] = GOAL_DEFS.map((def) =>
    rowToLineItem(allGoalRows[def.key], def, priorAllSnapshot),
  );

  const refDate = referenceDate ?? new Date();
  const weekLabel = `Week of ${refDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })}`;

  const results: PerOfficeDigest[] = [];

  for (const group of DASHBOARD_LOCATION_GROUPS) {
    const matching = perLocationData.filter((d) =>
      (group.canonicals as readonly string[]).includes(d.location),
    );
    if (matching.length === 0) continue;

    const groupGoals =
      matching.length === 1
        ? matching[0].goals
        : sumGoalRows(
            matching.map((m) => m.goals),
            dayOfMonth,
            daysInMonth,
          );

    // Combine prior snapshots for the matching canonicals
    let groupPrior: GoalsSnapshotValues | undefined;
    const matchingPriors = matching
      .map((m) => priorSnapshots[m.location])
      .filter((p): p is GoalsSnapshotValues => !!p);
    if (matchingPriors.length > 0) {
      groupPrior = {
        sales: matchingPriors.reduce((s, p) => s + p.sales, 0),
        surveys: matchingPriors.reduce((s, p) => s + p.surveys, 0),
        da: matchingPriors.reduce((s, p) => s + p.da, 0),
        permits: matchingPriors.reduce((s, p) => s + p.permits, 0),
        cc: matchingPriors.reduce((s, p) => s + p.cc, 0),
        inspections: matchingPriors.reduce((s, p) => s + p.inspections, 0),
        pto: matchingPriors.reduce((s, p) => s + p.pto, 0),
        reviews: matchingPriors.reduce((s, p) => s + p.reviews, 0),
      };
    }

    const officeGoals: GoalLineItem[] = GOAL_DEFS.map((def) =>
      rowToLineItem(groupGoals[def.key], def, groupPrior),
    );

    const pathSlug = SLUG_TO_PATH[group.slug] || group.slug;
    const dashboardUrl = `${baseUrl}/dashboards/office-performance/${pathSlug}`;

    results.push({
      slug: group.slug,
      label: group.label,
      props: {
        weekLabel,
        dayOfMonth,
        daysInMonth,
        monthName: MONTH_NAMES[month] || "Unknown",
        year,
        officeName: group.label,
        officeGoals,
        companyGoals,
        dashboardUrl,
      },
    });
  }

  // ---- Executive "All Locations" digest ----
  // Uses company-wide rollup as the hero section with per-office breakdowns
  const officeBreakdowns: OfficeBreakdown[] = results.map((r) => ({
    officeName: r.label,
    goals: r.props.officeGoals,
  }));

  results.push({
    slug: "all-locations",
    label: "All Locations",
    props: {
      weekLabel,
      dayOfMonth,
      daysInMonth,
      monthName: MONTH_NAMES[month] || "Unknown",
      year,
      officeName: "All Locations",
      officeGoals: companyGoals,
      companyGoals: [], // empty — hide the company-wide context section
      officeBreakdowns,
      dashboardUrl: `${baseUrl}/dashboards/office-performance`,
    },
  });

  return results;
}
