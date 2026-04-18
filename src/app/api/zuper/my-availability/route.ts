/**
 * Self-Service Crew Availability API
 *
 * GET  /api/zuper/my-availability - Get logged-in user's crew profile + availability + pending requests
 * POST /api/zuper/my-availability - Submit a request to add a new availability slot
 * PUT  /api/zuper/my-availability - Submit a request to modify an existing slot (ownership verified)
 * DELETE /api/zuper/my-availability - Submit a request to remove a slot (ownership verified)
 *
 * Links the logged-in user to their CrewMember record via email matching.
 * All mutation operations create AvailabilityChangeRequest records pending admin approval.
 */

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/auth";
import {
  prisma,
  getUserByEmail,
  getCrewMemberByEmail,
  getCrewAvailabilities,
} from "@/lib/db";
import { logAdminActivity, extractRequestContext } from "@/lib/audit/admin-activity";

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
    currentUser.roles?.includes("ADMIN") &&
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

    // Also fetch any pending change requests for this crew member
    const pendingRequests = await prisma!.availabilityChangeRequest.findMany({
      where: { crewMemberId: crewMember.id, status: "pending" },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      crewMember: {
        id: crewMember.id,
        name: crewMember.name,
        locations: crewMember.locations,
        role: crewMember.role,
      },
      records,
      pendingRequests,
    });
  } catch (error) {
    console.error("Error fetching my availability:", error);
    return NextResponse.json({ error: "Failed to fetch availability" }, { status: 500 });
  }
}

/**
 * POST - Submit a request to add a new availability slot (pending admin approval)
 */
export async function POST(request: NextRequest) {
  const result = await resolveCrewMember();
  if (result instanceof NextResponse) return result;
  const { crewMember, userId } = result;

  try {
    const body = await request.json();
    const { location, jobType, dayOfWeek, startTime, endTime } = body;

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

    const changeRequest = await prisma!.availabilityChangeRequest.create({
      data: {
        crewMemberId: crewMember.id,
        requestType: "add",
        dayOfWeek: body.dayOfWeek,
        startTime: body.startTime,
        endTime: body.endTime,
        location: body.location,
        jobType: body.jobType,
        reason: body.reason,
        status: "pending",
      },
    });

    const headersList = await headers();
    const reqCtx = extractRequestContext(headersList);
    await logAdminActivity({
      type: "AVAILABILITY_CHANGED",
      description: `${crewMember.name} requested to add availability: ${location} ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dayOfWeek]} ${startTime}-${endTime}`,
      userId,
      userEmail: crewMember.email || "unknown",
      userName: crewMember.name,
      entityType: "crew_availability",
      entityId: changeRequest.id,
      requestPath: "/api/zuper/my-availability",
      requestMethod: "POST",
      ...reqCtx,
    });

    return NextResponse.json({ success: true, request: changeRequest });
  } catch (error) {
    console.error("Error submitting availability request:", error);
    return NextResponse.json({ error: "Failed to submit availability request" }, { status: 500 });
  }
}

/**
 * PUT - Submit a request to modify an existing availability slot (ownership verified, pending admin approval)
 */
export async function PUT(request: NextRequest) {
  const result = await resolveCrewMember();
  if (result instanceof NextResponse) return result;
  const { crewMember, userId } = result;

  try {
    const body = await request.json();
    const { id, location, jobType, dayOfWeek, startTime, endTime } = body;

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

    const changeRequest = await prisma!.availabilityChangeRequest.create({
      data: {
        crewMemberId: crewMember.id,
        requestType: "modify",
        originalSlotId: id,
        dayOfWeek: body.dayOfWeek,
        startTime: body.startTime,
        endTime: body.endTime,
        location: body.location,
        jobType: body.jobType,
        reason: body.reason,
        status: "pending",
      },
    });

    const headersList = await headers();
    const reqCtx = extractRequestContext(headersList);
    await logAdminActivity({
      type: "AVAILABILITY_CHANGED",
      description: `${crewMember.name} requested to modify availability: ${location} ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dayOfWeek]} ${startTime}-${endTime}`,
      userId,
      userEmail: crewMember.email || "unknown",
      userName: crewMember.name,
      entityType: "crew_availability",
      entityId: changeRequest.id,
      requestPath: "/api/zuper/my-availability",
      requestMethod: "PUT",
      ...reqCtx,
    });

    return NextResponse.json({ success: true, request: changeRequest });
  } catch (error) {
    console.error("Error submitting availability modification request:", error);
    return NextResponse.json({ error: "Failed to submit availability modification request" }, { status: 500 });
  }
}

/**
 * DELETE - Submit a request to remove an availability slot (ownership verified, pending admin approval)
 */
export async function DELETE(request: NextRequest) {
  const result = await resolveCrewMember();
  if (result instanceof NextResponse) return result;
  const { crewMember, userId } = result;

  try {
    const body = await request.json();
    const { id, reason } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // Verify ownership
    const existing = await prisma!.crewAvailability.findUnique({ where: { id } });
    if (!existing || existing.crewMemberId !== crewMember.id) {
      return NextResponse.json({ error: "Record not found or not yours" }, { status: 404 });
    }

    const changeRequest = await prisma!.availabilityChangeRequest.create({
      data: {
        crewMemberId: crewMember.id,
        requestType: "delete",
        originalSlotId: id,
        reason: reason || null,
        status: "pending",
      },
    });

    const headersList = await headers();
    const reqCtx = extractRequestContext(headersList);
    await logAdminActivity({
      type: "AVAILABILITY_CHANGED",
      description: `${crewMember.name} requested to delete availability slot`,
      userId,
      userEmail: crewMember.email || "unknown",
      userName: crewMember.name,
      entityType: "crew_availability",
      entityId: changeRequest.id,
      requestPath: "/api/zuper/my-availability",
      requestMethod: "DELETE",
      ...reqCtx,
    });

    return NextResponse.json({ success: true, request: changeRequest });
  } catch (error) {
    console.error("Error submitting availability deletion request:", error);
    return NextResponse.json({ error: "Failed to submit availability deletion request" }, { status: 500 });
  }
}
