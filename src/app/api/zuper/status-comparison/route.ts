import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail } from "@/lib/db";
import { zuper, JOB_CATEGORY_UIDS } from "@/lib/zuper";
import { Client } from "@hubspot/api-client";

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
});

interface ZuperJobSummary {
  jobUid: string;
  jobTitle: string;
  projectNumber: string;
  hubspotDealId: string | null;
  zuperStatus: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  createdAt: string | null;
  completedAt: string | null;
  team: string | null;
  assignedTo: string | null;
  category: string;
}

type ComparisonCategory = "site_survey" | "construction" | "inspection";

interface HubSpotDealData {
  dealId: string;
  dealName: string;
  pbLocation: string | null;
  // Status fields
  siteSurveyStatus: string | null;
  constructionStatus: string | null;
  inspectionStatus: string | null;
  // Schedule dates
  siteSurveyScheduleDate: string | null;
  constructionScheduleDate: string | null;
  inspectionScheduleDate: string | null;
  // Completion dates
  siteSurveyCompletionDate: string | null;
  constructionCompleteDate: string | null;
  inspectionPassDate: string | null;
}

export interface ComparisonRecord {
  projectNumber: string;
  dealId: string | null;
  dealName: string | null;
  dealUrl: string | null;
  pbLocation: string | null;
  zuperJobUid: string;
  zuperJobTitle: string;
  zuperStatus: string;
  hubspotStatus: string | null;
  category: string;
  isMismatch: boolean;
  // Zuper dates
  zuperScheduledStart: string | null;
  zuperScheduledEnd: string | null;
  zuperCreatedAt: string | null;
  zuperCompletedAt: string | null;
  // HubSpot dates (vary by category)
  hubspotScheduleDate: string | null;
  hubspotCompletionDate: string | null;
  // Date comparison
  scheduleDateMatch: boolean | null; // null if either date missing
  completionDateMatch: boolean | null;
  // Team info
  team: string | null;
  assignedTo: string | null;
}

// Project-level grouped view: all 3 categories side by side per project
export interface ProjectGroupedRecord {
  projectNumber: string;
  dealId: string | null;
  dealName: string | null;
  dealUrl: string | null;
  pbLocation: string | null;
  // Site Survey
  survey: {
    zuperJobUid: string | null;
    zuperStatus: string | null;
    hubspotStatus: string | null;
    isMismatch: boolean;
    zuperScheduledStart: string | null;
    hubspotScheduleDate: string | null;
    scheduleDateMatch: boolean | null;
    zuperCompletedAt: string | null;
    hubspotCompletionDate: string | null;
    completionDateMatch: boolean | null;
    team: string | null;
    assignedTo: string | null;
  };
  // Construction
  construction: {
    zuperJobUid: string | null;
    zuperStatus: string | null;
    hubspotStatus: string | null;
    isMismatch: boolean;
    zuperScheduledStart: string | null;
    hubspotScheduleDate: string | null;
    scheduleDateMatch: boolean | null;
    zuperCompletedAt: string | null;
    hubspotCompletionDate: string | null;
    completionDateMatch: boolean | null;
    team: string | null;
    assignedTo: string | null;
  };
  // Inspection
  inspection: {
    zuperJobUid: string | null;
    zuperStatus: string | null;
    hubspotStatus: string | null;
    isMismatch: boolean;
    zuperScheduledStart: string | null;
    hubspotScheduleDate: string | null;
    scheduleDateMatch: boolean | null;
    zuperCompletedAt: string | null;
    hubspotCompletionDate: string | null;
    completionDateMatch: boolean | null;
    team: string | null;
    assignedTo: string | null;
  };
  hasAnyMismatch: boolean;
  hasAnyDateMismatch: boolean;
}

// Extract project number (e.g., "PROJ-7710") from a Zuper job title
function extractProjectNumber(title: string): string | null {
  const match = title.match(/PROJ-(\d+)/i);
  return match ? `PROJ-${match[1]}` : null;
}

