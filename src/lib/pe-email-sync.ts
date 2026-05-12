/**
 * PE Email Sync — parses Participate Energy notification emails from
 * tpo@photonbrothers.com and upserts document statuses into PeDocumentReview.
 *
 * Emails follow a consistent format:
 *   Subject: "{Customer Name} - {Document Type}"
 *   Body: Reviewer, Status, Partner Comments, Approver Comments
 *
 * This is an incremental complement to the full portal scrape — emails
 * provide near-real-time deltas while the scrape provides periodic snapshots.
 */

import type { SharedInboxMessage } from "@/lib/gmail-shared-inbox";
import { fetchSharedInboxMessages } from "@/lib/gmail-shared-inbox";
import {
  DOC_NAME_MAP,
  buildPeDealMap,
  matchProjectToDeal,
} from "@/lib/pe-scraper-sync";
import type { ParsedProject } from "@/lib/pe-scraper-sync";
import { PeDocStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Constants & env
// ---------------------------------------------------------------------------

const PE_NOTIFICATION_SENDER =
  process.env.PE_NOTIFICATION_SENDER ?? "noreply@participate.energy";

const PE_TPO_MAILBOX =
  process.env.PE_TPO_MAILBOX ?? "tpo@photonbrothers.com";

const WATERMARK_KEY = "pe-email-sync:lastProcessedDate";

// Default lookback when no watermark exists: 7 days
const DEFAULT_LOOKBACK_DAYS = 7;

// ---------------------------------------------------------------------------
// Doc type mapping — email subject terms → canonical DB names
// ---------------------------------------------------------------------------

/**
 * Maps shortened/variant doc type names found in PE email subjects to
 * the 15 canonical names in PeDocumentReview. Keys MUST be lowercase.
 */
export const EMAIL_DOC_NAME_MAP: Record<string, string> = {
  photos: "Photos per Policy",
  photo: "Photos per Policy",
  proposal: "Signed Proposal",
  pto: "Permission to Operate (PTO)",
  "customer agreement": "Customer Agreement (PPA/ESA)",
  "lien waiver": "Conditional Progress Lien Waiver",
  "conditional waiver": "Conditional Waiver — Final Payment",
  "interconnection agreement": "Signed Interconnection Agreement",
  attestation: "Attestation of Customer Payment",
  "final permit": "Signed Final Permit",
  monitoring: "Access to Monitoring",
};

/**
 * The 15 canonical PE document names. Used to validate that a resolved
 * doc type is actually one we track, since `normalizeDocName()` from
 * pe-scraper-sync.ts falls back to the raw string (never null).
 */
export const CANONICAL_PE_DOC_NAMES = new Set([
  "Customer Agreement (PPA/ESA)",
  "Installation Order",
  "State Disclosures",
  "Utility Bill",
  "Signed Proposal",
  "Design Plan",
  "Photos per Policy",
  "Signed Final Permit",
  "Access to Monitoring",
  "Certificate of Acceptance",
  "Attestation of Customer Payment",
  "Conditional Progress Lien Waiver",
  "Signed Interconnection Agreement",
  "Conditional Waiver — Final Payment",
  "Permission to Operate (PTO)",
]);

// ---------------------------------------------------------------------------
// Status mapping — email status text → PeDocStatus enum
// ---------------------------------------------------------------------------

/**
 * Maps PE email status strings to PeDocStatus enum values.
 * Keys MUST be lowercase. PE emails use "Response Needed" for rejections.
 */
export const EMAIL_STATUS_MAP: Record<string, PeDocStatus> = {
  approved: PeDocStatus.APPROVED,
  "response needed": PeDocStatus.ACTION_REQUIRED,
  "under review": PeDocStatus.UNDER_REVIEW,
  uploaded: PeDocStatus.UPLOADED,
  "document uploaded": PeDocStatus.UPLOADED,
  "not uploaded": PeDocStatus.NOT_UPLOADED,
};

// ---------------------------------------------------------------------------
// Parser — subject + body → structured update
// ---------------------------------------------------------------------------

export interface PeEmailUpdate {
  customerName: string;
  docType: string; // canonical 15-doc name
  status: PeDocStatus;
  reviewer: string | null;
  partnerComments: string | null;
  approverComments: string | null;
  emailDate: Date;
  messageId: string;
}

/**
 * Parse a PE notification email into a structured update.
 * Returns null if the email can't be parsed (with console.warn).
 */
export function parsePeNotificationEmail(
  msg: SharedInboxMessage,
): PeEmailUpdate | null {
  const { subject, plainTextBody: body, date, id: messageId } = msg;

  // --- Subject parsing ---
  // Split on the LAST occurrence of " - " (space-dash-space).
  // Fallback: LAST occurrence of "- " (dash-space, for "Randolph-" variant).
  let separatorIdx = subject.lastIndexOf(" - ");
  let separatorLen = 3;

  if (separatorIdx === -1) {
    separatorIdx = subject.lastIndexOf("- ");
    separatorLen = 2;
  }

  if (separatorIdx === -1) {
    console.warn(
      `[pe-email-sync] Could not parse subject (no separator): "${subject}"`,
    );
    return null;
  }

  const customerName = subject.slice(0, separatorIdx).trim();
  const rawDocType = subject.slice(separatorIdx + separatorLen).trim();

  if (!customerName || !rawDocType) return null;

  // --- Doc type resolution ---
  // 1. Check email-specific map, 2. Check shared DOC_NAME_MAP, 3. Check if already canonical
  const docTypeLower = rawDocType.toLowerCase().trim();
  const docType =
    EMAIL_DOC_NAME_MAP[docTypeLower] ?? DOC_NAME_MAP[docTypeLower] ?? null;

  // If neither map matched, check if the raw doc type IS a canonical name already
  const resolvedDocType = docType ??
    (CANONICAL_PE_DOC_NAMES.has(rawDocType.trim()) ? rawDocType.trim() : null);

  if (!resolvedDocType) {
    console.warn(
      `[pe-email-sync] Unknown doc type "${rawDocType}" in subject: ${subject}`,
    );
    return null;
  }

  // --- Body parsing ---
  // Note: use [ \t]* (not \s*) after dashes to prevent matching across newlines
  const reviewerMatch = body.match(/Reviewer[ \t]*-[ \t]*(.+)/i);
  const reviewer = reviewerMatch ? reviewerMatch[1].trim() : null;

  // Status line: "{DocType} Status - {status}" — use a flexible pattern
  const statusMatch = body.match(/Status[ \t]*-[ \t]*(.+)/i);
  let status: PeDocStatus | null = null;
  if (statusMatch) {
    const rawStatus = statusMatch[1].trim().toLowerCase();
    status = EMAIL_STATUS_MAP[rawStatus] ?? null;
  }

  if (!status) {
    console.warn(
      `[pe-email-sync] Could not parse status from body for "${subject}"`,
    );
    return null;
  }

  const partnerMatch = body.match(/Partner[ \t]*Comments[ \t]*-[ \t]*(.*)/i);
  const partnerComments = partnerMatch?.[1]?.trim() || null;

  const approverMatch = body.match(/Approver[ \t]*Comments[ \t]*-[ \t]*(.*)/i);
  const approverComments = approverMatch?.[1]?.trim() || null;

  return {
    customerName,
    docType: resolvedDocType,
    status,
    reviewer,
    partnerComments,
    approverComments,
    emailDate: new Date(date),
    messageId,
  };
}

// ---------------------------------------------------------------------------
// Sync orchestrator
// ---------------------------------------------------------------------------

export interface PeEmailSyncResult {
  emailsFetched: number;
  parsed: number;
  matched: number;
  unmatched: string[]; // customer names that couldn't match a deal
  upserted: number;
  errors: number;
  skipped: number; // emails older than existing reviewedAt
  newWatermark: string; // ISO date of newest processed email
  gmailError?: string; // set if Gmail API was unreachable
}

/**
 * Main orchestrator: fetches PE notification emails, parses them, matches
 * customer names to HubSpot deals, and upserts document statuses.
 */
export async function syncPeEmailStatuses(opts?: {
  sinceDate?: string; // override high-water mark (ISO date)
  dryRun?: boolean;
}): Promise<PeEmailSyncResult> {
  const result: PeEmailSyncResult = {
    emailsFetched: 0,
    parsed: 0,
    matched: 0,
    unmatched: [],
    upserted: 0,
    errors: 0,
    skipped: 0,
    newWatermark: "",
  };

  // 1. Read high-water mark
  let sinceDate: string;
  if (opts?.sinceDate) {
    sinceDate = opts.sinceDate;
  } else {
    const config = await prisma.systemConfig.findUnique({
      where: { key: WATERMARK_KEY },
    });
    if (config) {
      sinceDate = config.value;
    } else {
      // Default: 7 days ago
      const d = new Date();
      d.setDate(d.getDate() - DEFAULT_LOOKBACK_DAYS);
      sinceDate = d.toISOString();
    }
  }

  // 2. Convert to Gmail after: format (YYYY/MM/DD)
  const sinceObj = new Date(sinceDate);
  const gmailDate = `${sinceObj.getFullYear()}/${String(sinceObj.getMonth() + 1).padStart(2, "0")}/${String(sinceObj.getDate()).padStart(2, "0")}`;
  const query = `from:${PE_NOTIFICATION_SENDER} after:${gmailDate}`;

  // 3. Fetch emails
  const fetchResult = await fetchSharedInboxMessages({
    mailbox: PE_TPO_MAILBOX,
    query,
    maxMessages: 200,
  });

  if (!fetchResult.ok) {
    result.gmailError = fetchResult.error;
    console.error(`[pe-email-sync] Gmail fetch failed: ${fetchResult.error}`);
    return result;
  }

  result.emailsFetched = fetchResult.messages.length;
  if (fetchResult.messages.length === 0) {
    result.newWatermark = sinceDate;
    return result;
  }

  // 4. Parse each email
  const updates: PeEmailUpdate[] = [];
  for (const msg of fetchResult.messages) {
    const parsed = parsePeNotificationEmail(msg);
    if (parsed) {
      updates.push(parsed);
    }
  }
  result.parsed = updates.length;

  if (updates.length === 0) {
    result.newWatermark = sinceDate;
    return result;
  }

  // 5. Build deal map (single call, reused for all emails)
  const dealMap = await buildPeDealMap();

  // 6. Match customer names to deals and prepare upserts
  interface UpsertItem {
    dealId: string;
    docName: string;
    status: PeDocStatus;
    notes: string | null;
    reviewedAt: Date;
    reviewedBy: string;
  }

  const upsertQueue: UpsertItem[] = [];
  const unmatchedSet = new Set<string>();

  for (const update of updates) {
    // Build a synthetic ParsedProject for matchProjectToDeal
    const syntheticProject: ParsedProject = {
      customerName: update.customerName,
      projNumber: "",
      stage: "",
      m1Status: null,
      m2Status: null,
      epcCost: null,
      documents: [],
    };

    const dealId = matchProjectToDeal(syntheticProject, dealMap);
    if (!dealId) {
      unmatchedSet.add(update.customerName);
      continue;
    }

    result.matched++;

    // Build notes from comments
    const noteParts: string[] = [];
    if (update.partnerComments) {
      noteParts.push(`Partner: ${update.partnerComments}`);
    }
    if (update.approverComments) {
      noteParts.push(`Approver: ${update.approverComments}`);
    }
    const notes = noteParts.length > 0 ? noteParts.join(" | ") : null;

    upsertQueue.push({
      dealId,
      docName: update.docType,
      status: update.status,
      notes,
      reviewedAt: update.emailDate,
      reviewedBy: `pe-email-sync:${update.messageId}`,
    });
  }

  result.unmatched = [...unmatchedSet];

  if (opts?.dryRun) {
    result.upserted = upsertQueue.length;
    result.newWatermark = updates[updates.length - 1].emailDate.toISOString();
    return result;
  }

  // 7-8. Temporal dedup + batch upsert (groups of 50)
  const BATCH_SIZE = 50;
  for (let i = 0; i < upsertQueue.length; i += BATCH_SIZE) {
    const batch = upsertQueue.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        // Temporal dedup: check existing row's reviewedAt
        const existing = await prisma.peDocumentReview.findUnique({
          where: {
            dealId_docName: {
              dealId: item.dealId,
              docName: item.docName,
            },
          },
          select: { reviewedAt: true },
        });

        if (existing && existing.reviewedAt >= item.reviewedAt) {
          result.skipped++;
          return "skipped";
        }

        // Upsert
        await prisma.peDocumentReview.upsert({
          where: {
            dealId_docName: {
              dealId: item.dealId,
              docName: item.docName,
            },
          },
          update: {
            status: item.status,
            notes: item.notes,
            reviewedAt: item.reviewedAt,
            reviewedBy: item.reviewedBy,
          },
          create: {
            dealId: item.dealId,
            docName: item.docName,
            status: item.status,
            notes: item.notes,
            reviewedAt: item.reviewedAt,
            reviewedBy: item.reviewedBy,
          },
        });
        result.upserted++;
        return "upserted";
      }),
    );

    // Count errors
    for (const r of results) {
      if (r.status === "rejected") {
        result.errors++;
        console.error(`[pe-email-sync] upsert error:`, r.reason);
      }
    }
  }

  // 9. Update watermark (only if we processed something)
  const newestDate = updates[updates.length - 1].emailDate.toISOString();
  result.newWatermark = newestDate;

  if (result.upserted > 0 || result.skipped > 0) {
    await prisma.systemConfig.upsert({
      where: { key: WATERMARK_KEY },
      update: { value: newestDate },
      create: { key: WATERMARK_KEY, value: newestDate },
    });
  }

  return result;
}
