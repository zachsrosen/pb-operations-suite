import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { getDealProperties } from "@/lib/hubspot";
import { getBusinessEndDateInclusive } from "@/lib/business-days";
import { getInstallCalendarIdForLocation, upsertInstallationCalendarEvent } from "@/lib/google-calendar";
import { getInstallCalendarTimezone, resolveInstallCalendarLocation } from "@/lib/install-calendar-location";
import { zuper } from "@/lib/zuper";

type CandidateRecord = {
  id: string;
  projectId: string;
  projectName: string;
  scheduledDate: string;
  scheduledDays: number | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  assignedUser: string | null;
  assignedUserUid: string | null;
  zuperJobUid: string | null;
  notes: string | null;
  status: string;
  createdAt: Date;
};

function formatDenverDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(date);
}

function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function parseCustomerNameAndAddress(projectName: string, fallbackAddress?: string): { customerName: string; customerAddress: string } {
  const parts = projectName.split(" | ");
  const customerName = parts.length >= 2 ? (parts[1]?.trim() || "Customer") : (parts[0]?.trim() || "Customer");
  const parsedAddress = parts.length >= 3 ? (parts[2]?.trim() || "") : "";
  const customerAddress = parsedAddress || fallbackAddress || "See HubSpot for address";
  return { customerName, customerAddress };
}

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 250;
  return Math.min(Math.floor(parsed), 2000);
}

function parseStartDateOrDefault(value: string | null, defaultDate: string): string {
  if (!value) return defaultDate;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : defaultDate;
}

const ALLOWED_ROLES = new Set(["ADMIN", "OWNER"]);

