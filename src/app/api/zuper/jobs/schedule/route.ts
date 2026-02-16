import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { zuper, createJobFromProject, ZuperJob } from "@/lib/zuper";
import { auth } from "@/auth";
import { getUserByEmail, logActivity, createScheduleRecord, cacheZuperJob, canScheduleType, getCrewMemberByName, getCachedZuperJobByDealId, UserRole } from "@/lib/db";
import { sendSchedulingNotification } from "@/lib/email";
import { updateDealProperty } from "@/lib/hubspot";

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
    const { project, schedule, rescheduleOnly } = body;

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
    const existingJobUid: string | undefined = project.zuperJobUid;

    console.log(`[Zuper Schedule] Processing schedule request:`);
    console.log(`  - Project ID: ${project.id}`);
    console.log(`  - Project Name: ${project.name}`);
    console.log(`  - Known Zuper Job UID: ${existingJobUid || "none"}`);
    console.log(`  - Schedule Type: ${schedule.type}`);

    // Map schedule type to Zuper category names and UIDs
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

    // Helper to get HubSpot Deal ID from custom fields (same logic as lookup API)
    const getHubSpotDealId = (job: ZuperJob): string | null => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const customFields = (job as any).custom_fields as Array<{ label?: string; name?: string; value?: string }> | undefined;
      if (!customFields || !Array.isArray(customFields)) return null;
      const dealIdField = customFields.find((f) => {
        const label = f.label?.toLowerCase() || "";
        const name = f.name?.toLowerCase() || "";
        return label === "hubspot deal id" || label === "hubspot_deal_id" ||
               name === "hubspot_deal_id" || name === "hubspot deal id";
      });
      if (dealIdField?.value) return dealIdField.value;
      const dealLinkField = customFields.find((f) => {
        const label = f.label?.toLowerCase() || "";
        const name = f.name?.toLowerCase() || "";
        return (label.includes("hubspot") && label.includes("link")) ||
               (name.includes("hubspot") && name.includes("link"));
      });
      if (dealLinkField?.value) {
        const urlMatch = dealLinkField.value.match(/\/record\/0-3\/(\d+)/);
        if (urlMatch) return urlMatch[1];
      }
      return null;
    };

    let existingJob: ZuperJob | undefined;
    let matchMethod = "";

    // --- Strategy 1: Client already knows the Zuper job UID (from page-load lookup) ---
    if (existingJobUid) {
      console.log(`[Zuper Schedule] Using provided Zuper job UID: ${existingJobUid}`);
      existingJob = { job_uid: existingJobUid, job_title: project.name } as ZuperJob;
      matchMethod = "client_uid";
    }

    // --- Strategy 2: Check DB cache (set when jobs are scheduled through the app) ---
    if (!existingJob) {
      try {
        const cached = await getCachedZuperJobByDealId(project.id, targetCategoryName);
        if (cached?.jobUid) {
          console.log(`[Zuper Schedule] DB cache hit: project ${project.id} → job ${cached.jobUid}`);
          existingJob = { job_uid: cached.jobUid, job_title: cached.jobTitle || project.name } as ZuperJob;
          matchMethod = "db_cache";
        }
      } catch (dbErr) {
        console.warn(`[Zuper Schedule] DB cache lookup failed:`, dbErr);
      }
    }

    // --- Strategy 3: Search Zuper API with multiple matching methods ---
    if (!existingJob) {
      // Extract customer name parts for matching
      // HubSpot format: "PROJ-9031 | LastName, FirstName | Address"
      const nameParts = project.name?.split(" | ") || [];
      const customerName = nameParts.length >= 2
        ? nameParts[1]?.trim()
        : nameParts[0]?.trim() || "";
      const customerLastName = customerName.split(",")[0]?.trim() || "";
      const projNumber = nameParts[0]?.trim().match(/PROJ-\d+/i)?.[0] || "";

      console.log(`[Zuper Schedule] Searching Zuper API:`);
      console.log(`  - Customer Last Name: ${customerLastName}`);
      console.log(`  - PROJ Number: ${projNumber || "none"}`);
      console.log(`  - HubSpot Tag: ${hubspotTag}`);

      // Do TWO searches in parallel for maximum coverage:
      // 1. Name-based search (fuzzy, finds by customer name in title)
      // 2. Broad date-range search (finds by deal ID custom field, tags, PROJ number)
      const [nameSearch, broadSearch] = await Promise.all([
        customerLastName
          ? zuper.searchJobs({ limit: 100, search: customerLastName })
          : Promise.resolve({ type: "success" as const, data: { jobs: [] as ZuperJob[], total: 0 } }),
        zuper.searchJobs({
          limit: 500,
          from_date: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
          to_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        }),
      ]);

      // Merge results, deduplicating by job_uid
      const allJobs = new Map<string, ZuperJob>();
      for (const result of [nameSearch, broadSearch]) {
        if (result.type === "success" && result.data?.jobs) {
          for (const job of result.data.jobs) {
            if (job.job_uid && !allJobs.has(job.job_uid)) {
              allJobs.set(job.job_uid, job);
            }
          }
        }
      }

      console.log(`[Zuper Schedule] Combined search: ${allJobs.size} unique jobs (name: ${nameSearch.data?.jobs?.length || 0}, broad: ${broadSearch.data?.jobs?.length || 0})`);

      // Filter to target category
      const categoryJobs = [...allJobs.values()].filter(categoryMatches);

      // Match 3a: HubSpot Deal ID custom field (most reliable API match)
      if (!existingJob) {
        for (const job of categoryJobs) {
          const dealId = getHubSpotDealId(job);
          if (dealId === project.id) {
            existingJob = job;
            matchMethod = "hubspot_deal_id";
            break;
          }
        }
      }

      // Match 3b: HubSpot tag (hubspot-{dealId})
      if (!existingJob) {
        existingJob = categoryJobs.find((job) => job.job_tags?.includes(hubspotTag));
        if (existingJob) matchMethod = "hubspot_tag";
      }

      // Match 3c: PROJ number tag
      if (!existingJob && projNumber) {
        existingJob = categoryJobs.find((job) =>
          job.job_tags?.some(t => t.toLowerCase() === projNumber.toLowerCase())
        );
        if (existingJob) matchMethod = "proj_tag";
      }

      // Match 3d: PROJ number in job title
      if (!existingJob && projNumber) {
        const normalizedProj = projNumber.toLowerCase();
        existingJob = categoryJobs.find((job) =>
          (job.job_title?.toLowerCase() || "").includes(normalizedProj)
        );
        if (existingJob) matchMethod = "proj_in_title";
      }

      // Match 3e: Customer last name in job title
      if (!existingJob && customerLastName.length > 2) {
        const normalizedLastName = customerLastName.toLowerCase().trim();
        existingJob = categoryJobs.find((job) => {
          const title = job.job_title?.toLowerCase() || "";
          return title.includes(normalizedLastName + ",") ||
                 title.startsWith(normalizedLastName + " ");
        });
        if (existingJob) matchMethod = "name_in_title";
      }

      if (existingJob) {
        console.log(`[Zuper Schedule] Found existing job: ${existingJob.job_uid} (matched by: ${matchMethod})`);
      } else {
        console.log(`[Zuper Schedule] No matching ${targetCategoryName} job found for "${project.name}"`);
      }
    }

    // Calculate schedule times
    // Slot times are in the crew member's local timezone (e.g. Mountain Time for CO, Pacific for CA)
    // Zuper expects UTC, so we convert using the timezone provided by the frontend
    const days = schedule.days || 1;

    // Determine the timezone for this schedule
    // Frontend passes schedule.timezone for timezone-aware slots (e.g. "America/Los_Angeles" for CA)
    // Default to Mountain Time for CO locations
    const slotTimezone = schedule.timezone || "America/Denver";

    // Helper to convert local time to UTC for Zuper API
    // Takes a date string (YYYY-MM-DD) and time string (HH:mm) in the slot's local timezone
    // Returns UTC datetime string in "YYYY-MM-DD HH:mm:ss" format
    const localToUtc = (dateStr: string, timeStr: string): string => {
      const [year, month, day] = dateStr.split('-').map(Number);
      const [hours, minutes] = (timeStr + ":00").split(':').map(Number);

      // Create a date object and use Intl to determine the UTC offset for this timezone
      const testDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      const localFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: slotTimezone,
        timeZoneName: 'longOffset'
      });
      const parts = localFormatter.formatToParts(testDate);
      const tzOffsetStr = parts.find(p => p.type === 'timeZoneName')?.value || '';
      // Parse offset like "GMT-07:00" or "GMT-06:00"
      const offsetMatch = tzOffsetStr.match(/GMT([+-])(\d{2}):(\d{2})/);
      let offsetHours: number;
      if (offsetMatch) {
        const sign = offsetMatch[1] === '-' ? 1 : -1; // Negative UTC offset means ADD hours to get UTC
        offsetHours = sign * parseInt(offsetMatch[2]);
      } else {
        // Fallback: use short name to determine offset for common timezones
        const shortFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: slotTimezone,
          timeZoneName: 'short'
        });
        const shortParts = shortFormatter.formatToParts(testDate);
        const shortTzName = shortParts.find(p => p.type === 'timeZoneName')?.value || '';
        // Common US timezone offsets
        const tzOffsets: Record<string, number> = {
          'MST': 7, 'MDT': 6, 'PST': 8, 'PDT': 7, 'CST': 6, 'CDT': 5, 'EST': 5, 'EDT': 4,
        };
        offsetHours = tzOffsets[shortTzName] || 7; // Default to MST
      }

      // Add the offset to convert local time to UTC
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

    if (schedule.type === "inspection") {
      // Inspections always use a fixed 8am-4pm same-day window
      // The slot selection only determines the inspector assignment, not the time window
      startDateTime = localToUtc(schedule.date, "08:00");
      endDateTime = localToUtc(schedule.date, "16:00");
      console.log(`[Zuper Schedule] Inspection: using fixed 8am-4pm ${slotTimezone} window`);
    } else if (schedule.startTime && schedule.endTime) {
      // Use specific time slot (e.g., "12:00" to "13:00" for site surveys)
      // Convert from local timezone to UTC for Zuper
      startDateTime = localToUtc(schedule.date, schedule.startTime);
      endDateTime = localToUtc(schedule.date, schedule.endTime);
      console.log(`[Zuper Schedule] Converting ${slotTimezone} time ${schedule.startTime}-${schedule.endTime} to UTC`);
    } else {
      // Default to 8am-4pm local time for construction/survey jobs without specific time slots
      startDateTime = localToUtc(schedule.date, "08:00");

      // Calculate end date — ensure at least same-day (days < 1 means partial day, still same day)
      const [year, month, day] = schedule.date.split('-').map(Number);
      const extraDays = Math.max(Math.ceil(days) - 1, 0); // 0.25d → 0 extra, 1d → 0 extra, 2d → 1 extra, 3d → 2 extra
      const endDateObj = new Date(year, month - 1, day + extraDays);
      const endYear = endDateObj.getFullYear();
      const endMonth = String(endDateObj.getMonth() + 1).padStart(2, '0');
      const endDayStr = String(endDateObj.getDate()).padStart(2, '0');
      const endDateStr = `${endYear}-${endMonth}-${endDayStr}`;
      endDateTime = localToUtc(endDateStr, "16:00");
    }

    console.log(`[Zuper Schedule] Schedule times (UTC for Zuper): ${startDateTime} to ${endDateTime}`);

    // Resolve user UID from name if crew is empty but assignedUser is provided
    // This handles users whose UIDs aren't hardcoded in the frontend
    const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    let resolvedCrew = schedule.crew || "";
    let resolvedTeamUid = schedule.teamUid || "";
    if ((!resolvedCrew || !isUuid(resolvedCrew)) && schedule.assignedUser) {
      console.log(`[Zuper Schedule] Resolving UID for "${schedule.assignedUser}" (crew was "${resolvedCrew}")`);
      const resolved = await zuper.resolveUserUid(schedule.assignedUser);
      if (resolved) {
        resolvedCrew = resolved.userUid;
        if (!resolvedTeamUid && resolved.teamUid) resolvedTeamUid = resolved.teamUid;
        console.log(`[Zuper Schedule] Resolved "${schedule.assignedUser}" → userUid: ${resolvedCrew}, teamUid: ${resolvedTeamUid}`);
      } else {
        console.warn(`[Zuper Schedule] Could not resolve UID for "${schedule.assignedUser}"`);
      }
    }

    if (existingJob && existingJob.job_uid) {
      // Reschedule existing job
      console.log(`[Zuper Schedule] ACTION: RESCHEDULE - Job UID: ${existingJob.job_uid}`);

      // Get user UIDs from crew selection (crew can be a user UID or comma-separated list)
      const userUids = resolvedCrew ? resolvedCrew.split(",").map((u: string) => u.trim()).filter(Boolean) : [];
      const teamUid = resolvedTeamUid; // Team UID required for assignment API

      console.log(`[Zuper Schedule] Input schedule.crew: "${schedule.crew}" → resolved: "${resolvedCrew}"`);
      console.log(`[Zuper Schedule] Input schedule.teamUid: "${schedule.teamUid}" → resolved: "${resolvedTeamUid}"`);
      console.log(`[Zuper Schedule] Parsed userUids:`, userUids);
      console.log(`[Zuper Schedule] Assigning to users:`, userUids, `team:`, teamUid || "NOT PROVIDED");

      const rescheduleResult = await zuper.rescheduleJob(
        existingJob.job_uid,
        startDateTime,
        endDateTime,
        userUids,
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
        schedule.type === "survey" ? "SURVEY_RESCHEDULED" : schedule.type === "inspection" ? "INSPECTION_RESCHEDULED" : "INSTALL_RESCHEDULED",
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
        assignedUserUid: resolvedCrew || schedule.crew,
        assignedTeamUid: resolvedTeamUid || schedule.teamUid,
        zuperJobUid: existingJob.job_uid,
        zuperSynced: true,
        zuperAssigned: !assignmentFailed,
        zuperError: assignmentError,
        notes: schedule.notes,
      });

      // Cache the Zuper job with scheduled times so lookup returns them on next page load
      if (rescheduleResult.data) {
        // Parse the UTC start/end datetimes back into Date objects for the cache
        const parsedStart = startDateTime ? new Date(startDateTime.replace(' ', 'T') + 'Z') : undefined;
        const parsedEnd = endDateTime ? new Date(endDateTime.replace(' ', 'T') + 'Z') : undefined;
        await cacheZuperJob({
          jobUid: existingJob.job_uid,
          jobTitle: rescheduleResult.data.job_title || `${schedule.type} - ${project.name}`,
          jobCategory: schedule.type === "survey" ? "Site Survey" : schedule.type === "inspection" ? "Inspection" : "Construction",
          jobStatus: "SCHEDULED",
          hubspotDealId: project.id,
          projectName: project.name,
          scheduledStart: parsedStart,
          scheduledEnd: parsedEnd,
        });
      }

      // Update site surveyor in HubSpot (fire and forget)
      if (schedule.assignedUser && schedule.type === "survey") {
        updateDealProperty(project.id, { site_surveyor: schedule.assignedUser }).catch(err =>
          console.warn(`[Zuper Schedule] Failed to update HubSpot site_surveyor:`, err)
        );
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
    } else if (rescheduleOnly) {
      // Reschedule-only mode: don't create new jobs, just report that none was found
      console.log(`[Zuper Schedule] RESCHEDULE ONLY: No existing job found for "${project.name}" with category "${schedule.type}" — skipping creation`);
      return NextResponse.json({
        success: true,
        action: "no_job_found",
        message: `No existing ${schedule.type} job found in Zuper for "${project.name}". Create the job in Zuper first, then reschedule from here.`,
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
        crew: resolvedCrew || schedule.crew,
        teamUid: resolvedTeamUid || schedule.teamUid, // Team UID required for user assignment
        timezone: schedule.timezone, // IANA timezone for correct UTC conversion (e.g. "America/Los_Angeles")
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
        schedule.type === "survey" ? "SURVEY_SCHEDULED" : schedule.type === "inspection" ? "INSPECTION_SCHEDULED" : "INSTALL_SCHEDULED",
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
        assignedUserUid: resolvedCrew || schedule.crew,
        assignedTeamUid: resolvedTeamUid || schedule.teamUid,
        zuperJobUid: newJobUid,
        zuperSynced: true,
        zuperAssigned: !!(resolvedCrew || schedule.crew), // Assume assigned if crew was provided at creation
        notes: schedule.notes,
      });

      // Cache the Zuper job with scheduled times
      if (createResult.data && newJobUid) {
        const parsedStart = startDateTime ? new Date(startDateTime.replace(' ', 'T') + 'Z') : undefined;
        const parsedEnd = endDateTime ? new Date(endDateTime.replace(' ', 'T') + 'Z') : undefined;
        await cacheZuperJob({
          jobUid: newJobUid,
          jobTitle: createResult.data.job_title || `${schedule.type} - ${project.name}`,
          jobCategory: schedule.type === "survey" ? "Site Survey" : schedule.type === "inspection" ? "Inspection" : "Construction",
          jobStatus: "SCHEDULED",
          hubspotDealId: project.id,
          projectName: project.name,
          scheduledStart: parsedStart,
          scheduledEnd: parsedEnd,
        });
      }

      // Update site surveyor in HubSpot (fire and forget)
      if (schedule.assignedUser && schedule.type === "survey") {
        updateDealProperty(project.id, { site_surveyor: schedule.assignedUser }).catch(err =>
          console.warn(`[Zuper Schedule] Failed to update HubSpot site_surveyor:`, err)
        );
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
      { error: "Failed to schedule Zuper job" },
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
      { error: "Failed to check Zuper job" },
      { status: 500 }
    );
  }
}

