/**
 * PM Flag System — exception-based PM assignment.
 *
 * PMs do not own deals day-to-day. When an issue flags a deal (via HubSpot
 * workflow callout, manual UI, or admin workflow action), this module:
 *   1. Persists the flag with full event timeline.
 *   2. Round-robin assigns it to the least-loaded active PM.
 *   3. Drives lifecycle transitions (acknowledge / resolve / reassign / cancel).
 *   4. Emits ActivityLog entries for audit.
 *
 * Email notification is intentionally NOT called from here — callers wire
 * `sendFlagAssignedEmail` after `createFlag` resolves so the lib stays
 * synchronously testable and so DB rollback doesn't dangle a sent email.
 */

import { prisma, logActivity } from "@/lib/db";
import { UserRole } from "@/generated/prisma/enums";
import type {
  PmFlag,
  PmFlagEvent,
  PmFlagSeverity,
  PmFlagSource,
  PmFlagStatus,
  PmFlagType,
} from "@/generated/prisma/client";
import {
  PmFlagStatus as PmFlagStatusEnum,
  PmFlagSource as PmFlagSourceEnum,
  PmFlagEventType,
  ActivityType,
} from "@/generated/prisma/enums";

// =============================================================================
// Types
// =============================================================================

export type PmFlagWithEvents = PmFlag & {
  events: PmFlagEvent[];
  assignedToUser?: { id: string; email: string; name: string | null } | null;
  raisedByUser?: { id: string; email: string; name: string | null } | null;
  resolvedByUser?: { id: string; email: string; name: string | null } | null;
};

export interface CreateFlagInput {
  hubspotDealId: string;
  dealName?: string | null;
  type: PmFlagType;
  severity: PmFlagSeverity;
  reason: string;
  source: PmFlagSource;
  externalRef?: string | null;
  metadata?: Record<string, unknown> | null;
  raisedByUserId?: string | null;
  raisedByEmail?: string | null;
}

export interface CreateFlagResult {
  flag: PmFlagWithEvents;
  alreadyExisted: boolean;
}

const OPEN_STATUSES: PmFlagStatus[] = [
  PmFlagStatusEnum.OPEN,
  PmFlagStatusEnum.ACKNOWLEDGED,
];

// =============================================================================
// Round-robin PM assignment
// =============================================================================

/**
 * Pick the next PM via least-loaded round-robin.
 *
 * "Load" = count of flags with status OPEN or ACKNOWLEDGED currently assigned.
 * Tie-break: least-recent `assignedAt` of the user's most recent assignment
 *            (oldest first). Final tie-break: user.id ascending for determinism.
 *
 * Returns null if no PMs exist (caller decides whether to leave unassigned).
 */
export async function assignNextPm(): Promise<string | null> {
  if (!prisma) return null;

  // Eligible PMs: any user whose roles array contains PROJECT_MANAGER.
  // Postgres array containment via Prisma's `has` operator.
  const pms = await prisma.user.findMany({
    where: { roles: { has: UserRole.PROJECT_MANAGER } },
    select: { id: true },
  });

  if (pms.length === 0) return null;
  if (pms.length === 1) return pms[0].id;

  // Aggregate load (open flags) per PM.
  const loads = await prisma.pmFlag.groupBy({
    by: ["assignedToUserId"],
    where: {
      assignedToUserId: { in: pms.map(p => p.id) },
      status: { in: OPEN_STATUSES },
    },
    _count: { _all: true },
  });

  const loadByUser = new Map<string, number>(
    loads.map(l => [l.assignedToUserId!, l._count._all])
  );

  // Most-recent assignment per PM (for tiebreaker).
  const recents = await prisma.pmFlag.groupBy({
    by: ["assignedToUserId"],
    where: { assignedToUserId: { in: pms.map(p => p.id) } },
    _max: { assignedAt: true },
  });
  const lastAssignedAt = new Map<string, Date | null>(
    recents.map(r => [r.assignedToUserId!, r._max.assignedAt])
  );

  // Sort: ascending load, then ascending lastAssignedAt (oldest first / null first), then id.
  const sorted = [...pms].sort((a, b) => {
    const loadA = loadByUser.get(a.id) ?? 0;
    const loadB = loadByUser.get(b.id) ?? 0;
    if (loadA !== loadB) return loadA - loadB;

    const lastA = lastAssignedAt.get(a.id);
    const lastB = lastAssignedAt.get(b.id);
    // null (never assigned) wins over any date.
    if (!lastA && lastB) return -1;
    if (lastA && !lastB) return 1;
    if (lastA && lastB) {
      const diff = lastA.getTime() - lastB.getTime();
      if (diff !== 0) return diff;
    }
    return a.id.localeCompare(b.id);
  });

  return sorted[0].id;
}

