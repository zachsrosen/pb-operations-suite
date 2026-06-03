import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendPeDocChangeNotification } from "@/lib/pe-doc-notify";
import type { DocChange } from "@/lib/pe-scraper-sync";

/**
 * GET /api/cron/pe-doc-replay
 *
 * One-shot, server-side replay of a past PE doc change batch with the current
 * email template. The live notification only fires from the pe-scraper webhook
 * at detection time, so after a template change there's no way to re-send an
 * already-recorded batch. The admin endpoint (/api/admin/pe-docs/replay-
 * notification) requires an interactive admin session; this cron variant lets
 * the replay run unattended where the prod secrets (DB, HubSpot, email) live.
 *
 * Targets the LARGEST change batch in the recent window (the standout run —
 * e.g. the ~103-change sync — rather than a timestamp guess). Idempotent: a
 * SystemConfig marker is claimed before sending so it fires exactly once even
 * though the cron recurs; subsequent runs no-op.
 *
 * Protected by CRON_SECRET (validated here; route is in PUBLIC_API_ROUTES).
 */
export const maxDuration = 60;

// Single-use marker. Bump the suffix to authorize another one-shot replay.
const FIRE_ONCE_KEY = "pe-doc-replay:2026-06-03";
const LOOKBACK_DAYS = 14;
// Rows from one scraper run land within seconds; runs are hours apart, so a
// gap larger than this starts a new batch.
const BATCH_GAP_MS = 10 * 60_000;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Claim the one-shot marker atomically (unique key). If it already exists,
  // this run is a no-op — the replay already fired.
  try {
    await prisma.systemConfig.create({
      data: { key: FIRE_ONCE_KEY, value: "pending" },
    });
  } catch {
    return NextResponse.json({ fired: false, reason: "already-fired", key: FIRE_ONCE_KEY });
  }

  try {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60_000);
    const rows = await prisma.peDocChangeLog.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
    });

    if (rows.length === 0) {
      // Release the marker so a future run can retry once data exists.
      await prisma.systemConfig.delete({ where: { key: FIRE_ONCE_KEY } }).catch(() => {});
      return NextResponse.json({ fired: false, reason: "no-changes-in-window" });
    }

    // Cluster rows into batches by time gap, then pick the largest batch.
    const batches: typeof rows[] = [];
    let current: typeof rows = [];
    for (const r of rows) {
      const prev = current[current.length - 1];
      if (prev && r.createdAt.getTime() - prev.createdAt.getTime() > BATCH_GAP_MS) {
        batches.push(current);
        current = [];
      }
      current.push(r);
    }
    if (current.length) batches.push(current);
    batches.sort((a, b) => b.length - a.length);
    const target = batches[0];

    const changes: DocChange[] = target.map((r) => ({
      dealId: r.dealId,
      docName: r.docName,
      oldStatus: r.oldStatus,
      newStatus: r.newStatus,
      oldNotes: r.oldNotes,
      newNotes: r.newNotes,
    }));

    const dealCount = new Set(changes.map((c) => c.dealId)).size;
    const result = await sendPeDocChangeNotification(changes, "cron-replay");

    if (!result.sent) {
      // Release the marker so the next cron tick can retry the send.
      await prisma.systemConfig.delete({ where: { key: FIRE_ONCE_KEY } }).catch(() => {});
      return NextResponse.json(
        { fired: false, reason: "send-failed", error: result.error, totalChanges: changes.length },
        { status: 502 },
      );
    }

    await prisma.systemConfig
      .update({
        where: { key: FIRE_ONCE_KEY },
        data: { value: `sent:${changes.length}@${new Date().toISOString()}` },
      })
      .catch(() => {});

    console.warn(
      `[pe-doc-replay] Replayed largest batch: ${changes.length} changes across ${dealCount} deals ` +
      `(batch start ${target[0].createdAt.toISOString()}), email delivered`,
    );

    return NextResponse.json({
      fired: true,
      totalChanges: changes.length,
      dealCount,
      batchStart: target[0].createdAt.toISOString(),
      batchEnd: target[target.length - 1].createdAt.toISOString(),
    });
  } catch (err) {
    // Release the marker on unexpected failure so it can retry.
    await prisma.systemConfig.delete({ where: { key: FIRE_ONCE_KEY } }).catch(() => {});
    console.error("[pe-doc-replay] Error:", err);
    return NextResponse.json(
      { fired: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
