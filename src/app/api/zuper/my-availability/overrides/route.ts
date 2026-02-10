/**
 * Self-Service Availability Override API
 *
 * GET    /api/zuper/my-availability/overrides - List own overrides (upcoming)
 * POST   /api/zuper/my-availability/overrides - Block a specific date
 * DELETE /api/zuper/my-availability/overrides - Remove own override
 *
 * All operations scoped to the logged-in crew member via email matching.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  prisma,
  getUserByEmail,
  getCrewMemberByEmail,
  getAvailabilityOverrides,
  upsertAvailabilityOverride,
  deleteAvailabilityOverride,
  logActivity,
} from "@/lib/db";

/**
 * Resolve the logged-in user's crew member profile (with impersonation support).
 */
async function resolveCrewMember(): Promise<
  { crewMember: NonNullable<Awaited<ReturnType<typeof getCrewMemberByEmail>>>; userId: string } | NextResponse
> {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  // Support admin impersonation
  let lookupEmail = session.user.email;
  if (
    currentUser.role === "ADMIN" &&
    (currentUser as Record<string, unknown>).impersonatingUserId &&
    prisma
  ) {
    const impersonatedUser = await prisma.user.findUnique({
      where: { id: (currentUser as Record<string, unknown>).impersonatingUserId as string },
    });
    if (impersonatedUser?.email) {
      lookupEmail = impersonatedUser.email;
    }
  }

  const crewMember = await getCrewMemberByEmail(lookupEmail);
  if (!crewMember) {
    return NextResponse.json(
      { error: "No crew profile linked to your account" },
      { status: 403 }
    );
  }

  return { crewMember, userId: currentUser.id };
}

/**
 * GET - List own upcoming overrides
 */
export async function GET() {
  const resolved = await resolveCrewMember();
  if (resolved instanceof NextResponse) return resolved;
  const { crewMember } = resolved;

  try {
    // Show overrides from today onwards
    const today = new Date().toISOString().split("T")[0];
    const records = await getAvailabilityOverrides({
      crewMemberId: crewMember.id,
      dateFrom: today,
    });

    return NextResponse.json({ records });
  } catch (error) {
    console.error("Error fetching overrides:", error);
    return NextResponse.json({ error: "Failed to fetch overrides" }, { status: 500 });
  }
}

/**
 * POST - Block a specific date for own schedule
 */
export async function POST(request: NextRequest) {
  const resolved = await resolveCrewMember();
  if (resolved instanceof NextResponse) return resolved;
  const { crewMember, userId } = resolved;

  try {
    const body = await request.json();
    const { date, reason } = body;

    if (!date) {
      return NextResponse.json({ error: "date is required" }, { status: 400 });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Date must be YYYY-MM-DD format" }, { status: 400 });
    }

    const record = await upsertAvailabilityOverride({
      crewMemberId: crewMember.id,
      date,
      availabilityId: null, // Block all slots for the day
      type: "blocked",
      reason: reason || null,
      createdBy: userId,
      updatedBy: userId,
    });

    await logActivity({
      type: "SETTINGS_CHANGED",
      description: `${crewMember.name} blocked ${date}${reason ? ` (${reason})` : ""}`,
      userId,
      entityType: "availability_override",
      entityId: record?.id,
    });

    return NextResponse.json({ success: true, record });
  } catch (error) {
    console.error("Error creating override:", error);
    return NextResponse.json({ error: "Failed to create override" }, { status: 500 });
  }
}

/**
 * DELETE - Remove own override (ownership verified)
 */
export async function DELETE(request: NextRequest) {
  const resolved = await resolveCrewMember();
  if (resolved instanceof NextResponse) return resolved;
  const { crewMember, userId } = resolved;

  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // Verify ownership
    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 500 });
    }

    const existing = await prisma.availabilityOverride.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Override not found" }, { status: 404 });
    }

    if (existing.crewMemberId !== crewMember.id) {
      return NextResponse.json({ error: "Not your override" }, { status: 403 });
    }

    await deleteAvailabilityOverride(id);

    await logActivity({
      type: "SETTINGS_CHANGED",
      description: `${crewMember.name} unblocked ${existing.date}`,
      userId,
      entityType: "availability_override",
      entityId: id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting override:", error);
    return NextResponse.json({ error: "Failed to delete override" }, { status: 500 });
  }
}
