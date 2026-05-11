/**
 * PE Document Scraper Sync API
 *
 * POST — Trigger a sync from the PE portal scraper HTML report.
 *   Accepts either:
 *     { url: string }  — GCS signed URL to fetch HTML from
 *     { html: string } — Raw HTML content pushed directly
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
import { searchWithRetry } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { PIPELINE_IDS } from "@/lib/deals-pipeline";
import {
  parsePeScraperReport,
  syncPeDocStatuses,
  fetchPeScraperReport,
} from "@/lib/pe-scraper-sync";

// Extend serverless function timeout — the full sync (342 projects × 14 docs
// = ~4800 sequential upserts + GCS fetch + HubSpot deal map) needs > 60s.
export const maxDuration = 120;

const ALLOWED_ROLES = ["ADMIN", "EXECUTIVE", "ACCOUNTING", "OWNER"];

// ---------------------------------------------------------------------------
// HubSpot PE deal lookup — builds a name→dealId map
// ---------------------------------------------------------------------------

async function buildPeDealMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const pipelineId = PIPELINE_IDS.project;
  if (!pipelineId) return map;

  let after: string | undefined;
  do {
    const searchRequest = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "pipeline",
              operator: FilterOperatorEnum.Eq,
              value: pipelineId,
            },
            {
              propertyName: "tags",
              operator: FilterOperatorEnum.ContainsToken,
              value: "Participate Energy",
            },
          ],
        },
      ],
      properties: ["hs_object_id", "dealname"],
      sorts: [
        { propertyName: "dealname", direction: "ASCENDING" },
      ] as unknown as string[],
      limit: 100,
      ...(after ? { after } : {}),
    } as any;

    const response = await searchWithRetry(searchRequest);

    for (const deal of response.results) {
      const id = String(deal.properties.hs_object_id);
      const name = String(deal.properties.dealname || "");
      if (id && name) {
        map.set(name.toLowerCase().trim(), id);
      }
    }

    after = response.paging?.next?.after;
  } while (after);

  return map;
}

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
    const { url, html: rawHtml } = body as {
      url?: string;
      html?: string;
    };

    if (!url && !rawHtml) {
      return NextResponse.json(
        { error: "Provide either 'url' (GCS signed URL) or 'html' (raw HTML content)" },
        { status: 400 },
      );
    }

    // 1. Get the HTML content
    let html: string;
    if (rawHtml) {
      html = rawHtml;
    } else {
      html = await fetchPeScraperReport(url!);
    }

    // 2. Parse the HTML report
    const { projects, parseErrors } = parsePeScraperReport(html);

    if (projects.length === 0) {
      return NextResponse.json(
        {
          error: "No projects parsed from HTML report",
          parseErrors,
          htmlLength: html.length,
        },
        { status: 422 },
      );
    }

    // 3. Build deal name → deal ID map from HubSpot
    const dealMap = await buildPeDealMap();

    // 4. Sync to database
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
