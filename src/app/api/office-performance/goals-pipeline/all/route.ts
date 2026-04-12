// src/app/api/office-performance/goals-pipeline/all/route.ts

/**
 * Aggregates goals + pipeline data across all 5 locations for the
 * company-wide goals carousel slide on the all-locations TV page.
 *
 * Strategy: read per-location goals-pipeline caches first, then fetch
 * any uncached locations sequentially (same pattern as /api/office-performance/all).
 */

import { NextRequest, NextResponse } from "next/server";
import { CANONICAL_LOCATIONS, CANONICAL_TO_LOCATION_SLUG } from "@/lib/locations";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { getGoalsPipelineData } from "@/lib/goals-pipeline";
import type { GoalsPipelineData } from "@/lib/goals-pipeline-types";
import { PIPELINE_STAGES } from "@/lib/goals-pipeline-types";

export interface AllGoalsPipelineResponse {
  month: number;
  year: number;
  daysInMonth: number;
  dayOfMonth: number;
  goals: GoalsPipelineData["goals"];
  pipeline: GoalsPipelineData["pipeline"];
  /** Per-location goal rows for the breakdown view */
  perLocation: Array<{
    location: string;
    goals: GoalsPipelineData["goals"];
  }>;
  lastUpdated: string;
}

function sumGoalRows(
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
    // Compute pace color
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

function sumPipeline(
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

export async function GET(request: NextRequest) {
  try {
    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";
    const cacheKey = CACHE_KEYS.GOALS_PIPELINE("all");

    const { data, cached, stale, lastUpdated } =
      await appCache.getOrFetch<AllGoalsPipelineResponse>(
        cacheKey,
        async () => {
          const perLocationData: GoalsPipelineData[] = [];

          // Read from per-location caches first
          const uncached: string[] = [];
          for (const loc of CANONICAL_LOCATIONS) {
            const slug = CANONICAL_TO_LOCATION_SLUG[loc];
            const locCacheKey = CACHE_KEYS.GOALS_PIPELINE(slug);
            const entry = appCache.get<GoalsPipelineData>(locCacheKey);
            if (entry.hit && entry.data) {
              perLocationData.push(entry.data);
            } else {
              uncached.push(loc);
            }
          }

          // Fetch uncached locations sequentially to avoid rate-limit storms
          for (const loc of uncached) {
            try {
              const data = await getGoalsPipelineData(loc);
              perLocationData.push(data);
            } catch (err) {
              console.error(`[goals-pipeline/all] Failed to fetch ${loc}:`, err);
            }
          }

          // Use temporal values from first available location (all same month/day)
          const ref = perLocationData[0];
          const month = ref?.month ?? new Date().getMonth() + 1;
          const year = ref?.year ?? new Date().getFullYear();
          const daysInMonth = ref?.daysInMonth ?? new Date(year, month, 0).getDate();
          const dayOfMonth = ref?.dayOfMonth ?? new Date().getDate();

          const allGoals = perLocationData.map((d) => d.goals);
          const allPipelines = perLocationData.map((d) => d.pipeline);

          return {
            month,
            year,
            daysInMonth,
            dayOfMonth,
            goals: sumGoalRows(allGoals, dayOfMonth, daysInMonth),
            pipeline: sumPipeline(allPipelines),
            perLocation: perLocationData.map((d) => ({
              location: d.location,
              goals: d.goals,
            })),
            lastUpdated: new Date().toISOString(),
          };
        },
        forceRefresh
      );

    return NextResponse.json({ ...data, cached, stale, lastUpdated });
  } catch (error) {
    console.error("[goals-pipeline/all] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch aggregated goals/pipeline data" },
      { status: 500 }
    );
  }
}
