/**
 * Admin Availability Override API
 *
 * GET    /api/admin/crew-availability/overrides - List overrides (filterable)
 * POST   /api/admin/crew-availability/overrides - Create a date-specific override
 * DELETE /api/admin/crew-availability/overrides - Remove an override
 *
 * Requires ADMIN role or canManageAvailability permission.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  prisma,
  getUserByEmail,
  getAvailabilityOverrides,
  upsertAvailabilityOverride,
  deleteAvailabilityOverride,
  logActivity,
} from "@/lib/db";

async function verifyPermission() {
  const session = await auth();
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  if (!prisma) {
    return { error: NextResponse.json({ error: "Database not configured" }, { status: 500 }) };
  }
  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || (!currentUser.canManageAvailability && currentUser.role !== "ADMIN")) {
    return { error: NextResponse.json({ error: "Permission denied" }, { status: 403 }) };
  }
  return { currentUser };
}

/**
 * GET - List overrides with optional filters
 */
export async function GET(request: NextRequest) {
  const result = await verifyPermission();
  if ("error" in result) return result.error;

  try {
    const { searchParams } = new URL(request.url);
    const crewMemberId = searchParams.get("crewMemberId") || undefined;
    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;

    const records = await getAvailabilityOverrides({ crewMemberId, dateFrom, dateTo });
    return NextResponse.json({ records });
  } catch (error) {
    console.error("Error fetching overrides:", error);
    return NextResponse.json({ error: "Failed to fetch overrides" }, { status: 500 });
  }
}

/**
 * POST - Create a date-specific override (block or custom)
 */
export async function POST(request: NextRequest) {
  const result = await verifyPermission();
  if ("error" in result) return result.error;
  const { currentUser } = result;

  try {
    const body = await request.json();
    const { crewMemberId, date, availabilityId, type, reason, startTime, endTime } = body;

    // Validate required fields
    if (!crewMemberId || !date || !type) {
      return NextResponse.json(
        { error: "crewMemberId, date, and type are required" },
        { status: 400 }
      );
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Date must be YYYY-MM-DD format" }, { status: 400 });
    }

    // Validate type
    if (!["blocked", "custom"].includes(type)) {
      return NextResponse.json({ error: "Type must be 'blocked' or 'custom'" }, { status: 400 });
    }

    // For custom type, require start/end times
    if (type === "custom" && (!startTime || !endTime)) {
      return NextResponse.json(
        { error: "startTime and endTime required for custom overrides" },
        { status: 400 }
      );
    }

    const record = await upsertAvailabilityOverride({
      crewMemberId,
      date,
      availabilityId: availabilityId || null,
      type,
      reason: reason || null,
      startTime: startTime || null,
      endTime: endTime || null,
      createdBy: currentUser!.id,
      updatedBy: currentUser!.id,
    });

    await logActivity({
      type: "SETTINGS_CHANGED",
      description: `Created ${type} override for ${date}`,
      userId: currentUser!.id,
      userEmail: currentUser!.email,
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
 * DELETE - Remove an override by ID
 */
export async function DELETE(request: NextRequest) {
  const result = await verifyPermission();
  if ("error" in result) return result.error;
  const { currentUser } = result;

  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await deleteAvailabilityOverride(id);

    await logActivity({
      type: "SETTINGS_CHANGED",
      description: `Deleted availability override ${id}`,
      userId: currentUser!.id,
      userEmail: currentUser!.email,
      entityType: "availability_override",
      entityId: id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting override:", error);
    return NextResponse.json({ error: "Failed to delete override" }, { status: 500 });
  }
}
