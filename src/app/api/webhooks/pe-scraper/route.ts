import { NextRequest, NextResponse } from "next/server";
import {
  parsePeScraperReport,
  syncPeDocStatuses,
  buildPeDealMap,
} from "@/lib/pe-scraper-sync";
import { sendPeDocChangeNotification } from "@/lib/pe-doc-notify";

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
 *
 * RETIRED 2026-06-15: the PE Paddock API became the authoritative source for
 * doc statuses on 2026-06-12 (PE_API_STATUS_AUTHORITY=true). The external
 * HTML scraper's parser drifted out of sync with the portal and began writing
 * NOT_UPLOADED over docs the API correctly reports as APPROVED, fighting the
 * api-sync every run. This endpoint now no-ops unless explicitly re-enabled
 * via PE_SCRAPER_WEBHOOK_ENABLED=true. Leave it off while the API is
 * authoritative; flip it on only to temporarily fall back to the scraper.
 */
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  // Kill switch — the scraper is retired in favor of the authoritative PE API.
  // Default OFF: accept the POST but write nothing, so the external bot doesn't
  // error-loop while it's being decommissioned.
  if (process.env.PE_SCRAPER_WEBHOOK_ENABLED !== "true") {
    console.warn("[pe-scraper-webhook] Ignored — scraper retired (PE_SCRAPER_WEBHOOK_ENABLED!=true)");
    return NextResponse.json(
      { ok: true, disabled: true, reason: "PE scraper retired; PE API is authoritative" },
      { status: 200 },
    );
  }

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
    const result = await syncPeDocStatuses(projects, dealMap, "webhook/pe-scraper");

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

      // Fire-and-forget instant email notification
      sendPeDocChangeNotification(result.changes, "webhook/pe-scraper").catch(() => {});
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
