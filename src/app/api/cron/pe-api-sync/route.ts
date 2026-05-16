import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/pe-api-sync
 *
 * DISABLED — PE API sync replaced by GCS HTML scraper as sole data source.
 * Cron schedule removed from vercel.json. Route kept for reference.
 */
export async function GET(_request: NextRequest) {
  return NextResponse.json({
    skipped: true,
    reason: "PE API sync disabled — using GCS scraper reports only",
  });
}
