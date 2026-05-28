import { render } from "@react-email/render";
import { sendEmailMessage } from "@/lib/email";
import { PeDocDigest, type PeDocChange } from "@/emails/PeDocDigest";
import { prisma } from "@/lib/db";
import { hubspotClient } from "@/lib/hubspot";
import type { DocChange } from "@/lib/pe-scraper-sync";

const RECIPIENT = "zach@photonbrothers.com";
// Strip any stray whitespace/escape chars — env var has been seen with a trailing newline
const PORTAL_ID = (process.env.HUBSPOT_PORTAL_ID || "21710069").replace(/[^0-9]/g, "") || "21710069";

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
    // Resolve deal names + PE portal URLs
    const dealIds = [...new Set(changes.map((c) => c.dealId))];
    const nameMap = new Map<string, string>();
    const portalUrlMap = new Map<string, string>();

    // Try HubSpot batch read for deal names + pe_portal_url
    try {
      const batchResponse = await hubspotClient.crm.deals.batchApi.read({
        inputs: dealIds.map((id) => ({ id })),
        properties: ["dealname", "pe_portal_url"],
        propertiesWithHistory: [],
      });
      for (const deal of batchResponse.results) {
        const id = String(deal.id);
        if (deal.properties.dealname) nameMap.set(id, deal.properties.dealname);
        if (deal.properties.pe_portal_url) portalUrlMap.set(id, deal.properties.pe_portal_url);
      }
    } catch {
      // Fall back to DB for names
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
          // Best-effort — proceed without names
        }
      }
    }

    // Map DocChange → PeDocChange (adding dealName + URLs)
    const emailChanges: PeDocChange[] = changes.map((c) => ({
      dealId: c.dealId,
      dealName: nameMap.get(c.dealId) ?? null,
      docName: c.docName,
      oldStatus: c.oldStatus,
      newStatus: c.newStatus,
      hubspotUrl: `https://app.hubspot.com/contacts/${PORTAL_ID}/record/0-3/${c.dealId}`,
      pePortalUrl: portalUrlMap.get(c.dealId) ?? null,
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
        notUploaded: [],
        actionRequired: [],
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
