import { NextRequest, NextResponse } from "next/server";
import { getServiceAccountToken } from "@/lib/google-auth";
import {
  parsePeScraperReport,
  syncPeDocStatuses,
  buildPeDealMap,
} from "@/lib/pe-scraper-sync";

/**
 * GET /api/cron/pe-scraper-sync
 *
 * Vercel cron job — fetches the latest PTO & Close Out scraper report
 * from GCS and syncs document statuses into PeDocumentReview.
 *
 * The external PE portal scraper runs at 9am + 4pm EST and writes HTML
 * to gs://photon-brothers-schedules/pe-status-scraper/. This cron runs
 * 30 min after each scraper run to pick up fresh data.
 *
 * Schedule: 13:30 + 20:30 UTC (9:30am + 4:30pm EST)
 */
export const maxDuration = 120;

const GCS_BUCKET = "photon-brothers-schedules";
const GCS_OBJECT = "pe-status-scraper/latest_pto_closeout_report.html";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const token = await getServiceAccountToken([
      "https://www.googleapis.com/auth/devstorage.read_only",
    ]);

    const gcsUrl = `https://storage.googleapis.com/storage/v1/b/${GCS_BUCKET}/o/${encodeURIComponent(GCS_OBJECT)}?alt=media`;
    const res = await fetch(gcsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[pe-scraper-sync] GCS fetch failed: ${res.status} ${res.statusText}`,
        body.slice(0, 500),
      );
      return NextResponse.json(
        { error: "Failed to fetch scraper report from GCS", status: res.status },
        { status: 502 },
      );
    }

    const html = await res.text();
    if (!html || html.length < 100) {
      return NextResponse.json(
        { error: "GCS report is empty or too small", length: html.length },
        { status: 422 },
      );
    }

    const { projects, parseErrors } = parsePeScraperReport(html);
    if (projects.length === 0) {
      console.warn("[pe-scraper-sync] No projects parsed", { parseErrors });
      return NextResponse.json({ error: "No projects parsed", parseErrors }, { status: 422 });
    }

    const dealMap = await buildPeDealMap();
    const result = await syncPeDocStatuses(projects, dealMap);

    console.log(
      `[pe-scraper-sync] cron: ${result.projectsMatched}/${result.projectsFound} matched, ` +
      `${result.docsUpserted} upserted, ${result.errors.length} errors`,
    );

    return NextResponse.json({
      ...result,
      parseErrors,
      dealMapSize: dealMap.size,
      syncedAt: new Date().toISOString(),
      syncedBy: "cron/pe-scraper-sync",
    });
  } catch (err) {
    console.error("[pe-scraper-sync] cron error:", err);
    return NextResponse.json(
      { error: "Sync failed", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
