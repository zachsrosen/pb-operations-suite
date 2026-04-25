/**
 * POST /api/webhooks/hubspot/eagleview-tdp-order
 *
 * HubSpot workflow webhook → triggers an EagleView TDP order for a deal.
 * Fired the day before a scheduled site survey for solar deals.
 *
 * Body: { dealId: string, surveyDate?: string (YYYY-MM-DD) }
 * Auth: HubSpot v3 webhook signature.
 *
 * Feature flag: fails OPEN with 200 when EAGLEVIEW_AUTO_PULL_ENABLED !== "true"
 * — HubSpot retries on non-2xx and we don't want retry storms while dark.
 *
 * See spec docs/superpowers/specs/2026-04-24-eagleview-truedesign-auto-pull-design.md
 */
import { NextRequest, NextResponse } from "next/server";
import { validateHubSpotWebhook } from "@/lib/hubspot-webhook-auth";
import { orderTrueDesign } from "@/lib/eagleview-pipeline";
import { defaultPipelineDeps } from "@/lib/eagleview-pipeline-deps";

export const maxDuration = 60;

interface WebhookPayload {
  dealId?: string;
  surveyDate?: string;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  // 1. HubSpot v3 signature
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
    console.warn(`[eagleview-tdp-order] auth fail: ${validation.error}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // 2. Feature flag — fail OPEN with 200
  if (process.env.EAGLEVIEW_AUTO_PULL_ENABLED !== "true") {
    return NextResponse.json({
      status: "disabled",
      reason: "EAGLEVIEW_AUTO_PULL_ENABLED is not 'true'",
    });
  }

  // 3. Parse + validate
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const dealId = (payload.dealId ?? "").toString().trim();
  if (!dealId) {
    return NextResponse.json({ error: "dealId required" }, { status: 400 });
  }
  const surveyDate = payload.surveyDate ? parseDate(payload.surveyDate) : null;

  // 4. Place the order
  try {
    const result = await orderTrueDesign(defaultPipelineDeps(), {
      dealId,
      triggeredBy: "hubspot_workflow",
      surveyDate,
    });
    return NextResponse.json({
      ok: true,
      orderId: result.orderId,
      reportId: result.reportId,
      status: result.status,
      isNew: result.isNew,
      reason: result.reason,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error("[eagleview-tdp-order] order failed", err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

function parseDate(s: string): Date | null {
  // Accept YYYY-MM-DD or full ISO 8601
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
