import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { requireApiAuth } from "@/lib/api-auth";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import {
  fetchAllAHJs,
  fetchAHJsForDeal,
  AHJRecord,
} from "@/lib/hubspot-custom-objects";

export const runtime = "nodejs";

/**
 * GET /api/ahj
 *
 * Query params:
 *   ?dealId=<id>   — return AHJs associated with a specific deal
 *   ?refresh=true  — bypass cache and fetch fresh data
 *   (none)         — return all AHJ records (cached)
 */
export async function GET(request: NextRequest) {
  tagSentryRequest(request);

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const dealId = searchParams.get("dealId");
  const forceRefresh = searchParams.get("refresh") === "true";

  try {
    // Per-deal lookups are lightweight (1:1 cardinality) — no caching needed
    if (dealId) {
      const ahjs = await fetchAHJsForDeal(dealId);
      return NextResponse.json({
        ahjs,
        count: ahjs.length,
        cached: false,
        lastUpdated: new Date().toISOString(),
      });
    }

    // Full list uses shared cache with stale-while-revalidate + request coalescing
    const { data: ahjs, cached, stale, lastUpdated } =
      await appCache.getOrFetch<AHJRecord[]>(
        CACHE_KEYS.AHJS_ALL,
        fetchAllAHJs,
        forceRefresh,
      );

    return NextResponse.json({
      ahjs,
      count: ahjs.length,
      cached,
      stale,
      lastUpdated,
    });
  } catch (error) {
    console.error("[API /ahj] Error fetching AHJs:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to fetch AHJ data" },
      { status: 500 }
    );
  }
}
