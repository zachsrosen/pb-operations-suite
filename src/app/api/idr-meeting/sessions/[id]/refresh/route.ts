import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { isIdrAllowedRole, snapshotDealProperties, buildOwnerMap, SNAPSHOT_PROPERTIES } from "@/lib/idr-meeting";
import { hubspotClient } from "@/lib/hubspot";

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
  const session = await prisma.idrMeetingSession.findUnique({
    where: { id },
    include: { items: { select: { id: true, dealId: true } } },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status === "COMPLETED") {
    return NextResponse.json({ error: "Cannot refresh completed session" }, { status: 400 });
  }

  // Batch-fetch deals from HubSpot (up to 100 per batch call)
  const dealIds = session.items.map((i) => i.dealId);
  let updated = 0;

  try {
    const batchResponse = await hubspotClient.crm.deals.batchApi.read({
      inputs: dealIds.map((dealId) => ({ id: dealId })),
      properties: SNAPSHOT_PROPERTIES,
      propertiesWithHistory: [],
    });

    const dealMap = new Map(
      (batchResponse.results ?? []).map((d) => [d.id, d.properties]),
    );

    // Resolve owner names
    const dealsForOwnerMap = [...dealMap.values()].map((p) => ({
      properties: p as Record<string, string | null>,
    }));
    const ownerMap = await buildOwnerMap(dealsForOwnerMap);

    for (const item of session.items) {
      const props = dealMap.get(item.dealId);
      if (!props) continue;
      const snapshot = snapshotDealProperties(props as Record<string, string | null>, ownerMap);
      await prisma.idrMeetingItem.update({
        where: { id: item.id },
        data: { ...snapshot, snapshotUpdatedAt: new Date() },
      });
      updated++;
    }
  } catch (err) {
    console.error(`[idr-meeting] Batch refresh failed:`, err);
  }

  return NextResponse.json({ refreshed: updated, total: dealIds.length });
}
