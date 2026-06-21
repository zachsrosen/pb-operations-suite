/**
 * HubSpot Deal Property Change Webhook — PE M1/M2 Rejection notes
 *
 * POST /api/webhooks/hubspot/pe-rejection
 *
 * Fired by a HubSpot workflow when a deal pe_m1_status or pe_m2_status flips to "Rejected".
 * Pulls the project's action items LIVE from the PE API (no dependence on the
 * nightly sync), routes each rejected document's reviewer note to the team that
 * owns it, and writes the per-team `pe_rejection_notes_for_*` fields on the deal.
 *
 * Auth: bearer token (PIPELINE_WEBHOOK_SECRET || API_SECRET_TOKEN).
 */
import { NextRequest, NextResponse } from "next/server";
import { validateHubSpotWebhook } from "@/lib/hubspot-webhook-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // Authenticate, any of:
  //  - bearer token,
  //  - `?token=` query param (the native HubSpot workflow "Send a webhook"
  //    action can't add custom headers, so the shared secret rides on the URL),
  //  - HubSpot v3 signature.
  const secret = process.env.PIPELINE_WEBHOOK_SECRET || process.env.API_SECRET_TOKEN;
  const bearer = req.headers.get("authorization")?.replace("Bearer ", "");
  const token = req.nextUrl.searchParams.get("token");
  const isSecretAuth = !!secret && (bearer === secret || token === secret);
  if (!isSecretAuth) {
    const validation = validateHubSpotWebhook({
      rawBody,
      signature: req.headers.get("x-hubspot-signature-v3") ?? "",
      timestamp: req.headers.get("x-hubspot-request-timestamp") ?? "",
      requestUrl: req.url,
      method: "POST",
    });
    if (!validation.valid) {
      console.warn(`[pe-rejection] auth failed: ${validation.error} (no valid bearer either)`);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Workflow payload: {objectId} or {dealId} or {properties:{hs_object_id}}
  let dealId = "";
  try {
    const body = JSON.parse(rawBody) as {
      objectId?: number | string;
      dealId?: number | string;
      properties?: { hs_object_id?: { value?: string } | string };
    };
    const hsObj = body.properties?.hs_object_id;
    dealId = String(
      body.objectId ??
        body.dealId ??
        (typeof hsObj === "object" ? hsObj?.value : hsObj) ??
        "",
    ).trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  // HubSpot deal ids are numeric — reject anything else so the value can't be
  // an arbitrary user-controlled string downstream.
  if (!/^\d+$/.test(dealId)) {
    return NextResponse.json({ error: "Missing or invalid dealId" }, { status: 400 });
  }

  const { hubspotClient } = await import("@/lib/hubspot");
  const { getProjectDetail } = await import("@/lib/pe-api");
  const { composeRejectionNotes, peInternalIdFromPortalUrl } = await import(
    "@/lib/pe-rejection-notes"
  );

  let deal;
  try {
    deal = await hubspotClient.crm.deals.basicApi.getById(dealId, [
      "pe_m1_status",
      "pe_m2_status",
      "pe_portal_url",
    ]);
  } catch (err) {
    console.error("[pe-rejection] deal read failed:", dealId, err);
    return NextResponse.json({ error: "Deal read failed" }, { status: 502 });
  }

  const props = deal.properties;
  // Fires from either the M1 or M2 rejection workflow. Action items don't carry
  // a milestone, so we compose from whatever PE currently has open and route by
  // the combined doc→team map regardless of which status flipped.
  if (props.pe_m1_status !== "Rejected" && props.pe_m2_status !== "Rejected") {
    return NextResponse.json({ status: "skipped", reason: "neither M1 nor M2 is Rejected" });
  }

  const internalId = peInternalIdFromPortalUrl(props.pe_portal_url);
  if (!internalId) {
    return NextResponse.json({ status: "skipped", reason: "no pe_portal_url" });
  }

  let detail;
  try {
    detail = await getProjectDetail(internalId);
  } catch (err) {
    console.error("[pe-rejection] PE fetch failed for deal:", dealId, internalId, err);
    return NextResponse.json({ error: "PE fetch failed" }, { status: 502 });
  }

  const properties = composeRejectionNotes(detail.documents, detail.actionItems ?? []);
  if (Object.keys(properties).length === 0) {
    return NextResponse.json({ status: "ok", updated: 0, reason: "no currently-rejected docs" });
  }

  try {
    await hubspotClient.crm.deals.basicApi.update(dealId, { properties });
  } catch (err) {
    console.error("[pe-rejection] deal update failed:", dealId, err);
    return NextResponse.json({ error: "Deal update failed" }, { status: 502 });
  }

  const fields = Object.keys(properties);
  console.log("[pe-rejection] wrote fields for deal:", dealId, fields);
  return NextResponse.json({ status: "ok", updated: fields.length, fields });
}
