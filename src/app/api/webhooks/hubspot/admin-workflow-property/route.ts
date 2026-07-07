/**
 * POST /api/webhooks/hubspot/admin-workflow-property
 *
 * HubSpot workflow webhook → Admin Workflow fan-out.
 *
 * The primary HUBSPOT_PROPERTY_CHANGE feed (deal-sync) only carries
 * properties subscribed in the HubSpot app. For workflow-builder triggers
 * on arbitrary properties (e.g. create_additional_visit), a HubSpot
 * workflow posts here with a custom body instead:
 *
 *   { "objectId": "{{deal.hs_object_id}}",
 *     "propertyName": "create_additional_visit",
 *     "propertyValue": "true",
 *     "objectType": "deal" }            // optional, defaults to deal
 *
 * Auth: HubSpot v3 webhook signature (same as eagleview-tdp-order).
 * The event is normalized into the exact shape the deal-sync fan-out
 * emits, so triggers behave identically regardless of feed.
 */
import { NextRequest, NextResponse } from "next/server";
import { validateHubSpotWebhook } from "@/lib/hubspot-webhook-auth";
import { fanoutAdminWorkflows, isAdminWorkflowsFanoutEnabled } from "@/lib/admin-workflows/fanout";

export const maxDuration = 60;

interface WebhookPayload {
  objectId?: string | number;
  propertyName?: string;
  propertyValue?: string;
  objectType?: string;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

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
    console.warn(`[admin-workflow-property] auth fail: ${validation.error}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Fail OPEN with 200 while the fan-out flag is off — HubSpot retries on
  // non-2xx and we don't want retry storms while dark.
  if (!isAdminWorkflowsFanoutEnabled()) {
    return NextResponse.json({
      status: "disabled",
      reason: "ADMIN_WORKFLOWS_FANOUT_ENABLED is not 'true'",
    });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const objectId = String(payload.objectId ?? "").trim();
  const propertyName = String(payload.propertyName ?? "").trim();
  if (!objectId || !propertyName) {
    return NextResponse.json({ error: "objectId and propertyName required" }, { status: 400 });
  }
  const objectType = ["deal", "contact", "ticket"].includes(String(payload.objectType))
    ? String(payload.objectType)
    : "deal";

  try {
    const queued = await fanoutAdminWorkflows("HUBSPOT_PROPERTY_CHANGE", {
      subscriptionType: `${objectType}.propertyChange`,
      objectId,
      propertyName,
      propertyValue: payload.propertyValue == null ? "" : String(payload.propertyValue),
    });
    return NextResponse.json({ ok: true, queued });
  } catch (err) {
    console.error("[admin-workflow-property] fan-out failed:", err);
    return NextResponse.json({ error: "Fan-out failed" }, { status: 500 });
  }
}
