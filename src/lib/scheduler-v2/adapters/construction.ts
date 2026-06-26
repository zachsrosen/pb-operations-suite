/**
 * Construction adapter for scheduler-v2.
 *
 * Transforms the real API payloads consumed by the construction-scheduler page
 * into the job-type-agnostic WorkItem[] and Resource[] shapes defined in
 * src/lib/scheduler-v2/types.ts.
 *
 * Pure functions — no fetching, no Prisma, no side effects. All inputs are
 * passed as arguments so every function is fully unit-testable.
 *
 * ## Input shapes (from real API payloads)
 *
 *   ConstructionAdapterProject — subset of the ConstructionProject type from
 *     construction-scheduler/page.tsx that the adapter needs.
 *
 *   ZuperLookupEntry — subset of the per-deal entry from
 *     GET /api/zuper/jobs/lookup?category=construction (zuperData.jobs[dealId])
 *     plus optional zuperData.subJobs[dealId] (SubJobInfo[]).
 *
 *   AdapterCrewMember — subset of the Prisma CrewMember model fields used here.
 *
 *   TeamUser — { name, userUid, teamUid } — entries from each location's
 *     Zuper director-team user list (CONSTRUCTION_DIRECTORS[location].teamUid
 *     → /api/zuper/teams/{teamUid}/users).
 *
 * ## toWorkItems
 *
 * A deal with PV + ESS sub-jobs produces TWO WorkItems sharing `parentDealId`.
 * The stable `id` is derived from the Zuper job UID when available, otherwise
 * from `${dealId}:install:${subSystem ?? ""}`.
 *
 * ## toResources
 *
 * Board rows come from the team-user lists (TeamUser[]) keyed by location.
 * Each row is reconciled to an active CrewMember (match by zuperUserUid first,
 * then by display name as fallback). Reconciled rows carry crewMemberId +
 * capacityPerDay from maxDailyJobs. Unreconciled rows get assignable:true with
 * default capacityPerDay=1. Active CrewMembers not in any director-team list
 * are still included but with assignable:false (so past/scheduled work shows).
 * Inactive CrewMembers are excluded entirely.
 */

import type { WorkItem, Resource } from "../types";
import type { SubJobInfo } from "@/lib/scheduler-subjobs";
import { getCustomerName } from "../normalize";
import { isOverdue } from "../normalize";

/* ------------------------------------------------------------------ */
/*  Exported input types (mirror real API shapes, subset only)         */
/* ------------------------------------------------------------------ */

/** Fields the adapter needs from the ConstructionProject shape. */
export interface ConstructionAdapterProject {
  id: string;
  name: string;
  address?: string;
  location: string;
  amount?: number;
  installDays: number;
  scheduleDate: string | null;
  installStatus: string;
  completionDate: string | null;
}

/** One entry from zuperData.jobs[dealId] in the Zuper lookup response. */
export interface ZuperLookupEntry {
  jobUid: string;
  status: string;
  scheduledDate?: string;
  scheduledEnd?: string;
  scheduledDays?: number;
  assignedTo?: string[];
  /** Expanded sub-jobs (PV / ESS / EV) when the deal has split construction. */
  subJobs?: SubJobInfo[];
}

/** Prisma CrewMember model subset needed by the adapter. */
export interface AdapterCrewMember {
  id: string;
  name: string;
  role: string;
  locations: string[];
  isActive: boolean;
  maxDailyJobs: number;
  zuperUserUid: string;
  zuperTeamUid?: string | null;
}

/** Entry from a location's Zuper director-team user list. */
export interface TeamUser {
  name: string;
  userUid: string;
  teamUid: string;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

type SubSystemTag = "PV" | "ESS" | "EV";

function systemTypeToSubSystem(sysType: SubJobInfo["systemType"]): SubSystemTag | undefined {
  if (sysType === "solar") return "PV";
  if (sysType === "battery") return "ESS";
  if (sysType === "ev") return "EV";
  return undefined; // "legacy" maps to no subSystem
}

/**
 * Determine the WorkItemStatus from the construction project's installStatus
 * field and whether a sub-job status exists.
 */
function resolveStatus(
  installStatus: string,
  zuperStatus?: string
): WorkItem["status"] {
  const s = (zuperStatus || installStatus || "").toLowerCase();
  if (s.includes("complete")) return "done";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("tentative")) return "tentative";
  if (s.includes("scheduled") || s.includes("schedule")) return "scheduled";
  if (s.includes("progress") || s.includes("started")) return "working";
  if (s.includes("en route") || s.includes("en_route")) return "en_route";
  return "unscheduled";
}

