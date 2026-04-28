// src/app/api/office-performance/goals-pipeline/[location]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { resolveDashboardGroup } from "@/lib/dashboard-location-groups";
import { getGoalsPipelineData } from "@/lib/goals-pipeline";
import { combineGoalsPipelineData } from "@/lib/goals-pipeline-aggregate";
import type { GoalsPipelineData } from "@/lib/goals-pipeline-types";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ location: string }> }
) {
  try {
    const { location: rawSlug } = await params;
    // resolveDashboardGroup handles legacy slug aliasing (san-luis-obispo, camarillo → california).
    const group = resolveDashboardGroup(rawSlug);

    if (!group) {
      return NextResponse.json(
        { error: `Unknown location: ${rawSlug}` },
        { status: 404 }
      );
    }

    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";
    // Cache by canonical group slug so legacy slugs share state with the combined group.
    const cacheKey = CACHE_KEYS.GOALS_PIPELINE(group.slug);

    const { data, cached, stale, lastUpdated } =
      await appCache.getOrFetch<GoalsPipelineData>(
        cacheKey,
        async () => {
          // Single-canonical groups: pass through. Combined groups (California): fetch
          // each canonical sequentially to avoid HubSpot 429s, then aggregate.
          if (group.canonicals.length === 1) {
            const result = await getGoalsPipelineData(group.canonicals[0]);
            return { ...result, location: group.label };
          }
          const parts: GoalsPipelineData[] = [];
          for (const canonical of group.canonicals) {
            parts.push(await getGoalsPipelineData(canonical));
          }
          return combineGoalsPipelineData(group.label, parts);
        },
        forceRefresh
      );

    return NextResponse.json({
      ...data,
      cached,
      stale,
      lastUpdated,
    });
  } catch (error) {
    console.error("[goals-pipeline] API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch goals/pipeline data" },
      { status: 500 }
    );
  }
}