// =============================================================================
// Create
// =============================================================================

/**
 * Create a new flag and assign a PM in a single transaction.
 *
 * Idempotent on `(source, externalRef)` when externalRef is provided — a repeat
 * call with the same key returns the existing flag with `alreadyExisted: true`.
 * This is what makes HubSpot workflow retries safe.
 */
export async function createFlag(input: CreateFlagInput): Promise<CreateFlagResult> {
  if (!prisma) throw new Error("Database not configured");

  // Idempotency check first (avoid wasted assignment work on repeat calls).
  if (input.externalRef) {
    const existing = await prisma.pmFlag.findUnique({
      where: {
        source_externalRef: {
          source: input.source,
          externalRef: input.externalRef,
        },
      },
      include: {
        events: { orderBy: { createdAt: "asc" } },
        assignedToUser: { select: { id: true, email: true, name: true } },
        raisedByUser: { select: { id: true, email: true, name: true } },
        resolvedByUser: { select: { id: true, email: true, name: true } },
      },
    });
    if (existing) return { flag: existing, alreadyExisted: true };
  }

  const assigneeId = await assignNextPm();
  const now = new Date();

  const flag = await prisma.$transaction(async tx => {
    const created = await tx.pmFlag.create({
      data: {
        hubspotDealId: input.hubspotDealId,
        dealName: input.dealName ?? null,
        type: input.type,
        severity: input.severity,
        status: PmFlagStatusEnum.OPEN,
        reason: input.reason,
        source: input.source,
        externalRef: input.externalRef ?? null,
        metadata: (input.metadata ?? undefined) as never,
        raisedByUserId: input.raisedByUserId ?? null,
        raisedAt: now,
        assignedToUserId: assigneeId,
        assignedAt: assigneeId ? now : null,
        events: {
          create: [
            {
              eventType: PmFlagEventType.RAISED,
              actorUserId: input.raisedByUserId ?? null,
              notes: input.reason.slice(0, 500),
            },
            ...(assigneeId
              ? [
                  {
                    eventType: PmFlagEventType.ASSIGNED,
                    actorUserId: null, // system
                    notes: "Round-robin auto-assignment",
                  },
                ]
              : []),
          ],
        },
      },
      include: {
        events: { orderBy: { createdAt: "asc" } },
        assignedToUser: { select: { id: true, email: true, name: true } },
        raisedByUser: { select: { id: true, email: true, name: true } },
        resolvedByUser: { select: { id: true, email: true, name: true } },
      },
    });
    return created;
  });

  // ActivityLog entries (best-effort, outside the txn so failure doesn't roll back the flag).
  await logActivity({
    type: ActivityType.PM_FLAG_RAISED,
    description: `Flag raised on deal ${input.hubspotDealId}: ${input.type} (${input.severity})`,
    userId: input.raisedByUserId ?? undefined,
    userEmail: input.raisedByEmail ?? undefined,
    entityType: "PmFlag",
    entityId: flag.id,
    entityName: input.dealName ?? input.hubspotDealId,
    metadata: {
      hubspotDealId: input.hubspotDealId,
      type: input.type,
      severity: input.severity,
      source: input.source,
    },
    riskLevel:
      input.severity === "CRITICAL" ? "CRITICAL"
      : input.severity === "HIGH" ? "HIGH"
      : input.severity === "MEDIUM" ? "MEDIUM"
      : "LOW",
  });
  if (assigneeId) {
    await logActivity({
      type: ActivityType.PM_FLAG_ASSIGNED,
      description: `Flag ${flag.id} auto-assigned to PM ${assigneeId}`,
      userId: assigneeId,
      entityType: "PmFlag",
      entityId: flag.id,
      metadata: { hubspotDealId: input.hubspotDealId, severity: input.severity },
    });
  }

  return { flag, alreadyExisted: false };
}

