/**
 * PE Document Status <-> HubSpot Deal Property sync.
 *
 * Maps between PeDocumentReview canonical doc names and HubSpot
 * deal properties. Used by:
 *   - syncPeDocStatusesToHubSpot() — DB -> HubSpot push after scraper sync
 *   - Webhook handler — HubSpot -> DB for manual edits
 *   - scripts/create-pe-doc-properties.ts — property creation
 */

import { PeDocStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Mapping types
// ---------------------------------------------------------------------------

export interface PeDocPropertyMapping {
  docName: string;
  statusProp: string;
  notesProp: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Canonical mapping: docName <-> HubSpot property name <-> label
// ---------------------------------------------------------------------------

export const PE_DOC_HUBSPOT_MAP: PeDocPropertyMapping[] = [
  { docName: "Customer Agreement (PPA/ESA)", statusProp: "pe_doc_customer_agreement", notesProp: "pe_doc_customer_agreement_notes", label: "PE: Customer Agreement (PPA/ESA)" },
  { docName: "Installation Order", statusProp: "pe_doc_installation_order", notesProp: "pe_doc_installation_order_notes", label: "PE: Installation Order" },
  { docName: "State Disclosures", statusProp: "pe_doc_state_disclosures", notesProp: "pe_doc_state_disclosures_notes", label: "PE: State Disclosures" },
  { docName: "Utility Bill", statusProp: "pe_doc_utility_bill", notesProp: "pe_doc_utility_bill_notes", label: "PE: Utility Bill" },
  { docName: "Signed Proposal", statusProp: "pe_doc_signed_proposal", notesProp: "pe_doc_signed_proposal_notes", label: "PE: Signed Proposal" },
  { docName: "Design Plan", statusProp: "pe_doc_design_plan", notesProp: "pe_doc_design_plan_notes", label: "PE: Design Plan" },
  { docName: "Photos per Policy", statusProp: "pe_doc_photos_per_policy", notesProp: "pe_doc_photos_per_policy_notes", label: "PE: Photos per Policy" },
  { docName: "Bill of Materials", statusProp: "pe_doc_bill_of_materials", notesProp: "pe_doc_bill_of_materials_notes", label: "PE: Bill of Materials" },
  { docName: "Signed Final Permit", statusProp: "pe_doc_signed_final_permit", notesProp: "pe_doc_signed_final_permit_notes", label: "PE: Signed Final Permit" },
  { docName: "Access to Monitoring", statusProp: "pe_doc_access_to_monitoring", notesProp: "pe_doc_access_to_monitoring_notes", label: "PE: Access to Monitoring" },
  { docName: "Certificate of Acceptance", statusProp: "pe_doc_certificate_of_acceptance", notesProp: "pe_doc_certificate_of_acceptance_notes", label: "PE: Certificate of Acceptance" },
  { docName: "Attestation of Customer Payment", statusProp: "pe_doc_attestation_customer_payment", notesProp: "pe_doc_attestation_customer_payment_notes", label: "PE: Attestation of Customer Payment" },
  { docName: "Conditional Progress Lien Waiver", statusProp: "pe_doc_conditional_lien_waiver", notesProp: "pe_doc_conditional_lien_waiver_notes", label: "PE: Conditional Progress Lien Waiver" },
  { docName: "Signed Interconnection Agreement", statusProp: "pe_doc_signed_interconnection", notesProp: "pe_doc_signed_interconnection_notes", label: "PE: Signed Interconnection Agreement" },
  { docName: "Conditional Waiver — Final Payment", statusProp: "pe_doc_conditional_waiver_final", notesProp: "pe_doc_conditional_waiver_final_notes", label: "PE: Conditional Waiver — Final Payment" },
  { docName: "Permission to Operate (PTO)", statusProp: "pe_doc_permission_to_operate", notesProp: "pe_doc_permission_to_operate_notes", label: "PE: Permission to Operate (PTO)" },
];

// ---------------------------------------------------------------------------
// Lookup helpers (built from PE_DOC_HUBSPOT_MAP)
// ---------------------------------------------------------------------------

const _docNameToEntry = new Map<string, PeDocPropertyMapping>();
const _statusPropToEntry = new Map<string, PeDocPropertyMapping>();

for (const entry of PE_DOC_HUBSPOT_MAP) {
  _docNameToEntry.set(entry.docName, entry);
  _statusPropToEntry.set(entry.statusProp, entry);
}

export function docNameToStatusProp(docName: string): string | undefined {
  return _docNameToEntry.get(docName)?.statusProp;
}

export function statusPropToDocName(prop: string): string | undefined {
  const cleaned = prop.endsWith("_notes") ? prop.replace(/_notes$/, "") : prop;
  return _statusPropToEntry.get(cleaned)?.docName;
}

// ---------------------------------------------------------------------------
// Status value mapping: PeDocStatus <-> HubSpot enum value
// ---------------------------------------------------------------------------

// Note: UPLOADED is deprecated (merged into UNDER_REVIEW / "In Review") and no
// longer written by any sync, so the "uploaded" HubSpot value is naturally no
// longer produced. The 1:1 mapping is kept intact for the rare legacy row.
export const PE_STATUS_TO_HUBSPOT: Record<PeDocStatus, string> = {
  [PeDocStatus.NOT_UPLOADED]: "not_uploaded",
  [PeDocStatus.UPLOADED]: "uploaded",
  [PeDocStatus.UNDER_REVIEW]: "under_review",
  [PeDocStatus.ACTION_REQUIRED]: "action_required",
  [PeDocStatus.REJECTED]: "rejected",
  [PeDocStatus.APPROVED]: "approved",
  [PeDocStatus.NOT_REQUIRED]: "not_required",
};

export const HUBSPOT_TO_PE_STATUS: Record<string, PeDocStatus> = {
  not_uploaded: PeDocStatus.NOT_UPLOADED,
  uploaded: PeDocStatus.UPLOADED,
  under_review: PeDocStatus.UNDER_REVIEW,
  action_required: PeDocStatus.ACTION_REQUIRED,
  rejected: PeDocStatus.REJECTED,
  approved: PeDocStatus.APPROVED,
  not_required: PeDocStatus.NOT_REQUIRED,
};

// ---------------------------------------------------------------------------
// Notes extraction
// ---------------------------------------------------------------------------

/**
 * PeActionItem.docLabel mostly matches the canonical PeDocumentReview docName,
 * but a few raw PE labels differ. Normalize those so action-item comments join
 * to the right document property.
 */
const ACTION_ITEM_DOCLABEL_ALIASES: Record<string, string> = {
  "Conditional Waiver/Release on Final Payment": "Conditional Waiver — Final Payment",
};

export function normalizeActionItemDocName(docLabel: string): string {
  return ACTION_ITEM_DOCLABEL_ALIASES[docLabel] ?? docLabel;
}

/**
 * Group open PE action items into the real reviewer-comment text per document,
 * keyed `${dealId}::${canonicalDocName}`. Multiple items for one doc are merged,
 * each note split into lines, trimmed, and de-duplicated. This is the genuine
 * rejection comment (page/error-code text) — distinct from PeDocumentReview.notes
 * which only holds sync metadata.
 */
export function actionItemNotesByDoc(
  items: { dealId: string; docLabel: string; notes: string | null }[],
): Map<string, string> {
  // Group each doc's OWN action-item notes, keeping each item's block intact.
  const byKey = new Map<string, string[]>();
  for (const it of items) {
    const note = (it.notes ?? "").trim();
    if (!note) continue;
    const key = `${it.dealId}::${normalizeActionItemDocName(it.docLabel)}`;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(note);
  }
  const out = new Map<string, string>();
  for (const [k, notes] of byKey) {
    // Sort whole note blocks deterministically BEFORE flattening to lines. The
    // caller's DB query order isn't guaranteed, so without this the composed
    // value reorders between syncs (same content, different order). That churn
    // re-triggers the "Rejected by PE" notifier workflow (re-enrolls on
    // pe_doc_*_notes → IS_KNOWN) and re-sends the email every sync. Sorting by
    // the note text keeps each item's lines contiguous and the output stable.
    notes.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const lines = notes.flatMap((n) => n.split("\n").map((l) => l.trim()).filter(Boolean));
    out.set(k, [...new Set(lines)].join("\n"));
  }
  return out;
}

export function extractHubSpotNotes(rawNotes: string): string {
  if (!rawNotes) return "";

  if (!rawNotes.includes(" | ")) return rawNotes;

  const segments = rawNotes.split(" | ");
  const relevant: string[] = [];

  for (const seg of segments) {
    if (seg.startsWith("Approver: ")) {
      relevant.push(seg.replace("Approver: ", "").trim());
    } else if (seg.startsWith("Partner: ")) {
      relevant.push(seg.replace("Partner: ", "").trim());
    }
  }

  return relevant.join("\n");
}

// ---------------------------------------------------------------------------
// DB -> HubSpot push
// ---------------------------------------------------------------------------

export async function syncPeDocStatusesToHubSpot(dealIds: string[]): Promise<void> {
  if (dealIds.length === 0) return;

  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    console.warn("[pe-hubspot-sync] HUBSPOT_ACCESS_TOKEN not set, skipping HubSpot push");
    return;
  }

  const uniqueDealIds = [...new Set(dealIds)];

  const rows = await prisma.peDocumentReview.findMany({
    where: { dealId: { in: uniqueDealIds } },
    select: { dealId: true, docName: true, status: true, notes: true },
  });

  // The genuine reviewer comment lives in PeActionItem (page/error-code text),
  // not PeDocumentReview.notes (sync metadata). Pull open action items so we can
  // write the real comment into each pe_doc_*_notes property.
  const openActionItems = await prisma.peActionItem.findMany({
    where: { dealId: { in: uniqueDealIds }, resolvedAt: null },
    select: { dealId: true, docLabel: true, notes: true },
  });
  const commentByDoc = actionItemNotesByDoc(
    openActionItems.filter((a): a is { dealId: string; docLabel: string; notes: string | null } =>
      a.dealId !== null,
    ),
  );

  const byDeal = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = byDeal.get(row.dealId) ?? [];
    existing.push(row);
    byDeal.set(row.dealId, existing);
  }

  const inputs: Array<{ id: string; properties: Record<string, string> }> = [];

  for (const [dealId, docs] of byDeal) {
    const properties: Record<string, string> = {};

    for (const doc of docs) {
      const entry = _docNameToEntry.get(doc.docName);
      if (!entry) continue;

      properties[entry.statusProp] = PE_STATUS_TO_HUBSPOT[doc.status as PeDocStatus] ?? "not_uploaded";
      // Prefer the real reviewer comment (PeActionItem); fall back to the legacy
      // Approver/Partner extraction for any scraper-era PeDocumentReview.notes.
      properties[entry.notesProp] =
        commentByDoc.get(`${dealId}::${doc.docName}`) ?? extractHubSpotNotes(doc.notes ?? "");
    }

    if (Object.keys(properties).length > 0) {
      inputs.push({ id: dealId, properties });
    }
  }

  if (inputs.length === 0) return;

  const BATCH_SIZE = 50;
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const batch = inputs.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetch(
        "https://api.hubapi.com/crm/v3/objects/deals/batch/update",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ inputs: batch }),
        },
      );

      if (!res.ok) {
        const errText = await res.text();
        console.warn(
          `[pe-hubspot-sync] Batch update failed (${res.status}): ${errText.slice(0, 300)}`,
        );
      }
    } catch (err) {
      console.warn(
        `[pe-hubspot-sync] Batch update error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// HubSpot -> DB (webhook helper with echo suppression)
// ---------------------------------------------------------------------------

export async function upsertPeDocFromHubSpot(
  dealId: string,
  propertyName: string,
  value: string,
): Promise<{ action: "upserted" | "skipped-echo" | "skipped-unknown" }> {
  const isNotes = propertyName.endsWith("_notes");
  const docName = statusPropToDocName(propertyName);

  if (!docName) {
    return { action: "skipped-unknown" };
  }

  if (isNotes) {
    await prisma.peDocumentReview.upsert({
      where: { dealId_docName: { dealId, docName } },
      create: {
        dealId,
        docName,
        status: PeDocStatus.NOT_UPLOADED,
        notes: value,
        reviewedBy: "hubspot-manual",
        reviewedAt: new Date(),
      },
      update: {
        notes: value,
        reviewedBy: "hubspot-manual",
        reviewedAt: new Date(),
      },
    });
    return { action: "upserted" };
  }

  const peStatus = HUBSPOT_TO_PE_STATUS[value];
  if (!peStatus) {
    return { action: "skipped-unknown" };
  }

  const existing = await prisma.peDocumentReview.findUnique({
    where: { dealId_docName: { dealId, docName } },
    select: { status: true, reviewedBy: true },
  });

  if (
    existing &&
    existing.status === peStatus &&
    existing.reviewedBy !== "hubspot-manual"
  ) {
    return { action: "skipped-echo" };
  }

  await prisma.peDocumentReview.upsert({
    where: { dealId_docName: { dealId, docName } },
    create: {
      dealId,
      docName,
      status: peStatus,
      reviewedBy: "hubspot-manual",
      reviewedAt: new Date(),
    },
    update: {
      status: peStatus,
      reviewedBy: "hubspot-manual",
      reviewedAt: new Date(),
    },
  });

  return { action: "upserted" };
}
