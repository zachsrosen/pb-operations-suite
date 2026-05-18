/**
 * Inbox-scan extractor.
 *
 * Searches the appropriate shared mailbox(es) for PDF attachments that
 * could satisfy one of the PE checklist documents the audit currently
 * flags missing:
 *
 *   - AHJ Signed Final Permit       → permitsdn@ (CO) / permitting@ (CA)
 *   - Signed Interconnection Agt.   → interconnections@ (CO) / interconnectionsca@ (CA)
 *   - PTO Letter                     → interconnections@ / interconnectionsca@
 *
 * Returns a list of candidates keyed to the doc type. The analyzer pairs
 * each with a vision-verification call to confirm what it actually is,
 * then emits a task with a deep-link to the email.
 */

import { fetchSharedInboxAttachments, getSharedInboxAddress, type SharedInboxAttachment } from "@/lib/gmail-shared-inbox";
import type { ResolvedPEDeal } from "@/lib/pe-turnover";

export type InboxDocType = "permit" | "ia" | "pto";

export interface InboxCandidate {
  docType: InboxDocType;
  mailbox: string;
  attachment: SharedInboxAttachment;
}

/** Derive CA / CO region from deal address. CA addresses contain ", CA " or " CA "; everything else defaults to CO. */
export function dealRegion(deal: ResolvedPEDeal): "co" | "ca" {
  const addr = deal.address.toUpperCase();
  // Match either ", CA," or ", CA " (state segment).
  return /\bCA\b/.test(addr) && !/COLORADO|\bCO\b/.test(addr.slice(0, addr.indexOf(",") + 30) || addr)
    ? "ca"
    : addr.includes(", CA ") || addr.includes(", CA,")
      ? "ca"
      : "co";
}

/** Customer last name from "PROJ-XXXX | Last, First | Address". Empty string if not parseable. */
export function customerLastName(deal: ResolvedPEDeal): string {
  const parts = deal.dealName.split("|").map((s) => s.trim());
  const customerSeg = parts[1] ?? "";
  return customerSeg.split(",")[0]?.trim() ?? "";
}

/** Build a Gmail search query for a deal — favor recent (last 180d) + PDF attachments + customer name. */
export function buildDealQuery(deal: ResolvedPEDeal): string {
  const lastName = customerLastName(deal);
  // Gmail q= supports: filename:pdf, has:attachment, newer_than:180d
  const parts = ["has:attachment", "filename:pdf", "newer_than:180d"];
  if (lastName) parts.push(`"${lastName}"`);
  return parts.join(" ");
}

/**
 * Search both the permit and IC inboxes (region-appropriate) for PDF
 * attachments matching the deal. Returns up to `maxPerDocType` candidates
 * per doc type, oldest-first.
 */
export async function scanInboxesForDeal(
  deal: ResolvedPEDeal,
  opts: { maxPerDocType?: number } = {},
): Promise<{ candidates: InboxCandidate[]; mailboxes: { permit: string | null; ic: string | null } }> {
  const region = dealRegion(deal);
  const permitMailbox = getSharedInboxAddress("permit", region);
  const icMailbox = getSharedInboxAddress("ic", region);
  const query = buildDealQuery(deal);
  const maxPerDocType = opts.maxPerDocType ?? 5;

  const candidates: InboxCandidate[] = [];

  // Permit inbox → permit/inspection candidates
  if (permitMailbox) {
    const result = await fetchSharedInboxAttachments({ mailbox: permitMailbox, query, maxMessages: 25 });
    if (result.ok) {
      for (const att of result.attachments.slice(0, maxPerDocType)) {
        candidates.push({ docType: "permit", mailbox: permitMailbox, attachment: att });
      }
    }
  }

  // IC inbox → both interconnection agreement AND PTO letter candidates
  // (utility sends both via this address). Vision verification per-attachment
  // distinguishes which it is.
  if (icMailbox) {
    const result = await fetchSharedInboxAttachments({ mailbox: icMailbox, query, maxMessages: 25 });
    if (result.ok) {
      for (const att of result.attachments.slice(0, maxPerDocType * 2)) {
        // Add as both "ia" and "pto" candidates — analyzer's vision pass narrows it down
        candidates.push({ docType: "ia", mailbox: icMailbox, attachment: att });
        candidates.push({ docType: "pto", mailbox: icMailbox, attachment: att });
      }
    }
  }

  return { candidates, mailboxes: { permit: permitMailbox, ic: icMailbox } };
}
