import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, logActivity, prisma, cacheZuperJob, canScheduleType, getCrewMemberByName, UserRole } from "@/lib/db";
import { zuper, createJobFromProject } from "@/lib/zuper";
import { headers } from "next/headers";
import { sendSchedulingNotification } from "@/lib/email";
import { updateDealProperty } from "@/lib/hubspot";

/**
 * POST /api/zuper/jobs/schedule/confirm
 *
 * Confirms a tentative schedule by syncing it to Zuper.
 * Takes a scheduleRecordId, fetches the tentative record,
 * then runs the full Zuper scheduling flow (search/create/reschedule).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }

    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const body = await request.json();
    const { scheduleRecordId } = body;

    if (!scheduleRecordId) {
      return NextResponse.json(
        { error: "scheduleRecordId is required" },
        { status: 400 }
      );
    }

    // Fetch the tentative record
    const record = await prisma.scheduleRecord.findUnique({
      where: { id: scheduleRecordId },
    });

    if (!record) {
      return NextResponse.json({ error: "Schedule record not found" }, { status: 404 });
    }

    if (record.status !== "tentative") {
      return NextResponse.json(
        { error: `Record is not tentative (current status: ${record.status})` },
        { status: 400 }
      );
    }

    // Check schedule type permission
    const scheduleType = record.scheduleType as "survey" | "installation" | "inspection";
    if (!canScheduleType(user.role as UserRole, scheduleType)) {
      return NextResponse.json(
        { error: `You don't have permission to schedule ${scheduleType}s.` },
        { status: 403 }
      );
    }

    // Check if Zuper is configured
    if (!zuper.isConfigured()) {
      return NextResponse.json(
        { error: "Zuper integration not configured" },
        { status: 503 }
      );
    }

    // Build project object for Zuper
    const project = {
      id: record.projectId,
      name: record.projectName,
      address: "",
      city: "",
      state: "",
    };

    // Run the Zuper scheduling flow: search for existing job -> create or reschedule
    const hubspotTag = `hubspot-${record.projectId}`;

    // Extract search terms from the project name
    const nameParts = record.projectName.split(" | ");
    const customerLastName = nameParts.length >= 2
      ? nameParts[1]?.split(",")[0]?.trim() || ""
      : nameParts[0]?.split(",")[0]?.trim() || "";
    const projNumber = nameParts[0]?.trim().match(/PROJ-\d+/i)?.[0] || "";

    let zuperJobUid: string | undefined;
    let zuperError: string | undefined;

    try {
      // Search for existing Zuper job
      const searchResult = await zuper.searchJobs({
        limit: 100,
        search: customerLastName,
      });

      // Category config for matching
      const categoryConfig: Record<string, { name: string; uid: string }> = {
        survey: { name: "Site Survey", uid: "002bac33-84d3-4083-a35d-50626fc49288" },
        installation: { name: "Construction", uid: "6ffbc218-6dad-4a46-b378-1fb02b3ab4bf" },
        inspection: { name: "Inspection", uid: "b7dc03d2-25d0-40df-a2fc-b1a477b16b65" },
      };
      const targetCategoryName = categoryConfig[scheduleType].name;
      const targetCategoryUid = categoryConfig[scheduleType].uid;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const categoryMatches = (job: any): boolean => {
        if (typeof job.job_category === "string") {
          return job.job_category.toLowerCase() === targetCategoryName.toLowerCase() ||
                 job.job_category === targetCategoryUid;
        }
        return job.job_category?.category_name?.toLowerCase() === targetCategoryName.toLowerCase() ||
               job.job_category?.category_uid === targetCategoryUid;
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let existingJob: any = null;

      if (searchResult.type === "success" && searchResult.data?.jobs) {
        // Try matching by HubSpot tag first
        existingJob = searchResult.data.jobs.find(
          (job) => job.job_tags?.some(t => t.toLowerCase() === hubspotTag.toLowerCase()) && categoryMatches(job)
        );

        // Fallback: match by PROJ number or last name
        if (!existingJob && (customerLastName || projNumber)) {
          const normalizedLastName = customerLastName.toLowerCase().trim();
          const normalizedProjNumber = projNumber.toLowerCase().trim();
          existingJob = searchResult.data.jobs.find((job) => {
            const jobTitle = job.job_title?.toLowerCase() || "";
            if (!categoryMatches(job)) return false;
            if (normalizedProjNumber && jobTitle.includes(normalizedProjNumber)) return true;
            if (normalizedLastName.length > 2) {
              return jobTitle.includes(normalizedLastName + ",") ||
                     jobTitle.startsWith(normalizedLastName + " ");
            }
            return false;
          });
        }
      }

      // Calculate schedule times
      const startTime = record.scheduledStart || "08:00";
      const endTime = record.scheduledEnd || "17:00";
      const startDateTime = `${record.scheduledDate} ${startTime}:00`;
      const endDateTime = `${record.scheduledDate} ${endTime}:00`;

      if (existingJob?.job_uid) {
        // Reschedule existing job
        const userUids = record.assignedUserUid
          ? record.assignedUserUid.split(",").map(u => u.trim()).filter(Boolean)
          : [];

        const rescheduleResult = await zuper.rescheduleJob(
          existingJob.job_uid,
          startDateTime,
          endDateTime,
          userUids.length > 0 ? userUids : undefined,
          record.assignedTeamUid || undefined
        );

        if (rescheduleResult.type === "success") {
          zuperJobUid = existingJob.job_uid;
        } else {
          zuperError = rescheduleResult.error;
        }
      } else {
        // Create new job
        const createResult = await createJobFromProject(project, {
          type: scheduleType,
          date: record.scheduledDate,
          days: 1,
          startTime: record.scheduledStart || undefined,
          endTime: record.scheduledEnd || undefined,
          crew: record.assignedUserUid || undefined,
          teamUid: record.assignedTeamUid || undefined,
        });

        if (createResult.type === "success" && createResult.data?.job_uid) {
          zuperJobUid = createResult.data.job_uid;
        } else if (createResult.type === "error") {
          zuperError = createResult.error;
        }
      }
    } catch (zuperErr) {
      zuperError = String(zuperErr);
    }

    // Update the schedule record
    await prisma.scheduleRecord.update({
      where: { id: scheduleRecordId },
      data: {
        status: "scheduled",
        zuperSynced: !zuperError,
        zuperJobUid: zuperJobUid || undefined,
        zuperError: zuperError || null,
        notes: record.notes?.replace("[TENTATIVE]", "[CONFIRMED]") || "[CONFIRMED]",
      },
    });

    // Cache the Zuper job if created
    if (zuperJobUid) {
      await cacheZuperJob({
        jobUid: zuperJobUid,
        jobTitle: `${scheduleType} - ${record.projectName}`,
        jobCategory: scheduleType === "survey" ? "Site Survey" : scheduleType === "inspection" ? "Inspection" : "Construction",
        jobStatus: "SCHEDULED",
        hubspotDealId: record.projectId,
        projectName: record.projectName,
      });
    }

    // Update HubSpot deal with schedule date (fire and forget)
    try {
      const hubspotField = scheduleType === "survey" ? "site_survey_scheduled_date"
        : scheduleType === "installation" ? "construction_scheduled_date"
        : "inspection_scheduled_date";
      await updateDealProperty(record.projectId, { [hubspotField]: record.scheduledDate });
    } catch (hubspotErr) {
      console.warn("Failed to update HubSpot deal:", hubspotErr);
    }

    // Send notification to assigned crew member (fire and forget)
    try {
      if (record.assignedUser) {
        const crewMember = await getCrewMemberByName(record.assignedUser);
        if (crewMember?.email) {
          const customerNameParts = record.projectName.split(" | ");
          const customerName = customerNameParts.length >= 2
            ? customerNameParts[1]?.trim()
            : customerNameParts[0]?.trim() || "Customer";
          const customerAddress = customerNameParts.length >= 3
            ? customerNameParts[2]?.trim()
            : "See Zuper for address";

          await sendSchedulingNotification({
            to: crewMember.email,
            crewMemberName: record.assignedUser,
            scheduledByName: session.user.name || session.user.email,
            scheduledByEmail: session.user.email,
            appointmentType: scheduleType,
            customerName,
            customerAddress,
            scheduledDate: record.scheduledDate,
            scheduledStart: record.scheduledStart || undefined,
            scheduledEnd: record.scheduledEnd || undefined,
            projectId: record.projectId,
            notes: record.notes || undefined,
          });
        }
      }
    } catch (emailErr) {
      console.warn("Failed to send scheduling notification:", emailErr);
    }

    const hdrs = await headers();
    const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const userAgent = hdrs.get("user-agent") || "unknown";

    const activityType =
      scheduleType === "survey"
        ? "SURVEY_SCHEDULED"
        : scheduleType === "inspection"
          ? "INSPECTION_SCHEDULED"
          : "INSTALL_SCHEDULED";

    await logActivity({
      type: activityType,
      description: `Confirmed tentative ${scheduleType} for ${record.projectName}`,
      userEmail: session.user.email,
      userName: session.user.name || undefined,
      entityType: "schedule_record",
      entityId: record.id,
      entityName: record.projectName,
      metadata: {
        confirmed: true,
        scheduleType,
        scheduledDate: record.scheduledDate,
        projectId: record.projectId,
        zuperJobUid,
        zuperError,
      },
      ipAddress: ip,
      userAgent,
    });

    return NextResponse.json({
      success: true,
      confirmed: true,
      zuperSynced: !zuperError,
      zuperJobUid,
      zuperError,
      record: {
        id: record.id,
        projectId: record.projectId,
        scheduledDate: record.scheduledDate,
        status: "scheduled",
      },
      message: zuperError
        ? `Schedule confirmed but Zuper sync failed: ${zuperError}`
        : `${scheduleType} confirmed and synced to Zuper`,
    });
  } catch (error) {
    console.error("Error confirming tentative schedule:", error);
    return NextResponse.json(
      { error: "Failed to confirm schedule", details: String(error) },
      { status: 500 }
    );
  }
}
