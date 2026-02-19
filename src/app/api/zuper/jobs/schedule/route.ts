import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { headers } from "next/headers";
import { zuper, createJobFromProject, JOB_CATEGORY_UIDS, ZuperJob } from "@/lib/zuper";
import { auth } from "@/auth";
import { getUserByEmail, logActivity, createScheduleRecord, cacheZuperJob, canScheduleType, getCrewMemberByName, getCrewMemberByZuperUserUid, getCachedZuperJobByDealId, prisma, UserRole } from "@/lib/db";
import { sendSchedulingNotification, sendCancellationNotification } from "@/lib/email";
import { updateDealProperty, getDealProperties, updateSiteSurveyorProperty } from "@/lib/hubspot";
import { upsertSiteSurveyCalendarEvent } from "@/lib/google-calendar";
import { getBusinessEndDateInclusive, isWeekendDate } from "@/lib/business-days";

type ScheduleType = "survey" | "installation" | "inspection";
const MANAGER_ROLES = ["ADMIN", "OWNER", "MANAGER", "OPERATIONS_MANAGER"];

async function checkScheduleOwnership(
  user: { email: string; role: string },
  projectId: string,
  scheduleType: ScheduleType
): Promise<{
  allowed: boolean;
  reason?: string;
  record?: {
    id: string;
    scheduledBy: string | null;
    scheduledByEmail: string | null;
  };
}> {
  if (MANAGER_ROLES.includes(user.role)) {
    return { allowed: true };
  }

  if (!prisma) {
    return { allowed: true };
  }

  const record = await prisma.scheduleRecord.findFirst({
    where: {
      projectId,
      scheduleType,
      status: { in: ["scheduled", "tentative"] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      scheduledBy: true,
      scheduledByEmail: true,
    },
  });

  if (!record?.scheduledByEmail) {
    return { allowed: true, record: record || undefined };
  }

  if (record.scheduledByEmail.toLowerCase() === user.email.toLowerCase()) {
    return { allowed: true, record };
  }

  return {
    allowed: false,
    reason: `This ${scheduleType} was scheduled by ${record.scheduledBy || "another user"}. Only they or a manager can modify it.`,
    record,
  };
}

function getConstructionScheduleBoundaryProperties(): { start: string | null; end: string | null } {
  const start = process.env.HUBSPOT_CONSTRUCTION_START_DATE_PROPERTY?.trim() || null;
  const end = process.env.HUBSPOT_CONSTRUCTION_END_DATE_PROPERTY?.trim() || null;
  return { start, end };
}

function hubSpotDateTimeCandidatesFromUtc(
  utcDateTime: string,
  localDate?: string,
  allowDateFallback = false
): string[] {
  const iso = `${utcDateTime.replace(" ", "T")}Z`;
  const candidates = [iso, utcDateTime];
  const ms = Date.parse(iso);
  if (Number.isFinite(ms)) {
    candidates.unshift(String(ms));
  }
  if (allowDateFallback) {
    const utcDateOnly = iso.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(utcDateOnly)) {
      candidates.push(utcDateOnly);
      const utcMidnightMs = Date.parse(`${utcDateOnly}T00:00:00.000Z`);
      if (Number.isFinite(utcMidnightMs)) candidates.push(String(utcMidnightMs));
    }
    if (localDate && /^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      candidates.push(localDate);
      const localMidnightMs = Date.parse(`${localDate}T00:00:00.000Z`);
      if (Number.isFinite(localMidnightMs)) candidates.push(String(localMidnightMs));
    }
  }
  return [...new Set(candidates)];
}

function allowDateFallbackForConstructionBoundary(): boolean {
  return String(process.env.HUBSPOT_CONSTRUCTION_BOUNDARY_ALLOW_DATE_FALLBACK || "").toLowerCase() === "true";
}

function parseHubSpotValueToMs(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^\d{10,13}$/.test(value)) {
    const numeric = value.length === 10 ? Number(value) * 1000 : Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const ms = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(ms) ? ms : null;
  }
  const normalized =
    /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(value)
      ? `${value.replace(" ", "T")}Z`
      : value;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function parseHubSpotValueToDateOnly(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const ms = parseHubSpotValueToMs(value);
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function matchesHubSpotDateValue(actualRaw: string | null | undefined, expectedCandidates: string[]): boolean {
  const actual = String(actualRaw || "").trim();
  if (!actual) return false;
  if (expectedCandidates.includes(actual)) return true;
  const actualMs = parseHubSpotValueToMs(actual);
  const actualDate = parseHubSpotValueToDateOnly(actual);
  for (const candidate of expectedCandidates) {
    if (candidate === actual) return true;
    const candidateMs = parseHubSpotValueToMs(candidate);
    if (actualMs != null && candidateMs != null && actualMs === candidateMs) return true;
    const candidateDate = parseHubSpotValueToDateOnly(candidate);
    if (actualDate && candidateDate && actualDate === candidateDate) return true;
  }
  return false;
}

async function writeHubSpotDateTimeProperty(
  dealId: string,
  propertyName: string,
  utcDateTime: string,
  localDate?: string,
  allowDateFallback = false
): Promise<{ ok: boolean; writtenValue: string | null }> {
  for (const candidate of hubSpotDateTimeCandidatesFromUtc(utcDateTime, localDate, allowDateFallback)) {
    const ok = await updateDealProperty(dealId, { [propertyName]: candidate });
    if (ok) {
      return { ok: true, writtenValue: candidate };
    }
  }
  return { ok: false, writtenValue: null };
}

async function writeConstructionScheduleBoundaryProperties(
  dealId: string,
  startUtcDateTime: string,
  endUtcDateTime: string,
  startLocalDate?: string,
  endLocalDate?: string
): Promise<string[]> {
  const { start, end } = getConstructionScheduleBoundaryProperties();
  const warnings: string[] = [];
  const allowDateFallback = allowDateFallbackForConstructionBoundary();

  const applyAndVerify = async (propertyName: string, utcDateTime: string, localDate?: string) => {
    const expectedCandidates = hubSpotDateTimeCandidatesFromUtc(utcDateTime, localDate, allowDateFallback);
    const writeResult = await writeHubSpotDateTimeProperty(
      dealId,
      propertyName,
      utcDateTime,
      localDate,
      allowDateFallback
    );
    if (!writeResult.ok || !writeResult.writtenValue) {
      warnings.push(`HubSpot ${propertyName} write failed`);
      return;
    }

    const verifyProps = await getDealProperties(dealId, [propertyName]);
    if (!verifyProps) {
      warnings.push(`HubSpot ${propertyName} verification read failed`);
      return;
    }

    if (!matchesHubSpotDateValue(verifyProps[propertyName], expectedCandidates)) {
      warnings.push(`HubSpot ${propertyName} verification failed`);
    }
  };

  if (start) {
    await applyAndVerify(start, startUtcDateTime, startLocalDate);
  }
  if (end) {
    await applyAndVerify(end, endUtcDateTime, endLocalDate);
  }

  return warnings;
}

function canUseTestMode(role?: string | null): boolean {
  if (!role) return false;
  return role === "ADMIN";
}

function getCategoryNameForScheduleType(type: ScheduleType): string {
  if (type === "installation") return "Construction";
  if (type === "inspection") return "Inspection";
  return "Site Survey";
}

function getCategoryUidForScheduleType(type: ScheduleType): string {
  if (type === "installation") return JOB_CATEGORY_UIDS.CONSTRUCTION;
  if (type === "inspection") return JOB_CATEGORY_UIDS.INSPECTION;
  return JOB_CATEGORY_UIDS.SITE_SURVEY;
}

function getHubSpotScheduleDateUpdate(type: ScheduleType, date: string): Record<string, string> {
  if (type === "installation") {
    return {
      install_schedule_date: date,
      construction_scheduled_date: date,
    };
  }
  if (type === "inspection") {
    return {
      inspections_schedule_date: date,
      inspection_scheduled_date: date,
    };
  }
  return {
    site_survey_schedule_date: date,
  };
}

function extractHubspotDealIdFromJob(job: ZuperJob): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customFields = (job as any).custom_fields as Array<{ label?: string; name?: string; value?: string }> | undefined;
  if (Array.isArray(customFields)) {
    const dealIdField = customFields.find((f) => {
      const label = (f.label || "").toLowerCase();
      const name = (f.name || "").toLowerCase();
      return label === "hubspot deal id" || label === "hubspot_deal_id" ||
        name === "hubspot_deal_id" || name === "hubspot deal id";
    });
    if (dealIdField?.value) return String(dealIdField.value);
  }

  const tags = Array.isArray(job.job_tags) ? job.job_tags : [];
  for (const t of tags) {
    const tagMatch = String(t).match(/^hubspot-(\d+)$/i);
    if (tagMatch?.[1]) return tagMatch[1];
  }
  return null;
}

