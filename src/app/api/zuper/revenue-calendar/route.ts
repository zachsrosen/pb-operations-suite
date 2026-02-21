import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zuper, JOB_CATEGORY_UIDS } from "@/lib/zuper";
import { prisma } from "@/lib/db";
import { getBusinessEndDateInclusive, isWeekendDate } from "@/lib/business-days";
import { Client } from "@hubspot/api-client";

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
});
const HUBSPOT_PORTAL_ID = process.env.HUBSPOT_PORTAL_ID || "21710069";

// Revenue-generating job categories
const REVENUE_CATEGORIES = [
  { uid: JOB_CATEGORY_UIDS.CONSTRUCTION, name: "Construction", key: "construction" },
  { uid: JOB_CATEGORY_UIDS.DETACH, name: "Detach", key: "detach" },
  { uid: JOB_CATEGORY_UIDS.RESET, name: "Reset", key: "reset" },
  { uid: JOB_CATEGORY_UIDS.SERVICE_VISIT, name: "Service Visit", key: "service" },
] as const;

type CategoryKey = (typeof REVENUE_CATEGORIES)[number]["key"];

interface CalendarJob {
  jobUid: string;
  title: string;
  category: string;
  categoryKey: CategoryKey;
  date: string; // YYYY-MM-DD from scheduled_start
  endDate: string | null; // YYYY-MM-DD from scheduled_end (null if same day)
  spanStartDate: string; // Original start date
  spanEndDate: string | null; // Original end date (null if single-day)
  spanDays: number; // Total inclusive business days used for value allocation
  statusName: string;
  assignedUser: string;
  teamName: string;
  dealId: string | null;
  dealName: string | null;
  dealUrl: string | null;
  dealValue: number; // Per-day allocated value (split across spanDays)
  totalDealValue: number; // Original full deal value
  isTentative: boolean;
  zuperJobUrl: string | null;
  projectNumber: string | null;
}

interface DayTotals {
  totalValue: number;
  construction: { count: number; value: number };
  detach: { count: number; value: number };
  reset: { count: number; value: number };
  service: { count: number; value: number };
}

// Extract PROJ-XXXX from job title
function extractProjectNumber(title: string): string | null {
  const match = title.match(/PROJ-(\d+)/i);
  return match ? `PROJ-${match[1]}` : null;
}

// Extract HubSpot deal ID from Zuper job (3 methods, priority order)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractHubspotDealId(job: any): string | null {
  // 1. external_id.hubspot_deal
  const ext = job.external_id || {};
  if (ext.hubspot_deal) {
    const id = String(ext.hubspot_deal).trim();
    if (id) return id;
  }

  // 2. job_tags: match "hubspot-{dealId}" pattern
  if (Array.isArray(job.job_tags)) {
    for (const tag of job.job_tags) {
      const tagMatch = String(tag).match(/^hubspot-(\d+)$/i);
      if (tagMatch?.[1]) return tagMatch[1];
    }
  }

  // 3. custom_fields: find field named "hubspot_deal_id" or "hubspot deal id"
  const customFields = job.custom_fields;
  if (Array.isArray(customFields)) {
    const field = customFields.find((f: { label?: string; name?: string }) => {
      const label = String(f?.label || "").toLowerCase();
      const name = String(f?.name || "").toLowerCase();
      return (
        label === "hubspot deal id" ||
        label === "hubspot_deal_id" ||
        name === "hubspot_deal_id" ||
        name === "hubspot deal id"
      );
    });
    if (field?.value) {
      const raw = String(field.value).trim();
      const numericMatch = raw.match(/\b\d{6,}\b/);
      if (numericMatch) return numericMatch[0];
    }
  } else if (customFields && typeof customFields === "object") {
    const val = (customFields as Record<string, unknown>).hubspot_deal_id;
    if (val) {
      const raw = String(val).trim();
      const numericMatch = raw.match(/\b\d{6,}\b/);
      if (numericMatch) return numericMatch[0];
    }
  }

  return null;
}

