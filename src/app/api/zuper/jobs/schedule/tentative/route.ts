import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, logActivity, createScheduleRecord, canScheduleType, prisma, UserRole } from "@/lib/db";
import { headers } from "next/headers";

/**
 * PUT /api/zuper/jobs/schedule/tentative
 *
 * Creates a tentative schedule record WITHOUT syncing to Zuper.
 * Same validation as the main schedule endpoint, but skips Zuper API calls.
 * The record can later be confirmed via POST /api/zuper/jobs/schedule/confirm.
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }

    const body = await request.json();
    const { project, schedule } = body;

    const scheduleType = schedule?.type as "survey" | "installation" | "inspection";
    if (!scheduleType || !["survey", "installation", "inspection"].includes(scheduleType)) {
      return NextResponse.json(
        { error: "Invalid schedule type. Must be: survey, installation, or inspection" },
        { status: 400 }
      );
    }

    if (!canScheduleType(user.role as UserRole, scheduleType)) {
      return NextResponse.json(
        { error: `You don't have permission to schedule ${scheduleType}s.` },
        { status: 403 }
      );
    }

    if (!project?.id || !schedule?.date) {
      return NextResponse.json(
        { error: "Missing required fields: project.id, schedule.date" },
        { status: 400 }
      );
    }

    // Create schedule record with tentative status (NO Zuper sync)
    const record = await createScheduleRecord({
      scheduleType,
      projectId: String(project.id),
      projectName: project.name || "Unknown",
      scheduledDate: schedule.date,
      scheduledStart: schedule.startTime,
      scheduledEnd: schedule.endTime,
      assignedUser: schedule.crew || schedule.assignedUser,
      assignedUserUid: schedule.userUid,
      assignedTeamUid: schedule.teamUid,
      scheduledBy: session.user.email,
      zuperSynced: false,
      zuperAssigned: false,
      notes: schedule.notes ? `[TENTATIVE] ${schedule.notes}` : "[TENTATIVE]",
    });

    // Update status to "tentative" (createScheduleRecord defaults to "scheduled")
    if (record && prisma) {
      await prisma.scheduleRecord.update({
        where: { id: record.id },
        data: { status: "tentative" },
      });
    }

    const hdrs = await headers();
    const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const userAgent = hdrs.get("user-agent") || "unknown";

    await logActivity({
      type: "INSTALL_SCHEDULED",
      description: `Tentatively scheduled ${scheduleType} for ${project.name || project.id}`,
      userEmail: session.user.email,
      userName: session.user.name || undefined,
      entityType: "schedule_record",
      entityId: record?.id,
      entityName: project.name,
      metadata: {
        tentative: true,
        scheduleType,
        scheduledDate: schedule.date,
        projectId: project.id,
        crew: schedule.crew,
      },
      ipAddress: ip,
      userAgent,
    });

    return NextResponse.json({
      success: true,
      tentative: true,
      record: record ? {
        id: record.id,
        projectId: record.projectId,
        scheduledDate: record.scheduledDate,
        assignedUser: record.assignedUser,
        status: "tentative",
      } : null,
      message: `${scheduleType} tentatively scheduled for ${schedule.date} (not synced to Zuper)`,
    });
  } catch (error) {
    console.error("Error creating tentative schedule:", error);
    return NextResponse.json(
      { error: "Failed to create tentative schedule", details: String(error) },
      { status: 500 }
    );
  }
}
