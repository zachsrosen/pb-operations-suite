/**
 * Compose per-team INTERNAL rejection notes from a reviewer's HubSpot input.
 *
 * This is the PB-internal QC mirror of the PE (external) rejection-notes system
 * (`pe-rejection-notes.ts`). Where PE pulls reviewer notes live from the PE API,
 * the internal flow has the reviewer SUPPLY the reasons directly in HubSpot: they
 * set `pe_m1_status`/`pe_m2_status` = "Internally Rejected", tick the rejected
 * docs in the `internal_rejection_documents` checkbox, and type each doc's reason
 * into its `internal_reason_*` field.
 *
 * The internal-rejection webhook reads those fields and calls
 * `composeInternalRejectionNotes` to route each checked doc's reason to the team
 * that owns it, producing the 7 `internal_rejection_notes_for_*` fields plus the
 * combined `internal_rejection_comments`. Formatting (grouped "{Doc}:" headers +
 * "• " bullets, multi-line split, dedupe) is shared with the PE formatter via
 * `splitIssues`/`formatDocBlock`.
 *
 * Key differences from PE:
 *  - The reviewer's checkboxes are authoritative — there is no live pull.
 *  - Rejected docs are picked in two milestone checkboxes that mirror PE:
 *    `internal_m1_documents` and `internal_m2_documents`.
 *  - "Load Justification Form" is its OWN document (its own reason field), routed
 *    straight to Design. No proposal-note parsing, no synthetic block.
 *  - The combined field includes the LJF block normally (no PE-style de-dup of it).
 */
import { splitIssues, formatDocBlock } from "@/lib/pe-rejection-notes";

/** One internally-rejectable document: its checkbox value, reason input field, owning team field, and milestone. */
interface InternalRejectionDoc {
  /** The option value in the `internal_rejection_documents` checkbox (matches the pe_m{1,2}_documents labels). Also used as the block header. */
  checkbox: string;
  /** The textarea field the reviewer types this doc's reason into. */
  reasonField: string;
  /** The team notes field this doc routes to. */
  teamField: string;
  /** Which milestone the doc belongs to — used to scope checked docs to the milestone that was internally rejected. */
  milestone: "m1" | "m2";
}

const TEAM = {
  design: "internal_rejection_notes_for_design",
  sales: "internal_rejection_notes_for_sales",
  ops: "internal_rejection_notes_for_ops",
  permitting: "internal_rejection_notes_for_permitting",
  compliance: "internal_rejection_notes_for_compliance",
  accounting: "internal_rejection_notes_for_accounting",
  // CORRECT spelling — the PE field has a typo (`intercocnnection`); do not copy it.
  interconnection: "internal_rejection_notes_for_interconnection",
} as const;

/**
 * The 16 internally-rejectable documents, in the order their blocks render.
 * Grouped by team within each milestone. Checkbox values mirror the live
 * `pe_m1_documents` / `pe_m2_documents` option values exactly.
 */
export const INTERNAL_REJECTION_DOCS: readonly InternalRejectionDoc[] = [
  // --- M1 ---
  { checkbox: "Design Plan", reasonField: "internal_reason_design_plan", teamField: TEAM.design, milestone: "m1" },
  { checkbox: "Load Justification Form", reasonField: "internal_reason_load_justification_form", teamField: TEAM.design, milestone: "m1" },
  { checkbox: "Proposal", reasonField: "internal_reason_proposal", teamField: TEAM.sales, milestone: "m1" },
  { checkbox: "State Disclosures", reasonField: "internal_reason_state_disclosures", teamField: TEAM.sales, milestone: "m1" },
  { checkbox: "Customer Agreement", reasonField: "internal_reason_customer_agreement", teamField: TEAM.sales, milestone: "m1" },
  { checkbox: "Installation Order", reasonField: "internal_reason_installation_order", teamField: TEAM.sales, milestone: "m1" },
  { checkbox: "Utility Bill", reasonField: "internal_reason_utility_bill", teamField: TEAM.sales, milestone: "m1" },
  { checkbox: "Photos", reasonField: "internal_reason_photos", teamField: TEAM.ops, milestone: "m1" },
  { checkbox: "Access to Monitoring", reasonField: "internal_reason_access_to_monitoring", teamField: TEAM.ops, milestone: "m1" },
  { checkbox: "Signed Final Permit", reasonField: "internal_reason_signed_final_permit", teamField: TEAM.permitting, milestone: "m1" },
  { checkbox: "Attestation of Customer Payment", reasonField: "internal_reason_attestation_of_payment", teamField: TEAM.compliance, milestone: "m1" },
  { checkbox: "Certificate of Acceptance", reasonField: "internal_reason_certificate_of_acceptance", teamField: TEAM.compliance, milestone: "m1" },
  { checkbox: "Conditional Progress Lien Waiver", reasonField: "internal_reason_progress_lien_waiver", teamField: TEAM.accounting, milestone: "m1" },
  // --- M2 ---
  { checkbox: "Signed Interconnection Agreement", reasonField: "internal_reason_interconnection_agreement", teamField: TEAM.interconnection, milestone: "m2" },
  { checkbox: "Permission to Operate", reasonField: "internal_reason_pto", teamField: TEAM.interconnection, milestone: "m2" },
  { checkbox: "Conditional Waiver and Release", reasonField: "internal_reason_final_payment_waiver", teamField: TEAM.accounting, milestone: "m2" },
];