// Extract date portion from Zuper datetime string
// Handles ISO format ("2026-01-15T08:00:00Z") and Zuper format ("2026-01-15 08:00:00")
function extractDateFromZuper(dateTimeStr: string | undefined | null): string | null {
  if (!dateTimeStr) return null;
  const str = String(dateTimeStr).trim();
  // Try splitting on "T" first (ISO), fall back to space (Zuper format)
  const tSplit = str.split("T");
  if (tSplit[0] && /^\d{4}-\d{2}-\d{2}$/.test(tSplit[0])) {
    return tSplit[0];
  }
  const spaceSplit = str.split(" ");
  if (spaceSplit[0] && /^\d{4}-\d{2}-\d{2}$/.test(spaceSplit[0])) {
    return spaceSplit[0];
  }
  return null;
}

function parseYmdAsUtc(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatUtcAsYmd(date: Date): string {
  return date.toISOString().split("T")[0];
}

function addDays(dateStr: string, days: number): string {
  const dt = parseYmdAsUtc(dateStr);
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatUtcAsYmd(dt);
}

function diffDaysInclusive(startDate: string, endDate: string): number {
  const start = parseYmdAsUtc(startDate).getTime();
  const end = parseYmdAsUtc(endDate).getTime();
  return Math.max(1, Math.floor((end - start) / 86400000) + 1);
}

// Get current status name from job
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getStatusName(job: any): string {
  return (
    job.current_job_status?.status_name ||
    job.status?.status_name ||
    job.status ||
    "Unknown"
  );
}

// Get all assigned user names (comma-separated)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getAssignedUser(job: any): string {
  if (!Array.isArray(job.assigned_to)) return "";
  const names = job.assigned_to
    .map((a: { user?: { first_name?: string; last_name?: string } }) => {
      const first = a?.user?.first_name || "";
      const last = a?.user?.last_name || "";
      return `${first} ${last}`.trim();
    })
    .filter(Boolean);
  return [...new Set(names)].join(", ");
}

// Get first team name
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTeamName(job: any): string {
  if (Array.isArray(job.assigned_to_team)) {
    const team = job.assigned_to_team[0]?.team;
    if (team?.team_name) return team.team_name;
  }
  return "";
}

