import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { logActivity } from "@/lib/db";
import { zuper, createJobFromProject } from "@/lib/zuper";

// Inline validation for job creation request
const VALID_SCHEDULE_TYPES = ["survey", "installation", "inspection"] as const;

function validateJobCreation(data: unknown): data is {
  project: {
    id: string;
    name: string;
    address: string;
    city: string;
    state: string;
    zipCode?: string;
    systemSizeKw?: number;
    batteryCount?: number;
    projectType?: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
  };
  schedule: {
    type: "survey" | "installation" | "inspection";
    date: string;
    days?: number;
    crew?: string;
    teamUid?: string;
    notes?: string;
  };
} {
  if (!data || typeof data !== "object") return false;
  const req = data as Record<string, unknown>;

  // Validate project (required fields: id, name, address, city, state)
  if (!req.project || typeof req.project !== "object") return false;
  const project = req.project as Record<string, unknown>;
  if (typeof project.id !== "string" || project.id.length === 0) return false;
  if (typeof project.name !== "string" || project.name.length === 0) return false;
  if (typeof project.address !== "string") return false;
  if (typeof project.city !== "string") return false;
  if (typeof project.state !== "string") return false;

  // Validate schedule
  if (!req.schedule || typeof req.schedule !== "object") return false;
  const schedule = req.schedule as Record<string, unknown>;

  if (
    typeof schedule.type !== "string" ||
    !VALID_SCHEDULE_TYPES.includes(schedule.type as typeof VALID_SCHEDULE_TYPES[number])
  ) {
    return false;
  }

  if (typeof schedule.date !== "string" || schedule.date.length === 0) {
    return false;
  }

  // Optional fields validation
  if (schedule.days !== undefined && typeof schedule.days !== "number") return false;
  if (schedule.crew !== undefined && typeof schedule.crew !== "string") return false;
  if (schedule.teamUid !== undefined && typeof schedule.teamUid !== "string") return false;
  if (schedule.notes !== undefined && typeof schedule.notes !== "string") return false;

  return true;
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    // Check if Zuper is configured
    if (!zuper.isConfigured()) {
      return NextResponse.json(
        { error: "Zuper integration not configured", configured: false },
        { status: 503 }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    // Validate request body
    if (!validateJobCreation(body)) {
      return NextResponse.json(
        {
          error: `Invalid request: project (object with id, name, address, city, state), schedule (object with type: ${VALID_SCHEDULE_TYPES.join("|")}, date: string, optional days/crew/teamUid/notes) are required`,
        },
        { status: 400 }
      );
    }

    const { project, schedule } = body;

    // Create the job in Zuper
    const result = await createJobFromProject(project, {
      type: schedule.type as "survey" | "installation" | "inspection",
      date: schedule.date,
      days: schedule.days || 1,
      crew: schedule.crew,
      teamUid: schedule.teamUid,
      notes: schedule.notes,
    });

    if (result.type === "error") {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    // Log the job creation
    await logActivity({
      type: "ZUPER_JOB_CREATED",
      description: `Created ${schedule.type} job for ${project.name}`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "zuper_job",
      entityId: result.data?.job_uid,
      entityName: project.name,
      metadata: {
        scheduleType: schedule.type,
        scheduledDate: schedule.date,
        projectId: project.id,
        crew: schedule.crew,
      },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
    });

    return NextResponse.json({
      success: true,
      job: result.data,
      message: `${schedule.type} job created in Zuper`,
    });
  } catch (error) {
    console.error("Error creating Zuper job:", error);
    return NextResponse.json(
      { error: "Failed to create Zuper job" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

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
      { error: "Failed to fetch Zuper jobs" },
      { status: 500 }
    );
  }
}