const DOC_BY_CHECKBOX: Record<string, InternalRejectionDoc> = Object.fromEntries(
  INTERNAL_REJECTION_DOCS.map((d) => [d.checkbox, d]),
);

/** Checkbox value → owning team field. */
export const INTERNAL_DOC_TO_TEAM_FIELD: Record<string, string> = Object.fromEntries(
  INTERNAL_REJECTION_DOCS.map((d) => [d.checkbox, d.teamField]),
);

/** Checkbox value → the reviewer's reason input field. */
export const INTERNAL_REASON_FIELD_BY_DOC: Record<string, string> = Object.fromEntries(
  INTERNAL_REJECTION_DOCS.map((d) => [d.checkbox, d.reasonField]),
);

/** The 16 `internal_reason_*` fields the webhook reads (deduped, stable order). */
export const INTERNAL_REASON_FIELDS: readonly string[] = [
  ...new Set(INTERNAL_REJECTION_DOCS.map((d) => d.reasonField)),
];

/** The 7 unique `internal_rejection_notes_for_*` team fields this module manages. */
export const INTERNAL_REJECTION_TEAM_FIELDS: readonly string[] = [
  ...new Set(INTERNAL_REJECTION_DOCS.map((d) => d.teamField)),
];

/** The combined master field. */
export const INTERNAL_REJECTION_COMMENTS_FIELD = "internal_rejection_comments";

/** The two milestone document-selector checkboxes (mirror pe_m{1,2}_documents). */
export const INTERNAL_M1_DOCUMENTS_FIELD = "internal_m1_documents";
export const INTERNAL_M2_DOCUMENTS_FIELD = "internal_m2_documents";

/** Checkbox option values (= block headers) for each milestone, in registry order. */
export function internalDocsForMilestone(milestone: "m1" | "m2"): string[] {
  return INTERNAL_REJECTION_DOCS.filter((d) => d.milestone === milestone).map((d) => d.checkbox);
}

/** Parse a semicolon-joined HubSpot checkbox value into trimmed, non-empty doc labels. */
export function parseCheckedDocs(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Restrict the checked docs to the milestone(s) currently "Internally Rejected".
 *
 * A rejected M1 should only route its M1 docs (and vice versa), even if the
 * reviewer left M2 docs ticked. Unknown checkbox values are dropped.
 */
export function scopeCheckedDocsToMilestones(
  checkedDocs: string[],
  rejected: { m1: boolean; m2: boolean },
): string[] {
  return checkedDocs.filter((label) => {
    const doc = DOC_BY_CHECKBOX[label];
    if (!doc) return false;
    return doc.milestone === "m1" ? rejected.m1 : rejected.m2;
  });
}

/**
 * Compose the internal rejection note fields from the reviewer's input.
 *
 * @param reasonsByDoc map of checkbox value → the reviewer's reason text for that doc
 * @param checkedDocs  the docs the reviewer ticked (already milestone-scoped by the caller)
 * @returns a map of all 7 `internal_rejection_notes_for_*` fields + `internal_rejection_comments`.
 *          Every field is always present: teams with no rejected doc get "" so a re-run
 *          clears stale notes (the task workflows branch on non-empty, so cleared = no task).
 *
 * Each doc renders as a "{Doc}:" header with one "• " bullet per reason line
 * (deduped). A checked doc with an empty reason renders a bare "{Doc}:" header.
 * Docs are grouped by team and ordered by `INTERNAL_REJECTION_DOCS`.
 */
export function composeInternalRejectionNotes(
  reasonsByDoc: Record<string, string | null | undefined>,
  checkedDocs: string[],
): Record<string, string> {
  // Start every managed field empty so unaffected teams are cleared on each run.
  const out: Record<string, string> = {};
  for (const field of INTERNAL_REJECTION_TEAM_FIELDS) out[field] = "";
  out[INTERNAL_REJECTION_COMMENTS_FIELD] = "";

  // Walk the registry in order so output is deterministic, keeping only docs the
  // reviewer actually checked (deduped).
  const checked = new Set(checkedDocs);
  const byTeam: Record<string, string[]> = {};
  const combined: string[] = [];

  for (const doc of INTERNAL_REJECTION_DOCS) {
    if (!checked.has(doc.checkbox)) continue;
    const lines = splitIssues([reasonsByDoc[doc.checkbox] ?? ""]);
    const block = formatDocBlock(doc.checkbox, lines, null); // null → bare header when no reason
    (byTeam[doc.teamField] ??= []).push(block);
    combined.push(block);
  }

  for (const [field, blocks] of Object.entries(byTeam)) {
    out[field] = blocks.join("\n\n");
  }
  out[INTERNAL_REJECTION_COMMENTS_FIELD] = combined.join("\n\n");
  return out;
}