function isBlank(value: unknown): boolean {
  if (value == null) return true;
  const str = String(value).trim().toLowerCase();
  return str === "" || str === "null" || str === "undefined";
}

async function verifyHubSpotScheduleWrite(
  dealId: string,
  scheduleType: ScheduleType,
  scheduleDate: string,
  expectedSurveyor?: string
): Promise<{ ok: boolean; warnings: string[] }> {
  const verificationFields =
    scheduleType === "survey"
      ? ["site_survey_schedule_date", "site_surveyor"]
      : scheduleType === "installation"
        ? ["install_schedule_date", "construction_scheduled_date"]
        : ["inspections_schedule_date", "inspection_scheduled_date"];

  const props = await getDealProperties(dealId, verificationFields);
  if (!props) {
    return { ok: false, warnings: ["HubSpot verification read failed"] };
  }

  const warnings: string[] = [];
  const dateValues =
    scheduleType === "survey"
      ? [props.site_survey_schedule_date]
      : scheduleType === "installation"
        ? [props.install_schedule_date, props.construction_scheduled_date]
        : [props.inspections_schedule_date, props.inspection_scheduled_date];
  const dateMatched = dateValues.some((v) => String(v || "") === scheduleDate);
  if (!dateMatched) {
    warnings.push(`HubSpot schedule date verification failed (expected ${scheduleDate})`);
  }

  if (scheduleType === "survey" && expectedSurveyor?.trim()) {
    if (isBlank(props.site_surveyor)) {
      warnings.push("HubSpot site_surveyor verification failed (still blank)");
    }
  }

  return { ok: warnings.length === 0, warnings };
}

/**
 * Smart scheduling endpoint that:
 * 1. Searches for existing Zuper job by HubSpot deal ID
 * 2. If found, reschedules the existing job
 * 3. If not found, creates a new job
 *
 * This prevents duplicate jobs when HubSpot workflows have already created the initial job.
 */
