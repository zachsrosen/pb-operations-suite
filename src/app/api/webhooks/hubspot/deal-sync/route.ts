import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db";
import { syncSingleDeal } from "@/lib/deal-sync";

export const maxDuration = 60;

interface HubSpotWebhookEvent {
  eventId: number;
  subscriptionType: string;
  objectId: number;
  propertyName?: string;
  propertyValue?: string;
  mergedObjectIds?: number[];
}

export async function POST(request: NextRequest) {
  // HubSpot sends an array of events
  const events: HubSpotWebhookEvent[] = await request.json();

  // Return 200 immediately, process in background
  waitUntil(processEvents(events));

  return NextResponse.json({ received: true });
}

async function processEvents(events: HubSpotWebhookEvent[]) {
  for (const event of events) {
    const idempotencyKey = String(event.eventId);
    const scope = "deal-sync";

    // Check idempotency — IdempotencyKey has composite unique on (key, scope)
    const exists = await prisma.idempotencyKey.findUnique({
      where: { key_scope: { key: idempotencyKey, scope } },
    });
    if (exists) continue;

    try {
      const objectId = String(event.objectId);

      if (event.subscriptionType === "deal.deletion") {
        await prisma.deal.updateMany({
          where: { hubspotDealId: objectId },
          data: { stage: "DELETED", lastSyncedAt: new Date(), syncSource: "WEBHOOK" },
        });
        await logSyncEvent(objectId, event.subscriptionType, "SUCCESS");
      } else if (event.subscriptionType === "deal.merge") {
        // Mark merged-away deals, sync surviving deal
        if (event.mergedObjectIds) {
          for (const mergedId of event.mergedObjectIds) {
            await prisma.deal.updateMany({
              where: { hubspotDealId: String(mergedId) },
              data: { stage: "MERGED", lastSyncedAt: new Date(), syncSource: "WEBHOOK" },
            });
          }
        }
        await syncSingleDeal(objectId, "WEBHOOK");
      } else {
        // deal.creation, deal.propertyChange
        await syncSingleDeal(objectId, "WEBHOOK");
      }

      // Record idempotency key
      await prisma.idempotencyKey.create({
        data: {
          key: idempotencyKey,
          scope,
          status: "completed",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    } catch (err) {
      console.error(`[deal-sync-webhook] Error processing event ${event.eventId}:`, err);
      await logSyncEvent(
        String(event.objectId),
        event.subscriptionType,
        "FAILED",
        err instanceof Error ? err.message : "Unknown"
      );
    }
  }
}

async function logSyncEvent(
  hubspotDealId: string,
  source: string,
  status: "SUCCESS" | "FAILED",
  errorMessage?: string
) {
  const deal = await prisma.deal.findUnique({ where: { hubspotDealId } });
  await prisma.dealSyncLog.create({
    data: {
      dealId: deal?.id,
      hubspotDealId,
      syncType: "WEBHOOK",
      source: `webhook:${source}`,
      status,
      errorMessage,
      createdAt: new Date(),
    },
  });
}