// =============================================================================
// Lifecycle transitions
// =============================================================================

export class FlagTransitionError extends Error {
  constructor(public code: "NOT_FOUND" | "FORBIDDEN" | "INVALID_STATE", message: string) {
    super(message);
    this.name = "FlagTransitionError";
  }
}

interface ActorContext {
  userId: string;
  userEmail?: string;
  isAdmin: boolean;
}

async function getFlagOrThrow(id: string): Promise<PmFlag> {
  if (!prisma) throw new Error("Database not configured");
  const flag = await prisma.pmFlag.findUnique({ where: { id } });
  if (!flag) throw new FlagTransitionError("NOT_FOUND", `Flag ${id} not found`);
  return flag;
}

/** Acknowledge a flag — only the assignee can. Moves OPEN → ACKNOWLEDGED. */
export async function acknowledgeFlag(id: string, actor: ActorContext): Promise<PmFlagWithEvents> {
  if (!prisma) throw new Error("Database not configured");
  const flag = await getFlagOrThrow(id);

  if (flag.status !== PmFlagStatusEnum.OPEN) {
    throw new FlagTransitionError("INVALID_STATE", `Flag ${id} is ${flag.status}, cannot acknowledge`);
  }
  if (!actor.isAdmin && flag.assignedToUserId !== actor.userId) {
    throw new FlagTransitionError("FORBIDDEN", "Only the assigned PM (or admin) can acknowledge");
  }

  const now = new Date();
  const updated = await prisma.pmFlag.update({
    where: { id },
    data: {
      status: PmFlagStatusEnum.ACKNOWLEDGED,
      acknowledgedAt: now,
      events: {
        create: { eventType: PmFlagEventType.ACKNOWLEDGED, actorUserId: actor.userId },
      },
    },
    include: {
      events: { orderBy: { createdAt: "asc" } },
      assignedToUser: { select: { id: true, email: true, name: true } },
      raisedByUser: { select: { id: true, email: true, name: true } },
      resolvedByUser: { select: { id: true, email: true, name: true } },
    },
  });

  await logActivity({
    type: ActivityType.PM_FLAG_ACKNOWLEDGED,
    description: `Flag ${id} acknowledged`,
    userId: actor.userId,
    userEmail: actor.userEmail,
    entityType: "PmFlag",
    entityId: id,
  });

  return updated;
}

/** Resolve a flag — assignee or admin only. Sets resolvedAt, status RESOLVED. */
export async function resolveFlag(
  id: string,
  notes: string,
  actor: ActorContext
): Promise<PmFlagWithEvents> {
  if (!prisma) throw new Error("Database not configured");
  const flag = await getFlagOrThrow(id);

  if (flag.status === PmFlagStatusEnum.RESOLVED || flag.status === PmFlagStatusEnum.CANCELLED) {
    throw new FlagTransitionError("INVALID_STATE", `Flag ${id} is already ${flag.status}`);
  }
  if (!actor.isAdmin && flag.assignedToUserId !== actor.userId) {
    throw new FlagTransitionError("FORBIDDEN", "Only the assigned PM (or admin) can resolve");
  }

  const now = new Date();
  const updated = await prisma.pmFlag.update({
    where: { id },
    data: {
      status: PmFlagStatusEnum.RESOLVED,
      resolvedAt: now,
      resolvedByUserId: actor.userId,
      resolvedNotes: notes,
      events: {
        create: {
          eventType: PmFlagEventType.RESOLVED,
          actorUserId: actor.userId,
          notes,
        },
      },
    },
    include: {
      events: { orderBy: { createdAt: "asc" } },
      assignedToUser: { select: { id: true, email: true, name: true } },
      raisedByUser: { select: { id: true, email: true, name: true } },
      resolvedByUser: { select: { id: true, email: true, name: true } },
    },
  });

  await logActivity({
    type: ActivityType.PM_FLAG_RESOLVED,
    description: `Flag ${id} resolved`,
    userId: actor.userId,
    userEmail: actor.userEmail,
    entityType: "PmFlag",
    entityId: id,
    metadata: { notes: notes.slice(0, 500) },
  });

  return updated;
}

