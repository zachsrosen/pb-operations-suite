import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { requireApiAuth } from "@/lib/api-auth";
import { fetchAllProjects, type Project } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { buildDesignFunnelData } from "@/lib/design-funnel-aggregation";

// Cold-cache loads fetch all ~6,500 deals into the shared PROJECTS_ALL cache,
// the same expensive fetch the project funnel uses — needs the 300s budget.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  tagSentryRequest(request);
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    const searchParams = request.nextUrl.searchParams;
    const locationParam = searchParams.get("locations") || "";
    const locations = locationParam ? locationParam.split(",").filter(Boolean) : [];

    const leads = (searchParams.get("leads") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const pms = (searchParams.get("pms") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const filters = leads.length > 0 || pms.length > 0 ? { designLeads: leads, projectManagers: pms } : undefined;
    const peParam = searchParams.get("pe");
    const pe = peParam === "pe" || peParam === "non-pe" ? peParam : "all";
    const includeOnHold = searchParams.get("onhold") !== "0";

    const { data: projects, cached, stale, lastUpdated } = await appCache.getOrFetch<Project[]>(
      CACHE_KEYS.PROJECTS_ALL,
      () => fetchAllProjects({ activeOnly: false })
    );

    const data = buildDesignFunnelData(
      projects || [],
      locations.length > 0 ? locations : undefined,
      filters,
      { pe, includeOnHold }
    );

    return NextResponse.json({ ...data, cached, stale, lastUpdated });
  } catch (error) {
    console.error("Error fetching design funnel data:", error);
    Sentry.captureException(error);
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("429") || message.includes("RATE_LIMIT")) {
      return NextResponse.json(
        { error: "HubSpot API rate limited. Please try again shortly.", details: message },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch design funnel data", details: message },
      { status: 500 }
    );
  }
}
