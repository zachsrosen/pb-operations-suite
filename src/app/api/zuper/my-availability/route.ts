/**
 * Self-Service Crew Availability API
 *
 * GET  /api/zuper/my-availability - Get logged-in user's crew profile + availability
 * POST /api/zuper/my-availability - Create a new availability slot
 * PUT  /api/zuper/my-availability - Update an existing slot (ownership verified)
 * DELETE /api/zuper/my-availability - Remove a slot (ownership verified)
 *
 * Links the logged-in user to their CrewMember record via email matching.
 * All operations are scoped to the user's own crew member ID.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  prisma,
  getUserByEmail,
  getCrewMemberByEmail,
  getCrewAvailabilities,
  upsertCrewAvailability,
  deleteCrewAvailability,
  logActivity,
} from "@/lib/db";

/**
 * Resolve the logged-in user's crew member profile.
 * Returns the crew member or an error response.
 */
async function resolveCrewMember(
): Promise<{ crewMember: NonNullable<Awaited<ReturnType<typeof getCrewMemberByEmail>>>; userId: string } | NextResponse> {
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

  // Support admin impersonation: use the impersonated user's email for crew lookup
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
 * GET - Fetch the logged-in user's availability records
 */
export async function GET() {
  const result = await resolveCrewMember();
  if (result instanceof NextResponse) return result;
  const { crewMember } = result;

  try {
    const records = await getCrewAvailabilities({ crewMemberId: crewMember.id });

    return NextResponse.json({
      crewMember: {
        id: crewMember.id,
        name: crewMember.name,
        locations: crewMember.locations,
        role: crewMember.role,
      },
      records,
    });
  } catch (error) {
    console.error("Error fetching my availability:", error);
    return NextResponse.json({ error: "Failed to fetch availability" }, { status: 500 });
  }
}

/**
 * POST - Create a new availability slot for the logged-in crew member
 */
export async function POST(request: NextRequest) {
  const result = await resolveCrewMember();
  if (result instanceof NextResponse) return result;
  const { crewMember, userId } = result;

  try {
    const body = await request.json();
    const { location, reportLocation, jobType, dayOfWeek, startTime, endTime, timezone, isActive } = body;

    if (!location || !jobType || dayOfWeek === undefined || !startTime || !endTime) {
      return NextResponse.json({
        error: "Required: location, jobType, dayOfWeek, startTime, endTime",
      }, { status: 400 });
    }

    if (dayOfWeek < 0 || dayOfWeek > 6) {
      return NextResponse.json({ error: "dayOfWeek must be 0-6" }, { status: 400 });
    }

    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      return NextResponse.json({ error: "Times must be HH:mm format" }, { status: 400 });
    }

    if (startTime >= endTime) {
      return NextResponse.json({ error: "startTime must be before endTime" }, { status: 400 });
    }

    const record = await upsertCrewAvailability({
      crewMemberId: crewMember.id,
      location,
      reportLocation: reportLocation || location,
      jobType,
      dayOfWeek,
      startTime,
      endTime,
      timezone: timezone || "America/Denver",
      isActive: isActive !== false,
      createdBy: userId,
      updatedBy: userId,
    });

    await logActivity({
      type: "SETTINGS_CHANGED",
      description: `${crewMember.name} added availability: ${location} ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dayOfWeek]} ${startTime}-${endTime}`,
      userId,
      userEmail: crewMember.email || undefined,
      entityType: "crew_availability",
      entityId: record?.id,
    });

    return NextResponse.json({ success: true, record });
  } catch (error) {
    console.error("Error creating availability:", error);
    return NextResponse.json({ error: "Failed to create availability" }, { status: 500 });
  }
}

/**
 * PUT - Update an existing availability slot (ownership verified)
 */
export async function PUT(request: NextRequest) {
  const result = await resolveCrewMember();
  if (result instanceof NextResponse) return result;
  const { crewMember, userId } = result;

  try {
    const body = await request.json();
    const { id, location, reportLocation, jobType, dayOfWeek, startTime, endTime, timezone, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // Verify ownership — the record must belong to this crew member
    const existing = await prisma!.crewAvailability.findUnique({ where: { id } });
    if (!existing || existing.crewMemberId !== crewMember.id) {
      return NextResponse.json({ error: "Record not found or not yours" }, { status: 404 });
    }

    if (!location || !jobType || dayOfWeek === undefined || !startTime || !endTime) {
      return NextResponse.json({
        error: "Required: location, jobType, dayOfWeek, startTime, endTime",
      }, { status: 400 });
    }

    if (startTime >= endTime) {
      return NextResponse.json({ error: "startTime must be before endTime" }, { status: 400 });
    }

    const record = await upsertCrewAvailability({
      id,
      crewMemberId: crewMember.id,
      location,
      reportLocation: reportLocation || location,
      jobType,
      dayOfWeek,
      startTime,
      endTime,
      timezone: timezone || existing.timezone,
      isActive: isActive !== undefined ? isActive : existing.isActive,
      updatedBy: userId,
    });

    await logActivity({
      type: "SETTINGS_CHANGED",
      description: `${crewMember.name} updated availability: ${location} ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dayOfWeek]} ${startTime}-${endTime}`,
      userId,
      userEmail: crewMember.email || undefined,
      entityType: "crew_availability",
      entityId: id,
    });

    return NextResponse.json({ success: true, record });
  } catch (error) {
    console.error("Error updating availability:", error);
    return NextResponse.json({ error: "Failed to update availability" }, { status: 500 });
  }
}

/**
 * DELETE - Remove an availability slot (ownership verified)
 */
export async function DELETE(request: NextRequest) {
  const result = await resolveCrewMember();
  if (result instanceof NextResponse) return result;
  const { crewMember, userId } = result;

  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // Verify ownership
    const existing = await prisma!.crewAvailability.findUnique({ where: { id } });
    if (!existing || existing.crewMemberId !== crewMember.id) {
      return NextResponse.json({ error: "Record not found or not yours" }, { status: 404 });
    }

    await deleteCrewAvailability(id);

    await logActivity({
      type: "SETTINGS_CHANGED",
      description: `${crewMember.name} deleted availability slot`,
      userId,
      userEmail: crewMember.email || undefined,
      entityType: "crew_availability",
      entityId: id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting availability:", error);
    return NextResponse.json({ error: "Failed to delete availability" }, { status: 500 });
  }
}
