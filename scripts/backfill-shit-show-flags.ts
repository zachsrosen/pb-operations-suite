#!/usr/bin/env tsx
/**
 * One-time backfill: copy IdrMeetingItem.shitShowFlagged + shitShowReason
 * into HubSpot deal properties (pb_shit_show_flagged + pb_shit_show_reason +
 * pb_shit_show_flagged_since). Resumable; tracks progress in ShitShowBackfillRun.
 *
 * Usage: npx tsx scripts/backfill-shit-show-flags.ts
 */
import { prisma } from "@/lib/db";
import { setShitShowFlag } from "@/lib/shit-show/hubspot-flag";

export async function runBackfill(): Promise<void> {
  // Resume from any existing RUNNING row, else create a new one
  const existing = await prisma.shitShowBackfillRun.findFirst({
    where: { status: "RUNNING" },
    orderBy: { startedAt: "desc" },
  });

  const run = existing
    ? existing
    : await prisma.shitShowBackfillRun.create({ data: { status: "RUNNING" } });

  // Pull every flagged IDR row, dedupe by dealId, keep the most-recently-updated reason
  const items = await prisma.idrMeetingItem.findMany({
    where: { shitShowFlagged: true },
    select: { dealId: true, shitShowReason: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  const byDeal = new Map<string, { reason: string }>();
  for (const item of items) {
    if (!byDeal.has(item.dealId)) {
      byDeal.set(item.dealId, { reason: item.shitShowReason ?? "" });
    }
  }

  const errorLog: Array<{ dealId: string; error: string }> = [];
  let processed = 0;
  for (const [dealId, { reason }] of byDeal) {
    try {
      await setShitShowFlag(dealId, true, reason);
      processed += 1;
    } catch (e) {
      errorLog.push({
        dealId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  await prisma.shitShowBackfillRun.update({
    where: { id: run.id },
    data: {
      processed,
      errors: errorLog.length,
      errorLog,
      completedAt: new Date(),
      status: "COMPLETED",
    },
  });

  console.log(`[backfill] processed=${processed} errors=${errorLog.length}`);
}

if (require.main === module) {
  runBackfill().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
