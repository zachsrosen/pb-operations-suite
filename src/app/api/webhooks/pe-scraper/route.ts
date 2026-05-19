import { NextRequest, NextResponse } from "next/server";
import {
  parsePeScraperReport,
  syncPeDocStatuses,
  buildPeDealMap,
} from "@/lib/pe-scraper-sync";

/**
 * POST /api/webhooks/pe-scraper
 *
 * Receives PE portal scraper HTML and syncs document statuses.
 * The external scraper POSTs the full HTML report body after each run
 * (currently 9am + 4pm EST).
 *
 * Auth: Bearer token must match API_SECRET_TOKEN env var.
 *
 * Request body: raw HTML string (Content-Type: text/html)
 *   OR JSON { html: string }
 */
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const secret = process.env.API_SECRET_TOKEN;
  if (!secret) {
    return NextResponse.json({ error: "API_SECRET_TOKEN not configured" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let html: string;

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      html = await req.text();
    } else {
      const body = await req.json();
      html = body.html;
    }

    if (!html || html.length < 100) {
      return NextResponse.json(
        { error: "HTML body is empty or too small", length: html?.length ?? 0 },
        { status: 400 },
      );
    }

    const { projects, parseErrors } = parsePeScraperReport(html);
    if (projects.length === 0) {
      console.warn("[pe-scraper-webhook] No projects parsed", { parseErrors });
      return NextResponse.json({ error: "No projects parsed", parseErrors }, { status: 422 });
    }

    const dealMap = await buildPeDealMap();
    const result = await syncPeDocStatuses(projects, dealMap);

    console.warn(
      `[pe-scraper-webhook] ${result.projectsMatched}/${result.projectsFound} matched, ` +
      `${result.docsUpserted} upserted (${result.docsNew} new, ${result.docsChanged} changed), ` +
      `${result.errors.length} errors`,
    );

    if (result.changes.length > 0) {
      for (const c of result.changes) {
        console.warn(
          `[pe-scraper-webhook] CHANGED ${c.dealId} | ${c.docName}: ${c.oldStatus} → ${c.newStatus}`,
        );
      }
    }

    return NextResponse.json({
      ...result,
      parseErrors,
      dealMapSize: dealMap.size,
      syncedAt: new Date().toISOString(),
      syncedBy: "webhook/pe-scraper",
    });
  } catch (err) {
    console.error("[pe-scraper-webhook] Error:", err);
    return NextResponse.json(
      { error: "Sync failed", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
