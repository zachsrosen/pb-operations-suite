import { NextRequest, NextResponse } from "next/server";
import { ZuperClient, ZuperJob } from "@/lib/zuper";

/**
 * GET /api/zuper/jobs/lookup
 *
 * Look up Zuper jobs by HubSpot project IDs.
 * Returns a map of projectId -> zuperJobUid for projects that have Zuper jobs.
 *
 * Query params:
 * - projectIds: comma-separated list of HubSpot project IDs
 * - projectNames: comma-separated list of project names (for fallback matching)
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
  const projectNamesParam = searchParams.get("projectNames");
  const category = searchParams.get("category");

  if (!projectIdsParam) {
    return NextResponse.json(
      { error: "projectIds parameter required" },
      { status: 400 }
    );
  }

  const projectIds = projectIdsParam.split(",").map(id => id.trim()).filter(Boolean);
  const projectNames = projectNamesParam ? projectNamesParam.split(",").map(n => n.trim()).filter(Boolean) : [];

  if (projectIds.length === 0) {
    return NextResponse.json({ configured: true, jobs: {} });
  }

  // Map URL category param to Zuper job category names
  // Same mapping used in /api/zuper/jobs/schedule
  const categoryMap: Record<string, string> = {
    "site-survey": "Site Survey",
    "survey": "Site Survey",
    "construction": "Construction",
    "installation": "Construction",
    "inspection": "Inspection",
  };
  const targetCategory = category ? categoryMap[category] || category : null;

  // Helper to get category name from job (handles both string and object formats)
  const getJobCategoryName = (job: ZuperJob): string => {
    if (typeof job.job_category === "string") {
      return job.job_category;
    }
    return job.job_category?.category_name || "";
  };

  // Helper to extract customer name from project name (format: "ProjectID | Customer Name")
  const extractCustomerName = (name: string): string => {
    const parts = name.split("|");
    return parts.length > 1 ? parts[1].trim() : name.trim();
  };

  try {
    const jobsMap: Record<string, {
      jobUid: string;
      jobTitle: string;
      status: string;
      scheduledDate?: string;
      category?: string;
      matchedBy?: string;
    }> = {};

    // Search for jobs
    const result = await zuper.searchJobs({
      limit: 500,
      // Get jobs from the last 6 months to now + 3 months
      from_date: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      to_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    });

    // Log for debugging
    console.log(`Zuper lookup: searching ${result.data?.jobs?.length || 0} jobs for ${projectIds.length} projects, category filter: ${targetCategory || 'none'}`);

    if (result.type === "success" && result.data?.jobs) {
      // First pass: Match by HubSpot tag (most reliable)
      for (const job of result.data.jobs) {
        const tags = job.job_tags || [];
        const jobCategoryName = getJobCategoryName(job);

        for (let i = 0; i < projectIds.length; i++) {
          const projectId = projectIds[i];

          // Skip if we already found a job for this project
          if (jobsMap[projectId]) continue;

          // Check category filter first
          if (targetCategory && jobCategoryName !== targetCategory) {
            continue;
          }

          // Try multiple hubspot tag formats (case-insensitive)
          const hubspotTag = `hubspot-${projectId}`;
          const hasHubspotTag = tags.some(t => t.toLowerCase() === hubspotTag.toLowerCase());

          if (hasHubspotTag && job.job_uid) {
            console.log(`Zuper: Matched job ${job.job_uid} to project ${projectId} by tag (category: ${jobCategoryName})`);
            jobsMap[projectId] = {
              jobUid: job.job_uid,
              jobTitle: job.job_title || "",
              status: job.status || "UNKNOWN",
              scheduledDate: job.scheduled_start_time,
              category: jobCategoryName,
              matchedBy: "tag",
            };
            break;
          }
        }
      }

      // Second pass: Match by customer name in job title (fallback for jobs created outside the app)
      if (projectNames.length > 0) {
        for (const job of result.data.jobs) {
          const jobCategoryName = getJobCategoryName(job);
          const jobTitle = job.job_title || "";

          for (let i = 0; i < projectIds.length; i++) {
            const projectId = projectIds[i];
            const projectName = projectNames[i];

            // Skip if we already found a job for this project
            if (jobsMap[projectId] || !projectName) continue;

            // Check category filter first
            if (targetCategory && jobCategoryName !== targetCategory) {
              continue;
            }

            // Extract customer name from project name and check if job title contains it
            const customerName = extractCustomerName(projectName);
            if (customerName.length > 3 && jobTitle.toLowerCase().includes(customerName.toLowerCase()) && job.job_uid) {
              console.log(`Zuper: Matched job ${job.job_uid} to project ${projectId} by name "${customerName}" (category: ${jobCategoryName})`);
              jobsMap[projectId] = {
                jobUid: job.job_uid,
                jobTitle: job.job_title || "",
                status: job.status || "UNKNOWN",
                scheduledDate: job.scheduled_start_time,
                category: jobCategoryName,
                matchedBy: "name",
              };
              break;
            }
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