export async function PUT(request: NextRequest) {
  tagSentryRequest(request);
  try {
    // Check authentication
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    // Get user and check permissions
    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { project, schedule, rescheduleOnly } = body;
    const isUiReschedule = schedule?.isReschedule === true;
    // Default to reschedule-only to avoid accidental job creation.
    const effectiveRescheduleOnly = rescheduleOnly !== false;
    const isTestMode = schedule?.testMode === true;

    // Validate schedule type early for permission check
    const scheduleType = schedule?.type as ScheduleType;
    if (!scheduleType || !["survey", "installation", "inspection"].includes(scheduleType)) {
      return NextResponse.json(
        { error: "Invalid schedule type. Must be: survey, installation, or inspection" },
        { status: 400 }
      );
    }

    // Check if user has permission to schedule this type
    if (!canScheduleType(user.role as UserRole, scheduleType)) {
      console.log(`[Zuper Schedule] Permission denied: User ${session.user.email} (${user.role}) cannot schedule ${scheduleType}`);
      return NextResponse.json(
        { error: `You don't have permission to schedule ${scheduleType}s. Contact an admin if you need access.` },
        { status: 403 }
      );
    }

    if (isTestMode && !canUseTestMode(user.role)) {
      console.log(`[Zuper Schedule] Permission denied: User ${session.user.email} (${user.role}) cannot use test mode`);
      return NextResponse.json(
        { error: "You don't have permission to use test slot mode." },
        { status: 403 }
      );
    }

    // Check if Zuper is configured
    if (!zuper.isConfigured()) {
      return NextResponse.json(
        { error: "Zuper integration not configured", configured: false },
        { status: 503 }
      );
    }
    // Validate required fields
    if (!project?.id || !schedule?.date) {
      return NextResponse.json(
        { error: "Missing required fields: project.id, schedule.date" },
        { status: 400 }
      );
    }
    const ownership = await checkScheduleOwnership(
      { email: session.user.email, role: user.role || "" },
      String(project.id),
      scheduleType
    );
    if (!ownership.allowed) {
      return NextResponse.json(
        { error: ownership.reason || "You are not allowed to modify this schedule" },
        { status: 403 }
      );
    }
    if (isWeekendDate(schedule.date)) {
      return NextResponse.json(
        { error: "Cannot schedule on weekends" },
        { status: 400 }
      );
    }

    const hubspotTag = `hubspot-${project.id}`;

    // If the client already knows the Zuper job UID, use it directly (most reliable!)
    const existingJobUid: string | undefined = project.zuperJobUid;

    console.log(`[Zuper Schedule] Processing schedule request:`);
    console.log(`  - Project ID: ${project.id}`);
    console.log(`  - Project Name: ${project.name}`);
    console.log(`  - Known Zuper Job UID: ${existingJobUid || "none"}`);
    console.log(`  - Schedule Type: ${schedule.type}`);

    // Map schedule type to Zuper category names and UIDs
    const categoryConfig: Record<string, { name: string; uid: string }> = {
      survey: { name: "Site Survey", uid: JOB_CATEGORY_UIDS.SITE_SURVEY },
      installation: { name: "Construction", uid: JOB_CATEGORY_UIDS.CONSTRUCTION },
      inspection: { name: "Inspection", uid: JOB_CATEGORY_UIDS.INSPECTION },
    };
    const targetCategoryName = categoryConfig[schedule.type].name;
    const targetCategoryUid = categoryConfig[schedule.type].uid;

    // Helper to get category info from job
    const getJobCategoryInfo = (job: ZuperJob): { name: string; uid: string } => {
      if (typeof job.job_category === "string") {
        return { name: job.job_category, uid: job.job_category };
      }
      return {
        name: job.job_category?.category_name || "",
        uid: job.job_category?.category_uid || "",
      };
    };

    // Helper to check if job matches target category
    const categoryMatches = (job: ZuperJob): boolean => {
      const catInfo = getJobCategoryInfo(job);
      return catInfo.name.toLowerCase() === targetCategoryName.toLowerCase() ||
             catInfo.uid === targetCategoryUid;
    };

    // Helper to get HubSpot Deal ID from custom fields (same logic as lookup API)
    const getHubSpotDealId = (job: ZuperJob): string | null => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const customFields = (job as any).custom_fields as Array<{ label?: string; name?: string; value?: string }> | undefined;
      if (!customFields || !Array.isArray(customFields)) return null;
      const dealIdField = customFields.find((f) => {
        const label = f.label?.toLowerCase() || "";
        const name = f.name?.toLowerCase() || "";
        return label === "hubspot deal id" || label === "hubspot_deal_id" ||
               name === "hubspot_deal_id" || name === "hubspot deal id";
      });
      if (dealIdField?.value) return dealIdField.value;
      const dealLinkField = customFields.find((f) => {
        const label = f.label?.toLowerCase() || "";
        const name = f.name?.toLowerCase() || "";
        return (label.includes("hubspot") && label.includes("link")) ||
               (name.includes("hubspot") && name.includes("link"));
      });
      if (dealLinkField?.value) {
        const urlMatch = dealLinkField.value.match(/\/record\/0-3\/(\d+)/);
        if (urlMatch) return urlMatch[1];
      }
      return null;
    };

    let existingJob: ZuperJob | undefined;
    let matchMethod = "";

    // --- Strategy 1: Client already knows the Zuper job UID (from page-load lookup) ---
    if (existingJobUid) {
      console.log(`[Zuper Schedule] Using provided Zuper job UID: ${existingJobUid}`);
      existingJob = { job_uid: existingJobUid, job_title: project.name } as ZuperJob;
      matchMethod = "client_uid";
    }

    // --- Strategy 2: Check DB cache (set when jobs are scheduled through the app) ---
    if (!existingJob) {
      try {
        const cached = await getCachedZuperJobByDealId(project.id, targetCategoryName);
        if (cached?.jobUid) {
          console.log(`[Zuper Schedule] DB cache hit: project ${project.id} → job ${cached.jobUid}`);
          existingJob = { job_uid: cached.jobUid, job_title: cached.jobTitle || project.name } as ZuperJob;
          matchMethod = "db_cache";
        }
      } catch (dbErr) {
        console.warn(`[Zuper Schedule] DB cache lookup failed:`, dbErr);
      }
    }

    // --- Strategy 3: Search Zuper API with multiple matching methods ---
    if (!existingJob) {
      // Extract customer name parts for matching
      // HubSpot format: "PROJ-9031 | LastName, FirstName | Address"
      const nameParts = project.name?.split(" | ") || [];
      const customerName = nameParts.length >= 2
        ? nameParts[1]?.trim()
        : nameParts[0]?.trim() || "";
      const customerLastName = customerName.split(",")[0]?.trim() || "";
      const projNumber = nameParts[0]?.trim().match(/PROJ-\d+/i)?.[0] || "";

      console.log(`[Zuper Schedule] Searching Zuper API:`);
      console.log(`  - Customer Last Name: ${customerLastName}`);
      console.log(`  - PROJ Number: ${projNumber || "none"}`);
      console.log(`  - HubSpot Tag: ${hubspotTag}`);

      // Do TWO searches in parallel for maximum coverage:
      // 1. Name-based search (fuzzy, finds by customer name in title)
      // 2. Broad date-range search (finds by deal ID custom field, tags, PROJ number)
      const [nameSearch, broadSearch] = await Promise.all([
        customerLastName
          ? zuper.searchJobs({ limit: 100, search: customerLastName })
          : Promise.resolve({ type: "success" as const, data: { jobs: [] as ZuperJob[], total: 0 } }),
        zuper.searchJobs({
          limit: 500,
          from_date: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
          to_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        }),
      ]);

      // Merge results, deduplicating by job_uid
      const allJobs = new Map<string, ZuperJob>();
      for (const result of [nameSearch, broadSearch]) {
        if (result.type === "success" && result.data?.jobs) {
          for (const job of result.data.jobs) {
            if (job.job_uid && !allJobs.has(job.job_uid)) {
              allJobs.set(job.job_uid, job);
            }
          }
        }
      }

      console.log(`[Zuper Schedule] Combined search: ${allJobs.size} unique jobs (name: ${nameSearch.data?.jobs?.length || 0}, broad: ${broadSearch.data?.jobs?.length || 0})`);

      // Filter to target category
      const categoryJobs = [...allJobs.values()].filter(categoryMatches);

      // Match 3a: HubSpot Deal ID custom field (most reliable API match)
      if (!existingJob) {
        for (const job of categoryJobs) {
          const dealId = getHubSpotDealId(job);
          if (dealId === project.id) {
            existingJob = job;
            matchMethod = "hubspot_deal_id";
            break;
          }
        }
      }

      // Match 3b: HubSpot tag (hubspot-{dealId})
      if (!existingJob) {
        existingJob = categoryJobs.find((job) => job.job_tags?.includes(hubspotTag));
        if (existingJob) matchMethod = "hubspot_tag";
      }

      // Match 3c: PROJ number tag
      if (!existingJob && projNumber) {
        existingJob = categoryJobs.find((job) =>
          job.job_tags?.some(t => t.toLowerCase() === projNumber.toLowerCase())
        );
        if (existingJob) matchMethod = "proj_tag";
      }

      // Match 3d: PROJ number in job title
      if (!existingJob && projNumber) {
        const normalizedProj = projNumber.toLowerCase();
        existingJob = categoryJobs.find((job) =>
          (job.job_title?.toLowerCase() || "").includes(normalizedProj)
        );
        if (existingJob) matchMethod = "proj_in_title";
      }

      // Match 3e: Customer last name in job title
      if (!existingJob && customerLastName.length > 2) {
        const normalizedLastName = customerLastName.toLowerCase().trim();
        existingJob = categoryJobs.find((job) => {
          const title = job.job_title?.toLowerCase() || "";
          return title.includes(normalizedLastName + ",") ||
                 title.startsWith(normalizedLastName + " ");
        });
        if (existingJob) matchMethod = "name_in_title";
      }

      if (existingJob) {
        console.log(`[Zuper Schedule] Found existing job: ${existingJob.job_uid} (matched by: ${matchMethod})`);
      } else {
        console.log(`[Zuper Schedule] No matching ${targetCategoryName} job found for "${project.name}"`);
      }
    }

    // Calculate schedule times
    // Slot times are in the crew member's local timezone (e.g. Mountain Time for CO, Pacific for CA)
    // Zuper expects UTC, so we convert using the timezone provided by the frontend
    const days = Number.isFinite(Number(schedule.days)) ? Number(schedule.days) : 1;

    // Determine the timezone for this schedule
    // Frontend passes schedule.timezone for timezone-aware slots (e.g. "America/Los_Angeles" for CA)
    // Default to Mountain Time for CO locations
    const slotTimezone = schedule.timezone || "America/Denver";

    // Helper to convert local time to UTC for Zuper API
    // Takes a date string (YYYY-MM-DD) and time string (HH:mm) in the slot's local timezone
    // Returns UTC datetime string in "YYYY-MM-DD HH:mm:ss" format
    const localToUtc = (dateStr: string, timeStr: string): string => {
      const [year, month, day] = dateStr.split('-').map(Number);
      const [hours, minutes] = (timeStr + ":00").split(':').map(Number);

      // Create a date object and use Intl to determine the UTC offset for this timezone
      const testDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      const localFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: slotTimezone,
        timeZoneName: 'longOffset'
      });
      const parts = localFormatter.formatToParts(testDate);
      const tzOffsetStr = parts.find(p => p.type === 'timeZoneName')?.value || '';
      // Parse offset like "GMT-07:00" or "GMT-06:00"
      const offsetMatch = tzOffsetStr.match(/GMT([+-])(\d{2}):(\d{2})/);
      let offsetHours: number;
      if (offsetMatch) {
        const sign = offsetMatch[1] === '-' ? 1 : -1; // Negative UTC offset means ADD hours to get UTC
        offsetHours = sign * parseInt(offsetMatch[2]);
      } else {
        // Fallback: use short name to determine offset for common timezones
        const shortFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: slotTimezone,
          timeZoneName: 'short'
        });
        const shortParts = shortFormatter.formatToParts(testDate);
        const shortTzName = shortParts.find(p => p.type === 'timeZoneName')?.value || '';
        // Common US timezone offsets
        const tzOffsets: Record<string, number> = {
          'MST': 7, 'MDT': 6, 'PST': 8, 'PDT': 7, 'CST': 6, 'CDT': 5, 'EST': 5, 'EDT': 4,
        };
        offsetHours = tzOffsets[shortTzName] || 7; // Default to MST
      }

      // Add the offset to convert local time to UTC
      let utcHours = hours + offsetHours;
      let utcDay = day;
      let utcMonth = month;
      let utcYear = year;

      // Handle day overflow
      if (utcHours >= 24) {
        utcHours -= 24;
        utcDay += 1;
        // Handle month overflow
        const daysInMonth = new Date(year, month, 0).getDate();
        if (utcDay > daysInMonth) {
          utcDay = 1;
          utcMonth += 1;
          if (utcMonth > 12) {
            utcMonth = 1;
            utcYear += 1;
          }
        }
      }

      return `${utcYear}-${String(utcMonth).padStart(2, '0')}-${String(utcDay).padStart(2, '0')} ${String(utcHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
    };

    let startDateTime: string;
    let endDateTime: string;
    const boundaryStartDate = schedule.date;
    let boundaryEndDate = schedule.date;

    if (schedule.type === "inspection") {
      // Inspections always use a fixed 8am-4pm same-day window
      // The slot selection only determines the inspector assignment, not the time window
      startDateTime = localToUtc(schedule.date, "08:00");
      endDateTime = localToUtc(schedule.date, "16:00");
      console.log(`[Zuper Schedule] Inspection: using fixed 8am-4pm ${slotTimezone} window`);
    } else if (schedule.type === "survey" && schedule.startTime && schedule.endTime) {
      // Use specific time slot (e.g., "12:00" to "13:00" for site surveys)
      // Convert from local timezone to UTC for Zuper
      startDateTime = localToUtc(schedule.date, schedule.startTime);
      endDateTime = localToUtc(schedule.date, schedule.endTime);
      console.log(`[Zuper Schedule] Converting ${slotTimezone} time ${schedule.startTime}-${schedule.endTime} to UTC`);
    } else {
      // Installation spans should respect requested day count even when start/end
      // values are present (master scheduler sends defaults 08:00-16:00).
      const localStart = schedule.startTime || "08:00";
      const localEnd = schedule.endTime || "16:00";
      startDateTime = localToUtc(schedule.date, localStart);

      // Installation spans use business-day math (skip weekends).
      const endDateStr = getBusinessEndDateInclusive(schedule.date, days);
      boundaryEndDate = endDateStr;
      endDateTime = localToUtc(endDateStr, localEnd);
    }

    console.log(`[Zuper Schedule] Schedule times (UTC for Zuper): ${startDateTime} to ${endDateTime}`);

    // Resolve user UID from name if crew is empty but assignedUser is provided
    // This handles users whose UIDs aren't hardcoded in the frontend
    const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    let resolvedCrew = schedule.crew || "";
    let resolvedTeamUid = schedule.teamUid || "";
    if ((!resolvedCrew || !isUuid(resolvedCrew)) && schedule.assignedUser) {
      console.log(`[Zuper Schedule] Resolving UID for "${schedule.assignedUser}" (crew was "${resolvedCrew}")`);
      const resolved = await zuper.resolveUserUid(schedule.assignedUser);
      if (resolved) {
        resolvedCrew = resolved.userUid;
        if (!resolvedTeamUid && resolved.teamUid) resolvedTeamUid = resolved.teamUid;
        console.log(`[Zuper Schedule] Resolved "${schedule.assignedUser}" → userUid: ${resolvedCrew}, teamUid: ${resolvedTeamUid}`);
      } else {
        console.warn(`[Zuper Schedule] Could not resolve UID for "${schedule.assignedUser}"`);
      }
    }

    if (existingJob && existingJob.job_uid) {
      // Reschedule existing job
      console.log(`[Zuper Schedule] ACTION: RESCHEDULE - Job UID: ${existingJob.job_uid}`);

      // Get user UIDs from crew selection (crew can be a user UID or comma-separated list)
      const userUids = resolvedCrew ? resolvedCrew.split(",").map((u: string) => u.trim()).filter(Boolean) : [];
      const teamUid = resolvedTeamUid; // Team UID required for assignment API

      console.log(`[Zuper Schedule] Input schedule.crew: "${schedule.crew}" → resolved: "${resolvedCrew}"`);
      console.log(`[Zuper Schedule] Input schedule.teamUid: "${schedule.teamUid}" → resolved: "${resolvedTeamUid}"`);
      console.log(`[Zuper Schedule] Parsed userUids:`, userUids);
      console.log(`[Zuper Schedule] Assigning to users:`, userUids, `team:`, teamUid || "NOT PROVIDED");

      const rescheduleResult = await zuper.rescheduleJob(
        existingJob.job_uid,
        startDateTime,
        endDateTime,
        userUids,
        teamUid // Pass team UID for assignment
      );

      if (rescheduleResult.type === "error") {
        console.log(`[Zuper Schedule] RESCHEDULE FAILED: ${rescheduleResult.error}`);
        return NextResponse.json(
          { error: rescheduleResult.error, action: "reschedule_failed" },
          { status: 500 }
        );
      }

      // Check if assignment failed (schedule succeeded but user assignment didn't)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jobData = rescheduleResult.data as any;
      const assignmentFailed = jobData?._assignmentFailed;
      const assignmentError = jobData?._assignmentError;

      if (assignmentFailed) {
        console.log(`[Zuper Schedule] RESCHEDULE SUCCESS but ASSIGNMENT FAILED: ${assignmentError}`);
      } else {
        console.log(`[Zuper Schedule] RESCHEDULE SUCCESS`);
      }

      // Log as reschedule only when UI explicitly requested reschedule mode.
      const activityType = isUiReschedule
        ? (schedule.type === "survey" ? "SURVEY_RESCHEDULED" : schedule.type === "inspection" ? "INSPECTION_RESCHEDULED" : "INSTALL_RESCHEDULED")
        : (schedule.type === "survey" ? "SURVEY_SCHEDULED" : schedule.type === "inspection" ? "INSPECTION_SCHEDULED" : "INSTALL_SCHEDULED");
      const activityVerb = isUiReschedule ? "Rescheduled" : "Scheduled";
      await logSchedulingActivity(
        activityType,
        `${activityVerb} ${schedule.type} for ${project.name || project.id}${assignmentFailed ? " (user assignment failed)" : ""}`,
        project,
        existingJob.job_uid,
        schedule
      );

      // Save schedule record to database
      await createScheduleRecord({
        scheduleType: schedule.type,
        projectId: project.id,
        projectName: project.name || `Project ${project.id}`,
        scheduledDate: schedule.date,
        scheduledStart: schedule.startTime,
        scheduledEnd: schedule.endTime,
        assignedUser: schedule.assignedUser,
        assignedUserUid: resolvedCrew || schedule.crew,
        assignedTeamUid: resolvedTeamUid || schedule.teamUid,
        scheduledBy: session.user.name || session.user.email || "",
        scheduledByEmail: session.user.email,
        zuperJobUid: existingJob.job_uid,
        zuperSynced: true,
        zuperAssigned: !assignmentFailed,
        zuperError: assignmentError,
        notes: schedule.notes,
      });

      // Cache the Zuper job with scheduled times so lookup returns them on next page load
      if (rescheduleResult.data) {
        // Parse the UTC start/end datetimes back into Date objects for the cache
        const parsedStart = startDateTime ? new Date(startDateTime.replace(' ', 'T') + 'Z') : undefined;
        const parsedEnd = endDateTime ? new Date(endDateTime.replace(' ', 'T') + 'Z') : undefined;
        await cacheZuperJob({
          jobUid: existingJob.job_uid,
          jobTitle: rescheduleResult.data.job_title || `${schedule.type} - ${project.name}`,
          jobCategory: schedule.type === "survey" ? "Site Survey" : schedule.type === "inspection" ? "Inspection" : "Construction",
          jobStatus: "SCHEDULED",
          hubspotDealId: project.id,
          projectName: project.name,
          scheduledStart: parsedStart,
          scheduledEnd: parsedEnd,
        });
      }

      // Update HubSpot schedule fields and verify persistence.
      const hubspotUpdates: Record<string, string> = getHubSpotScheduleDateUpdate(schedule.type, schedule.date);
      const hubspotDateUpdated = await updateDealProperty(project.id, hubspotUpdates);
      const hubspotWarnings: string[] = [];
      if (!hubspotDateUpdated) {
        hubspotWarnings.push("HubSpot schedule date write failed");
      }
      if (schedule.type === "survey" && schedule.assignedUser) {
        const surveyorUpdated = await updateSiteSurveyorProperty(project.id, schedule.assignedUser);
        if (!surveyorUpdated) {
          hubspotWarnings.push(`HubSpot site_surveyor write failed (${schedule.assignedUser})`);
        }
      }
      if (schedule.type === "installation") {
        const boundaryWarnings = await writeConstructionScheduleBoundaryProperties(
          project.id,
          startDateTime,
          endDateTime,
          boundaryStartDate,
          boundaryEndDate
        );
        hubspotWarnings.push(...boundaryWarnings);
      }
      const verification = await verifyHubSpotScheduleWrite(project.id, schedule.type as ScheduleType, schedule.date, schedule.assignedUser);
      if (!verification.ok) {
        hubspotWarnings.push(...verification.warnings);
      }
      if (hubspotWarnings.length > 0) {
        console.warn(`[Zuper Schedule] HubSpot verification warnings for deal ${project.id}: ${hubspotWarnings.join("; ")}`);
      }

      // Send notification to assigned crew member (skip for explicit test slots)
      if (!isTestMode) {
        await sendCrewNotification(
          schedule,
          project,
          session.user.name || session.user.email,
          session.user.email
        );
      } else {
        console.log("[Zuper Schedule] Test slot mode enabled; skipping crew notification email");
      }

      return NextResponse.json({
        success: true,
        action: "rescheduled",
        job: rescheduleResult.data,
        message: assignmentFailed
          ? `${schedule.type} job rescheduled but user assignment failed - please assign in Zuper`
          : `${schedule.type} job rescheduled in Zuper`,
        existingJobId: existingJob.job_uid,
        assignmentFailed,
        assignmentError,
        hubspotWarnings: hubspotWarnings.length > 0 ? hubspotWarnings : undefined,
      });
    } else if (effectiveRescheduleOnly) {
      // Reschedule-only mode: don't create new jobs, just report that none was found
      console.log(`[Zuper Schedule] RESCHEDULE ONLY: No existing job found for "${project.name}" with category "${schedule.type}" — skipping creation`);
      return NextResponse.json({
        success: true,
        action: "no_job_found",
        message: `No existing ${schedule.type} job found in Zuper for "${project.name}". Create the job in Zuper first, then reschedule from here.`,
      });
    } else {
      // No existing job found - create new one
      console.log(`[Zuper Schedule] ACTION: CREATE NEW JOB (no existing job found for "${project.name}" with category "${schedule.type}")`);
      const createResult = await createJobFromProject(project, {
        type: schedule.type,
        date: schedule.date,
        days: days,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        crew: resolvedCrew || schedule.crew,
        teamUid: resolvedTeamUid || schedule.teamUid, // Team UID required for user assignment
        timezone: schedule.timezone, // IANA timezone for correct UTC conversion (e.g. "America/Los_Angeles")
        notes: schedule.notes,
      });

      if (createResult.type === "error") {
        return NextResponse.json(
          { error: createResult.error, action: "create_failed" },
          { status: 500 }
        );
      }

      // Log the scheduling activity
      await logSchedulingActivity(
        schedule.type === "survey" ? "SURVEY_SCHEDULED" : schedule.type === "inspection" ? "INSPECTION_SCHEDULED" : "INSTALL_SCHEDULED",
        `Scheduled ${schedule.type} for ${project.name || project.id}`,
        project,
        createResult.data?.job_uid,
        schedule
      );

      // Save schedule record to database
      const newJobUid = createResult.data?.job_uid;
      await createScheduleRecord({
        scheduleType: schedule.type,
        projectId: project.id,
        projectName: project.name || `Project ${project.id}`,
        scheduledDate: schedule.date,
        scheduledStart: schedule.startTime,
        scheduledEnd: schedule.endTime,
        assignedUser: schedule.assignedUser,
        assignedUserUid: resolvedCrew || schedule.crew,
        assignedTeamUid: resolvedTeamUid || schedule.teamUid,
        scheduledBy: session.user.name || session.user.email || "",
        scheduledByEmail: session.user.email,
        zuperJobUid: newJobUid,
        zuperSynced: true,
        zuperAssigned: !!(resolvedCrew || schedule.crew), // Assume assigned if crew was provided at creation
        notes: schedule.notes,
      });

      // Cache the Zuper job with scheduled times
      if (createResult.data && newJobUid) {
        const parsedStart = startDateTime ? new Date(startDateTime.replace(' ', 'T') + 'Z') : undefined;
        const parsedEnd = endDateTime ? new Date(endDateTime.replace(' ', 'T') + 'Z') : undefined;
        await cacheZuperJob({
          jobUid: newJobUid,
          jobTitle: createResult.data.job_title || `${schedule.type} - ${project.name}`,
          jobCategory: schedule.type === "survey" ? "Site Survey" : schedule.type === "inspection" ? "Inspection" : "Construction",
          jobStatus: "SCHEDULED",
          hubspotDealId: project.id,
          projectName: project.name,
          scheduledStart: parsedStart,
          scheduledEnd: parsedEnd,
        });
      }

      // Update HubSpot schedule fields and verify persistence.
      const hubspotUpdates: Record<string, string> = getHubSpotScheduleDateUpdate(schedule.type, schedule.date);
      const hubspotDateUpdated = await updateDealProperty(project.id, hubspotUpdates);
      const hubspotWarnings: string[] = [];
      if (!hubspotDateUpdated) {
        hubspotWarnings.push("HubSpot schedule date write failed");
      }
      if (schedule.type === "survey" && schedule.assignedUser) {
        const surveyorUpdated = await updateSiteSurveyorProperty(project.id, schedule.assignedUser);
        if (!surveyorUpdated) {
          hubspotWarnings.push(`HubSpot site_surveyor write failed (${schedule.assignedUser})`);
        }
      }
      if (schedule.type === "installation") {
        const boundaryWarnings = await writeConstructionScheduleBoundaryProperties(
          project.id,
          startDateTime,
          endDateTime,
          boundaryStartDate,
          boundaryEndDate
        );
        hubspotWarnings.push(...boundaryWarnings);
      }
      const verification = await verifyHubSpotScheduleWrite(project.id, schedule.type as ScheduleType, schedule.date, schedule.assignedUser);
      if (!verification.ok) {
        hubspotWarnings.push(...verification.warnings);
      }
      if (hubspotWarnings.length > 0) {
        console.warn(`[Zuper Schedule] HubSpot verification warnings for deal ${project.id}: ${hubspotWarnings.join("; ")}`);
      }

      // Send notification to assigned crew member (skip for explicit test slots)
      if (!isTestMode) {
        await sendCrewNotification(
          schedule,
          project,
          session.user.name || session.user.email,
          session.user.email
        );
      } else {
        console.log("[Zuper Schedule] Test slot mode enabled; skipping crew notification email");
      }

      return NextResponse.json({
        success: true,
        action: "created",
        job: createResult.data,
        message: `${schedule.type} job created in Zuper (no existing job found)`,
        hubspotWarnings: hubspotWarnings.length > 0 ? hubspotWarnings : undefined,
      });
    }
  } catch (error) {
    console.error("Error scheduling Zuper job:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to schedule Zuper job" },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to check if a job exists for a HubSpot deal
 */
export async function GET(request: NextRequest) {
  tagSentryRequest(request);
  try {
    if (!zuper.isConfigured()) {
      return NextResponse.json(
        { error: "Zuper integration not configured", configured: false },
        { status: 503 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const hubspotId = searchParams.get("hubspot_id");
    const jobType = searchParams.get("type"); // survey, installation, inspection

    if (!hubspotId) {
      return NextResponse.json(
        { error: "Missing required parameter: hubspot_id" },
        { status: 400 }
      );
    }

    const hubspotTag = `hubspot-${hubspotId}`;

    // Search for jobs
    const searchResult = await zuper.searchJobs({
      limit: 100,
    });

    if (searchResult.type === "error") {
      return NextResponse.json(
        { error: searchResult.error },
        { status: 500 }
      );
    }

    // Filter by HubSpot tag
    let matchingJobs =
      searchResult.data?.jobs.filter((job) =>
        job.job_tags?.includes(hubspotTag)
      ) || [];

    // Optionally filter by job type/category
    if (jobType) {
      // Category config with both names and UIDs for flexible matching
      const categoryConfig: Record<string, { name: string; uid: string }> = {
        survey: { name: "Site Survey", uid: JOB_CATEGORY_UIDS.SITE_SURVEY },
        installation: { name: "Construction", uid: JOB_CATEGORY_UIDS.CONSTRUCTION },
        inspection: { name: "Inspection", uid: JOB_CATEGORY_UIDS.INSPECTION },
      };
      const config = categoryConfig[jobType];
      if (config) {
        matchingJobs = matchingJobs.filter((job) => {
          // Handle both string and object category formats
          if (typeof job.job_category === "string") {
            return job.job_category === config.name || job.job_category === config.uid;
          }
          return (
            job.job_category?.category_name === config.name ||
            job.job_category?.category_uid === config.uid
          );
        });
      }
    }

    return NextResponse.json({
      exists: matchingJobs.length > 0,
      jobs: matchingJobs,
      count: matchingJobs.length,
    });
  } catch (error) {
    console.error("Error checking Zuper job:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to check Zuper job" },
      { status: 500 }
    );
  }
}

/**
 * DELETE endpoint to unschedule a job (clear dates in Zuper + HubSpot)
 */
export async function DELETE(request: NextRequest) {
  tagSentryRequest(request);
  try {
    // Check authentication
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    // Get user and check permissions
    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const scheduleType = (body?.scheduleType as ScheduleType) || "survey";
    if (!["survey", "installation", "inspection"].includes(scheduleType)) {
      return NextResponse.json(
        { error: "Invalid scheduleType. Must be: survey, installation, inspection" },
        { status: 400 }
      );
    }

    if (!canScheduleType(user.role as UserRole, scheduleType)) {
      return NextResponse.json(
        { error: `You don't have permission to manage ${scheduleType} schedules.` },
        { status: 403 }
      );
    }

    const {
      projectId,
      projectName,
      projectAddress,
      dealOwner,
      assignedUser,
      scheduledDate,
      scheduledStart,
      scheduledEnd,
      zuperJobUid,
      cancelReason,
    } = body;

    if (!projectId) {
      return NextResponse.json(
        { error: "Missing required field: projectId" },
        { status: 400 }
      );
    }

    const ownership = await checkScheduleOwnership(
      { email: session.user.email, role: user.role || "" },
      String(projectId),
      scheduleType
    );
    if (!ownership.allowed) {
      return NextResponse.json(
        { error: ownership.reason || "You are not allowed to modify this schedule" },
        { status: 403 }
      );
    }

    const latestActiveRecord = prisma
      ? await prisma.scheduleRecord.findFirst({
          where: {
            projectId: String(projectId),
            scheduleType,
            status: { in: ["scheduled", "tentative"] },
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            assignedUser: true,
            assignedUserUid: true,
            scheduledDate: true,
            scheduledStart: true,
            scheduledEnd: true,
            scheduledBy: true,
            notes: true,
          },
        })
      : null;

    console.log(`[Zuper Unschedule] Clearing ${scheduleType} schedule for project ${projectId} (${projectName})`);
    const targetCategoryName = getCategoryNameForScheduleType(scheduleType);
    const targetCategoryUid = getCategoryUidForScheduleType(scheduleType);

    // Resolve Zuper job UID for survey category if UI payload is missing/stale.
    let resolvedJobUid: string | undefined = zuperJobUid || undefined;
    if (zuper.isConfigured() && !resolvedJobUid) {
      try {
        const cached = await getCachedZuperJobByDealId(projectId, targetCategoryName);
        if (cached?.jobUid) {
          resolvedJobUid = cached.jobUid;
        }
      } catch (err) {
        console.warn("[Zuper Unschedule] Cache lookup failed for %s:", projectId, err);
      }
    }
    if (zuper.isConfigured() && !resolvedJobUid) {
      try {
        const hubspotTag = `hubspot-${projectId}`;
        const searchResult = await zuper.searchJobs({ limit: 200 });
        if (searchResult.type === "success" && searchResult.data?.jobs) {
          const match = searchResult.data.jobs.find((job) => {
            const inCategory = typeof job.job_category === "string"
              ? job.job_category === targetCategoryName || job.job_category === targetCategoryUid
              : job.job_category?.category_name === targetCategoryName ||
                job.job_category?.category_uid === targetCategoryUid;
            return inCategory && !!job.job_tags?.includes(hubspotTag);
          });
          if (match?.job_uid) {
            resolvedJobUid = match.job_uid;
          }
        }
      } catch (err) {
        console.warn("[Zuper Unschedule] API lookup failed for %s:", projectId, err);
      }
    }

    // Clear schedule in Zuper using resolved UID
    let zuperCleared = false;
    let zuperError: string | undefined;
    if (zuper.isConfigured() && !resolvedJobUid) {
      zuperError = `No matching Zuper ${targetCategoryName} job found to unschedule`;
      console.warn("[Zuper Unschedule] %s for project %s", zuperError, projectId);
    } else if (resolvedJobUid && zuper.isConfigured()) {
      try {
        const result = await zuper.unscheduleJob(resolvedJobUid);
        if (result.type === "success") {
          zuperCleared = true;
          console.log(`[Zuper Unschedule] Cleared Zuper job ${resolvedJobUid}`);
        } else {
          console.warn(`[Zuper Unschedule] Failed to clear Zuper job: ${result.error}`);
          zuperError = result.error;
        }
      } catch (err) {
        console.error(`[Zuper Unschedule] Error clearing Zuper job:`, err);
        zuperError = err instanceof Error ? err.message : "Unknown Zuper unschedule error";
      }
    }

    // Clear HubSpot schedule fields.
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let hubspotFieldsCleared = false;
    let hubspotStatusUpdated = false;
    let hubspotDealIdUsed: string | null = null;
    let hubspotCleared = false;
    let hubspotError: string | undefined;
    let hubspotVerification: Record<string, string | null> | null = null;
    const isBlank = (v: string | null | undefined) => v == null || v === "";
    try {
      const candidateDealIds = [projectId];
      if (resolvedJobUid) {
        const resolvedJob = await zuper.getJob(resolvedJobUid);
        if (resolvedJob.type === "success" && resolvedJob.data) {
          const resolvedDealId = extractHubspotDealIdFromJob(resolvedJob.data);
          if (resolvedDealId && !candidateDealIds.includes(resolvedDealId)) {
            candidateDealIds.push(resolvedDealId);
          }
        }
      }

      for (const dealId of candidateDealIds) {
        // Reset the stage-specific status field.
        if (scheduleType === "survey") {
          hubspotStatusUpdated = await updateDealProperty(dealId, {
            site_survey_status: "Ready to Schedule",
          });
          if (!hubspotStatusUpdated) {
            hubspotStatusUpdated = await updateDealProperty(dealId, {
              site_survey_status: "Ready To Schedule",
            });
          }
        } else if (scheduleType === "installation") {
          hubspotStatusUpdated = await updateDealProperty(dealId, {
            install_status: "Ready to Build",
          });
          if (!hubspotStatusUpdated) {
            hubspotStatusUpdated = await updateDealProperty(dealId, {
              install_status: "Ready To Build",
            });
          }
        } else {
          hubspotStatusUpdated = await updateDealProperty(dealId, {
            final_inspection_status: "Ready for Inspection",
          });
          if (!hubspotStatusUpdated) {
            hubspotStatusUpdated = await updateDealProperty(dealId, {
              final_inspection_status: "Ready For Inspection",
            });
          }
        }

        let scheduleCleared = false;
        let surveyorCleared = scheduleType !== "survey";
        const MAX_CLEAR_ATTEMPTS = 4;
        for (let attempt = 1; attempt <= MAX_CLEAR_ATTEMPTS; attempt += 1) {
          if (scheduleType === "survey") {
            scheduleCleared = await updateDealProperty(dealId, {
              site_survey_schedule_date: "",
            });
            if (!scheduleCleared) {
              scheduleCleared = await updateDealProperty(dealId, {
                site_survey_schedule_date: null,
              });
            }

            surveyorCleared = await updateDealProperty(dealId, {
              site_surveyor: "",
            });
            if (!surveyorCleared) {
              surveyorCleared = await updateDealProperty(dealId, {
                site_surveyor: null,
              });
            }
          } else if (scheduleType === "installation") {
            scheduleCleared = await updateDealProperty(dealId, {
              install_schedule_date: "",
            });
            if (!scheduleCleared) {
              scheduleCleared = await updateDealProperty(dealId, {
                install_schedule_date: null,
              });
            }
            if (!scheduleCleared) {
              scheduleCleared = await updateDealProperty(dealId, {
                construction_scheduled_date: null,
              });
            }
            const { start: startBoundaryProperty, end: endBoundaryProperty } = getConstructionScheduleBoundaryProperties();
            for (const boundaryProperty of [startBoundaryProperty, endBoundaryProperty]) {
              if (!boundaryProperty) continue;
              let cleared = await updateDealProperty(dealId, {
                [boundaryProperty]: "",
              });
              if (!cleared) {
                cleared = await updateDealProperty(dealId, {
                  [boundaryProperty]: null,
                });
              }
              if (!cleared) {
                console.warn(
                  `[Zuper Unschedule] Failed to clear HubSpot ${boundaryProperty} for deal ${dealId}`
                );
              }
            }
          } else {
            scheduleCleared = await updateDealProperty(dealId, {
              inspections_schedule_date: "",
            });
            if (!scheduleCleared) {
              scheduleCleared = await updateDealProperty(dealId, {
                inspections_schedule_date: null,
              });
            }
            if (!scheduleCleared) {
              scheduleCleared = await updateDealProperty(dealId, {
                inspection_scheduled_date: null,
              });
            }
          }

          hubspotDealIdUsed = dealId;
          const verificationFields = scheduleType === "survey"
            ? ["site_survey_schedule_date", "site_surveyor", "site_survey_status"]
            : scheduleType === "installation"
              ? ["install_schedule_date", "construction_scheduled_date", "install_status"]
              : ["inspections_schedule_date", "inspection_scheduled_date", "final_inspection_status"];
          hubspotVerification = await getDealProperties(dealId, verificationFields);
          const verifiedFieldsCleared = scheduleType === "survey"
            ? !!hubspotVerification &&
              isBlank(hubspotVerification.site_survey_schedule_date) &&
              isBlank(hubspotVerification.site_surveyor)
            : scheduleType === "installation"
              ? !!hubspotVerification &&
                isBlank(hubspotVerification.install_schedule_date) &&
                isBlank(hubspotVerification.construction_scheduled_date)
              : !!hubspotVerification &&
                isBlank(hubspotVerification.inspections_schedule_date) &&
                isBlank(hubspotVerification.inspection_scheduled_date);
          if (verifiedFieldsCleared) {
            break;
          }
          if (attempt < MAX_CLEAR_ATTEMPTS) {
            await sleep(450);
          }
        }

        hubspotFieldsCleared = scheduleCleared && surveyorCleared;
        const verifiedFieldsCleared = scheduleType === "survey"
          ? !!hubspotVerification &&
            isBlank(hubspotVerification.site_survey_schedule_date) &&
            isBlank(hubspotVerification.site_surveyor)
          : scheduleType === "installation"
            ? !!hubspotVerification &&
              isBlank(hubspotVerification.install_schedule_date) &&
              isBlank(hubspotVerification.construction_scheduled_date)
            : !!hubspotVerification &&
              isBlank(hubspotVerification.inspections_schedule_date) &&
              isBlank(hubspotVerification.inspection_scheduled_date);
        const verifiedStatus = scheduleType === "survey"
          ? !!hubspotVerification &&
            (hubspotVerification.site_survey_status === "Ready to Schedule" ||
              hubspotVerification.site_survey_status === "Ready To Schedule")
          : scheduleType === "installation"
            ? !!hubspotVerification &&
              (hubspotVerification.install_status === "Ready to Build" ||
                hubspotVerification.install_status === "Ready To Build")
            : !!hubspotVerification &&
              (hubspotVerification.final_inspection_status === "Ready for Inspection" ||
                hubspotVerification.final_inspection_status === "Ready For Inspection");

        hubspotCleared = hubspotFieldsCleared && hubspotStatusUpdated && verifiedFieldsCleared && verifiedStatus;
        if (hubspotCleared) {
          break;
        }
      }

      if (hubspotCleared) {
        console.log(`[Zuper Unschedule] Cleared HubSpot ${scheduleType} fields for deal ${hubspotDealIdUsed}`);
      } else {
        if (!hubspotFieldsCleared) {
          hubspotError = `HubSpot ${scheduleType} schedule fields failed to clear`;
        } else if (!hubspotStatusUpdated) {
          hubspotError = `HubSpot ${scheduleType} status failed to update`;
        } else {
          hubspotError = "HubSpot deal update returned false";
        }
        console.warn(`[Zuper Unschedule] ${hubspotError} for project ${projectId}`);
      }
    } catch (err) {
      hubspotError = err instanceof Error ? err.message : "Unknown HubSpot clear error";
      console.warn(`[Zuper Unschedule] Failed to clear HubSpot properties:`, err);
    }

    // Log the unschedule activity
    try {
      const headersList = await headers();
      const userAgent = headersList.get("user-agent") || undefined;
      const forwarded = headersList.get("x-forwarded-for");
      const ipAddress = forwarded?.split(",")[0]?.trim() || headersList.get("x-real-ip") || undefined;

      await logActivity({
        type: scheduleType === "survey" ? "SURVEY_CANCELLED" : scheduleType === "installation" ? "INSTALL_CANCELLED" : "INSPECTION_CANCELLED",
        description: `Unscheduled ${scheduleType} for ${projectName || projectId}`,
        userId: user.id,
        userEmail: session.user.email,
        entityType: "project",
        entityId: projectId,
        entityName: projectName,
        metadata: {
          zuperJobUid: resolvedJobUid || zuperJobUid,
          zuperCleared,
          hubspotDealIdUsed,
          hubspotFieldsCleared,
          hubspotStatusUpdated,
          hubspotVerification,
          hubspotCleared,
          cancelReason: typeof cancelReason === "string" ? cancelReason : undefined,
          dealOwner: typeof dealOwner === "string" ? dealOwner : undefined,
          assignedUser: latestActiveRecord?.assignedUser || assignedUser || undefined,
        },
        ipAddress,
        userAgent,
      });
    } catch (err) {
      console.error("Failed to log unschedule activity:", err);
    }

    // If a Zuper job was provided but could not be cleared, surface failure
    // so the UI doesn't treat this as a full success.
    if (zuper.isConfigured() && (!zuperCleared || !hubspotCleared)) {
      return NextResponse.json(
        {
          success: false,
          action: "unschedule_partial",
          zuperCleared,
          hubspotDealIdUsed,
          hubspotFieldsCleared,
          hubspotStatusUpdated,
          hubspotVerification,
          hubspotCleared,
          zuperJobUid: resolvedJobUid || null,
          error: !zuperCleared
            ? (zuperError || "Failed to clear schedule in Zuper")
            : (hubspotError || `Failed to clear HubSpot ${scheduleType} schedule fields`),
          message: !zuperCleared
            ? "HubSpot/Zuper unschedule did not fully complete."
            : "Zuper was cleared, but HubSpot fields did not clear.",
        },
        { status: 502 }
      );
    }

    // Mark latest active schedule record as cancelled and persist cancellation reason.
    if (prisma) {
      try {
        const latestRecord = ownership.record?.id
          ? await prisma.scheduleRecord.findUnique({
              where: { id: ownership.record.id },
              select: { id: true, status: true, notes: true },
            })
          : await prisma.scheduleRecord.findFirst({
              where: {
                projectId: String(projectId),
                scheduleType,
                status: { in: ["scheduled", "tentative"] },
              },
              orderBy: { createdAt: "desc" },
              select: { id: true, status: true, notes: true },
            });

        if (latestRecord) {
          const reasonText = typeof cancelReason === "string" ? cancelReason.trim() : "";
          const reasonNote = reasonText ? `[CANCEL_REASON] ${reasonText}` : "";
          const existingNotes = latestRecord.notes?.trim() || "";
          const mergedNotes = reasonNote
            ? (existingNotes ? `${existingNotes}\n${reasonNote}` : reasonNote)
            : existingNotes || null;

          await prisma.scheduleRecord.update({
            where: { id: latestRecord.id },
            data: {
              status: "cancelled",
              notes: mergedNotes,
            },
          });
        }
      } catch (recordErr) {
        console.warn("[Zuper Unschedule] Failed to update schedule record cancellation metadata:", recordErr);
      }
    }

    // Survey cancellations should notify the assigned surveyor.
    try {
      const dealOwnerName = typeof dealOwner === "string" && dealOwner.trim() ? dealOwner.trim() : undefined;
      await sendCrewCancellationEmail({
        scheduleType,
        projectId: String(projectId),
        projectName: typeof projectName === "string" ? projectName : String(projectId),
        projectAddress: typeof projectAddress === "string" ? projectAddress : undefined,
        assignedUser: latestActiveRecord?.assignedUser || (typeof assignedUser === "string" ? assignedUser : undefined),
        assignedUserUid: latestActiveRecord?.assignedUserUid || null,
        scheduledDate: latestActiveRecord?.scheduledDate || (typeof scheduledDate === "string" ? scheduledDate : undefined),
        scheduledStart: latestActiveRecord?.scheduledStart || (typeof scheduledStart === "string" ? scheduledStart : undefined),
        scheduledEnd: latestActiveRecord?.scheduledEnd || (typeof scheduledEnd === "string" ? scheduledEnd : undefined),
        scheduledByName: dealOwnerName || latestActiveRecord?.scheduledBy || ownership.record?.scheduledBy || undefined,
        dealOwnerName,
        cancelledByName: session.user.name || session.user.email,
        cancelledByEmail: session.user.email,
        cancelReason: typeof cancelReason === "string" ? cancelReason : undefined,
      });
    } catch (emailErr) {
      console.warn("[Zuper Unschedule] Failed to send cancellation notification email:", emailErr);
    }

    return NextResponse.json({
      success: true,
      action: "unscheduled",
      zuperCleared,
      hubspotDealIdUsed,
      hubspotFieldsCleared,
      hubspotStatusUpdated,
      hubspotVerification,
      zuperJobUid: resolvedJobUid || null,
      message: `${scheduleType} schedule cleared${zuperCleared ? " (Zuper + HubSpot)" : " (HubSpot only)"}`,
    });
  } catch (error) {
    console.error("Error unscheduling job:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to unschedule job" },
      { status: 500 }
    );
  }
}

