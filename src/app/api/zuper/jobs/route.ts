import { NextRequest, NextResponse } from "next/server";
import { zuper, createJobFromProject } from "@/lib/zuper";

export async function POST(request: NextRequest) {
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
        { error: "Missing required fields: project.id, schedule.type, schedule.date" },
        { status: 400 }
      );
    }

    // Validate schedule type
    if (!["survey", "installation", "inspection"].includes(schedule.type)) {
      return NextResponse.json(
        { error: "Invalid schedule type. Must be: survey, installation, or inspection" },
        { status: 400 }
      );
    }

    // Create the job in Zuper
    const result = await createJobFromProject(project, {
      type: schedule.type,
      date: schedule.date,
      days: schedule.days || 1,
      crew: schedule.crew,
      notes: schedule.notes,
    });

    if (result.type === "error") {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      job: result.data,
      message: `${schedule.type} job created in Zuper`,
    });
  } catch (error) {
    console.error("Error creating Zuper job:", error);
    return NextResponse.json(
      { error: "Failed to create Zuper job", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Check if Zuper is configured
    if (!zuper.isConfigured()) {
      return NextResponse.json(
        { error: "Zuper integration not configured", configured: false },
        { status: 503 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const hubspotId = searchParams.get("hubspot_id");
    const status = searchParams.get("status");
    const category = searchParams.get("category");
    const fromDate = searchParams.get("from_date");
    const toDate = searchParams.get("to_date");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");

    const result = await zuper.searchJobs({
      status: status || undefined,
      category: category || undefined,
      from_date: fromDate || undefined,
      to_date: toDate || undefined,
      page,
      limit,
    });

    if (result.type === "error") {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    let jobs = result.data?.jobs || [];

    // Filter by HubSpot ID if provided
    if (hubspotId) {
      jobs = jobs.filter((job) =>
        job.job_tags?.includes(`hubspot-${hubspotId}`)
      );
    }

    return NextResponse.json({
      jobs,
      total: result.data?.total || jobs.length,
      page,
      limit,
    });
  } catch (error) {
    console.error("Error fetching Zuper jobs:", error);
    return NextResponse.json(
      { error: "Failed to fetch Zuper jobs", details: String(error) },
      { status: 500 }
    );
  }
}
