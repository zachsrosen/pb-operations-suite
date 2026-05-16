/**
 * PE Email Sync Cron
 *
 * DISABLED — produced 1 row total. Using GCS scraper reports as sole PE data source.
 * Cron schedule removed from vercel.json.
 */

import { NextRequest, NextResponse } from "next/server";

export async function GET(_request: NextRequest) {
  return NextResponse.json({
    skipped: true,
    reason: "PE email sync disabled — using GCS scraper reports only",
  });
}