/**
 * Helper to log scheduling activities
 */
async function logSchedulingActivity(
  type: "SURVEY_SCHEDULED" | "SURVEY_RESCHEDULED" | "INSTALL_SCHEDULED" | "INSTALL_RESCHEDULED" | "INSPECTION_SCHEDULED" | "INSPECTION_RESCHEDULED",
  description: string,
  project: { id: string; name?: string },
  zuperJobId?: string,
  schedule?: { type: string; date: string; crew?: string; assignedUser?: string }
) {
  try {
    const session = await auth();
    let userId: string | undefined;
    let userEmail: string | undefined;

    if (session?.user?.email) {
      userEmail = session.user.email;
      const user = await getUserByEmail(session.user.email);
      if (user) {
        userId = user.id;
      }
    }

    const headersList = await headers();
    const userAgent = headersList.get("user-agent") || undefined;
    const forwarded = headersList.get("x-forwarded-for");
    const ipAddress = forwarded?.split(",")[0]?.trim() || headersList.get("x-real-ip") || undefined;

    await logActivity({
      type,
      description,
      userId,
      userEmail,
      entityType: "project",
      entityId: project.id,
      entityName: project.name,
      metadata: {
        zuperJobId,
        scheduleType: schedule?.type,
        scheduleDate: schedule?.date,
        crew: schedule?.crew,
        assignedUser: schedule?.assignedUser,
      },
      ipAddress,
      userAgent,
    });
  } catch (err) {
    console.error("Failed to log scheduling activity:", err);
    // Don't throw - logging failures shouldn't break scheduling
  }
}

