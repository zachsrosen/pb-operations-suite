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
 * A reviewer line that references the Load Justification Form. PE has no
 * standalone LJF document — it bundles the request into the Proposal note — so
 * we detect it textually to mirror it to Design and to tick the LJF checkbox.
 */
const LJF_RE = /load\s*justification|\bLJF\b/i;

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

/**
 * Canonical PE document name → the option value to tick in the `pe_m1_documents`
 * checkbox property when that M1 doc is currently rejected. (Checkbox labels
 * differ from PE's doc names, e.g. "Signed Proposal" → "Proposal".)
 *
 * "Signed Proposal" is handled specially in `composeRejectedDocuments`: its note
 * is split line-by-line so an LJF-only rejection ticks just "Load Justification
 * Form", while proposal-document issues tick "Proposal" (both when mixed).
 */
const M1_DOC_CHECKBOX: Record<string, string> = {
  "Design Plan": "Design Plan",
  "Signed Proposal": "Proposal",
  "State Disclosures": "State Disclosures",
  "Customer Agreement (PPA/ESA)": "Customer Agreement",
  "Installation Order": "Installation Order",
  "Utility Bill": "Utility Bill",
  "Photos per Policy": "Photos",
  "Access to Monitoring": "Access to Monitoring",
  "Signed Final Permit": "Signed Final Permit",
  "Attestation of Customer Payment": "Attestation of Customer Payment",
  "Certificate of Acceptance": "Certificate of Acceptance",
  "Conditional Progress Lien Waiver": "Conditional Progress Lien Waiver",
};

/** The LJF checkbox option, ticked when a Proposal rejection references it. */
const LJF_CHECKBOX = "Load Justification Form";

/**
 * Canonical PE document name → the option value to tick in the `pe_m2_documents`
 * checkbox property when that M2 doc is currently rejected. (Checkbox values
 * differ from labels, e.g. PTO → "Permission to Operate".)
 */
const M2_DOC_CHECKBOX: Record<string, string> = {
  "Signed Interconnection Agreement": "Signed Interconnection Agreement",
  "Permission to Operate (PTO)": "Permission to Operate",
  "Conditional Waiver — Final Payment": "Conditional Waiver and Release",
};

/**
 * Group reviewer notes by canonical document name. Action items are the only
 * source of reason text; PE returns each one more than once, so callers dedupe.
 */
function buildNotesByDoc(actionItems: PeActionItem[]): Record<string, string[]> {
  const notesByDoc: Record<string, string[]> = {};
  for (const item of actionItems) {
    const canonical =
      PE_ACTION_DOC_MAP[item.document?.id ?? ""] ?? item.document?.label ?? "";
    if (!canonical) continue;
    const note = (item.notes ?? "").trim();
    if (note) (notesByDoc[canonical] ??= []).push(note);
  }
  return notesByDoc;
}

/**
 * Flatten a document's reviewer notes into individual, deduped issue lines. PE
 * packs every page-level issue for a doc into one newline-separated blob (and
 * returns each action item more than once), so we split on newlines and dedupe.
 */
function splitIssues(notes: string[]): string[] {
  const lines = notes
    .flatMap((n) => n.split("\n"))
    .map((l) => l.trim())
    .filter(Boolean);
  return [...new Set(lines)];
}

/**
 * Render one document's block: a "{Doc}:" header followed by a bullet per issue
 * line, e.g.
 *   Design Plan:
 *   • Page 8 — [H024] ...
 */
function formatDocBlock(doc: string, issueLines: string[]): string {
  const bullets = issueLines.length ? issueLines : ["(no reviewer note provided)"];
  return [`${doc}:`, ...bullets.map((l) => `• ${l}`)].join("\n");
}

/**
 * Decide which checkbox options a rejected Proposal should tick. PE bundles the
 * Load Justification Form request into the Proposal note, so we split the note
 * into per-issue lines: LJF lines tick "Load Justification Form", any other line
 * ticks "Proposal", and both tick when the rejection is mixed. A Proposal with
 * no notes defaults to "Proposal" (it's a proposal-document rejection).
 */