/** Reassign a flag — admin or current assignee can. */
export async function reassignFlag(
  id: string,
  newAssigneeId: string,
  actor: ActorContext
): Promise<PmFlagWithEvents> {
  if (!prisma) throw new Error("Database not configured");
  const flag = await getFlagOrThrow(id);

  if (flag.status === PmFlagStatusEnum.RESOLVED || flag.status === PmFlagStatusEnum.CANCELLED) {
    throw new FlagTransitionError("INVALID_STATE", `Cannot reassign a ${flag.status} flag`);
  }
  if (!actor.isAdmin && flag.assignedToUserId !== actor.userId) {
    throw new FlagTransitionError("FORBIDDEN", "Only the current assignee or admin can reassign");
  }

  // Verify new assignee is a PM.
  const newAssignee = await prisma.user.findUnique({
    where: { id: newAssigneeId },
    select: { id: true, roles: true },
  });
  if (!newAssignee || !newAssignee.roles.includes(UserRole.PROJECT_MANAGER)) {
    throw new FlagTransitionError("INVALID_STATE", `User ${newAssigneeId} is not a PROJECT_MANAGER`);
  }

  const now = new Date();
  const updated = await prisma.pmFlag.update({
    where: { id },
    data: {
      assignedToUserId: newAssigneeId,
      assignedAt: now,
      // Reset acknowledged state — new assignee should re-acknowledge.
      status: PmFlagStatusEnum.OPEN,
      acknowledgedAt: null,
      events: {
        create: {
          eventType: PmFlagEventType.REASSIGNED,
          actorUserId: actor.userId,
          notes: `Reassigned from ${flag.assignedToUserId ?? "(unassigned)"} to ${newAssigneeId}`,
          metadata: {
            previousAssigneeId: flag.assignedToUserId,
            newAssigneeId,
          },
        },
      },
    },
    include: {
      events: { orderBy: { createdAt: "asc" } },
      assignedToUser: { select: { id: true, email: true, name: true } },
      raisedByUser: { select: { id: true, email: true, name: true } },
      resolvedByUser: { select: { id: true, email: true, name: true } },
    },
  });

  await logActivity({
    type: ActivityType.PM_FLAG_REASSIGNED,
    description: `Flag ${id} reassigned to ${newAssigneeId}`,
    userId: actor.userId,
    userEmail: actor.userEmail,
    entityType: "PmFlag",
    entityId: id,
    metadata: {
      previousAssigneeId: flag.assignedToUserId,
      newAssigneeId,
    },
  });

  return updated;
}

/** Append a note event to a flag (no state change). Anyone with view access can. */
export async function addNote(id: string, notes: string, actor: ActorContext): Promise<PmFlagEvent> {
  if (!prisma) throw new Error("Database not configured");
  await getFlagOrThrow(id);

  const event = await prisma.pmFlagEvent.create({
    data: {
      flagId: id,
      eventType: PmFlagEventType.NOTE_ADDED,
      actorUserId: actor.userId,
      notes,
    },
  });

  await logActivity({
    type: ActivityType.PM_FLAG_NOTE_ADDED,
    description: `Note added to flag ${id}`,
    userId: actor.userId,
    userEmail: actor.userEmail,
    entityType: "PmFlag",
    entityId: id,
  });

  return event;
}

