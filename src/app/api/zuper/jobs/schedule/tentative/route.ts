import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, logActivity, createScheduleRecord, canScheduleType, prisma, UserRole } from "@/lib/db";
import { headers } from "next/headers";
import { getSalesSurveyLeadTimeError, resolveEffectiveRoleFromRequest, resolveEffectiveRolesFromRequest } from "@/lib/scheduling-policy";

/**
 * PUT /api/zuper/jobs/schedule/tentative
 *
 * Creates a tentative schedule record WITHOUT syncing to Zuper.
 * Same validation as the main schedule endpoint, but skips Zuper API calls.
 * The record can later be confirmed via POST /api/zuper/jobs/schedule/confirm.
 * Also supports pendingZuper=true for schedules held locally after a failed
 * live Zuper sync, usually because the expected Zuper job does not exist yet.
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
    const userRolesForPolicy: UserRole[] = user.roles ?? [];
    const effectiveRole = resolveEffectiveRoleFromRequest(request, userRolesForPolicy[0] as UserRole);

    const body = await request.json();
    const { project, schedule } = body;
    const pendingZuper = schedule?.pendingZuper === true;
    const recordStatus = pendingZuper ? "pending_zuper" : "tentative";
    const recordPrefix = pendingZuper ? "[PENDING_ZUPER]" : "[TENTATIVE]";

    const scheduleType = schedule?.type as "survey" | "pre-sale-survey" | "installation" | "inspection";
    if (!scheduleType || !["survey", "pre-sale-survey", "installation", "inspection"].includes(scheduleType)) {
      return NextResponse.json(
        { error: "Invalid schedule type. Must be: survey, pre-sale-survey, installation, or inspection" },
        { status: 400 }
      );
    }

    if (!canScheduleType(effectiveRole, scheduleType)) {
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
    const effectiveRoles = resolveEffectiveRolesFromRequest(request, userRolesForPolicy);
    const salesLeadTimeError = getSalesSurveyLeadTimeError({
      roles: effectiveRoles,
      scheduleType,
      scheduleDate: schedule.date,
      timezone: typeof schedule.timezone === "string" ? schedule.timezone : undefined,
    });
    if (salesLeadTimeError) {
      return NextResponse.json({ error: salesLeadTimeError }, { status: 403 });
    }

    const rawCrew = typeof schedule.crew === "string" ? schedule.crew : undefined;
    const rawAssignedUser = typeof schedule.assignedUser === "string" ? schedule.assignedUser : undefined;
    const rawUserUid = typeof schedule.userUid === "string" ? schedule.userUid : undefined;
    const rawZuperJobUid = typeof project?.zuperJobUid === "string" ? project.zuperJobUid.trim() : "";
    const rawTimezone = typeof schedule.timezone === "string" ? schedule.timezone.trim() : "";
    const looksLikeUid = (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
    const looksLikeUidList = (value: string) =>
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .every((part) => looksLikeUid(part));
    const normalizedAssignedUserUid =
      (rawCrew && looksLikeUidList(rawCrew) ? rawCrew : undefined) ||
      (rawUserUid && (looksLikeUid(rawUserUid) || looksLikeUidList(rawUserUid)) ? rawUserUid : undefined) ||
      (rawCrew && looksLikeUid(rawCrew) ? rawCrew : undefined);
    const timezoneTag = rawTimezone ? ` [TZ:${rawTimezone}]` : "";

    // Ensure only one active local-hold record per project + schedule type.
    // Without this, old tentative/pending rows can reappear in scheduler rehydration.
    if (prisma) {
      await prisma.scheduleRecord.updateMany({
        where: {
          projectId: String(project.id),
          scheduleType,
          status: { in: ["tentative", "pending_zuper"] },
        },
        data: {
          status: "cancelled",
        },
      });
      await prisma.bookedSlot.deleteMany({
        where: {
          projectId: String(project.id),
          source: { in: ["tentative", "pending_zuper"] },
        },
      });
    }

    // Create schedule record with local-hold status (NO Zuper sync)
    const record = await createScheduleRecord({
      scheduleType,
      projectId: String(project.id),
      projectName: project.name || "Unknown",
      scheduledDate: schedule.date,
      scheduledDays: schedule.days ? Number(schedule.days) : undefined,
      scheduledStart: schedule.startTime,
      scheduledEnd: schedule.endTime,
      // Prefer display name; crew may be a UID in some clients.
      assignedUser: rawAssignedUser || (rawCrew && !looksLikeUid(rawCrew) ? rawCrew : undefined),
      assignedUserUid: normalizedAssignedUserUid,
      assignedTeamUid: schedule.teamUid,
      scheduledBy: session.user.name || session.user.email,
      scheduledByEmail: session.user.email,
      zuperJobUid: rawZuperJobUid || undefined,
      zuperSynced: false,
      zuperAssigned: false,
      zuperError: pendingZuper && typeof schedule.zuperError === "string"
        ? schedule.zuperError.slice(0, 1000)
        : undefined,
      notes: schedule.notes ? `${recordPrefix} ${schedule.notes}${timezoneTag}` : `${recordPrefix}${timezoneTag}`,
    });

    // Update status (createScheduleRecord defaults to "scheduled")
    if (record && prisma) {
      await prisma.scheduleRecord.update({
        where: { id: record.id },
        data: { status: recordStatus },
      });
    }

    const hdrs = await headers();
    const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const userAgent = hdrs.get("user-agent") || "unknown";

    const activityType =
      (scheduleType === "survey" || scheduleType === "pre-sale-survey")
        ? "SURVEY_SCHEDULED"
        : scheduleType === "inspection"
          ? "INSPECTION_SCHEDULED"
          : "INSTALL_SCHEDULED";

    await logActivity({
      type: activityType,
      description: pendingZuper
        ? `Saved pending Zuper ${scheduleType} for ${project.name || project.id}`
        : `Tentatively scheduled ${scheduleType} for ${project.name || project.id}`,
      userEmail: session.user.email,
      userName: session.user.name || undefined,
      entityType: "schedule_record",
      entityId: record?.id,
      entityName: project.name,
      metadata: {
        tentative: !pendingZuper,
        pendingZuper,
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
      tentative: !pendingZuper,
      pendingZuper,
      record: record ? {
        id: record.id,
        projectId: record.projectId,
        scheduledDate: record.scheduledDate,
        assignedUser: record.assignedUser,
        status: recordStatus,
      } : null,
      message: pendingZuper
        ? `${scheduleType} saved locally for ${schedule.date} (pending Zuper job)`
        : `${scheduleType} tentatively scheduled for ${schedule.date} (not synced to Zuper)`,
    });
  } catch (error) {
    console.error("Error creating tentative schedule:", error);
    return NextResponse.json(
      { error: "Failed to create tentative schedule" },
      { status: 500 }
    );
  }
}
