import { NextRequest, NextResponse } from "next/server";
import { tagSentryRequest } from "@/lib/sentry-request";

/**
 * POST /api/deals/pe-sync
 *
 * DISABLED — PE API sync replaced by GCS HTML scraper as sole data source.
 * Use POST /api/accounting/pe-docs/sync with a GCS signed URL instead.
 */
export async function POST(request: NextRequest) {
  tagSentryRequest(request);

  return NextResponse.json({
    skipped: true,
    reason: "PE API sync disabled — use /api/accounting/pe-docs/sync with GCS scraper reports instead",
  });
}

/**
 * GET /api/deals/pe-sync — disabled, returns last known info.
 */
export async function GET(request: NextRequest) {
  tagSentryRequest(request);

  return NextResponse.json({
    skipped: true,
    reason: "PE API sync disabled — using GCS scraper reports only",
  });
}
