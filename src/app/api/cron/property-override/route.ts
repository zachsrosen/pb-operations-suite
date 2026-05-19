import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { pushDealProperties } from "@/lib/idr-meeting";

/**
 * Cron — every 3 minutes.
 *
 * Processes PendingPropertyOverride rows whose executeAfter has passed.
 * Pushes the property value to HubSpot, marks the row executed, and
 * cleans up old completed rows (>7 days).
 *
 * Created to replace unreliable setTimeout() in Vercel serverless —
 * the primary use case is the 2-minute delayed design_status override
 * after IDR sync completes the "Complete Initial Design Review" task.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const pending = await prisma.pendingPropertyOverride.findMany({
    where: {
      executedAt: null,
      executeAfter: { lte: new Date() },
      attempts: { lt: 5 },
    },
    orderBy: { executeAfter: "asc" },
    take: 20,
  });

  let applied = 0;
  let failed = 0;

  for (const row of pending) {
    try {
      await pushDealProperties(row.dealId, { [row.propertyName]: row.value });
      await prisma.pendingPropertyOverride.update({
        where: { id: row.id },
        data: { executedAt: new Date(), attempts: row.attempts + 1 },
      });
      console.log(`[cron/property-override] Applied ${row.propertyName}=${row.value} to deal ${row.dealId} (${row.reason})`);
      applied += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron/property-override] Failed deal ${row.dealId}:`, msg);
      await prisma.pendingPropertyOverride.update({
        where: { id: row.id },
        data: { attempts: row.attempts + 1, error: msg.slice(0, 500) },
      }).catch(() => {});
      failed += 1;
    }
  }

  // Cleanup: remove completed rows older than 7 days
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const { count: cleaned } = await prisma.pendingPropertyOverride.deleteMany({
    where: { executedAt: { not: null, lt: cutoff } },
  });

  return NextResponse.json({ pending: pending.length, applied, failed, cleaned });
}
