/**
 * GET /api/scheduler-v2/board — unified-dispatch board aggregator.
 *
 * Composes the board read so the client makes a single call. Server-side it
 * reuses the proven building blocks rather than re-implementing them:
 *
 *  - Assignments + crew roster: the same Prisma queries /api/crew-schedule uses
 *    (CrewMember active, ScheduleRecord, BookedSlot, ZuperJobCache) with the same
 *    dedup-by `crewName|date|projectId`, multi-day expansion, and 32-day cap.
 *  - Install pool: `fetchAllProjects` + `filterProjectsForContext(_, "scheduling")`
 *    from @/lib/hubspot — the exact pair /api/projects?context=scheduling wraps.
 *    Called directly (no HTTP self-fetch).
 *  - Zuper construction lookup: `handleLookup` exported by the zuper jobs lookup
 *    route (returns a NextResponse; we read .json()). Direct call, no self-fetch.
 *  - Director-team users: getTeamUsersByLocation() from scheduler-v2/assign (cached).
 *  - Pure transforms: toWorkItems / toResources (construction adapter) +
 *    computeCapacityCells.
 *
 * Feature-gated on SCHEDULER_V2_ENABLED === "true" (404 otherwise).
 * Auth via requireApiAuth (same as crew-schedule).
 * Fail-soft: external (Zuper/HubSpot) hiccups degrade to partial DB-backed data;
 * a Zuper error never 500s the board.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { getBusinessDatesInSpan } from "@/lib/scheduling-utils";
import { fetchAllProjects, filterProjectsForContext, type Project } from "@/lib/hubspot";
import { handleLookup } from "@/app/api/zuper/jobs/lookup/route";
import { getTeamUsersByLocation } from "@/lib/scheduler-v2/assign";
import {
  toWorkItems,
  toResources,
  type ConstructionAdapterProject,
  type ZuperLookupEntry,
  type AdapterCrewMember,
} from "@/lib/scheduler-v2/adapters/construction";
import { computeCapacityCells } from "@/lib/scheduler-v2/capacity";
import { LOCATIONS } from "@/lib/scheduler-v2/constants";
import type { Assignment, BoardData } from "@/lib/scheduler-v2/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Inclusive day count between two YYYY-MM-DD strings. */
function daysBetween(start: string, end: string): number {
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  return Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  // Feature gate — additive endpoint stays invisible until explicitly enabled.
  if (process.env.SCHEDULER_V2_ENABLED !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  // -------------------------------------------------------------------------
  // Validate query params
  // -------------------------------------------------------------------------
  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json(
      { error: "from and to query parameters are required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json(
      { error: "from and to must be YYYY-MM-DD format" },
      { status: 400 },
    );
  }
  if (to < from) {
    return NextResponse.json(
      { error: "to must be on or after from" },
      { status: 400 },
    );
  }
  if (daysBetween(from, to) > 32) {
    return NextResponse.json(
      { error: "Date range must not exceed 32 days" },
      { status: 400 },
    );
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  // Optional filters
  const locationsParam = searchParams.get("locations");
  const locationFilter = locationsParam
    ? new Set(locationsParam.split(",").map((l) => l.trim()).filter(Boolean))
    : null;
  // Phase 1: only the install work type is composed. The param is accepted so
  // the contract is stable, but anything other than "install" yields an empty
  // install pool (assignments/roster still render).
  const workTypesParam = searchParams.get("workTypes");
  const workTypes = workTypesParam
    ? new Set(workTypesParam.split(",").map((w) => w.trim()).filter(Boolean))
    : new Set<string>(["install"]);
  const includeInstall = workTypes.has("install");

  const dateRange = { start: from, end: to };

  try {
    // -----------------------------------------------------------------------
    // 1. DB queries (mirror /api/crew-schedule) — these are the always-on,
    //    DB-backed pieces. Run them in parallel.
    // -----------------------------------------------------------------------
    const endDatePlusOne = new Date(new Date(to + "T00:00:00Z").getTime() + 86_400_000);

    const [crewMembers, scheduleRecords, bookedSlots, zuperJobs] = await Promise.all([
      prisma.crewMember.findMany({
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
      }),
      prisma.scheduleRecord.findMany({
        where: {
          scheduledDate: { gte: from, lte: to },
          status: { notIn: ["cancelled", "rescheduled"] },
          assignedUser: { not: null },
        },
      }),
      prisma.bookedSlot.findMany({
        where: { date: { gte: from, lte: to } },
      }),
      prisma.zuperJobCache.findMany({
        where: {
          scheduledStart: {
            gte: new Date(from + "T00:00:00Z"),
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

    // -----------------------------------------------------------------------
    // 2. Resolve deal values + locations from HubSpotProjectCache
    // -----------------------------------------------------------------------
    const projectIdSet = new Set<string>();
    for (const sr of scheduleRecords) if (sr.projectId) projectIdSet.add(sr.projectId);
    for (const bs of bookedSlots) if (bs.projectId) projectIdSet.add(bs.projectId);
    for (const zj of zuperJobs) if (zj.hubspotDealId) projectIdSet.add(zj.hubspotDealId);

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

    const crewByName = new Map(crewMembers.map((c) => [c.name, c]));

    // -----------------------------------------------------------------------
    // 3. Build v2 Assignments (dedup + multi-day expansion), same precedence as
    //    crew-schedule: ScheduleRecord > BookedSlot > ZuperJobCache.
    // -----------------------------------------------------------------------
    const seen = new Set<string>();
    const assignments: Assignment[] = [];

    const resolveLocation = (
      cacheLoc: string | null | undefined,
      crewName: string,
      slotLoc?: string | null,
    ): string | null => {
      const crew = crewByName.get(crewName);
      return (
        slotLoc ||
        cacheLoc ||
        (crew && crew.locations.length > 0 ? crew.locations[0] : null)
      );
    };

    // --- ScheduleRecords (highest priority) ---
    for (const sr of scheduleRecords) {
      const names = sr.assignedUser!.split(",").map((n) => n.trim()).filter(Boolean);
      const cached = projectCache.get(sr.projectId);
      const dealValue = cached?.amount ?? null;
      const scheduledDays = Math.max(sr.scheduledDays ?? 1, 1);
      const dates =
        scheduledDays > 1
          ? getBusinessDatesInSpan(sr.scheduledDate, scheduledDays).filter(
              (d) => d >= from && d <= to,
            )
          : [sr.scheduledDate];

      for (const crewName of names) {
        const location = resolveLocation(cached?.pbLocation, crewName);
        const workType = sr.scheduleType || "install";
        for (const date of dates) {
          const key = `${crewName}|${date}|${sr.projectId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          assignments.push({
            id: `sr_${sr.id}_${date}_${crewName}`,
            source: "schedule_record",
            resourceName: crewName,
            date,
            startTime: sr.scheduledStart ?? null,
            endTime: sr.scheduledEnd ?? null,
            workType,
            location,
            workItemId: sr.projectId,
            projectId: sr.projectId,
            projectName: sr.projectName,
            value: dealValue,
            status: sr.status,
          });
        }
      }
    }

    // --- BookedSlots ---
    for (const bs of bookedSlots) {
      const names = bs.userName.split(",").map((n) => n.trim()).filter(Boolean);
      const cached = projectCache.get(bs.projectId);
      const dealValue = cached?.amount ?? null;
      for (const crewName of names) {
        const key = `${crewName}|${bs.date}|${bs.projectId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        assignments.push({
          id: `bs_${bs.id}_${crewName}`,
          source: "booked_slot",
          resourceName: crewName,
          date: bs.date,
          startTime: bs.startTime ?? null,
          endTime: bs.endTime ?? null,
          workType: "install",
          location: resolveLocation(cached?.pbLocation, crewName, bs.location),
          workItemId: bs.projectId,
          projectId: bs.projectId,
          projectName: bs.projectName,
          value: dealValue,
          status: "scheduled",
        });
      }
    }

    // --- ZuperJobCache (lowest priority — fills service/D&R/roofing gaps) ---
    for (const zj of zuperJobs) {
      const users = zj.assignedUsers as Array<{ user_uid?: string; user_name?: string }> | null;
      if (!users || !Array.isArray(users) || users.length === 0) continue;
      const projectId = zj.hubspotDealId || zj.jobUid;
      const date = zj.scheduledStart!.toISOString().slice(0, 10);
      const cached = zj.hubspotDealId ? projectCache.get(zj.hubspotDealId) : undefined;
      for (const u of users) {
        const crewName = u.user_name;
        if (!crewName) continue;
        const key = `${crewName}|${date}|${projectId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        assignments.push({
          id: `zj_${zj.jobUid}_${crewName}`,
          source: "zuper_job_cache",
          resourceName: crewName,
          date,
          startTime: zj.scheduledStart ? zj.scheduledStart.toISOString().slice(11, 16) : null,
          endTime: null,
          workType: "install",
          location: cached?.pbLocation ?? null,
          workItemId: projectId,
          projectId,
          projectName: zj.projectName ?? zj.jobCategory,
          value: cached?.amount ?? null,
          status: zj.jobStatus.toLowerCase(),
        });
      }
    }

    // -----------------------------------------------------------------------
    // 4. Install pool (reused HubSpot data functions) — fail-soft.
    // -----------------------------------------------------------------------
    let adapterProjects: ConstructionAdapterProject[] = [];
    if (includeInstall) {
      try {
        const all = await fetchAllProjects({ activeOnly: true });
        let scheduling = filterProjectsForContext(all, "scheduling");
        if (locationFilter) {
          scheduling = scheduling.filter((p) => locationFilter.has(p.pbLocation));
        }
        adapterProjects = scheduling.map(projectToAdapterProject);
      } catch (err) {
        console.warn("[scheduler-v2/board] install pool fetch failed (degrading):", err);
        adapterProjects = [];
      }
    }

    // -----------------------------------------------------------------------
    // 5. Zuper construction lookup (reused handleLookup) — fail-soft.
    // -----------------------------------------------------------------------
    let zuperLookup: Record<string, ZuperLookupEntry> = {};
    if (adapterProjects.length > 0) {
      try {
        const projectIds = adapterProjects.map((p) => p.id);
        const projectNames = adapterProjects.map((p) => p.name);
        const res = await handleLookup(projectIds, projectNames, "construction");
        const data = (await res.json()) as {
          jobs?: Record<string, Omit<ZuperLookupEntry, "subJobs">>;
          subJobs?: Record<string, ZuperLookupEntry["subJobs"]>;
        };
        const jobs = data.jobs ?? {};
        const subJobs = data.subJobs ?? {};
        for (const [dealId, job] of Object.entries(jobs)) {
          zuperLookup[dealId] = { ...job, subJobs: subJobs[dealId] };
        }
        // Sub-jobs may exist for deals not in `jobs` — surface them too.
        for (const [dealId, sub] of Object.entries(subJobs)) {
          if (!zuperLookup[dealId]) {
            zuperLookup[dealId] = { jobUid: "", status: "", subJobs: sub };
          }
        }
      } catch (err) {
        console.warn("[scheduler-v2/board] zuper lookup failed (degrading):", err);
        zuperLookup = {};
      }
    }

    // -----------------------------------------------------------------------
    // 6. Director-team users (cached resolver) — fail-soft.
    // -----------------------------------------------------------------------
    let teamUsersByLocation: Awaited<ReturnType<typeof getTeamUsersByLocation>> = {};
    try {
      teamUsersByLocation = await getTeamUsersByLocation();
    } catch (err) {
      console.warn("[scheduler-v2/board] team user resolution failed (degrading):", err);
      teamUsersByLocation = {};
    }

    // -----------------------------------------------------------------------
    // 7. Pure transforms.
    // -----------------------------------------------------------------------
    const adapterCrew: AdapterCrewMember[] = crewMembers.map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      locations: c.locations,
      isActive: c.isActive,
      maxDailyJobs: c.maxDailyJobs,
      zuperUserUid: c.zuperUserUid,
      zuperTeamUid: c.zuperTeamUid,
    }));

    const workItems = toWorkItems(adapterProjects, zuperLookup, {});
    const resources = toResources(adapterCrew, teamUsersByLocation);

    const outputLocations = locationFilter
      ? LOCATIONS.filter((l) => locationFilter.has(l))
      : LOCATIONS;
    const capacity = computeCapacityCells(assignments, resources, outputLocations, dateRange);

    const board: BoardData = {
      resources,
      workItems,
      assignments,
      capacity,
      dateRange,
    };

    return NextResponse.json(board);
  } catch (error) {
    console.error("[scheduler-v2/board] Error composing board:", error);
    return NextResponse.json({ error: "Failed to compose board" }, { status: 500 });
  }
}

/**
 * Map a HubSpot scheduling-context Project to the construction adapter's input
 * shape. Project.id is a number at runtime; the adapter expects a string id.
 */
function projectToAdapterProject(p: Project): ConstructionAdapterProject {
  return {
    id: String(p.id),
    name: p.name,
    address: p.address,
    location: p.pbLocation,
    amount: p.amount,
    installDays: p.expectedDaysForInstall || p.daysForInstallers || 2,
    scheduleDate: p.constructionScheduleDate,
    installStatus: p.constructionStatus || "",
    completionDate: p.constructionCompleteDate,
  };
}