async function runBackfill(request: NextRequest, applyOverride?: boolean) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  const dbUser = await prisma.user.findUnique({
    where: { email: authResult.email },
    select: { role: true },
  });
  if (!dbUser || !ALLOWED_ROLES.has(dbUser.role)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const apply = typeof applyOverride === "boolean"
    ? applyOverride
    : request.nextUrl.searchParams.get("apply") === "1";
  const includeTentative = request.nextUrl.searchParams.get("includeTentative") === "1";
  const verifyZuper = request.nextUrl.searchParams.get("verifyZuper") !== "0";
  const today = formatDenverDate(new Date());
  const defaultFromDate = addDays(today, 1); // "after today" by default
  const fromDate = parseStartDateOrDefault(request.nextUrl.searchParams.get("from"), defaultFromDate);
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  const rawRecords = await prisma.scheduleRecord.findMany({
    where: {
      scheduleType: "installation",
      scheduledDate: { gte: fromDate },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      projectId: true,
      projectName: true,
      scheduledDate: true,
      scheduledDays: true,
      scheduledStart: true,
      scheduledEnd: true,
      assignedUser: true,
      assignedUserUid: true,
      zuperJobUid: true,
      notes: true,
      status: true,
      createdAt: true,
    },
    take: limit * 4,
  });

  const latestByProject = new Map<string, CandidateRecord>();
  for (const record of rawRecords) {
    if (!latestByProject.has(record.projectId)) {
      latestByProject.set(record.projectId, record);
    }
  }

  const latestRecords = Array.from(latestByProject.values())
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
    .slice(0, limit);

  const rows: Array<{
    projectId: string;
    projectName: string;
    scheduledDate: string;
    endDate: string;
    days: number;
    startTime: string | null;
    endTime: string | null;
    status: string;
    pbLocation: string | null;
    resolvedLocation: string | null;
    locationSource: string;
    timezone: string | null;
    timezoneSource: string;
    calendarId: string | null;
    zuperStatus: string | null;
    zuperStart: string | null;
    zuperEnd: string | null;
    action: "synced" | "would_sync" | "skipped" | "failed";
    reason?: string;
    error?: string;
  }> = [];

  let statusSkipped = 0;
  let locationSkipped = 0;
  let timezoneSkipped = 0;
  let zuperSkipped = 0;
  let readyToSync = 0;
  let synced = 0;
  let failed = 0;

  for (const record of latestRecords) {
    const isEligibleStatus = record.status === "scheduled" || (includeTentative && record.status === "tentative");
    const days = Number.isFinite(Number(record.scheduledDays)) ? Number(record.scheduledDays) : 1;
    const endDate = getBusinessEndDateInclusive(record.scheduledDate, days);

    if (!isEligibleStatus) {
      statusSkipped += 1;
      rows.push({
        projectId: record.projectId,
        projectName: record.projectName,
        scheduledDate: record.scheduledDate,
        endDate,
        days,
        startTime: record.scheduledStart,
        endTime: record.scheduledEnd,
        status: record.status,
        pbLocation: null,
        resolvedLocation: null,
        locationSource: "status_not_eligible",
        timezone: null,
        timezoneSource: "status_not_eligible",
        calendarId: null,
        zuperStatus: null,
        zuperStart: null,
        zuperEnd: null,
        action: "skipped",
        reason: `latest_status_${record.status}`,
      });
      continue;
    }

    let zuperStatus: string | null = null;
    let zuperStart: string | null = null;
    let zuperEnd: string | null = null;
    if (verifyZuper && zuper.isConfigured() && record.zuperJobUid) {
      const jobResult = await zuper.getJob(record.zuperJobUid);
      if (jobResult.type !== "success" || !jobResult.data) {
        zuperSkipped += 1;
        rows.push({
          projectId: record.projectId,
          projectName: record.projectName,
          scheduledDate: record.scheduledDate,
          endDate,
          days,
          startTime: record.scheduledStart,
          endTime: record.scheduledEnd,
          status: record.status,
          pbLocation: null,
          resolvedLocation: null,
          locationSource: "zuper_lookup_failed",
          timezone: null,
          timezoneSource: "zuper_lookup_failed",
          calendarId: null,
          zuperStatus: null,
          zuperStart: null,
          zuperEnd: null,
          action: "skipped",
          reason: "zuper_lookup_failed",
          error: jobResult.error || "Failed to load Zuper job",
        });
        continue;
      }

      zuperStatus = jobResult.data.current_job_status?.status_name || null;
      zuperStart = jobResult.data.scheduled_start_time || jobResult.data.scheduled_start_time_dt || null;
      zuperEnd = jobResult.data.scheduled_end_time || jobResult.data.scheduled_end_time_dt || null;
      if (!zuperStart || !zuperEnd) {
        zuperSkipped += 1;
        rows.push({
          projectId: record.projectId,
          projectName: record.projectName,
          scheduledDate: record.scheduledDate,
          endDate,
          days,
          startTime: record.scheduledStart,
          endTime: record.scheduledEnd,
          status: record.status,
          pbLocation: null,
          resolvedLocation: null,
          locationSource: "zuper_not_scheduled",
          timezone: null,
          timezoneSource: "zuper_not_scheduled",
          calendarId: null,
          zuperStatus,
          zuperStart,
          zuperEnd,
          action: "skipped",
          reason: "zuper_not_scheduled",
        });
        continue;
      }
    }

    const dealProps = await getDealProperties(record.projectId, ["pb_location", "address_line_1", "city", "state"]);
    const pbLocation = dealProps?.pb_location || null;
    const locationResolution = resolveInstallCalendarLocation({
      pbLocation,
      assignedUserUid: record.assignedUserUid,
      assignedUserName: record.assignedUser,
    });
    const resolvedLocation = locationResolution.location;
    const installCalendarId = getInstallCalendarIdForLocation(resolvedLocation);

    if (!installCalendarId) {
      locationSkipped += 1;
      rows.push({
        projectId: record.projectId,
        projectName: record.projectName,
        scheduledDate: record.scheduledDate,
        endDate,
        days,
        startTime: record.scheduledStart,
        endTime: record.scheduledEnd,
        status: record.status,
        pbLocation,
        resolvedLocation,
        locationSource: locationResolution.source,
        timezone: null,
        timezoneSource: "no_install_calendar_for_location",
        calendarId: null,
        zuperStatus,
        zuperStart,
        zuperEnd,
        action: "skipped",
        reason: "no_install_calendar_for_location",
      });
      continue;
    }

    const timezone = getInstallCalendarTimezone(locationResolution.bucket);
    if (!timezone) {
      timezoneSkipped += 1;
      rows.push({
        projectId: record.projectId,
        projectName: record.projectName,
        scheduledDate: record.scheduledDate,
        endDate,
        days,
        startTime: record.scheduledStart,
        endTime: record.scheduledEnd,
        status: record.status,
        pbLocation,
        resolvedLocation,
        locationSource: locationResolution.source,
        timezone: null,
        timezoneSource: "unknown",
        calendarId: installCalendarId,
        zuperStatus,
        zuperStart,
        zuperEnd,
        action: "skipped",
        reason: "unknown_timezone",
      });
      continue;
    }

    const fallbackAddress = [dealProps?.address_line_1, dealProps?.city, dealProps?.state].filter(Boolean).join(", ");
    const { customerName, customerAddress } = parseCustomerNameAndAddress(record.projectName, fallbackAddress || undefined);

    if (!apply) {
      readyToSync += 1;
      rows.push({
        projectId: record.projectId,
        projectName: record.projectName,
        scheduledDate: record.scheduledDate,
        endDate,
        days,
        startTime: record.scheduledStart,
        endTime: record.scheduledEnd,
        status: record.status,
        pbLocation,
        resolvedLocation,
        locationSource: locationResolution.source,
        timezone,
        timezoneSource: `install_bucket_${locationResolution.bucket || "unknown"}`,
        calendarId: installCalendarId,
        zuperStatus,
        zuperStart,
        zuperEnd,
        action: "would_sync",
      });
      continue;
    }

    const syncResult = await upsertInstallationCalendarEvent({
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
      zuperJobUid: record.zuperJobUid || undefined,
      calendarId: installCalendarId,
    });

    if (syncResult.success) {
      synced += 1;
      rows.push({
        projectId: record.projectId,
        projectName: record.projectName,
        scheduledDate: record.scheduledDate,
        endDate,
        days,
        startTime: record.scheduledStart,
        endTime: record.scheduledEnd,
        status: record.status,
        pbLocation,
        resolvedLocation,
        locationSource: locationResolution.source,
        timezone,
        timezoneSource: `install_bucket_${locationResolution.bucket || "unknown"}`,
        calendarId: installCalendarId,
        zuperStatus,
        zuperStart,
        zuperEnd,
        action: "synced",
      });
    } else {
      failed += 1;
      rows.push({
        projectId: record.projectId,
        projectName: record.projectName,
        scheduledDate: record.scheduledDate,
        endDate,
        days,
        startTime: record.scheduledStart,
        endTime: record.scheduledEnd,
        status: record.status,
        pbLocation,
        resolvedLocation,
        locationSource: locationResolution.source,
        timezone,
        timezoneSource: `install_bucket_${locationResolution.bucket || "unknown"}`,
        calendarId: installCalendarId,
        zuperStatus,
        zuperStart,
        zuperEnd,
        action: "failed",
        error: syncResult.error || "Unknown sync error",
      });
    }
  }

  return NextResponse.json({
    success: true,
    dryRun: !apply,
    today,
    fromDate,
    includeTentative,
    verifyZuper,
    limit,
    summary: {
      rawFutureRecords: rawRecords.length,
      uniqueProjectsConsidered: latestRecords.length,
      statusSkipped,
      zuperSkipped,
      locationSkipped,
      timezoneSkipped,
      readyToSync,
      synced,
      failed,
    },
    rows,
  });
}

export async function GET(request: NextRequest) {
  return runBackfill(request, false);
}

export async function POST(request: NextRequest) {
  return runBackfill(request);
}
