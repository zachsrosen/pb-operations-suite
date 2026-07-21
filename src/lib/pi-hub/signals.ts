/**
 * Approval-signal read model + state writes for the P&I hub UI. Server-only
 * (Prisma). Every read/write here is gated on the UI flag so the ApprovalSignal
 * table is never touched while the feature is dark (the table may not even
 * exist before Zach runs the migration), and Prisma failures degrade to
 * "no badge" rather than failing the queue/detail request.
 * Spec: docs/superpowers/specs/2026-07-20-approval-signals-design.md
 */

import { prisma } from "@/lib/db";
import {
  applyDismiss,
  CANDIDATE_STATUSES,
  type SignalStatus,
} from "@/lib/approval-scan/scan";
import type { SignalType } from "@/lib/approval-scan/classify";
import type {
  QueueItem,
  QueueSignal,
  SignalEvidenceView,
  Team,
} from "./types";

/** UI flag — NEXT_PUBLIC so the client bundle can read it too, but server
 *  code must ALSO gate on it: the queue/detail routes may not join signals
 *  (or query the table at all) while the flag is off. */
export function isApprovalSignalsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_APPROVAL_SIGNALS_ENABLED === "true";
}

export interface OpenSignal {
  signalType: SignalType;
  proposedStatus: string;
  confidence: "high" | "medium";
  evidence: SignalEvidenceView;
}

function toOpenSignal(row: {
  signalType: string;
  proposedStatus: string;
  confidence: string;
  evidence: unknown;
}): OpenSignal {
  // Evidence is schemaless Json — read defensively so one malformed row
  // can't take down the whole queue join.
  const ev = (row.evidence ?? {}) as Partial<SignalEvidenceView>;
  return {
    signalType: row.signalType as SignalType,
    proposedStatus: row.proposedStatus,
    confidence: row.confidence === "high" ? "high" : "medium",
    evidence: {
      quote: typeof ev.quote === "string" ? ev.quote : "",
      subject: typeof ev.subject === "string" ? ev.subject : "",
      mailbox: typeof ev.mailbox === "string" ? ev.mailbox : "",
      threadId: typeof ev.threadId === "string" ? ev.threadId : "",
      messageId: typeof ev.messageId === "string" ? ev.messageId : "",
      receivedAt: typeof ev.receivedAt === "string" ? ev.receivedAt : "",
    },
  };
}

/**
 * All OPEN signals for a team, keyed by dealId. A deal can hold one OPEN row
 * per signalType (unique on deal+team+signalType); the newest detection wins
 * the deal's single badge slot. Empty map when the flag is off or the table
 * is unavailable.
 */
export async function fetchOpenSignals(
  team: Team,
): Promise<Map<string, OpenSignal>> {
  const map = new Map<string, OpenSignal>();
  if (!isApprovalSignalsEnabled() || !prisma) return map;
  try {
    const rows = await prisma.approvalSignal.findMany({
      where: { team, status: "OPEN" },
      orderBy: { detectedAt: "desc" },
    });
    for (const row of rows) {
      if (map.has(row.hubspotDealId)) continue; // newest-first: first wins
      map.set(row.hubspotDealId, toOpenSignal(row));
    }
  } catch (err) {
    console.warn(`[pi-hub] open-signal fetch failed for ${team}:`, err);
  }
  return map;
}

/** Newest OPEN signal for one deal+team — the detail callout's source. */
export async function fetchOpenSignalForDeal(
  team: Team,
  dealId: string,
): Promise<OpenSignal | null> {
  if (!isApprovalSignalsEnabled() || !prisma) return null;
  try {
    const row = await prisma.approvalSignal.findFirst({
      where: { hubspotDealId: dealId, team, status: "OPEN" },
      orderBy: { detectedAt: "desc" },
    });
    return row ? toOpenSignal(row) : null;
  } catch (err) {
    console.warn(`[pi-hub] open-signal fetch failed for deal ${dealId}:`, err);
    return null;
  }
}

/** Pure join: attach each deal's open signal (or null) to its queue row. */
export function attachSignals(
  items: QueueItem[],
  signals: Map<string, OpenSignal>,
): QueueItem[] {
  return items.map((item) => {
    const s = signals.get(item.dealId);
    const signal: QueueSignal | null = s
      ? { signalType: s.signalType, confidence: s.confidence }
      : null;
    return { ...item, signal };
  });
}

/**
 * User dismissal — strikes the row's current evidence messageId via
 * applyDismiss (3rd DISTINCT dismissed message → MUTED) and persists the new
 * state. Returns the resulting status, or null when no such signal exists.
 * Not flag-gated: the route gates, and a dismissal is an explicit user action
 * on a row that could only have been rendered with the flag on.
 */
export async function dismissSignal(opts: {
  dealId: string;
  team: Team;
  signalType: string;
}): Promise<SignalStatus | null> {
  if (!prisma) throw new Error("Database not configured");
  const row = await prisma.approvalSignal.findUnique({
    where: {
      hubspotDealId_team_signalType: {
        hubspotDealId: opts.dealId,
        team: opts.team,
        signalType: opts.signalType,
      },
    },
  });
  if (!row) return null;

  const messageId =
    (row.evidence as { messageId?: string } | null)?.messageId ?? "";
  if (!messageId) {
    // Malformed evidence — nothing to strike. Plain dismiss: don't record ""
    // as a dismissed messageId or advance the three-strikes counter.
    if (row.status === "MUTED") return "MUTED";
    await prisma.approvalSignal.update({
      where: { id: row.id },
      data: { status: "DISMISSED" },
    });
    return "DISMISSED";
  }
  const next = applyDismiss(
    {
      status: row.status as SignalStatus,
      dismissedMessageIds: row.dismissedMessageIds,
      dismissCount: row.dismissCount,
    },
    messageId,
  );
  await prisma.approvalSignal.update({
    where: { id: row.id },
    data: {
      status: next.status,
      dismissedMessageIds: [...next.dismissedMessageIds],
      dismissCount: next.dismissCount,
    },
  });
  return next.status;
}

/**
 * Auto-resolve hook for the status write path: a successful HubSpot status
 * write that takes the deal OUT of the team's candidate (waiting-group)
 * statuses resolves that deal+team's OPEN/DISMISSED signals — the human has
 * acted, whether they picked the proposed status or any other non-waiting
 * status (once the deal leaves the candidate set the cron never revisits it,
 * so an unresolved row would show a stale badge forever). A write back INTO
 * a candidate status (e.g. a resubmission) leaves signals untouched. Runs
 * when either the scanner or the UI flag is on, so shadow mode (scan on,
 * UI off) doesn't accumulate stale OPEN rows. Never throws — the status
 * write already landed, and the table may not exist yet during dark launch.
 */
export async function resolveSignalsOnStatusWrite(opts: {
  dealId: string;
  team: Team;
  newStatus: string;
  userEmail: string;
}): Promise<void> {
  const scanEnabled = process.env.APPROVAL_SCAN_ENABLED === "true";
  if ((!scanEnabled && !isApprovalSignalsEnabled()) || !prisma) return;
  if (CANDIDATE_STATUSES[opts.team].includes(opts.newStatus)) return;
  try {
    await prisma.approvalSignal.updateMany({
      where: {
        hubspotDealId: opts.dealId,
        team: opts.team,
        status: { in: ["OPEN", "DISMISSED"] },
      },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedBy: opts.userEmail,
      },
    });
  } catch (err) {
    console.warn(
      `[pi-hub] signal auto-resolve failed for deal ${opts.dealId}:`,
      err,
    );
  }
}
