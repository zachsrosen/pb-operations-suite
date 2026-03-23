import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail } from "@/lib/db";
import { zuper } from "@/lib/zuper";

/**
 * GET /api/zuper/jobs/detail?uid=xxx
 * Returns the full Zuper job detail including status history.
 * Admin-only.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const dbUser = await getUserByEmail(authResult.email);
  if (!dbUser || dbUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const uid = request.nextUrl.searchParams.get("uid");
  if (!uid) {
    return NextResponse.json({ error: "uid parameter required" }, { status: 400 });
  }

  const result = await zuper.getJob(uid);
  if (result.type !== "success" || !result.data) {
    return NextResponse.json({ error: result.error || "Job not found" }, { status: 404 });
  }

  const job = result.data as unknown as Record<string, unknown>;
  const statusHistory = Array.isArray(job.job_status)
    ? (job.job_status as { status_name?: string; created_at?: string }[]).map((e) => ({
        status: e.status_name || "Unknown",
        at: e.created_at || "",
      }))
    : [];

  // Extract hubspot_deal_id from custom fields
  let hubspotDealId: string | null = null;
  const cf = job.custom_fields;
  if (Array.isArray(cf)) {
    const match = cf.find((f: { label?: string }) =>
      (f.label || "").toLowerCase().replace(/[\s_-]/g, "") === "hubspotdealid"
    ) as { value?: string } | undefined;
    if (match?.value) hubspotDealId = String(match.value);
  } else if (cf && typeof cf === "object") {
    const val = (cf as Record<string, unknown>).hubspot_deal_id;
    if (val) hubspotDealId = String(val);
  }

  return NextResponse.json({
    jobUid: job.job_uid,
    title: job.job_title,
    currentStatus: (job.current_job_status as { status_name?: string })?.status_name || "Unknown",
    scheduledStart: job.scheduled_start_time,
    scheduledEnd: job.scheduled_end_time,
    hubspotDealId,
    customFields: job.custom_fields,
    statusHistory,
  });
}

/**
 * PUT /api/zuper/jobs/detail?uid=xxx
 * Update a Zuper job's status. Admin-only.
 * Body: { status: "Cancelled" }
 */
export async function PUT(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const dbUser = await getUserByEmail(authResult.email);
  if (!dbUser || dbUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const uid = request.nextUrl.searchParams.get("uid");
  if (!uid) {
    return NextResponse.json({ error: "uid parameter required" }, { status: 400 });
  }

  const body = await request.json();
  if (!body.status) {
    return NextResponse.json({ error: "status required" }, { status: 400 });
  }

  const result = await zuper.updateJobStatus(uid, body.status);
  if (result.type !== "success") {
    return NextResponse.json({ error: result.error || "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true, jobUid: uid, newStatus: body.status });
}