/**
 * Helper to send notification to assigned crew member
 */
function isUuidLike(value?: string): boolean {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function resolveCrewNotificationRecipient(params: {
  assignedUser?: string;
  assignedUserUid?: string;
  crew?: string;
}): Promise<{ recipientEmail: string | null; recipientName: string }> {
  const assignedUserUid =
    (params.assignedUserUid && isUuidLike(params.assignedUserUid) ? params.assignedUserUid : undefined) ||
    (params.crew && isUuidLike(params.crew) ? params.crew : undefined);

  let recipientEmail: string | null = null;
  let recipientName = params.assignedUser || "";

  if (params.assignedUser) {
    const byName = await getCrewMemberByName(params.assignedUser);
    if (byName?.email) {
      recipientEmail = byName.email;
      recipientName = byName.name;
    }
  }

  if (!recipientEmail && assignedUserUid) {
    const byUid = await getCrewMemberByZuperUserUid(assignedUserUid);
    if (byUid?.email) {
      recipientEmail = byUid.email;
      recipientName = byUid.name;
    }
  }

  if (!recipientEmail && assignedUserUid) {
    const userResult = await zuper.getUser(assignedUserUid);
    if (userResult.type === "success" && userResult.data?.email) {
      recipientEmail = userResult.data.email;
      if (!recipientName) {
        recipientName = [userResult.data.first_name, userResult.data.last_name]
          .filter(Boolean)
          .join(" ")
          .trim() || (params.assignedUser || "");
      }
    }
  }

  return { recipientEmail, recipientName };
}

function deriveCustomerDetails(project: { name?: string; address?: string }): { customerName: string; customerAddress: string } {
  const nameParts = project.name?.split(" | ") || [];
  const customerName = nameParts.length >= 2
    ? nameParts[1]?.trim()
    : nameParts[0]?.trim() || "Customer";
  const customerAddress = nameParts.length >= 3
    ? nameParts[2]?.trim()
    : nameParts.length >= 2 && !nameParts[0].includes("PROJ-")
      ? nameParts[1]?.trim()
      : project.address || "See Zuper for address";

  return { customerName, customerAddress };
}

async function sendCrewNotification(
  schedule: {
    type: string;
    date: string;
    startTime?: string;
    endTime?: string;
    assignedUser?: string;
    crew?: string;
    assignedUserUid?: string;
    timezone?: string;
    notes?: string;
  },
  project: { id: string; name?: string; address?: string; dealOwner?: string },
  schedulerName: string,
  schedulerEmail: string
) {
  try {
    // If no assigned user, skip notification
    if (!schedule.assignedUser) {
      console.log("[Zuper Schedule] No assigned user, skipping notification");
      return;
    }

    const resolvedRecipient = await resolveCrewNotificationRecipient({
      assignedUser: schedule.assignedUser,
      assignedUserUid: schedule.assignedUserUid,
      crew: schedule.crew,
    });
    let recipientEmail = resolvedRecipient.recipientEmail;
    const recipientName = resolvedRecipient.recipientName || schedule.assignedUser;

    if (!recipientEmail) {
      if (!schedulerEmail) {
        console.log(
          `[Zuper Schedule] No email found for assigned surveyor and no fallback recipient: name="${schedule.assignedUser}", uid="${schedule.assignedUserUid || schedule.crew || ""}"`
        );
        return;
      }
      console.log(
        `[Zuper Schedule] No email found for assigned surveyor; falling back to scheduler email: ${schedulerEmail}`
      );
      recipientEmail = schedulerEmail;
    }

    const { customerName, customerAddress } = deriveCustomerDetails(project);

    await sendSchedulingNotification({
      to: recipientEmail,
      crewMemberName: recipientName || schedule.assignedUser,
      scheduledByName: schedulerName,
      scheduledByEmail: schedulerEmail,
      dealOwnerName: project.dealOwner,
      appointmentType: schedule.type as "survey" | "installation" | "inspection",
      customerName,
      customerAddress,
      scheduledDate: schedule.date,
      scheduledStart: schedule.startTime,
      scheduledEnd: schedule.endTime,
      projectId: project.id,
      notes: schedule.notes,
    });

    // Keep surveyor Google Calendar in sync for site surveys.
    if (schedule.type === "survey") {
      const syncResult = await upsertSiteSurveyCalendarEvent({
        surveyorEmail: recipientEmail,
        projectId: project.id,
        projectName: project.name || project.id,
        customerName,
        customerAddress,
        date: schedule.date,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        timezone: schedule.timezone,
        notes: schedule.notes,
      });
      if (!syncResult.success) {
        console.warn(`[Zuper Schedule] Google Calendar sync warning: ${syncResult.error}`);
      }
    }

    console.log(`[Zuper Schedule] Notification sent to ${recipientEmail}`);
  } catch (err) {
    console.error("Failed to send crew notification:", err);
    // Don't throw - notification failures shouldn't break scheduling
  }
}

async function sendCrewCancellationEmail(params: {
  scheduleType: ScheduleType;
  projectId: string;
  projectName?: string;
  projectAddress?: string;
  assignedUser?: string;
  assignedUserUid?: string | null;
  scheduledDate?: string;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  scheduledByName?: string;
  dealOwnerName?: string;
  cancelledByName: string;
  cancelledByEmail: string;
  cancelReason?: string;
}) {
  if (params.scheduleType !== "survey" || !params.assignedUser) {
    return;
  }

  const resolvedRecipient = await resolveCrewNotificationRecipient({
    assignedUser: params.assignedUser,
    assignedUserUid: params.assignedUserUid || undefined,
  });
  let recipientEmail = resolvedRecipient.recipientEmail;
  const recipientName = resolvedRecipient.recipientName || params.assignedUser;

  if (!recipientEmail) {
    if (!params.cancelledByEmail) {
      console.log(
        `[Zuper Unschedule] No email found for assigned surveyor and no fallback recipient: name="${params.assignedUser}", uid="${params.assignedUserUid || ""}"`
      );
      return;
    }
    console.log(
      `[Zuper Unschedule] No email found for assigned surveyor; falling back to canceller email: ${params.cancelledByEmail}`
    );
    recipientEmail = params.cancelledByEmail;
  }

  const { customerName, customerAddress } = deriveCustomerDetails({
    name: params.projectName,
    address: params.projectAddress,
  });

  await sendCancellationNotification({
    to: recipientEmail,
    crewMemberName: recipientName || params.assignedUser,
    cancelledByName: params.cancelledByName,
    cancelledByEmail: params.cancelledByEmail,
    scheduledByName: params.scheduledByName,
    dealOwnerName: params.dealOwnerName,
    appointmentType: params.scheduleType,
    customerName,
    customerAddress,
    scheduledDate: params.scheduledDate,
    scheduledStart: params.scheduledStart || undefined,
    scheduledEnd: params.scheduledEnd || undefined,
    projectId: params.projectId,
    cancelReason: params.cancelReason,
  });

  console.log(`[Zuper Unschedule] Cancellation notification sent to ${recipientEmail}`);
}
