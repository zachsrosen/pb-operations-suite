import { NextRequest, NextResponse } from "next/server";
import { syncFromPeApi, getLatestSyncRun } from "@/lib/pe-api-sync";

export const maxDuration = 300;

/**
 * GET /api/cron/pe-api-sync
 *
 * Vercel cron-triggered PE Raceway API sync. Pulls all projects from the PE
 * API, derives document statuses, upserts PeDocumentReview rows, and stores
 * action items (reviewer feedback with error codes + page numbers).
 *
 * Runs daily at 6am UTC (11pm MT). See vercel.json for schedule.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Skip if PE API is not configured
  if (!process.env.PE_API_KEY || !process.env.PE_API_BASE_URL) {
    return NextResponse.json({
      skipped: true,
      reason: "PE_API_KEY or PE_API_BASE_URL not configured",
    });
  }

  try {
    // Support ?full=true to force a full sync (skips incremental)
    const fullSync = request.nextUrl.searchParams.get("full") === "true";

    const result = await syncFromPeApi({ fullSync });
    return NextResponse.json({
      success: true,
      incremental: result.incremental,
      since: result.since,
      projectsFetched: result.projectsFetched,
      projectsMatched: result.projectsMatched,
      docsUpserted: result.docsUpserted,
      actionItemsUpserted: result.actionItemsUpserted,
      durationMs: result.durationMs,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (error) {
    console.error("[pe-api-sync cron] Sync failed:", error);
    const message = error instanceof Error ? error.message : String(error);

    // Return the latest successful run info for context
    let lastRun = null;
    try {
      lastRun = await getLatestSyncRun();
    } catch {
      // ignore
    }

    return NextResponse.json(
      {
        error: "PE API sync failed",
        details: message,
        lastSuccessfulRun: lastRun?.completedAt?.toISOString() ?? null,
      },
      { status: 500 },
    );
  }
}
