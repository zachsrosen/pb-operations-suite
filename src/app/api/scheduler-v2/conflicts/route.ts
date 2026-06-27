/**
 * POST /api/scheduler-v2/conflicts — pre-flight feasibility check.
 *
 * Accepts a proposed assignment and returns a ConflictResult describing every
 * issue found. Read-only; never mutates state.
 *
 * Body: { workItemId, dealId?, resourceId, location, date, days,
 *          startTime?, endTime?, workType }
 *
 * Returns: ConflictResult { ok, hard[], soft[] }
 *
 * Feature-gated on SCHEDULER_V2_ENABLED === "true" (404 otherwise).
 * Auth via requireApiAuth.
 *
 * ## How context is assembled
 *
 * existingAssignments — all ScheduleRecord + BookedSlot + ZuperJobCache rows
 *   for the same resource on the proposed date (resource matched by
 *   crewMember.id, crewMember.zuperUserUid, or display name — whichever the
 *   caller supplies as resourceId). Each source maps to one Assignment per
 *   assigned-user-per-date.
 *
 * capacityCells — computeCapacityCells over the single proposed date for the
 *   proposed location, using active CrewMembers for capacity blend.
 *
 * isHolidayOrWeekend — isPbHoliday || isWeekendDateYmd (pure, no network).
 *
 * leadTimeError — getSalesSurveyLeadTimeError using the session user's roles.
 *
 * travel — evaluateSlotTravel against adjacent jobs that day for the resource.
 *   Wrapped in try/catch; any error or null return omits the travel flag
 *   (fail-open — scheduling is never blocked by travel errors).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { detectConflicts, type ConflictParams, type ConflictContext } from "@/lib/scheduler-v2/conflicts";
import { computeCapacityCells } from "@/lib/scheduler-v2/capacity";
import { isPbHoliday } from "@/lib/on-call-holidays";
import { isWeekendDateYmd } from "@/lib/scheduling-utils";
import { getSalesSurveyLeadTimeError } from "@/lib/scheduling-policy";
import { evaluateSlotTravel, getConfig } from "@/lib/travel-time";
import { isSchedulerV2Enabled } from "@/lib/scheduler-v2/flag";
import type { Assignment, Resource } from "@/lib/scheduler-v2/types";

// ---------------------------------------------------------------------------
// Request body shape
// ---------------------------------------------------------------------------

interface ConflictRequestBody {
  workItemId: string;
  dealId?: string;
  resourceId: string;
  location: string;
  date: string;
  days: number;
  startTime?: string;
  endTime?: string;
  workType: string;
}

function isValidBody(b: unknown): b is ConflictRequestBody {
  if (!b || typeof b !== "object") return false;
  const obj = b as Record<string, unknown>;
  return (
    typeof obj.workItemId === "string" &&
    typeof obj.resourceId === "string" &&
    typeof obj.location === "string" &&
    typeof obj.date === "string" &&
    typeof obj.days === "number" &&
    typeof obj.workType === "string"
  );
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Feature gate
  if (!(await isSchedulerV2Enabled())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  // Parse + validate body
  let body: ConflictRequestBody;
  try {
    const raw = await request.json();
    if (!isValidBody(raw)) {
      return NextResponse.json(
        { error: "Missing required fields: workItemId, resourceId, location, date, days, workType" },
        { status: 400 },
      );
    }
    body = raw;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { resourceId, location, date, days, workType, startTime, endTime } = body;

  try {
    // -------------------------------------------------------------------------
    // 1. Resolve the crew member by resourceId (id, zuperUserUid, or name)
    //    so we can match assignments across all three sources.
    // -------------------------------------------------------------------------
    const crewMembers = await prisma.crewMember.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        role: true,
        locations: true,
        isActive: true,
        maxDailyJobs: true,
        zuperUserUid: true,
        zuperTeamUid: true,
      },
    });

    // Find the crew member matching this resourceId
    const targetCrew = crewMembers.find(
      (c) =>
        c.id === resourceId ||
        (c.zuperUserUid && c.zuperUserUid === resourceId) ||
        c.name === resourceId,
    );

    // Build the set of identifiers for this resource (name, db id, zuper uid)
    const resourceNames = new Set<string>();
    if (targetCrew) {
      resourceNames.add(targetCrew.name);
      if (targetCrew.zuperUserUid) resourceNames.add(targetCrew.zuperUserUid);
      resourceNames.add(targetCrew.id);
    }
    // Always treat resourceId itself as a potential name match
    resourceNames.add(resourceId);

    // -------------------------------------------------------------------------
    // 2. Query existing assignments for this resource on the proposed date.
    //    Each source maps to Assignment[]; we include all three (dedup not
    //    needed here — we just need to know if *any* assignment exists).
    // -------------------------------------------------------------------------
    const endDatePlusOne = new Date(new Date(date + "T00:00:00Z").getTime() + 86_400_000);

    const [scheduleRecords, bookedSlots, zuperJobs] = await Promise.all([
      // ScheduleRecord: filter by date, then check assignedUser contains resource name
      prisma.scheduleRecord.findMany({
        where: {
          scheduledDate: date,
          status: { notIn: ["cancelled", "rescheduled"] },
          assignedUser: { not: null },
        },
      }),
      // BookedSlot: filter by date
      prisma.bookedSlot.findMany({
        where: { date },
      }),
      // ZuperJobCache: filter by date
      prisma.zuperJobCache.findMany({
        where: {
          scheduledStart: {
            gte: new Date(date + "T00:00:00Z"),
            lt: endDatePlusOne,
          },
          jobStatus: { notIn: ["CANCELLED"] },
        },
        select: {
          jobUid: true,
          jobCategory: true,
          jobStatus: true,
          scheduledStart: true,
          assignedUsers: true,
          hubspotDealId: true,
          projectName: true,
        },
      }),
    ]);

    // Build Assignment[] for the resource on this date
    const existingAssignments: Assignment[] = [];

    for (const sr of scheduleRecords) {
      const names = sr.assignedUser!.split(",").map((n) => n.trim()).filter(Boolean);
      const isOurResource = names.some((n) => resourceNames.has(n));
      if (!isOurResource) continue;
      existingAssignments.push({
        id: `sr_${sr.id}_${date}`,
        source: "schedule_record",
        resourceName: names.find((n) => resourceNames.has(n)) ?? names[0],
        date,
        startTime: sr.scheduledStart ?? null,
        endTime: sr.scheduledEnd ?? null,
        workType: sr.scheduleType || "install",
        location: null,
        workItemId: sr.projectId,
        projectId: sr.projectId,
        projectName: sr.projectName,
        value: null,
        status: sr.status,
      });
    }

    for (const bs of bookedSlots) {
      const names = bs.userName.split(",").map((n) => n.trim()).filter(Boolean);
      const isOurResource = names.some((n) => resourceNames.has(n));
      if (!isOurResource) continue;
      existingAssignments.push({
        id: `bs_${bs.id}`,
        source: "booked_slot",
        resourceName: names.find((n) => resourceNames.has(n)) ?? names[0],
        date,
        startTime: bs.startTime ?? null,
        endTime: bs.endTime ?? null,
        workType: "install",
        location: bs.location ?? null,
        workItemId: bs.projectId,
        projectId: bs.projectId,
        projectName: bs.projectName,
        value: null,
        status: "scheduled",
      });
    }

    for (const zj of zuperJobs) {
      const users = zj.assignedUsers as Array<{ user_uid?: string; user_name?: string }> | null;
      if (!users || !Array.isArray(users)) continue;
      const matchedUser = users.find(
        (u) =>
          (u.user_name && resourceNames.has(u.user_name)) ||
          (u.user_uid && resourceNames.has(u.user_uid)),
      );
      if (!matchedUser) continue;
      const jobDate = zj.scheduledStart!.toISOString().slice(0, 10);
      existingAssignments.push({
        id: `zj_${zj.jobUid}`,
        source: "zuper_job_cache",
        resourceName: matchedUser.user_name ?? matchedUser.user_uid ?? resourceId,
        date: jobDate,
        startTime: zj.scheduledStart ? zj.scheduledStart.toISOString().slice(11, 16) : null,
        endTime: null,
        workType: "install",
        location: null,
        workItemId: zj.hubspotDealId ?? zj.jobUid,
        projectId: zj.hubspotDealId ?? zj.jobUid,
        projectName: zj.projectName ?? zj.jobCategory,
        value: null,
        status: zj.jobStatus.toLowerCase(),
      });
    }

    // -------------------------------------------------------------------------
    // 3. Compute capacity cells for this location + date.
    //    We only need the single date, but computeCapacityCells needs a range.
    // -------------------------------------------------------------------------

    // Gather ALL assignments on this date for the location (to get accurate loadDays)
    const allAssignmentsOnDate: Assignment[] = [];

    for (const sr of scheduleRecords) {
      const names = sr.assignedUser!.split(",").map((n) => n.trim()).filter(Boolean);
      for (const name of names) {
        allAssignmentsOnDate.push({
          id: `sr_${sr.id}_${date}_${name}`,
          source: "schedule_record",
          resourceName: name,
          date,
          startTime: sr.scheduledStart ?? null,
          endTime: sr.scheduledEnd ?? null,
          workType: sr.scheduleType || "install",
          location,
          workItemId: sr.projectId,
          projectId: sr.projectId,
          projectName: sr.projectName,
          value: null,
          status: sr.status,
        });
      }
    }

    for (const bs of bookedSlots) {
      const names = bs.userName.split(",").map((n) => n.trim()).filter(Boolean);
      for (const name of names) {
        allAssignmentsOnDate.push({
          id: `bs_${bs.id}_${name}`,
          source: "booked_slot",
          resourceName: name,
          date,
          startTime: bs.startTime ?? null,
          endTime: bs.endTime ?? null,
          workType: "install",
          location: bs.location ?? location,
          workItemId: bs.projectId,
          projectId: bs.projectId,
          projectName: bs.projectName,
          value: null,
          status: "scheduled",
        });
      }
    }

    // Build Resource[] from active crew members for capacity blend
    const resources: Resource[] = crewMembers.map((c) => ({
      id: c.zuperUserUid ?? c.id,
      name: c.name,
      kind: "crew" as const,
      role: c.role,
      locations: c.locations,
      primaryLocation: c.locations[0] ?? location,
      color: "#888888",
      capacityPerDay: c.maxDailyJobs ?? 1,
      zuperUserUid: c.zuperUserUid ?? undefined,
      zuperTeamUid: c.zuperTeamUid ?? undefined,
      assignable: true,
      crewMemberId: c.id,
    }));

    const capacityCells = computeCapacityCells(
      allAssignmentsOnDate,
      resources,
      [location],
      { start: date, end: date },
    );

    // -------------------------------------------------------------------------
    // 4. isHolidayOrWeekend — pure, no network.
    // -------------------------------------------------------------------------
    const isHolidayOrWeekend = isPbHoliday(date) || isWeekendDateYmd(date);

    // -------------------------------------------------------------------------
    // 5. Lead-time check — scheduling policy for the session user's roles.
    // -------------------------------------------------------------------------
    const userRoles = authResult.roles as string[];
    const scheduleTypeForPolicy =
      workType === "survey" || workType === "pre-sale-survey"
        ? (workType as "survey" | "pre-sale-survey")
        : "installation";

    const leadTimeError = getSalesSurveyLeadTimeError({
      roles: userRoles as Parameters<typeof getSalesSurveyLeadTimeError>[0]["roles"],
      scheduleType: scheduleTypeForPolicy === "installation"
        ? "installation"
        : scheduleTypeForPolicy,
      scheduleDate: date,
    });

    // -------------------------------------------------------------------------
    // 6. Travel check — on demand, fail-open.
    //    We look for adjacent assignments for this resource on the same date.
    // -------------------------------------------------------------------------
    let travelContext: ConflictContext["travel"] | undefined;

    const travelConfig = getConfig();
    if (travelConfig.enabled && startTime && endTime) {
      try {
        // Find adjacent bookings for this resource on the same date
        const resourceAssignmentsToday = existingAssignments
          .filter((a) => a.date === date)
          .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));

        // Find the booking immediately before and after our proposed slot
        let prevBooking: { endTime: string; projectName: string } | undefined;
        let nextBooking: { startTime: string; projectName: string } | undefined;

        for (const a of resourceAssignmentsToday) {
          if (a.endTime && a.endTime <= startTime) {
            prevBooking = { endTime: a.endTime, projectName: a.projectName };
          }
          if (!nextBooking && a.startTime && a.startTime >= endTime) {
            nextBooking = { startTime: a.startTime, projectName: a.projectName };
          }
        }

        if (prevBooking || nextBooking) {
          const warning = await evaluateSlotTravel({
            candidateAddress: location, // best we have without a deal address here
            slotStartTime: startTime,
            slotEndTime: endTime,
            prevBooking: prevBooking
              ? { endTime: prevBooking.endTime, projectName: prevBooking.projectName }
              : undefined,
            nextBooking: nextBooking
              ? { startTime: nextBooking.startTime, projectName: nextBooking.projectName }
              : undefined,
            bufferMinutes: travelConfig.bufferMinutes,
            unknownThresholdMinutes: travelConfig.unknownThresholdMinutes,
            tightThresholdMinutes: travelConfig.tightThresholdMinutes,
          });

          if (warning) {
            // Map TravelWarning.type to infeasible boolean.
            // "tight" means the drive-time window is too short → infeasible.
            // "unknown" means we can't resolve a location → also surface as travel soft flag.
            travelContext = {
              infeasible: warning.type === "tight" || warning.type === "unknown",
              minutes:
                warning.prevJob?.travelMinutes ?? warning.nextJob?.travelMinutes,
            };
          }
        }
      } catch {
        // Travel errors are fail-open — never block scheduling
        travelContext = undefined;
      }
    }

    // -------------------------------------------------------------------------
    // 7. Assemble ConflictParams + ConflictContext and call detectConflicts.
    // -------------------------------------------------------------------------
    const params: ConflictParams = {
      resourceId,
      location,
      date,
      days,
      workType,
    };

    const context: ConflictContext = {
      existingAssignments,
      capacityCells,
      isHolidayOrWeekend,
      leadTimeError: leadTimeError ?? null,
      travel: travelContext,
    };

    const result = detectConflicts(params, context);

    return NextResponse.json(result);
  } catch (error) {
    console.error("[scheduler-v2/conflicts] Error checking conflicts:", error);
    return NextResponse.json({ error: "Failed to check conflicts" }, { status: 500 });
  }
}
