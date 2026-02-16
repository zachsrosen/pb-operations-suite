import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, logActivity, prisma, cacheZuperJob, canScheduleType, getCrewMemberByName, UserRole } from "@/lib/db";
import { zuper, JOB_CATEGORY_UIDS } from "@/lib/zuper";
import { headers } from "next/headers";
import { sendSchedulingNotification } from "@/lib/email";
import { updateDealProperty, updateSiteSurveyorProperty, getDealProperties } from "@/lib/hubspot";

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
    const projectNameParts = record.projectName.split(" | ");
    const derivedCustomerName = projectNameParts.length >= 2
      ? projectNameParts[1]?.trim() || ""
      : projectNameParts[0]?.trim() || "";
    const derivedAddress = projectNameParts.length >= 3
      ? projectNameParts[2]?.trim() || ""
      : "";
    const project = {
      id: record.projectId,
      name: record.projectName,
      address: derivedAddress,
      city: "",
      state: "",
      customerName: derivedCustomerName,
    };

    // Resolve assignment UIDs from record data so tentative confirms can still
    // assign when only a crew name was stored (e.g. test-slot workflows).
    const isUuid = (value?: string | null) =>
      !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    const desiredAssigneeName = record.assignedUser?.trim() || "";
    const resolvedUserUids = record.assignedUserUid
      ? record.assignedUserUid.split(",").map((u) => u.trim()).filter(Boolean)
      : [];
    let resolvedTeamUid = record.assignedTeamUid || undefined;

    if (resolvedUserUids.length === 0 && desiredAssigneeName) {
      if (isUuid(desiredAssigneeName)) {
        resolvedUserUids.push(desiredAssigneeName);
      } else {
        const crewMember = await getCrewMemberByName(desiredAssigneeName);
        if (crewMember?.zuperUserUid) {
          resolvedUserUids.push(crewMember.zuperUserUid);
          if (!resolvedTeamUid && crewMember.zuperTeamUid) {
            resolvedTeamUid = crewMember.zuperTeamUid;
          }
        } else {
          const resolved = await zuper.resolveUserUid(desiredAssigneeName);
          if (resolved?.userUid) {
            resolvedUserUids.push(resolved.userUid);
            if (!resolvedTeamUid && resolved.teamUid) {
              resolvedTeamUid = resolved.teamUid;
            }
          }
        }
      }
    }

    if (desiredAssigneeName && resolvedUserUids.length === 0) {
      return NextResponse.json(
        { error: `Could not resolve Zuper user for assignee "${desiredAssigneeName}".` },
        { status: 422 }
      );
    }

    const timezoneFromNotes = record.notes?.match(/\[TZ:([A-Za-z_\/]+)\]/)?.[1];
    const inferredTimezone = /\b(San Luis Obispo|Camarillo)\b|,\s*CA\b/i.test(record.projectName)
      ? "America/Los_Angeles"
      : "America/Denver";
    const slotTimezone = timezoneFromNotes || inferredTimezone;

    const localToUtc = (dateStr: string, timeStr: string): string => {
      const [year, month, day] = dateStr.split("-").map(Number);
      const [hours, minutes] = (timeStr + ":00").split(":").map(Number);

      const testDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      const localFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: slotTimezone,
        timeZoneName: "longOffset",
      });
      const parts = localFormatter.formatToParts(testDate);
      const tzOffsetStr = parts.find((p) => p.type === "timeZoneName")?.value || "";
      const offsetMatch = tzOffsetStr.match(/GMT([+-])(\d{2}):(\d{2})/);
      let offsetHours: number;
      if (offsetMatch) {
        const sign = offsetMatch[1] === "-" ? 1 : -1;
        offsetHours = sign * parseInt(offsetMatch[2], 10);
      } else {
        const shortFormatter = new Intl.DateTimeFormat("en-US", {
          timeZone: slotTimezone,
          timeZoneName: "short",
        });
        const shortParts = shortFormatter.formatToParts(testDate);
        const shortTzName = shortParts.find((p) => p.type === "timeZoneName")?.value || "";
        const tzOffsets: Record<string, number> = {
          MST: 7, MDT: 6, PST: 8, PDT: 7, CST: 6, CDT: 5, EST: 5, EDT: 4,
        };
        offsetHours = tzOffsets[shortTzName] || 7;
      }

      let utcHours = hours + offsetHours;
      let utcDay = day;
      let utcMonth = month;
      let utcYear = year;
      if (utcHours >= 24) {
        utcHours -= 24;
        utcDay += 1;
        const daysInMonth = new Date(year, month, 0).getDate();
        if (utcDay > daysInMonth) {
          utcDay = 1;
          utcMonth += 1;
          if (utcMonth > 12) {
            utcMonth = 1;
            utcYear += 1;
          }
        }
      }

      return `${utcYear}-${String(utcMonth).padStart(2, "0")}-${String(utcDay).padStart(2, "0")} ${String(utcHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
    };

    // Run the Zuper scheduling flow: search for existing job -> create or reschedule
    const hubspotTag = `hubspot-${record.projectId}`;

    // Extract search terms from the project name
    const nameParts = projectNameParts;
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
        survey: { name: "Site Survey", uid: JOB_CATEGORY_UIDS.SITE_SURVEY },
        installation: { name: "Construction", uid: JOB_CATEGORY_UIDS.CONSTRUCTION },
        inspection: { name: "Inspection", uid: JOB_CATEGORY_UIDS.INSPECTION },
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
      const endTime = record.scheduledEnd || "16:00";
      const startDateTime = localToUtc(record.scheduledDate, startTime);
      let endDateForSchedule = record.scheduledDate;
      if (scheduleType === "installation") {
        const days = Math.max(Math.ceil(record.scheduledDays || 1), 1);
        const [year, month, day] = record.scheduledDate.split("-").map(Number);
        const endDateObj = new Date(year, month - 1, day + (days - 1));
        endDateForSchedule = `${endDateObj.getFullYear()}-${String(endDateObj.getMonth() + 1).padStart(2, "0")}-${String(endDateObj.getDate()).padStart(2, "0")}`;
      }
      const endDateTime = localToUtc(endDateForSchedule, endTime);

      if (existingJob?.job_uid) {
        // Reschedule existing job
        const rescheduleResult = await zuper.rescheduleJob(
          existingJob.job_uid,
          startDateTime,
          endDateTime,
          resolvedUserUids.length > 0 ? resolvedUserUids : undefined,
          resolvedTeamUid
        );

        if (rescheduleResult.type === "success") {
          zuperJobUid = existingJob.job_uid;
        } else {
          zuperError = rescheduleResult.error;
        }
      } else {
        zuperError = `No existing ${scheduleType} job found in Zuper for "${record.projectName}".`;
      }
    } catch (zuperErr) {
      zuperError = String(zuperErr);
    }

    // If Zuper sync failed, keep this as tentative and return a failure so the
    // UI does not treat it as confirmed.
    if (zuperError) {
      await prisma.scheduleRecord.update({
        where: { id: scheduleRecordId },
        data: {
          status: "tentative",
          zuperSynced: false,
          zuperError,
        },
      });

      return NextResponse.json(
        {
          success: false,
          confirmed: false,
          zuperSynced: false,
          zuperError,
          error: `Failed to sync confirmation to Zuper: ${zuperError}`,
        },
        { status: 502 }
      );
    }

    // Update the schedule record only after successful Zuper sync.
    await prisma.scheduleRecord.update({
      where: { id: scheduleRecordId },
      data: {
        status: "scheduled",
        zuperSynced: true,
        zuperJobUid: zuperJobUid || undefined,
        zuperError: null,
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

    // Update HubSpot deal with schedule date + surveyor and verify persistence.
    const hubspotWarnings: string[] = [];
    try {
      let hubspotUpdate: Record<string, string | null>;
      if (scheduleType === "survey") {
        hubspotUpdate = {
          site_survey_schedule_date: record.scheduledDate,
          site_survey_scheduled_date: record.scheduledDate,
        };
      } else if (scheduleType === "installation") {
        hubspotUpdate = {
          install_schedule_date: record.scheduledDate,
          construction_scheduled_date: record.scheduledDate,
        };
      } else {
        hubspotUpdate = {
          inspections_schedule_date: record.scheduledDate,
          inspection_scheduled_date: record.scheduledDate,
        };
      }
      const dateUpdated = await updateDealProperty(record.projectId, hubspotUpdate);
      if (!dateUpdated) {
        hubspotWarnings.push("HubSpot schedule date write failed");
      }
      if (scheduleType === "survey" && record.assignedUser?.trim()) {
        const surveyorUpdated = await updateSiteSurveyorProperty(record.projectId, record.assignedUser.trim());
        if (!surveyorUpdated) {
          hubspotWarnings.push(`HubSpot site_surveyor write failed (${record.assignedUser})`);
        }
      }
      const verificationFields =
        scheduleType === "survey"
          ? ["site_survey_schedule_date", "site_survey_scheduled_date", "site_surveyor"]
          : scheduleType === "installation"
            ? ["install_schedule_date", "construction_scheduled_date"]
            : ["inspections_schedule_date", "inspection_scheduled_date"];
      const verifyProps = await getDealProperties(record.projectId, verificationFields);
      if (!verifyProps) {
        hubspotWarnings.push("HubSpot verification read failed");
      } else {
        const dateValues =
          scheduleType === "survey"
            ? [verifyProps.site_survey_schedule_date, verifyProps.site_survey_scheduled_date]
            : scheduleType === "installation"
              ? [verifyProps.install_schedule_date, verifyProps.construction_scheduled_date]
              : [verifyProps.inspections_schedule_date, verifyProps.inspection_scheduled_date];
        const dateMatched = dateValues.some((v) => String(v || "") === record.scheduledDate);
        if (!dateMatched) {
          hubspotWarnings.push(`HubSpot schedule date verification failed (expected ${record.scheduledDate})`);
        }
        if (scheduleType === "survey" && record.assignedUser?.trim()) {
          const surveyorRaw = String(verifyProps.site_surveyor || "").trim().toLowerCase();
          if (!surveyorRaw || surveyorRaw === "null" || surveyorRaw === "undefined") {
            hubspotWarnings.push("HubSpot site_surveyor verification failed (still blank)");
          }
        }
      }
    } catch (hubspotErr) {
      console.warn("Failed to update HubSpot deal:", hubspotErr);
      hubspotWarnings.push("HubSpot update threw an error");
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
      zuperSynced: true,
      zuperJobUid,
      zuperError: null,
      hubspotWarnings: hubspotWarnings.length > 0 ? hubspotWarnings : undefined,
      record: {
        id: record.id,
        projectId: record.projectId,
        scheduledDate: record.scheduledDate,
        status: "scheduled",
      },
      message: `${scheduleType} confirmed and synced to Zuper`,
    });
  } catch (error) {
    console.error("Error confirming tentative schedule:", error);
    return NextResponse.json(
      { error: "Failed to confirm schedule" },
      { status: 500 }
    );
  }
}
