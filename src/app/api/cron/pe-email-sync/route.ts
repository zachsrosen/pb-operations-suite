/**
 * PE Email Sync Cron
 *
 * Runs every 30 minutes. Fetches PE notification emails from
 * tpo@photonbrothers.com, parses document status changes, and
 * upserts them into PeDocumentReview.
 *
 * Complements the full portal scrape with near-real-time deltas.
 */

import { NextRequest, NextResponse } from "next/server";
import { syncPeEmailStatuses } from "@/lib/pe-email-sync";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncPeEmailStatuses();

    console.log(
      `[pe-email-sync] cron complete: ${result.emailsFetched} fetched, ${result.parsed} parsed, ${result.matched} matched, ${result.upserted} upserted, ${result.skipped} skipped, ${result.errors} errors${result.gmailError ? `, gmail error: ${result.gmailError}` : ""}`,
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error("[pe-email-sync] cron error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
