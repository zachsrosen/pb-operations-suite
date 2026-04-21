/**
 * PATCH /api/admin/users/[userId]/hubspot-owner
 *
 * Admin-only. Sets or clears User.hubspotOwnerId to explicitly link a PB
 * user to a HubSpot owner record. Body: { hubspotOwnerId: string | null }.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import { appCache } from "@/lib/cache";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const me = await getUserByEmail(session.user.email);
  if (!me?.roles?.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const { userId } = await params;
  let body: { hubspotOwnerId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body.hubspotOwnerId;
  let hubspotOwnerId: string | null;
  if (raw === null || raw === "" || raw === undefined) {
    hubspotOwnerId = null;
  } else if (typeof raw === "string" && /^\d{1,20}$/.test(raw)) {
    hubspotOwnerId = raw;
  } else {
    return NextResponse.json(
      { error: "hubspotOwnerId must be a numeric string or null" },
      { status: 400 },
    );
  }

  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { hubspotOwnerId },
      select: { id: true, email: true, hubspotOwnerId: true },
    });
    // Invalidate the my-tasks cache for that owner so the next load re-fetches.
    if (updated.hubspotOwnerId) {
      appCache.invalidate(`hubspot:tasks:owner:${updated.hubspotOwnerId}`);
    }
    return NextResponse.json({ user: updated });
  } catch {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
}
