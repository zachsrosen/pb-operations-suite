import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { snapshotFlaggedDeals } from "@/lib/shit-show/snapshot";

/**
 * Canonical session-start endpoint. Flips status to ACTIVE and snapshots
 * every flagged deal from HubSpot in one call.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  await prisma.shitShowSession.update({
    where: { id },
    data: { status: "ACTIVE" },
  });
  const result = await snapshotFlaggedDeals(id);
  return NextResponse.json(result);
}
