import {
  composeRejectionNotes,
  peInternalIdFromPortalUrl,
  PE_DOC_TO_TEAM_FIELD,
} from "@/lib/pe-rejection-notes";
import type { PeActionItem, PeDocumentInfo, PeDocuments } from "@/lib/pe-api";

const item = (id: string, label: string, notes: string): PeActionItem => ({
  id: `ai-${id}`,
  date: "2026-06-20T00:00:00Z",
  activityBy: "PE Reviewer",
  notes,
  document: { type: "document", id, label },
});

const doc = (status: string | null): PeDocumentInfo => ({
  present: true,
  version: 1,
  status,
  versions: [],
});

/** Build a PeDocuments object from { camelCaseDocKey: status } pairs. */
const docs = (m: Record<string, string | null>): PeDocuments => {
  const out: Record<string, PeDocumentInfo> = {};
  for (const [k, s] of Object.entries(m)) out[k] = doc(s);
  return out as PeDocuments;
};

describe("peInternalIdFromPortalUrl", () => {
  it("extracts the trailing Raceway id", () => {
    expect(
      peInternalIdFromPortalUrl("https://raceway.participate.energy/projects/W1BiCI8s6INyDN6hESCn"),
    ).toBe("W1BiCI8s6INyDN6hESCn");
  });
  it("tolerates a trailing slash", () => {
    expect(peInternalIdFromPortalUrl("https://x/projects/ABC123/")).toBe("ABC123");
  });
  it("returns null for empty/missing", () => {
    expect(peInternalIdFromPortalUrl(null)).toBeNull();
    expect(peInternalIdFromPortalUrl("")).toBeNull();
  });
});

describe("composeRejectionNotes", () => {
  it("routes each currently-rejected doc's note to the owning team field", () => {
    const out = composeRejectionNotes(
      docs({ designPlan: "RESPONSE_NEEDED", signedProposal: "RESPONSE_NEEDED" }),
      [
        item("design_plan", "Design Plan", "issue with model number"),
        item("signed_proposal", "Signed Proposal", "wrong system size"),
      ],
    );
    expect(out["pe_rejection_notes_for_design"]).toBe("Design Plan - issue with model number");
    expect(out["pe_rejection_notes_for_sales"]).toBe("Signed Proposal - wrong system size");
  });

  it("EXCLUDES a doc whose current status is APPROVED, even with a stale action item", () => {
    const out = composeRejectionNotes(
      docs({ designPlan: "APPROVED", signedProposal: "RESPONSE_NEEDED" }),
      [
        item("design_plan", "Design Plan", "old issue that was resolved"), // stale — doc now approved
        item("signed_proposal", "Signed Proposal", "current issue"),
      ],
    );
    expect(out["pe_rejection_notes_for_design"]).toBeUndefined();
    expect(out["pe_rejection_notes_for_sales"]).toBe("Signed Proposal - current issue");
  });

  it("ignores docs under review (PENDING_*) or not uploaded (null)", () => {
    const out = composeRejectionNotes(
      docs({ designPlan: "PENDING_REVIEW", signedProposal: "PENDING_APPROVAL", utilityBill: null }),
      [item("design_plan", "Design Plan", "note")],
    );
    expect(out).toEqual({});
  });

  it("groups multiple currently-rejected docs for the same team", () => {
    const out = composeRejectionNotes(
      docs({
        customerAgreement: "RESPONSE_NEEDED",
        utilityBill: "RESPONSE_NEEDED",
        installationOrder: "RESPONSE_NEEDED",
      }),
      [
        item("customer_agreement", "Customer Agreement (PPA/ESA)", "missing signature"),
        item("utility_bill", "Utility Bill", "illegible"),
        item("installation_order", "Installation Order", "outdated"),
      ],
    );
    expect(out["pe_rejection_notes_for_sales"]).toBe(
      "Customer Agreement (PPA/ESA) - missing signature\nUtility Bill - illegible\nInstallation Order - outdated",
    );
  });

  it("emits a bare 'Doc - ' when the doc is rejected but PE left no note", () => {
    const out = composeRejectionNotes(docs({ designPlan: "RESPONSE_NEEDED" }), []);
    expect(out["pe_rejection_notes_for_design"]).toBe("Design Plan - ");
  });

  it("dedupes identical action items (PE returns each one more than once)", () => {
    const out = composeRejectionNotes(docs({ designPlan: "RESPONSE_NEEDED" }), [
      item("design_plan", "Design Plan", "[H106] incomplete"),
      item("design_plan", "Design Plan", "[H106] incomplete"), // duplicate from PE
      item("design_plan", "Design Plan", "[H200] also wrong"), // genuinely different — kept
    ]);
    expect(out["pe_rejection_notes_for_design"]).toBe(
      "Design Plan - [H106] incomplete\nDesign Plan - [H200] also wrong",
    );
  });

  it("mirrors Load Justification Form to Design when the Proposal note mentions it", () => {
    const out = composeRejectionNotes(docs({ signedProposal: "RESPONSE_NEEDED" }), [
      item("signed_proposal", "Signed Proposal", "Load Justification Form usage is wrong; also pricing"),
    ]);
    expect(out["pe_rejection_notes_for_sales"]).toBe(
      "Signed Proposal - Load Justification Form usage is wrong; also pricing",
    );
    expect(out["pe_rejection_notes_for_design"]).toBe(
      "Load Justification Form - Load Justification Form usage is wrong; also pricing",
    );
  });

  it("does NOT mirror to Design when the Proposal note has no LJF mention", () => {
    const out = composeRejectionNotes(docs({ signedProposal: "RESPONSE_NEEDED" }), [
      item("signed_proposal", "Signed Proposal", "system size mismatch"),
    ]);
    expect(out["pe_rejection_notes_for_design"]).toBeUndefined();
  });

  it("routes M2 docs: Interconnection + PTO → Interconnection, Final-Payment waiver → Accounting", () => {
    const out = composeRejectionNotes(
      docs({
        signedInterconnectionAgreement: "RESPONSE_NEEDED",
        permissionToOperate: "RESPONSE_NEEDED",
        conditionalWaiverReleaseFinalPayment: "RESPONSE_NEEDED",
      }),
      [
        item("signed_interconnection_agreement", "Signed Interconnection Agreement", "missing signature"),
        item("permission_to_operate", "Permission to Operate (PTO)", "utility denied"),
        item("conditional_waiver_final_payment", "Conditional Waiver — Final Payment", "amount wrong"),
      ],
    );
    expect(out["pe_rejection_notes_for_intercocnnection"]).toBe(
      "Signed Interconnection Agreement - missing signature\nPermission to Operate (PTO) - utility denied",
    );
    expect(out["pe_rejection_notes_for_accounting"]).toBe("Conditional Waiver — Final Payment - amount wrong");
  });

  it("returns only fields that have a currently-rejected, routed doc", () => {
    const out = composeRejectionNotes(docs({ photos: "RESPONSE_NEEDED" }), [
      item("photos_per_policy", "Photos per Policy", "blurry"),
    ]);
    expect(Object.keys(out)).toEqual(["pe_rejection_notes_for_ops"]);
  });

  it("maps every routed doc to a real pe_rejection_notes_for_* field", () => {
    for (const field of Object.values(PE_DOC_TO_TEAM_FIELD)) {
      expect(field).toMatch(/^pe_rejection_notes_for_/);
    }
  });
});
