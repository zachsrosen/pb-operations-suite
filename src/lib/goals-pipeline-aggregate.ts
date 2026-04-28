// src/lib/goals-pipeline-aggregate.ts

/**
 * Aggregation helpers for combining per-canonical goals-pipeline data into
 * a single dashboard-group view (e.g. California = SLO + Camarillo).
 *
 * Used by:
 *   - /api/office-performance/goals-pipeline/[location] for combined groups
 *   - /api/office-performance/goals-pipeline/all for the all-locations rollup
 */

import {
  PIPELINE_STAGES,
  type GoalsPipelineData,
} from "@/lib/goals-pipeline-types";

export function sumGoalRows(
  rows: Array<GoalsPipelineData["goals"]>,
  dayOfMonth: number,
  daysInMonth: number
): GoalsPipelineData["goals"] {
  const sum = (key: keyof GoalsPipelineData["goals"]) => {
    let totalCurrent = 0;
    let totalTarget = 0;
    for (const r of rows) {
      totalCurrent += r[key].current;
      totalTarget += r[key].target;
    }
    const percent = totalTarget > 0
      ? Math.min(Math.round((totalCurrent / totalTarget) * 100), 999)
      : 0;
    const elapsedPercent = dayOfMonth / daysInMonth;
    const progressPercent = totalTarget > 0 ? totalCurrent / totalTarget : 1;
    const paceRatio = elapsedPercent > 0 ? progressPercent / elapsedPercent : 1;
    const color = paceRatio >= 1.0 ? "green" as const : paceRatio >= 0.75 ? "yellow" as const : "red" as const;
    return { current: totalCurrent, target: totalTarget, percent, color };
  };

  return {
    sales: sum("sales"),
    da: sum("da"),
    cc: sum("cc"),
    inspections: sum("inspections"),
    reviews: sum("reviews"),
  };
}

export function sumPipeline(
  pipelines: Array<GoalsPipelineData["pipeline"]>
): GoalsPipelineData["pipeline"] {
  const stages = PIPELINE_STAGES.map((def, i) => {
    let count = 0;
    let currency = 0;
    for (const p of pipelines) {
      if (p.stages[i]) {
        count += p.stages[i].count;
        currency += p.stages[i].currency;
      }
    }
    return { label: def.label, count, currency, color: def.color };
  });

  let activePipelineTotal = 0;
  let monthlySales = 0;
  let monthlySalesCount = 0;
  for (const p of pipelines) {
    activePipelineTotal += p.activePipelineTotal;
    monthlySales += p.monthlySales;
    monthlySalesCount += p.monthlySalesCount;
  }

  return { stages, activePipelineTotal, monthlySales, monthlySalesCount };
}

/**
 * Combine multiple per-canonical GoalsPipelineData into one labeled with the group's display name.
 */
export function combineGoalsPipelineData(
  groupLabel: string,
  parts: GoalsPipelineData[]
): GoalsPipelineData {
  if (parts.length === 0) {
    throw new Error("combineGoalsPipelineData: parts cannot be empty");
  }
  if (parts.length === 1) {
    return { ...parts[0], location: groupLabel };
  }
  const ref = parts[0];
  // Use the freshest lastUpdated across the merged parts.
  const lastUpdated = parts
    .map((p) => p.lastUpdated)
    .sort()
    .reverse()[0];
  return {
    location: groupLabel,
    month: ref.month,
    year: ref.year,
    daysInMonth: ref.daysInMonth,
    dayOfMonth: ref.dayOfMonth,
    goals: sumGoalRows(parts.map((p) => p.goals), ref.dayOfMonth, ref.daysInMonth),
    pipeline: sumPipeline(parts.map((p) => p.pipeline)),
    lastUpdated,
  };
}
