/**
 * PE Portal CSV Import API
 *
 * POST — Import a CSV export from the PE portal to supplement scraper data.
 *   Accepts: { csv: string } — raw CSV text content
 *
 *   The PE portal CSV export contains project-level summary data (overall
 *   Doc Review Status, milestone, financials) but NOT per-document detail.
 *   This import fills gaps for projects the scraper misses — particularly
 *   the ~42 projects with "No milestone data" in the scraper report.
 *
 *   Projects that already have scraper doc data are skipped (scraper is
 *   more granular). Only projects with no scraper data get a synthetic
 *   "Portal Summary (CSV)" doc review row.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import {
  parsePePortalCsv,
  syncPeCsvStatuses,
  buildPeDealMap,
} from "@/lib/pe-scraper-sync";

export const maxDuration = 60;

const ALLOWED_ROLES = ["ADMIN", "EXECUTIVE", "ACCOUNTING", "OWNER"];

// ---------------------------------------------------------------------------
// POST — Import CSV
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.roles.some((r: string) => ALLOWED_ROLES.includes(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { csv } = body as { csv?: string };

    if (!csv || typeof csv !== "string") {
      return NextResponse.json(
        { error: "Provide 'csv' (raw CSV text from PE portal export)" },
        { status: 400 },
      );
    }

    // 1. Parse the CSV
    const { projects, parseErrors } = parsePePortalCsv(csv);

    if (projects.length === 0) {
      return NextResponse.json(
        {
          error: "No projects parsed from CSV",
          parseErrors,
          csvLength: csv.length,
        },
        { status: 422 },
      );
    }

    // 2. Build deal name → deal ID map from HubSpot
    const dealMap = await buildPeDealMap();

    // 3. Sync to database
    const result = await syncPeCsvStatuses(projects, dealMap);

    console.log(
      `[pe-csv-import] ${user.email} imported: ${result.projectsMatched}/${result.projectsFound} matched, ${result.projectsUpdated} updated, ${result.projectsSkippedHasScraperData} skipped (has scraper data), ${result.errors.length} errors`,
    );

    return NextResponse.json({
      ...result,
      parseErrors,
      dealMapSize: dealMap.size,
      importedAt: new Date().toISOString(),
      importedBy: user.email,
    });
  } catch (err) {
    console.error("[pe-csv-import] Error:", err);
    return NextResponse.json(
      {
        error: "CSV import failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