// Extract HubSpot deal id from Zuper job metadata (custom fields, tags, notes)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractHubspotDealId(job: any): string | null {
  const normalizeId = (value: unknown): string | null => {
    if (!value) return null;
    const raw = String(value).trim();
    const numericMatch = raw.match(/\b\d{6,}\b/);
    return numericMatch ? numericMatch[0] : null;
  };

  const customFields = job.custom_fields;
  if (Array.isArray(customFields)) {
    const directField = customFields.find((f) => {
      const label = String(f?.label || "").toLowerCase();
      const name = String(f?.name || "").toLowerCase();
      return (
        label === "hubspot deal id" ||
        label === "hubspot_deal_id" ||
        name === "hubspot_deal_id" ||
        name === "hubspot deal id"
      );
    });
    const directValue = normalizeId(directField?.value);
    if (directValue) return directValue;

    const linkField = customFields.find((f) => {
      const label = String(f?.label || "").toLowerCase();
      const name = String(f?.name || "").toLowerCase();
      return (
        (label.includes("hubspot") && label.includes("link")) ||
        (name.includes("hubspot") && name.includes("link"))
      );
    });
    const linkMatch = String(linkField?.value || "").match(/\/record\/0-3\/(\d+)/);
    if (linkMatch?.[1]) return linkMatch[1];
  } else if (customFields && typeof customFields === "object") {
    const directValue = normalizeId((customFields as Record<string, unknown>).hubspot_deal_id);
    if (directValue) return directValue;
  }

  if (Array.isArray(job.job_tags)) {
    for (const tag of job.job_tags) {
      const tagMatch = String(tag).match(/^hubspot-(\d+)$/i);
      if (tagMatch?.[1]) return tagMatch[1];
    }
  }

  const notesMatch = String(job.job_notes || "").match(/hubspot\s*deal\s*id\s*:\s*(\d+)/i);
  if (notesMatch?.[1]) return notesMatch[1];

  return null;
}

// Determine the "current" Zuper status from job data
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getZuperCurrentStatus(job: any): string {
  return (
    job.current_job_status?.status_name ||
    job.status?.status_name ||
    job.status ||
    "Unknown"
  );
}

// Get assigned user names from a Zuper job
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getAssignedNames(job: any): string | null {
  if (!job.assigned_to || !Array.isArray(job.assigned_to)) return null;
  const names = job.assigned_to
    .map((a: { user?: { first_name?: string; last_name?: string } }) => {
      if (a.user) {
        return `${a.user.first_name || ""} ${a.user.last_name || ""}`.trim();
      }
      return null;
    })
    .filter(Boolean);
  return names.length > 0 ? names.join(", ") : null;
}

// Get team name from a Zuper job
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTeamName(job: any): string | null {
  if (job.assigned_to_team && Array.isArray(job.assigned_to_team)) {
    const team = job.assigned_to_team[0]?.team;
    if (team?.team_name) return team.team_name;
  }
  return null;
}

// Define which Zuper statuses map to which HubSpot statuses
const STATUS_MAPPING: Record<string, Record<string, string[]>> = {
  site_survey: {
    "Scheduling On-Hold": ["Scheduling On-Hold"],
    "Ready To Schedule": ["Ready to Schedule"],
    "Awaiting Reply": ["Awaiting Reply"],
    "Scheduled": ["Scheduled"],
    "On Our Way": ["On Our Way"],
    "Started": ["Started", "In Progress"],
    "Completed": ["Completed"],
    "Needs Revisit": ["Needs Revisit"],
  },
  construction: {
    "Ready To Build": ["Ready to Build"],
    "Scheduled": ["Scheduled"],
    "On Our Way": ["On Our Way"],
    "Started": ["Started", "In Progress"],
    "Loose Ends Remaining": ["Loose Ends Remaining"],
    "Construction Complete": ["Construction Complete"],
  },
  inspection: {
    "Ready For Inspection": ["Ready For Inspection"],
    "Scheduled": ["Scheduled"],
    "On Our Way": ["On Our Way"],
    "Started": ["Started", "In Progress"],
    "Passed": ["Passed"],
    "Partial Pass": ["Partial Pass"],
    "Failed": ["Failed"],
  },
};

