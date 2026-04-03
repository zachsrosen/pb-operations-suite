import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { isIdrAllowedRole, snapshotDealProperties, buildOwnerMap, SNAPSHOT_PROPERTIES } from "@/lib/idr-meeting";
import { hubspotClient } from "@/lib/hubspot";

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { sessionId, dealId, type, escalationReason } = body;

  if (!sessionId || !dealId) {
    return NextResponse.json({ error: "sessionId and dealId required" }, { status: 400 });
  }
  if (type === "ESCALATION" && !escalationReason) {
    return NextResponse.json({ error: "escalationReason required for escalations" }, { status: 400 });
  }

  // Guard: reject mutations on completed sessions
  const session = await prisma.idrMeetingSession.findUnique({
    where: { id: sessionId },
    select: { status: true },
  });
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status === "COMPLETED") {
    return NextResponse.json({ error: "Cannot modify a completed session" }, { status: 400 });
  }

  // Check for duplicates
  const existing = await prisma.idrMeetingItem.findUnique({
    where: { sessionId_dealId: { sessionId, dealId } },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Deal already exists in this session", existingItemId: existing.id },
      { status: 409 },
    );
  }

  // Fetch deal from HubSpot + resolve owner names
  const deal = await hubspotClient.crm.deals.basicApi.getById(dealId, SNAPSHOT_PROPERTIES);
  const ownerMap = await buildOwnerMap([{ properties: deal.properties as Record<string, string | null> }]);
  const snapshot = snapshotDealProperties(deal.properties as Record<string, string | null>, ownerMap);

  // Get max sortOrder in session
  const maxSort = await prisma.idrMeetingItem.findFirst({
    where: { sessionId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const item = await prisma.idrMeetingItem.create({
    data: {
      sessionId,
      dealId,
      type: type ?? "IDR",
      sortOrder: (maxSort?.sortOrder ?? -1) + 1,
      ...snapshot,
      escalationReason: type === "ESCALATION" ? escalationReason : null,
      addedBy: auth.email,
    },
  });

  return NextResponse.json(item, { status: 201 });
}
