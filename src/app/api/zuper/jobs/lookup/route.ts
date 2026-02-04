import { NextRequest, NextResponse } from "next/server";
import { ZuperClient } from "@/lib/zuper";

/**
 * GET /api/zuper/jobs/lookup
 *
 * Look up Zuper jobs by HubSpot project IDs.
 * Returns a map of projectId -> zuperJobUid for projects that have Zuper jobs.
 *
 * Query params:
 * - projectIds: comma-separated list of HubSpot project IDs
 * - category: optional job category filter (e.g., "site-survey", "construction")
 */
export async function GET(request: NextRequest) {
  const zuper = new ZuperClient();

  if (!zuper.isConfigured()) {
    return NextResponse.json({
      configured: false,
      jobs: {}
    });
  }

  const { searchParams } = new URL(request.url);
  const projectIdsParam = searchParams.get("projectIds");
  const category = searchParams.get("category");

  if (!projectIdsParam) {
    return NextResponse.json(
      { error: "projectIds parameter required" },
      { status: 400 }
    );
  }

  const projectIds = projectIdsParam.split(",").map(id => id.trim()).filter(Boolean);

  if (projectIds.length === 0) {
    return NextResponse.json({ configured: true, jobs: {} });
  }

  try {
    // Search for jobs with matching HubSpot tags
    // We search for jobs that have the tag format "hubspot-{projectId}"
    const jobsMap: Record<string, {
      jobUid: string;
      jobTitle: string;
      status: string;
      scheduledDate?: string;
      category?: string;
    }> = {};

    // Batch search - Zuper's search doesn't support multiple tag searches at once,
    // so we need to search for each project ID individually
    // To optimize, we'll do a general search and filter locally
    const result = await zuper.searchJobs({
      limit: 500,
      // Get jobs from the last 6 months to now + 3 months
      from_date: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      to_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    });

    if (result.type === "success" && result.data?.jobs) {
      for (const job of result.data.jobs) {
        // Check if this job has a HubSpot tag matching one of our project IDs
        const tags = job.job_tags || [];
        for (const projectId of projectIds) {
          const hubspotTag = `hubspot-${projectId}`;
          if (tags.includes(hubspotTag)) {
            // Found a match - check category if specified
            if (category) {
              const categoryTag = `category-${category}`;
              if (!tags.includes(categoryTag)) {
                continue; // Skip if category doesn't match
              }
            }

            // Only add if job_uid exists
            if (job.job_uid) {
              jobsMap[projectId] = {
                jobUid: job.job_uid,
                jobTitle: job.job_title || "",
                status: job.status || "UNKNOWN",
                scheduledDate: job.scheduled_start_time,
                category: tags.find(t => t.startsWith("category-"))?.replace("category-", ""),
              };
            }
            break; // Found match for this project, move to next
          }
        }
      }
    }

    return NextResponse.json({
      configured: true,
      jobs: jobsMap,
      count: Object.keys(jobsMap).length,
    });
  } catch (error) {
    console.error("Zuper job lookup error:", error);
    return NextResponse.json(
      { error: "Failed to lookup Zuper jobs", configured: true, jobs: {} },
      { status: 500 }
    );
  }
}
