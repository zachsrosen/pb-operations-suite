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
    // 1. Today's changes from PeDocChangeLog
    // -----------------------------------------------------------------------
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);

    const changes = await prisma.peDocChangeLog.findMany({
      where: {
        createdAt: { gte: todayStart, lte: todayEnd },
      },
      orderBy: { createdAt: "asc" },
    });

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
    try {
      const chunks = [];
      for (let i = 0; i < allDealIds.length; i += 100) {
        chunks.push(allDealIds.slice(i, i + 100));
      }
      for (const chunk of chunks) {
        const resp = await hubspotClient.crm.deals.batchApi.read({
          inputs: chunk.map((id) => ({ id })),
          properties: ["dealname", "dealstage", "pe_portal_url"],
          propertiesWithHistory: [],
        });
        for (const deal of resp.results) {
          const id = String(deal.id);
          if (deal.properties.pe_portal_url) portalUrlMap.set(id, deal.properties.pe_portal_url);
          if (deal.properties.dealname) dealNameMap.set(id, deal.properties.dealname);
          if (deal.properties.dealstage) dealStageMap.set(id, deal.properties.dealstage);
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

    const emailChanges = changes.map((c) => ({
      dealId: c.dealId,
      dealName: c.dealName,
      docName: c.docName,
      oldStatus: c.oldStatus,
      newStatus: c.newStatus,
      hubspotUrl: hsUrl(c.dealId),
      pePortalUrl: portalUrlMap.get(c.dealId) ?? null,
    }));

    const html = await render(
      PeDocDigest({
        date: dateStr,
        totalDealsTracked: dealDocs.size,
        nearlyComplete,
        notUploaded,
        actionRequired,
        changes: emailChanges,
      }),
    );

    // Plain-text fallback
    const plainLines = [
      `PE Doc Digest — ${dateStr}`,
      `${dealDocs.size} PE deals tracked`,
      "",
    ];

    if (nearlyComplete.length > 0) {
      plainLines.push(`--- NEARLY COMPLETE (${nearlyComplete.length}) ---`);
      for (const deal of nearlyComplete) {
        plainLines.push(`${deal.dealName || deal.dealId} (${deal.stage}): ${deal.approvedCount}/${deal.totalDocs} approved, ${deal.missingDocs.length} need action — ${deal.missingDocs.join(", ")}`);
      }
      plainLines.push("");
    }

    if (notUploaded.length > 0) {
      plainLines.push(`--- NOT UPLOADED (${notUploaded.length}) ---`);
      for (const deal of notUploaded) {
        plainLines.push(`${deal.dealName || deal.dealId} (${deal.stage}) — ${deal.missingDocs.length} missing: ${deal.missingDocs.join(", ")}`);
      }
      plainLines.push("");
    }

    if (actionRequired.length > 0) {
      plainLines.push(`--- ACTION REQUIRED (${actionRequired.length}) ---`);
      for (const deal of actionRequired) {
        plainLines.push(`${deal.dealName || deal.dealId} (${deal.stage}) — ${deal.issues.length} rejection(s):`);
        for (const issue of deal.issues) {
          const noteSnippet = issue.notes ? `: ${issue.notes.slice(0, 120)}` : "";
          plainLines.push(`  ${issue.docName}${noteSnippet}`);
        }
      }
      plainLines.push("");
    }

    if (emailChanges.length > 0) {
      plainLines.push(`--- TODAY'S CHANGES (${emailChanges.length}) ---`);
      for (const c of emailChanges) {
        plainLines.push(`${c.dealName || c.dealId}: ${c.docName} — ${c.oldStatus} → ${c.newStatus}`);
      }
    } else {
      plainLines.push("No document status changes today.");
    }

    const subjectParts = [`PE Doc Digest — ${dateStr}`];
    if (nearlyComplete.length > 0) subjectParts.push(`${nearlyComplete.length} nearly done`);
    if (notUploaded.length > 0) subjectParts.push(`${notUploaded.length} not uploaded`);
    if (actionRequired.length > 0) subjectParts.push(`${actionRequired.length} need action`);
    if (emailChanges.length > 0) subjectParts.push(`${emailChanges.length} change${emailChanges.length !== 1 ? "s" : ""}`);

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
      `${actionRequired.length} need action, ${emailChanges.length} changes, ` +
      `email ${result.success ? "delivered" : "failed"}`,
    );

    return NextResponse.json({
      sent: result.success,
      recipients: RECIPIENTS,
      nearlyCompleteCount: nearlyComplete.length,
      notUploadedCount: notUploaded.length,
      actionRequiredCount: actionRequired.length,
      changesCount: emailChanges.length,
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
