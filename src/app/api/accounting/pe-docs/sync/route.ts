/**
 * PE Document Scraper Sync API
 *
 * POST — Trigger a sync from PE portal data.
 *   Accepts one of:
 *     { url: string }     — GCS signed URL to fetch HTML from
 *     { html: string }    — Raw HTML content pushed directly
 *     { compact: string } — Compact format from manual portal scrape
 *                           (projectId|customerName|milestone|docStatusCodes per line)
 *
 *   GCS bucket: gs://photon-brothers-schedules/pe-status-scraper/
 *   Reports (scraper runs twice daily):
 *     - latest_full_report.html        — ALL stages (286+ projects)  ← use this
 *     - latest_pto_closeout_report.html — PTO + Close Out only (59 projects)
 *
 * GET  — Return the last sync metadata (timestamp, counts).
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import {
  parsePeScraperReport,
  parseCompactPeScrape,
  syncPeDocStatuses,
  fetchPeScraperReport,
  buildPeDealMap,
} from "@/lib/pe-scraper-sync";
// import { syncPeEmailStatuses } from "@/lib/pe-email-sync"; // disabled

// Extend serverless function timeout — the full sync (342 projects × 14 docs
// = ~4800 sequential upserts + GCS fetch + HubSpot deal map) needs > 60s.
export const maxDuration = 120;

const ALLOWED_ROLES = ["ADMIN", "EXECUTIVE", "ACCOUNTING", "OWNER"];

// ---------------------------------------------------------------------------
// POST — Trigger sync
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

    // Email sync path — disabled (produced 1 row total, not useful)
    if (body.source === "email") {
      return NextResponse.json({
        skipped: true,
        reason: "PE email sync disabled — using GCS scraper reports only",
      });
    }

    const { url, html: rawHtml, compact } = body as {
      url?: string;
      html?: string;
      compact?: string;
    };

    if (!url && !rawHtml && !compact) {
      return NextResponse.json(
        { error: "Provide 'url' (GCS signed URL), 'html' (raw HTML), or 'compact' (compact scrape format)" },
        { status: 400 },
      );
    }

    let projects: ReturnType<typeof parsePeScraperReport>["projects"];
    let parseErrors: string[];

    if (compact) {
      // Compact format from manual portal scrape
      const result = parseCompactPeScrape(compact);
      projects = result.projects;
      parseErrors = result.parseErrors;
    } else {
      // HTML format from GCS scraper
      let html: string;
      if (rawHtml) {
        html = rawHtml;
      } else {
        html = await fetchPeScraperReport(url!);
      }
      const result = parsePeScraperReport(html);
      projects = result.projects;
      parseErrors = result.parseErrors;
    }

    if (projects.length === 0) {
      return NextResponse.json(
        {
          error: "No projects parsed from report",
          parseErrors,
        },
        { status: 422 },
      );
    }

    // Build deal name → deal ID map from HubSpot
    const dealMap = await buildPeDealMap();

    // Sync to database
    const result = await syncPeDocStatuses(projects, dealMap);

    console.log(
      `[pe-scraper-sync] ${user.email} synced: ${result.projectsMatched}/${result.projectsFound} projects matched, ${result.docsUpserted} docs upserted, ${result.errors.length} errors`,
    );

    return NextResponse.json({
      ...result,
      parseErrors,
      dealMapSize: dealMap.size,
      syncedAt: new Date().toISOString(),
      syncedBy: user.email,
    });
  } catch (err) {
    console.error("[pe-scraper-sync] Error:", err);
    return NextResponse.json(
      {
        error: "Sync failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// GET — Last sync status
// ---------------------------------------------------------------------------

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.roles.some((r: string) => ALLOWED_ROLES.includes(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Get the most recent scraper-synced doc review as a proxy for last sync
    const lastScraperDoc = await prisma.peDocumentReview.findFirst({
      where: { reviewedBy: "pe-scraper-sync" },
      orderBy: { updatedAt: "desc" },
      select: {
        updatedAt: true,
        reviewedBy: true,
      },
    });

    // Count total scraper-synced docs
    const scraperDocCount = await prisma.peDocumentReview.count({
      where: { reviewedBy: "pe-scraper-sync" },
    });

    // Count total docs
    const totalDocCount = await prisma.peDocumentReview.count();

    return NextResponse.json({
      lastSyncAt: lastScraperDoc?.updatedAt?.toISOString() ?? null,
      scraperDocCount,
      totalDocCount,
    });
  } catch (err) {
    console.error("[pe-scraper-sync] Error fetching sync status:", err);
    return NextResponse.json(
      { error: "Failed to fetch sync status" },
      { status: 500 },
    );
  }
}
