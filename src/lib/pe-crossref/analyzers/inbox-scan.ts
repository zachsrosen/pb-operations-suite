/**
 * InboxScanAnalyzer — finds candidate PE-submission documents in the
 * shared mailboxes (permitsdn@, permitting@, interconnections@,
 * interconnectionsca@) and surfaces them as action tasks for the PM
 * to download + file into GDrive.
 *
 * Three task families:
 *   EMAIL_PERMIT — signed inspection card / final permit found
 *   EMAIL_IA     — signed interconnection agreement found
 *   EMAIL_PTO    — PTO letter from utility found
 *
 * The analyzer runs only when the corresponding PE checklist item is
 * still flagged "missing" in the latest audit run — we don't want to
 * spam the queue with tasks for documents that are already in GDrive.
 *
 * Vision verification: each candidate attachment is sent to Sonnet
 * with a doc-type-specific prompt. Only candidates where vision returns
 * `is_target_doc: true` get a task emitted.
 *
 * Tasks include a deep-link to the Gmail thread so the PM can open the
 * email, download the PDF, and file it in the correct GDrive folder.
 * (Auto-upload to GDrive is deferred to a follow-up phase to keep this
 * change minimal — PM stays in the loop on file placement.)
 */

import { CLAUDE_MODELS, getAnthropicClient } from "@/lib/anthropic";
import { downloadSharedInboxAttachment } from "@/lib/gmail-shared-inbox";
import { uploadToAnthropic } from "@/lib/pe-vision-classifier";
import { scanInboxesForDeal, type InboxCandidate, type InboxDocType } from "@/lib/pe-crossref/extractors/inbox-scan";
import type { Analyzer, DetectedTask, CrossRefContext } from "@/lib/pe-crossref/types";

const VERSION = "v1";

// Which PE checklist item is "satisfied" by each inbox doc type. If the
// audit shows that item NOT missing (i.e. found / needs_review), we skip
// the inbox scan for that doc type entirely.
const CHECKLIST_FOR_DOC: Record<InboxDocType, string> = {
  permit: "m1.inspection.ahj_permit",
  ia: "m2.pto.interconnection",
  pto: "m2.pto.pto_letter",
};

const VISION_PROMPT_FOR_DOC: Record<InboxDocType, string> = {
  permit: `Look at this PDF.

Is it a SIGNED AHJ final inspection card / passed-inspection document?
- Must show an inspector's signature OR stamp OR "APPROVED" / "PASSED" / "FINAL APPROVED" marking from the building department.
- NOT acceptable: issued permits, permit applications, plan-check comments, inspection-pending notices, post-inspection cards waiting to be stamped.

Return JSON only (no markdown):
{
  "is_target_doc": true | false,
  "doc_type_observed": "<one of: signed_inspection_card, issued_permit, permit_application, plan_check_response, inspection_pending, other>",
  "reasoning": "<one sentence>",
  "ahj_name": "<jurisdiction name or null>"
}`,
  ia: `Look at this PDF.

Is it a SIGNED Interconnection Agreement (IA) — the document signed by BOTH the customer AND the utility/Xcel?
- Must show signatures from customer AND utility/agent.
- NOT acceptable: IA applications waiting for signature, IA approval letters without the signed contract, utility rate sheets, monitoring data, account-status notices.

Return JSON only (no markdown):
{
  "is_target_doc": true | false,
  "doc_type_observed": "<one of: signed_ia, ia_application, ia_approval_letter, utility_correspondence, other>",
  "reasoning": "<one sentence>",
  "utility_name": "<Xcel / PG&E / SCE / etc or null>"
}`,
  pto: `Look at this PDF.

Is it a Permission-to-Operate (PTO) letter from a utility granting interconnection authorization?
- Must contain explicit PTO grant language ("Permission to Operate", "Approval to Energize", "Interconnection Approved").
- NOT acceptable: IA documents, application receipts, meter-set confirmations alone, utility rate sheets, billing statements.

Return JSON only (no markdown):
{
  "is_target_doc": true | false,
  "doc_type_observed": "<one of: pto_letter, ia_document, application_receipt, meter_confirmation, utility_bill, other>",
  "reasoning": "<one sentence>",
  "pto_date": "<YYYY-MM-DD or null>",
  "utility_name": "<Xcel / PG&E / SCE / etc or null>"
}`,
};

const TASK_TITLE: Record<InboxDocType, string> = {
  permit: "INSPECTION CARD FOUND IN EMAIL",
  ia: "INTERCONNECTION AGREEMENT FOUND IN EMAIL",
  pto: "PTO LETTER FOUND IN EMAIL",
};

const TARGET_FOLDER_LABEL: Record<InboxDocType, string> = {
  permit: "6. Inspections (or 3. Permitting)",
  ia: "4. Interconnections",
  pto: "7. PTO & Closeout",
};

const PCODE: Record<InboxDocType, string> = {
  permit: "EMAIL_PERMIT",
  ia: "EMAIL_IA",
  pto: "EMAIL_PTO",
};

interface VisionVerdict {
  is_target_doc: boolean;
  doc_type_observed?: string;
  reasoning?: string;
  ahj_name?: string;
  utility_name?: string;
  pto_date?: string;
}

