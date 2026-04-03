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
  });

  try {
    if (Object.keys(properties).length > 0) {
      await pushDealProperties(item.dealId, properties);
    }
  } catch (err) {
    console.error(`[idr-meeting] Property sync failed for deal ${item.dealId}:`, err);
    await prisma.idrMeetingItem.update({
      where: { id },
      data: { hubspotSyncStatus: "FAILED" },
    });
    return NextResponse.json({ error: "Property sync failed", hubspotSyncStatus: "FAILED" }, { status: 502 });
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

  return NextResponse.json({
    hubspotSyncStatus: "SYNCED",
    noteWarning,
  });
}
