import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const DEFAULT_RETENTION_DAYS = 90;

/**
 * GET /api/cron/audit-retention
 *
 * Vercel cron job — purges old audit data beyond retention window.
 * Schedule: weekly, Sunday 5am UTC.
 * Protected by CRON_SECRET.
 *
 * Deletes in order: anomaly events → activities → orphaned activities → sessions.
 * Amendment A8: also cleans orphaned activity rows (auditSessionId IS NULL).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 500 }
    );
  }

  const retentionDays = parseInt(
    process.env.AUDIT_RETENTION_DAYS || String(DEFAULT_RETENTION_DAYS)
  );
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  // Delete in order: anomaly events → session activities → orphaned activities → sessions → deal sync logs
  const [deletedEvents, deletedActivities, deletedOrphaned, deletedSessions, deletedDealSyncLogs] =
    await prisma.$transaction([
      prisma.auditAnomalyEvent.deleteMany({
        where: { createdAt: { lt: cutoff } },
      }),
      prisma.activityLog.deleteMany({
        where: {
          auditSessionId: { not: null },
          createdAt: { lt: cutoff },
        },
      }),
      // Amendment A8: orphaned activity rows
      prisma.activityLog.deleteMany({
        where: {
          auditSessionId: null,
          createdAt: { lt: cutoff },
        },
      }),
      prisma.auditSession.deleteMany({
        where: { startedAt: { lt: cutoff } },
      }),
      prisma.dealSyncLog.deleteMany({
        where: {
          createdAt: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

  return NextResponse.json({
    retentionDays,
    cutoff: cutoff.toISOString(),
    deleted: {
      anomalyEvents: deletedEvents.count,
      activities: deletedActivities.count,
      orphanedActivities: deletedOrphaned.count,
      sessions: deletedSessions.count,
      dealSyncLogs: deletedDealSyncLogs.count,
    },
  });
}
