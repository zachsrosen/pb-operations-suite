import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db";
import { syncSingleDeal } from "@/lib/deal-sync";
import { validateHubSpotWebhook } from "@/lib/hubspot-webhook-auth";
import { fanoutAdminWorkflows } from "@/lib/admin-workflows/fanout";

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
  // ── 1. Read raw body (needed for signature validation) ──
  const rawBody = await request.text();

  // ── 2. Authenticate: HubSpot v3 signature OR bearer token ──
  const bearerToken = request.headers.get("authorization")?.replace("Bearer ", "");
  const pipelineSecret = process.env.PIPELINE_WEBHOOK_SECRET || process.env.API_SECRET_TOKEN;
  const isBearerAuth = bearerToken && pipelineSecret && bearerToken === pipelineSecret;

  if (!isBearerAuth) {
    const signature = request.headers.get("x-hubspot-signature-v3") ?? "";
    const timestamp = request.headers.get("x-hubspot-request-timestamp") ?? "";

    const validation = validateHubSpotWebhook({
      rawBody,
      signature,
      timestamp,
      requestUrl: request.url,
      method: "POST",
    });

    if (!validation.valid) {
      console.warn(`[deal-sync-webhook] Auth failed: ${validation.error}`);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  // ── 3. Parse payload ──
  let events: HubSpotWebhookEvent[];
  try {
    events = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

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

      // ── Admin Workflow fan-out ──
      // Additive: after the primary sync succeeds, fire any admin workflows
      // configured for this property change. Gated on its own flag so we
      // can roll out independently of the core sync.
      if (event.subscriptionType === "deal.propertyChange") {
        try {
          await fanoutAdminWorkflows("HUBSPOT_PROPERTY_CHANGE", {
            subscriptionType: event.subscriptionType,
            objectId,
            propertyName: event.propertyName,
            propertyValue: event.propertyValue,
          });
        } catch (fanoutErr) {
          // Fan-out errors are non-fatal to the primary sync
          console.error(
            "[deal-sync-webhook] Admin workflow fan-out failed (non-fatal) for deal %s:",
            objectId,
            fanoutErr,
          );
        }
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
      console.error("[deal-sync-webhook] Error processing event %s:", event.eventId, err);
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
