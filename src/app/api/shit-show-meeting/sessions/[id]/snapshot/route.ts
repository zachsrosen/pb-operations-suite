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

  // Guard: target session must exist and be in DRAFT status (or already
  // ACTIVE — in which case re-snapshot is fine).
  const target = await prisma.shitShowSession.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!target) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }
  if (target.status === "COMPLETED") {
    return NextResponse.json(
      { error: "cannot_snapshot_completed_session" },
      { status: 400 },
    );
  }

  // Guard: only one ACTIVE session at a time across the org.
  if (target.status === "DRAFT") {
    const otherActive = await prisma.shitShowSession.findFirst({
      where: { status: "ACTIVE", NOT: { id } },
    });
    if (otherActive) {
      return NextResponse.json(
        { error: "another_session_active", sessionId: otherActive.id },
        { status: 409 },
      );
    }
  }

  await prisma.shitShowSession.update({
    where: { id },
    data: { status: "ACTIVE" },
  });
  const result = await snapshotFlaggedDeals(id);
  return NextResponse.json(result);
}
