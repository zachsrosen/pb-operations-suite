/**
 * Compose per-team PE rejection notes from a project's live PE action items.
 *
 * When a deal's M1 is rejected, the pe-m1-rejected webhook pulls the project's
 * action items live from the PE API (getProjectDetail), and this module routes
 * each rejected document's reviewer note into the team that owns it, producing
 * "Design Plan - <reason>" lines per `pe_rejection_notes_for_*` field.
 *
 * Note: "Load Justification Form" is a PB-internal M1 document — PE has no action
 * item for it — so it is intentionally NOT covered by the live PE pull.
 */
import { PE_ACTION_DOC_MAP, type PeActionItem } from "@/lib/pe-api";

/**
 * Canonical PE document name → team rejection-notes field. Keyed on the names
 * PE_ACTION_DOC_MAP normalizes action-item document ids to. M2 documents
 * (Signed Interconnection, Conditional Waiver — Final Payment, PTO) are absent
 * on purpose: this is the M1 routing map.
 */
export const PE_DOC_TO_TEAM_FIELD: Record<string, string> = {
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
 * Group PE action items into per-team rejection notes.
 *
 * Each action item is a per-document rejection carrying the reviewer's note.
 * Returns only the fields that have at least one M1-team action item, as
 * "{Document Label} - {note}" lines (a bare "{Label} - " when PE left no note),
 * so unrelated team fields are never touched. Action items for documents not in
 * the M1 routing map (e.g. M2 docs) are skipped.
 */
export function composeRejectionNotes(
  actionItems: PeActionItem[],
): Record<string, string> {
  const byField: Record<string, string[]> = {};

  for (const item of actionItems) {
    const docId = item.document?.id ?? "";
    const canonical = PE_ACTION_DOC_MAP[docId] ?? item.document?.label ?? "";
    const field = PE_DOC_TO_TEAM_FIELD[canonical];
    if (!field) continue; // unknown / non-M1-team document — skip

    const label = item.document?.label || canonical;
    const note = (item.notes ?? "").trim();
    (byField[field] ??= []).push(note ? `${label} - ${note}` : `${label} - `);

    // PE has no standalone "Load Justification Form" document — it bundles that
    // feedback into the Proposal rejection note. When the Proposal note mentions
    // it, also surface it to Design (LJF is a Design concern).
    if (canonical === "Signed Proposal" && /load\s*justification|\bLJF\b/i.test(note)) {
      (byField[DESIGN_FIELD] ??= []).push(`Load Justification Form - ${note}`);
    }
  }

  const out: Record<string, string> = {};
  for (const [field, lines] of Object.entries(byField)) {
    out[field] = lines.join("\n");
  }
  return out;
}
