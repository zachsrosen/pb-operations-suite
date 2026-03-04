import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, logActivity, prisma, cacheZuperJob, canScheduleType, getCrewMemberByName, getCrewMemberByZuperUserUid, getCachedZuperJobByDealId, UserRole } from "@/lib/db";
import { zuper, JOB_CATEGORY_UIDS } from "@/lib/zuper";
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
import { getSalesSurveyLeadTimeError, resolveEffectiveRoleFromRequest } from "@/lib/scheduling-policy";
import { getGoogleCalendarEventUrl } from "@/lib/external-links";
import { waitUntil } from "@vercel/functions";
import { runDesignCompletePipeline } from "@/lib/bom-pipeline";
import { acquirePipelineLock, DuplicateRunError } from "@/lib/bom-pipeline-lock";
import { checkBomSnapshotExists, getBomEmailEnrichment, type BomEmailEnrichment } from "@/lib/bom-email-enrichment";

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

function normalizeEmail(value?: string | null): string | null {
  const trimmed = (value || "").trim().toLowerCase();
  if (!trimmed) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
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

function extractInstallerNote(rawNotes: unknown): string {
  if (typeof rawNotes !== "string") return "";
  const cleaned = rawNotes
    .replace(/\[(?:TENTATIVE|CONFIRMED)\]\s*/gi, "")
    .replace(/\[TZ:[^\]]+\]/gi, "")
    .trim();
  const markerMatch = cleaned.match(/Installer Notes:\s*([\s\S]+)/i);
  return markerMatch?.[1]?.trim() || "";
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

/**
 * POST /api/zuper/jobs/schedule/confirm
 *
 * Confirms a tentative schedule by syncing it to Zuper.
 * Takes a scheduleRecordId, fetches the tentative record,
 * then runs the full Zuper scheduling flow (search/create/reschedule).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }
    const effectiveRole = resolveEffectiveRoleFromRequest(request, user.role as UserRole);

    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const body = await request.json();
    const scheduleRecordId = typeof body?.scheduleRecordId === "string" ? body.scheduleRecordId : "";
    const hintedZuperJobUid = typeof body?.zuperJobUid === "string" ? body.zuperJobUid.trim() : "";

    if (!scheduleRecordId) {
      return NextResponse.json(
        { error: "scheduleRecordId is required" },
        { status: 400 }
      );
    }

    // Fetch the tentative record
    const record = await prisma.scheduleRecord.findUnique({
      where: { id: scheduleRecordId },
    });

    if (!record) {
      return NextResponse.json({ error: "Schedule record not found" }, { status: 404 });
    }

    if (record.status !== "tentative") {
      return NextResponse.json(
        { error: `Record is not tentative (current status: ${record.status})` },
        { status: 400 }
      );
    }
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
    ) as "survey" | "installation" | "inspection";
    if (!["survey", "installation", "inspection"].includes(scheduleType)) {
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
    const timezoneFromNotes = record.notes?.match(/\[TZ:([A-Za-z_\/]+)\]/)?.[1];
    const salesLeadTimeError = getSalesSurveyLeadTimeError({
      role: effectiveRole,
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
          if (!resolvedTeamUid && crewMember.zuperTeamUid) {
            resolvedTeamUid = crewMember.zuperTeamUid;
          }
        } else {
          const resolved = await zuper.resolveUserUid(desiredAssigneeName);
          if (resolved?.userUid) {
            resolvedUserUids.push(resolved.userUid);
            if (!resolvedTeamUid && resolved.teamUid) {
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

    const timezoneFromNotes2 = record.notes?.match(/\[TZ:([A-Za-z_\/]+)\]/)?.[1];
    const inferredTimezone = /\b(San Luis Obispo|Camarillo)\b|,\s*CA\b/i.test(record.projectName)
      ? "America/Los_Angeles"
      : "America/Denver";
    const slotTimezone = timezoneFromNotes2 || inferredTimezone;

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
    let previousSurveyorEmailFromJob: string | null = null;

    try {
      // Category config for matching
      const categoryConfig: Record<string, { name: string; uid: string }> = {
        survey: { name: "Site Survey", uid: JOB_CATEGORY_UIDS.SITE_SURVEY },
        installation: { name: "Construction", uid: JOB_CATEGORY_UIDS.CONSTRUCTION },
        inspection: { name: "Inspection", uid: JOB_CATEGORY_UIDS.INSPECTION },
      };
      const targetCategoryName = categoryConfig[scheduleType].name;
      const targetCategoryUid = categoryConfig[scheduleType].uid;
      const targetCategoryNameLower = targetCategoryName.toLowerCase();
      const hubspotTagLower = hubspotTag.toLowerCase();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const categoryMatches = (job: any): boolean => {
        if (typeof job.job_category === "string") {
          const categoryValue = job.job_category.toLowerCase();
          return categoryValue === targetCategoryNameLower ||
            categoryValue.includes(targetCategoryNameLower) ||
            job.job_category === targetCategoryUid;
        }
        const categoryName = String(job.job_category?.category_name || "").toLowerCase();
        const categoryUid = String(job.job_category?.category_uid || "");
        return categoryName === targetCategoryNameLower ||
          categoryName.includes(targetCategoryNameLower) ||
          categoryUid === targetCategoryUid;
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
        const cached = await getCachedZuperJobByDealId(record.projectId, targetCategoryName);
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
        if (scheduleType === "survey") {
          const existingJobResult = await zuper.getJob(existingJob.job_uid);
          if (existingJobResult.type === "success" && existingJobResult.data) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const assignedUser = (existingJobResult.data as any)?.assigned_to?.[0]?.user;
            previousSurveyorEmailFromJob = normalizeEmail(assignedUser?.email);

            const assignedUid = (assignedUser?.user_uid || "").trim();
            if (!previousSurveyorEmailFromJob && assignedUid) {
              const byUid = await getCrewMemberByZuperUserUid(assignedUid);
              previousSurveyorEmailFromJob = normalizeEmail(byUid?.email);
            }
            if (!previousSurveyorEmailFromJob && assignedUid) {
              const userResult = await zuper.getUser(assignedUid);
              if (userResult.type === "success") {
                previousSurveyorEmailFromJob = normalizeEmail(userResult.data?.email);
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
          if (scheduleType === "installation") {
            const installerNote = extractInstallerNote(record.notes);
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
        } else {
          zuperError = rescheduleResult.error;
        }
      } else {
        zuperError = `No existing ${scheduleType} job found in Zuper for "${record.projectName}".`;
      }
    } catch (zuperErr) {
      zuperError = String(zuperErr);
    }

    // If Zuper sync failed, keep this as tentative and return a failure so the
    // UI does not treat it as confirmed.
    if (zuperError) {
      await prisma.scheduleRecord.update({
        where: { id: scheduleRecordId },
        data: {
          status: "tentative",
          zuperSynced: false,
          zuperError,
        },
      });

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
        zuperError: null,
        notes: record.notes?.replace("[TENTATIVE]", "[CONFIRMED]") || "[CONFIRMED]",
      },
    });

    // Cancel any older tentative records for the same project/type so stale
    // tentative dates cannot rehydrate after a successful confirmation.
    await prisma.scheduleRecord.updateMany({
      where: {
        projectId: record.projectId,
        scheduleType,
        status: "tentative",
        id: { not: scheduleRecordId },
      },
      data: {
        status: "cancelled",
      },
    });

    // Cache the Zuper job if created
    if (zuperJobUid) {
      await cacheZuperJob({
        jobUid: zuperJobUid,
        jobTitle: `${scheduleType} - ${record.projectName}`,
        jobCategory: scheduleType === "survey" ? "Site Survey" : scheduleType === "inspection" ? "Inspection" : "Construction",
        jobStatus: "SCHEDULED",
        hubspotDealId: record.projectId,
        projectName: record.projectName,
      });
    }

    // Update HubSpot deal with schedule date + surveyor and verify persistence.
    const hubspotWarnings: string[] = [];
    try {
      let hubspotUpdate: Record<string, string | null>;
      if (scheduleType === "survey") {
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
      if (scheduleType === "survey" && record.assignedUser?.trim()) {
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
        scheduleType === "survey"
          ? ["site_survey_schedule_date", "site_surveyor"]
          : scheduleType === "installation"
            ? ["install_schedule_date", "construction_scheduled_date"]
            : ["inspections_schedule_date", "inspection_scheduled_date"];
      const verifyProps = await getDealProperties(record.projectId, verificationFields);
      if (!verifyProps) {
        hubspotWarnings.push("HubSpot verification read failed");
      } else {
        const dateValues =
          scheduleType === "survey"
            ? [verifyProps.site_survey_schedule_date]
            : scheduleType === "installation"
              ? [verifyProps.install_schedule_date, verifyProps.construction_scheduled_date]
              : [verifyProps.inspections_schedule_date, verifyProps.inspection_scheduled_date];
        const dateMatched = dateValues.some((v) => String(v || "") === record.scheduledDate);
        if (!dateMatched) {
          hubspotWarnings.push(`HubSpot schedule date verification failed (expected ${record.scheduledDate})`);
        }
        if (scheduleType === "survey" && record.assignedUser?.trim()) {
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

        const byName = await getCrewMemberByName(record.assignedUser);
        if (byName?.email) {
          recipientEmail = byName.email;
          recipientName = byName.name;
        }

        if (!recipientEmail && firstAssignedUid) {
          const byUid = await getCrewMemberByZuperUserUid(firstAssignedUid);
          if (byUid?.email) {
            recipientEmail = byUid.email;
            recipientName = byUid.name;
          }
        }

        // Fallback: support tentative assignees that are app users by name
        // (not present in CrewMember), e.g. internal/admin test scheduling.
        if (!recipientEmail) {
          const byAppUserName = await prisma.user.findFirst({
            where: { name: record.assignedUser },
            select: { email: true, name: true },
          });
          if (byAppUserName?.email) {
            recipientEmail = byAppUserName.email;
            recipientName = byAppUserName.name || recipientName;
          }
        }

        if (!recipientEmail && firstAssignedUid) {
          const userResult = await zuper.getUser(firstAssignedUid);
          if (userResult.type === "success" && userResult.data?.email) {
            recipientEmail = userResult.data.email;
            recipientName =
              [userResult.data.first_name, userResult.data.last_name].filter(Boolean).join(" ").trim() ||
              record.assignedUser;
          }
        }

        if (!recipientEmail && session.user.email) {
          console.warn(
            `[Zuper Confirm] No email found for assigned surveyor; falling back to scheduler email: ${session.user.email}`
          );
          recipientEmail = session.user.email;
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
        if (scheduleType === "survey") {
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
          if (scheduleType === "survey") {
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

          await sendSchedulingNotification({
            to: recipientEmail,
            crewMemberName: recipientName,
            scheduledByName: session.user.name || session.user.email,
            scheduledByEmail: session.user.email,
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
            notes: record.notes || undefined,
            installDetails,
            bomEnrichment: bomEnrichment || undefined,
          });

          if (scheduleType === "survey") {
            const previousSurveyorEmail = normalizeEmail(previousSurveyorEmailFromJob);
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
              notes: record.notes || undefined,
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
                notes: record.notes || undefined,
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
                notes: record.notes || undefined,
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
      scheduleType === "survey"
        ? "SURVEY_SCHEDULED"
        : scheduleType === "inspection"
          ? "INSPECTION_SCHEDULED"
          : "INSTALL_SCHEDULED";

    await logActivity({
      type: activityType,
      description: `Confirmed tentative ${scheduleType} for ${record.projectName}`,
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
