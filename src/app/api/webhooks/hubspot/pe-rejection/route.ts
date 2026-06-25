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
  const {
    composeRejectionNotes,
    composeAllRejectionComments,
    composeRejectedDocuments,
    sameDocSelection,
    withClearedTeamFields,
    peInternalIdFromPortalUrl,
  } = await import("@/lib/pe-rejection-notes");

  let deal;
  try {
    deal = await hubspotClient.crm.deals.basicApi.getById(dealId, [
      "pe_m1_status",
      "pe_m2_status",
      "pe_portal_url",
      "pe_m1_documents",
      "pe_m2_documents",
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
    // Return 200 (not 502) so HubSpot does NOT retry. A 5xx makes the workflow's
    // "Send a webhook" action retry with backoff for hours; while the PE API is
    // down (e.g. quota) every retry fails, and the moment it recovers the
    // backlog of retries lands and re-stamps the document checkboxes, which
    // re-fires the per-team task workflows and regenerates duplicate tasks. The
    // deal stays Rejected, so the next genuine rejection event (or the nightly
    // PE sync) picks it up — nothing is lost by acking and deferring.
    console.error("[pe-rejection] PE fetch failed for deal:", dealId, internalId, err);
    return NextResponse.json({ status: "deferred", reason: "PE fetch failed" });
  }

  // Phase 1 — the rejection notes (per-team + combined). These must land BEFORE
  // the document checkboxes, because ticking pe_m{1,2}_documents is what triggers
  // the per-team task workflows, and those tasks read these note fields.
  //
  // withClearedTeamFields ensures EVERY team field is written — empty for any team
  // with no current rejection — so a stale note (from a prior round or typed by
  // hand) is cleared. Otherwise the team's task workflow, which fires on
  // status→Rejected with a "note is non-empty" branch, regenerates that team's
  // task on the next rejection even when none of its docs were rejected. Same for
  // the combined comments field, always written so it clears when nothing's open.
  const noteProps: Record<string, string> = withClearedTeamFields(
    composeRejectionNotes(detail.documents, detail.actionItems ?? []),
  );
  noteProps.pe_rejection_comments = composeAllRejectionComments(
    detail.documents,
    detail.actionItems ?? [],
  );

  // Phase 2 — the P.E. M{1,2} Documents checkboxes for the currently-rejected
  // docs, but only for the milestone that was actually rejected (a rejected M1
  // shouldn't touch pe_m2_documents even if PE has open M2 docs, and vice versa).
  // Only stamp a checkbox value when it actually differs from what's already on
  // the deal (compared as an unordered set). Re-writing an identical selection
  // is what HubSpot sees as a "change" and what re-fires the per-team task
  // workflows, so skipping the no-op write is the safety net that stops a stray
  // webhook retry from regenerating duplicate tasks.
  const rejectedDocs = composeRejectedDocuments(detail.documents, detail.actionItems ?? []);
  const docProps: Record<string, string> = {};
  if (
    props.pe_m1_status === "Rejected" &&
    rejectedDocs.pe_m1_documents &&
    !sameDocSelection(props.pe_m1_documents, rejectedDocs.pe_m1_documents)
  ) {
    docProps.pe_m1_documents = rejectedDocs.pe_m1_documents;
  }
  if (
    props.pe_m2_status === "Rejected" &&
    rejectedDocs.pe_m2_documents &&
    !sameDocSelection(props.pe_m2_documents, rejectedDocs.pe_m2_documents)
  ) {
    docProps.pe_m2_documents = rejectedDocs.pe_m2_documents;
  }

  if (Object.keys(noteProps).length === 0 && Object.keys(docProps).length === 0) {
    return NextResponse.json({ status: "ok", updated: 0, reason: "no currently-rejected docs" });
  }

  // Write notes first and await them so they're committed before the checkbox
  // change fires the task-creation workflows.
  try {
    if (Object.keys(noteProps).length > 0) {
      await hubspotClient.crm.deals.basicApi.update(dealId, { properties: noteProps });
    }
  } catch (err) {
    console.error("[pe-rejection] notes update failed:", dealId, err);
    return NextResponse.json({ error: "Notes update failed" }, { status: 502 });
  }

  // Then tick the document checkboxes — this is the trigger for the team tasks.
  try {
    if (Object.keys(docProps).length > 0) {
      await hubspotClient.crm.deals.basicApi.update(dealId, { properties: docProps });
    }
  } catch (err) {
    console.error("[pe-rejection] documents update failed:", dealId, err);
    // Notes already landed; surface the partial failure rather than silently 200.
    return NextResponse.json(
      { error: "Documents update failed", notesWritten: Object.keys(noteProps) },
      { status: 502 },
    );
  }

  const fields = [...Object.keys(noteProps), ...Object.keys(docProps)];
  console.log("[pe-rejection] wrote fields for deal:", dealId, fields);
  return NextResponse.json({
    status: "ok",
    updated: fields.length,
    notes: Object.keys(noteProps),
    documents: Object.keys(docProps),
  });
}
