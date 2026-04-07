import { NextRequest, NextResponse } from "next/server";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { LOCATION_SLUG_TO_CANONICAL } from "@/lib/locations";
import { getOfficePerformanceData } from "@/lib/office-performance";
import type { OfficePerformanceData } from "@/lib/office-performance-types";

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
    const cacheKey = CACHE_KEYS.OFFICE_PERFORMANCE(slug);

    const { data, cached, stale, lastUpdated } =
      await appCache.getOrFetch<OfficePerformanceData>(
        cacheKey,
        () => getOfficePerformanceData(canonicalLocation),
        forceRefresh
      );

    return NextResponse.json({
      ...data,
      cached,
      stale,
      lastUpdated,
    });
  } catch (error) {
    console.error("[office-performance] API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch office performance data" },
      { status: 500 }
    );
  }
}
