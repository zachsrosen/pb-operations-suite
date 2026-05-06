import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, logActivity, prisma, cacheZuperJob, canScheduleType, getCrewMemberByName, getCrewMemberByZuperUserUid, getCachedZuperJobByDealId, UserRole } from "@/lib/db";
import {
  zuper,
  JOB_CATEGORY_UIDS,
  CONSTRUCTION_CATEGORY_NAMES,
  CONSTRUCTION_CATEGORY_UIDS,
} from "@/lib/zuper";
import { headers } from "next/headers";
import { sendSchedulingNotification } from "@/lib/email";
import { updateDealProperty, updateSiteSurveyorProperty, getDealProperties, getDealOwnerContact, getDealProjectManagerContact } from "@/lib/hubspot";
import {
  upsertSiteSurveyCalendarEvent,
  deleteSiteSurveyCalendarEvent,
  upsertInstallationCalendarEvent,
  getDenverSiteSurveyCalendarId,
  getSharedCalendarImpersonationEmail,
  getInstallCalendarIdForLocation,
  getSurveyCalendarEventId,
  getInstallationCalendarEventId,
} from "@/lib/google-calendar";
import { getBusinessEndDateInclusive, isWeekendDate } from "@/lib/business-days";
import { getInstallNotificationDetails } from "@/lib/scheduling-email-details";
import { getInstallCalendarTimezone, resolveInstallCalendarLocation } from "@/lib/install-calendar-location";
import { getSalesSurveyLeadTimeError, resolveEffectiveRoleFromRequest, resolveEffectiveRolesFromRequest } from "@/lib/scheduling-policy";
import { getGoogleCalendarEventUrl } from "@/lib/external-links";
import { normalizeEmail } from "@/lib/email-utils";
import { waitUntil } from "@vercel/functions";
import { runDesignCompletePipeline } from "@/lib/bom-pipeline";
import { acquirePipelineLock, DuplicateRunError } from "@/lib/bom-pipeline-lock";
import { checkBomSnapshotExists, getBomEmailEnrichment, type BomEmailEnrichment } from "@/lib/bom-email-enrichment";
import { extractInstallerNote, upsertInstallerNoteInBlob, MAX_INSTALLER_NOTE_LENGTH } from "@/lib/schedule-notes";
import { createAutomatedBugReport } from "@/lib/automated-bug-reports";
import {
  type SurveyorInfo,
  mergeSurveyorInfo,
  sendSurveyReassignmentNotifications,
} from "@/lib/survey-reassignment-notifications";

type ZuperUserLookupResult = Awaited<ReturnType<typeof zuper.getUser>>;

type ScheduleType = "survey" | "pre-sale-survey" | "installation" | "inspection";

function isSurveyLike(type: string): type is "survey" | "pre-sale-survey" {
  return type === "survey" || type === "pre-sale-survey";
}

function getCategoryNameForScheduleType(type: ScheduleType): string {
  if (type === "pre-sale-survey") return "Pre-Sale Site Visit";
  if (type === "installation") return "Construction";
  if (type === "inspection") return "Inspection";
  return "Site Survey";
}

function getCategoryUidForScheduleType(type: ScheduleType): string {
  if (type === "pre-sale-survey") return JOB_CATEGORY_UIDS.PRE_SALE_SITE_VISIT;
  if (type === "installation") return JOB_CATEGORY_UIDS.CONSTRUCTION;
  if (type === "inspection") return JOB_CATEGORY_UIDS.INSPECTION;
  return JOB_CATEGORY_UIDS.SITE_SURVEY;
}