/**
 * DELETE endpoint to unschedule a job (clear dates in Zuper + HubSpot)
 */
export async function DELETE(request: NextRequest) {
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

    // Check if user has permission to schedule surveys
    if (!canScheduleType(user.role as UserRole, "survey")) {
      return NextResponse.json(
        { error: "You don't have permission to manage survey schedules." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { projectId, projectName, zuperJobUid } = body;

    if (!projectId) {
      return NextResponse.json(
        { error: "Missing required field: projectId" },
        { status: 400 }
      );
    }

    console.log(`[Zuper Unschedule] Clearing schedule for project ${projectId} (${projectName})`);

    // Resolve Zuper job UID for survey category if UI payload is missing/stale.
    let resolvedJobUid: string | undefined = zuperJobUid || undefined;
    if (zuper.isConfigured() && !resolvedJobUid) {
      try {
        const cached = await getCachedZuperJobByDealId(projectId, "Site Survey");
        if (cached?.jobUid) {
          resolvedJobUid = cached.jobUid;
        }
      } catch (err) {
        console.warn("[Zuper Unschedule] Cache lookup failed for %s:", projectId, err);
      }
    }
    if (zuper.isConfigured() && !resolvedJobUid) {
      try {
        const hubspotTag = `hubspot-${projectId}`;
        const searchResult = await zuper.searchJobs({ limit: 200 });
        if (searchResult.type === "success" && searchResult.data?.jobs) {
          const match = searchResult.data.jobs.find((job) => {
            const inCategory = typeof job.job_category === "string"
              ? job.job_category === "Site Survey" || job.job_category === "002bac33-84d3-4083-a35d-50626fc49288"
              : job.job_category?.category_name === "Site Survey" ||
                job.job_category?.category_uid === "002bac33-84d3-4083-a35d-50626fc49288";
            return inCategory && !!job.job_tags?.includes(hubspotTag);
          });
          if (match?.job_uid) {
            resolvedJobUid = match.job_uid;
          }
        }
      } catch (err) {
        console.warn("[Zuper Unschedule] API lookup failed for %s:", projectId, err);
      }
    }

    // Clear schedule in Zuper using resolved UID
    let zuperCleared = false;
    let zuperError: string | undefined;
    if (zuper.isConfigured() && !resolvedJobUid) {
      zuperError = "No matching Zuper Site Survey job found to unschedule";
      console.warn("[Zuper Unschedule] %s for project %s", zuperError, projectId);
    } else if (resolvedJobUid && zuper.isConfigured()) {
      try {
        const result = await zuper.unscheduleJob(resolvedJobUid);
        if (result.type === "success") {
          zuperCleared = true;
          console.log(`[Zuper Unschedule] Cleared Zuper job ${resolvedJobUid}`);
        } else {
          console.warn(`[Zuper Unschedule] Failed to clear Zuper job: ${result.error}`);
          zuperError = result.error;
        }
      } catch (err) {
        console.error(`[Zuper Unschedule] Error clearing Zuper job:`, err);
        zuperError = err instanceof Error ? err.message : "Unknown Zuper unschedule error";
      }
    }

    // Clear HubSpot survey fields (required for successful unschedule UX).
    // Some environments have seen both schedule_date and scheduled_date naming.
    let hubspotCleared = false;
    let hubspotError: string | undefined;
    try {
      hubspotCleared = await updateDealProperty(projectId, {
        site_survey_schedule_date: "",
        site_surveyor: "",
      });

      if (!hubspotCleared) {
        hubspotCleared = await updateDealProperty(projectId, {
          // Fallback property name observed in other routes/integrations
          site_survey_scheduled_date: "",
          site_surveyor: "",
        });
      }

      if (hubspotCleared) {
        console.log(`[Zuper Unschedule] Cleared HubSpot survey schedule/surveyor for ${projectId}`);
      } else {
        hubspotError = "HubSpot deal update returned false";
        console.warn(`[Zuper Unschedule] ${hubspotError} for ${projectId}`);
      }
    } catch (err) {
      hubspotError = err instanceof Error ? err.message : "Unknown HubSpot clear error";
      console.warn(`[Zuper Unschedule] Failed to clear HubSpot properties:`, err);
    }

    // Log the unschedule activity
    try {
      const headersList = await headers();
      const userAgent = headersList.get("user-agent") || undefined;
      const forwarded = headersList.get("x-forwarded-for");
      const ipAddress = forwarded?.split(",")[0]?.trim() || headersList.get("x-real-ip") || undefined;

      await logActivity({
        type: "SURVEY_CANCELLED",
        description: `Unscheduled survey for ${projectName || projectId}`,
        userId: user.id,
        userEmail: session.user.email,
        entityType: "project",
        entityId: projectId,
        entityName: projectName,
        metadata: {
          zuperJobUid: resolvedJobUid || zuperJobUid,
          zuperCleared,
          hubspotCleared,
        },
        ipAddress,
        userAgent,
      });
    } catch (err) {
      console.error("Failed to log unschedule activity:", err);
    }

    // If a Zuper job was provided but could not be cleared, surface failure
    // so the UI doesn't treat this as a full success.
    if (zuper.isConfigured() && (!zuperCleared || !hubspotCleared)) {
      return NextResponse.json(
        {
          success: false,
          action: "unschedule_partial",
          zuperCleared,
          hubspotCleared,
          zuperJobUid: resolvedJobUid || null,
          error: !zuperCleared
            ? (zuperError || "Failed to clear schedule in Zuper")
            : (hubspotError || "Failed to clear HubSpot survey schedule fields"),
          message: !zuperCleared
            ? "HubSpot/Zuper unschedule did not fully complete."
            : "Zuper was cleared, but HubSpot fields did not clear.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      action: "unscheduled",
      zuperCleared,
      zuperJobUid: resolvedJobUid || null,
      message: `Survey schedule cleared${zuperCleared ? " (Zuper + HubSpot)" : " (HubSpot only)"}`,
    });
  } catch (error) {
    console.error("Error unscheduling job:", error);
    return NextResponse.json(
      { error: "Failed to unschedule job" },
      { status: 500 }
    );
  }
}

/**
 * Helper to log scheduling activities
 */
async function logSchedulingActivity(
  type: "SURVEY_SCHEDULED" | "SURVEY_RESCHEDULED" | "INSTALL_SCHEDULED" | "INSTALL_RESCHEDULED" | "INSPECTION_SCHEDULED" | "INSPECTION_RESCHEDULED",
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
