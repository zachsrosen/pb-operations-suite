import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { isIdrAllowedRole, syncItemToHubSpot } from "@/lib/idr-meeting";
import { appCache } from "@/lib/cache";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const item = await prisma.idrMeetingItem.findUnique({
    where: { id },
    include: { session: { select: { date: true } } },
  });

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  // Note: no longer blocks on session.status === COMPLETED. This lets the team
  // recover items missed when someone accidentally hit "End without syncing".

  const result = await syncItemToHubSpot(item, item.session.date);

  appCache.invalidate(`idr-meeting:session:${item.sessionId}`);

  if (!result.ok) {
    return NextResponse.json(
      { error: "Sync failed", detail: result.error, hubspotSyncStatus: "FAILED" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    hubspotSyncStatus: "SYNCED",
    noteWarning: result.noteWarning ?? null,
    taskWarning: result.taskWarning ?? null,
  });
}
