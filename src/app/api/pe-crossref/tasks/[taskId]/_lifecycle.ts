/**
 * Task lifecycle state transitions (pure logic).
 *
 * Split out from the route handler so it can be unit-tested without
 * Next.js / Prisma context.
 */

import type { TaskStatus } from "@/lib/pe-crossref/types";

export type ManualAction = "resolve" | "dismiss" | "reopen";

export interface ManualChangeInput {
  currentStatus: TaskStatus;
  action: ManualAction;
  userEmail: string;
  reason?: string;
}

export interface ManualChangeOutput {
  status: TaskStatus;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  manualResolvedAt: Date | null;
  dismissedReason: string | null;
}

export function computeManualStatusChange(input: ManualChangeInput): ManualChangeOutput {
  const { action, userEmail, reason } = input;

  switch (action) {
    case "resolve": {
      const now = new Date();
      return {
        status: "RESOLVED_MANUAL",
        resolvedAt: now,
        resolvedBy: userEmail,
        manualResolvedAt: now,
        dismissedReason: null,
      };
    }
    case "dismiss": {
      if (!reason || !reason.trim()) {
        throw new Error("dismiss reason required");
      }
      return {
        status: "DISMISSED",
        resolvedAt: new Date(),
        resolvedBy: userEmail,
        manualResolvedAt: null,
        dismissedReason: reason.trim(),
      };
    }
    case "reopen": {
      return {
        status: "OPEN",
        resolvedAt: null,
        resolvedBy: null,
        manualResolvedAt: null,
        dismissedReason: null,
      };
    }
    default: {
      throw new Error(`invalid action: ${action as string}`);
    }
  }
}
