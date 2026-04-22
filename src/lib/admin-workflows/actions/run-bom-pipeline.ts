/**
 * Action: Trigger the BOM pipeline for a deal.
 *
 * Emits the same Inngest event that the existing design-complete webhook
 * emits, using MANUAL as the trigger type (indicating admin-composed).
 * Creates a BomPipelineRun row to track it.
 *
 * This is a fire-and-queue action — the BOM pipeline runs async in its
 * own Inngest function. This action returns as soon as the event is
 * accepted.
 */

import { z } from "zod";

import { prisma } from "@/lib/db";
import { acquirePipelineLock, DuplicateRunError } from "@/lib/bom-pipeline-lock";
import {
  bomDesignCompleteRequested,
  inngest,
} from "@/lib/inngest-client";
import type { AdminWorkflowAction } from "@/lib/admin-workflows/types";

const inputsSchema = z.object({
  dealId: z.string().min(1),
});

export const runBomPipelineAction: AdminWorkflowAction<
  z.infer<typeof inputsSchema>,
  { runId: string; dealId: string; alreadyRunning?: boolean }
> = {
  kind: "run-bom-pipeline",
  name: "Run BOM pipeline",
  description: "Trigger the BOM extraction + Zoho Sales Order pipeline for a HubSpot deal.",
  category: "PB Ops",
  fields: [
    {
      key: "dealId",
      label: "HubSpot deal ID",
      kind: "text",
      placeholder: "{{trigger.objectId}}",
      required: true,
    },
  ],
  inputsSchema,
  handler: async ({ inputs }) => {
    if (!prisma) throw new Error("Database not configured");

    let runId: string;
    try {
      runId = await acquirePipelineLock(inputs.dealId, "MANUAL");
    } catch (e) {
      if (e instanceof DuplicateRunError) {
        // Another run for this deal is in flight — that's fine, return gracefully
        return {
          runId: "(duplicate)",
          dealId: inputs.dealId,
          alreadyRunning: true,
        };
      }
      throw e;
    }

    await inngest.send(
      bomDesignCompleteRequested.create({
        runId,
        dealId: inputs.dealId,
        trigger: "MANUAL",
      }),
    );

    return { runId, dealId: inputs.dealId };
  },
};
