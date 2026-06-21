/**
 * Compose per-team PE rejection notes from a project's live PE data.
 *
 * When a deal's M1/M2 is rejected, the pe-rejection webhook pulls the project
 * detail live from the PE API (getProjectDetail) and this module routes each
 * CURRENTLY-rejected document's reviewer note to the team that owns it,
 * producing "Design Plan - <reason>" lines per `pe_rejection_notes_for_*` field.
 *
 * Authoritative signal is the document's current status (RESPONSE_NEEDED), not
 * the presence of an action item — action items have no resolved flag and an
 * approved doc can still carry a stale one. Action items supply only the reason.
 *
 * Note: "Load Justification Form" is a PB-internal document — PE has no doc/action
 * item for it — but PE bundles its feedback into the Proposal note, which we
 * mirror to Design.
 */
import {
  PE_ACTION_DOC_MAP,
  PE_API_DOC_MAP,
  type PeActionItem,
  type PeDocuments,
} from "@/lib/pe-api";

/** Document status that means "currently rejected / needs a response". */
const REJECTED_DOC_STATUS = "RESPONSE_NEEDED";

/**
 * Canonical PE document name → team rejection-notes field. Keyed on the names
 * PE_ACTION_DOC_MAP normalizes action-item document ids to. Covers both M1 and
 * M2 documents — action items don't carry a milestone, but each document belongs
 * to exactly one team, so one combined map routes whichever milestone rejected.
 */
export const PE_DOC_TO_TEAM_FIELD: Record<string, string> = {
  // --- M1 ---
  "Design Plan": "pe_rejection_notes_for_design",
  "Signed Proposal": "pe_rejection_notes_for_sales",
  "State Disclosures": "pe_rejection_notes_for_sales",
  "Customer Agreement (PPA/ESA)": "pe_rejection_notes_for_sales",
  "Installation Order": "pe_rejection_notes_for_sales",
  "Utility Bill": "pe_rejection_notes_for_sales",
  "Photos per Policy": "pe_rejection_notes_for_ops",
  "Access to Monitoring": "pe_rejection_notes_for_ops",
  "Signed Final Permit": "pe_rejection_notes_for_permitting",
  "Attestation of Customer Payment": "pe_rejection_notes_for_compliance",
  "Certificate of Acceptance": "pe_rejection_notes_for_compliance",
  "Conditional Progress Lien Waiver": "pe_rejection_notes_for_accounting",
  // --- M2 ---
  "Signed Interconnection Agreement": "pe_rejection_notes_for_intercocnnection",
  "Permission to Operate (PTO)": "pe_rejection_notes_for_intercocnnection",
  "Conditional Waiver — Final Payment": "pe_rejection_notes_for_accounting",
};

/** All team fields this module manages. */
export const PE_REJECTION_TEAM_FIELDS = [
  ...new Set(Object.values(PE_DOC_TO_TEAM_FIELD)),
];

const DESIGN_FIELD = "pe_rejection_notes_for_design";

/** Extract the PE internal (Raceway) id from a deal's pe_portal_url. */
export function peInternalIdFromPortalUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  const id = url.trim().replace(/\/+$/, "").split("/").pop();
  return id || null;
}

/**
 * Build per-team rejection notes from a project's current documents + action items.
 *
 * Includes only documents whose CURRENT status is RESPONSE_NEEDED (so resolved /
 * approved docs with a lingering action item are excluded), routes each to the
 * owning team, and uses the document's action item(s) for the reason — emitting
 * "{Document} - {reason}" lines (a bare "{Document} - " when there's no note).
 * Returns only fields that have at least one currently-rejected doc.
 */
export function composeRejectionNotes(
  documents: PeDocuments,
  actionItems: PeActionItem[],
): Record<string, string> {
  // Reviewer notes grouped by canonical document name (action items are the
  // only source of the reason text).
  const notesByDoc: Record<string, string[]> = {};
  for (const item of actionItems) {
    const canonical = PE_ACTION_DOC_MAP[item.document?.id ?? ""] ?? item.document?.label ?? "";
    if (!canonical) continue;
    const note = (item.notes ?? "").trim();
    if (note) (notesByDoc[canonical] ??= []).push(note);
  }

  const byField: Record<string, string[]> = {};
  for (const [docKey, info] of Object.entries(documents)) {
    if (!info || info.status !== REJECTED_DOC_STATUS) continue; // not currently rejected
    const canonical = PE_API_DOC_MAP[docKey];
    if (!canonical) continue;
    const field = PE_DOC_TO_TEAM_FIELD[canonical];
    if (!field) continue; // doc not routed to a team

    const notes = notesByDoc[canonical] ?? [];
    if (notes.length) {
      for (const n of notes) (byField[field] ??= []).push(`${canonical} - ${n}`);
    } else {
      (byField[field] ??= []).push(`${canonical} - `); // rejected, but PE left no note
    }

    // PE has no standalone "Load Justification Form" document — it bundles that
    // feedback into the Proposal note. When the Proposal note mentions it, also
    // surface it to Design (LJF is a Design concern).
    if (canonical === "Signed Proposal") {
      for (const n of notes) {
        if (/load\s*justification|\bLJF\b/i.test(n)) {
          (byField[DESIGN_FIELD] ??= []).push(`Load Justification Form - ${n}`);
        }
      }
    }
  }

  const out: Record<string, string> = {};
  for (const [field, lines] of Object.entries(byField)) {
    // PE returns each action item more than once — dedupe identical lines.
    out[field] = [...new Set(lines)].join("\n");
  }
  return out;
}