// Check if Zuper status and HubSpot status are in sync
function isStatusMismatch(
  zuperStatus: string,
  hubspotStatus: string | null,
  category: string
): boolean {
  if (!hubspotStatus) return true;

  const categoryMap = STATUS_MAPPING[category];
  if (!categoryMap) return zuperStatus.toLowerCase() !== hubspotStatus.toLowerCase();

  const expectedHubspotStatuses = categoryMap[zuperStatus];
  if (!expectedHubspotStatuses) {
    return zuperStatus.toLowerCase() !== hubspotStatus.toLowerCase();
  }

  return !expectedHubspotStatuses.some(
    (s) => s.toLowerCase() === hubspotStatus.toLowerCase()
  );
}

// Compare two date strings (just the date portion, ignoring time)
// Returns true if they are the same day, false if different, null if either is missing
function compareDates(date1: string | null, date2: string | null): boolean | null {
  if (!date1 || !date2) return null;
  try {
    const d1 = new Date(date1).toISOString().split("T")[0];
    const d2 = new Date(date2).toISOString().split("T")[0];
    return d1 === d2;
  } catch {
    return null;
  }
}

function isWithinDateWindow(dateStr: string | null, fromDate?: string, toDate?: string): boolean {
  if (!fromDate || !toDate) return !!dateStr;
  if (!dateStr) return false;
  try {
    const value = new Date(dateStr).toISOString().split("T")[0];
    return value >= fromDate && value <= toDate;
  } catch {
    return false;
  }
}

// Fetch all Zuper jobs for a category with pagination (filtered by date range)
const MAX_PAGES = 50; // Safety cap: 50 pages × 100 jobs = 5,000 jobs max per category

async function fetchAllZuperJobs(categoryUid: string, fromDate?: string, toDate?: string): Promise<ZuperJobSummary[]> {
  const allJobs: ZuperJobSummary[] = [];
  let page = 1;
  const limit = 100;
  let hasMore = true;
  let totalRecords = Infinity;

  while (hasMore && page <= MAX_PAGES) {
    const result = await zuper.searchJobs({
      category: categoryUid,
      from_date: fromDate,
      to_date: toDate,
      page,
      limit,
    });

    if (result.type === "error" || !result.data?.jobs?.length) {
      break;
    }

    // Use total from API to know when to stop
    if (result.data.total && result.data.total < Infinity) {
      totalRecords = result.data.total;
    }

    for (const job of result.data.jobs) {
      // Zuper search can return mixed categories; enforce category match locally.
      const actualCategoryUid =
        typeof job.job_category === "string"
          ? job.job_category
          : job.job_category?.category_uid;

      if (actualCategoryUid && actualCategoryUid !== categoryUid) {
        continue;
      }

      const projectNumber = extractProjectNumber(job.job_title || "");
      if (!projectNumber) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawJob = job as any;

      let mappedCategory: ComparisonCategory;
      const categoryForMapping = actualCategoryUid || categoryUid;
      if (categoryForMapping === JOB_CATEGORY_UIDS.SITE_SURVEY) {
        mappedCategory = "site_survey";
      } else if (categoryForMapping === JOB_CATEGORY_UIDS.CONSTRUCTION) {
        mappedCategory = "construction";
      } else {
        mappedCategory = "inspection";
      }

      allJobs.push({
        jobUid: job.job_uid || "",
        jobTitle: job.job_title || "",
        projectNumber,
        hubspotDealId: extractHubspotDealId(rawJob),
        zuperStatus: getZuperCurrentStatus(rawJob),
        scheduledStart: job.scheduled_start_time || null,
        scheduledEnd: job.scheduled_end_time || null,
        createdAt: rawJob.created_at || rawJob.createdAt || null,
        completedAt: rawJob.completed_time || rawJob.completed_at || rawJob.completedAt || null,
        team: getTeamName(rawJob),
        assignedTo: getAssignedNames(rawJob),
        category: mappedCategory,
      });
    }

    // Stop if we've fetched all records or got fewer than requested
    const fetchedSoFar = page * limit;
    if (result.data.jobs.length < limit || fetchedSoFar >= totalRecords) {
      hasMore = false;
    } else {
      page++;
    }
  }

  if (page > MAX_PAGES) {
    console.warn(`[status-comparison] Hit max page cap (${MAX_PAGES}) for category ${categoryUid}, fetched ${allJobs.length} jobs`);
  }

  // Enforce local windowing by scheduled start date only.
  return allJobs.filter((job) => isWithinDateWindow(job.scheduledStart, fromDate, toDate));
}

