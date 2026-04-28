import { NextRequest, NextResponse } from "next/server";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { resolveDashboardGroup } from "@/lib/dashboard-location-groups";
import { getOfficePerformanceData } from "@/lib/office-performance";
import type { OfficePerformanceData } from "@/lib/office-performance-types";
import { complianceVersionTag } from "@/lib/compliance-v2/feature-flag";

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
    // Cache by the canonical group slug so legacy slugs share state with the combined group.
    const cacheKey = `${CACHE_KEYS.OFFICE_PERFORMANCE(group.slug)}:${complianceVersionTag()}`;

    const { data, cached, stale, lastUpdated } =
      await appCache.getOrFetch<OfficePerformanceData>(
        cacheKey,
        () => getOfficePerformanceData(group),
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