/* ------------------------------------------------------------------ */
/*  toWorkItems                                                        */
/* ------------------------------------------------------------------ */

/**
 * Transform construction projects + Zuper lookup data into WorkItem[].
 *
 * @param projects        Filtered project list from /api/projects?context=scheduling.
 * @param zuperLookup     Per-deal Zuper job info from /api/zuper/jobs/lookup.
 *                        Key = deal id (string). May be empty for deals without
 *                        Zuper jobs.
 * @param scheduleRecords Tentative schedule records keyed by deal id.
 *                        Value = { id, scheduledDate }. Non-empty entries mean
 *                        the deal has a local hold (isTentative:true).
 */
export function toWorkItems(
  projects: ConstructionAdapterProject[],
  zuperLookup: Record<string, ZuperLookupEntry>,
  scheduleRecords: Record<string, { id: string; scheduledDate: string }>
): WorkItem[] {
  const items: WorkItem[] = [];

  for (const project of projects) {
    const dealId = String(project.id);
    const zuperEntry = zuperLookup[dealId];
    const tentativeRecord = scheduleRecords[dealId];
    const isTentative = Boolean(tentativeRecord);
    const customer = getCustomerName(project.name);
    const projectNumber = project.name.split(" | ")[0];

    // Split sub-jobs (PV + ESS + EV) — each becomes its own WorkItem
    if (zuperEntry?.subJobs && zuperEntry.subJobs.length > 0) {
      for (const subJob of zuperEntry.subJobs) {
        const subSystem = systemTypeToSubSystem(subJob.systemType);
        const stableId = subJob.jobUid
          ? subJob.jobUid
          : `${dealId}:install:${subSystem ?? ""}`;

        const scheduledStart = subJob.scheduledDate ?? undefined;
        const scheduledEnd = subJob.scheduledEnd ?? undefined;
        const durationDays = subJob.scheduledDays ?? project.installDays ?? 2;

        const overdueCheck = isOverdue(
          scheduledStart ?? null,
          durationDays,
          resolveStatus(project.installStatus, subJob.status),
          false /* construction = multi-day */
        );

        items.push({
          id: stableId,
          dealId,
          parentDealId: dealId,
          projectNumber,
          customer,
          address: project.address,
          location: project.location,
          workType: "install",
          subSystem,
          durationDays,
          status: isTentative
            ? "tentative"
            : resolveStatus(project.installStatus, subJob.status),
          scheduledStart,
          scheduledEnd,
          assignedResourceIds: subJob.assignedTo ?? [],
          isTentative,
          isOverdue: overdueCheck,
          isForecast: false,
          hasZuperJob: true,
          value: project.amount,
          zuperJobUid: subJob.jobUid,
          source: "zuper",
        });
      }
      continue;
    }

    // Single Zuper job (no sub-job split) or no Zuper job at all
    const hasZuperJob = Boolean(zuperEntry?.jobUid);
    const scheduledStart = zuperEntry?.scheduledDate ??
      (isTentative ? tentativeRecord?.scheduledDate : undefined) ??
      project.scheduleDate ??
      undefined;
    const scheduledEnd = zuperEntry?.scheduledEnd ?? undefined;
    const durationDays = zuperEntry?.scheduledDays ?? project.installDays ?? 2;

    const status = !hasZuperJob && !isTentative && !project.scheduleDate
      ? "unscheduled"
      : isTentative
        ? "tentative"
        : resolveStatus(project.installStatus, zuperEntry?.status);

    const overdueCheck = isOverdue(
      scheduledStart ?? null,
      durationDays,
      status,
      false
    );

    const stableId = zuperEntry?.jobUid
      ? zuperEntry.jobUid
      : `${dealId}:install:`;

    items.push({
      id: stableId,
      dealId,
      parentDealId: dealId,
      projectNumber,
      customer,
      address: project.address,
      location: project.location,
      workType: "install",
      durationDays,
      status,
      scheduledStart,
      scheduledEnd,
      assignedResourceIds: zuperEntry?.assignedTo ?? [],
      isTentative,
      isOverdue: overdueCheck,
      isForecast: false,
      hasZuperJob,
      value: project.amount,
      zuperJobUid: zuperEntry?.jobUid,
      source: hasZuperJob ? "zuper" : isTentative ? "schedule_record" : "hubspot",
    });
  }

  return items;
}

