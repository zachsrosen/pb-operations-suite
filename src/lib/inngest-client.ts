/**
 * Inngest client — spike for BOM pipeline orchestration.
 *
 * See docs/superpowers/plans/2026-04-22-inngest-bom-spike.md for the rollout plan.
 *
 * Gated on INNGEST_BOM_ENABLED (boolean feature flag). When the flag is off,
 * the design-complete webhook continues to run the pipeline via waitUntil()
 * exactly as before — no Inngest traffic.
 *
 * Required env vars (set in Vercel when flipping the flag on):
 *   INNGEST_EVENT_KEY   — signing key for event ingestion (from Inngest dashboard)
 *   INNGEST_SIGNING_KEY — verifies inbound requests to /api/inngest
 *   INNGEST_BOM_ENABLED — "true" to route design-complete webhook through Inngest
 */

import { Inngest, eventType } from "inngest";
import { z } from "zod";

import type { BomPipelineTrigger } from "@/generated/prisma/enums";

export const bomDesignCompleteRequested = eventType(
  "bom/design-complete.requested",
  {
    schema: z.object({
      runId: z.string(),
      dealId: z.string(),
      trigger: z.enum([
        "WEBHOOK_DESIGN_COMPLETE",
        "WEBHOOK_READY_TO_BUILD",
        "WEBHOOK_INSTALL_SCHEDULED",
        "MANUAL",
        "CRON",
      ] as const satisfies readonly BomPipelineTrigger[]),
    }),
  },
);

export const inngest = new Inngest({ id: "pb-ops-suite" });

export function isInngestBomEnabled(): boolean {
  return process.env.INNGEST_BOM_ENABLED === "true";
}
