import { NextRequest, NextResponse } from "next/server";
import { ZuperClient, ZuperJob } from "@/lib/zuper";
import { getCachedZuperJobsByDealIds } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";

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
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

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
  // Project names use "|||" delimiter because names contain commas (e.g. "LastName, FirstName")
  // which would break comma-based splitting after URL decoding
  const projectNames = projectNamesParam
    ? projectNamesParam.split("|||").map(n => decodeURIComponent(n.trim())).filter(Boolean)
    : [];

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
  // Zuper jobs may have "HubSpot Deal ID" (numeric) or "Hubspot Deal Link" (URL) fields
  // When WE create jobs, we set custom_fields: { hubspot_deal_id: project.id } (by name, not label)
  // Zuper may return these with either `label` or `name` fields, with varying casing
  const getHubSpotDealId = (job: ZuperJob): string | null => {
    if (!job.custom_fields || !Array.isArray(job.custom_fields)) return null;

    // Try direct numeric ID field — check both label and name (case-insensitive)
    const dealIdField = job.custom_fields.find((f) => {
      const label = f.label?.toLowerCase() || "";
      const name = (f as { name?: string }).name?.toLowerCase() || "";
      return label === "hubspot deal id" || label === "hubspot_deal_id" ||
             name === "hubspot_deal_id" || name === "hubspot deal id";
    });
    if (dealIdField?.value) return dealIdField.value;

    // Fall back to extracting ID from the deal link URL
    const dealLinkField = job.custom_fields.find((f) => {
      const label = f.label?.toLowerCase() || "";
      const name = (f as { name?: string }).name?.toLowerCase() || "";
      return (label.includes("hubspot") && label.includes("link")) ||
             (name.includes("hubspot") && name.includes("link"));
    });
    if (dealLinkField?.value) {
      const urlMatch = dealLinkField.value.match(/\/record\/0-3\/(\d+)/);
      if (urlMatch) return urlMatch[1];
    }
    return null;
  };

  // Helper to extract assigned user name from a Zuper job
  // Zuper GET response format: assigned_to: [{ user: { first_name, last_name, user_uid } }]
  const getAssignedUserName = (job: ZuperJob): string | undefined => {
    if (!job.assigned_to || !Array.isArray(job.assigned_to) || job.assigned_to.length === 0) return undefined;
    const firstAssignment = job.assigned_to[0];
    // Handle GET response format: { user: { first_name, last_name } }
    if (typeof firstAssignment === 'object' && 'user' in firstAssignment) {
      const user = (firstAssignment as { user: { first_name?: string; last_name?: string } }).user;
      const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
      return name || undefined;
    }
    return undefined;
  };

  // Completed/closed statuses that should be deprioritized
  const COMPLETED_STATUSES = new Set([
    "completed", "complete", "closed", "cancelled", "canceled",
    "construction complete", "inspection complete", "survey complete",
  ]);

  // Score a job's status: active/open jobs score higher than completed ones
  // Zuper API returns actual status in `current_job_status.status_name`, not `status`
  const getJobStatus = (job: ZuperJob): string => {
    return job.current_job_status?.status_name || job.status || "";
  };
  const getStatusScore = (job: ZuperJob): number => {
    const status = getJobStatus(job).toLowerCase();
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

  // Helper to extract PROJ number (e.g. "PROJ-7637") from project name
  // Project name format: "PROJ-7637 | Smith, Victor | 123 Main St"
  const extractProjectNumber = (name: string): string => {
    const decoded = decodeURIComponent(name);
    const firstPart = decoded.split("|")[0].trim();
    const projMatch = firstPart.match(/PROJ-\d+/i);
    return projMatch ? projMatch[0] : "";
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

  // Helper to check if Zuper job title matches a customer name and optionally address/PROJ number
  const jobTitleMatchesCustomer = (jobTitle: string, customerName: string, projectAddress: string, projNumber: string = ""): { matches: boolean; addressScore: number } => {
    const titleLower = jobTitle.toLowerCase();
    const customerLower = customerName.toLowerCase();
    const lastName = extractLastName(customerName).toLowerCase();

    let nameMatches = false;

    // PROJ number match is strongest — if title contains "PROJ-7637", it's almost certainly the right job
    if (projNumber && titleLower.includes(projNumber.toLowerCase())) {
      nameMatches = true;
    }

    if (!nameMatches && customerLower.length > 3 && titleLower.includes(customerLower)) {
      nameMatches = true;
    }
    // Use includes instead of startsWith — our job titles are "Inspection - PROJ-7637 | Smith, Victor"
    if (!nameMatches && lastName.length > 2 && titleLower.includes(lastName + ",")) {
      nameMatches = true;
    }
    if (!nameMatches && lastName.length > 2 && titleLower.startsWith(lastName)) {
      nameMatches = true;
    }

    if (!nameMatches) return { matches: false, addressScore: 0 };

    let addressScore = 0;

    // PROJ number match gets highest address bonus — disambiguates common last names
    if (projNumber && titleLower.includes(projNumber.toLowerCase())) {
      addressScore += 20;
    }

    if (projectAddress) {
      const addressLower = projectAddress.toLowerCase();
      const streetNum = extractStreetNumber(projectAddress);
      if (addressLower.length > 5 && titleLower.includes(addressLower)) {
        addressScore += 10;
      } else if (streetNum && titleLower.includes(streetNum)) {
        addressScore += 5;
      }
    }

    return { matches: true, addressScore };
  };

  try {
    type JobMatch = {
      job: ZuperJob;
      matchMethod: "db_cache" | "hubspot_deal_id" | "tag" | "name";
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

    // --- Pass 0: Database cache (most reliable — set when jobs are scheduled through the app) ---
    try {
      const categoryForDb = targetCategory || undefined;
      const cachedJobs = await getCachedZuperJobsByDealIds(projectIds, categoryForDb);
      for (const cached of cachedJobs) {
        if (cached.hubspotDealId && cached.jobUid) {
          // Build a ZuperJob-like object with ALL relevant fields from the cache
          // Previously only job_uid/job_title/status were included, which caused
          // scheduledDate and assignedTo to be undefined when the cache won over API results
          const cachedAssignedUsers = cached.assignedUsers as { user_uid: string; user_name?: string }[] | null;
          const assignedTo = cachedAssignedUsers?.length
            ? cachedAssignedUsers.map(u => {
                const parts = (u.user_name || "").split(" ");
                return { user: { first_name: parts[0] || "", last_name: parts.slice(1).join(" ") || "", user_uid: u.user_uid } };
              })
            : undefined;
          const cachedJob = {
            job_uid: cached.jobUid,
            job_title: cached.jobTitle,
            status: cached.jobStatus,
            scheduled_start_time: cached.scheduledStart?.toISOString(),
            scheduled_end_time: cached.scheduledEnd?.toISOString(),
            current_job_status: { status_name: cached.jobStatus },
            ...(assignedTo && { assigned_to: assignedTo }),
          } as ZuperJob;
          addCandidate(cached.hubspotDealId, {
            job: cachedJob,
            matchMethod: "db_cache",
            methodScore: 200, // Highest priority — direct DB mapping from scheduling
            statusScore: getStatusScore(cachedJob),
            addressScore: 0,
            categoryName: cached.jobCategory,
          });
          console.log(`Zuper: DB cache hit for project ${cached.hubspotDealId} → job ${cached.jobUid} (scheduled: ${cached.scheduledStart?.toISOString()}, assigned: ${cachedAssignedUsers?.[0]?.user_name || 'none'})`);
        }
      }
    } catch (dbErr) {
      console.warn("Zuper: DB cache lookup failed, falling back to API:", dbErr);
    }

    // --- Zuper API search (for projects not found in DB cache) ---
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

          // Check tag match (hubspot-{dealId} tag)
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

          // Check PROJ number tag match (e.g. "proj-7637" tag)
          const pName = projectNames[i];
          if (pName) {
            const projNum = extractProjectNumber(pName);
            if (projNum) {
              const hasProjTag = tags.some(t => t.toLowerCase() === projNum.toLowerCase());
              if (hasProjTag) {
                addCandidate(projectId, {
                  job,
                  matchMethod: "tag",
                  methodScore: 45, // Slightly less than hubspot tag but still strong
                  statusScore,
                  addressScore: 0,
                  categoryName: jobCategoryName,
                });
              }
            }
          }

          // Check name match (with PROJ number disambiguation)
          if (pName) {
            const customerName = extractCustomerName(pName);
            const projectAddress = extractAddress(pName);
            const projNumber = extractProjectNumber(pName);

            // Standalone PROJ number match — even if customer name doesn't match,
            // a PROJ number in the title is a strong signal (score between tag and name)
            if (projNumber && jobTitle.toLowerCase().includes(projNumber.toLowerCase())) {
              addCandidate(projectId, {
                job,
                matchMethod: "name",
                methodScore: 30, // Between tag (50) and pure name (10)
                statusScore,
                addressScore: 20,
                categoryName: jobCategoryName,
              });
            }

            if (customerName.length > 3) {
              const { matches, addressScore } = jobTitleMatchesCustomer(jobTitle, customerName, projectAddress, projNumber);
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
      assignedTo?: string;
    }> = {};

    for (const [projectId, candidates] of Object.entries(allCandidates)) {
      // Deduplicate by job UID (same job can match via multiple methods)
      // When the same job matches via both DB cache and API, prefer the API's live data
      // (it has up-to-date schedule/assignment info) but keep the DB cache's higher methodScore
      const uniqueByUid = new Map<string, JobMatch>();
      for (const c of candidates) {
        const uid = c.job.job_uid!;
        const existing = uniqueByUid.get(uid);
        if (!existing) {
          uniqueByUid.set(uid, c);
        } else if (c.matchMethod !== "db_cache" && existing.matchMethod === "db_cache") {
          // API match for same UID — use API's live job data but inherit DB cache's methodScore
          uniqueByUid.set(uid, { ...c, methodScore: existing.methodScore });
        } else if (c.methodScore > existing.methodScore) {
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
        ` (status: ${getJobStatus(best.job)}, statusScore: ${best.statusScore}, candidates: ${totalCandidates}, category: ${best.categoryName})`
      );

      const assignedUser = getAssignedUserName(best.job);
      jobsMap[projectId] = {
        jobUid: best.job.job_uid!,
        jobTitle: best.job.job_title || "",
        status: getJobStatus(best.job) || "UNKNOWN",
        scheduledDate: best.job.scheduled_start_time,
        category: best.categoryName,
        matchedBy: best.matchMethod,
        ...(assignedUser && { assignedTo: assignedUser }),
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
