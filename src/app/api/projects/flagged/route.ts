import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { fetchAllProjects } from "@/lib/hubspot";
import { dealToProject } from "@/lib/deal-reader";
import { getDealSyncSource, formatStaleness } from "@/lib/deal-sync";
import { prisma } from "@/lib/db";

/**
 * Returns every PROJECT-pipeline deal where `system_performance_review = true`,
 * across ALL stages — including PTO'd / closed deals that the generic
 * `/api/projects?context=executive` endpoint excludes via its active-only filter.
 *
 * Most production issues are discovered AFTER PTO (the system's been running
 * long enough to observe underperformance), so the Production Issues dashboard
 * must see inactive-stage deals or it reports an artificially low count.
 *
 * Result set is small (dozens at most — every flagged deal in the company's
 * entire history). No pagination; 5-minute client cache via React Query.
 */
export async function GET(request: NextRequest) {
  tagSentryRequest(request);

  try {
    // Machine-to-machine token gate (browser requests authenticated by middleware).
    const authHeader = request.headers.get("authorization");
    const expectedToken = process.env.API_SECRET_TOKEN;
    if (expectedToken && authHeader && authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const syncSource = await getDealSyncSource("projects");

    // Local-DB path (deal-mirror). Fast — O(flagged) where flagged is ~dozens.
    if (syncSource === "local" || syncSource === "local-with-verify") {
      const deals = await prisma.deal.findMany({
        where: { pipeline: "PROJECT", systemPerformanceReview: "true" },
      });
      const projects = deals.map(dealToProject);

      const lastSyncLog = await prisma.dealSyncLog.findFirst({
        where: { source: { startsWith: "batch:PROJECT" }, status: "SUCCESS" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const lastSyncedAt = lastSyncLog?.createdAt ?? new Date();

      return NextResponse.json({
        projects,
        count: projects.length,
        lastUpdated: lastSyncedAt.toISOString(),
        sync: {
          source: syncSource,
          lastSyncedAt: lastSyncedAt.toISOString(),
          staleness: formatStaleness(lastSyncedAt),
        },
      });
    }

    // HubSpot fallback: pull the full deal set (no active-only) and filter.
    // Slow but correct — only used when deal-mirror sync is disabled.
    if (!process.env.HUBSPOT_ACCESS_TOKEN?.trim()) {
      return NextResponse.json(
        { error: "HUBSPOT_ACCESS_TOKEN not configured" },
        { status: 500 }
      );
    }

    const all = await fetchAllProjects({ activeOnly: false });
    const flagged = all.filter((p) => p.systemPerformanceReview === true);

    return NextResponse.json({
      projects: flagged,
      count: flagged.length,
      lastUpdated: new Date().toISOString(),
      sync: { source: syncSource, lastSyncedAt: new Date().toISOString(), staleness: "just now" },
    });
  } catch (error) {
    Sentry.captureException(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
