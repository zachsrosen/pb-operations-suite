import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { requireApiAuth } from "@/lib/api-auth";
import { syncFromPeApi, getLatestSyncRun } from "@/lib/pe-api-sync";

/**
 * POST /api/deals/pe-sync
 *
 * Trigger a PE Raceway API sync. Replaces the HTML scraper with direct API calls.
 * Syncs document statuses into PeDocumentReview and action items into PeActionItem.
 *
 * Auth: CRON_SECRET bearer token (for Vercel cron) OR authenticated admin session.
 *
 * Query params:
 *   ?skipActionItems=true  — skip detail fetches, doc-only sync (faster)
 */
export async function POST(request: NextRequest) {
  tagSentryRequest(request);

  // Auth: accept CRON_SECRET or admin session
  const authHeader = request.headers.get("authorization");
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isCron) {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    // Only admins/owners can trigger manual sync
    const { roles } = authResult;
    if (!roles.includes("ADMIN") && !roles.includes("OWNER")) {
      return NextResponse.json(
        { error: "Admin or Owner role required" },
        { status: 403 },
      );
    }
  }

  // Check PE_API_KEY is configured
  if (!process.env.PE_API_KEY) {
    return NextResponse.json(
      { error: "PE_API_KEY not configured" },
      { status: 500 },
    );
  }

  const skipActionItems =
    request.nextUrl.searchParams.get("skipActionItems") === "true";

  try {
    const result = await syncFromPeApi({ skipActionItems });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("[pe-sync] Sync failed:", error);
    Sentry.captureException(error);
    const message = error instanceof Error ? error.message : String(error);

    return NextResponse.json(
      { success: false, error: "PE API sync failed", details: message },
      { status: 500 },
    );
  }
}

/**
 * GET /api/deals/pe-sync
 *
 * Returns the latest sync run status. Useful for checking if a sync
 * is in progress or seeing the last result.
 */
export async function GET(request: NextRequest) {
  tagSentryRequest(request);

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  try {
    const latestRun = await getLatestSyncRun();
    return NextResponse.json({
      success: true,
      latestRun,
    });
  } catch (error) {
    console.error("[pe-sync] Failed to fetch sync status:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to fetch sync status" },
      { status: 500 },
    );
  }
}
