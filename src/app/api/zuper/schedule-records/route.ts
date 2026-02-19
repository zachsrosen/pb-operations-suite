import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";

/**
 * GET /api/zuper/schedule-records
 *
 * Returns the latest schedule record for each project ID.
 * Used by schedulers to display who was assigned.
 *
 * Query params:
 * - projectIds: comma-separated list of project IDs
 * - type: optional schedule type filter (e.g., "survey", "installation", "inspection")
 * - status: optional status filter (e.g., "scheduled", "tentative", "cancelled")
 */
export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!prisma) {
    return NextResponse.json({ records: {} });
  }

  const { searchParams } = new URL(request.url);
  const projectIdsParam = searchParams.get("projectIds");
  const scheduleType = searchParams.get("type");
  const status = searchParams.get("status");

  if (!projectIdsParam) {
    return NextResponse.json(
      { error: "projectIds parameter required" },
      { status: 400 }
    );
  }

  const projectIds = projectIdsParam.split(",").map(id => id.trim()).filter(Boolean);

  if (projectIds.length === 0) {
    return NextResponse.json({ records: {} });
  }

  try {
    const records = await prisma.scheduleRecord.findMany({
      where: {
        projectId: { in: projectIds },
        ...(scheduleType && { scheduleType }),
        ...(status && { status }),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        projectId: true,
        assignedUser: true,
        assignedUserUid: true,
        scheduledBy: true,
        scheduledByEmail: true,
        scheduledDate: true,
        scheduledDays: true,
        scheduledStart: true,
        scheduledEnd: true,
        scheduleType: true,
        zuperJobUid: true,
        zuperAssigned: true,
        zuperError: true,
        status: true,
        notes: true,
        createdAt: true,
      },
    });

    // Group by project ID, keep only the latest record per project
    const recordMap: Record<string, typeof records[0]> = {};
    for (const record of records) {
      if (!recordMap[record.projectId]) {
        recordMap[record.projectId] = record;
      }
    }

    return NextResponse.json({ records: recordMap });
  } catch (error) {
    console.error("Error fetching schedule records:", error);
    return NextResponse.json(
      { error: "Failed to fetch schedule records" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/zuper/schedule-records
 *
 * Cancel a tentative schedule record.
 * Only records with status "tentative" can be cancelled this way.
 *
 * Body: { recordId: string }
 */
export async function DELETE(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { recordId } = body;

    if (!recordId) {
      return NextResponse.json({ error: "recordId is required" }, { status: 400 });
    }

    const record = await prisma.scheduleRecord.findUnique({
      where: { id: recordId },
    });

    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    if (record.status !== "tentative") {
      return NextResponse.json(
        { error: "Only tentative records can be cancelled this way" },
        { status: 400 }
      );
    }

    await prisma.scheduleRecord.update({
      where: { id: recordId },
      data: { status: "cancelled" },
    });

    return NextResponse.json({
      success: true,
      message: `Tentative schedule for ${record.projectName} cancelled`,
    });
  } catch (error) {
    console.error("Error cancelling schedule record:", error);
    return NextResponse.json(
      { error: "Failed to cancel schedule record" },
      { status: 500 }
    );
  }
}
