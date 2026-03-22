import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail } from "@/lib/db";
import { zuper, JOB_CATEGORY_UIDS } from "@/lib/zuper";
import { getCompletedTimeFromHistory, COMPLETED_STATUSES } from "@/lib/compliance-helpers";
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
  isSuperseded?: boolean; // true if a newer non-cancelled job exists for the same deal+category
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
  completionDateDiffDays: number | null; // abs difference in days when both dates exist
  // Team info
  team: string | null;
  assignedTo: string | null;
  // Superseded: older job for same deal+category where a newer non-cancelled job exists
  isSuperseded: boolean;
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
    completionDateDiffDays: number | null;
    team: string | null;
    assignedTo: string | null;
    isSuperseded?: boolean;
    zuperCreatedAt?: string | null;
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
    completionDateDiffDays: number | null;
    team: string | null;
    assignedTo: string | null;
    isSuperseded?: boolean;
    zuperCreatedAt?: string | null;
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
    completionDateDiffDays: number | null;
    team: string | null;
    assignedTo: string | null;
    isSuperseded?: boolean;
    zuperCreatedAt?: string | null;
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

// HubSpot date-only properties use the portal timezone (America/Denver for PB).
// Zuper returns UTC timestamps. Convert to Mountain Time before extracting the date
// to avoid false 1-day mismatches at the day boundary.
const PORTAL_TZ = "America/Denver";

/**
 * Convert a Zuper UTC timestamp to a YYYY-MM-DD date in the portal timezone.
 * Zuper stores full ISO timestamps (e.g. "2026-01-14T18:00:00.000Z").
 */
