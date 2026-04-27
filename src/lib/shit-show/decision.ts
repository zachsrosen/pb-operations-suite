/**
 * Shit Show — decision orchestrator
 *
 * applyDecision is the canonical write path for "user clicked a decision button"
 * in the Shit Show meeting hub. Handles all 4 outcomes:
 *
 *   - RESOLVED       → clear HubSpot flag, update item
 *   - STILL_PROBLEM  → update item only
 *   - ESCALATED      → atomic transaction: update item + create IdrEscalationQueue row;
 *                      then best-effort HubSpot task to deal owner
 *   - DEFERRED       → update item only
 *
 * Rationale required for STILL_PROBLEM, ESCALATED, DEFERRED.
 */

import { prisma } from "@/lib/db";
import { setShitShowFlag } from "@/lib/shit-show/hubspot-flag";
import { scheduleHubspotEscalationTask } from "@/lib/shit-show/hubspot-task";

export type ShitShowDecisionValue = "RESOLVED" | "STILL_PROBLEM" | "ESCALATED" | "DEFERRED";

export type ApplyDecisionInput = {
  itemId: string;
  dealId: string;
  decision: ShitShowDecisionValue;
  decisionRationale: string | null;
  userEmail: string;
  dealName: string;
  region: string;
};

const RATIONALE_REQUIRED: ReadonlySet<ShitShowDecisionValue> = new Set([
  "STILL_PROBLEM",
  "ESCALATED",
  "DEFERRED",
]);

export async function applyDecision(input: ApplyDecisionInput): Promise<void> {
  if (RATIONALE_REQUIRED.has(input.decision) && !input.decisionRationale?.trim()) {
    throw new Error("decisionRationale required for this decision");
  }

  const now = new Date();

  if (input.decision === "ESCALATED") {
    // Atomic: update item + create IdrEscalationQueue row in one transaction.
    let escalationRowId: string | null = null;
    await prisma.$transaction(async (tx) => {
      await tx.shitShowSessionItem.update({
        where: { id: input.itemId },
        data: {
          decision: "ESCALATED",
          decisionRationale: input.decisionRationale,
          resolvedAt: now,
          resolvedBy: input.userEmail,
        },
      });
      const row = await tx.idrEscalationQueue.create({
        data: {
          dealId: input.dealId,
          dealName: input.dealName,
          region: input.region,
          queueType: "ESCALATION",
          reason: input.decisionRationale!,
          requestedBy: input.userEmail,
        },
      });
      escalationRowId = row.id;
    });

    if (escalationRowId) {
      await prisma.shitShowSessionItem.update({
        where: { id: input.itemId },
        data: { idrEscalationQueueId: escalationRowId },
      });
    }

    // Best-effort HubSpot task (separate from transaction).
    try {
      await scheduleHubspotEscalationTask({
        sessionItemId: input.itemId,
        dealId: input.dealId,
        reason: input.decisionRationale!,
      });
    } catch (e) {
      console.error("[shit-show] escalation task scheduling failed", e);
    }
    return;
  }

  // Non-escalation decisions: simple update + maybe clear flag.
  await prisma.shitShowSessionItem.update({
    where: { id: input.itemId },
    data: {
      decision: input.decision,
      decisionRationale: input.decisionRationale,
      resolvedAt: now,
      resolvedBy: input.userEmail,
    },
  });

  if (input.decision === "RESOLVED") {
    try {
      await setShitShowFlag(input.dealId, false);
    } catch (e) {
      console.error("[shit-show] failed to clear HubSpot flag on RESOLVED", e);
    }
  }
}
