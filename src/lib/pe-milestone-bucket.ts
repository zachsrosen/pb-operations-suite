/**
 * PE milestone bucketing — shared, pure, client-safe logic for the Milestones
 * tab (`/dashboards/pe?tab=milestones`).
 *
 * An eligible milestone's subgroup is derived from its DOCUMENT state, not just
 * its `pe_m{1,2}_status`, so the board reflects what's actually outstanding:
 *
 *   all docs uploaded (no NOT_UPLOADED):
 *     - any PE-flagged doc (ACTION_REQUIRED/REJECTED) → "action"
 *     - else                                          → "review"
 *       (a milestone already Approved/Paid stays Approved/Paid)
 *   some doc still NOT_UPLOADED:
 *     - status Waiting on Information | Internally Rejected → "waiting"
 *     - else keep the status bucket (Ready to Submit stays "ready")
 *   no synced doc data at all → fall back to the status bucket (unchanged behavior)
 *
 * The caller applies the stage gate (a milestone is only "eligible" once the
 * deal reaches its activation stage) BEFORE calling `milestoneDocBucket`.
 */

export type MilestoneStatusBucket =
  | "waiting"
  | "ready"
  | "action"
  | "review"
  | "approved"
  | "paid"
  | "other";

/** Raw `pe_m1_status` / `pe_m2_status` value → status subgroup. */
export function statusBucket(status: string | null | undefined): MilestoneStatusBucket {
  switch ((status ?? "").trim()) {
    case "Waiting on Information":
    case "Waiting on Customer Payment":
    case "Waiting on Safe Harbor":
    case "Waiting on RBC":
      return "waiting";
    case "Ready to Submit":
    case "Ready for Onboarding":
      return "ready";
    case "Rejected":
    case "Ready to Resubmit":
    case "Onboarding Rejected":
    case "Onboarding Ready to Resubmit":
    case "Internally Rejected":
      return "action";
    case "Submitted":
    case "Resubmitted":
    case "Onboarding Submitted":
    case "Onboarding Resubmitted":
      return "review";
    case "Approved":
      return "approved";
    case "Paid":
      return "paid";
    default:
      return "other";
  }
}

type Section = "onboarding" | "ic" | "pc";

/**
 * Canonical PE documents by section. A focused copy of DocsTab's `PE_DOCUMENTS`
 * (only name + section is needed here). The IC payment (M1) owes the onboarding
 * + ic docs; the PC payment (M2) owes the pc docs.
 */
const PE_MILESTONE_DOCS: { name: string; section: Section }[] = [
  { name: "Customer Agreement (PPA/ESA)", section: "onboarding" },
  { name: "Installation Order", section: "onboarding" },
  { name: "State Disclosures", section: "onboarding" },
  { name: "Utility Bill", section: "onboarding" },
  { name: "Signed Proposal", section: "ic" },
  { name: "Design Plan", section: "ic" },
  { name: "Photos per Policy", section: "ic" },
  { name: "Bill of Materials", section: "ic" },
  { name: "Signed Final Permit", section: "ic" },
  { name: "Access to Monitoring", section: "ic" },
  { name: "Certificate of Acceptance", section: "ic" },
  { name: "Attestation of Customer Payment", section: "ic" },
  { name: "Conditional Progress Lien Waiver", section: "ic" },
  { name: "Signed Interconnection Agreement", section: "pc" },
  { name: "Conditional Waiver — Final Payment", section: "pc" },
  { name: "Permission to Operate (PTO)", section: "pc" },
];

const M1_SECTIONS: Section[] = ["onboarding", "ic"];
const M2_SECTIONS: Section[] = ["pc"];
const PE_MILESTONE_DONE = new Set(["approved", "paid"]);
const WAITING_HOLD_RE = /waiting on information|internally rejected/i;

export type MilestoneKey = "IC" | "PC";

export interface MilestoneDocCounts {
  flagged: number; // ACTION_REQUIRED / REJECTED
  missing: number; // NOT_UPLOADED and not waived
  total: number; // owed docs with a synced status
}

/**
 * Count a milestone's owed documents from a `docName → status` map.
 *
 * - A conditional doc (e.g. Bill of Materials) is only owed when PE created its
 *   slot — i.e. a status is present. Absent conditional docs are skipped.
 * - A NOT_UPLOADED doc is NOT "missing" once the milestone is already
 *   approved/paid (PE didn't need it — waived). A flagged doc is never waived.
 * - A doc with no synced status at all is skipped (no data), matching DocsTab.
 */
export function milestoneDocCounts(
  milestone: MilestoneKey,
  statusByDoc: Map<string, string>,
  milestoneStatus: string | null | undefined,
): MilestoneDocCounts {
  const sections = milestone === "IC" ? M1_SECTIONS : M2_SECTIONS;
  const waived = PE_MILESTONE_DONE.has((milestoneStatus ?? "").trim().toLowerCase());
  let flagged = 0;
  let missing = 0;
  let total = 0;
  for (const doc of PE_MILESTONE_DOCS) {
    if (!sections.includes(doc.section)) continue;
    const st = statusByDoc.get(doc.name);
    if (st === undefined) continue; // no synced row → no data (matches DocsTab)
    if (st === "NOT_REQUIRED") continue; // PE didn't ask for it on this project
    total++;
    if (st === "ACTION_REQUIRED" || st === "REJECTED") flagged++;
    else if (st === "NOT_UPLOADED") {
      if (!waived) missing++;
    }
  }
  return { flagged, missing, total };
}

/**
 * Doc-state-driven subgroup for an ELIGIBLE milestone. The caller must apply the
 * stage gate first — this assumes the milestone is active.
 */
export function milestoneDocBucket(
  milestone: MilestoneKey,
  statusByDoc: Map<string, string>,
  milestoneStatus: string | null | undefined,
): MilestoneStatusBucket {
  const { flagged, missing, total } = milestoneDocCounts(milestone, statusByDoc, milestoneStatus);
  if (total === 0) return statusBucket(milestoneStatus); // no doc data → trust status
  if (missing === 0) {
    // every owed doc is uploaded (in review / approved)
    if (flagged > 0) return "action";
    const sb = statusBucket(milestoneStatus);
    return sb === "approved" || sb === "paid" ? sb : "review";
  }
  // at least one owed doc still not uploaded
  if (WAITING_HOLD_RE.test((milestoneStatus ?? "").trim())) return "waiting";
  return statusBucket(milestoneStatus); // Ready to Submit stays "ready"; others keep status
}
