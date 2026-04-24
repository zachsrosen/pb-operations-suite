/**
 * Append-only change detector for ScheduleEventLog.
 *
 * Called from cacheZuperJob before every upsert to the ZuperJobCache table.
 * When a job is newly cached or its scheduledStart/End or crew user_uid list
 * differs from what's already cached, a new ScheduleEventLog row is written.
 *
 * Purpose: Zuper's REST API only exposes the CURRENT scheduled_end_time on a
 * job; reschedules overwrite that value in place. For compliance scoring we
 * need to recover the ORIGINAL commitment. ScheduleEventLog preserves the
 * history in our own DB from now forward (see PR feat/schedule-event-log,
 * 2026-04-24).
 */

export interface ScheduleEventLogDb {
  zuperJobCache: {
    findUnique: (args: {
      where: { jobUid: string };
      select: {
        scheduledStart: boolean;
        scheduledEnd: boolean;
        assignedUsers: boolean;
        assignedTeam: boolean;
      };
    }) => Promise<{
      scheduledStart: Date | null;
      scheduledEnd: Date | null;
      assignedUsers: unknown;
      assignedTeam: string | null;
    } | null>;
  };
  scheduleEventLog: {
    create: (args: {
      data: {
        zuperJobUid: string;
        scheduledStart?: Date | null;
        scheduledEnd?: Date | null;
        crewUserUids: string[];
        crewTeamUid?: string | null;
        source: string;
        previousScheduledStart?: Date | null;
        previousScheduledEnd?: Date | null;
        previousCrewUserUids?: string[];
      };
    }) => Promise<unknown>;
  };
}

export interface CacheZuperJobInput {
  jobUid: string;
  scheduledStart?: Date;
  scheduledEnd?: Date;
  assignedUsers?: { user_uid: string; user_name?: string }[];
  assignedTeam?: string;
}

/**
 * Extract user_uid list from the assignedUsers payload into a sorted array.
 * Used for stable change-detection comparisons (order-independent).
 */
export function extractUserUids(assignedUsers: unknown): string[] {
  if (!Array.isArray(assignedUsers)) return [];
  const uids: string[] = [];
  for (const entry of assignedUsers) {
    if (entry && typeof entry === "object") {
      const e = entry as Record<string, unknown>;
      const uid = e.user_uid;
      if (typeof uid === "string" && uid) uids.push(uid);
    }
  }
  return uids.sort();
}

/** Date equality that treats null/undefined/invalid as equal-by-absence. */
export function dateEqualsIgnoringNull(
  a: Date | null | undefined,
  b: Date | null | undefined
): boolean {
  const ta = a ? a.getTime() : null;
  const tb = b ? b.getTime() : null;
  return ta === tb;
}

/**
 * Core logic. Takes a database handle so it's testable with a fake. The
 * production caller (cacheZuperJob) passes the real Prisma client; tests
 * pass a fake that records calls.
 */
export async function logScheduleEventIfChanged(
  db: ScheduleEventLogDb,
  job: CacheZuperJobInput
): Promise<"initial" | "changed" | "unchanged"> {
  const existing = await db.zuperJobCache.findUnique({
    where: { jobUid: job.jobUid },
    select: {
      scheduledStart: true,
      scheduledEnd: true,
      assignedUsers: true,
      assignedTeam: true,
    },
  });

  const incomingUids = extractUserUids(job.assignedUsers);
  const incomingStart = job.scheduledStart ?? null;
  const incomingEnd = job.scheduledEnd ?? null;

  // First observation — always log a baseline.
  if (!existing) {
    await db.scheduleEventLog.create({
      data: {
        zuperJobUid: job.jobUid,
        scheduledStart: incomingStart,
        scheduledEnd: incomingEnd,
        crewUserUids: incomingUids,
        crewTeamUid: job.assignedTeam ?? null,
        source: "initial",
      },
    });
    return "initial";
  }

  // Treat undefined incoming fields as "use existing value" — avoids spurious
  // change events when a route updates only a subset of fields.
  const existingUids = extractUserUids(existing.assignedUsers);
  const compareUids =
    job.assignedUsers !== undefined ? incomingUids : existingUids;
  const compareStart =
    job.scheduledStart !== undefined ? incomingStart : existing.scheduledStart;
  const compareEnd =
    job.scheduledEnd !== undefined ? incomingEnd : existing.scheduledEnd;
  const compareTeam =
    job.assignedTeam !== undefined ? job.assignedTeam : existing.assignedTeam;

  const scheduleChanged =
    !dateEqualsIgnoringNull(compareStart, existing.scheduledStart) ||
    !dateEqualsIgnoringNull(compareEnd, existing.scheduledEnd);

  const crewChanged =
    compareUids.length !== existingUids.length ||
    compareUids.some((u, i) => u !== existingUids[i]);

  if (!scheduleChanged && !crewChanged) return "unchanged";

  await db.scheduleEventLog.create({
    data: {
      zuperJobUid: job.jobUid,
      scheduledStart: compareStart,
      scheduledEnd: compareEnd,
      crewUserUids: compareUids,
      crewTeamUid: compareTeam ?? null,
      source: "changed",
      previousScheduledStart: existing.scheduledStart,
      previousScheduledEnd: existing.scheduledEnd,
      previousCrewUserUids: existingUids,
    },
  });
  return "changed";
}