// Batch fetch HubSpot deals by deal id with all date fields
async function fetchHubspotDealsByDealIds(
  dealIds: string[]
): Promise<Map<string, HubSpotDealData>> {
  const dealMap = new Map<string, HubSpotDealData>();

  const batchSize = 100;
  for (let i = 0; i < dealIds.length; i += batchSize) {
    const batch = dealIds.slice(i, i + batchSize);

    try {
      const response = await hubspotClient.crm.deals.batchApi.read({
        inputs: batch.map((id) => ({ id })),
        properties: [
          "project_number",
          "dealname",
          "pb_location",
          // Status fields
          "site_survey_status",
          "install_status",
          "final_inspection_status",
          // Schedule dates
          "site_survey_schedule_date",
          "install_schedule_date",
          "inspections_schedule_date",
          // Completion dates
          "site_survey_date",           // site survey completion
          "construction_complete_date",
          "inspections_completion_date", // inspection pass date
        ],
        propertiesWithHistory: [],
      });

      for (const deal of response.results) {
        dealMap.set(deal.id, {
          dealId: deal.id,
          dealName: deal.properties.dealname || "",
          pbLocation: deal.properties.pb_location || null,
          siteSurveyStatus: deal.properties.site_survey_status || null,
          constructionStatus: deal.properties.install_status || null,
          inspectionStatus: deal.properties.final_inspection_status || null,
          siteSurveyScheduleDate: deal.properties.site_survey_schedule_date || null,
          constructionScheduleDate: deal.properties.install_schedule_date || null,
          inspectionScheduleDate: deal.properties.inspections_schedule_date || null,
          siteSurveyCompletionDate: deal.properties.site_survey_date || null,
          constructionCompleteDate: deal.properties.construction_complete_date || null,
          inspectionPassDate: deal.properties.inspections_completion_date || null,
        });
      }
    } catch (err) {
      console.error(`[status-comparison] Error fetching HubSpot deals by id batch ${i}:`, err);
    }

    if (i + batchSize < dealIds.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return dealMap;
}

export async function GET() {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    // Admin-only: check real DB role (JWT role is stale)
    const dbUser = await getUserByEmail(authResult.email);
    if (!dbUser || dbUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    if (!zuper.isConfigured()) {
      return NextResponse.json(
        { error: "Zuper integration not configured" },
        { status: 503 }
      );
    }

    // Default to last 3 months
    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const fromDate = threeMonthsAgo.toISOString().split("T")[0];
    const toDate = now.toISOString().split("T")[0];

    // Fetch Zuper jobs for all three categories in parallel (last 3 months)
    const [surveyJobs, constructionJobs, inspectionJobs] = await Promise.all([
      fetchAllZuperJobs(JOB_CATEGORY_UIDS.SITE_SURVEY, fromDate, toDate),
      fetchAllZuperJobs(JOB_CATEGORY_UIDS.CONSTRUCTION, fromDate, toDate),
      fetchAllZuperJobs(JOB_CATEGORY_UIDS.INSPECTION, fromDate, toDate),
    ]);

    const allJobs = [...surveyJobs, ...constructionJobs, ...inspectionJobs];

    // Collect unique HubSpot deal IDs from Zuper job metadata
    const dealIds = [...new Set(allJobs.map((j) => j.hubspotDealId).filter((id): id is string => !!id))];

    // Fetch HubSpot deals by deal ID
    const dealMap = await fetchHubspotDealsByDealIds(dealIds);

    // Build comparison records
    const records: ComparisonRecord[] = allJobs.map((job) => {
      const deal = job.hubspotDealId ? dealMap.get(job.hubspotDealId) : undefined;
      let hubspotStatus: string | null = null;
      let hubspotScheduleDate: string | null = null;
      let hubspotCompletionDate: string | null = null;

      if (deal) {
        switch (job.category) {
          case "site_survey":
            hubspotStatus = deal.siteSurveyStatus;
            hubspotScheduleDate = deal.siteSurveyScheduleDate;
            hubspotCompletionDate = deal.siteSurveyCompletionDate;
            break;
          case "construction":
            hubspotStatus = deal.constructionStatus;
            hubspotScheduleDate = deal.constructionScheduleDate;
            hubspotCompletionDate = deal.constructionCompleteDate;
            break;
          case "inspection":
            hubspotStatus = deal.inspectionStatus;
            hubspotScheduleDate = deal.inspectionScheduleDate;
            hubspotCompletionDate = deal.inspectionPassDate;
            break;
        }
      }

      const resolvedDealId = deal?.dealId || job.hubspotDealId || null;

      return {
        projectNumber: job.projectNumber,
        dealId: resolvedDealId,
        dealName: deal?.dealName || null,
        dealUrl: resolvedDealId
          ? `https://app.hubspot.com/contacts/21710069/record/0-3/${resolvedDealId}`
          : null,
        pbLocation: deal?.pbLocation || null,
        zuperJobUid: job.jobUid,
        zuperJobTitle: job.jobTitle,
        zuperStatus: job.zuperStatus,
        hubspotStatus,
        category: job.category,
        isMismatch: isStatusMismatch(job.zuperStatus, hubspotStatus, job.category),
        // Zuper dates
        zuperScheduledStart: job.scheduledStart,
        zuperScheduledEnd: job.scheduledEnd,
        zuperCreatedAt: job.createdAt,
        zuperCompletedAt: job.completedAt,
        // HubSpot dates
        hubspotScheduleDate,
        hubspotCompletionDate,
        // Date comparisons
        scheduleDateMatch: compareDates(job.scheduledStart, hubspotScheduleDate),
        completionDateMatch: compareDates(job.completedAt || job.scheduledEnd, hubspotCompletionDate),
        // Team
        team: job.team,
        assignedTo: job.assignedTo,
      };
    });

    // Compute summary stats
    const recordsWithDates = records.filter((r) => r.hubspotScheduleDate || r.zuperScheduledStart);
    const scheduleDateMismatches = records.filter((r) => r.scheduleDateMatch === false).length;
    const completionDateMismatches = records.filter((r) => r.completionDateMatch === false).length;

    const stats = {
      total: records.length,
      mismatches: records.filter((r) => r.isMismatch).length,
      matched: records.filter((r) => !r.isMismatch).length,
      noHubspotDeal: records.filter((r) => !r.dealId).length,
      scheduleDateMismatches,
      completionDateMismatches,
      recordsWithDates: recordsWithDates.length,
      byCategory: {
        site_survey: {
          total: surveyJobs.length,
          mismatches: records.filter((r) => r.category === "site_survey" && r.isMismatch).length,
          scheduleDateMismatches: records.filter((r) => r.category === "site_survey" && r.scheduleDateMatch === false).length,
          completionDateMismatches: records.filter((r) => r.category === "site_survey" && r.completionDateMatch === false).length,
        },
        construction: {
          total: constructionJobs.length,
          mismatches: records.filter((r) => r.category === "construction" && r.isMismatch).length,
          scheduleDateMismatches: records.filter((r) => r.category === "construction" && r.scheduleDateMatch === false).length,
          completionDateMismatches: records.filter((r) => r.category === "construction" && r.completionDateMatch === false).length,
        },
        inspection: {
          total: inspectionJobs.length,
          mismatches: records.filter((r) => r.category === "inspection" && r.isMismatch).length,
          scheduleDateMismatches: records.filter((r) => r.category === "inspection" && r.scheduleDateMatch === false).length,
          completionDateMismatches: records.filter((r) => r.category === "inspection" && r.completionDateMatch === false).length,
        },
      },
    };

    // Audit: check if mismatch deals also have non-core categories
    // (e.g., Additional Visit / Service Visit) that may have affected status workflows.
    interface NonCoreAuditDeal {
      dealId: string;
      projectNumber: string;
      dealName: string | null;
      categories: string[];
    }
    let nonCoreAudit: {
      totalMismatchDeals: number;
      dealsWithNonCore: number;
      dealsWithAdditionalOrService: number;
      affectedDeals: NonCoreAuditDeal[];
    } = { totalMismatchDeals: 0, dealsWithNonCore: 0, dealsWithAdditionalOrService: 0, affectedDeals: [] };

    try {
      const mismatchDealIds = [...new Set(records.filter((r) => r.isMismatch && !!r.dealId).map((r) => r.dealId as string))];
      nonCoreAudit.totalMismatchDeals = mismatchDealIds.length;

      if (mismatchDealIds.length > 0) {
        const mismatchDealSet = new Set(mismatchDealIds);
        const coreCategoryUids = new Set<string>([
          JOB_CATEGORY_UIDS.SITE_SURVEY,
          JOB_CATEGORY_UIDS.CONSTRUCTION,
          JOB_CATEGORY_UIDS.INSPECTION,
        ]);

        let auditPage = 1;
        const auditLimit = 100;
        let auditHasMore = true;
        let auditTotalRecords = Infinity;
        // Track per-deal: which non-core categories exist
        const dealNonCoreCategories = new Map<string, Set<string>>();
        const dealFlags = new Map<string, { hasAdditionalOrService: boolean; hasNonCore: boolean }>();

        while (auditHasMore && auditPage <= MAX_PAGES) {
          const allJobsResult = await zuper.searchJobs({
            from_date: fromDate,
            to_date: toDate,
            page: auditPage,
            limit: auditLimit,
          });

          if (allJobsResult.type === "error" || !allJobsResult.data?.jobs?.length) {
            break;
          }

          if (allJobsResult.data.total && allJobsResult.data.total < Infinity) {
            auditTotalRecords = allJobsResult.data.total;
          }

          for (const job of allJobsResult.data.jobs) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rawJob = job as any;
            const dealId = extractHubspotDealId(rawJob);
            if (!dealId || !mismatchDealSet.has(dealId)) continue;

            const categoryUid =
              typeof job.job_category === "string"
                ? job.job_category
                : job.job_category?.category_uid || "";
            const categoryName =
              typeof job.job_category === "string"
                ? job.job_category
                : job.job_category?.category_name || "";
            const categoryNameLower = categoryName.toLowerCase();

            const hasAdditionalOrService =
              categoryNameLower.includes("additional visit") || categoryNameLower.includes("service visit");
            const hasNonCore = !!categoryUid && !coreCategoryUids.has(categoryUid);

            if (!hasAdditionalOrService && !hasNonCore) continue;

            const current = dealFlags.get(dealId) || { hasAdditionalOrService: false, hasNonCore: false };
            current.hasAdditionalOrService = current.hasAdditionalOrService || hasAdditionalOrService;
            current.hasNonCore = current.hasNonCore || hasNonCore;
            dealFlags.set(dealId, current);

            // Track the specific category names
            if (!dealNonCoreCategories.has(dealId)) dealNonCoreCategories.set(dealId, new Set());
            dealNonCoreCategories.get(dealId)!.add(categoryName);
          }

          const auditFetchedSoFar = auditPage * auditLimit;
          if (allJobsResult.data.jobs.length < auditLimit || auditFetchedSoFar >= auditTotalRecords) {
            auditHasMore = false;
          } else {
            auditPage += 1;
          }
        }

        let dealsWithAdditionalOrService = 0;
        let dealsWithNonCore = 0;
        for (const flags of dealFlags.values()) {
          if (flags.hasAdditionalOrService) dealsWithAdditionalOrService += 1;
          if (flags.hasNonCore) dealsWithNonCore += 1;
        }

        // Build affected deals list with project info from records
        const affectedDeals: NonCoreAuditDeal[] = [];
        for (const [dealId, categories] of dealNonCoreCategories) {
          const record = records.find((r) => r.dealId === dealId);
          affectedDeals.push({
            dealId,
            projectNumber: record?.projectNumber || "",
            dealName: record?.dealName || null,
            categories: [...categories],
          });
        }
        affectedDeals.sort((a, b) => a.projectNumber.localeCompare(b.projectNumber));

        nonCoreAudit = {
          totalMismatchDeals: mismatchDealIds.length,
          dealsWithNonCore,
          dealsWithAdditionalOrService,
          affectedDeals,
        };

        console.info(
          `[status-comparison-audit] mismatches=${mismatchDealIds.length} ` +
          `withAdditionalOrService=${dealsWithAdditionalOrService} withNonCore=${dealsWithNonCore}`
        );
      }
    } catch (auditError) {
      console.warn("[status-comparison-audit] failed:", auditError);
    }

    // Build project-grouped records (all 3 categories side by side per project)
    const emptyCategorySlot = {
      zuperJobUid: null,
      zuperStatus: null,
      hubspotStatus: null,
      isMismatch: false,
      zuperScheduledStart: null,
      hubspotScheduleDate: null,
      scheduleDateMatch: null,
      zuperCompletedAt: null,
      hubspotCompletionDate: null,
      completionDateMatch: null,
      team: null,
      assignedTo: null,
    };

    const projectMap = new Map<string, ProjectGroupedRecord>();
    for (const record of records) {
      let grouped = projectMap.get(record.projectNumber);
      if (!grouped) {
        grouped = {
          projectNumber: record.projectNumber,
          dealId: record.dealId,
          dealName: record.dealName,
          dealUrl: record.dealUrl,
          pbLocation: record.pbLocation,
          survey: { ...emptyCategorySlot },
          construction: { ...emptyCategorySlot },
          inspection: { ...emptyCategorySlot },
          hasAnyMismatch: false,
          hasAnyDateMismatch: false,
        };
        projectMap.set(record.projectNumber, grouped);
      }
      // Use deal info from whichever record has it
      if (!grouped.dealId && record.dealId) {
        grouped.dealId = record.dealId;
        grouped.dealName = record.dealName;
        grouped.dealUrl = record.dealUrl;
      }
      if (!grouped.pbLocation && record.pbLocation) {
        grouped.pbLocation = record.pbLocation;
      }

      const slot = {
        zuperJobUid: record.zuperJobUid,
        zuperStatus: record.zuperStatus,
        hubspotStatus: record.hubspotStatus,
        isMismatch: record.isMismatch,
        zuperScheduledStart: record.zuperScheduledStart,
        hubspotScheduleDate: record.hubspotScheduleDate,
        scheduleDateMatch: record.scheduleDateMatch,
        zuperCompletedAt: record.zuperCompletedAt,
        hubspotCompletionDate: record.hubspotCompletionDate,
        completionDateMatch: record.completionDateMatch,
        team: record.team,
        assignedTo: record.assignedTo,
      };

      if (record.category === "site_survey") grouped.survey = slot;
      else if (record.category === "construction") grouped.construction = slot;
      else if (record.category === "inspection") grouped.inspection = slot;

      if (record.isMismatch) grouped.hasAnyMismatch = true;
      if (record.scheduleDateMatch === false || record.completionDateMatch === false) {
        grouped.hasAnyDateMismatch = true;
      }
    }

    const projectRecords = [...projectMap.values()].sort((a, b) => {
      const aNum = parseInt(a.projectNumber.replace(/\D/g, "")) || 0;
      const bNum = parseInt(b.projectNumber.replace(/\D/g, "")) || 0;
      return aNum - bNum;
    });

    return NextResponse.json({
      records,
      projectRecords,
      stats,
      nonCoreAudit,
      dateRange: { from: fromDate, to: toDate },
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[status-comparison] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch status comparison" },
      { status: 500 }
    );
  }
}
