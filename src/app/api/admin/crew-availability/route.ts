import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail, getCrewAvailabilities, upsertCrewAvailability, deleteCrewAvailability, logActivity } from "@/lib/db";

/**
 * GET /api/admin/crew-availability
 * List all crew availability records
 */
export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || (!currentUser.canManageAvailability && currentUser.role !== "ADMIN")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const crewMemberId = searchParams.get("crewMemberId") || undefined;
    const location = searchParams.get("location") || undefined;
    const jobType = searchParams.get("jobType") || undefined;
    const dayOfWeek = searchParams.get("dayOfWeek") !== null ? parseInt(searchParams.get("dayOfWeek")!) : undefined;

    const records = await getCrewAvailabilities({
      crewMemberId,
      location,
      jobType,
      dayOfWeek: isNaN(dayOfWeek as number) ? undefined : dayOfWeek,
    });

    return NextResponse.json({ records });
  } catch (error) {
    console.error("Error fetching crew availability:", error);
    return NextResponse.json({ error: "Failed to fetch crew availability" }, { status: 500 });
  }
}

/**
 * POST /api/admin/crew-availability
 * Create a new crew availability slot
 */
export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || (!currentUser.canManageAvailability && currentUser.role !== "ADMIN")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { crewMemberId, location, reportLocation, jobType, dayOfWeek, startTime, endTime, timezone, isActive } = body;

    if (!crewMemberId || !location || !jobType || dayOfWeek === undefined || !startTime || !endTime) {
      return NextResponse.json({
        error: "Required: crewMemberId, location, jobType, dayOfWeek, startTime, endTime",
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
      crewMemberId,
      location,
      reportLocation,
      jobType,
      dayOfWeek,
      startTime,
      endTime,
      timezone,
      isActive,
      createdBy: currentUser.id,
      updatedBy: currentUser.id,
    });

    await logActivity({
      type: "SETTINGS_CHANGED",
      description: `Created crew availability slot: ${location} ${dayOfWeek} ${startTime}-${endTime}`,
      userId: currentUser.id,
      userEmail: currentUser.email,
      entityType: "crew_availability",
      entityId: record?.id,
    });

    return NextResponse.json({ success: true, record });
  } catch (error) {
    console.error("Error creating crew availability:", error);
    return NextResponse.json({ error: "Failed to create crew availability" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/crew-availability
 * Update an existing crew availability slot
 */
export async function PUT(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || (!currentUser.canManageAvailability && currentUser.role !== "ADMIN")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { id, crewMemberId, location, reportLocation, jobType, dayOfWeek, startTime, endTime, timezone, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    if (!crewMemberId || !location || !jobType || dayOfWeek === undefined || !startTime || !endTime) {
      return NextResponse.json({
        error: "Required: crewMemberId, location, jobType, dayOfWeek, startTime, endTime",
      }, { status: 400 });
    }

    if (startTime >= endTime) {
      return NextResponse.json({ error: "startTime must be before endTime" }, { status: 400 });
    }

    const record = await upsertCrewAvailability({
      id,
      crewMemberId,
      location,
      reportLocation,
      jobType,
      dayOfWeek,
      startTime,
      endTime,
      timezone,
      isActive,
      updatedBy: currentUser.id,
    });

    await logActivity({
      type: "SETTINGS_CHANGED",
      description: `Updated crew availability slot: ${location} ${dayOfWeek} ${startTime}-${endTime}`,
      userId: currentUser.id,
      userEmail: currentUser.email,
      entityType: "crew_availability",
      entityId: id,
    });

    return NextResponse.json({ success: true, record });
  } catch (error) {
    console.error("Error updating crew availability:", error);
    return NextResponse.json({ error: "Failed to update crew availability" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/crew-availability
 * Remove a crew availability slot
 */
export async function DELETE(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || (!currentUser.canManageAvailability && currentUser.role !== "ADMIN")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await deleteCrewAvailability(id);

    await logActivity({
      type: "SETTINGS_CHANGED",
      description: `Deleted crew availability slot`,
      userId: currentUser.id,
      userEmail: currentUser.email,
      entityType: "crew_availability",
      entityId: id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting crew availability:", error);
    return NextResponse.json({ error: "Failed to delete crew availability" }, { status: 500 });
  }
}
