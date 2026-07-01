import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmailMessage } from "@/lib/email";
import { hubspotClient } from "@/lib/hubspot";

/**
 * GET /api/cron/pe-clawback-alert
 *
 * Same-day alert for PE "clawbacks" — documents PE had already APPROVED that
 * flip back to ACTION_REQUIRED / REJECTED. The usual culprit is Raceway's ANCHOR
 * Reconciler auto-reopening approved docs (often phantom "NAD changed $X to $X"
 * no-ops in same-minute batches — see the reRejections work in #1271), but a
 * human PE reviewer clawing back an approval is just as worth surfacing.
 *
 * Emails Zach only when there's at least one flip in the trailing window, so a
 * clean day is silent. Each flip is one PeDocChangeLog event, so a persistent
 * unresolved clawback is reported once (the day it happens), not every day.
 *
 * Schedule: 14:15 UTC (8:15 AM MT) daily, just after the 14:00 pe-api-sync — see
 * vercel.json. Protected by CRON_SECRET. `?dryRun=1` returns the findings JSON
 * without sending the email.
 */
export const maxDuration = 30;

const RECIPIENTS = ["zach@photonbrothers.com"];
const PORTAL_ID = (process.env.HUBSPOT_PORTAL_ID || "21710069").replace(/[^0-9]/g, "") || "21710069";
const WINDOW_HOURS = 25; // daily run; 25h overlaps slightly so nothing slips a gap

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

  const since = new Date(Date.now() - WINDOW_HOURS * 3_600_000);

  // Docs PE had APPROVED that flipped back to action-required in the window.
  const flipRows = await prisma.peDocChangeLog.findMany({
    where: {
      oldStatus: "APPROVED",
      newStatus: { in: ["ACTION_REQUIRED", "REJECTED"] },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    select: { dealId: true, docName: true, newStatus: true, createdAt: true },
  });

  // One row per (deal, doc); keep the newest flip.
  const seen = new Set<string>();
  const flips = flipRows.filter((f) => {
    const k = `${f.dealId}::${f.docName}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (flips.length === 0) {
    return NextResponse.json({ clawbacks: 0, windowHours: WINDOW_HOURS });
  }

  // Enrich: deal name (best effort), PE project id, and whether ANCHOR is the
  // attributed actor. Reviewer on PeActionItem is the API's activityBy (raiser),
  // so an ANCHOR-raised re-rejection shows reviewer = "ANCHOR Reconciler".
  const dealIds = [...new Set(flips.map((f) => f.dealId))];
  const [cacheRows, actionRows] = await Promise.all([
    prisma.hubSpotProjectCache.findMany({
      where: { dealId: { in: dealIds } },
      select: { dealId: true, dealName: true, customerName: true },
    }),
    prisma.peActionItem.findMany({
      where: { dealId: { in: dealIds } },
      orderBy: { actionDate: "desc" },
      select: { dealId: true, reviewer: true },
    }),
  ]);
  const nameByDeal = new Map(cacheRows.map((r) => [r.dealId, r.dealName || r.customerName || ""]));
  const anchorDeals = new Set<string>();
  for (const a of actionRows) {
    if (a.dealId && a.reviewer && /anchor/i.test(a.reviewer)) anchorDeals.add(a.dealId);
  }

  // Authoritative deal names + PE portal links straight from HubSpot (the cache
  // misses many PE deals). Best-effort — never fail the alert on a HubSpot hiccup.
  const portalByDeal = new Map<string, string>();
  try {
    const resp = await hubspotClient.crm.deals.batchApi.read({
      inputs: dealIds.map((id) => ({ id })),
      properties: ["dealname", "pe_portal_url"],
      propertiesWithHistory: [],
    });
    for (const d of resp.results) {
      const id = String(d.id);
      if (d.properties.dealname) nameByDeal.set(id, d.properties.dealname);
      if (d.properties.pe_portal_url) portalByDeal.set(id, d.properties.pe_portal_url);
    }
  } catch (err) {
    console.warn(`[pe-clawback-alert] HubSpot name lookup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  const rows = flips.map((f) => ({
    dealId: f.dealId,
    name: nameByDeal.get(f.dealId) || "",
    doc: f.docName,
    status: f.newStatus,
    at: f.createdAt.toISOString(),
    anchor: anchorDeals.has(f.dealId),
    hubspotUrl: `https://app.hubspot.com/contacts/${PORTAL_ID}/record/0-3/${f.dealId}`,
    portalUrl: portalByDeal.get(f.dealId) || "",
  }));

  const anchorCount = rows.filter((r) => r.anchor).length;
  const subject = `⚠️ PE clawback: ${rows.length} approved doc${rows.length === 1 ? "" : "s"} re-opened${anchorCount ? ` (${anchorCount} ANCHOR)` : ""}`;

  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  const rowsHtml = rows
    .map((r) => {
      const label = r.name ? esc(r.name) : esc(r.dealId);
      const badge = r.anchor
        ? `<span style="background:#fde68a;color:#92400e;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:600;">ANCHOR</span>`
        : "";
      const peLink = r.portalUrl ? ` · <a href="${esc(r.portalUrl)}" style="color:#666;">PE</a>` : "";
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;"><a href="${r.hubspotUrl}">${label}</a>${peLink} ${badge}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(r.doc)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(r.status)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#666;">${r.at.slice(0, 16).replace("T", " ")} UTC</td>
      </tr>`;
    })
    .join("");
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;color:#111;">
      <p><strong>${rows.length}</strong> document${rows.length === 1 ? "" : "s"} PE had already <strong>approved</strong> flipped back to action-required in the last ${WINDOW_HOURS}h${anchorCount ? `, ${anchorCount} attributed to the <strong>ANCHOR Reconciler</strong>` : ""}.</p>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <thead><tr>
          <th align="left" style="padding:6px 10px;border-bottom:2px solid #ddd;">Deal</th>
          <th align="left" style="padding:6px 10px;border-bottom:2px solid #ddd;">Document</th>
          <th align="left" style="padding:6px 10px;border-bottom:2px solid #ddd;">Now</th>
          <th align="left" style="padding:6px 10px;border-bottom:2px solid #ddd;">Flipped</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p style="color:#666;font-size:12px;margin-top:14px;">ANCHOR clawbacks are usually phantom no-ops; the doc typically returns to review once resubmitted. Persistent ones are worth raising with Raceway. Full history: PE Analytics → Re-Rejected After Approval.</p>
    </div>`;
  const text = [
    `${rows.length} approved PE doc(s) re-opened in the last ${WINDOW_HOURS}h${anchorCount ? ` (${anchorCount} ANCHOR)` : ""}:`,
    ...rows.map((r) => `- ${r.name || r.dealId} — ${r.doc} → ${r.status}${r.anchor ? " [ANCHOR]" : ""} — ${r.hubspotUrl}`),
  ].join("\n");

  if (dryRun) {
    return NextResponse.json({ clawbacks: rows.length, anchorCount, subject, rows });
  }

  const result = await sendEmailMessage({
    to: RECIPIENTS,
    subject,
    html,
    text,
    debugFallbackTitle: "PE Clawback Alert",
    debugFallbackBody: text,
  });

  return NextResponse.json({ clawbacks: rows.length, anchorCount, sent: result.success });
}
