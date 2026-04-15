/**
 * POST /api/webhooks/hubspot/property
 *
 * HubSpot webhook handler for property-object sync. Dispatches to the
 * `lib/property-sync` handlers based on subscription type:
 *
 *   contact.propertyChange  → onContactAddressChange (address fields only)
 *   deal.creation           → onDealOrTicketCreated("deal", id)
 *   deal.propertyChange     → onDealOrTicketCreated("deal", id)
 *   ticket.creation         → onDealOrTicketCreated("ticket", id)
 *   ticket.propertyChange   → onDealOrTicketCreated("ticket", id)
 *
 * Idempotency: a row in `IdempotencyKey` with scope
 * `"property-sync:hubspot-webhook"` guards each `eventId`. HubSpot retries
 * aggressively, so we dedupe by event ID and TTL the row to 24h.
 *
 * Feature flag: fails OPEN with a 200 when `PROPERTY_SYNC_ENABLED !== "true"`
 * — HubSpot treats anything non-2xx as a retryable failure, and we do NOT
 * want retries piling up while the feature is dark.
 *
 * Mirrors the structure of `src/app/api/webhooks/hubspot/deal-sync/route.ts`.
 */

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db";
import { validateHubSpotWebhook } from "@/lib/hubspot-webhook-auth";
import { onContactAddressChange, onDealOrTicketCreated } from "@/lib/property-sync";

export const maxDuration = 300;

const IDEMPOTENCY_SCOPE = "property-sync:hubspot-webhook";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Contact property names that should trigger an address-change sync. */
const ADDRESS_PROPERTY_NAMES = new Set([
  "address",
  "address2",
  "city",
  "state",
  "zip",
  "country",
]);

interface HubSpotWebhookEvent {
  eventId: number;
  subscriptionType: string;
  objectId: number;
  propertyName?: string;
  propertyValue?: string;
}

export async function POST(request: NextRequest) {
  // ── 1. Read raw body (needed for signature validation) ──
  const rawBody = await request.text();

  // ── 2. Authenticate: HubSpot v3 signature ──
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
    console.warn(`[property-webhook] Auth failed: ${validation.error}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // ── 3. Feature flag: fail open (200) so HubSpot doesn't retry. ──
  if (process.env.PROPERTY_SYNC_ENABLED !== "true") {
    return NextResponse.json({
      status: "disabled",
      reason: "PROPERTY_SYNC_ENABLED is not 'true'",
    });
  }

  // ── 4. Parse payload ──
  let events: HubSpotWebhookEvent[];
  try {
    events = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── 5. Classify events up front so we can report skipped-count in the
  //       response before kicking off the background work. ──
  let skipped = 0;
  const actionable: HubSpotWebhookEvent[] = [];
  for (const event of events) {
    if (isDispatchable(event)) {
      actionable.push(event);
    } else {
      skipped += 1;
    }
  }

  // Return 200 immediately, process in background
  waitUntil(processEvents(actionable));

  return NextResponse.json({ received: true, skipped, queued: actionable.length });
}

function isDispatchable(event: HubSpotWebhookEvent): boolean {
  switch (event.subscriptionType) {
    case "contact.propertyChange":
      return !!event.propertyName && ADDRESS_PROPERTY_NAMES.has(event.propertyName);
    case "deal.creation":
    case "deal.propertyChange":
    case "ticket.creation":
    case "ticket.propertyChange":
      return true;
    default:
      return false;
  }
}

async function processEvents(events: HubSpotWebhookEvent[]) {
  for (const event of events) {
    const key = String(event.eventId);

    // Idempotency — composite unique on (key, scope).
    const exists = await prisma.idempotencyKey.findUnique({
      where: { key_scope: { key, scope: IDEMPOTENCY_SCOPE } },
    });
    if (exists) continue;

    try {
      await dispatch(event);

      await prisma.idempotencyKey.create({
        data: {
          key,
          scope: IDEMPOTENCY_SCOPE,
          status: "completed",
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
      });
    } catch (err) {
      console.error(
        "[property-webhook] Error processing event %s:",
        event.eventId,
        err,
      );
      // Intentionally do NOT write the idempotency key on failure — HubSpot
      // will retry and we want the next attempt to try again.
    }
  }
}

async function dispatch(event: HubSpotWebhookEvent): Promise<void> {
  const objectId = String(event.objectId);

  switch (event.subscriptionType) {
    case "contact.propertyChange":
      if (event.propertyName && ADDRESS_PROPERTY_NAMES.has(event.propertyName)) {
        await onContactAddressChange(objectId);
      }
      return;
    case "deal.creation":
    case "deal.propertyChange":
      await onDealOrTicketCreated("deal", objectId);
      return;
    case "ticket.creation":
    case "ticket.propertyChange":
      await onDealOrTicketCreated("ticket", objectId);
      return;
    default:
      return;
  }
}
