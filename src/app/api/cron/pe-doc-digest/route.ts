import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmailMessage } from "@/lib/email";
import { render } from "@react-email/render";
import {
  PeDocDigest,
  type NearlyCompleteDeal,
  type AttentionDeal,
} from "@/emails/PeDocDigest";

/**
 * GET /api/cron/pe-doc-digest
 *
 * Vercel cron job — sends a daily email digest of PE document status changes
 * plus snapshot flags for deals needing attention or nearly complete.
 *
 * Schedule: 21:30 UTC (5:30 PM EST) weekdays
 * Protected by CRON_SECRET.
 */
export const maxDuration = 30;

const RECIPIENT = "zach@photonbrothers.com";
const TOTAL_DOCS_PER_DEAL = 15;

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
    // 2. Current snapshot: all doc statuses grouped by deal
    // -----------------------------------------------------------------------
    const allDocs = await prisma.peDocumentReview.findMany({
      select: { dealId: true, docName: true, status: true },
    });

    // Group by deal
    const dealDocs = new Map<string, { docName: string; status: string }[]>();
    for (const doc of allDocs) {
      if (!dealDocs.has(doc.dealId)) dealDocs.set(doc.dealId, []);
      dealDocs.get(doc.dealId)!.push({ docName: doc.docName, status: doc.status });
    }

    // Resolve deal names from change log or recent reviews
    const dealNameMap = new Map<string, string>();
    for (const c of changes) {
      if (c.dealName) dealNameMap.set(c.dealId, c.dealName);
    }
    // Also try to get names from the change log history for deals not in today's changes
    const recentNames = await prisma.peDocChangeLog.findMany({
      where: { dealName: { not: null } },
      select: { dealId: true, dealName: true },
      distinct: ["dealId"],
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    for (const r of recentNames) {
      if (r.dealName && !dealNameMap.has(r.dealId)) {
        dealNameMap.set(r.dealId, r.dealName);
      }
    }

    // -----------------------------------------------------------------------
    // 3. Compute "Needs Attention" — deals with REJECTED or ACTION_REQUIRED
    // -----------------------------------------------------------------------
    const needsAttention: AttentionDeal[] = [];
    for (const [dealId, docs] of dealDocs.entries()) {
      const issues = docs
        .filter((d) => d.status === "ACTION_REQUIRED" || d.status === "REJECTED")
        .map((d) => ({ docName: d.docName, status: d.status }));
      if (issues.length > 0) {
        needsAttention.push({
          dealId,
          dealName: dealNameMap.get(dealId) ?? null,
          issues,
        });
      }
    }
    needsAttention.sort((a, b) =>
      (a.dealName || a.dealId).localeCompare(b.dealName || b.dealId),
    );

    // -----------------------------------------------------------------------
    // 4. Compute "Nearly Complete" — deals where only 1-3 docs are
    //    NOT_UPLOADED or ACTION_REQUIRED (needs action to finish)
    // -----------------------------------------------------------------------
    const nearlyComplete: NearlyCompleteDeal[] = [];
    for (const [dealId, docs] of dealDocs.entries()) {
      const blocking = docs.filter((d) => d.status === "NOT_UPLOADED" || d.status === "ACTION_REQUIRED");
      if (blocking.length >= 1 && blocking.length <= 3 && docs.length >= TOTAL_DOCS_PER_DEAL - 3) {
        const approvedCount = docs.filter((d) => d.status === "APPROVED").length;
        const inProgressCount = docs.filter(
          (d) => d.status === "UPLOADED" || d.status === "UNDER_REVIEW",
        ).length;
        nearlyComplete.push({
          dealId,
          dealName: dealNameMap.get(dealId) ?? null,
          approvedCount,
          inProgressCount,
          totalDocs: TOTAL_DOCS_PER_DEAL,
          missingDocs: blocking.map((d) => d.docName),
        });
      }
    }
    nearlyComplete.sort((a, b) => b.approvedCount - a.approvedCount);

    // -----------------------------------------------------------------------
    // 5. Build and send email
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
    }));

    const html = await render(
      PeDocDigest({
        date: dateStr,
        changes: emailChanges,
        totalDealsTracked: dealDocs.size,
        nearlyComplete,
        needsAttention,
      }),
    );

    // Plain-text fallback
    const plainLines = [
      `PE Doc Status Changes — ${dateStr}`,
      `${changes.length} change(s) across ${new Set(changes.map((c) => c.dealId)).size} deal(s)`,
      "",
      ...changes.map(
        (c) =>
          `${c.dealName || c.dealId}: ${c.docName} — ${c.oldStatus} → ${c.newStatus}`,
      ),
    ];
    if (changes.length === 0) {
      plainLines.push("No document status changes today.");
    }
    if (needsAttention.length > 0) {
      plainLines.push("", `--- NEEDS ATTENTION (${needsAttention.length}) ---`);
      for (const deal of needsAttention) {
        plainLines.push(`${deal.dealName || deal.dealId}:`);
        for (const issue of deal.issues) {
          plainLines.push(`  ${issue.status} — ${issue.docName}`);
        }
      }
    }
    if (nearlyComplete.length > 0) {
      plainLines.push("", `--- NEARLY COMPLETE (${nearlyComplete.length}) ---`);
      for (const deal of nearlyComplete) {
        const parts = [`${deal.approvedCount}/${deal.totalDocs} approved`];
        if (deal.inProgressCount > 0) parts.push(`${deal.inProgressCount} in review`);
        parts.push(`${deal.missingDocs.length} need action`);
        plainLines.push(
          `${deal.dealName || deal.dealId}: ${parts.join(" · ")} — need action: ${deal.missingDocs.join(", ")}`,
        );
      }
    }

    const subjectParts = [`PE Doc Digest — ${dateStr}`];
    if (changes.length > 0) subjectParts.push(`${changes.length} change${changes.length !== 1 ? "s" : ""}`);
    if (needsAttention.length > 0) subjectParts.push(`${needsAttention.length} need attention`);
    if (nearlyComplete.length > 0) subjectParts.push(`${nearlyComplete.length} nearly done`);

    const result = await sendEmailMessage({
      to: RECIPIENT,
      subject: subjectParts.join(" | "),
      html,
      text: plainLines.join("\n"),
      debugFallbackTitle: "PE Doc Digest",
      debugFallbackBody: plainLines.join("\n"),
    });

    console.warn(
      `[pe-doc-digest] Sent to ${RECIPIENT}: ${changes.length} changes, ` +
      `${needsAttention.length} need attention, ${nearlyComplete.length} nearly complete, ` +
      `email ${result.success ? "delivered" : "failed"}`,
    );

    return NextResponse.json({
      sent: result.success,
      changesCount: changes.length,
      dealsAffected: new Set(changes.map((c) => c.dealId)).size,
      needsAttentionCount: needsAttention.length,
      nearlyCompleteCount: nearlyComplete.length,
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
