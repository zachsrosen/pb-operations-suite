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

  // Helper to get HubSpot Deal ID from custom fields
  const getHubSpotDealId = (job: ZuperJob): string | null => {
    if (!job.custom_fields || !Array.isArray(job.custom_fields)) return null;
    const dealIdField = job.custom_fields.find(
      (f) => f.label?.toLowerCase() === "hubspot deal id"
    );
    return dealIdField?.value || null;
  };

  // Completed/closed statuses that should be deprioritized
  const COMPLETED_STATUSES = new Set([
    "completed", "complete", "closed", "cancelled", "canceled",
    "construction complete", "inspection complete", "survey complete",
  ]);

  // Score a job's status: active/open jobs score higher than completed ones
  const getStatusScore = (job: ZuperJob): number => {
    const status = (job.status || "").toLowerCase();
    if (COMPLETED_STATUSES.has(status)) return 0;
    // Scheduled jobs are best — they're the active upcoming ones
    if (status === "scheduled" || status === "in_progress" || status === "in progress") return 20;
    // Unscheduled/new jobs are next
    if (status === "unassigned" || status === "new" || status === "created") return 15;
    // Any other non-completed status
    return 10;
  };

  // Helper to extract customer name from project name
  const extractCustomerName = (name: string): string => {
    const decoded = decodeURIComponent(name);
    const parts = decoded.split("|").map(p => p.trim());
    return parts.length > 1 ? parts[1].trim() : decoded.trim();
  };

  // Helper to extract address from project name (third segment after "|")
  const extractAddress = (name: string): string => {
    const decoded = decodeURIComponent(name);
    const parts = decoded.split("|").map(p => p.trim());
    return parts.length > 2 ? parts[2].trim() : "";
  };

  // Helper to extract customer last name for matching
  const extractLastName = (customerName: string): string => {
    if (customerName.includes(",")) {
      return customerName.split(",")[0].trim();
    }
    const parts = customerName.split(" ");
    return parts[parts.length - 1].trim();
  };

  // Helper to extract street number from an address string
  const extractStreetNumber = (address: string): string => {
    const match = address.match(/^\d+/);
    return match ? match[0] : "";
  };

  // Helper to check if Zuper job title matches a customer name and optionally address
  const jobTitleMatchesCustomer = (jobTitle: string, customerName: string, projectAddress: string): { matches: boolean; addressScore: number } => {
    const titleLower = jobTitle.toLowerCase();
    const customerLower = customerName.toLowerCase();
    const lastName = extractLastName(customerName).toLowerCase();

    let nameMatches = false;

    if (customerLower.length > 3 && titleLower.includes(customerLower)) {
      nameMatches = true;
    }
    if (!nameMatches && lastName.length > 2 && titleLower.startsWith(lastName)) {
      nameMatches = true;
    }
    if (!nameMatches && titleLower.includes(lastName + ",")) {
      nameMatches = true;
    }

    if (!nameMatches) return { matches: false, addressScore: 0 };

    let addressScore = 0;
    if (projectAddress) {
      const addressLower = projectAddress.toLowerCase();
      const streetNum = extractStreetNumber(projectAddress);
      if (addressLower.length > 5 && titleLower.includes(addressLower)) {
        addressScore = 10;
      } else if (streetNum && titleLower.includes(streetNum)) {
        addressScore = 5;
      }
    }

    return { matches: true, addressScore };
  };

  try {
    type JobMatch = {
      job: ZuperJob;
      matchMethod: "hubspot_deal_id" | "tag" | "name";
      methodScore: number; // higher = more reliable match method
      statusScore: number; // higher = more active job
      addressScore: number; // higher = better address match
      categoryName: string;
    };

    // Collect ALL candidate matches per project, then pick the best
    const allCandidates: Record<string, JobMatch[]> = {};

    const addCandidate = (projectId: string, match: JobMatch) => {
      if (!allCandidates[projectId]) allCandidates[projectId] = [];
      allCandidates[projectId].push(match);
    };

    // Search for jobs
    const result = await zuper.searchJobs({
      limit: 500,
      from_date: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      to_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    });

    console.log(`Zuper lookup: searching ${result.data?.jobs?.length || 0} jobs for ${projectIds.length} projects, category filter: ${targetCategory || 'none'}`);

    if (result.type === "success" && result.data?.jobs) {
      for (const job of result.data.jobs) {
        const jobCategoryName = getJobCategoryName(job);
        if (targetCategory && jobCategoryName !== targetCategory) continue;
        if (!job.job_uid) continue;

        const hubspotDealId = getHubSpotDealId(job);
        const tags = job.job_tags || [];
        const jobTitle = job.job_title || "";
        const statusScore = getStatusScore(job);

        for (let i = 0; i < projectIds.length; i++) {
          const projectId = projectIds[i];

          // Check Deal ID match (most reliable method)
          if (hubspotDealId && hubspotDealId === projectId) {
            addCandidate(projectId, {
              job,
              matchMethod: "hubspot_deal_id",
              methodScore: 100,
              statusScore,
              addressScore: 0,
              categoryName: jobCategoryName,
            });
          }

          // Check tag match
          const hubspotTag = `hubspot-${projectId}`;
          const hasHubspotTag = tags.some(t => t.toLowerCase() === hubspotTag.toLowerCase());
          if (hasHubspotTag) {
            addCandidate(projectId, {
              job,
              matchMethod: "tag",
              methodScore: 50,
              statusScore,
              addressScore: 0,
              categoryName: jobCategoryName,
            });
          }

          // Check name match
          const projectName = projectNames[i];
          if (projectName) {
            const customerName = extractCustomerName(projectName);
            const projectAddress = extractAddress(projectName);
            if (customerName.length > 3) {
              const { matches, addressScore } = jobTitleMatchesCustomer(jobTitle, customerName, projectAddress);
              if (matches) {
                addCandidate(projectId, {
                  job,
                  matchMethod: "name",
                  methodScore: 10,
                  statusScore,
                  addressScore,
                  categoryName: jobCategoryName,
                });
              }
            }
          }
        }
      }
    }

    // Pick the best candidate for each project
    // Sort by: matchMethod reliability → active status → address match
    const jobsMap: Record<string, {
      jobUid: string;
      jobTitle: string;
      status: string;
      scheduledDate?: string;
      category?: string;
      matchedBy?: string;
    }> = {};

    for (const [projectId, candidates] of Object.entries(allCandidates)) {
      // Deduplicate by job UID (same job can match via multiple methods)
      const uniqueByUid = new Map<string, JobMatch>();
      for (const c of candidates) {
        const uid = c.job.job_uid!;
        const existing = uniqueByUid.get(uid);
        if (!existing || c.methodScore > existing.methodScore) {
          uniqueByUid.set(uid, c);
        }
      }

      const dedupedCandidates = [...uniqueByUid.values()];

      // Sort: highest methodScore first, then statusScore, then addressScore
      dedupedCandidates.sort((a, b) => {
        if (a.methodScore !== b.methodScore) return b.methodScore - a.methodScore;
        if (a.statusScore !== b.statusScore) return b.statusScore - a.statusScore;
        return b.addressScore - a.addressScore;
      });

      const best = dedupedCandidates[0];
      const totalCandidates = dedupedCandidates.length;
      console.log(
        `Zuper: Matched job ${best.job.job_uid} to project ${projectId} by ${best.matchMethod}` +
        ` (status: ${best.job.status}, statusScore: ${best.statusScore}, candidates: ${totalCandidates}, category: ${best.categoryName})`
      );

      jobsMap[projectId] = {
        jobUid: best.job.job_uid!,
        jobTitle: best.job.job_title || "",
        status: best.job.status || "UNKNOWN",
        scheduledDate: best.job.scheduled_start_time,
        category: best.categoryName,
        matchedBy: best.matchMethod,
      };
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