function proposalCheckboxes(notes: string[]): string[] {
  const lines = splitIssues(notes);
  const hasLjf = lines.some((l) => LJF_RE.test(l));
  const hasProposalIssue = lines.length === 0 || lines.some((l) => !LJF_RE.test(l));
  const out: string[] = [];
  if (hasProposalIssue) out.push("Proposal");
  if (hasLjf) out.push(LJF_CHECKBOX);
  return out;
}

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
 * approved docs with a lingering action item are excluded) and routes each to the
 * owning team. Output is grouped by document — a "{Doc}:" header with one bullet
 * per page-level issue — and documents within a field are separated by a blank
 * line. Returns only fields that have at least one currently-rejected doc.
 *
 * The Proposal is sales-owned, so its full note stays on Sales. Only the
 * LJF-specific lines are mirrored to Design (proposal-document comments do NOT
 * leak to Design).
 */
export function composeRejectionNotes(
  documents: PeDocuments,
  actionItems: PeActionItem[],
): Record<string, string> {
  // Reviewer notes grouped by canonical document name (action items are the
  // only source of the reason text).
  const notesByDoc = buildNotesByDoc(actionItems);

  // field -> ordered { doc, lines } blocks (one block per rejected document).
  const byField: Record<string, { doc: string; lines: string[] }[]> = {};
  for (const [docKey, info] of Object.entries(documents)) {
    if (!info || info.status !== REJECTED_DOC_STATUS) continue; // not currently rejected
    const canonical = PE_API_DOC_MAP[docKey];
    if (!canonical) continue;
    const field = PE_DOC_TO_TEAM_FIELD[canonical];
    if (!field) continue; // doc not routed to a team

    const lines = splitIssues(notesByDoc[canonical] ?? []);
    (byField[field] ??= []).push({ doc: canonical, lines });

    // PE has no standalone "Load Justification Form" document — it bundles that
    // feedback into the Proposal note. Mirror ONLY the LJF-specific lines to
    // Design; the proposal-document comments stay with Sales.
    if (canonical === "Signed Proposal") {
      const ljfLines = lines.filter((l) => LJF_RE.test(l));
      if (ljfLines.length) {
        (byField[DESIGN_FIELD] ??= []).push({ doc: "Load Justification Form", lines: ljfLines });
      }
    }
  }

  const out: Record<string, string> = {};
  for (const [field, blocks] of Object.entries(byField)) {
    out[field] = blocks.map((b) => formatDocBlock(b.doc, b.lines)).join("\n\n");
  }
  return out;
}

/**
 * Build the `pe_m{1,2}_documents` checkbox selections from the project's current
 * documents — i.e. tick the box for every doc whose status is RESPONSE_NEEDED.
 *
 * Returns semicolon-joined HubSpot checkbox values, split by milestone so the
 * caller can write each only when that milestone is the one that was rejected.
 * The Proposal is split into "Proposal" / "Load Justification Form" per
 * `proposalCheckboxes`. Returns only the keys that have at least one rejected doc.
 */
export function composeRejectedDocuments(
  documents: PeDocuments,
  actionItems: PeActionItem[],
): { pe_m1_documents?: string; pe_m2_documents?: string } {
  const notesByDoc = buildNotesByDoc(actionItems);
  const m1: string[] = [];
  const m2: string[] = [];

  for (const [docKey, info] of Object.entries(documents)) {
    if (!info || info.status !== REJECTED_DOC_STATUS) continue; // not currently rejected
    const canonical = PE_API_DOC_MAP[docKey];
    if (!canonical) continue;

    if (canonical === "Signed Proposal") {
      m1.push(...proposalCheckboxes(notesByDoc[canonical] ?? []));
    } else if (M1_DOC_CHECKBOX[canonical]) {
      m1.push(M1_DOC_CHECKBOX[canonical]);
    } else if (M2_DOC_CHECKBOX[canonical]) {
      m2.push(M2_DOC_CHECKBOX[canonical]);
    }
  }

  const out: { pe_m1_documents?: string; pe_m2_documents?: string } = {};
  if (m1.length) out.pe_m1_documents = [...new Set(m1)].join(";");
  if (m2.length) out.pe_m2_documents = [...new Set(m2)].join(";");
  return out;
}
