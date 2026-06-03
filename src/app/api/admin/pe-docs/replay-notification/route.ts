import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { sendPeDocChangeNotification } from "@/lib/pe-doc-notify";
import type { DocChange } from "@/lib/pe-scraper-sync";

/**
 * /api/admin/pe-docs/replay-notification
 *
 * Re-sends a PE doc change notification email for a batch of changes that was
 * already recorded in PeDocChangeLog. The live notification only fires from the
 * pe-scraper webhook at detection time and there's no built-in resend, so this
 * lets an admin replay a past batch (e.g. after the email template changes).
 *
 *   GET  — dry-run preview: which batch would be sent, counts, status breakdown.
 *   POST — actually re-send the batch via sendPeDocChangeNotification.
 *
 * A "batch" is one scraper run: all PeDocChangeLog rows land within seconds of
 * each other and runs are hours apart (9am/4pm), so a short time window cleanly
 * isolates a single run.
 *
 * Query / body params:
 *   windowMinutes — cluster window in minutes (default 15).
 *   before        — ISO timestamp; target the latest batch at/before this time.
 *                   Defaults to now (the most recent batch). Use this to replay
 *                   an older run when a newer one has since landed.
 *
 * Admin/Owner session required (also enforced by middleware on /api/admin/*).
 */
export const maxDuration = 60;

const STATUS_ORDER = [
  "APPROVED",
  "ACTION_REQUIRED",
  "REJECTED",
  "UNDER_REVIEW",
  "UPLOADED",
  "NOT_UPLOADED",
];

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  const currentUser = await getUserByEmail(session.user.email);
  const hasAccess = !!currentUser?.roles?.some((r) => r === "ADMIN" || r === "OWNER");
  if (!currentUser || !hasAccess) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 403 }) };
  }
  return { email: session.user.email };
}

function readParams(req: NextRequest, body: Record<string, unknown>) {
  const url = new URL(req.url);
  const rawWindow = body.windowMinutes ?? url.searchParams.get("windowMinutes");
  const windowMinutes = Math.min(
    Math.max(Number(rawWindow) || 15, 1),
    24 * 60,
  );
  const rawBefore = (body.before ?? url.searchParams.get("before")) as string | null | undefined;
  let before = new Date();
  if (rawBefore) {
    const parsed = new Date(rawBefore);
    if (!Number.isNaN(parsed.getTime())) before = parsed;
  }
  return { windowMinutes, before };
}

/**
 * Resolve the most recent batch at/before `before`, grouping rows that fall
 * within `windowMinutes` of the batch's most recent row.
 */
async function resolveBatch(before: Date, windowMinutes: number) {
  const anchor = await prisma.peDocChangeLog.findFirst({
    where: { createdAt: { lte: before } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!anchor) return null;

  const batchEnd = anchor.createdAt;
  const batchStart = new Date(batchEnd.getTime() - windowMinutes * 60_000);

  const rows = await prisma.peDocChangeLog.findMany({
    where: { createdAt: { gte: batchStart, lte: batchEnd } },
    orderBy: { createdAt: "asc" },
  });

  const changes: DocChange[] = rows.map((r) => ({
    dealId: r.dealId,
    docName: r.docName,
    oldStatus: r.oldStatus,
    newStatus: r.newStatus,
    oldNotes: r.oldNotes,
    newNotes: r.newNotes,
  }));

  const byStatus: Record<string, number> = {};
  for (const c of changes) byStatus[c.newStatus] = (byStatus[c.newStatus] || 0) + 1;
  const orderedByStatus = STATUS_ORDER.filter((s) => byStatus[s]).map((s) => ({
    status: s,
    count: byStatus[s],
  }));

  return {
    batchStart: batchStart.toISOString(),
    batchEnd: batchEnd.toISOString(),
    totalChanges: changes.length,
    dealCount: new Set(changes.map((c) => c.dealId)).size,
    byStatus: orderedByStatus,
    changes,
  };
}

export async function GET(req: NextRequest) {
  const authResult = await requireAdmin();
  if (authResult.error) return authResult.error;

  const { windowMinutes, before } = readParams(req, {});
  const batch = await resolveBatch(before, windowMinutes);
  if (!batch || batch.totalChanges === 0) {
    return NextResponse.json({ found: false, windowMinutes, before: before.toISOString() });
  }

  const { changes: _changes, ...summary } = batch;
  return NextResponse.json({ found: true, dryRun: true, windowMinutes, ...summary });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAdmin();
  if (authResult.error) return authResult.error;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { windowMinutes, before } = readParams(req, body);

  const batch = await resolveBatch(before, windowMinutes);
  if (!batch || batch.totalChanges === 0) {
    return NextResponse.json(
      { sent: false, found: false, windowMinutes, before: before.toISOString() },
      { status: 404 },
    );
  }

  const result = await sendPeDocChangeNotification(batch.changes, "manual-replay");

  const { changes: _changes, ...summary } = batch;
  return NextResponse.json({
    sent: result.sent,
    error: result.error,
    triggeredBy: authResult.email,
    windowMinutes,
    ...summary,
  });
}
