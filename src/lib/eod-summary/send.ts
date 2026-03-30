// src/lib/eod-summary/send.ts
//
// Main orchestrator for the EOD summary email.
// Runs idempotency check, loads snapshots, diffs, detects milestones,
// queries tasks, builds the email, and sends it.

import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { sendEmailMessage } from "@/lib/email";
import { buildStageDisplayMap } from "@/lib/daily-focus/format";
import { MANAGER_EMAIL, PI_LEADS, DESIGN_LEADS } from "./config";
import {
  queryAllBroad,
  loadSnapshot,
  diffSnapshots,
  cleanupOldSnapshots,
  getTodayDenver,
} from "./snapshot";
import {
  detectMilestones,
  enrichMilestones,
  clearUserIdMapCache,
} from "./milestones";
import { queryCompletedTasks } from "./tasks";
import { buildEodEmail } from "./html";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EodSummaryResult {
  sent: boolean;
  skipped: boolean;
  skipReason?: string;
  dryRun: boolean;
  errors: string[];
  changeCount: number;
  milestoneCount: number;
  taskCount: number;
  newDealCount: number;
  resolvedDealCount: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const IDEMPOTENCY_SCOPE = "eod-summary";
const IDEMPOTENCY_TTL_HOURS = 26; // slightly more than 24 so it covers midnight edge cases

// ── Main Orchestrator ─────────────────────────────────────────────────────────

export async function runEodSummary(options: {
  dryRun: boolean;
}): Promise<EodSummaryResult> {
  const { dryRun } = options;
  const errors: string[] = [];

  const todayStr = getTodayDenver(); // "YYYY-MM-DD"
  const idempotencyKey = `eod-summary:${todayStr}`;

  // ── 1. Idempotency check (skip on dryRun) ───────────────────────────────────
  let idempotencyId: string | null = null;

  if (!dryRun) {
    try {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + IDEMPOTENCY_TTL_HOURS);

      const record = await prisma.idempotencyKey.create({
        data: {
          key: idempotencyKey,
          scope: IDEMPOTENCY_SCOPE,
          status: "processing",
          expiresAt,
        },
      });
      idempotencyId = record.id;
    } catch (err) {
      // Unique constraint violation → key exists for today
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.toLowerCase().includes("unique") ||
        msg.toLowerCase().includes("duplicate")
      ) {
        // Try to reclaim a "failed" key — allows automatic retry after errors
        try {
          const reclaimed = await prisma.idempotencyKey.updateMany({
            where: {
              key: idempotencyKey,
              scope: IDEMPOTENCY_SCOPE,
              status: "failed",
            },
            data: { status: "processing" },
          });
          if (reclaimed.count > 0) {
            console.log(`[eod-summary] Reclaimed failed key for ${todayStr}, retrying.`);
            const reclaimedRecord = await prisma.idempotencyKey.findFirst({
              where: { key: idempotencyKey, scope: IDEMPOTENCY_SCOPE },
            });
            idempotencyId = reclaimedRecord?.id ?? null;
          } else {
            // Key is "processing" or "completed" — another run owns it
            console.log(
              `[eod-summary] Already ran today (${todayStr}), skipping.`
            );
            return {
              sent: false,
              skipped: true,
              skipReason: `Already sent for ${todayStr}`,
              dryRun,
              errors: [],
              changeCount: 0,
              milestoneCount: 0,
              taskCount: 0,
              newDealCount: 0,
              resolvedDealCount: 0,
            };
          }
        } catch (reclaimErr) {
          console.error("[eod-summary] Idempotency reclaim failed, proceeding:", reclaimErr);
        }
      } else {
        // Unexpected error — log and continue without idempotency guard
        const errorMsg = `Idempotency insert failed: ${msg}`;
        console.error(`[eod-summary] ${errorMsg}`);
        errors.push(errorMsg);
        Sentry.captureException(err, { tags: { module: "eod-summary", step: "idempotency" } });
      }
    }
  }

  // ── Helper: mark idempotency key as completed or failed ─────────────────────
  async function finalizeIdempotencyKey(status: "completed" | "failed") {
    if (!idempotencyId) return;
    try {
      await prisma.idempotencyKey.update({
        where: { id: idempotencyId },
        data: { status },
      });
    } catch (err) {
      console.error("[eod-summary] Failed to finalize idempotency key:", err);
    }
  }

  try {
    // ── 2. Clear user ID map cache ───────────────────────────────────────────
    clearUserIdMapCache();

    // ── 3. Load morning snapshot from DB ────────────────────────────────────
    console.log("[eod-summary] Loading morning snapshot…");
    const { deals: morningDeals, dealOwnerMap } = await loadSnapshot();
    const morningDealCount = morningDeals.size;
    console.log(`[eod-summary] Morning snapshot: ${morningDealCount} deals`);

    // ── 4. Query evening state from HubSpot ─────────────────────────────────
    console.log("[eod-summary] Querying evening state from HubSpot…");
    const eveningResult = await queryAllBroad();
    const { deals: eveningDeals, failedOwnerIds } = eveningResult;
    console.log(`[eod-summary] Evening query: ${eveningDeals.size} deals, ${failedOwnerIds.size} failed owner(s)`);

    if (failedOwnerIds.size > 0) {
      errors.push(
        `HubSpot query failed for ${failedOwnerIds.size} owner(s): ${[...failedOwnerIds].join(", ")}`
      );
    }

    // ── 5. Diff snapshots ────────────────────────────────────────────────────
    let changes: ReturnType<typeof diffSnapshots>["changes"] = [];
    let newDeals: ReturnType<typeof diffSnapshots>["newDeals"] = [];
    let resolvedDeals: ReturnType<typeof diffSnapshots>["resolvedDeals"] = [];

    if (morningDealCount === 0) {
      errors.push("No morning baseline — snapshot may not have run this morning.");
      console.warn("[eod-summary] No morning baseline found; skipping diff.");
    } else {
      const diffResult = diffSnapshots(morningDeals, eveningDeals, {
        failedOwnerIds,
        dealOwnerMap,
      });
      changes = diffResult.changes;
      newDeals = diffResult.newDeals;
      resolvedDeals = diffResult.resolvedDeals;
      console.log(
        `[eod-summary] Diff: ${changes.length} changes, ${newDeals.length} new, ${resolvedDeals.length} resolved`
      );
    }

    const stillInScopeCount = eveningDeals.size;

    // ── 6. Detect + enrich milestones ────────────────────────────────────────
    console.log("[eod-summary] Detecting milestones…");
    const rawMilestones = detectMilestones(changes);
    const milestones = await enrichMilestones(rawMilestones);
    console.log(`[eod-summary] Milestones: ${milestones.length}`);

    // ── 7. Query completed tasks ─────────────────────────────────────────────
    console.log("[eod-summary] Querying completed tasks…");
    const { tasks, error: tasksError } = await queryCompletedTasks();
    if (tasksError) {
      errors.push(`Task query failed: ${tasksError}`);
    }
    console.log(`[eod-summary] Tasks: ${tasks.length}`);

    // ── 8. Build stage display map ───────────────────────────────────────────
    const stageMap = await buildStageDisplayMap();

    // ── 9. Build owner name map from lead rosters ────────────────────────────
    const ownerNameMap = new Map<string, string>();
    for (const lead of PI_LEADS) {
      ownerNameMap.set(lead.hubspotOwnerId, lead.name);
    }
    for (const lead of DESIGN_LEADS) {
      ownerNameMap.set(lead.hubspotOwnerId, lead.name);
    }

    // ── 10. Build EOD email HTML ─────────────────────────────────────────────
    console.log("[eod-summary] Building email…");
    const { html, text } = buildEodEmail({
      changes,
      milestones,
      tasks,
      newDeals,
      resolvedDeals,
      stageMap,
      morningDealCount,
      stillInScopeCount,
      errors,
      dryRun,
      dealPropertyOwners: eveningResult.dealPropertyOwners,
      ownerNameMap,
    });

    // ── 11. Send email ───────────────────────────────────────────────────────
    const subject = dryRun
      ? `[DRY RUN] EOD Summary — ${todayStr}`
      : `EOD Summary — ${todayStr}`;

    console.log(
      `[eod-summary] Sending email to ${MANAGER_EMAIL} (dryRun=${dryRun})…`
    );

    await sendEmailMessage({
      to: MANAGER_EMAIL,
      subject,
      html,
      text,
      debugFallbackTitle: subject,
      debugFallbackBody: text,
    });

    console.log("[eod-summary] Email sent.");

    // ── 12. Cleanup old snapshots (best-effort) ──────────────────────────────
    try {
      const deleted = await cleanupOldSnapshots();
      console.log(`[eod-summary] Cleaned up ${deleted} old snapshot row(s).`);
    } catch (cleanupErr) {
      console.warn("[eod-summary] Snapshot cleanup failed (non-fatal):", cleanupErr);
    }

    // ── 13. Mark idempotency key completed ───────────────────────────────────
    await finalizeIdempotencyKey("completed");

    return {
      sent: true,
      skipped: false,
      dryRun,
      errors,
      changeCount: changes.length,
      milestoneCount: milestones.length,
      taskCount: tasks.length,
      newDealCount: newDeals.length,
      resolvedDealCount: resolvedDeals.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[eod-summary] Fatal error:", err);
    Sentry.captureException(err, { tags: { module: "eod-summary" } });

    await finalizeIdempotencyKey("failed");

    return {
      sent: false,
      skipped: false,
      dryRun,
      errors: [...errors, msg],
      changeCount: 0,
      milestoneCount: 0,
      taskCount: 0,
      newDealCount: 0,
      resolvedDealCount: 0,
    };
  }
}
