/**
 * Backend for the Participate Energy HubSpot UI Extension card (Deal records).
 *
 * Same HMAC auth pattern as the Enphase / PowerHub cards. Returns the PE status
 * for a deal: milestone status + $, the doc checklist, and any open blockers
 * (action-required / rejected docs with PE's reviewer reason).
 */

import { NextResponse } from "next/server";
import { Signature } from "@hubspot/api-client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hubspotClient } from "@/lib/hubspot";
import { PE_M1_DOC_NAMES } from "@/lib/pe-analytics";
import { getLastSuccessfulSyncRun } from "@/lib/pe-api-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RequestSchema = z.object({
  objectType: z.string().min(1),
  objectId: z.string().min(1),
});

const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;
const TYPE_DEALS = "0-3";
const M2_DOC_NAMES = ["Signed Interconnection Agreement", "Conditional Waiver — Final Payment", "Permission to Operate (PTO)"];
const PB_TRACKER_URL = "https://www.pbtechops.com/dashboards/pe?tab=docs";

function verifyHubSpotSignature(method: string, url: string, body: string, sig: string | null, ts: string | null): boolean {
  if (process.env.HUBSPOT_CARD_SKIP_SIG_VERIFY === "true") return true;
  if (!sig || !ts) return false;
  const secret = process.env.HUBSPOT_APP_SECRET;
  if (!secret) return false;
  const tsn = Number(ts);
  if (!Number.isFinite(tsn) || Math.abs(Date.now() - tsn) > TIMESTAMP_WINDOW_MS) return false;
  const parsed = new URL(url);
  const pairs: string[] = [];
  for (const [k, v] of parsed.searchParams.entries()) pairs.push(`${k}=${v}`);
  const canonicalUrl = parsed.origin + parsed.pathname + (pairs.length ? `?${pairs.join("&")}` : "");
  return Signature.isValid({ signatureVersion: "v3", signature: sig, method, clientSecret: secret, requestBody: body, url: canonicalUrl, timestamp: tsn as never } as never);
}

/** Strip PE-sync boilerplate, keep the genuine reviewer comment. */
function cleanReason(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/Synced from PE[^|]*\|?/gi, "")
    .replace(/\bv\d+\s*\|?/g, "")
    .replace(/milestone:[^|]*\|?/gi, "")
    .replace(/^Page \d+ — /i, "")
    .replace(/\s*\|\s*/g, " ")
    .trim();
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyHubSpotSignature("POST", request.url, rawBody, request.headers.get("x-hubspot-signature-v3"), request.headers.get("x-hubspot-request-timestamp"))) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = RequestSchema.parse(JSON.parse(rawBody));
  } catch (err) {
    return NextResponse.json({ error: "invalid_request", message: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  const { objectType, objectId } = parsed;
  if (objectType !== TYPE_DEALS) {
    return NextResponse.json({ error: "unsupported_object_type", message: `Object type ${objectType} not supported (deal only)` }, { status: 400 });
  }
  if (!prisma) return NextResponse.json({ error: "no_db" }, { status: 500 });

  // 1) Deal PE properties (milestone status / $ / dates / portal link) from HubSpot.
  let props: Record<string, string | null> = {};
  try {
    const res = (await hubspotClient.apiRequest({
      method: "POST",
      path: "/crm/v3/objects/deals/batch/read",
      body: {
        inputs: [{ id: objectId }],
        properties: [
          "dealname", "pe_project_id", "pe_portal_url", "tags",
          "pe_m1_status", "pe_m2_status", "pe_payment_ic", "pe_payment_pc",
          "pe_m1_approval_date", "pe_m2_approval_date", "pe_m1_paid_date", "pe_m2_paid_date",
        ],
      },
    })) as unknown as { json(): Promise<{ results?: { properties: Record<string, string | null> }[] }> };
    props = (await res.json()).results?.[0]?.properties ?? {};
  } catch {
    return NextResponse.json({ error: "deal_fetch_failed" }, { status: 502 });
  }

  const isPe = String(props.tags ?? "").includes("Participate Energy") || !!props.pe_m1_status || !!props.pe_m2_status;
  if (!isPe) {
    return NextResponse.json({ error: "not_a_pe_deal" }, { status: 404 });
  }

  // 2) Doc statuses + open action items (blockers) from our DB.
  const [docRows, actionItems, lastSync] = await Promise.all([
    prisma.peDocumentReview.findMany({ where: { dealId: objectId }, select: { docName: true, status: true } }),
    prisma.peActionItem.findMany({ where: { dealId: objectId, resolvedAt: null }, select: { docLabel: true, reviewer: true, notes: true, errorCode: true, actionDate: true }, orderBy: { actionDate: "desc" } }),
    getLastSuccessfulSyncRun(),
  ]);
  const statusByDoc = new Map(docRows.map((r) => [r.docName, r.status]));

  // Numerator = docs actually submitted to PE (uploaded). NOT_REQUIRED docs (e.g.
  // BOM bundled in Photos) drop out of the denominator entirely, so the count
  // never reads one-short and needs no caveat note.
  const tally = (names: readonly string[]) => {
    let required = 0, submitted = 0, approved = 0, underReview = 0, actionRequired = 0;
    for (const n of names) {
      const s = statusByDoc.get(n) ?? "NOT_UPLOADED";
      if (s === "NOT_REQUIRED") continue; // not separately submitted; excluded from the total
      required++;
      if (s === "APPROVED") { submitted++; approved++; }
      else if (s === "UNDER_REVIEW" || s === "UPLOADED") { submitted++; underReview++; }
      else if (s === "ACTION_REQUIRED" || s === "REJECTED") { submitted++; actionRequired++; }
      // NOT_UPLOADED: counts toward required, not submitted
    }
    return { required, submitted, approved, underReview, actionRequired };
  };

  const num = (v: string | null | undefined) => (v ? Math.round(parseFloat(v)) : null);
  const blockers = actionItems.slice(0, 8).map((a) => ({
    doc: a.docLabel,
    code: a.errorCode ?? null,
    reviewer: a.reviewer ?? null,
    reason: cleanReason(a.notes) || null,
    date: a.actionDate ? new Date(a.actionDate).toISOString().slice(0, 10) : null,
  }));

  return NextResponse.json({
    dealName: props.dealname ?? null,
    peProjectId: props.pe_project_id ?? null,
    pePortalUrl: props.pe_portal_url ?? null,
    pbTechOpsUrl: PB_TRACKER_URL,
    lastSyncedAt: lastSync?.completedAt ?? lastSync?.startedAt ?? null,
    milestones: {
      ic: { status: props.pe_m1_status ?? null, amount: num(props.pe_payment_ic), approvedOn: props.pe_m1_approval_date ?? null, paidOn: props.pe_m1_paid_date ?? null },
      pc: { status: props.pe_m2_status ?? null, amount: num(props.pe_payment_pc), approvedOn: props.pe_m2_approval_date ?? null, paidOn: props.pe_m2_paid_date ?? null },
    },
    docs: { m1: tally(PE_M1_DOC_NAMES), m2: tally(M2_DOC_NAMES) },
    blockers,
  });
}
