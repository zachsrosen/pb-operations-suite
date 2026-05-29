import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmailMessage } from "@/lib/email";
import { hubspotClient } from "@/lib/hubspot";
import { render } from "@react-email/render";
import {
  PeDocDigest,
  type NearlyCompleteDeal,
  type NotUploadedDeal,
  type ActionRequiredDeal,
} from "@/emails/PeDocDigest";

/**
 * GET /api/cron/pe-doc-digest
 *
 * Vercel cron job — sends a daily email digest of PE document status:
 *   Section 1: Nearly Complete (1-3 docs blocking)
 *   Section 2: Not Uploaded (missing docs per deal)
 *   Section 3: Action Required (rejections with PE comments)
 *   Section 4: Today's Changes (status transitions)
 *
 * Schedule: 21:30 UTC (3:30 PM MT) weekdays
 * Protected by CRON_SECRET.
 */
export const maxDuration = 30;

const RECIPIENTS = [
  "layla@photonbrothers.com",
  "zach@photonbrothers.com",
];
const TOTAL_DOCS_PER_DEAL = 15;
// Strip any stray whitespace/escape chars — env var has been seen with a trailing newline
const PORTAL_ID = (process.env.HUBSPOT_PORTAL_ID || "21710069").replace(/[^0-9]/g, "") || "21710069";
const PTO_STAGE_ID = "20461940";
const CLOSEOUT_STAGE_ID = "24743347";

