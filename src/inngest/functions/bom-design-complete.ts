/**
 * Inngest function: BOM design-complete pipeline orchestrator.
 *
 * Spike scope: wraps the existing runDesignCompletePipeline() in a single
 * step.run() call so we get Inngest's concurrency control, automatic retries,
 * and run history UI without rewriting the pipeline internals.
 *
 * The pipeline already handles per-stage retry via withRetry() and persists
 * progress to BomPipelineRun — preserving that keeps this spike low-risk.
 * A phase 2 refactor would split the 7 internal stages into separate
 * step.run() calls for resumable execution.
 *
 * Concurrency: limit 1 per dealId. Replaces the hand-rolled partial unique
 * index + stale-lock recovery for any run originated through Inngest. The
 * DB lock remains in place as defense-in-depth (the webhook still calls
 * acquirePipelineLock before sending the event).
 *
 * Retries: Inngest retries this function automatically on thrown errors.
 * We rely on the pipeline to return rather than throw for expected failures
 * (customer-not-found → status "partial"), so Inngest only retries on
 * genuine infrastructure errors (e.g. DB timeout during updateRun).
 */

import {
  bomDesignCompleteRequested,
  inngest,
} from "@/lib/inngest-client";
import { runDesignCompletePipeline } from "@/lib/bom-pipeline";

export const bomDesignCompletePipeline = inngest.createFunction(
  {
    id: "bom-design-complete-pipeline",
    name: "BOM: Design-complete pipeline",
    triggers: [bomDesignCompleteRequested],
    concurrency: {
      key: "event.data.dealId",
      limit: 1,
    },
    retries: 2,
  },
  async ({ event, step }) => {
    const { runId, dealId, trigger } = event.data;

    const result = await step.run("run-pipeline", () =>
      runDesignCompletePipeline(runId, dealId, trigger),
    );

    return {
      runId,
      dealId,
      status: result.status,
      snapshotVersion: result.snapshotVersion,
      zohoSoNumber: result.zohoSoNumber,
      durationMs: result.durationMs,
    };
  },
);
