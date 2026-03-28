// src/app/api/cron/daily-focus/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sendCronHealthAlert } from "@/lib/audit/alerts";
import { runPIDailyFocus, runDesignDailyFocus } from "@/lib/daily-focus/send";
import { queryAllBroad, saveSnapshot } from "@/lib/eod-summary/snapshot";

/**
 * GET /api/cron/daily-focus
 *
 * Vercel cron job — sends daily focus emails to P&I and Design leads.
 * Schedule: weekdays at 13:00 UTC (7:00 AM Mountain Daylight Time).
 * Note: During MST (Nov-Mar), 13:00 UTC = 6:00 AM Mountain.
 *
 * Protected by CRON_SECRET.
 *
 * Query params:
 *   ?dryRun=true  - send all emails to manager only, with [DRY RUN] prefix
 *   ?type=pi      - run P&I emails only
 *   ?type=design  - run Design emails only
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "true";
  const typeFilter = url.searchParams.get("type");

  try {
    const results = [];

    if (!typeFilter || typeFilter === "pi") {
      results.push(await runPIDailyFocus({ dryRun }));
    }
    if (!typeFilter || typeFilter === "design") {
      results.push(await runDesignDailyFocus({ dryRun }));
    }

    const allErrors = results.flatMap((r) => r.errors);
    const totalSent = results.reduce((s, r) => s + r.emailsSent, 0);
    const totalItems = results.reduce((s, r) => s + r.totalItems, 0);

    // ── EOD Snapshot (best-effort, does not block daily focus emails) ──
    // Skip on dry-run — snapshot writes are production DB mutations.
    const snapshotResult = { saved: 0, errors: [] as string[] };
    if (!dryRun) {
      try {
        const broadResult = await queryAllBroad();
        await saveSnapshot(broadResult);
        // Count total (dealId, ownerId) rows written
        for (const [dealId, owners] of broadResult.dealOwnerSets) {
          void dealId;
          snapshotResult.saved += owners.size;
        }
        console.log(`[daily-focus] EOD snapshot saved: ${snapshotResult.saved} rows`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[daily-focus] EOD snapshot failed (non-blocking): ${msg}`);
        snapshotResult.errors.push(msg);
      }
    }

    return NextResponse.json({
      dryRun,
      emailsSent: totalSent,
      rollupsSent: results.filter((r) => r.rollupSent).length,
      totalItems,
      results: results.map((r) => ({
        type: r.type,
        emailsSent: r.emailsSent,
        rollupSent: r.rollupSent,
        totalItems: r.totalItems,
        leads: r.leadSummaries,
        skippedReason: r.skippedReason,
      })),
      errors: allErrors.length > 0 ? allErrors : undefined,
      snapshot: { saved: snapshotResult.saved, errors: snapshotResult.errors },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    try {
      await sendCronHealthAlert("daily-focus", message);
    } catch {
      // Best-effort
    }
    return NextResponse.json({ sent: false, reason: message }, { status: 500 });
  }
}
