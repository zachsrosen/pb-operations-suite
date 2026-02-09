import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { zuper, createJobFromProject, ZuperJob } from "@/lib/zuper";
import { auth } from "@/auth";
import { getUserByEmail, logActivity, createScheduleRecord, cacheZuperJob, canScheduleType, getCrewMemberByName, UserRole } from "@/lib/db";
import { sendSchedulingNotification } from "@/lib/email";

/**
 * Smart scheduling endpoint that:
 * 1. Searches for existing Zuper job by HubSpot deal ID
 * 2. If found, reschedules the existing job
 * 3. If not found, creates a new job
 *
 * This prevents duplicate jobs when HubSpot workflows have already created the initial job.
 */
export async function PUT(request: NextRequest) {
  try {
    // Check authentication
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    // Get user and check permissions
    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { project, schedule } = body;

    // Validate schedule type early for permission check
    const scheduleType = schedule?.type as "survey" | "installation" | "inspection";
    if (!scheduleType || !["survey", "installation", "inspection"].includes(scheduleType)) {
      return NextResponse.json(
        { error: "Invalid schedule type. Must be: survey, installation, or inspection" },
        { status: 400 }
      );
    }

    // Check if user has permission to schedule this type
    if (!canScheduleType(user.role as UserRole, scheduleType)) {
      console.log(`[Zuper Schedule] Permission denied: User ${session.user.email} (${user.role}) cannot schedule ${scheduleType}`);
      return NextResponse.json(
        { error: `You don't have permission to schedule ${scheduleType}s. Contact an admin if you need access.` },
        { status: 403 }
      );
    }

    // Check if Zuper is configured
    if (!zuper.isConfigured()) {
      return NextResponse.json(
        { error: "Zuper integration not configured", configured: false },
        { status: 503 }
      );
    }
    // Validate required fields
    if (!project?.id || !schedule?.date) {
      return NextResponse.json(
        { error: "Missing required fields: project.id, schedule.date" },
        { status: 400 }
      );
    }

    const hubspotTag = `hubspot-${project.id}`;

    // If the client already knows the Zuper job UID, use it directly (most reliable!)
    let existingJobUid: string | undefined = project.zuperJobUid;

    console.log(`[Zuper Schedule] Processing schedule request:`);
    console.log(`  - Project ID: ${project.id}`);
    console.log(`  - Project Name: ${project.name}`);
    console.log(`  - Known Zuper Job UID: ${existingJobUid || "none"}`);
    console.log(`  - Schedule Type: ${schedule.type}`);

    let existingJob: ZuperJob | undefined;

    // If we already have the Zuper job UID from the lookup, use it directly
    if (existingJobUid) {
      console.log(`[Zuper Schedule] Using provided Zuper job UID: ${existingJobUid}`);
      existingJob = { job_uid: existingJobUid, job_title: project.name } as ZuperJob;
    } else {
      // Otherwise, search for existing job
      // Extract customer name for searching
      // HubSpot format: "PROJ-9031 | LastName, FirstName | Address"
      // Zuper job title format: "LastName, FirstName | Address"
      const nameParts = project.name?.split(" | ") || [];
      const customerName = nameParts.length >= 2
        ? nameParts[1]?.trim()  // "LastName, FirstName" from HubSpot format
        : nameParts[0]?.trim() || "";  // Fallback to first part if only one part

      // Also extract just the last name for looser matching
      const customerLastName = customerName.split(",")[0]?.trim() || "";

      console.log(`[Zuper Schedule] No known job UID, searching by name:`);
      console.log(`  - Customer Name: ${customerName}`);
      console.log(`  - Customer Last Name: ${customerLastName}`);
      console.log(`  - HubSpot Tag: ${hubspotTag}`);

      // Search for existing job by customer last name (Zuper search is fuzzy)
      const searchResult = await zuper.searchJobs({
        limit: 100,
        search: customerLastName, // Use last name for broader search
      });

      if (searchResult.type === "success" && searchResult.data?.jobs) {
        console.log(`[Zuper Schedule] Found ${searchResult.data.jobs.length} jobs in search results`);

        // Map schedule type to Zuper category names AND UIDs (for flexible matching)
        const categoryConfig: Record<string, { name: string; uid: string }> = {
          survey: { name: "Site Survey", uid: "002bac33-84d3-4083-a35d-50626fc49288" },
          installation: { name: "Construction", uid: "6ffbc218-6dad-4a46-b378-1fb02b3ab4bf" },
          inspection: { name: "Inspection", uid: "b7dc03d2-25d0-40df-a2fc-b1a477b16b65" },
        };
        const targetCategoryName = categoryConfig[schedule.type].name;
        const targetCategoryUid = categoryConfig[schedule.type].uid;

        // Helper to get category info from job
        const getJobCategoryInfo = (job: ZuperJob): { name: string; uid: string } => {
          if (typeof job.job_category === "string") {
            return { name: job.job_category, uid: job.job_category };
          }
          return {
            name: job.job_category?.category_name || "",
            uid: job.job_category?.category_uid || "",
          };
        };

        // Helper to check if job matches target category
        const categoryMatches = (job: ZuperJob): boolean => {
          const catInfo = getJobCategoryInfo(job);
          return catInfo.name.toLowerCase() === targetCategoryName.toLowerCase() ||
                 catInfo.uid === targetCategoryUid;
        };

        // First try to find by HubSpot tag
        existingJob = searchResult.data.jobs.find(
          (job) => job.job_tags?.includes(hubspotTag) && categoryMatches(job)
        );

        // If not found by tag, try to find by job title starting with last name
        if (!existingJob && customerLastName) {
          const normalizedLastName = customerLastName.toLowerCase().trim();
          existingJob = searchResult.data.jobs.find((job) => {
            const jobTitle = job.job_title?.toLowerCase() || "";
            const matchesCategory = categoryMatches(job);
            const titleStartsWithLastName = jobTitle.startsWith(normalizedLastName + ",") ||
                                            jobTitle.startsWith(normalizedLastName + " ");
            return matchesCategory && titleStartsWithLastName;
          });
        }

        if (existingJob) {
          console.log(`[Zuper Schedule] Found existing job: ${existingJob.job_uid}`);
        } else {
          console.log(`[Zuper Schedule] No matching job found for "${customerLastName}"`);
        }
      } else {
        console.log(`[Zuper Schedule] Search failed or returned no jobs`);
      }
    } // End of else block (no provided zuperJobUid)

    // Calculate schedule times
    // User selects times in Mountain Time, but Zuper expects UTC
    // Mountain Time is UTC-7 (MST) or UTC-6 (MDT during daylight saving)
    const days = schedule.days || 1;

    // Helper to convert Mountain Time to UTC for Zuper API
    // Takes a date string (YYYY-MM-DD) and time string (HH:mm) in Mountain Time
    // Returns UTC datetime string in "YYYY-MM-DD HH:mm:ss" format
    const mountainToUtc = (dateStr: string, timeStr: string): string => {
      const [year, month, day] = dateStr.split('-').map(Number);
      const [hours, minutes] = (timeStr + ":00").split(':').map(Number);

      // Create a date object and use Intl to determine if DST is in effect
      // This determines whether to use -7 (MST) or -6 (MDT)
      const testDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      const mountainFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Denver',
        timeZoneName: 'short'
      });
      const parts = mountainFormatter.formatToParts(testDate);
      const tzName = parts.find(p => p.type === 'timeZoneName')?.value || 'MST';
      const isDST = tzName === 'MDT';
      const offsetHours = isDST ? 6 : 7; // MDT is UTC-6, MST is UTC-7

      // Add the offset to convert Mountain Time to UTC
      let utcHours = hours + offsetHours;
      let utcDay = day;
      let utcMonth = month;
      let utcYear = year;

      // Handle day overflow
      if (utcHours >= 24) {
        utcHours -= 24;
        utcDay += 1;
        // Handle month overflow
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

      return `${utcYear}-${String(utcMonth).padStart(2, '0')}-${String(utcDay).padStart(2, '0')} ${String(utcHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
    };

    let startDateTime: string;
    let endDateTime: string;

    if (schedule.startTime && schedule.endTime) {
      // Use specific time slot (e.g., "12:00" to "13:00" for site surveys)
      // Convert from Mountain Time to UTC for Zuper
      startDateTime = mountainToUtc(schedule.date, schedule.startTime);
      endDateTime = mountainToUtc(schedule.date, schedule.endTime);
      console.log(`[Zuper Schedule] Converting Mountain Time ${schedule.startTime}-${schedule.endTime} to UTC`);
    } else {
      // Default to 8am-4pm Mountain Time for multi-day jobs
      startDateTime = mountainToUtc(schedule.date, "08:00");

      // Calculate end date
      const [year, month, day] = schedule.date.split('-').map(Number);
      const endDay = day + days - 1;
      const endDateObj = new Date(year, month - 1, endDay);
      const endYear = endDateObj.getFullYear();
      const endMonth = String(endDateObj.getMonth() + 1).padStart(2, '0');
      const endDayStr = String(endDateObj.getDate()).padStart(2, '0');
      const endDateStr = `${endYear}-${endMonth}-${endDayStr}`;
      endDateTime = mountainToUtc(endDateStr, "16:00");
    }

    console.log(`[Zuper Schedule] Schedule times (UTC for Zuper): ${startDateTime} to ${endDateTime}`);

    if (existingJob && existingJob.job_uid) {
      // Reschedule existing job
      console.log(`[Zuper Schedule] ACTION: RESCHEDULE - Job UID: ${existingJob.job_uid}`);

      // Get user UIDs from crew selection (crew can be a user UID or comma-separated list)
      const userUids = schedule.crew ? schedule.crew.split(",").map((u: string) => u.trim()).filter(Boolean) : [];
      const teamUid = schedule.teamUid; // Team UID required for assignment API

      console.log(`[Zuper Schedule] Input schedule.crew: "${schedule.crew}"`);
      console.log(`[Zuper Schedule] Input schedule.teamUid: "${schedule.teamUid}"`);
      console.log(`[Zuper Schedule] Parsed userUids:`, userUids);
      console.log(`[Zuper Schedule] Assigning to users:`, userUids, `team:`, teamUid || "NOT PROVIDED");

      const rescheduleResult = await zuper.rescheduleJob(
        existingJob.job_uid,
        startDateTime,
        endDateTime,
        userUids.length > 0 ? userUids : undefined,
        teamUid // Pass team UID for assignment
      );

      if (rescheduleResult.type === "error") {
        console.log(`[Zuper Schedule] RESCHEDULE FAILED: ${rescheduleResult.error}`);
        return NextResponse.json(
          { error: rescheduleResult.error, action: "reschedule_failed" },
          { status: 500 }
        );
      }

      // Check if assignment failed (schedule succeeded but user assignment didn't)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jobData = rescheduleResult.data as any;
      const assignmentFailed = jobData?._assignmentFailed;
      const assignmentError = jobData?._assignmentError;

      if (assignmentFailed) {
        console.log(`[Zuper Schedule] RESCHEDULE SUCCESS but ASSIGNMENT FAILED: ${assignmentError}`);
      } else {
        console.log(`[Zuper Schedule] RESCHEDULE SUCCESS`);
      }

      // Log the reschedule activity
      await logSchedulingActivity(
        schedule.type === "survey" ? "SURVEY_RESCHEDULED" : "INSTALL_RESCHEDULED",
        `Rescheduled ${schedule.type} for ${project.name || project.id}${assignmentFailed ? " (user assignment failed)" : ""}`,
        project,
        existingJob.job_uid,
        schedule
      );

      // Save schedule record to database
      await createScheduleRecord({
        scheduleType: schedule.type,
        projectId: project.id,
        projectName: project.name || `Project ${project.id}`,
        scheduledDate: schedule.date,
        scheduledStart: schedule.startTime,
        scheduledEnd: schedule.endTime,
        assignedUser: schedule.assignedUser,
        assignedUserUid: schedule.crew,
        assignedTeamUid: schedule.teamUid,
        zuperJobUid: existingJob.job_uid,
        zuperSynced: true,
        zuperAssigned: !assignmentFailed,
        zuperError: assignmentError,
        notes: schedule.notes,
      });

      // Cache the Zuper job
      if (rescheduleResult.data) {
        await cacheZuperJob({
          jobUid: existingJob.job_uid,
          jobTitle: rescheduleResult.data.job_title || `${schedule.type} - ${project.name}`,
          jobCategory: schedule.type === "survey" ? "Site Survey" : schedule.type === "inspection" ? "Inspection" : "Construction",
          jobStatus: "SCHEDULED",
          hubspotDealId: project.id,
          projectName: project.name,
        });
      }

      // Send notification to assigned crew member
      await sendCrewNotification(
        schedule,
        project,
        session.user.name || session.user.email,
        session.user.email
      );

      return NextResponse.json({
        success: true,
        action: "rescheduled",
        job: rescheduleResult.data,
        message: assignmentFailed
          ? `${schedule.type} job rescheduled but user assignment failed - please assign in Zuper`
          : `${schedule.type} job rescheduled in Zuper`,
        existingJobId: existingJob.job_uid,
        assignmentFailed,
        assignmentError,
      });
    } else {
      // No existing job found - create new one
      console.log(`[Zuper Schedule] ACTION: CREATE NEW JOB (no existing job found for "${project.name}" with category "${schedule.type}")`);
      const createResult = await createJobFromProject(project, {
        type: schedule.type,
        date: schedule.date,
        days: days,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        crew: schedule.crew,
        teamUid: schedule.teamUid, // Team UID required for user assignment
        notes: schedule.notes,
      });

      if (createResult.type === "error") {
        return NextResponse.json(
          { error: createResult.error, action: "create_failed" },
          { status: 500 }
        );
      }

      // Log the scheduling activity
      await logSchedulingActivity(
        schedule.type === "survey" ? "SURVEY_SCHEDULED" : "INSTALL_SCHEDULED",
        `Scheduled ${schedule.type} for ${project.name || project.id}`,
        project,
        createResult.data?.job_uid,
        schedule
      );

      // Save schedule record to database
      const newJobUid = createResult.data?.job_uid;
      await createScheduleRecord({
        scheduleType: schedule.type,
        projectId: project.id,
        projectName: project.name || `Project ${project.id}`,
        scheduledDate: schedule.date,
        scheduledStart: schedule.startTime,
        scheduledEnd: schedule.endTime,
        assignedUser: schedule.assignedUser,
        assignedUserUid: schedule.crew,
        assignedTeamUid: schedule.teamUid,
        zuperJobUid: newJobUid,
        zuperSynced: true,
        zuperAssigned: !!schedule.crew, // Assume assigned if crew was provided at creation
        notes: schedule.notes,
      });

      // Cache the Zuper job
      if (createResult.data && newJobUid) {
        await cacheZuperJob({
          jobUid: newJobUid,
          jobTitle: createResult.data.job_title || `${schedule.type} - ${project.name}`,
          jobCategory: schedule.type === "survey" ? "Site Survey" : schedule.type === "inspection" ? "Inspection" : "Construction",
          jobStatus: "SCHEDULED",
          hubspotDealId: project.id,
          projectName: project.name,
        });
      }

      // Send notification to assigned crew member
      await sendCrewNotification(
        schedule,
        project,
        session.user.name || session.user.email,
        session.user.email
      );

      return NextResponse.json({
        success: true,
        action: "created",
        job: createResult.data,
        message: `${schedule.type} job created in Zuper (no existing job found)`,
      });
    }
  } catch (error) {
    console.error("Error scheduling Zuper job:", error);
    return NextResponse.json(
      { error: "Failed to schedule Zuper job", details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to check if a job exists for a HubSpot deal
 */
export async function GET(request: NextRequest) {
  try {
    if (!zuper.isConfigured()) {
      return NextResponse.json(
        { error: "Zuper integration not configured", configured: false },
        { status: 503 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const hubspotId = searchParams.get("hubspot_id");
    const jobType = searchParams.get("type"); // survey, installation, inspection

    if (!hubspotId) {
      return NextResponse.json(
        { error: "Missing required parameter: hubspot_id" },
        { status: 400 }
      );
    }

    const hubspotTag = `hubspot-${hubspotId}`;

    // Search for jobs
    const searchResult = await zuper.searchJobs({
      limit: 100,
    });

    if (searchResult.type === "error") {
      return NextResponse.json(
        { error: searchResult.error },
        { status: 500 }
      );
    }

    // Filter by HubSpot tag
    let matchingJobs =
      searchResult.data?.jobs.filter((job) =>
        job.job_tags?.includes(hubspotTag)
      ) || [];

    // Optionally filter by job type/category
    if (jobType) {
      // Category config with both names and UIDs for flexible matching
      const categoryConfig: Record<string, { name: string; uid: string }> = {
        survey: { name: "Site Survey", uid: "002bac33-84d3-4083-a35d-50626fc49288" },
        installation: { name: "Construction", uid: "6ffbc218-6dad-4a46-b378-1fb02b3ab4bf" },
        inspection: { name: "Inspection", uid: "b7dc03d2-25d0-40df-a2fc-b1a477b16b65" },
      };
      const config = categoryConfig[jobType];
      if (config) {
        matchingJobs = matchingJobs.filter((job) => {
          // Handle both string and object category formats
          if (typeof job.job_category === "string") {
            return job.job_category === config.name || job.job_category === config.uid;
          }
          return (
            job.job_category?.category_name === config.name ||
            job.job_category?.category_uid === config.uid
          );
        });
      }
    }

    return NextResponse.json({
      exists: matchingJobs.length > 0,
      jobs: matchingJobs,
      count: matchingJobs.length,
    });
  } catch (error) {
    console.error("Error checking Zuper job:", error);
    return NextResponse.json(
      { error: "Failed to check Zuper job", details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * Helper to log scheduling activities
 */
async function logSchedulingActivity(
  type: "SURVEY_SCHEDULED" | "SURVEY_RESCHEDULED" | "INSTALL_SCHEDULED" | "INSTALL_RESCHEDULED",
  description: string,
  project: { id: string; name?: string },
  zuperJobId?: string,
  schedule?: { type: string; date: string; crew?: string; assignedUser?: string }
) {
  try {
    const session = await auth();
    let userId: string | undefined;
    let userEmail: string | undefined;

    if (session?.user?.email) {
      userEmail = session.user.email;
      const user = await getUserByEmail(session.user.email);
      if (user) {
        userId = user.id;
      }
    }

    const headersList = await headers();
    const userAgent = headersList.get("user-agent") || undefined;
    const forwarded = headersList.get("x-forwarded-for");
    const ipAddress = forwarded?.split(",")[0]?.trim() || headersList.get("x-real-ip") || undefined;

    await logActivity({
      type,
      description,
      userId,
      userEmail,
      entityType: "project",
      entityId: project.id,
      entityName: project.name,
      metadata: {
        zuperJobId,
        scheduleType: schedule?.type,
        scheduleDate: schedule?.date,
        crew: schedule?.crew,
        assignedUser: schedule?.assignedUser,
      },
      ipAddress,
      userAgent,
    });
  } catch (err) {
    console.error("Failed to log scheduling activity:", err);
    // Don't throw - logging failures shouldn't break scheduling
  }
}

/**
 * Helper to send notification to assigned crew member
 */
async function sendCrewNotification(
  schedule: {
    type: string;
    date: string;
    startTime?: string;
    endTime?: string;
    assignedUser?: string;
    notes?: string;
  },
  project: { id: string; name?: string; address?: string },
  schedulerName: string,
  schedulerEmail: string
) {
  try {
    // If no assigned user, skip notification
    if (!schedule.assignedUser) {
      console.log("[Zuper Schedule] No assigned user, skipping notification");
      return;
    }

    // Look up crew member by name to get their email
    const crewMember = await getCrewMemberByName(schedule.assignedUser);

    if (!crewMember?.email) {
      console.log(`[Zuper Schedule] No email found for crew member: ${schedule.assignedUser}`);
      return;
    }

    // Extract customer name from project name
    // Format: "PROJ-9031 | LastName, FirstName | Address" or "LastName, FirstName | Address"
    const nameParts = project.name?.split(" | ") || [];
    const customerName = nameParts.length >= 2
      ? nameParts[1]?.trim()
      : nameParts[0]?.trim() || "Customer";

    // Extract address from project
    const customerAddress = nameParts.length >= 3
      ? nameParts[2]?.trim()
      : nameParts.length >= 2 && !nameParts[0].includes("PROJ-")
        ? nameParts[1]?.trim()
        : project.address || "See Zuper for address";

    await sendSchedulingNotification({
      to: crewMember.email,
      crewMemberName: schedule.assignedUser,
      scheduledByName: schedulerName,
      scheduledByEmail: schedulerEmail,
      appointmentType: schedule.type as "survey" | "installation" | "inspection",
      customerName,
      customerAddress,
      scheduledDate: schedule.date,
      scheduledStart: schedule.startTime,
      scheduledEnd: schedule.endTime,
      projectId: project.id,
      notes: schedule.notes,
    });

    console.log(`[Zuper Schedule] Notification sent to ${crewMember.email}`);
  } catch (err) {
    console.error("Failed to send crew notification:", err);
    // Don't throw - notification failures shouldn't break scheduling
  }
}
