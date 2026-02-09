import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/zuper/schedule-records
 *
 * Returns the latest schedule record for each project ID.
 * Used by schedulers to display who was assigned.
 *
 * Query params:
 * - projectIds: comma-separated list of project IDs
 * - type: optional schedule type filter (e.g., "survey", "installation", "inspection")
 */
export async function GET(request: NextRequest) {
  if (!prisma) {
    return NextResponse.json({ records: {} });
  }

  const { searchParams } = new URL(request.url);
  const projectIdsParam = searchParams.get("projectIds");
  const scheduleType = searchParams.get("type");

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
      },
      orderBy: { createdAt: "desc" },
      select: {
        projectId: true,
        assignedUser: true,
        assignedUserUid: true,
        scheduledDate: true,
        scheduledStart: true,
        scheduledEnd: true,
        zuperJobUid: true,
        zuperAssigned: true,
        zuperError: true,
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
