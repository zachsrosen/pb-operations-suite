import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { zuper, createJobFromProject, ZuperJob } from "@/lib/zuper";
import { auth } from "@/auth";
import { getUserByEmail, logActivity } from "@/lib/db";

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
    // Check if Zuper is configured
    if (!zuper.isConfigured()) {
      return NextResponse.json(
        { error: "Zuper integration not configured", configured: false },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { project, schedule } = body;

    // Validate required fields
    if (!project?.id || !schedule?.type || !schedule?.date) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: project.id, schedule.type, schedule.date",
        },
        { status: 400 }
      );
    }

    // Validate schedule type
    if (!["survey", "installation", "inspection"].includes(schedule.type)) {
      return NextResponse.json(
        {
          error:
            "Invalid schedule type. Must be: survey, installation, or inspection",
        },
        { status: 400 }
      );
    }

    const hubspotTag = `hubspot-${project.id}`;

    // Extract customer name for searching
    const customerName = project.name?.split("|")[0]?.trim() || project.name || "";

    // Search for existing job by customer name
    const searchResult = await zuper.searchJobs({
      limit: 100,
      search: customerName, // Use Zuper's search to find jobs matching customer name
    });

    let existingJob: ZuperJob | undefined;

    if (searchResult.type === "success" && searchResult.data?.jobs) {
      // Map schedule type to Zuper category names
      // Note: Zuper uses "Construction" instead of "Installation"
      const categoryMap: Record<string, string> = {
        survey: "Site Survey",
        installation: "Construction",
        inspection: "Inspection",
      };
      const targetCategory = categoryMap[schedule.type];

      // Helper to get category name from job (handles both string and object formats)
      const getJobCategoryName = (job: ZuperJob): string => {
        if (typeof job.job_category === "string") {
          return job.job_category;
        }
        return job.job_category?.category_name || "";
      };

      // First try to find by HubSpot tag (if job was created with tag)
      existingJob = searchResult.data.jobs.find(
        (job) =>
          job.job_tags?.includes(hubspotTag) &&
          getJobCategoryName(job) === targetCategory
      );

      // If not found by tag, try to find by job title containing customer name
      // HubSpot workflow creates jobs with title format: "CustomerName | Address"
      if (!existingJob && project.name) {
        const customerName = project.name.split("|")[0]?.trim() || project.name;
        existingJob = searchResult.data.jobs.find(
          (job) =>
            job.job_title?.includes(customerName) &&
            getJobCategoryName(job) === targetCategory
        );
      }
    }

    // Calculate schedule times
    // If specific start/end times provided (e.g., for site surveys), use those
    // Otherwise default to 8am-4pm for installs
    const days = schedule.days || 1;
    let startDateTime: string;
    let endDateTime: string;

    if (schedule.startTime && schedule.endTime) {
      // Use specific time slot (e.g., "12:00" to "13:00" for site surveys)
      startDateTime = `${schedule.date}T${schedule.startTime}:00`;
      endDateTime = `${schedule.date}T${schedule.endTime}:00`;
    } else {
      // Default to 8am-4pm for multi-day jobs
      startDateTime = `${schedule.date}T08:00:00`;

      // Calculate end date by parsing date parts directly (no timezone issues)
      const [year, month, day] = schedule.date.split('-').map(Number);
      const endDay = day + days - 1;
      // Create date in local timezone to handle month overflow correctly
      const endDateObj = new Date(year, month - 1, endDay);
      const endYear = endDateObj.getFullYear();
      const endMonth = String(endDateObj.getMonth() + 1).padStart(2, '0');
      const endDayStr = String(endDateObj.getDate()).padStart(2, '0');
      endDateTime = `${endYear}-${endMonth}-${endDayStr}T16:00:00`;
    }

    if (existingJob && existingJob.job_uid) {
      // Reschedule existing job
      const rescheduleResult = await zuper.rescheduleJob(
        existingJob.job_uid,
        startDateTime,
        endDateTime
      );

      if (rescheduleResult.type === "error") {
        return NextResponse.json(
          { error: rescheduleResult.error, action: "reschedule_failed" },
          { status: 500 }
        );
      }

      // Log the reschedule activity
      await logSchedulingActivity(
        schedule.type === "survey" ? "SURVEY_RESCHEDULED" : "INSTALL_RESCHEDULED",
        `Rescheduled ${schedule.type} for ${project.name || project.id}`,
        project,
        existingJob.job_uid,
        schedule
      );

      return NextResponse.json({
        success: true,
        action: "rescheduled",
        job: rescheduleResult.data,
        message: `${schedule.type} job rescheduled in Zuper`,
        existingJobId: existingJob.job_uid,
      });
    } else {
      // No existing job found - create new one
      const createResult = await createJobFromProject(project, {
        type: schedule.type,
        date: schedule.date,
        days: days,
        crew: schedule.crew,
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
      const categoryMap: Record<string, string> = {
        survey: "Site Survey",
        installation: "Installation",
        inspection: "Inspection",
      };
      const targetCategory = categoryMap[jobType];
      if (targetCategory) {
        matchingJobs = matchingJobs.filter(
          (job) => job.job_category === targetCategory
        );
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
  schedule?: { type: string; date: string; crew?: string }
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
      },
      ipAddress,
      userAgent,
    });
  } catch (err) {
    console.error("Failed to log scheduling activity:", err);
    // Don't throw - logging failures shouldn't break scheduling
  }
}
