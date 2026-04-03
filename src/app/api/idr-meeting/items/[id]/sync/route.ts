import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import {
  isIdrAllowedRole,
  buildHubSpotPropertyUpdates,
  buildHubSpotNoteBody,
  pushDealProperties,
  createDealTimelineNote,
} from "@/lib/idr-meeting";
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
    include: { session: { select: { date: true, status: true } } },
  });

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  // Guard: reject sync on completed sessions
  if (item.session.status === "COMPLETED") {
    return NextResponse.json({ error: "Cannot sync items in a completed session" }, { status: 400 });
  }

  // A) Push property updates
  const properties = buildHubSpotPropertyUpdates({
    difficulty: item.difficulty,
    installerCount: item.installerCount,
    installerDays: item.installerDays,
    electricianCount: item.electricianCount,
    electricianDays: item.electricianDays,
    discoReco: item.discoReco,
    interiorAccess: item.interiorAccess,
    operationsNotes: item.operationsNotes,
    needsSurveyInfo: item.needsSurveyInfo,
    needsResurvey: item.needsResurvey,
    salesChangeRequested: item.salesChangeRequested,
    salesChangeNotes: item.salesChangeNotes,
    opsChangeNotes: item.opsChangeNotes,
  });

  try {
    if (Object.keys(properties).length > 0) {
      console.log(`[idr-meeting] Syncing deal ${item.dealId} properties:`, JSON.stringify(properties));
      await pushDealProperties(item.dealId, properties);
    }
  } catch (err: unknown) {
    const errBody = (err as { body?: unknown })?.body ?? (err as { message?: string })?.message ?? err;
    console.error(`[idr-meeting] Property sync failed for deal ${item.dealId}:`, JSON.stringify(errBody, null, 2));
    await prisma.idrMeetingItem.update({
      where: { id },
      data: { hubspotSyncStatus: "FAILED" },
    });
    const detail = typeof errBody === "object" && errBody !== null ? JSON.stringify(errBody) : String(errBody);
    return NextResponse.json({ error: "Property sync failed", detail, hubspotSyncStatus: "FAILED" }, { status: 502 });
  }

  // B) Create timeline note
  let noteWarning: string | null = null;
  const noteBody = buildHubSpotNoteBody(
    {
      difficulty: item.difficulty,
      installerCount: item.installerCount,
      installerDays: item.installerDays,
      electricianCount: item.electricianCount,
      electricianDays: item.electricianDays,
      discoReco: item.discoReco,
      interiorAccess: item.interiorAccess,
      customerNotes: item.customerNotes,
      operationsNotes: item.operationsNotes,
      designNotes: item.designNotes,
      conclusion: item.conclusion,
      salesChangeRequested: item.salesChangeRequested,
      salesChangeNotes: item.salesChangeNotes,
      needsSurveyInfo: item.needsSurveyInfo,
      opsChangeNotes: item.opsChangeNotes,
      needsResurvey: item.needsResurvey,
    },
    item.session.date.toISOString(),
  );

  try {
    await createDealTimelineNote(item.dealId, noteBody);
  } catch (err) {
    console.error(`[idr-meeting] Timeline note failed for deal ${item.dealId}:`, err);
    noteWarning = "Properties saved but timeline note failed. Retrying later may help.";
  }

  // C) Update sync status
  await prisma.idrMeetingItem.update({
    where: { id },
    data: {
      hubspotSyncStatus: "SYNCED",
      hubspotSyncedAt: new Date(),
    },
  });

  // Broadcast so other clients see the sync status update
  appCache.invalidate(`idr-meeting:session:${item.sessionId}`);

  return NextResponse.json({
    hubspotSyncStatus: "SYNCED",
    noteWarning,
  });
}
