import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { validateHubSpotWebhook } from "@/lib/hubspot-webhook-auth";
import { upsertPeDocFromHubSpot } from "@/lib/pe-hubspot-sync";

export const maxDuration = 30;

interface HubSpotWebhookEvent {
  eventId: number;
  subscriptionType: string;
  objectId: number;
  propertyName?: string;
  propertyValue?: string;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  // Validate HubSpot signature
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
    console.warn(`[pe-doc-webhook] Auth failed: ${validation.error}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

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
    if (!event.propertyName?.startsWith("pe_doc_")) continue;

    const dealId = String(event.objectId);
    const { propertyName, propertyValue } = event;

    try {
      const result = await upsertPeDocFromHubSpot(
        dealId,
        propertyName!,
        propertyValue ?? "",
      );

      if (result.action === "skipped-echo") {
        // Expected during scraper sync — don't log
      } else if (result.action === "upserted") {
        console.warn(`[pe-doc-webhook] Upserted ${propertyName} for deal ${dealId}`);
      }
    } catch (err) {
      console.error(
        `[pe-doc-webhook] Failed to process ${propertyName} for deal ${dealId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
