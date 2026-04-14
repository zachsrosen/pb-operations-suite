import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zuper } from "@/lib/zuper";

/**
 * GET /api/zuper/jobs/by-category?categories=uid1,uid2&from_date=2026-01-01&to_date=2026-03-31
 * GET /api/zuper/jobs/by-category?exclude=uid1,uid2&from_date=2026-01-01&to_date=2026-03-31
 * Fetches Zuper jobs filtered by category UIDs.
 * Client-side filters since Zuper API doesn't reliably support multi-category filters.
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
    const excludeParam = searchParams.get("exclude");
    const fromDate = searchParams.get("from_date");
    const toDate = searchParams.get("to_date");
    const limitParam = searchParams.get("limit");
    const outputLimit = limitParam ? parseInt(limitParam, 10) : null;

    if (!categoriesParam && !excludeParam) {
      return NextResponse.json(
        { error: "categories or exclude parameter is required" },
        { status: 400 }
      );
    }

    const categoryUids = categoriesParam
      ? categoriesParam.split(",").map(s => s.trim()).filter(Boolean)
      : [];
    const excludeUids = excludeParam
      ? excludeParam.split(",").map(s => s.trim()).filter(Boolean)
      : [];

    const PAGE_SIZE = 500;
    const MAX_PAGES = 10; // Safety cap: 5000 raw jobs max per request

    const page1 = await zuper.searchJobs({
      from_date: fromDate || undefined,
      to_date: toDate || undefined,
      limit: PAGE_SIZE,
      page: 1,
    });

    if (page1.type === "error") {
      return NextResponse.json({ error: page1.error }, { status: 500 });
    }

    const allJobs = [...(page1.data?.jobs || [])];
    const total = page1.data?.total || allJobs.length;
    const totalPages = Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGES);

    if (totalPages > 1) {
      const pagePromises = [];
      for (let page = 2; page <= totalPages; page++) {
        pagePromises.push(zuper.searchJobs({
          from_date: fromDate || undefined,
          to_date: toDate || undefined,
          limit: PAGE_SIZE,
          page,
        }));
      }
      const pageResults = await Promise.all(pagePromises);
      for (const result of pageResults) {
        if (result.type === "success" && result.data?.jobs) {
          allJobs.push(...result.data.jobs);
        }
      }
    }

    if (totalPages === MAX_PAGES && total > PAGE_SIZE * MAX_PAGES) {
      console.warn(
        "Zuper jobs by category truncated at pagination safety cap",
        { total, maxRawJobs: PAGE_SIZE * MAX_PAGES }
      );
    }

    // Client-side filter by category UIDs (include list or exclude list)
    // Cast to `any` since Zuper API returns more fields than typed ZuperJob interface
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filtered = (allJobs as any[]).filter(job => {
      const cat = job.job_category;
      const jobCatUid = typeof cat === "string"
        ? cat
        : (cat as Record<string, unknown> | null)?.category_uid;
      if (!jobCatUid) return false;
      if (excludeUids.length > 0) {
        return !excludeUids.includes(jobCatUid as string);
      }
      return categoryUids.includes(jobCatUid as string);
    });
    const limited = outputLimit && outputLimit > 0
      ? filtered.slice(0, outputLimit)
      : filtered;

    // Transform to a simpler shape for the frontend
    const jobs = limited.map(job => {
      const cat = typeof job.job_category === "object" ? job.job_category as Record<string, string> | null : null;
      const status = (job.current_job_status || null) as Record<string, string> | null;
      const customer = (job.customer || {}) as Record<string, string>;
      const address = (job.customer_address || {}) as Record<string, string>;
      const assigned = Array.isArray(job.assigned_to) ? job.assigned_to : [];
      const team = Array.isArray(job.assigned_to_team) ? job.assigned_to_team : [];
      const ext = (job.external_id || {}) as Record<string, string>;

      // Extract assigned user names (all assignees)
      const assignedUsers: string[] = [];
      for (const a of assigned) {
        if (typeof a === "object" && a !== null) {
          const user = (a as Record<string, unknown>).user || a;
          if (typeof user === "object" && user !== null) {
            const u = user as Record<string, string>;
            const name = `${u.first_name || ""} ${u.last_name || ""}`.trim();
            if (name) assignedUsers.push(name);
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
        assignedUser: assignedUsers[0] || "",
        assignedUsers,
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