async function getCachedZuperUser(
  userUid: string,
  cache: Map<string, ZuperUserLookupResult>
): Promise<ZuperUserLookupResult> {
  const cached = cache.get(userUid);
  if (cached) {
    return cached;
  }

  const result = await zuper.getUser(userUid);
  cache.set(userUid, result);
  return result;
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

function getSchedulerPageUrl(scheduleType: ScheduleType): string {
  if (scheduleType === "installation") return "/dashboards/scheduler";
  if (scheduleType === "inspection") return "/dashboards/inspection-scheduler";
  return "/dashboards/site-survey-scheduler";
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

function isNickSurveyorEmail(email?: string | null): boolean {
  const normalized = normalizeEmail(email);
  return normalized === "nick.scarpellino@photonbrothers.com" || normalized === "nick@photonbrothers.com";
}

function getNickSiteSurveyCalendarId(): string | null {
  return (
    (process.env.GOOGLE_SITE_SURVEY_NICK_CALENDAR_ID || "").trim() ||
    (process.env.GOOGLE_NICK_SITE_SURVEY_CALENDAR_ID || "").trim() ||
    null
  );
}

function getSiteSurveySharedCalendarIdForSurveyor(email?: string | null): string | null {
  if (isNickSurveyorEmail(email)) {
    return getNickSiteSurveyCalendarId() || getDenverSiteSurveyCalendarId();
  }
  return getDenverSiteSurveyCalendarId();
}

function getSiteSurveySharedCalendarImpersonationEmail(email?: string | null): string | null {
  if (isNickSurveyorEmail(email)) {
    return normalizeEmail(email) || getSharedCalendarImpersonationEmail();
  }
  return getSharedCalendarImpersonationEmail() || normalizeEmail(email);
}

// extractInstallerNote imported from @/lib/schedule-notes

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

/**
 * POST /api/zuper/jobs/schedule/confirm
 *
 * Confirms a local-held schedule by syncing it to Zuper.
 * Takes a scheduleRecordId, fetches the tentative/pending-Zuper record,
 * then runs the full Zuper scheduling flow (search/create/reschedule).
 */
export async function POST(request: NextRequest) {
  try {
    const zuperUserCache = new Map<string, ZuperUserLookupResult>();
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }
    const userRolesForPolicy: UserRole[] = user.roles ?? [];
    const effectiveRole = resolveEffectiveRoleFromRequest(request, userRolesForPolicy[0] as UserRole);

    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const body = await request.json();
    const scheduleRecordId = typeof body?.scheduleRecordId === "string" ? body.scheduleRecordId : "";
    const hintedZuperJobUid = typeof body?.zuperJobUid === "string" ? body.zuperJobUid.trim() : "";
    const additionalNotes = typeof body?.additionalNotes === "string"
      ? body.additionalNotes.trim().slice(0, MAX_INSTALLER_NOTE_LENGTH)
      : "";
    const schedulerEmail = session.user.email;

    if (!scheduleRecordId) {
      return NextResponse.json(
        { error: "scheduleRecordId is required" },
        { status: 400 }
      );
    }

    // Fetch the local-held record
    const record = await prisma.scheduleRecord.findUnique({
      where: { id: scheduleRecordId },
    });

    if (!record) {
      return NextResponse.json({ error: "Schedule record not found" }, { status: 404 });
    }

    if (!["tentative", "pending_zuper"].includes(record.status)) {
      return NextResponse.json(
        { error: `Record is not tentative or pending Zuper (current status: ${record.status})` },
        { status: 400 }
      );
    }
    const originalStatus = record.status;
    if (isWeekendDate(record.scheduledDate)) {
      return NextResponse.json(
        { error: "Cannot confirm a weekend schedule. Please move it to a weekday first." },
        { status: 400 }
      );
    }

    // Check schedule type permission
    const normalizedScheduleType = String(record.scheduleType || "").toLowerCase();
    const scheduleType = (
      normalizedScheduleType === "construction"
        ? "installation"
        : normalizedScheduleType
    ) as ScheduleType;
    if (!["survey", "pre-sale-survey", "installation", "inspection"].includes(scheduleType)) {
      return NextResponse.json(
        { error: `Unsupported schedule type on record: ${record.scheduleType}` },
        { status: 400 }
      );
    }
    if (!canScheduleType(effectiveRole, scheduleType)) {
      return NextResponse.json(
        { error: `You don't have permission to schedule ${scheduleType}s.` },
        { status: 403 }
      );
    }

    // Compute effective notes: upsert additionalNotes into the blob if provided
    // Only allow installer notes on installation types (not survey/inspection)
    const effectiveNotes =
      additionalNotes && scheduleType === "installation"
        ? upsertInstallerNoteInBlob(record.notes, additionalNotes)
        : (record.notes || "");

    // If additionalNotes were provided, persist them now so they survive even if
    // Zuper sync fails and the record stays tentative.
    if (additionalNotes && scheduleType === "installation" && effectiveNotes !== record.notes) {
      await prisma.scheduleRecord.update({
        where: { id: scheduleRecordId },
        data: { notes: effectiveNotes },
      });
    }

    const timezoneFromNotes = effectiveNotes?.match(/\[TZ:([A-Za-z_\/]+)\]/)?.[1];
    const effectiveRoles = resolveEffectiveRolesFromRequest(request, userRolesForPolicy);
    const salesLeadTimeError = getSalesSurveyLeadTimeError({
      roles: effectiveRoles,
      scheduleType,
      scheduleDate: record.scheduledDate,
      timezone: timezoneFromNotes,
    });
    if (salesLeadTimeError) {
      return NextResponse.json({ error: salesLeadTimeError }, { status: 403 });
    }

    // Check if Zuper is configured
    if (!zuper.isConfigured()) {
      return NextResponse.json(
        { error: "Zuper integration not configured" },
        { status: 503 }
      );
    }

    // Parse project name details used by matching and notifications.
    const projectNameParts = record.projectName.split(" | ");

    // Resolve assignment UIDs from record data so tentative confirms can still
    // assign when only a crew name was stored (e.g. test-slot workflows).
    const isUuid = (value?: string | null) =>
      !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    const desiredAssigneeName = record.assignedUser?.trim() || "";
    const resolvedUserUids = record.assignedUserUid
      ? record.assignedUserUid.split(",").map((u) => u.trim()).filter(Boolean)
      : [];
    let resolvedTeamUid = record.assignedTeamUid || undefined;

    if (resolvedUserUids.length === 0 && desiredAssigneeName) {
      if (isUuid(desiredAssigneeName)) {
        resolvedUserUids.push(desiredAssigneeName);
      } else {
        const crewMember = await getCrewMemberByName(desiredAssigneeName);
        if (crewMember?.zuperUserUid) {
          resolvedUserUids.push(crewMember.zuperUserUid);
          if (crewMember.zuperTeamUid) {
            resolvedTeamUid = crewMember.zuperTeamUid;
          }
        } else {
          const resolved = await zuper.resolveUserUid(desiredAssigneeName);
          if (resolved?.userUid) {
            resolvedUserUids.push(resolved.userUid);
            if (resolved.teamUid) {
              resolvedTeamUid = resolved.teamUid;
            }
          }
        }
      }
    }

    if (desiredAssigneeName && resolvedUserUids.length === 0) {
      return NextResponse.json(
        { error: `Could not resolve Zuper user for assignee "${desiredAssigneeName}".` },
        { status: 422 }
      );
    }

    const timezoneFromNotes2 = effectiveNotes?.match(/\[TZ:([A-Za-z_\/]+)\]/)?.[1];
    const inferredTimezone = /\b(San Luis Obispo|Camarillo)\b|,\s*CA\b/i.test(record.projectName)
      ? "America/Los_Angeles"
      : "America/Denver";
    const slotTimezone = timezoneFromNotes2 || inferredTimezone;

    const reportZuperConfirmFailure = async (errorMessage: string) => {
      await createAutomatedBugReport({
        title: `Zuper retry sync failed: ${scheduleType} ${record.projectId}`,
        description: [
          "Automated bug report from Retry Zuper Sync.",
          "",
          `Original status: ${originalStatus}`,
          `Deal ID: ${record.projectId}`,
          `Deal name: ${record.projectName}`,
          `Schedule type: ${scheduleType}`,
          `Requested date: ${record.scheduledDate}`,
          record.scheduledStart ? `Requested start: ${record.scheduledStart}` : null,
          record.scheduledEnd ? `Requested end: ${record.scheduledEnd}` : null,
          record.assignedUser ? `Assignee: ${record.assignedUser}` : null,
          hintedZuperJobUid ? `Hinted Zuper job UID: ${hintedZuperJobUid}` : null,
          record.zuperJobUid ? `Record Zuper job UID: ${record.zuperJobUid}` : null,
          `Error: ${errorMessage}`,
        ].filter(Boolean).join("\n"),
        pageUrl: getSchedulerPageUrl(scheduleType),
        reporterEmail: schedulerEmail,
        reporterName: session.user.name || undefined,
        entityId: record.projectId,
        entityName: record.projectName,
        metadata: {
          source: "zuper_retry_sync",
          scheduleType,
          originalStatus,
          projectId: record.projectId,
          scheduleRecordId,
        },
        ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
        userAgent: request.headers.get("user-agent") || undefined,
      });
    };

    const localToUtc = (dateStr: string, timeStr: string): string => {
      const [year, month, day] = dateStr.split("-").map(Number);
      const [hours, minutes] = (timeStr + ":00").split(":").map(Number);

      const testDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      const localFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: slotTimezone,
        timeZoneName: "longOffset",
      });
      const parts = localFormatter.formatToParts(testDate);
      const tzOffsetStr = parts.find((p) => p.type === "timeZoneName")?.value || "";
      const offsetMatch = tzOffsetStr.match(/GMT([+-])(\d{2}):(\d{2})/);
      let offsetHours: number;
      if (offsetMatch) {
        const sign = offsetMatch[1] === "-" ? 1 : -1;
        offsetHours = sign * parseInt(offsetMatch[2], 10);
      } else {
        const shortFormatter = new Intl.DateTimeFormat("en-US", {
          timeZone: slotTimezone,
          timeZoneName: "short",
        });
        const shortParts = shortFormatter.formatToParts(testDate);
        const shortTzName = shortParts.find((p) => p.type === "timeZoneName")?.value || "";
        const tzOffsets: Record<string, number> = {
          MST: 7, MDT: 6, PST: 8, PDT: 7, CST: 6, CDT: 5, EST: 5, EDT: 4,
        };
        offsetHours = tzOffsets[shortTzName] || 7;
      }

      let utcHours = hours + offsetHours;
      let utcDay = day;
      let utcMonth = month;
      let utcYear = year;
      if (utcHours >= 24) {
        utcHours -= 24;
        utcDay += 1;
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

      return `${utcYear}-${String(utcMonth).padStart(2, "0")}-${String(utcDay).padStart(2, "0")} ${String(utcHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
    };

    // Run the Zuper scheduling flow: search for existing job -> create or reschedule
    const hubspotTag = `hubspot-${record.projectId}`;

    // Extract search terms from the project name
    const nameParts = projectNameParts;
    const customerLastName = nameParts.length >= 2
      ? nameParts[1]?.split(",")[0]?.trim() || ""
      : nameParts[0]?.split(",")[0]?.trim() || "";
    const projNumber = nameParts[0]?.trim().match(/PROJ-\d+/i)?.[0] || "";

    let zuperJobUid: string | undefined;
    let zuperError: string | undefined;
    let zuperNoteWarning: string | undefined;
    let startDateTimeForHubSpot: string | undefined;
    let endDateTimeForHubSpot: string | undefined;
    let boundaryStartDateForHubSpot: string | undefined;
    let boundaryEndDateForHubSpot: string | undefined;
    let previousSurveyorFromJob: SurveyorInfo | null = null;
    let confirmedAssignedUserName = record.assignedUser || undefined;
    let confirmedAssignedUserUid = resolvedUserUids[0] || record.assignedUserUid || undefined;
    let confirmedAssignedTeamUid = resolvedTeamUid || record.assignedTeamUid || undefined;
    let confirmedZuperAssigned = resolvedUserUids.length > 0 || !!record.assignedUserUid;

    try {
      // Category config for matching
      const categoryConfig: Record<string, { name: string; uid: string }> = {
        survey: { name: getCategoryNameForScheduleType("survey"), uid: getCategoryUidForScheduleType("survey") },
        "pre-sale-survey": { name: getCategoryNameForScheduleType("pre-sale-survey"), uid: getCategoryUidForScheduleType("pre-sale-survey") },
        installation: { name: getCategoryNameForScheduleType("installation"), uid: getCategoryUidForScheduleType("installation") },
        inspection: { name: getCategoryNameForScheduleType("inspection"), uid: getCategoryUidForScheduleType("inspection") },
      };
      const targetCategoryName = categoryConfig[scheduleType].name;
      const targetCategoryUid = categoryConfig[scheduleType].uid;
      const targetCategoryNameLower = targetCategoryName.toLowerCase();
      const hubspotTagLower = hubspotTag.toLowerCase();

      // Construction job split: when confirming an installation, accept any of
      // the four construction sub-categories (legacy "Construction" +
      // Solar/Battery/EV split jobs created by the HubSpot workflow).
      const isInstallationConfirm = scheduleType === "installation";
      const acceptedCategoryNamesLower = isInstallationConfirm
        ? CONSTRUCTION_CATEGORY_NAMES.map((n) => n.toLowerCase())
        : [targetCategoryNameLower];
      const acceptedCategoryUids = isInstallationConfirm
        ? CONSTRUCTION_CATEGORY_UIDS.filter(Boolean)
        : [targetCategoryUid].filter(Boolean);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const categoryMatches = (job: any): boolean => {
        if (typeof job.job_category === "string") {
          const categoryValue = job.job_category.toLowerCase();
          return (
            acceptedCategoryNamesLower.includes(categoryValue) ||
            acceptedCategoryNamesLower.some((n) => categoryValue.includes(n)) ||
            acceptedCategoryUids.includes(job.job_category)
          );
        }
        const categoryName = String(job.job_category?.category_name || "").toLowerCase();
        const categoryUid = String(job.job_category?.category_uid || "");
        return (
          acceptedCategoryNamesLower.includes(categoryName) ||
          acceptedCategoryNamesLower.some((n) => n !== "" && categoryName.includes(n)) ||
          (categoryUid !== "" && acceptedCategoryUids.includes(categoryUid))
        );
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getHubSpotDealId = (job: any): string | null => {
        const customFields =
          (job?.custom_fields as Array<{ label?: string; name?: string; value?: string }> | undefined) || [];
        const dealIdField = customFields.find((field) => {
          const label = (field.label || "").toLowerCase();
          const name = (field.name || "").toLowerCase();
          return label === "hubspot deal id" ||
            label === "hubspot_deal_id" ||
            name === "hubspot deal id" ||
            name === "hubspot_deal_id";
        });
        if (dealIdField?.value) return String(dealIdField.value);
        return null;
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let existingJob: any = null;

      // Strategy 1: use UID provided by the client modal link (if present),
      // then persisted UID on the tentative record.
      if (hintedZuperJobUid) {
        existingJob = { job_uid: hintedZuperJobUid };
      } else if (record.zuperJobUid) {
        existingJob = { job_uid: record.zuperJobUid };
      }

      // Strategy 2: DB cache lookup.
      if (!existingJob) {
        const cacheLookupCategory = isInstallationConfirm
          ? [...CONSTRUCTION_CATEGORY_NAMES]
          : targetCategoryName;
        const cached = await getCachedZuperJobByDealId(record.projectId, cacheLookupCategory);
        if (cached?.jobUid) {
          existingJob = { job_uid: cached.jobUid };
        }
      }

      // Strategy 3: robust API search (name + broad range), matching by
      // HubSpot deal ID custom field, tags, PROJ number, then title.
      if (!existingJob) {
        const [nameSearch, broadSearch] = await Promise.all([
          customerLastName
            ? zuper.searchJobs({ limit: 100, search: customerLastName })
            : Promise.resolve({ type: "success" as const, data: { jobs: [] } }),
          zuper.searchJobs({
            limit: 500,
            from_date: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
            to_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
          }),
        ]);

        const allJobs = new Map<string, unknown>();
        for (const result of [nameSearch, broadSearch]) {
          if (result.type === "success" && result.data?.jobs) {
            for (const job of result.data.jobs) {
              if (job?.job_uid && !allJobs.has(job.job_uid)) {
                allJobs.set(job.job_uid, job);
              }
            }
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const categoryJobs = [...allJobs.values()].filter((job: any) => categoryMatches(job));
        const normalizedLastName = customerLastName.toLowerCase().trim();
        const normalizedProjNumber = projNumber.toLowerCase().trim();

        existingJob = categoryJobs.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (job: any) => getHubSpotDealId(job) === record.projectId
        );

        if (!existingJob) {
          existingJob = categoryJobs.find(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (job: any) => job.job_tags?.some((tag: string) => tag.toLowerCase() === hubspotTagLower)
          );
        }

        if (!existingJob && normalizedProjNumber) {
          existingJob = categoryJobs.find(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (job: any) => job.job_tags?.some((tag: string) => tag.toLowerCase() === normalizedProjNumber)
          );
        }

        if (!existingJob && normalizedProjNumber) {
          existingJob = categoryJobs.find(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (job: any) => String(job.job_title || "").toLowerCase().includes(normalizedProjNumber)
          );
        }

        if (!existingJob && normalizedLastName.length > 2) {
          existingJob = categoryJobs.find((job: unknown) => {
            const title = String((job as { job_title?: string }).job_title || "").toLowerCase();
            return title.includes(`${normalizedLastName},`) || title.startsWith(`${normalizedLastName} `);
          });
        }
      }

      if (existingJob) {
        // Try matching by HubSpot tag first
        console.log(`[Zuper Confirm] Found existing ${scheduleType} job for ${record.projectId}: ${existingJob.job_uid}`);
      }

      // Calculate schedule times
      const startTime = record.scheduledStart || "08:00";
      const endTime = record.scheduledEnd || "16:00";
      const startDateTime = localToUtc(record.scheduledDate, startTime);
      let endDateForSchedule = record.scheduledDate;
      if (scheduleType === "installation") {
        endDateForSchedule = getBusinessEndDateInclusive(record.scheduledDate, record.scheduledDays || 1);
      }
      const endDateTime = localToUtc(endDateForSchedule, endTime);
      startDateTimeForHubSpot = startDateTime;
      endDateTimeForHubSpot = endDateTime;
      boundaryStartDateForHubSpot = record.scheduledDate;
      boundaryEndDateForHubSpot = endDateForSchedule;

      if (existingJob?.job_uid) {
        if (isSurveyLike(scheduleType)) {
          const existingJobResult = await zuper.getJob(existingJob.job_uid);
          if (existingJobResult.type === "success" && existingJobResult.data) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const assignedUser = (existingJobResult.data as any)?.assigned_to?.[0]?.user;
            previousSurveyorFromJob = {
              email: normalizeEmail(assignedUser?.email),
              name: [assignedUser?.first_name, assignedUser?.last_name].filter(Boolean).join(" ").trim() || null,
              uid: (assignedUser?.user_uid || "").trim() || null,
            };

            const assignedUid = (assignedUser?.user_uid || "").trim();
            if ((!previousSurveyorFromJob?.email || !previousSurveyorFromJob?.name) && assignedUid) {
              const byUid = await getCrewMemberByZuperUserUid(assignedUid);
              previousSurveyorFromJob = mergeSurveyorInfo(previousSurveyorFromJob, {
                email: normalizeEmail(byUid?.email),
                name: byUid?.name || null,
                uid: assignedUid,
              });
            }
            if ((!previousSurveyorFromJob?.email || !previousSurveyorFromJob?.name) && assignedUid) {
              const userResult = await getCachedZuperUser(assignedUid, zuperUserCache);
              if (userResult.type === "success") {
                previousSurveyorFromJob = mergeSurveyorInfo(previousSurveyorFromJob, {
                  email: normalizeEmail(userResult.data?.email),
                  name: [userResult.data?.first_name, userResult.data?.last_name].filter(Boolean).join(" ").trim() || null,
                  uid: assignedUid,
                });
              }
            }
          }
        }

        // Reschedule existing job
        const rescheduleResult = await zuper.rescheduleJob(
          existingJob.job_uid,
          startDateTime,
          endDateTime,
          resolvedUserUids.length > 0 ? resolvedUserUids : undefined,
          resolvedTeamUid
        );

        if (rescheduleResult.type === "success") {
          zuperJobUid = existingJob.job_uid;
          const confirmedJobResult = await zuper.getJob(existingJob.job_uid);
          if (confirmedJobResult.type === "success" && confirmedJobResult.data) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const assignedEntries = ((confirmedJobResult.data as any)?.assigned_to || []) as Array<any>;
            const preferredAssignment =
              assignedEntries.find((entry) => entry?.is_primary) ||
              assignedEntries[0];
            const confirmedUser = preferredAssignment?.user;
            const confirmedTeam = preferredAssignment?.team;
            const liveAssignedUserUid = String(confirmedUser?.user_uid || "").trim();
            const liveAssignedTeamUid = String(confirmedTeam?.team_uid || "").trim();
            const liveAssignedUserName = [confirmedUser?.first_name, confirmedUser?.last_name]
              .filter(Boolean)
              .join(" ")
              .trim();

            if (liveAssignedUserName) confirmedAssignedUserName = liveAssignedUserName;
            if (liveAssignedUserUid) confirmedAssignedUserUid = liveAssignedUserUid;
            if (liveAssignedTeamUid) confirmedAssignedTeamUid = liveAssignedTeamUid;
            confirmedZuperAssigned = assignedEntries.length > 0;
          }
          if (scheduleType === "installation") {
            const installerNote = extractInstallerNote(effectiveNotes);
            if (installerNote) {
              const appendResult = await zuper.appendJobNote(
                existingJob.job_uid,
                `Installer Notes: ${installerNote}`
              );
              if (appendResult.type === "error") {
                zuperNoteWarning = appendResult.error || "Failed to append installer notes to Zuper job";
                console.warn(`[Zuper Confirm] ${zuperNoteWarning}`);
              }
            }
          }

          // --- Reschedule sibling construction sub-jobs (same deal, same dates/crew) ---
          // Looks up the primary job's Zuper customer, then finds all other construction
          // jobs for that customer and reschedules + status-updates each one.
          if (isInstallationConfirm) {
            try {
              // Get the primary job to find its customer_uid
              const primaryJobResult = await zuper.getJob(existingJob.job_uid);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const primaryJobData = primaryJobResult.type === "success" ? (primaryJobResult.data as any) : null;
              const customerUid = primaryJobData?.customer_uid || primaryJobData?.customer?.customer_uid;

              if (customerUid) {
                const custJobsResult = await zuper.searchJobs({ customer_uid: customerUid, limit: 100 });
                const siblingJobs: Array<{ jobUid: string; category: string; title: string }> = [];

                if (custJobsResult.type === "success" && custJobsResult.data?.jobs) {
                  for (const job of custJobsResult.data.jobs) {
                    if (!job.job_uid || job.job_uid === existingJob.job_uid) continue;
                    if (!categoryMatches(job)) continue;
                    const sibDealId = getHubSpotDealId(job);
                    if (sibDealId !== record.projectId) continue;
                    const catName = typeof job.job_category === "string"
                      ? job.job_category
                      : job.job_category?.category_name || "unknown";
                    siblingJobs.push({ jobUid: job.job_uid, category: catName, title: job.job_title || "" });
                  }
                }

                if (siblingJobs.length > 0) {
                  console.log(`[Zuper Confirm] Found ${siblingJobs.length} sibling construction job(s) via customer ${customerUid}`);
                  for (const sibling of siblingJobs) {
                    try {
                      const sibResult = await zuper.rescheduleJob(
                        sibling.jobUid,
                        startDateTime,
                        endDateTime,
                        resolvedUserUids.length > 0 ? resolvedUserUids : undefined,
                        resolvedTeamUid
                      );
                      if (sibResult.type === "success") {
                        console.log(`[Zuper Confirm] Sibling ${sibling.category} (${sibling.jobUid}) rescheduled OK`);
                        // Update Zuper job status to "Scheduled"
                        try {
                          const sibJobResult = await zuper.getJob(sibling.jobUid);
                          if (sibJobResult.type === "success" && sibJobResult.data) {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const sibJobData = sibJobResult.data as any;
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const scheduledStatusUid = (sibJobData?.job_status || []).find((s: any) => {
                              const name = String(s?.status_name || "").toLowerCase();
                              return name === "scheduled" && !!s?.status_uid;
                            })?.status_uid as string | undefined;
                            if (scheduledStatusUid) {
                              const statusResult = await zuper.updateJobStatusByUid(sibling.jobUid, scheduledStatusUid);
                              if (statusResult.type === "success") {
                                console.log(`[Zuper Confirm] Sibling ${sibling.category} (${sibling.jobUid}) status → Scheduled`);
                              } else {
                                console.warn(`[Zuper Confirm] Sibling ${sibling.jobUid} status update failed:`, statusResult.error);
                              }
                            }
                          }
                        } catch (statusErr) {
                          console.warn(`[Zuper Confirm] Sibling ${sibling.jobUid} status update error:`, statusErr);
                        }
                        await cacheZuperJob({
                          jobUid: sibling.jobUid,
                          jobTitle: sibling.title,
                          jobCategory: sibling.category,
                          jobStatus: "SCHEDULED",
                          hubspotDealId: record.projectId,
                          projectName: record.projectName,
                          scheduledStart: startDateTime ? new Date(startDateTime.replace(" ", "T") + "Z") : undefined,
                          scheduledEnd: endDateTime ? new Date(endDateTime.replace(" ", "T") + "Z") : undefined,
                        });
                        await logActivity({
                          type: "INSTALL_RESCHEDULED",
                          description: `Sibling ${sibling.category} job rescheduled (cascade) for ${record.projectName}`,
                          userEmail: session.user.email,
                          userName: session.user.name || undefined,
                          entityType: "project",
                          entityId: record.projectId,
                          entityName: record.projectName,
                          metadata: {
                            zuperJobId: sibling.jobUid,
                            siblingCascade: true,
                            scheduleType: "installation",
                            category: sibling.category,
                          },
                        });
                      } else {
                        console.warn(`[Zuper Confirm] Sibling ${sibling.category} (${sibling.jobUid}) reschedule failed`);
                      }
                    } catch (sibErr) {
                      console.warn(`[Zuper Confirm] Sibling ${sibling.jobUid} error:`, sibErr);
                    }
                  }
                }
              } else {
                console.warn(`[Zuper Confirm] No customer_uid found on primary job ${existingJob.job_uid} — cannot look up siblings`);
              }
            } catch (sibLookupErr) {
              console.warn("[Zuper Confirm] Failed to look up sibling construction jobs:", sibLookupErr);
            }
          }
        } else {
          zuperError = rescheduleResult.error;
        }
      } else {
        zuperError = `No existing ${scheduleType} job found in Zuper for "${record.projectName}".`;
      }
    } catch (zuperErr) {
      zuperError = String(zuperErr);
    }

    // If Zuper sync failed, keep this in its original local-held state so the
    // UI does not treat it as confirmed.
    if (zuperError) {
      await prisma.scheduleRecord.update({
        where: { id: scheduleRecordId },
        data: {
          status: originalStatus,
          zuperSynced: false,
          zuperError,
        },
      });

      await reportZuperConfirmFailure(zuperError);

      return NextResponse.json(
        {
          success: false,
          confirmed: false,
          zuperSynced: false,
          zuperError,
          error: `Failed to sync confirmation to Zuper: ${zuperError}`,
        },
        { status: 502 }
      );
    }

    // Update the schedule record only after successful Zuper sync.
    await prisma.scheduleRecord.update({
      where: { id: scheduleRecordId },
      data: {
        status: "scheduled",
        zuperSynced: true,
        zuperJobUid: zuperJobUid || undefined,
        assignedUser: confirmedAssignedUserName,
        assignedUserUid: confirmedAssignedUserUid || null,
        assignedTeamUid: confirmedAssignedTeamUid || null,
        zuperAssigned: confirmedZuperAssigned,
        zuperError: null,
        notes: effectiveNotes
          ? effectiveNotes.replace("[TENTATIVE]", "[CONFIRMED]").replace("[PENDING_ZUPER]", "[CONFIRMED]")
          : "[CONFIRMED]",
      },
    });

    // Cancel any older local-held records for the same project/type so stale
    // tentative/pending dates cannot rehydrate after a successful confirmation.
    await prisma.scheduleRecord.updateMany({
      where: {
        projectId: record.projectId,
        scheduleType,
        status: { in: ["tentative", "pending_zuper"] },
        id: { not: scheduleRecordId },
      },
      data: {
        status: "cancelled",
      },
    });
    await prisma.bookedSlot.deleteMany({
      where: {
        projectId: record.projectId,
        source: { in: ["tentative", "pending_zuper"] },
      },
    });

    // Cache the Zuper job if created
    if (zuperJobUid) {
      await cacheZuperJob({
        jobUid: zuperJobUid,
        jobTitle: `${scheduleType} - ${record.projectName}`,
        jobCategory: getCategoryNameForScheduleType(scheduleType),
        jobStatus: "SCHEDULED",
        hubspotDealId: record.projectId,
        projectName: record.projectName,
      });
    }

    // Update HubSpot deal with schedule date + surveyor and verify persistence.
    const hubspotWarnings: string[] = [];
    try {
      let hubspotUpdate: Record<string, string | null>;
      if (isSurveyLike(scheduleType)) {
        hubspotUpdate = {
          site_survey_schedule_date: record.scheduledDate,
        };
      } else if (scheduleType === "installation") {
        hubspotUpdate = {
          install_schedule_date: record.scheduledDate,
          construction_scheduled_date: record.scheduledDate,
        };
      } else {
        hubspotUpdate = {
          inspections_schedule_date: record.scheduledDate,
          inspection_scheduled_date: record.scheduledDate,
        };
      }
      const dateUpdated = await updateDealProperty(record.projectId, hubspotUpdate);
      if (!dateUpdated) {
        hubspotWarnings.push("HubSpot schedule date write failed");
      }
      if (isSurveyLike(scheduleType) && record.assignedUser?.trim()) {
        const surveyorUpdated = await updateSiteSurveyorProperty(record.projectId, record.assignedUser.trim());
        if (!surveyorUpdated) {
          hubspotWarnings.push(`HubSpot site_surveyor write failed (${record.assignedUser})`);
        }
      }
      if (scheduleType === "installation" && startDateTimeForHubSpot && endDateTimeForHubSpot) {
        const boundaryWarnings = await writeConstructionScheduleBoundaryProperties(
          record.projectId,
          startDateTimeForHubSpot,
          endDateTimeForHubSpot,
          boundaryStartDateForHubSpot,
          boundaryEndDateForHubSpot
        );
        hubspotWarnings.push(...boundaryWarnings);
      }
      const verificationFields =
        isSurveyLike(scheduleType)
          ? ["site_survey_schedule_date", "site_surveyor"]
          : scheduleType === "installation"
            ? ["install_schedule_date", "construction_scheduled_date"]
            : ["inspections_schedule_date", "inspection_scheduled_date"];
      const verifyProps = await getDealProperties(record.projectId, verificationFields);
      if (!verifyProps) {
        hubspotWarnings.push("HubSpot verification read failed");
      } else {
        const dateValues =
          isSurveyLike(scheduleType)
            ? [verifyProps.site_survey_schedule_date]
            : scheduleType === "installation"
              ? [verifyProps.install_schedule_date, verifyProps.construction_scheduled_date]
              : [verifyProps.inspections_schedule_date, verifyProps.inspection_scheduled_date];
        const dateMatched = dateValues.some((v) => String(v || "") === record.scheduledDate);
        if (!dateMatched) {
          hubspotWarnings.push(`HubSpot schedule date verification failed (expected ${record.scheduledDate})`);
        }
        if (isSurveyLike(scheduleType) && record.assignedUser?.trim()) {
          const surveyorRaw = String(verifyProps.site_surveyor || "").trim().toLowerCase();
          if (!surveyorRaw || surveyorRaw === "null" || surveyorRaw === "undefined") {
            hubspotWarnings.push("HubSpot site_surveyor verification failed (still blank)");
          }
        }
      }
    } catch (hubspotErr) {
      console.warn("Failed to update HubSpot deal:", hubspotErr);
      hubspotWarnings.push("HubSpot update threw an error");
    }

    // Send notification to assigned crew member (fire and forget)
    try {
      if (record.assignedUser) {
        const isUuid = (value?: string | null) =>
          !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
        const firstAssignedUid = record.assignedUserUid
          ?.split(",")
          .map((u) => u.trim())
          .find((u) => isUuid(u));

        let recipientEmail: string | null = null;
        let recipientName = record.assignedUser;
        let usedSchedulerFallback = false;

        if (firstAssignedUid) {
          const userResult = await getCachedZuperUser(firstAssignedUid, zuperUserCache);
          if (userResult.type === "success") {
            const liveEmail = normalizeEmail(userResult.data?.email);
            if (liveEmail) {
              recipientEmail = liveEmail;
            }
            const liveName = [userResult.data?.first_name, userResult.data?.last_name]
              .filter(Boolean)
              .join(" ")
              .trim();
            if (liveName) {
              recipientName = liveName;
            }
          }
        }

        if (!recipientEmail && firstAssignedUid) {
          const byUid = await getCrewMemberByZuperUserUid(firstAssignedUid);
          const byUidEmail = normalizeEmail(byUid?.email);
          if (byUidEmail) {
            recipientEmail = byUidEmail;
            recipientName = byUid?.name || recipientName;
          }
        }

        if (!recipientEmail) {
          const byName = await getCrewMemberByName(record.assignedUser);
          const byNameEmail = normalizeEmail(byName?.email);
          if (byNameEmail) {
            recipientEmail = byNameEmail;
            recipientName = byName?.name || recipientName;
          }
        }

        // Fallback: support tentative assignees that are app users by name
        // (not present in CrewMember), e.g. internal/admin test scheduling.
        if (!recipientEmail) {
          const byAppUserName = await prisma.user.findFirst({
            where: { name: record.assignedUser },
            select: { email: true, name: true },
          });
          const byAppUserEmail = normalizeEmail(byAppUserName?.email);
          if (byAppUserEmail) {
            recipientEmail = byAppUserEmail;
            recipientName = byAppUserName?.name || recipientName;
          }
        }

        if (!recipientEmail && session.user.email) {
          console.warn(
            `[Zuper Confirm] No email found for assigned surveyor; falling back to scheduler email: ${session.user.email}`
          );
          recipientEmail = session.user.email;
          usedSchedulerFallback = true;
          if (!recipientName) {
            recipientName = session.user.name || session.user.email;
          }
        }

        const customerNameParts = record.projectName.split(" | ");
        const customerName = customerNameParts.length >= 2
          ? customerNameParts[1]?.trim()
          : customerNameParts[0]?.trim() || "Customer";
        const customerAddress = customerNameParts.length >= 3
          ? customerNameParts[2]?.trim()
          : "See Zuper for address";

        // Fetch project manager + install details before email/calendar blocks
        let dealOwnerName: string | null = null;
        let projectManagerName: string | null = null;
        if (isSurveyLike(scheduleType)) {
          try {
            const owner = await getDealOwnerContact(record.projectId);
            dealOwnerName = owner.ownerName;
          } catch (ownerErr) {
            console.warn(
              `[Zuper Confirm] Unable to resolve deal owner for ${record.projectId}:`,
              ownerErr instanceof Error ? ownerErr.message : ownerErr
            );
          }
        } else if (scheduleType === "installation" || scheduleType === "inspection") {
          try {
            const manager = await getDealProjectManagerContact(record.projectId);
            projectManagerName = manager.projectManagerName;
          } catch (managerErr) {
            console.warn(
              `[Zuper Confirm] Unable to resolve project manager for ${record.projectId}:`,
              managerErr instanceof Error ? managerErr.message : managerErr
            );
          }
        }
        let installDetails: Awaited<ReturnType<typeof getInstallNotificationDetails>>["details"];
        if (scheduleType === "installation") {
          const detailResult = await getInstallNotificationDetails(record.projectId);
          installDetails = detailResult.details;
          if (detailResult.warning) {
            console.warn(`[Zuper Confirm] ${detailResult.warning}`);
          }
        }

        // ── Async fallback: trigger BOM pipeline if no snapshot exists ──
        // Runs entirely inside waitUntil — zero sync DB work on request path.
        // Independent of email delivery (fires even without recipientEmail).
        if (
          scheduleType === "installation" &&
          process.env.INSTALL_SCHEDULED_PIPELINE_FALLBACK_ENABLED === "true"
        ) {
          const fallbackDealId = record.projectId;
          const fallbackDealName = customerName;
          waitUntil((async () => {
            try {
              const hasSnapshot = await checkBomSnapshotExists(fallbackDealId);
              if (hasSnapshot) return; // Snapshot exists, no fallback needed

              console.log(`[Zuper Confirm] No BOM snapshot for ${fallbackDealId} — triggering fallback pipeline`);
              const runId = await acquirePipelineLock(
                fallbackDealId,
                "WEBHOOK_INSTALL_SCHEDULED",
                fallbackDealName,
              );
              await runDesignCompletePipeline(runId, fallbackDealId, "WEBHOOK_INSTALL_SCHEDULED");
            } catch (err) {
              if (err instanceof DuplicateRunError) {
                console.log(`[Zuper Confirm] Pipeline already running for deal ${fallbackDealId}`);
              } else {
                console.error(`[Zuper Confirm] Fallback pipeline error:`, err);
              }
            }
          })());
        }

        if (recipientEmail) {
          const currentSurveyor: SurveyorInfo = {
            email: normalizeEmail(recipientEmail),
            name: recipientName || record.assignedUser || null,
            uid: firstAssignedUid || null,
          };
          // ── BOM enrichment for install emails (sync — needed to build email content) ──
          let bomEnrichment: BomEmailEnrichment | null = null;
          if (scheduleType === "installation") {
            try {
              const enrichmentResult = await getBomEmailEnrichment(record.projectId, customerName);
              if (enrichmentResult.status === "success") {
                bomEnrichment = enrichmentResult.enrichment;
              } else if (enrichmentResult.status === "error") {
                console.warn("[Zuper Confirm] BOM enrichment failed (non-fatal):", enrichmentResult.error);
              }
              // "no_snapshot" → bomEnrichment stays null, email sends without BOM section
            } catch (enrichErr) {
              console.warn("[Zuper Confirm] BOM enrichment unexpected error (non-fatal):", enrichErr);
            }
          }

          let googleCalendarEventUrl: string | undefined;
          if (isSurveyLike(scheduleType)) {
            googleCalendarEventUrl =
              getGoogleCalendarEventUrl(getSurveyCalendarEventId(record.projectId), recipientEmail) || undefined;
          } else if (scheduleType === "installation") {
            try {
              const dealProps = await getDealProperties(record.projectId, ["pb_location"]);
              const pbLocation = dealProps?.pb_location as string | undefined;
              const locationResolution = resolveInstallCalendarLocation({
                pbLocation,
                assignedUserUid: record.assignedUserUid || null,
                assignedUserName: record.assignedUser || null,
              });
              const installCalendarId = getInstallCalendarIdForLocation(locationResolution.location);
              googleCalendarEventUrl =
                getGoogleCalendarEventUrl(
                  getInstallationCalendarEventId(record.projectId),
                  installCalendarId
                ) || undefined;
            } catch (calendarLinkErr) {
              console.warn("[Zuper Confirm] Unable to build install Google Calendar link:", calendarLinkErr);
            }
          }

          const sendStandardSchedulingNotification = async () => {
            await sendSchedulingNotification({
              to: recipientEmail!,
              crewMemberName: recipientName,
              scheduledByName: session.user.name || session.user.email || "PB Operations",
              scheduledByEmail: session.user.email || "noreply@photonbrothers.com",
              dealOwnerName: dealOwnerName || undefined,
              projectManagerName: projectManagerName || undefined,
              appointmentType: scheduleType,
              customerName,
              customerAddress,
              scheduledDate: record.scheduledDate,
              scheduledStart: record.scheduledStart || undefined,
              scheduledEnd: record.scheduledEnd || undefined,
              projectId: record.projectId,
              zuperJobUid: zuperJobUid || record.zuperJobUid || undefined,
              googleCalendarEventUrl,
              notes: effectiveNotes || undefined,
              installDetails,
              bomEnrichment: bomEnrichment || undefined,
            });
          };

          const previousSurveyorEmail = normalizeEmail(previousSurveyorFromJob?.email);

          if (isSurveyLike(scheduleType)) {
            await sendSurveyReassignmentNotifications({
              logPrefix: "Zuper Confirm",
              schedulerName: session.user.name || session.user.email || "PB Operations",
              schedulerEmail: session.user.email || "noreply@photonbrothers.com",
              previousSurveyor: previousSurveyorFromJob,
              currentSurveyor,
              currentRecipients: [{
                email: recipientEmail,
                name: recipientName || record.assignedUser || "Team Member",
              }],
              customerName,
              customerAddress,
              scheduledDate: record.scheduledDate,
              scheduledStart: record.scheduledStart || undefined,
              scheduledEnd: record.scheduledEnd || undefined,
              projectId: record.projectId,
              zuperJobUid: zuperJobUid || record.zuperJobUid || undefined,
              dealOwnerName: dealOwnerName || undefined,
              notes: effectiveNotes || undefined,
              googleCalendarEventUrl,
              usedSchedulerFallback,
              sendStandardSchedulingNotifications: sendStandardSchedulingNotification,
            });
          } else {
            await sendStandardSchedulingNotification();
          }

          if (isSurveyLike(scheduleType)) {
            const currentSurveyorEmail = normalizeEmail(recipientEmail);
            if (
              previousSurveyorEmail &&
              currentSurveyorEmail &&
              previousSurveyorEmail !== currentSurveyorEmail
            ) {
              const previousPersonalDelete = await deleteSiteSurveyCalendarEvent({
                projectId: record.projectId,
                surveyorEmail: previousSurveyorEmail,
                calendarId: "primary",
                impersonateEmail: previousSurveyorEmail,
              });
              if (!previousPersonalDelete.success) {
                console.warn(
                  `[Zuper Confirm] Google Calendar reassignment cleanup warning (old personal ${previousSurveyorEmail}): ${previousPersonalDelete.error || "unknown error"}`
                );
              }

              const previousSharedCalendarId = getSiteSurveySharedCalendarIdForSurveyor(previousSurveyorEmail);
              const currentSharedCalendarId = getSiteSurveySharedCalendarIdForSurveyor(currentSurveyorEmail);
              if (previousSharedCalendarId && previousSharedCalendarId !== currentSharedCalendarId) {
                const previousSharedDelete = await deleteSiteSurveyCalendarEvent({
                  projectId: record.projectId,
                  surveyorEmail: previousSurveyorEmail,
                  calendarId: previousSharedCalendarId,
                  impersonateEmail: getSiteSurveySharedCalendarImpersonationEmail(previousSurveyorEmail) || undefined,
                });
                if (!previousSharedDelete.success) {
                  console.warn(
                    `[Zuper Confirm] Google Calendar reassignment cleanup warning (old shared ${previousSharedCalendarId}): ${previousSharedDelete.error || "unknown error"}`
                  );
                }
              }
            }

            const personalCalendarSync = await upsertSiteSurveyCalendarEvent({
              surveyorEmail: recipientEmail,
              surveyorName: recipientName || record.assignedUser || undefined,
              projectId: record.projectId,
              projectName: record.projectName,
              customerName,
              customerAddress,
              date: record.scheduledDate,
              startTime: record.scheduledStart || undefined,
              endTime: record.scheduledEnd || undefined,
              timezone: slotTimezone,
              notes: effectiveNotes || undefined,
              zuperJobUid: zuperJobUid || record.zuperJobUid || undefined,
              calendarId: "primary",
              impersonateEmail: recipientEmail,
            });
            if (!personalCalendarSync.success) {
              console.warn(`[Zuper Confirm] Google Calendar personal survey sync warning: ${personalCalendarSync.error}`);
            }

            const sharedSurveyCalendarId = getSiteSurveySharedCalendarIdForSurveyor(recipientEmail);
            if (sharedSurveyCalendarId) {
              const sharedCalendarSync = await upsertSiteSurveyCalendarEvent({
                surveyorEmail: recipientEmail,
                surveyorName: recipientName || record.assignedUser || undefined,
                projectId: record.projectId,
                projectName: record.projectName,
                customerName,
                customerAddress,
                date: record.scheduledDate,
                startTime: record.scheduledStart || undefined,
                endTime: record.scheduledEnd || undefined,
                timezone: slotTimezone,
                notes: effectiveNotes || undefined,
                zuperJobUid: zuperJobUid || record.zuperJobUid || undefined,
                calendarId: sharedSurveyCalendarId,
                impersonateEmail: getSiteSurveySharedCalendarImpersonationEmail(recipientEmail) || recipientEmail,
              });
              if (!sharedCalendarSync.success) {
                console.warn(`[Zuper Confirm] Google Calendar shared survey sync warning: ${sharedCalendarSync.error}`);
              }
            }
          }
        } else {
          console.warn(
            `[Zuper Confirm] No email found for assigned surveyor: name="${record.assignedUser}", uid="${firstAssignedUid || ""}"`
          );
        }

        if (scheduleType === "installation") {
          try {
            const dealProps = await getDealProperties(record.projectId, ["pb_location"]);
            const pbLocation = dealProps?.pb_location as string | undefined;
            const locationResolution = resolveInstallCalendarLocation({
              pbLocation,
              assignedUserUid: record.assignedUserUid || null,
              assignedUserName: record.assignedUser || null,
            });
            const installCalendarId = getInstallCalendarIdForLocation(locationResolution.location);
            if (installCalendarId) {
              const days = record.scheduledDays || 1;
              const endDate = getBusinessEndDateInclusive(record.scheduledDate, days);
              const timezone =
                getInstallCalendarTimezone(locationResolution.bucket) ||
                slotTimezone ||
                "America/Denver";
              const calendarSync = await upsertInstallationCalendarEvent({
                projectId: record.projectId,
                projectName: record.projectName,
                customerName,
                customerAddress,
                startDate: record.scheduledDate,
                startTime: record.scheduledStart || undefined,
                endDate,
                endTime: record.scheduledEnd || undefined,
                timezone,
                notes: effectiveNotes || undefined,
                zuperJobUid: zuperJobUid || record.zuperJobUid || undefined,
                calendarId: installCalendarId,
                installDetails,
                scheduledBy: session.user.name || session.user.email,
                projectManagerName: projectManagerName || undefined,
              });
              if (!calendarSync.success) {
                console.warn(`[Zuper Confirm] Google Calendar install sync warning: ${calendarSync.error}`);
              }
            } else {
              console.log(
                `[Zuper Confirm] No install calendar configured for location "${pbLocation || "unknown"}" (resolved=${locationResolution.location || "unknown"}, source=${locationResolution.source}), skipping calendar sync`
              );
            }
          } catch (calErr) {
            console.warn("[Zuper Confirm] Installation calendar sync failed:", calErr);
          }
        }
      }
    } catch (emailErr) {
      console.warn("Failed to send scheduling notification:", emailErr);
    }

    const hdrs = await headers();
    const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const userAgent = hdrs.get("user-agent") || "unknown";

    const activityType =
      isSurveyLike(scheduleType)
        ? "SURVEY_SCHEDULED"
        : scheduleType === "inspection"
          ? "INSPECTION_SCHEDULED"
          : "INSTALL_SCHEDULED";

    await logActivity({
      type: activityType,
      description: `Confirmed ${originalStatus === "pending_zuper" ? "pending Zuper" : "tentative"} ${scheduleType} for ${record.projectName}`,
      userEmail: session.user.email,
      userName: session.user.name || undefined,
      entityType: "schedule_record",
      entityId: record.id,
      entityName: record.projectName,
      metadata: {
        confirmed: true,
        scheduleType,
        scheduledDate: record.scheduledDate,
        projectId: record.projectId,
        zuperJobUid,
        zuperError,
      },
      ipAddress: ip,
      userAgent,
    });

    return NextResponse.json({
      success: true,
      confirmed: true,
      zuperSynced: true,
      zuperJobUid,
      zuperError: null,
      zuperNoteWarning: zuperNoteWarning || undefined,
      hubspotWarnings: hubspotWarnings.length > 0 ? hubspotWarnings : undefined,
      record: {
        id: record.id,
        projectId: record.projectId,
        scheduledDate: record.scheduledDate,
        status: "scheduled",
      },
      message: `${scheduleType} confirmed and synced to Zuper`,
    });
  } catch (error) {
    console.error("Error confirming tentative schedule:", error);
    return NextResponse.json(
      { error: "Failed to confirm schedule" },
      { status: 500 }
    );
  }
}
