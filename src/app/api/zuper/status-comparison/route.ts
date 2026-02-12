import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zuper, JOB_CATEGORY_UIDS } from "@/lib/zuper";
import { Client } from "@hubspot/api-client";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
});

interface ZuperJobSummary {
  jobUid: string;
  jobTitle: string;
  projectNumber: string;
  zuperStatus: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  createdAt: string | null;
  completedAt: string | null;
  team: string | null;
  assignedTo: string | null;
  category: string;
}

interface HubSpotDealData {
  dealId: string;
  dealName: string;
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

// Extract project number (e.g., "PROJ-7710") from a Zuper job title
function extractProjectNumber(title: string): string | null {
  const match = title.match(/PROJ-(\d+)/i);
  return match ? `PROJ-${match[1]}` : null;
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

// Fetch all Zuper jobs for a category with pagination
async function fetchAllZuperJobs(categoryUid: string): Promise<ZuperJobSummary[]> {
  const allJobs: ZuperJobSummary[] = [];
  let page = 1;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const result = await zuper.searchJobs({
      category: categoryUid,
      page,
      limit,
    });

    if (result.type === "error" || !result.data?.jobs?.length) {
      hasMore = false;
      break;
    }

    for (const job of result.data.jobs) {
      const projectNumber = extractProjectNumber(job.job_title || "");
      if (!projectNumber) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawJob = job as any;

      allJobs.push({
        jobUid: job.job_uid || "",
        jobTitle: job.job_title || "",
        projectNumber,
        zuperStatus: getZuperCurrentStatus(rawJob),
        scheduledStart: job.scheduled_start_time || null,
        scheduledEnd: job.scheduled_end_time || null,
        createdAt: rawJob.created_at || rawJob.createdAt || null,
        completedAt: rawJob.completed_time || rawJob.completed_at || rawJob.completedAt || null,
        team: getTeamName(rawJob),
        assignedTo: getAssignedNames(rawJob),
        category:
          categoryUid === JOB_CATEGORY_UIDS.SITE_SURVEY
            ? "site_survey"
            : categoryUid === JOB_CATEGORY_UIDS.CONSTRUCTION
            ? "construction"
            : "inspection",
      });
    }

    if (result.data.jobs.length < limit) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return allJobs;
}

// Batch fetch HubSpot deals by project number with all date fields
async function fetchHubspotDealsByProjectNumbers(
  projectNumbers: string[]
): Promise<Map<string, HubSpotDealData>> {
  const dealMap = new Map<string, HubSpotDealData>();

  const batchSize = 50;
  for (let i = 0; i < projectNumbers.length; i += batchSize) {
    const batch = projectNumbers.slice(i, i + batchSize);

    try {
      const response = await hubspotClient.crm.deals.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              {
                propertyName: "project_number",
                operator: FilterOperatorEnum.In,
                values: batch,
              },
            ],
          },
        ],
        properties: [
          "dealname",
          "project_number",
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
        limit: batchSize,
      });

      for (const deal of response.results) {
        const projNum = deal.properties.project_number;
        if (projNum) {
          dealMap.set(projNum, {
            dealId: deal.id,
            dealName: deal.properties.dealname || "",
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
      }
    } catch (err) {
      console.error(`[status-comparison] Error fetching HubSpot deals batch ${i}:`, err);
    }

    if (i + batchSize < projectNumbers.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return dealMap;
}

export async function GET() {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    if (!zuper.isConfigured()) {
      return NextResponse.json(
        { error: "Zuper integration not configured" },
        { status: 503 }
      );
    }

    // Fetch Zuper jobs for all three categories in parallel
    const [surveyJobs, constructionJobs, inspectionJobs] = await Promise.all([
      fetchAllZuperJobs(JOB_CATEGORY_UIDS.SITE_SURVEY),
      fetchAllZuperJobs(JOB_CATEGORY_UIDS.CONSTRUCTION),
      fetchAllZuperJobs(JOB_CATEGORY_UIDS.INSPECTION),
    ]);

    const allJobs = [...surveyJobs, ...constructionJobs, ...inspectionJobs];

    // Collect unique project numbers
    const projectNumbers = [...new Set(allJobs.map((j) => j.projectNumber))];

    // Fetch HubSpot deals for all project numbers
    const dealMap = await fetchHubspotDealsByProjectNumbers(projectNumbers);

    // Build comparison records
    const records: ComparisonRecord[] = allJobs.map((job) => {
      const deal = dealMap.get(job.projectNumber);
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

      return {
        projectNumber: job.projectNumber,
        dealId: deal?.dealId || null,
        dealName: deal?.dealName || null,
        dealUrl: deal?.dealId
          ? `https://app.hubspot.com/contacts/21710069/record/0-3/${deal.dealId}`
          : null,
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

    return NextResponse.json({
      records,
      stats,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[status-comparison] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch status comparison", details: String(error) },
      { status: 500 }
    );
  }
}
