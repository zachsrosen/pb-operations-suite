// src/lib/goals-pipeline-types.ts

/**
 * Types for the Goals & Pipeline carousel slides.
 *
 * Kept separate from office-performance-types.ts because
 * these slides use a different API route and data source.
 */

export type PaceColor = "green" | "yellow" | "red";

export interface GoalRow {
  /** Current revenue earned (dollars) or review count */
  current: number;
  /** Target from OfficeGoal table or default */
  target: number;
  /** current / target * 100, clamped to [0, 999] */
  percent: number;
  /** Pacing color based on pace vs. elapsed month */
  color: PaceColor;
}

export interface PipelineStageData {
  /** Display label: "Survey", "Design", "P&I", "RTB", "Blocked", "Install", "Inspect", "PTO" */
  label: string;
  /** Number of deals currently in this stage */
  count: number;
  /** Total dollar value of deals in this stage */
  currency: number;
  /** Hex color for the bar */
  color: string;
}

export interface GoalsPipelineData {
  location: string;
  /** 1–12 */
  month: number;
  year: number;
  daysInMonth: number;
  dayOfMonth: number;

  goals: {
    sales: GoalRow;
    da: GoalRow;
    cc: GoalRow;
    inspections: GoalRow;
    reviews: GoalRow;
  };

  pipeline: {
    stages: PipelineStageData[];
    /** Revenue from deals closed this month */
    monthlySales: number;
    /** Count of deals closed this month */
    monthlySalesCount: number;
    /** Sum of currency across all active stages */
    activePipelineTotal: number;
  };

  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** HubSpot Location custom object IDs keyed by canonical location name */
export const HUBSPOT_LOCATION_IDS: Record<string, string> = {
  Westminster: "35157882011",
  Centennial: "35214810442",
  "Colorado Springs": "35236484623",
  "San Luis Obispo": "35287130735",
  Camarillo: "35287501484",
};

/** Metric keys stored in the OfficeGoal Prisma model */
export const GOAL_METRICS = [
  "sales_revenue",
  "da_revenue",
  "cc_revenue",
  "inspection_revenue",
  "five_star_reviews",
] as const;

export type GoalMetric = (typeof GOAL_METRICS)[number];

/** Default monthly targets when no OfficeGoal record exists */
export const DEFAULT_TARGETS: Record<string, Record<GoalMetric, number>> = {
  Westminster:        { sales_revenue: 1_100_000, da_revenue: 1_100_000, cc_revenue: 1_100_000, inspection_revenue: 1_100_000, five_star_reviews: 15 },
  Centennial:         { sales_revenue: 1_100_000, da_revenue: 1_100_000, cc_revenue: 1_100_000, inspection_revenue: 1_100_000, five_star_reviews: 15 },
  "Colorado Springs": { sales_revenue: 300_000,   da_revenue: 300_000,   cc_revenue: 300_000,   inspection_revenue: 300_000,   five_star_reviews: 10 },
  "San Luis Obispo":  { sales_revenue: 500_000,   da_revenue: 500_000,   cc_revenue: 500_000,   inspection_revenue: 500_000,   five_star_reviews: 10 },
  Camarillo:          { sales_revenue: 500_000,   da_revenue: 500_000,   cc_revenue: 500_000,   inspection_revenue: 500_000,   five_star_reviews: 10 },
};

/** Pipeline bar chart stage definitions: property names on the Location custom object */
export const PIPELINE_STAGES = [
  { label: "Survey",  countProp: "deals_in_site_survey_stage", currencyProp: "currency_in_site_survey",                    color: "#3b82f6" },
  { label: "Design",  countProp: "deals_in_design_stage",      currencyProp: "currency_in_design__engineering",             color: "#8b5cf6" },
  { label: "P&I",     countProp: "deals_in_p_i_stage",         currencyProp: "currency_in_permitting__interconnection",     color: "#ec4899" },
  { label: "RTB",     countProp: "deals_in_rtb",               currencyProp: "currency_in_rtb",                             color: "#eab308" },
  { label: "Blocked", countProp: "deals_in_rtb_blocked",       currencyProp: "currency_in_rtb__blocked",                    color: "#f97316" },
  { label: "Install", countProp: "deals_in_construction",      currencyProp: "currency_in_construction",                    color: "#22c55e" },
  { label: "Inspect", countProp: "deals_in_inspection_stage",  currencyProp: "currency_in_inspections",                     color: "#06b6d4" },
  { label: "PTO",     countProp: "deals_in_pto_stage",         currencyProp: "currency_in_pto",                             color: "#10b981" },
] as const;
