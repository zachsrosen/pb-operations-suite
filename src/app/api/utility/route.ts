import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { requireApiAuth } from "@/lib/api-auth";
import {
  fetchAllUtilities,
  fetchUtilitiesForDeal,
} from "@/lib/hubspot-custom-objects";

export const runtime = "nodejs";

/**
 * GET /api/utility
 *
 * Query params:
 *   ?dealId=<id>  — return Utilities associated with a specific deal
 *   (none)        — return all Utility records
 */
export async function GET(request: NextRequest) {
  tagSentryRequest(request);

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const dealId = searchParams.get("dealId");

  try {
    const utilities = dealId
      ? await fetchUtilitiesForDeal(dealId)
      : await fetchAllUtilities();

    return NextResponse.json({
      utilities,
      count: utilities.length,
      lastUpdated: new Date().toISOString(),
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
