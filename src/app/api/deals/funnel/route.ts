// src/app/api/deals/funnel/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { requireApiAuth } from "@/lib/api-auth";
import { fetchAllProjects } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { buildFunnelData } from "@/lib/funnel-aggregation";

export async function GET(request: NextRequest) {
  tagSentryRequest(request);
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    const searchParams = request.nextUrl.searchParams;
    const months = Math.min(
      24,
      Math.max(1, parseInt(searchParams.get("months") || "6") || 6)
    );
    const locationParam = searchParams.get("locations") || "";
    const locations = locationParam ? locationParam.split(",").filter(Boolean) : [];
    const cacheLocation = locations.length > 0 ? locations.sort().join(",") : "all";

    const cacheKey = CACHE_KEYS.DESIGN_FUNNEL(months, cacheLocation);

    const { data, cached, stale, lastUpdated } = await appCache.getOrFetch(
      cacheKey,
      async () => {
        const projects = await fetchAllProjects({ activeOnly: false });
        return buildFunnelData(
          projects,
          months,
          locations.length > 0 ? locations : undefined
        );
      }
    );

    return NextResponse.json({
      ...data,
      cached,
      stale,
      lastUpdated,
    });
  } catch (error) {
    console.error("Error fetching funnel data:", error);
    Sentry.captureException(error);
    const message =
      error instanceof Error ? error.message : String(error);

    if (message.includes("429") || message.includes("RATE_LIMIT")) {
      return NextResponse.json(
        { error: "HubSpot API rate limited. Please try again shortly.", details: message },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch funnel data", details: message },
      { status: 500 }
    );
  }
}
