import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { appCache } from "@/lib/cache";
import { isIdrAllowedRole, syncItemToHubSpot } from "@/lib/idr-meeting";

/**
 * POST /api/idr-meeting/sessions/[id]/sync-unsynced
 *
 * Runs the HubSpot sync on every item in the session where
 * hubspotSyncStatus !== "SYNCED". Intended as the recovery path when a user
 * accidentally hit "End without syncing": their meeting is COMPLETED but no
 * items made it to HubSpot. Works on completed sessions too.
 *
 * Already-synced items are untouched to avoid duplicate timeline notes.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const session = await prisma.idrMeetingSession.findUnique({
    where: { id },
    select: { id: true, date: true },
  });
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const unsynced = await prisma.idrMeetingItem.findMany({
    where: { sessionId: id, hubspotSyncStatus: { not: "SYNCED" } },
  });

  let synced = 0;
  let failed = 0;
  for (const item of unsynced) {
    const result = await syncItemToHubSpot(item, session.date);
    if (result.ok) synced++;
    else failed++;
  }

  appCache.invalidate(`idr-meeting:session:${id}`);
  appCache.invalidate("idr-meeting:sessions");

  return NextResponse.json({
    total: unsynced.length,
    synced,
    failed,
  });
}
