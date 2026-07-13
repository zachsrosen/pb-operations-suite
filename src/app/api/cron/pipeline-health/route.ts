import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendCronHealthAlert } from "@/lib/audit/alerts";

/**
 * GET /api/cron/pipeline-health
 *
 * Vercel cron job — checks that the BOM pipeline is still receiving webhooks.
 * Alerts if no pipeline runs have been created in the last 48 hours.
 *
 * Schedule: daily at 8am Denver (15:00 UTC).
 * Protected by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  // ── Deal-sync freshness (runs every day, incl. weekends) ─────────────────
  // The Deal mirror silently froze for 5 days (7/8–7/13) because its cron was
  // never added to vercel.json and nothing watched it. Guard it: max(lastSyncedAt)
  // is when the sync last touched any deal; if that's too old, the sync has
  // stalled — and ~33 features read this table.
  const DEAL_SYNC_STALE_HOURS = 6;
  try {
    const newest = await prisma.deal.findFirst({
      where: { pipeline: "PROJECT" },
      orderBy: { lastSyncedAt: "desc" },
      select: { lastSyncedAt: true },
    });
    const last = newest?.lastSyncedAt ?? null;
    const hoursSince = last ? (Date.now() - last.getTime()) / 3_600_000 : Infinity;
    if (hoursSince > DEAL_SYNC_STALE_HOURS) {
      await sendCronHealthAlert(
        "deal-sync",
        `Deal mirror is stale: PROJECT last synced ${last ? last.toISOString() : "never"} ` +
          `(${Number.isFinite(hoursSince) ? Math.round(hoursSince) + "h" : "∞"} ago), ` +
          `threshold ${DEAL_SYNC_STALE_HOURS}h. The /api/cron/deal-sync job may be ` +
          `unscheduled or timing out — worklists, PM tracker, dashboards and ~30 other ` +
          `features read this table. Check vercel.json crons + Vercel logs for /api/cron/deal-sync.`
      );
    }
  } catch (err) {
    console.error("[pipeline-health] deal-sync freshness check failed:", err);
  }

  // Skip weekends — no plansets are processed Sat/Sun
  const denverNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Denver" })
  );
  const dayOfWeek = denverNow.getDay(); // 0=Sun, 6=Sat
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return NextResponse.json({ healthy: true, skipped: "weekend" });
  }

  const STALE_HOURS = 48;
  const cutoff = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);

  try {
    const recentRun = await prisma.bomPipelineRun.findFirst({
      where: { createdAt: { gte: cutoff } },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, status: true, dealName: true },
    });

    if (recentRun) {
      return NextResponse.json({
        healthy: true,
        lastRun: recentRun.createdAt,
        lastStatus: recentRun.status,
        lastDeal: recentRun.dealName,
      });
    }

    // No runs in STALE_HOURS — find the actual last run
    const lastEverRun = await prisma.bomPipelineRun.findFirst({
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, status: true, dealName: true },
    });

    const lastRunDate = lastEverRun
      ? lastEverRun.createdAt.toISOString()
      : "never";
    const hoursSince = lastEverRun
      ? Math.round(
          (Date.now() - lastEverRun.createdAt.getTime()) / (60 * 60 * 1000)
        )
      : Infinity;

    await sendCronHealthAlert(
      "pipeline-health",
      `No BOM pipeline runs in the last ${STALE_HOURS} hours. ` +
        `Last run: ${lastRunDate} (${hoursSince}h ago). ` +
        `The HubSpot webhook may be misconfigured or failing silently. ` +
        `Check Vercel runtime logs for /api/webhooks/hubspot/design-complete.`
    );

    return NextResponse.json({
      healthy: false,
      lastRun: lastRunDate,
      hoursSinceLastRun: hoursSince,
      alert: "sent",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    try {
      await sendCronHealthAlert("pipeline-health", message);
    } catch {
      // Best-effort
    }
    return NextResponse.json({ healthy: false, error: message }, { status: 500 });
  }
}
