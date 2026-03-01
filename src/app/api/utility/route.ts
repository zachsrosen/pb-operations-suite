import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { requireApiAuth } from "@/lib/api-auth";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import {
  fetchAllUtilities,
  fetchUtilitiesForDeal,
  UtilityRecord,
} from "@/lib/hubspot-custom-objects";

export const runtime = "nodejs";

/**
 * GET /api/utility
 *
 * Query params:
 *   ?dealId=<id>   — return Utilities associated with a specific deal
 *   ?refresh=true  — bypass cache and fetch fresh data
 *   (none)         — return all Utility records (cached)
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
      const utilities = await fetchUtilitiesForDeal(dealId);
      return NextResponse.json({
        utilities,
        count: utilities.length,
        cached: false,
        lastUpdated: new Date().toISOString(),
      });
    }

    // Full list uses shared cache with stale-while-revalidate + request coalescing
    const { data: utilities, cached, stale, lastUpdated } =
      await appCache.getOrFetch<UtilityRecord[]>(
        CACHE_KEYS.UTILITIES_ALL,
        fetchAllUtilities,
        forceRefresh,
      );

    return NextResponse.json({
      utilities,
      count: utilities.length,
      cached,
      stale,
      lastUpdated,
    });
  } catch (error) {
    console.error("[API /utility] Error fetching Utilities:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to fetch Utility data" },
      { status: 500 }
    );
  }
}
