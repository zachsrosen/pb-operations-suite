import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { requireApiAuth } from "@/lib/api-auth";
import { fetchAllProjects, type Project } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { buildProjectFunnelData } from "@/lib/project-funnel-aggregation";

// Cold-cache loads must fetch all ~6,500 deals to populate the shared
// PROJECTS_ALL cache — the same expensive fetch office-performance/all does.
// It needs the matching 300s budget; the default 60s 504s on a cold cache.
export const maxDuration = 300;

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

    const pms = (searchParams.get("pms") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const owners = (searchParams.get("owners") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const filters = pms.length > 0 || owners.length > 0 ? { projectManagers: pms, dealOwners: owners } : undefined;

    // scope=active → snapshot of all currently-active deals, ignoring the date window.
    const scope = searchParams.get("scope") === "active" ? "active" : "cohort";

    // Cache only the expensive, filter-independent project fetch (~6,500 deals)
    // under the shared PROJECTS_ALL key that other metrics routes already warm.
    // All filters (location / PM / owner / timeframe) are applied in-memory by
    // buildProjectFunnelData on each request, so changing a filter is cheap and
    // never triggers a fresh HubSpot fetch. Previously the cache key included
    // the filters, so every filter change forced a live fetch of all deals,
    // which exceeded the serverless timeout (504 → "page not work").
    const { data: projects, cached, stale, lastUpdated } = await appCache.getOrFetch<Project[]>(
      CACHE_KEYS.PROJECTS_ALL,
      () => fetchAllProjects({ activeOnly: false })
    );

    const data = buildProjectFunnelData(
      projects || [],
      months,
      locations.length > 0 ? locations : undefined,
      range,
      filters,
      { scope }
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
