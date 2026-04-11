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