// Batch fetch HubSpot deals for dealname and amount
async function fetchDealValues(
  dealIds: string[]
): Promise<Map<string, { dealName: string; amount: number; dealUrl: string }>> {
  const dealMap = new Map<string, { dealName: string; amount: number; dealUrl: string }>();
  if (dealIds.length === 0) return dealMap;

  const batchSize = 100;
  for (let i = 0; i < dealIds.length; i += batchSize) {
    const batch = dealIds.slice(i, i + batchSize);

    try {
      const response = await hubspotClient.crm.deals.batchApi.read({
        inputs: batch.map((id) => ({ id })),
        properties: ["dealname", "amount", "project_number"],
        propertiesWithHistory: [],
      });

      for (const deal of response.results) {
        const amount = parseFloat(deal.properties.amount || "0") || 0;
        dealMap.set(deal.id, {
          dealName: deal.properties.dealname || "",
          amount,
          dealUrl: `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/record/0-3/${deal.id}`,
        });
      }
    } catch (err) {
      console.error(`[revenue-calendar] Error fetching HubSpot deals batch ${i}:`, err);
    }

    // 200ms delay between batches
    if (i + batchSize < dealIds.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return dealMap;
}

// Pagination: fetch all Zuper jobs for a given category within a date range
const MAX_PAGES = 20;

async function fetchJobsForCategory(
  categoryUid: string,
  fromDate: string,
  toDate: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allJobs: any[] = [];
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

    if (result.data.total && result.data.total < Infinity) {
      totalRecords = result.data.total;
    }

    for (const job of result.data.jobs) {
      // Client-side category filter since Zuper API can return mixed categories
      const actualCategoryUid =
        typeof job.job_category === "string"
          ? job.job_category
          : job.job_category?.category_uid;

      if (actualCategoryUid && actualCategoryUid !== categoryUid) {
        continue;
      }

      allJobs.push(job);
    }

    const fetchedSoFar = page * limit;
    if (result.data.jobs.length < limit || fetchedSoFar >= totalRecords) {
      hasMore = false;
    } else {
      page++;
    }
  }

  if (page > MAX_PAGES) {
    console.warn(
      `[revenue-calendar] Hit max page cap (${MAX_PAGES}) for category ${categoryUid}, fetched ${allJobs.length} jobs`
    );
  }

  return allJobs;
}

function normalizeTentativeSpanDays(days?: number | null): number {
  if (!days || !Number.isFinite(days) || days <= 0) return 1;
  return Math.max(1, Math.ceil(days));
}

function getZuperJobDetailsUrl(jobUid: string): string {
  const webBaseUrl = process.env.ZUPER_WEB_URL ||
    (process.env.ZUPER_API_URL?.replace("/api", "") || "https://us-west-1c.zuperpro.com");
  return `${webBaseUrl}/jobs/${jobUid}/details`;
}

function listBusinessDatesInclusive(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    if (!isWeekendDate(cursor)) {
      dates.push(cursor);
    }
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    if (!zuper.isConfigured()) {
      return NextResponse.json(
        { error: "Zuper integration not configured" },
        { status: 503 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const now = new Date();
    const year = parseInt(searchParams.get("year") || String(now.getFullYear()));
    const month = parseInt(searchParams.get("month") || String(now.getMonth() + 1)); // 1-indexed
    const teamFilter = searchParams.get("team") || null;
    const categoryFilter = searchParams.get("category") || null;

    // Compute date range: target month with +/-7 day buffer for multi-day jobs
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0); // last day of month
    const bufferStart = new Date(monthStart);
    bufferStart.setDate(bufferStart.getDate() - 7);
    const bufferEnd = new Date(monthEnd);
    bufferEnd.setDate(bufferEnd.getDate() + 7);

    const fromDate = bufferStart.toISOString().split("T")[0];
    const toDate = bufferEnd.toISOString().split("T")[0];
    const monthStartStr = `${year}-${String(month).padStart(2, "0")}-01`;
    const monthEndStr = `${year}-${String(month).padStart(2, "0")}-${String(monthEnd.getDate()).padStart(2, "0")}`;

    // Determine which categories to fetch
    const categoriesToFetch = categoryFilter
      ? REVENUE_CATEGORIES.filter((c) => c.key === categoryFilter)
      : [...REVENUE_CATEGORIES];

    if (categoriesToFetch.length === 0) {
      return NextResponse.json(
        { error: `Invalid category filter: "${categoryFilter}". Use: construction, detach, reset, service` },
        { status: 400 }
      );
    }

    // Fetch Zuper jobs per category in parallel
    const categoryJobResults = await Promise.all(
      categoriesToFetch.map((cat) =>
        fetchJobsForCategory(cat.uid, fromDate, toDate).then((jobs) => ({
          category: cat,
          jobs,
        }))
      )
    );

    // Flatten and tag each raw job with its category metadata
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const taggedJobs: { raw: any; category: (typeof REVENUE_CATEGORIES)[number] }[] = [];
    for (const { category, jobs } of categoryJobResults) {
      for (const job of jobs) {
        taggedJobs.push({ raw: job, category });
      }
    }

    // Pull tentative installation schedules from DB (only when filters can represent them)
    const shouldIncludeTentatives = !teamFilter && (!categoryFilter || categoryFilter === "construction");
    const tentativeRawRecords = shouldIncludeTentatives && prisma
      ? await prisma.scheduleRecord.findMany({
          where: {
            status: "tentative",
            scheduleType: "installation",
            scheduledDate: { gte: fromDate, lte: toDate },
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            projectId: true,
            projectName: true,
            scheduledDate: true,
            scheduledDays: true,
            assignedUser: true,
          },
        })
      : [];

    // Keep latest tentative record per project/date to avoid stale duplicates
    const tentativeByProjectDate = new Map<string, (typeof tentativeRawRecords)[number]>();
    for (const rec of tentativeRawRecords) {
      const key = `${rec.projectId}:${rec.scheduledDate}`;
      if (!tentativeByProjectDate.has(key)) tentativeByProjectDate.set(key, rec);
    }
    const tentativeRecords = Array.from(tentativeByProjectDate.values());

    // Collect unique deal IDs from confirmed and tentative jobs
    const dealIdSet = new Set<string>();
    for (const { raw } of taggedJobs) {
      const dealId = extractHubspotDealId(raw);
      if (dealId) dealIdSet.add(dealId);
    }
    for (const rec of tentativeRecords) {
      if (rec.projectId) dealIdSet.add(rec.projectId);
    }

    // Batch-fetch HubSpot deals for dealname and amount
    const dealMap = await fetchDealValues([...dealIdSet]);

    // Collect all unique team names for filter options
    const teamSet = new Set<string>();

    // Build confirmed CalendarJob entries (exclude $0 deals)
    const confirmedJobs: CalendarJob[] = [];
    for (const { raw, category } of taggedJobs) {
      const date = extractDateFromZuper(raw.scheduled_start_time);
      if (!date) continue; // Skip unscheduled jobs

      const endDate = extractDateFromZuper(raw.scheduled_end_time);
      const teamName = getTeamName(raw);
      if (teamName) teamSet.add(teamName);

      // Team filter (case-insensitive)
      if (teamFilter && teamName.toLowerCase() !== teamFilter.toLowerCase()) {
        continue;
      }

      const dealId = extractHubspotDealId(raw);
      const deal = dealId ? dealMap.get(dealId) : undefined;
      const dealAmount = deal?.amount || 0;
      if (dealAmount <= 0) continue;

      confirmedJobs.push({
        jobUid: raw.job_uid || "",
        title: raw.job_title || "",
        category: category.name,
        categoryKey: category.key,
        date,
        endDate: endDate && endDate !== date ? endDate : null,
        spanStartDate: date,
        spanEndDate: endDate && endDate !== date ? endDate : null,
        spanDays: diffDaysInclusive(date, endDate && endDate !== date ? endDate : date),
        statusName: getStatusName(raw),
        assignedUser: getAssignedUser(raw),
        teamName,
        dealId: dealId || null,
        dealName: deal?.dealName || null,
        dealUrl: deal?.dealUrl || (dealId ? `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/record/0-3/${dealId}` : null),
        dealValue: dealAmount,
        totalDealValue: dealAmount,
        isTentative: false,
        zuperJobUrl: raw.job_uid ? getZuperJobDetailsUrl(raw.job_uid) : null,
        projectNumber: extractProjectNumber(raw.job_title || ""),
      });
    }

    // Build tentative CalendarJob entries (exclude $0 deals)
    const tentativeJobs: CalendarJob[] = [];
    for (const rec of tentativeRecords) {
      const deal = rec.projectId ? dealMap.get(rec.projectId) : undefined;
      const dealAmount = deal?.amount || 0;
      if (dealAmount <= 0) continue;

      const spanDays = normalizeTentativeSpanDays(rec.scheduledDays);
      const spanEnd = getBusinessEndDateInclusive(rec.scheduledDate, spanDays);
      tentativeJobs.push({
        jobUid: `tentative-${rec.id}`,
        title: rec.projectName || rec.projectId,
        category: "Construction",
        categoryKey: "construction",
        date: rec.scheduledDate,
        endDate: spanEnd !== rec.scheduledDate ? spanEnd : null,
        spanStartDate: rec.scheduledDate,
        spanEndDate: spanEnd !== rec.scheduledDate ? spanEnd : null,
        spanDays,
        statusName: "Tentative",
        assignedUser: rec.assignedUser || "",
        teamName: "",
        dealId: rec.projectId || null,
        dealName: deal?.dealName || rec.projectName || null,
        dealUrl: deal?.dealUrl || (rec.projectId ? `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/record/0-3/${rec.projectId}` : null),
        dealValue: dealAmount,
        totalDealValue: dealAmount,
        isTentative: true,
        zuperJobUrl: null,
        projectNumber: extractProjectNumber(rec.projectName || ""),
      });
    }

    // Keep jobs that overlap the target month (including jobs that start before month start)
    const overlapsMonth = (job: CalendarJob) => {
      const spanEnd = job.endDate || job.date;
      return !(spanEnd < monthStartStr || job.date > monthEndStr);
    };
    const overlappingConfirmed = confirmedJobs.filter(overlapsMonth);

    // If a confirmed job exists with same deal + start day + category, drop tentative duplicate
    const confirmedKeys = new Set(
      overlappingConfirmed.map((job) => `${job.dealId || job.jobUid}:${job.spanStartDate}:${job.categoryKey}`)
    );
    const overlappingTentative = tentativeJobs.filter((job) => {
      const key = `${job.dealId || job.jobUid}:${job.spanStartDate}:${job.categoryKey}`;
      return overlapsMonth(job) && !confirmedKeys.has(key);
    });

    const overlappingJobs = [...overlappingConfirmed, ...overlappingTentative];

    // Expand multi-day jobs into business-day rows with value split across business days only
    const expandedMonthJobs: CalendarJob[] = [];
    for (const job of overlappingJobs) {
      const spanStart = job.date;
      const spanEnd = job.endDate || job.date;
      const fullSpanBusinessDates = listBusinessDatesInclusive(spanStart, spanEnd);
      if (fullSpanBusinessDates.length === 0) continue;
      const perDayValue = (job.totalDealValue || 0) / fullSpanBusinessDates.length;
      const overlapBusinessDates = fullSpanBusinessDates.filter((d) => d >= monthStartStr && d <= monthEndStr);

      for (const d of overlapBusinessDates) {
        expandedMonthJobs.push({
          ...job,
          date: d,
          dealValue: perDayValue,
          spanStartDate: spanStart,
          spanEndDate: job.endDate,
          spanDays: fullSpanBusinessDates.length,
        });
      }
    }

    // Day-level dedupe with confirmed rows taking priority over tentative
    const dayJobMap = new Map<string, CalendarJob>();
    for (const job of expandedMonthJobs) {
      const key = `${job.dealId || job.jobUid}:${job.date}:${job.categoryKey}`;
      const existing = dayJobMap.get(key);
      if (!existing) {
        dayJobMap.set(key, job);
      } else if (existing.isTentative && !job.isTentative) {
        dayJobMap.set(key, job);
      }
    }
    const monthJobs = Array.from(dayJobMap.values()).sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return b.dealValue - a.dealValue;
    });

    // Build daily totals by category
    const dailyTotals: Record<string, DayTotals> = {};

    for (const job of monthJobs) {
      if (!dailyTotals[job.date]) {
        dailyTotals[job.date] = {
          totalValue: 0,
          construction: { count: 0, value: 0 },
          detach: { count: 0, value: 0 },
          reset: { count: 0, value: 0 },
          service: { count: 0, value: 0 },
        };
      }

      const day = dailyTotals[job.date];
      day.totalValue += job.dealValue;
      day[job.categoryKey].count += 1;
      day[job.categoryKey].value += job.dealValue;
    }

    // Build month totals
    const monthTotals = {
      totalValue: 0,
      totalJobs: overlappingJobs.length,
      byCategory: {
        construction: { count: 0, value: 0 },
        detach: { count: 0, value: 0 },
        reset: { count: 0, value: 0 },
        service: { count: 0, value: 0 },
      } as Record<CategoryKey, { count: number; value: number }>,
    };

    for (const job of overlappingJobs) {
      monthTotals.byCategory[job.categoryKey].count += 1;
    }

    for (const job of monthJobs) {
      monthTotals.totalValue += job.dealValue;
      monthTotals.byCategory[job.categoryKey].value += job.dealValue;
    }

    return NextResponse.json({
      dailyTotals,
      jobs: monthJobs,
      monthTotals,
      filters: {
        teams: [...teamSet].sort(),
      },
      month: {
        year,
        month,
        startDate: monthStartStr,
        endDate: monthEndStr,
      },
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[revenue-calendar] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch revenue calendar" },
      { status: 500 }
    );
  }
}
