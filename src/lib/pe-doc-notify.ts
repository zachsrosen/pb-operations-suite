import { render } from "@react-email/render";
import { sendEmailMessage } from "@/lib/email";
import { PeDocDigest, type PeDocChange } from "@/emails/PeDocDigest";
import { prisma } from "@/lib/db";
import { hubspotClient } from "@/lib/hubspot";
import { meaningfulNote, type DocChange } from "@/lib/pe-scraper-sync";

const RECIPIENT = "zach@photonbrothers.com";
// Strip any stray whitespace/escape chars — env var has been seen with a trailing newline
const PORTAL_ID = (process.env.HUBSPOT_PORTAL_ID || "21710069").replace(/[^0-9]/g, "") || "21710069";

// Persists the timestamp of the last PE Doc Update email so each new one can
// show the gap since the previous reported batch of changes.
const LAST_SENT_KEY = "pe-doc-notify:last-sent-at";

/** Compact human gap, e.g. "<1m", "8m", "3h 12m", "2d 4h". */
function formatGap(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 1) return "<1m";
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

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

    // HubSpot batch read is the primary source for deal names + pe_portal_url.
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
      // Non-fatal — the DB changelog fallback below fills in names.
    }

    // Fill any names HubSpot didn't resolve (request failed, or deal missing a
    // name) from the change-log table so deals show a name, never just an ID.
    const missingNameIds = dealIds.filter((id) => !nameMap.has(id));
    if (missingNameIds.length > 0 && prisma) {
      try {
        const rows = await prisma.peDocChangeLog.findMany({
          where: { dealId: { in: missingNameIds }, dealName: { not: null } },
          select: { dealId: true, dealName: true },
          distinct: ["dealId"],
          orderBy: { createdAt: "desc" },
        });
        for (const r of rows) {
          if (r.dealName) nameMap.set(r.dealId, r.dealName);
        }
      } catch {
        // Best-effort — proceed without the remaining names.
      }
    }

    // Map DocChange → PeDocChange (adding dealName + reviewer notes + URLs)
    const emailChanges: PeDocChange[] = changes.map((c) => ({
      dealId: c.dealId,
      dealName: nameMap.get(c.dealId) ?? null,
      docName: c.docName,
      oldStatus: c.oldStatus,
      newStatus: c.newStatus,
      // Strip our "Synced from PE portal scraper (…)" boilerplate so the email
      // only shows a real PE note (or none).
      notes: meaningfulNote(c.newNotes) || null,
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

    // Gap since the previous PE Doc Update email (time between reported batches).
    let sinceLastEmail: string | undefined;
    try {
      const row = await prisma.systemConfig.findUnique({ where: { key: LAST_SENT_KEY } });
      let prev: Date | null = row?.value ? new Date(row.value) : null;
      if (!prev || Number.isNaN(prev.getTime())) {
        // No anchor yet (first email after deploy) — fall back to the most
        // recent prior change in the log. The current batch is already written
        // by now, so exclude the last 2 minutes to skip it.
        const cutoff = new Date(now.getTime() - 2 * 60_000);
        const last = await prisma.peDocChangeLog.findFirst({
          where: { createdAt: { lt: cutoff } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });
        prev = last?.createdAt ?? null;
      }
      if (prev && !Number.isNaN(prev.getTime())) {
        sinceLastEmail = formatGap(now.getTime() - prev.getTime());
      }
    } catch {
      // Best-effort — omit the line if the timestamp can't be read.
    }

    const html = await render(
      PeDocDigest({
        date: `${dateStr} at ${timeStr}`,
        changes: emailChanges,
        sinceLastEmail,
        totalDealsTracked: 0, // not computed for instant notifications
        nearlyComplete: [],
        notUploaded: [],
        actionRequired: [],
      }),
    );

    // Overview rollup of all changes by resulting status, mirroring the HTML.
    // UPLOADED is merged into UNDER_REVIEW ("In Review"); normalize before
    // counting/labeling so the two never appear as separate buckets.
    const canonStatus = (s: string) => (s === "UPLOADED" ? "UNDER_REVIEW" : s);
    const STATUS_ORDER = [
      "APPROVED",
      "ACTION_REQUIRED",
      "REJECTED",
      "UNDER_REVIEW",
      "NOT_UPLOADED",
    ];
    const STATUS_LABELS: Record<string, string> = {
      NOT_UPLOADED: "Not Uploaded",
      UPLOADED: "In Review",
      UNDER_REVIEW: "In Review",
      ACTION_REQUIRED: "Action Required",
      REJECTED: "Rejected",
      APPROVED: "Approved",
    };
    // Rows where the (canonical) status didn't move are note-only updates, not
    // real transitions — tally them separately rather than under a status count.
    const statusCounts = new Map<string, number>();
    let noteUpdateCount = 0;
    for (const c of emailChanges) {
      if (canonStatus(c.oldStatus) === canonStatus(c.newStatus)) {
        noteUpdateCount++;
        continue;
      }
      statusCounts.set(canonStatus(c.newStatus), (statusCounts.get(canonStatus(c.newStatus)) || 0) + 1);
    }
    const overviewLine = [
      ...STATUS_ORDER.filter((s) => statusCounts.has(s)).map(
        (s) => `${statusCounts.get(s)} ${STATUS_LABELS[s] || s}`,
      ),
      ...(noteUpdateCount > 0 ? [`${noteUpdateCount} note updated`] : []),
    ].join(" · ");

    const plainLines = [
      `PE Doc Changes — ${dateStr} at ${timeStr}`,
      `${changes.length} change(s) across ${dealCount} deal(s)`,
      ...(sinceLastEmail ? [`${sinceLastEmail} since last update`] : []),
      `Source: ${source}`,
      "",
      `Overview: ${overviewLine}`,
      "",
      ...emailChanges.flatMap((c) => {
        const dealLabel = c.dealName || `Deal ${c.dealId}`;
        const oldLabel = STATUS_LABELS[c.oldStatus] || c.oldStatus;
        const newLabel = STATUS_LABELS[c.newStatus] || c.newStatus;
        const line =
          canonStatus(c.oldStatus) === canonStatus(c.newStatus)
            ? `${dealLabel}: ${c.docName} — note updated (${newLabel})`
            : `${dealLabel}: ${c.docName} — ${oldLabel} → ${newLabel}`;
        return c.notes ? [line, `  “${c.notes}”`] : [line];
      }),
    ];

    const result = await sendEmailMessage({
      to: RECIPIENT,
      subject: `PE Doc Update — ${changes.length} change${changes.length !== 1 ? "s" : ""} across ${dealCount} deal${dealCount !== 1 ? "s" : ""}`,
      html,
      text: plainLines.join("\n"),
      debugFallbackTitle: "PE Doc Change Notification",
      debugFallbackBody: plainLines.join("\n"),
    });

    // Record this send as the new "last update" anchor (only on success, so a
    // failed send doesn't reset the gap measured by the next email).
    if (result.success) {
      await prisma.systemConfig
        .upsert({
          where: { key: LAST_SENT_KEY },
          create: { key: LAST_SENT_KEY, value: now.toISOString() },
          update: { value: now.toISOString() },
        })
        .catch(() => {});
    }

    console.warn(
      `[pe-doc-notify] Sent ${changes.length} changes to ${RECIPIENT} (${source}): ${result.success ? "delivered" : "failed"}`,
    );

    return { sent: result.success, error: result.error };
  } catch (err) {
    console.error("[pe-doc-notify] Failed to send notification:", err);
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}
