import { render } from "@react-email/render";
import { sendEmailMessage } from "@/lib/email";
import { PeDocDigest, type PeDocChange } from "@/emails/PeDocDigest";
import { prisma } from "@/lib/db";
import type { DocChange } from "@/lib/pe-scraper-sync";

const RECIPIENT = "zach@photonbrothers.com";

/**
 * Send a real-time PE doc change notification email.
 * Called from both the webhook and cron sync handlers whenever changes are detected.
 * The daily digest (pe-doc-digest cron) still runs separately with full analysis.
 */
export async function sendPeDocChangeNotification(
  changes: DocChange[],
  source: string,
): Promise<{ sent: boolean; error?: string }> {
  if (changes.length === 0) return { sent: false };

  try {
    // Resolve deal names from PeDocChangeLog (populated during sync)
    const dealIds = [...new Set(changes.map((c) => c.dealId))];
    const nameMap = new Map<string, string>();
    if (prisma) {
      try {
        const rows = await prisma.peDocChangeLog.findMany({
          where: { dealId: { in: dealIds }, dealName: { not: null } },
          select: { dealId: true, dealName: true },
          distinct: ["dealId"],
          orderBy: { createdAt: "desc" },
        });
        for (const r of rows) {
          if (r.dealName) nameMap.set(r.dealId, r.dealName);
        }
      } catch {
        // Best-effort — proceed without names if DB lookup fails
      }
    }

    // Map DocChange → PeDocChange (adding dealName)
    const emailChanges: PeDocChange[] = changes.map((c) => ({
      dealId: c.dealId,
      dealName: nameMap.get(c.dealId) ?? null,
      docName: c.docName,
      oldStatus: c.oldStatus,
      newStatus: c.newStatus,
    }));

    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Denver",
    });
    const dateStr = now.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "America/Denver",
    });

    const dealCount = dealIds.length;

    const html = await render(
      PeDocDigest({
        date: `${dateStr} at ${timeStr}`,
        changes: emailChanges,
        totalDealsTracked: 0, // not computed for instant notifications
        nearlyComplete: [],
        needsAttention: [],
      }),
    );

    const plainLines = [
      `PE Doc Changes — ${dateStr} at ${timeStr}`,
      `${changes.length} change(s) across ${dealCount} deal(s)`,
      `Source: ${source}`,
      "",
      ...emailChanges.map(
        (c) =>
          `${c.dealName || c.dealId}: ${c.docName} — ${c.oldStatus} → ${c.newStatus}`,
      ),
    ];

    const result = await sendEmailMessage({
      to: RECIPIENT,
      subject: `PE Doc Update — ${changes.length} change${changes.length !== 1 ? "s" : ""} across ${dealCount} deal${dealCount !== 1 ? "s" : ""}`,
      html,
      text: plainLines.join("\n"),
      debugFallbackTitle: "PE Doc Change Notification",
      debugFallbackBody: plainLines.join("\n"),
    });

    console.warn(
      `[pe-doc-notify] Sent ${changes.length} changes to ${RECIPIENT} (${source}): ${result.success ? "delivered" : "failed"}`,
    );

    return { sent: result.success, error: result.error };
  } catch (err) {
    console.error("[pe-doc-notify] Failed to send notification:", err);
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}