/** Cancel a flag — admin only. Used when a flag was raised in error. */
export async function cancelFlag(id: string, reason: string, actor: ActorContext): Promise<PmFlagWithEvents> {
  if (!prisma) throw new Error("Database not configured");
  const flag = await getFlagOrThrow(id);

  if (!actor.isAdmin) {
    throw new FlagTransitionError("FORBIDDEN", "Only admins can cancel flags");
  }
  if (flag.status === PmFlagStatusEnum.RESOLVED || flag.status === PmFlagStatusEnum.CANCELLED) {
    throw new FlagTransitionError("INVALID_STATE", `Flag ${id} is already ${flag.status}`);
  }

  const updated = await prisma.pmFlag.update({
    where: { id },
    data: {
      status: PmFlagStatusEnum.CANCELLED,
      events: {
        create: { eventType: PmFlagEventType.CANCELLED, actorUserId: actor.userId, notes: reason },
      },
    },
    include: {
      events: { orderBy: { createdAt: "asc" } },
      assignedToUser: { select: { id: true, email: true, name: true } },
      raisedByUser: { select: { id: true, email: true, name: true } },
      resolvedByUser: { select: { id: true, email: true, name: true } },
    },
  });

  await logActivity({
    type: ActivityType.PM_FLAG_CANCELLED,
    description: `Flag ${id} cancelled`,
    userId: actor.userId,
    userEmail: actor.userEmail,
    entityType: "PmFlag",
    entityId: id,
    metadata: { reason },
  });

  return updated;
}

// =============================================================================
// Queries
// =============================================================================

export interface ListFlagsFilter {
  status?: PmFlagStatus[];
  severity?: PmFlagSeverity[];
  type?: PmFlagType[];
  assignedToUserId?: string | null; // null = unassigned
  hubspotDealId?: string;
  limit?: number;
}

/** List flags with optional filters. Caller must enforce role-based scoping. */
export async function listFlags(filter: ListFlagsFilter = {}): Promise<PmFlagWithEvents[]> {
  if (!prisma) return [];

  const where: Record<string, unknown> = {};
  if (filter.status?.length) where.status = { in: filter.status };
  if (filter.severity?.length) where.severity = { in: filter.severity };
  if (filter.type?.length) where.type = { in: filter.type };
  if (filter.hubspotDealId) where.hubspotDealId = filter.hubspotDealId;
  if (filter.assignedToUserId === null) where.assignedToUserId = null;
  else if (filter.assignedToUserId) where.assignedToUserId = filter.assignedToUserId;

  return prisma.pmFlag.findMany({
    where,
    include: {
      events: { orderBy: { createdAt: "asc" } },
      assignedToUser: { select: { id: true, email: true, name: true } },
      raisedByUser: { select: { id: true, email: true, name: true } },
      resolvedByUser: { select: { id: true, email: true, name: true } },
    },
    orderBy: [
      // Severity sort: CRITICAL first. Postgres orders enums by definition order, which
      // matches our enum (LOW, MEDIUM, HIGH, CRITICAL) — so DESC gives CRITICAL first.
      { severity: "desc" },
      { raisedAt: "desc" },
    ],
    take: filter.limit ?? 200,
  });
}

/** Fetch a single flag with full event timeline. */
export async function getFlag(id: string): Promise<PmFlagWithEvents | null> {
  if (!prisma) return null;
  return prisma.pmFlag.findUnique({
    where: { id },
    include: {
      events: { orderBy: { createdAt: "asc" } },
      assignedToUser: { select: { id: true, email: true, name: true } },
      raisedByUser: { select: { id: true, email: true, name: true } },
      resolvedByUser: { select: { id: true, email: true, name: true } },
    },
  });
}

// Re-export enums for callers (so they don't import from @/generated/prisma directly).
export {
  PmFlagStatusEnum as PmFlagStatusValues,
  PmFlagSourceEnum as PmFlagSourceValues,
  PmFlagEventType as PmFlagEventTypeValues,
};