// Docs to skip for PTO-stage deals (not expected yet)
const PTO_SKIP_DOCS = [
  "Signed Interconnection Agreement",
  "Permission to Operate (PTO)",
];

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // -----------------------------------------------------------------------
    // 1. Date anchor (MT). Status-change history is intentionally omitted from
    //    this digest: Zach already receives real-time change alerts via
    //    pe-doc-notify, so the daily digest focuses on the actionable snapshot
    //    (Nearly Complete / Not Uploaded / Action Required) for Layla + Zach.
    // -----------------------------------------------------------------------
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    // -----------------------------------------------------------------------
    // 2. Current snapshot: all doc statuses grouped by deal (with notes)
    // -----------------------------------------------------------------------
    const allDocs = await prisma.peDocumentReview.findMany({
      select: { dealId: true, docName: true, status: true, notes: true },
    });

    const dealDocs = new Map<string, { docName: string; status: string; notes: string | null }[]>();
    for (const doc of allDocs) {
      if (!dealDocs.has(doc.dealId)) dealDocs.set(doc.dealId, []);
      dealDocs.get(doc.dealId)!.push({ docName: doc.docName, status: doc.status, notes: doc.notes });
    }

    // -----------------------------------------------------------------------
    // 2b. Batch-read dealname, dealstage, pe_portal_url from HubSpot
    // -----------------------------------------------------------------------
    const allDealIds = [...dealDocs.keys()];
    const portalUrlMap = new Map<string, string>();
    const dealNameMap = new Map<string, string>();
    const dealStageMap = new Map<string, string>();
    const driveUrlMap = new Map<string, string>();
    try {
      const chunks = [];
      for (let i = 0; i < allDealIds.length; i += 100) {
        chunks.push(allDealIds.slice(i, i + 100));
      }
      for (const chunk of chunks) {
        const resp = await hubspotClient.crm.deals.batchApi.read({
          inputs: chunk.map((id) => ({ id })),
          // all_document_parent_folder_id is the deal's GDrive project folder,
          // created by HubSpot automation for every deal (most reliable). The
          // g_drive / all_document_folder_url fields are sparse legacy fallbacks.
          properties: [
            "dealname", "dealstage", "pe_portal_url",
            "all_document_parent_folder_id", "g_drive", "all_document_folder_url",
          ],
          propertiesWithHistory: [],
        });
        for (const deal of resp.results) {
          const id = String(deal.id);
          if (deal.properties.pe_portal_url) portalUrlMap.set(id, deal.properties.pe_portal_url);
          if (deal.properties.dealname) dealNameMap.set(id, deal.properties.dealname);
          if (deal.properties.dealstage) dealStageMap.set(id, deal.properties.dealstage);
          const folderId = deal.properties.all_document_parent_folder_id;
          const drive = folderId
            ? `https://drive.google.com/drive/folders/${folderId}`
            : (deal.properties.g_drive ?? deal.properties.all_document_folder_url);
          if (drive) driveUrlMap.set(id, drive);
        }
      }
    } catch (err) {
      console.warn(`[pe-doc-digest] Failed to batch-read deal properties (non-fatal):`, err);
    }

    const hsUrl = (dealId: string) =>
      `https://app.hubspot.com/contacts/${PORTAL_ID}/record/0-3/${dealId}`;

    const stageLabel = (dealId: string): string => {
      const stage = dealStageMap.get(dealId);
      if (stage === PTO_STAGE_ID) return "PTO";
      if (stage === CLOSEOUT_STAGE_ID) return "Close Out";
      return "Other";
    };

    // Snapshot sections target only deals currently in PTO or Close Out —
    // earlier-stage deals aren't Layla's responsibility yet and would add noise.
    const isTargetStage = (dealId: string): boolean => {
      const stage = dealStageMap.get(dealId);
      return stage === PTO_STAGE_ID || stage === CLOSEOUT_STAGE_ID;
    };

    // -----------------------------------------------------------------------
    // 3. Section 1: Nearly Complete — deals where only 1-3 docs need action
    // -----------------------------------------------------------------------
    const nearlyComplete: NearlyCompleteDeal[] = [];
    for (const [dealId, docs] of dealDocs.entries()) {
      if (!isTargetStage(dealId)) continue;
      const blocking = docs.filter((d) => d.status === "NOT_UPLOADED" || d.status === "ACTION_REQUIRED");
      if (blocking.length >= 1 && blocking.length <= 3 && docs.length >= TOTAL_DOCS_PER_DEAL - 3) {
        const approvedCount = docs.filter((d) => d.status === "APPROVED").length;
        const inProgressCount = docs.filter(
          (d) => d.status === "UPLOADED" || d.status === "UNDER_REVIEW",
        ).length;
        nearlyComplete.push({
          dealId,
          dealName: dealNameMap.get(dealId) ?? null,
          stage: stageLabel(dealId),
          approvedCount,
          inProgressCount,
          totalDocs: TOTAL_DOCS_PER_DEAL,
          missingDocs: blocking.map((d) => d.docName),
          hubspotUrl: hsUrl(dealId),
          pePortalUrl: portalUrlMap.get(dealId) ?? null,
          driveUrl: driveUrlMap.get(dealId) ?? null,
        });
      }
    }
    nearlyComplete.sort((a, b) => b.approvedCount - a.approvedCount);

    // -----------------------------------------------------------------------
    // 4. Section 2: Not Uploaded — deals with NOT_UPLOADED docs
    //    Skip Signed IA + PTO letter for PTO-stage deals
    // -----------------------------------------------------------------------
    const notUploaded: NotUploadedDeal[] = [];
    for (const [dealId, docs] of dealDocs.entries()) {
      if (!isTargetStage(dealId)) continue;
      const isPto = dealStageMap.get(dealId) === PTO_STAGE_ID;
      const missing = docs
        .filter((d) => d.status === "NOT_UPLOADED")
        .filter((d) => !(isPto && PTO_SKIP_DOCS.includes(d.docName)))
        .map((d) => d.docName);
      if (missing.length > 0) {
        notUploaded.push({
          dealId,
          dealName: dealNameMap.get(dealId) ?? null,
          stage: stageLabel(dealId),
          missingDocs: missing,
          hubspotUrl: hsUrl(dealId),
          pePortalUrl: portalUrlMap.get(dealId) ?? null,
          driveUrl: driveUrlMap.get(dealId) ?? null,
        });
      }
    }
    notUploaded.sort((a, b) => b.missingDocs.length - a.missingDocs.length);

    // -----------------------------------------------------------------------
    // 5. Section 3: Action Required — deals with REJECTED or ACTION_REQUIRED
    //    Includes PE rejection comments from notes
    // -----------------------------------------------------------------------
    const actionRequired: ActionRequiredDeal[] = [];
    for (const [dealId, docs] of dealDocs.entries()) {
      if (!isTargetStage(dealId)) continue;
      const issues = docs
        .filter((d) => d.status === "ACTION_REQUIRED" || d.status === "REJECTED")
        .map((d) => ({ docName: d.docName, status: d.status, notes: d.notes }));
      if (issues.length > 0) {
        actionRequired.push({
          dealId,
          dealName: dealNameMap.get(dealId) ?? null,
          stage: stageLabel(dealId),
          issues,
          hubspotUrl: hsUrl(dealId),
          pePortalUrl: portalUrlMap.get(dealId) ?? null,
          driveUrl: driveUrlMap.get(dealId) ?? null,
        });
      }
    }
    actionRequired.sort((a, b) => b.issues.length - a.issues.length);

    // -----------------------------------------------------------------------
    // 6. Build and send email
    // -----------------------------------------------------------------------
    const dateStr = todayStart.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "America/Denver",
    });

    // Full per-deal detail (300KB+ across ~130 deals) lives in the PE Document
    // Tracker, not the email — Gmail clips messages over ~102KB, which truncates
    // the digest mid-list. The email shows a summary + a link to the tracker.
    const reportUrl = "https://pbtechops.com/dashboards/pe-docs";

    const html = await render(
      PeDocDigest({
        date: dateStr,
        totalDealsTracked: dealDocs.size,
        nearlyComplete,
        notUploaded,
        actionRequired,
        changes: [],
        reportUrl,
      }),
    );

    // Plain-text fallback — summary + link, mirroring the HTML email.
    const plainLines = [
      `PE Doc Digest — ${dateStr}`,
      `${dealDocs.size} PE deals tracked`,
      "",
      `Nearly Complete — ${nearlyComplete.length} deals just 1-3 docs from done`,
      `Not Uploaded — ${notUploaded.length} deals with missing documents`,
      `Action Required — ${actionRequired.length} deals with PE rejections to fix`,
      "",
      `Full per-deal status, rejection notes, and links:`,
      reportUrl,
    ];

    const subjectParts = [`PE Doc Digest — ${dateStr}`];
    if (nearlyComplete.length > 0) subjectParts.push(`${nearlyComplete.length} nearly done`);
    if (notUploaded.length > 0) subjectParts.push(`${notUploaded.length} not uploaded`);
    if (actionRequired.length > 0) subjectParts.push(`${actionRequired.length} need action`);

    const result = await sendEmailMessage({
      to: RECIPIENTS,
      subject: subjectParts.join(" | "),
      html,
      text: plainLines.join("\n"),
      debugFallbackTitle: "PE Doc Digest",
      debugFallbackBody: plainLines.join("\n"),
    });

    console.warn(
      `[pe-doc-digest] Sent to ${RECIPIENTS.join(", ")}: ` +
      `${nearlyComplete.length} nearly complete, ${notUploaded.length} not uploaded, ` +
      `${actionRequired.length} need action, ` +
      `email ${result.success ? "delivered" : "failed"}`,
    );

    return NextResponse.json({
      sent: result.success,
      recipients: RECIPIENTS,
      nearlyCompleteCount: nearlyComplete.length,
      notUploadedCount: notUploaded.length,
      actionRequiredCount: actionRequired.length,
      totalDealsTracked: dealDocs.size,
      date: dateStr,
    });
  } catch (err) {
    console.error("[pe-doc-digest] Error:", err);
    return NextResponse.json(
      {
        error: "Digest failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
