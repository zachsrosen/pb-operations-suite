import { NextRequest, NextResponse } from "next/server";
import { zuper, createJobFromProject, ZuperJob } from "@/lib/zuper";

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

    // Search for existing job with this HubSpot deal ID
    const searchResult = await zuper.searchJobs({
      limit: 100, // Get enough jobs to search through
    });

    let existingJob: ZuperJob | undefined;

    if (searchResult.type === "success" && searchResult.data?.jobs) {
      // Find job with matching HubSpot tag and matching job type
      const categoryMap: Record<string, string> = {
        survey: "Site Survey",
        installation: "Installation",
        inspection: "Inspection",
      };
      const targetCategory = categoryMap[schedule.type];

      existingJob = searchResult.data.jobs.find(
        (job) =>
          job.job_tags?.includes(hubspotTag) &&
          job.job_category === targetCategory
      );
    }

    // Calculate schedule times
    const days = schedule.days || 1;
    const startDate = new Date(`${schedule.date}T08:00:00`);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + days - 1);
    endDate.setHours(17, 0, 0, 0);

    if (existingJob && existingJob.job_uid) {
      // Reschedule existing job
      const rescheduleResult = await zuper.rescheduleJob(
        existingJob.job_uid,
        startDate.toISOString(),
        endDate.toISOString()
      );

      if (rescheduleResult.type === "error") {
        return NextResponse.json(
          { error: rescheduleResult.error, action: "reschedule_failed" },
          { status: 500 }
        );
      }

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