function zuperDateToLocal(dateStr: string): string {
  const d = new Date(dateStr);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PORTAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Extract a YYYY-MM-DD from a HubSpot date property.
 * HubSpot date-only properties are stored as midnight UTC (e.g. "2026-01-14"
 * or "2026-01-14T00:00:00.000Z"). Converting to Mountain would shift them
 * back a day, so we just take the first 10 characters.
 */
function hubspotDateToLocal(dateStr: string): string {
  // If it's already YYYY-MM-DD, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // If it's a full ISO timestamp at midnight UTC, extract the date portion
  return dateStr.slice(0, 10);
}

// Compare a Zuper date (UTC timestamp) with a HubSpot date (date-only property)
// Returns true if they are the same day, false if different, null if either is missing
function compareDates(zuperDate: string | null, hubspotDate: string | null): boolean | null {
  if (!zuperDate || !hubspotDate) return null;
  try {
    const d1 = zuperDateToLocal(zuperDate);
    const d2 = hubspotDateToLocal(hubspotDate);
    return d1 === d2;
  } catch {
    return null;
  }
}

// Calculate absolute difference in days between a Zuper date and HubSpot date
function dateDiffDays(zuperDate: string | null, hubspotDate: string | null): number | null {
  if (!zuperDate || !hubspotDate) return null;
  try {
    const d1 = zuperDateToLocal(zuperDate);
    const d2 = hubspotDateToLocal(hubspotDate);
    const ms = Math.abs(new Date(d1).getTime() - new Date(d2).getTime());
    return Math.round(ms / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

/** Parse a date string to numeric timestamp for comparison. Returns 0 on failure. */
function toTimestamp(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  const t = new Date(dateStr).getTime();
  return Number.isNaN(t) ? 0 : t;
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

// Terminal statuses that warrant fetching job detail for accurate completion date
const TERMINAL_STATUS_NAMES = new Set([
  ...COMPLETED_STATUSES,
  "loose ends remaining",
]);

// Fetch individual job details in batches to get completion dates from status history.
// No cap — enriches all terminal jobs for accurate completion date comparison.

interface EnrichmentResult {
  enriched: number;
  total: number;
}

async function enrichCompletionDates(jobs: ZuperJobSummary[]): Promise<EnrichmentResult> {
  const needsEnrichment = jobs.filter(
    (j) => !j.completedAt && TERMINAL_STATUS_NAMES.has(j.zuperStatus.toLowerCase())
  );

  if (needsEnrichment.length === 0) return { enriched: 0, total: 0 };

  const CONCURRENCY = 10;
  const BATCH_DELAY_MS = 200;

  for (let i = 0; i < needsEnrichment.length; i += CONCURRENCY) {
    const batch = needsEnrichment.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((job) => zuper.getJob(job.jobUid))
    );

    for (let j = 0; j < batch.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled" && result.value.type === "success" && result.value.data) {
        const completedTime = getCompletedTimeFromHistory(result.value.data);
        if (completedTime) {
          batch[j].completedAt = completedTime.toISOString();
        }
      }
    }

    if (i + CONCURRENCY < needsEnrichment.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  const enrichedCount = needsEnrichment.filter((j) => j.completedAt).length;
  console.info(
    `[status-comparison] Enriched ${needsEnrichment.length} jobs ` +
    `(${enrichedCount} completion dates found)`
  );

  return { enriched: enrichedCount, total: needsEnrichment.length };
}

// Fetch all Zuper jobs for a category with pagination (filtered by date range)
/**
 * Mark superseded inspection jobs: when multiple non-cancelled inspection jobs
 * exist for the same deal, the older ones are marked superseded. HubSpot only
 * tracks the latest inspection's status, so comparing older jobs creates false
 * mismatches. Only applies to inspection — construction/survey re-dos are rare
 * and worth flagging as true duplicates.
 */
function markSupersededJobs(jobs: ZuperJobSummary[]): void {
  const CANCELLED = new Set(["cancelled", "canceled"]);

  // Group inspection jobs by projectNumber (works even without deal link).
  // Both the original inspection and re-inspection share the same Zuper project
  // and have the same PROJ-XXXX in their title.
  const groups = new Map<string, ZuperJobSummary[]>();
  for (const job of jobs) {
    if (job.category !== "inspection") continue;
    if (CANCELLED.has(job.zuperStatus.toLowerCase())) continue;
    if (!job.projectNumber) continue;
    const key = job.projectNumber; // e.g. "PROJ-7159"
    const arr = groups.get(key) || [];
    arr.push(job);
    groups.set(key, arr);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Sort by scheduled start descending (newest first), fallback to createdAt
    group.sort((a, b) => {
      const dateA = a.scheduledStart || a.createdAt || "";
      const dateB = b.scheduledStart || b.createdAt || "";
      return dateB.localeCompare(dateA);
    });
    // Mark all but the newest as superseded
    for (let i = 1; i < group.length; i++) {
      group[i].isSuperseded = true;
    }
  }
}

const MAX_PAGES = 50; // Safety cap: 50 pages × 100 jobs = 5,000 jobs max per category

interface FetchResult {
  jobs: ZuperJobSummary[];
  enrichment: EnrichmentResult;
}

async function fetchAllZuperJobs(categoryUid: string, fromDate?: string, toDate?: string): Promise<FetchResult> {
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
  const filtered = allJobs.filter((job) => isWithinDateWindow(job.scheduledStart, fromDate, toDate));

  // Fetch individual job details to get accurate completion dates from status history
  const enrichment = await enrichCompletionDates(filtered);

  return { jobs: filtered, enrichment };
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

    // Default to last 6 months
    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 6);
    const fromDate = threeMonthsAgo.toISOString().split("T")[0];
    const toDate = now.toISOString().split("T")[0];

    // Fetch Zuper jobs for all three categories in parallel (last 3 months)
    const [surveyResult, constructionResult, inspectionResult] = await Promise.all([
      fetchAllZuperJobs(JOB_CATEGORY_UIDS.SITE_SURVEY, fromDate, toDate),
      fetchAllZuperJobs(JOB_CATEGORY_UIDS.CONSTRUCTION, fromDate, toDate),
      fetchAllZuperJobs(JOB_CATEGORY_UIDS.INSPECTION, fromDate, toDate),
    ]);

    const surveyJobs = surveyResult.jobs;
    const constructionJobs = constructionResult.jobs;
    const inspectionJobs = inspectionResult.jobs;
    const allJobs = [...surveyJobs, ...constructionJobs, ...inspectionJobs];

    // Mark older jobs as superseded when a newer one exists for the same deal+category
    markSupersededJobs(allJobs);

    const enrichmentStats = {
      enriched: surveyResult.enrichment.enriched + constructionResult.enrichment.enriched + inspectionResult.enrichment.enriched,
      total: surveyResult.enrichment.total + constructionResult.enrichment.total + inspectionResult.enrichment.total,
    };

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
        // Superseded jobs are expected mismatches — don't count them
        isMismatch: job.isSuperseded ? false : isStatusMismatch(job.zuperStatus, hubspotStatus, job.category),
        isSuperseded: job.isSuperseded || false,
        // Zuper dates
        zuperScheduledStart: job.scheduledStart,
        zuperScheduledEnd: job.scheduledEnd,
        zuperCreatedAt: job.createdAt,
        zuperCompletedAt: job.completedAt,
        // HubSpot dates
        hubspotScheduleDate,
        hubspotCompletionDate,
        // Date comparisons (skip for superseded — dates won't match the current job)
        scheduleDateMatch: job.isSuperseded ? null : compareDates(job.scheduledStart, hubspotScheduleDate),
        completionDateMatch: job.isSuperseded ? null : compareDates(job.completedAt, hubspotCompletionDate),
        completionDateDiffDays: job.isSuperseded ? null : dateDiffDays(job.completedAt, hubspotCompletionDate),
        // Team
        team: job.team,
        assignedTo: job.assignedTo,
      };
    });

    // Compute summary stats
    const recordsWithDates = records.filter((r) => r.hubspotScheduleDate || r.zuperScheduledStart);
    const scheduleDateMismatches = records.filter((r) => r.scheduleDateMatch === false).length;
    const completionDateMismatches = records.filter((r) => r.completionDateMatch === false).length;

    const supersededCount = records.filter((r) => r.isSuperseded).length;

    const stats = {
      total: records.length,
      mismatches: records.filter((r) => r.isMismatch).length,
      matched: records.filter((r) => !r.isMismatch && !r.isSuperseded).length,
      superseded: supersededCount,
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
      completionDateDiffDays: null,
      team: null,
      assignedTo: null,
      isSuperseded: false,
      zuperCreatedAt: null,
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
        completionDateDiffDays: record.completionDateDiffDays,
        team: record.team,
        assignedTo: record.assignedTo,
        isSuperseded: record.isSuperseded,
        zuperCreatedAt: record.zuperCreatedAt,
      };

      if (record.category === "site_survey") grouped.survey = slot;
      else if (record.category === "construction") grouped.construction = slot;
      else if (record.category === "inspection") {
        const existing = grouped.inspection;
        if (!existing.zuperJobUid) {
          // Empty slot — take this record
          grouped.inspection = slot;
        } else if (!record.isSuperseded && existing.isSuperseded) {
          // Current record beats superseded
          grouped.inspection = slot;
        } else if (record.isSuperseded === (existing.isSuperseded || false)) {
          // Same superseded state — take the newer one by timestamp
          const existingTs = toTimestamp(existing.zuperScheduledStart || existing.zuperCreatedAt);
          const newTs = toTimestamp(record.zuperScheduledStart || record.zuperCreatedAt);
          if (newTs > existingTs) {
            grouped.inspection = slot;
          }
        }
        // else: existing is current and new is superseded — keep existing
      }

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

    // Detect duplicate active jobs per project+category
    // (multiple in-progress Zuper jobs for the same project in the same category).
    // Excludes cancelled AND terminal (completed/passed/failed) statuses so only
    // genuinely active duplicates are flagged.
    const INACTIVE_STATUSES = new Set([
      "cancelled", "canceled",
      ...COMPLETED_STATUSES,
      "loose ends remaining",
    ]);
    interface DuplicateJobGroup {
      projectNumber: string;
      category: string;
      count: number;
      statuses: string[];
      jobUids: string[];
    }
    const duplicateJobs: DuplicateJobGroup[] = [];
    const jobsByProjectCategory = new Map<string, ZuperJobSummary[]>();
    for (const job of allJobs) {
      if (INACTIVE_STATUSES.has(job.zuperStatus.toLowerCase())) continue;
      const key = `${job.projectNumber}::${job.category}`;
      const arr = jobsByProjectCategory.get(key) || [];
      arr.push(job);
      jobsByProjectCategory.set(key, arr);
    }
    for (const [key, jobs] of jobsByProjectCategory) {
      if (jobs.length < 2) continue;
      const [projectNumber, category] = key.split("::");
      duplicateJobs.push({
        projectNumber,
        category,
        count: jobs.length,
        statuses: jobs.map((j) => j.zuperStatus),
        jobUids: jobs.map((j) => j.jobUid),
      });
    }
    duplicateJobs.sort((a, b) => b.count - a.count);

    return NextResponse.json({
      records,
      projectRecords,
      stats,
      nonCoreAudit,
      duplicateJobs,
      enrichmentStats,
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
