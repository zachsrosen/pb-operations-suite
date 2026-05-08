import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { getBusinessDatesInSpan } from "@/lib/scheduling-utils";

/**
 * GET /api/crew-schedule
 *
 * Returns crew members and their assignments (merged from ScheduleRecord + BookedSlot)
 * enriched with deal values from HubSpotProjectCache.
 *
 * Query params:
 *   startDate (required) — YYYY-MM-DD
 *   endDate   (required) — YYYY-MM-DD (max 31-day range)
 */

// ---------------------------------------------------------------------------
// Scheduler path map
// ---------------------------------------------------------------------------
const SCHEDULER_PATH_MAP: Record<string, string> = {
  survey: "/dashboards/site-survey-scheduler",
  construction: "/dashboards/construction-scheduler",
  installation: "/dashboards/construction-scheduler",
  inspection: "/dashboards/inspection-scheduler",
  service: "/dashboards/service-scheduler",
  dnr: "/dashboards/dnr-scheduler",
  roofing: "/dashboards/roofing-scheduler",
};

const DEFAULT_SCHEDULER_PATH = "/dashboards/scheduler";

// ---------------------------------------------------------------------------
// Role → jobType fallback
// ---------------------------------------------------------------------------
const ROLE_JOB_TYPE_MAP: Record<string, string> = {
  surveyor: "survey",
  technician: "construction",
  inspector: "inspection",
  electrician: "construction",
  roofer: "roofing",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveSchedulerPath(jobType: string): string {
  return SCHEDULER_PATH_MAP[jobType.toLowerCase()] ?? DEFAULT_SCHEDULER_PATH;
}

/** Compute the number of days between two YYYY-MM-DD strings (inclusive). */
function daysBetween(start: string, end: string): number {
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  return Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  // Parse & validate query params
  const { searchParams } = request.nextUrl;
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "startDate and endDate query parameters are required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return NextResponse.json(
      { error: "startDate and endDate must be YYYY-MM-DD format" },
      { status: 400 },
    );
  }

  if (endDate < startDate) {
    return NextResponse.json(
      { error: "endDate must be on or after startDate" },
      { status: 400 },
    );
  }

  const rangeDays = daysBetween(startDate, endDate);
  if (rangeDays > 32) {
    return NextResponse.json(
      { error: "Date range must not exceed 32 days" },
      { status: 400 },
    );
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    // -----------------------------------------------------------------------
    // 1. Fetch active crew members
    // -----------------------------------------------------------------------
    const crewMembers = await prisma.crewMember.findMany({
      where: { isActive: true },
      select: { id: true, name: true, role: true, locations: true, teamName: true },
    });

    type CrewRow = (typeof crewMembers)[number];
    const crewByName = new Map<string, CrewRow>(crewMembers.map((c: CrewRow) => [c.name, c]));

    // -----------------------------------------------------------------------
    // 2. Query ScheduleRecords in range (active, assigned)
    // -----------------------------------------------------------------------
    const scheduleRecords = await prisma.scheduleRecord.findMany({
      where: {
        scheduledDate: { gte: startDate, lte: endDate },
        status: { notIn: ["cancelled", "rescheduled"] },
        assignedUser: { not: null },
      },
    });

    // -----------------------------------------------------------------------
    // 3. Query BookedSlots in range
    // -----------------------------------------------------------------------
    const bookedSlots = await prisma.bookedSlot.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
      },
    });

    // -----------------------------------------------------------------------
    // 4. Collect unique projectIds, batch-resolve from HubSpotProjectCache
    // -----------------------------------------------------------------------
    const projectIdSet = new Set<string>();
    for (const sr of scheduleRecords) {
      if (sr.projectId) projectIdSet.add(sr.projectId);
    }
    for (const bs of bookedSlots) {
      if (bs.projectId) projectIdSet.add(bs.projectId);
    }

    const projectCache = new Map<string, { amount: number | null; pbLocation: string | null }>();
    if (projectIdSet.size > 0) {
      const cached = await prisma.hubSpotProjectCache.findMany({
        where: { dealId: { in: Array.from(projectIdSet) } },
        select: { dealId: true, amount: true, pbLocation: true },
      });
      for (const c of cached) {
        projectCache.set(c.dealId, { amount: c.amount, pbLocation: c.pbLocation });
      }
    }

    // -----------------------------------------------------------------------
    // 5–8. Build assignments with dedup + multi-day expansion
    // -----------------------------------------------------------------------

    // Dedup key: "crewName|date|projectId" — prefer ScheduleRecord
    const seen = new Set<string>();

    interface Assignment {
      id: string;
      source: "schedule_record" | "booked_slot";
      crewMemberName: string;
      date: string;
      startTime: string | null;
      endTime: string | null;
      jobType: string;
      pbLocation: string | null;
      projectId: string;
      projectName: string;
      dealValue: number | null;
      status: string;
      schedulerPath: string;
    }

    const assignments: Assignment[] = [];

    // --- Process ScheduleRecords first (higher priority) ---
    for (const sr of scheduleRecords) {
      const crewName = sr.assignedUser!; // guaranteed non-null by query filter
      const crew = crewByName.get(crewName);

      // Resolve jobType: scheduleType → crew role fallback → "unknown"
      const jobType =
        sr.scheduleType ||
        (crew ? ROLE_JOB_TYPE_MAP[crew.role] : undefined) ||
        "unknown";

      // Resolve pbLocation: cache → crew locations[0] → null
      const cached = projectCache.get(sr.projectId);
      const pbLocation =
        cached?.pbLocation ||
        (crew && crew.locations.length > 0 ? crew.locations[0] : null);

      const dealValue = cached?.amount ?? null;

      // Expand multi-day jobs
      const scheduledDays = Math.max(sr.scheduledDays ?? 1, 1);
      const dates =
        scheduledDays > 1
          ? getBusinessDatesInSpan(sr.scheduledDate, scheduledDays).filter(
              (d) => d >= startDate && d <= endDate,
            )
          : [sr.scheduledDate];

      for (const date of dates) {
        const dedupKey = `${crewName}|${date}|${sr.projectId}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        assignments.push({
          id: `sr_${sr.id}_${date}`,
          source: "schedule_record",
          crewMemberName: crewName,
          date,
          startTime: sr.scheduledStart ?? null,
          endTime: sr.scheduledEnd ?? null,
          jobType,
          pbLocation,
          projectId: sr.projectId,
          projectName: sr.projectName,
          dealValue,
          status: sr.status,
          schedulerPath: resolveSchedulerPath(jobType),
        });
      }
    }

    // --- Process BookedSlots (lower priority — dedup filters duplicates) ---
    for (const bs of bookedSlots) {
      const crewName = bs.userName;
      const crew = crewByName.get(crewName);

      const dedupKey = `${crewName}|${bs.date}|${bs.projectId}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      // Resolve jobType: no scheduleType on BookedSlot → crew role fallback → "unknown"
      const jobType =
        (crew ? ROLE_JOB_TYPE_MAP[crew.role] : undefined) || "unknown";

      // Resolve pbLocation: BookedSlot.location → cache → crew locations[0] → null
      const cached = projectCache.get(bs.projectId);
      const pbLocation =
        bs.location ||
        cached?.pbLocation ||
        (crew && crew.locations.length > 0 ? crew.locations[0] : null);

      const dealValue = cached?.amount ?? null;

      assignments.push({
        id: `bs_${bs.id}`,
        source: "booked_slot",
        crewMemberName: crewName,
        date: bs.date,
        startTime: bs.startTime ?? null,
        endTime: bs.endTime ?? null,
        jobType,
        pbLocation,
        projectId: bs.projectId,
        projectName: bs.projectName,
        dealValue,
        status: "scheduled",
        schedulerPath: resolveSchedulerPath(jobType),
      });
    }

    // -----------------------------------------------------------------------
    // Response
    // -----------------------------------------------------------------------
    return NextResponse.json({
      crew: crewMembers.map((c: CrewRow) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        locations: c.locations,
        teamName: c.teamName,
      })),
      assignments,
      dateRange: { start: startDate, end: endDate },
    });
  } catch (error) {
    console.error("[crew-schedule] Error fetching crew schedule:", error);
    return NextResponse.json(
      { error: "Failed to fetch crew schedule" },
      { status: 500 },
    );
  }
}
