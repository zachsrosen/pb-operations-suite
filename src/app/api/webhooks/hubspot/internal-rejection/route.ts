/**
 * HubSpot Deal Property Change Webhook — INTERNAL M1/M2 Rejection notes
 *
 * POST /api/webhooks/hubspot/internal-rejection
 *
 * The PB-internal QC mirror of the PE rejection webhook (`pe-rejection/route.ts`).
 * Fired by a HubSpot workflow when a deal's `pe_m1_status` or `pe_m2_status` flips
 * to "Internally Rejected". Unlike the PE flow there is no live PE pull — the
 * reviewer supplies everything in HubSpot:
 *   - `internal_rejection_documents` — the rejected docs (checkbox),
 *   - `internal_reason_*` — each rejected doc's reason text.
 *
 * This route reads those fields, scopes the checked docs to whichever milestone
 * is currently "Internally Rejected", routes each doc's reason to the owning team,
 * and writes the 7 `internal_rejection_notes_for_*` fields + `internal_rejection_comments`.
 *
 * A single write is sufficient here: the per-team task workflows trigger off the
 * STATUS change (with a ~2-min delay + non-empty branch) rather than off a
 * checkbox this route ticks, so there is no notes-before-checkbox ordering to honor.
 *
 * Auth: any of bearer token (PIPELINE_WEBHOOK_SECRET || API_SECRET_TOKEN),
 * `?token=` query param (HubSpot's native "Send a webhook" can't add headers), or
 * a HubSpot v3 signature.
 */
import { NextRequest, NextResponse } from "next/server";
import { validateHubSpotWebhook } from "@/lib/hubspot-webhook-auth";

export const dynamic = "force-dynamic";

const INTERNAL_REJECTED_STATUS = "Internally Rejected";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // Authenticate (same scheme as the PE rejection webhook).
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
      console.warn(`[internal-rejection] auth failed: ${validation.error} (no valid bearer either)`);
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
  // HubSpot deal ids are numeric — reject anything else.
  if (!/^\d+$/.test(dealId)) {
    return NextResponse.json({ error: "Missing or invalid dealId" }, { status: 400 });
  }

  const { hubspotClient } = await import("@/lib/hubspot");
  const {
    composeInternalRejectionNotes,
    scopeCheckedDocsToMilestones,
    parseCheckedDocs,
    INTERNAL_REASON_FIELDS,
    INTERNAL_REASON_FIELD_BY_DOC,
  } = await import("@/lib/internal-rejection-notes");

  let deal;
  try {
    deal = await hubspotClient.crm.deals.basicApi.getById(dealId, [
      "pe_m1_status",
      "pe_m2_status",
      "internal_rejection_documents",
      ...INTERNAL_REASON_FIELDS,
    ]);
  } catch (err) {
    console.error("[internal-rejection] deal read failed:", dealId, err);
    return NextResponse.json({ error: "Deal read failed" }, { status: 502 });
  }

  const props = deal.properties as Record<string, string | null | undefined>;
  const m1Rejected = props.pe_m1_status === INTERNAL_REJECTED_STATUS;
  const m2Rejected = props.pe_m2_status === INTERNAL_REJECTED_STATUS;
  if (!m1Rejected && !m2Rejected) {
    return NextResponse.json({
      status: "skipped",
      reason: "neither M1 nor M2 is Internally Rejected",
    });
  }

  // Scope the reviewer's checked docs to the milestone(s) actually rejected.
  const checkedDocs = scopeCheckedDocsToMilestones(
    parseCheckedDocs(props.internal_rejection_documents),
    { m1: m1Rejected, m2: m2Rejected },
  );

  // Pull each checked doc's reason text from its `internal_reason_*` field.
  const reasonsByDoc: Record<string, string> = {};
  for (const docLabel of checkedDocs) {
    const reasonField = INTERNAL_REASON_FIELD_BY_DOC[docLabel];
    reasonsByDoc[docLabel] = (reasonField && props[reasonField]) || "";
  }

  const noteProps = composeInternalRejectionNotes(reasonsByDoc, checkedDocs);

  try {
    await hubspotClient.crm.deals.basicApi.update(dealId, { properties: noteProps });
  } catch (err) {
    console.error("[internal-rejection] notes update failed:", dealId, err);
    return NextResponse.json({ error: "Notes update failed" }, { status: 502 });
  }

  const populated = Object.entries(noteProps)
    .filter(([, v]) => v !== "")
    .map(([k]) => k);
  console.log("[internal-rejection] wrote notes for deal:", dealId, {
    checkedDocs,
    populated,
  });
  return NextResponse.json({
    status: "ok",
    dealId,
    checkedDocs,
    populated,
  });
}
