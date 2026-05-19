import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmailMessage } from "@/lib/email";
import { render } from "@react-email/render";
import { PeDocDigest } from "@/emails/PeDocDigest";

/**
 * GET /api/cron/pe-doc-digest
 *
 * Vercel cron job — sends a daily email digest of PE document status changes.
 * Queries PeDocChangeLog for today's changes and emails a summary.
 *
 * Schedule: 21:30 UTC (5:30 PM EST) weekdays
 * Protected by CRON_SECRET.
 */
export const maxDuration = 30;

const RECIPIENT = "zach@photonbrothers.com";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Query today's changes (UTC day boundaries)
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

    // Get total PE deal count for context
    const totalDeals = await prisma.peDocumentReview.findMany({
      select: { dealId: true },
      distinct: ["dealId"],
    });

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
        totalDealsTracked: totalDeals.length,
      }),
    );

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

    const result = await sendEmailMessage({
      to: RECIPIENT,
      subject: `PE Doc Changes — ${dateStr} (${changes.length} change${changes.length !== 1 ? "s" : ""})`,
      html,
      text: plainLines.join("\n"),
      debugFallbackTitle: "PE Doc Digest",
      debugFallbackBody: plainLines.join("\n"),
    });

    console.warn(
      `[pe-doc-digest] Sent to ${RECIPIENT}: ${changes.length} changes, email ${result.success ? "delivered" : "failed"}`,
    );

    return NextResponse.json({
      sent: result.success,
      changesCount: changes.length,
      dealsAffected: new Set(changes.map((c) => c.dealId)).size,
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
