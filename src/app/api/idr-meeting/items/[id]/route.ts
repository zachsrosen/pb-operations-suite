import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { appCache } from "@/lib/cache";

const EDITABLE_FIELDS = [
  "difficulty", "installerCount", "installerDays", "electricianCount",
  "electricianDays", "discoReco", "interiorAccess", "needsSurveyInfo",
  "needsResurvey", "salesChangeRequested", "salesChangeNotes", "opsChangeNotes",
  "customerNotes",
  "operationsNotes", "designNotes", "conclusion", "sortOrder",
  "escalationReason", "type", "reviewed", "shitShowFlagged", "shitShowReason",
  // Adders
  "adderTileRoof", "adderMetalRoof", "adderFlatFoamRoof", "adderShakeRoof",
  "adderSteepPitch", "adderTwoStorey", "adderTrenching", "adderGroundMount",
  "adderMpuUpgrade", "adderEvCharger", "customAdders",
];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Guard: reject mutations on completed sessions
  const existing = await prisma.idrMeetingItem.findUnique({
    where: { id },
    select: { session: { select: { status: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  if (existing.session.status === "COMPLETED") {
    return NextResponse.json({ error: "Cannot modify a completed session" }, { status: 400 });
  }

  const body = await req.json();

  // Filter to only editable fields
  const data: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) {
    if (key in body) data[key] = body[key];
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }

  // Validate customAdders if present
  if (data.customAdders !== undefined) {
    if (!Array.isArray(data.customAdders)) {
      return NextResponse.json({ error: "customAdders must be an array" }, { status: 400 });
    }
    if (data.customAdders.length > 20) {
      return NextResponse.json({ error: "Maximum 20 custom adders" }, { status: 400 });
    }
    for (const adder of data.customAdders) {
      if (adder == null || typeof adder !== "object") {
        return NextResponse.json({ error: "Each custom adder must be an object" }, { status: 400 });
      }
      if (!adder.name || typeof adder.name !== "string" || adder.name.trim().length === 0 || adder.name.length > 100) {
        return NextResponse.json({ error: "Each custom adder must have a name (max 100 chars)" }, { status: 400 });
      }
      if (typeof adder.amount !== "number" || !isFinite(adder.amount)) {
        return NextResponse.json({ error: "Each custom adder must have a numeric amount" }, { status: 400 });
      }
    }
  }

  const updated = await prisma.idrMeetingItem.update({
    where: { id },
    data,
  });

  // Broadcast change so other clients refetch in real time
  appCache.invalidate(`idr-meeting:session:${updated.sessionId}`);

  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Fetch full item so we can re-queue escalations
  const item = await prisma.idrMeetingItem.findUnique({
    where: { id },
    include: { session: { select: { status: true } } },
  });
  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  if (item.session.status === "COMPLETED") {
    return NextResponse.json({ error: "Cannot modify a completed session" }, { status: 400 });
  }

  // Re-queue escalation items so they appear in the next session
  if (item.type === "ESCALATION") {
    // Check if there's already a QUEUED entry for this deal
    const existingQueued = await prisma.idrEscalationQueue.findFirst({
      where: { dealId: item.dealId, status: "QUEUED" },
    });
    if (!existingQueued) {
      await prisma.idrEscalationQueue.create({
        data: {
          dealId: item.dealId,
          dealName: item.dealName,
          region: item.region,
          queueType: "ESCALATION",
          reason: item.escalationReason ?? "Re-queued from skipped session item",
          requestedBy: auth.email,
          // Carry over any prep data that was entered
          difficulty: item.difficulty,
          installerCount: item.installerCount,
          installerDays: item.installerDays,
          electricianCount: item.electricianCount,
          electricianDays: item.electricianDays,
          discoReco: item.discoReco,
          interiorAccess: item.interiorAccess,
          needsSurveyInfo: item.needsSurveyInfo,
          needsResurvey: item.needsResurvey,
          salesChangeRequested: item.salesChangeRequested,
          salesChangeNotes: item.salesChangeNotes,
          opsChangeNotes: item.opsChangeNotes,
          customerNotes: item.customerNotes,
          operationsNotes: item.operationsNotes,
          designNotes: item.designNotes,
          conclusion: item.conclusion,
          adderTileRoof: item.adderTileRoof,
          adderMetalRoof: item.adderMetalRoof,
          adderFlatFoamRoof: item.adderFlatFoamRoof,
          adderShakeRoof: item.adderShakeRoof,
          adderSteepPitch: item.adderSteepPitch,
          adderTwoStorey: item.adderTwoStorey,
          adderTrenching: item.adderTrenching,
          adderGroundMount: item.adderGroundMount,
          adderMpuUpgrade: item.adderMpuUpgrade,
          adderEvCharger: item.adderEvCharger,
          ...(item.customAdders != null ? { customAdders: item.customAdders } : {}),
        },
      });
    }
  }

  await prisma.idrMeetingItem.delete({ where: { id } });

  // Broadcast deletion so other clients update
  appCache.invalidate(`idr-meeting:session:${item.sessionId}`);
  // Also invalidate preview so re-queued escalation shows up
  if (item.type === "ESCALATION") {
    appCache.invalidate("idr-meeting:preview");
  }

  return NextResponse.json({ ok: true });
}