/* ------------------------------------------------------------------ */
/*  toResources                                                        */
/* ------------------------------------------------------------------ */

/**
 * Reconcile director-team Zuper users (TeamUser[]) to active CrewMembers
 * to produce Resource[] for the board.
 *
 * Reconciliation rules:
 *  1. For each TeamUser in each location's list, look for an active CrewMember
 *     whose zuperUserUid matches exactly (preferred). If found, use
 *     CrewMember.maxDailyJobs for capacityPerDay, set crewMemberId, assignable:true.
 *  2. If no uid match, try matching by display name (case-insensitive). Same
 *     enrichment applies.
 *  3. If no match at all, the TeamUser still becomes an assignable Resource
 *     with crewMemberId=undefined and default capacityPerDay=1.
 *  4. Active CrewMembers that appear in no director-team list are appended as
 *     assignable:false (so their scheduled work remains visible).
 *  5. Inactive CrewMembers are excluded entirely.
 *
 * A CrewMember is only matched once (first uid match wins; prevents double-assign
 * when two crew members share a display name).
 *
 * @param crewMembers         Active + inactive CrewMember rows from DB.
 * @param teamUsersByLocation Location → TeamUser[] (from director-team Zuper API).
 */
export function toResources(
  crewMembers: AdapterCrewMember[],
  teamUsersByLocation: Record<string, TeamUser[]>
): Resource[] {
  const resources: Resource[] = [];

  // Only active crew members participate in reconciliation
  const activeCrewMembers = crewMembers.filter((cm) => cm.isActive);

  // Track which CrewMember ids have been matched (prevents double-assign)
  const matchedCrewMemberIds = new Set<string>();
  // Track resource names that already appear in the output (prevents same-name duplicate rows)
  const renderedNames = new Set<string>();

  // For each location's team users, build reconciled Resources
  for (const [location, teamUsers] of Object.entries(teamUsersByLocation)) {
    for (const teamUser of teamUsers) {
      // Attempt uid-based match first
      let matched: AdapterCrewMember | undefined = activeCrewMembers.find(
        (cm) => cm.zuperUserUid === teamUser.userUid && !matchedCrewMemberIds.has(cm.id)
      );

      // Fall back to name-based match
      if (!matched) {
        const normalizedTeamName = teamUser.name.toLowerCase().trim();
        matched = activeCrewMembers.find(
          (cm) =>
            cm.name.toLowerCase().trim() === normalizedTeamName &&
            !matchedCrewMemberIds.has(cm.id)
        );
      }

      if (matched) {
        matchedCrewMemberIds.add(matched.id);
      }

      const resourceName = matched?.name ?? teamUser.name;
      renderedNames.add(resourceName.toLowerCase().trim());
      resources.push({
        id: teamUser.userUid,
        name: resourceName,
        kind: "crew",
        role: matched?.role,
        locations: matched?.locations ?? [location],
        primaryLocation: location,
        color: "#94a3b8", // default slate; board layer overrides per director-team color
        capacityPerDay: matched?.maxDailyJobs ?? 1,
        zuperUserUid: teamUser.userUid,
        zuperTeamUid: teamUser.teamUid,
        assignable: true,
        crewMemberId: matched?.id,
      });
    }
  }

  // Append active CrewMembers not present in any director-team list (assignable:false).
  // Skip if this crew member's name is already rendered (prevents same-name duplicate rows
  // when two CrewMembers share a display name and only one maps to a team user).
  for (const cm of activeCrewMembers) {
    if (matchedCrewMemberIds.has(cm.id)) continue;
    if (renderedNames.has(cm.name.toLowerCase().trim())) continue;
    // Determine primaryLocation from their locations array (first entry)
    const primaryLocation = cm.locations[0] ?? "Unknown";
    resources.push({
      id: cm.zuperUserUid,
      name: cm.name,
      kind: "crew",
      role: cm.role,
      locations: cm.locations,
      primaryLocation,
      color: "#94a3b8",
      capacityPerDay: cm.maxDailyJobs,
      zuperUserUid: cm.zuperUserUid,
      zuperTeamUid: cm.zuperTeamUid ?? undefined,
      assignable: false,
      crewMemberId: cm.id,
    });
  }

  return resources;
}
