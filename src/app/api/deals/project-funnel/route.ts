import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { requireApiAuth } from "@/lib/api-auth";
import { fetchAllProjects } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { buildProjectFunnelData } from "@/lib/project-funnel-aggregation";

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

    // Optional explicit calendar window (YYYY-MM-DD). Only honored when both
    // bounds are present and well-formed; otherwise fall back to the rolling
    // `months` lookback.
    const startParam = searchParams.get("start") || "";
    const endParam = searchParams.get("end") || "";
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const range =
      dateRe.test(startParam) && dateRe.test(endParam)
        ? { start: startParam, end: endParam }
        : undefined;

    const cacheKey = CACHE_KEYS.PROJECT_FUNNEL(
      months,
      cacheLocation,
      range ? `${range.start}_${range.end}` : "rolling"
    );

    const { data, cached, stale, lastUpdated } = await appCache.getOrFetch(
      cacheKey,
      async () => {
        const projects = await fetchAllProjects({ activeOnly: false });
        return buildProjectFunnelData(
          projects,
          months,
          locations.length > 0 ? locations : undefined,
          range
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
    console.error("Error fetching project funnel data:", error);
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
      { error: "Failed to fetch project funnel data", details: message },
      { status: 500 }
    );
  }
}
