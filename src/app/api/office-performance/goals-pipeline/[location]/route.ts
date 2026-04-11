// src/app/api/office-performance/goals-pipeline/[location]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { LOCATION_SLUG_TO_CANONICAL } from "@/lib/locations";
import { getGoalsPipelineData } from "@/lib/goals-pipeline";
import type { GoalsPipelineData } from "@/lib/goals-pipeline-types";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ location: string }> }
) {
  try {
    const { location: slug } = await params;
    const canonicalLocation = LOCATION_SLUG_TO_CANONICAL[slug];

    if (!canonicalLocation) {
      return NextResponse.json(
        { error: `Unknown location: ${slug}` },
        { status: 404 }
      );
    }

    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";
    const cacheKey = CACHE_KEYS.GOALS_PIPELINE(slug);

    const { data, cached, stale, lastUpdated } =
      await appCache.getOrFetch<GoalsPipelineData>(
        cacheKey,
        () => getGoalsPipelineData(canonicalLocation),
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
