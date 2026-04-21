import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { upsertEstimatorContact, createEstimatorDeal } from "@/lib/estimator/hubspot";
import {
  ESTIMATOR_SOURCE_STANDARD,
  RECONCILE_MIN_AGE_MS,
  RECONCILE_MAX_RETRIES,
} from "@/lib/estimator";
import type { EstimatorInput, EstimatorResult } from "@/lib/estimator";

const SALES_PIPELINE_ID = process.env.HUBSPOT_PIPELINE_SALES ?? "default";
const SALES_FIRST_STAGE_ID = process.env.HUBSPOT_PIPELINE_SALES_FIRST_STAGE ?? "appointmentscheduled";

function checkCronAuth(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!checkCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RECONCILE_MIN_AGE_MS);
  const pending = await prisma.estimatorRun.findMany({
    where: {
      hubspotDealId: null,
      createdAt: { lt: cutoff },
      outOfArea: false,
      manualQuoteRequest: false,
      retryCount: { lt: RECONCILE_MAX_RETRIES },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  let succeeded = 0;
  let failed = 0;

  for (const run of pending) {
    try {
      const input = run.inputSnapshot as unknown as EstimatorInput;
      const result = run.resultSnapshot as unknown as EstimatorResult | null;
      const contact = run.contactSnapshot as unknown as {
        firstName: string;
        lastName: string;
        email: string;
        phone?: string;
      };

      let contactId = run.hubspotContactId;
      if (!contactId) {
        const r = await upsertEstimatorContact({
          email: contact.email,
          firstName: contact.firstName,
          lastName: contact.lastName,
          phone: contact.phone,
          address: input.address,
          lifecyclestage: "lead",
        });
        contactId = r.contactId;
        await prisma.estimatorRun.update({ where: { id: run.id }, data: { hubspotContactId: contactId } });
      }

      const dealName = `${contact.firstName} ${contact.lastName} — ${input.address.city}, ${input.address.state}`;
      const { dealId } = await createEstimatorDeal({
        contactId,
        dealName,
        pipelineId: SALES_PIPELINE_ID,
        stageId: SALES_FIRST_STAGE_ID,
        amount: result?.pricing.finalUsd ?? 0,
        source: ESTIMATOR_SOURCE_STANDARD,
        resultsToken: run.token,
        result: result ?? undefined,
        considerations: {
          planningEv: input.considerations?.planningEv ?? false,
          needsPanelUpgrade: input.considerations?.needsPanelUpgrade ?? false,
          mayNeedNewRoof: input.considerations?.mayNeedNewRoof ?? false,
        },
        addOns: {
          evCharger: input.addOns?.evCharger ?? false,
          panelUpgrade: input.addOns?.panelUpgrade ?? false,
        },
      });
      await prisma.estimatorRun.update({
        where: { id: run.id },
        data: { hubspotDealId: dealId },
      });
      succeeded++;
    } catch (err) {
      console.warn("[estimator-reconcile] run failed", run.id, err);
      await prisma.estimatorRun.update({
        where: { id: run.id },
        data: { retryCount: { increment: 1 } },
      });
      failed++;
    }
  }

  return NextResponse.json({ examined: pending.length, succeeded, failed });
}

export { Prisma };