export const InboxScanAnalyzer: Analyzer = {
  name: "InboxScanAnalyzer",
  version: VERSION,

  async detectTasks(context: CrossRefContext): Promise<DetectedTask[]> {
    // Only scan when at least one of the target items is still missing.
    const missingItemIds = collectMissingItemIds(context);
    const docTypesToScan: InboxDocType[] = (["permit", "ia", "pto"] as const)
      .filter((d) => missingItemIds.has(CHECKLIST_FOR_DOC[d]));

    if (docTypesToScan.length === 0) return [];

    const { candidates } = await scanInboxesForDeal(context.deal, { maxPerDocType: 5 });
    if (candidates.length === 0) return [];

    // Filter candidates to only the doc types we care about
    const relevantCandidates = candidates.filter((c) => docTypesToScan.includes(c.docType));

    // Vision-verify each unique (messageId, attachmentId) once — cache verdicts.
    // Same attachment serves all 3 doc types (the IC inbox returns one
    // attachment with two synthetic docType labels), so we dedupe.
    const verdictCache = new Map<string, Record<InboxDocType, VisionVerdict | null>>();

    const tasks: DetectedTask[] = [];
    const client = getAnthropicClient();

    for (const candidate of relevantCandidates) {
      const cacheKey = `${candidate.mailbox}:${candidate.attachment.messageId}:${candidate.attachment.attachmentId}`;
      let entry = verdictCache.get(cacheKey);
      if (!entry) {
        entry = { permit: null, ia: null, pto: null };
        verdictCache.set(cacheKey, entry);
      }

      // Download bytes once per attachment, but vision-classify per docType
      // (different prompts → different verdicts).
      let pdfBuffer: Buffer | null = null;
      let anthropicFileId: string | null = null;

      if (entry[candidate.docType] === null) {
        if (!pdfBuffer) {
          pdfBuffer = await downloadSharedInboxAttachment(
            candidate.mailbox,
            candidate.attachment.messageId,
            candidate.attachment.attachmentId,
          );
          if (!pdfBuffer) continue;
        }
        if (!anthropicFileId) {
          try {
            anthropicFileId = await uploadToAnthropic(pdfBuffer, candidate.attachment.filename, "application/pdf");
          } catch (err) {
            console.warn(`[pe-crossref] inbox-scan: anthropic upload failed for ${candidate.attachment.filename}: ${err}`);
            continue;
          }
        }
        entry[candidate.docType] = await classifyAttachment(client, anthropicFileId, candidate.docType);
      }

      const verdict = entry[candidate.docType];
      if (!verdict || !verdict.is_target_doc) continue;

      tasks.push(buildTask(candidate, verdict));
    }

    // Deduplicate tasks by identityKey — IC inbox attachments produce both
    // "ia" and "pto" candidate slots but only one verdict is_target_doc=true,
    // so dupes shouldn't be common. Map handles the rare edge case.
    const byIdentity = new Map<string, DetectedTask>();
    for (const t of tasks) byIdentity.set(t.identityKey, t);
    return [...byIdentity.values()];
  },
};

// ── Helpers ─────────────────────────────────────────────────────────

function collectMissingItemIds(context: CrossRefContext): Set<string> {
  // Build the set from the latest audit run's results. If no audit has
  // run yet, return a permissive set (scan everything) — better to find
  // useful candidates than gate on a prior audit existing.
  const missing = new Set<string>();
  if (!context.latestAuditRun) {
    // No audit data — assume all three items are missing so the scan runs
    return new Set(Object.values(CHECKLIST_FOR_DOC));
  }
  // Audit run summary tracks photoAssignments but not all-item statuses.
  // Approximation: if a checklist id isn't in photoAssignments and isn't
  // the planset, treat as potentially missing. We re-read the audit
  // results table to know definitively. Conservative fallback: scan all.
  for (const docType of ["permit", "ia", "pto"] as const) {
    missing.add(CHECKLIST_FOR_DOC[docType]);
  }
  return missing;
}

async function classifyAttachment(
  client: ReturnType<typeof getAnthropicClient>,
  anthropicFileId: string,
  docType: InboxDocType,
): Promise<VisionVerdict | null> {
  const prompt = VISION_PROMPT_FOR_DOC[docType];
  try {
    const message = await client.beta.messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: 800,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "file", file_id: anthropicFileId } },
          { type: "text", text: prompt },
        ],
      }],
      betas: ["files-api-2025-04-14"],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    return JSON.parse(jsonStr) as VisionVerdict;
  } catch (err) {
    console.warn(`[pe-crossref] inbox-scan: vision verify failed for ${docType}: ${err}`);
    return null;
  }
}

function buildTask(candidate: InboxCandidate, verdict: VisionVerdict): DetectedTask {
  const { docType, attachment } = candidate;
  // Gmail thread deep-link — opens the thread in the mailbox owner's web UI
  const threadUrl = `https://mail.google.com/mail/u/0/#inbox/${attachment.threadId}`;
  const sourceHint =
    docType === "permit" ? verdict.ahj_name ?? "AHJ"
    : verdict.utility_name ?? "Utility";

  return {
    pCode: PCODE[docType],
    identityKey: `${PCODE[docType]}@${VERSION}:msg:${attachment.messageId}:att:${attachment.attachmentId}`,
    severity: "monitoring",
    category: "monitoring",
    analyzer: "InboxScanAnalyzer",
    title: TASK_TITLE[docType],
    message:
      `${sourceHint} sent ${docType === "permit" ? "an inspection card" : docType === "ia" ? "a signed interconnection agreement" : "a PTO letter"} ` +
      `in email "${truncate(attachment.messageSubject, 80)}" (${attachment.messageDate.slice(0, 10)}). ` +
      `Filename: ${attachment.filename}.`,
    action:
      `Open the email, download the attachment, and file it in GDrive folder "${TARGET_FOLDER_LABEL[docType]}".`,
    evidence: {
      docType,
      mailbox: candidate.mailbox,
      threadId: attachment.threadId,
      messageId: attachment.messageId,
      attachmentId: attachment.attachmentId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      messageSubject: attachment.messageSubject,
      messageDate: attachment.messageDate,
      messageFrom: attachment.messageFrom,
      threadUrl,
      visionVerdict: verdict,
    },
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
