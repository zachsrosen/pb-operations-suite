/**
 * HubSpot Deal Property Change Webhook — PE M1 Rejection notes
 *
 * POST /api/webhooks/hubspot/pe-m1-rejected
 *
 * Fired by a HubSpot workflow when a deal's `pe_m1_status` flips to "Rejected".
 * Pulls the project's action items LIVE from the PE API (no dependence on the
 * nightly sync), routes each rejected document's reviewer note to the team that
 * owns it, and writes the per-team `pe_rejection_notes_for_*` fields on the deal.
 *
 * Auth: bearer token (PIPELINE_WEBHOOK_SECRET || API_SECRET_TOKEN).
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace("Bearer ", "");
  const secret = process.env.PIPELINE_WEBHOOK_SECRET || process.env.API_SECRET_TOKEN;
  if (!secret || bearer !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Workflow payload: {objectId} or {dealId} or {properties:{hs_object_id}}
  let dealId = "";
  try {
    const body = (await req.json()) as {
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
  if (!dealId) {
    return NextResponse.json({ error: "Missing dealId" }, { status: 400 });
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
      "pe_portal_url",
    ]);
  } catch (err) {
    console.error(`[pe-m1-rejected] deal ${dealId} read failed:`, err);
    return NextResponse.json({ error: "Deal read failed" }, { status: 502 });
  }

  const props = deal.properties;
  if (props.pe_m1_status !== "Rejected") {
    return NextResponse.json({ status: "skipped", reason: "pe_m1_status not Rejected" });
  }

  const internalId = peInternalIdFromPortalUrl(props.pe_portal_url);
  if (!internalId) {
    return NextResponse.json({ status: "skipped", reason: "no pe_portal_url" });
  }

  let detail;
  try {
    detail = await getProjectDetail(internalId);
  } catch (err) {
    console.error(`[pe-m1-rejected] PE fetch failed for deal ${dealId} (${internalId}):`, err);
    return NextResponse.json({ error: "PE fetch failed" }, { status: 502 });
  }

  const properties = composeRejectionNotes(detail.actionItems ?? []);
  if (Object.keys(properties).length === 0) {
    return NextResponse.json({ status: "ok", updated: 0, reason: "no M1 action items" });
  }

  try {
    await hubspotClient.crm.deals.basicApi.update(dealId, { properties });
  } catch (err) {
    console.error(`[pe-m1-rejected] deal ${dealId} update failed:`, err);
    return NextResponse.json({ error: "Deal update failed" }, { status: 502 });
  }

  const fields = Object.keys(properties);
  console.log(`[pe-m1-rejected] deal ${dealId}: wrote ${fields.join(", ")}`);
  return NextResponse.json({ status: "ok", updated: fields.length, fields });
}
