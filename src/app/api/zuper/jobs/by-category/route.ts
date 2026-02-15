import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zuper } from "@/lib/zuper";

/**
 * GET /api/zuper/jobs/by-category?categories=uid1,uid2&from_date=2026-01-01&to_date=2026-03-31
 * Fetches Zuper jobs filtered by one or more category UIDs.
 * Client-side filters since Zuper API doesn't natively support category filtering.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    if (!zuper.isConfigured()) {
      return NextResponse.json(
        { error: "Zuper integration not configured", configured: false },
        { status: 503 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const categoriesParam = searchParams.get("categories");
    const fromDate = searchParams.get("from_date");
    const toDate = searchParams.get("to_date");
    const limit = parseInt(searchParams.get("limit") || "500");

    if (!categoriesParam) {
      return NextResponse.json(
        { error: "categories parameter is required" },
        { status: 400 }
      );
    }

    const categoryUids = categoriesParam.split(",").map(s => s.trim()).filter(Boolean);

    const result = await zuper.searchJobs({
      from_date: fromDate || undefined,
      to_date: toDate || undefined,
      limit,
    });

    if (result.type === "error") {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // Client-side filter by category UIDs
    // Cast to `any` since Zuper API returns more fields than typed ZuperJob interface
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allJobs = (result.data?.jobs || []) as any[];
    const filtered = allJobs.filter(job => {
      const cat = job.job_category;
      const jobCatUid = typeof cat === "string"
        ? cat
        : (cat as Record<string, unknown> | null)?.category_uid;
      return jobCatUid && categoryUids.includes(jobCatUid as string);
    });

    // Transform to a simpler shape for the frontend
    const jobs = filtered.map(job => {
      const cat = typeof job.job_category === "object" ? job.job_category as Record<string, string> | null : null;
      const status = (job.current_job_status || null) as Record<string, string> | null;
      const customer = (job.customer || {}) as Record<string, string>;
      const address = (job.customer_address || {}) as Record<string, string>;
      const assigned = Array.isArray(job.assigned_to) ? job.assigned_to : [];
      const team = Array.isArray(job.assigned_to_team) ? job.assigned_to_team : [];
      const ext = (job.external_id || {}) as Record<string, string>;

      // Extract assigned user name
      let assignedUser = "";
      for (const a of assigned) {
        if (typeof a === "object" && a !== null) {
          const user = (a as Record<string, unknown>).user || a;
          if (typeof user === "object" && user !== null) {
            const u = user as Record<string, string>;
            assignedUser = `${u.first_name || ""} ${u.last_name || ""}`.trim();
            break;
          }
        }
      }

      // Extract team name
      let teamName = "";
      for (const t of team) {
        if (typeof t === "object" && t !== null) {
          const tm = (t as Record<string, unknown>).team;
          if (typeof tm === "object" && tm !== null) {
            teamName = (tm as Record<string, string>).team_name || "";
            break;
          }
        }
      }

      return {
        jobUid: job.job_uid as string || "",
        title: job.job_title as string || "",
        categoryName: cat?.category_name || "",
        categoryUid: cat?.category_uid || "",
        statusName: status?.status_name || "",
        statusColor: status?.status_color || "",
        dueDate: (job.due_date_dt as string) || "",
        scheduledStart: (job.scheduled_start_time as string) || null,
        scheduledEnd: (job.scheduled_end_time as string) || null,
        customerName: `${customer.customer_first_name || ""} ${customer.customer_last_name || ""}`.trim(),
        address: `${address.street || ""}, ${address.city || ""}, ${address.state || ""}`.replace(/, $/, ""),
        city: address.city || "",
        state: address.state || "",
        assignedUser,
        teamName,
        hubspotDealId: ext.hubspot_deal || "",
        jobTotal: (job.job_total as number) || 0,
        createdAt: (job.created_at as string) || "",
        workOrderNumber: String(job.work_order_number || ""),
      };
    });

    // Sort by scheduled start time, then due date
    jobs.sort((a, b) => {
      const aTime = a.scheduledStart || a.dueDate || "z";
      const bTime = b.scheduledStart || b.dueDate || "z";
      return aTime.localeCompare(bTime);
    });

    return NextResponse.json({ jobs, total: jobs.length });
  } catch (error) {
    console.error("Error fetching Zuper jobs by category:", error);
    return NextResponse.json(
      { error: "Failed to fetch Zuper jobs" },
      { status: 500 }
    );
  }
}
