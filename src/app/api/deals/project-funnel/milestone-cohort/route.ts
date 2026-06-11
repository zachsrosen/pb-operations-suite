import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { requireApiAuth } from "@/lib/api-auth";
import { fetchAllProjects, type Project } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import {
  buildMilestoneCohort,
  PROJECT_FUNNEL_STAGES,
  type ProjectFunnelStageKey,
} from "@/lib/project-funnel-aggregation";

export async function GET(request: NextRequest) {
  tagSentryRequest(request);
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    const searchParams = request.nextUrl.searchParams;

    const milestoneParam = (searchParams.get("milestone") || "surveyDone") as ProjectFunnelStageKey;
    if (!PROJECT_FUNNEL_STAGES.includes(milestoneParam)) {
      return NextResponse.json(
        { error: `Invalid milestone "${milestoneParam}". Expected one of: ${PROJECT_FUNNEL_STAGES.join(", ")}` },
        { status: 400 }
      );
    }

    const startParam = searchParams.get("start") || "";
    const endParam = searchParams.get("end") || "";
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(startParam) || !dateRe.test(endParam)) {
      return NextResponse.json(
        { error: "start and end are required (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const locationParam = searchParams.get("locations") || "";
    const locations = locationParam ? locationParam.split(",").filter(Boolean) : [];
    const pms = (searchParams.get("pms") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const owners = (searchParams.get("owners") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const filters = pms.length > 0 || owners.length > 0 ? { projectManagers: pms, dealOwners: owners } : undefined;

    // Reuse the shared, filter-independent project cache (same one the funnel
    // route warms). Filtering + bucketing is in-memory, so this is cheap.
    const { data: projects, cached, stale, lastUpdated } = await appCache.getOrFetch<Project[]>(
      CACHE_KEYS.PROJECTS_ALL,
      () => fetchAllProjects({ activeOnly: false })
    );

    const data = buildMilestoneCohort(
      projects || [],
      milestoneParam,
      { start: startParam, end: endParam },
      locations.length > 0 ? locations : undefined,
      filters
    );

    return NextResponse.json({ ...data, cached, stale, lastUpdated });
  } catch (error) {
    console.error("Error fetching milestone cohort data:", error);
    Sentry.captureException(error);
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("429") || message.includes("RATE_LIMIT")) {
      return NextResponse.json(
        { error: "HubSpot API rate limited. Please try again shortly.", details: message },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch milestone cohort data", details: message },
      { status: 500 }
    );
  }
}
