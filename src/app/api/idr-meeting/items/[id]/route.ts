import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { isIdrAllowedRole } from "@/lib/idr-meeting";

const EDITABLE_FIELDS = [
  "difficulty", "installerCount", "installerDays", "electricianCount",
  "electricianDays", "discoReco", "interiorAccess", "needsSurveyInfo",
  "needsResurvey", "salesChangeRequested", "salesChangeNotes", "opsChangeNotes",
  "customerNotes",
  "operationsNotes", "designNotes", "conclusion", "sortOrder",
  "escalationReason", "type", "shitShowFlagged", "shitShowReason",
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

  const updated = await prisma.idrMeetingItem.update({
    where: { id },
    data,
  });

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

  // Guard: reject mutations on completed sessions
  const target = await prisma.idrMeetingItem.findUnique({
    where: { id },
    select: { session: { select: { status: true } } },
  });
  if (!target) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  if (target.session.status === "COMPLETED") {
    return NextResponse.json({ error: "Cannot modify a completed session" }, { status: 400 });
  }

  await prisma.idrMeetingItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
