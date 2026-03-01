import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { requireApiAuth } from "@/lib/api-auth";
import {
  fetchAllAHJs,
  fetchAHJsForDeal,
} from "@/lib/hubspot-custom-objects";

export const runtime = "nodejs";

/**
 * GET /api/ahj
 *
 * Query params:
 *   ?dealId=<id>  — return AHJs associated with a specific deal
 *   (none)        — return all AHJ records
 */
export async function GET(request: NextRequest) {
  tagSentryRequest(request);

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const dealId = searchParams.get("dealId");

  try {
    const ahjs = dealId
      ? await fetchAHJsForDeal(dealId)
      : await fetchAllAHJs();

    return NextResponse.json({
      ahjs,
      count: ahjs.length,
      lastUpdated: new Date().toISOString(),
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
