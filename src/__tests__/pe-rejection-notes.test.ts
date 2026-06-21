import {
  composeRejectionNotes,
  peInternalIdFromPortalUrl,
  PE_DOC_TO_TEAM_FIELD,
} from "@/lib/pe-rejection-notes";
import type { PeActionItem } from "@/lib/pe-api";

const item = (id: string, label: string, notes: string): PeActionItem => ({
  id: `ai-${id}`,
  date: "2026-06-20T00:00:00Z",
  activityBy: "PE Reviewer",
  notes,
  document: { type: "document", id, label },
});

describe("peInternalIdFromPortalUrl", () => {
  it("extracts the trailing Raceway id", () => {
    expect(
      peInternalIdFromPortalUrl(
        "https://raceway.participate.energy/projects/W1BiCI8s6INyDN6hESCn",
      ),
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
  it("routes each document's note to the owning team field", () => {
    const out = composeRejectionNotes([
      item("design_plan", "Design Plan", "issue with model number"),
      item("signed_proposal", "Signed Proposal", "wrong system size"),
    ]);
    expect(out["pe_rejection_notes_for_design"]).toBe("Design Plan - issue with model number");
    expect(out["pe_rejection_notes_for_sales"]).toBe("Signed Proposal - wrong system size");
  });

  it("groups multiple docs for the same team onto separate lines", () => {
    const out = composeRejectionNotes([
      item("customer_agreement", "Customer Agreement (PPA/ESA)", "missing signature"),
      item("utility_bill", "Utility Bill", "illegible"),
      item("installation_order", "Installation Order", "outdated"),
    ]);
    expect(out["pe_rejection_notes_for_sales"]).toBe(
      "Customer Agreement (PPA/ESA) - missing signature\nUtility Bill - illegible\nInstallation Order - outdated",
    );
  });

  it("normalizes the countersigned_ppa_esa action id to Customer Agreement → Sales", () => {
    const out = composeRejectionNotes([
      item("countersigned_ppa_esa", "Customer Agreement (PPA/ESA)", "needs co-signer"),
    ]);
    expect(out["pe_rejection_notes_for_sales"]).toBe(
      "Customer Agreement (PPA/ESA) - needs co-signer",
    );
  });

  it("emits a bare 'Label - ' when PE left no note", () => {
    const out = composeRejectionNotes([item("design_plan", "Design Plan", "")]);
    expect(out["pe_rejection_notes_for_design"]).toBe("Design Plan - ");
  });

  it("routes Attestation + Certificate of Acceptance to Compliance", () => {
    const out = composeRejectionNotes([
      item("attestation_of_customer_payment", "Attestation of Customer Payment", "amount mismatch"),
      item("certificate_of_acceptance", "Certificate of Acceptance", "unsigned"),
    ]);
    expect(out["pe_rejection_notes_for_compliance"]).toBe(
      "Attestation of Customer Payment - amount mismatch\nCertificate of Acceptance - unsigned",
    );
  });

  it("mirrors Load Justification Form to Design when the Proposal note mentions it", () => {
    const out = composeRejectionNotes([
      item("signed_proposal", "Signed Proposal", "Load Justification Form usage is wrong; also pricing"),
    ]);
    expect(out["pe_rejection_notes_for_sales"]).toBe(
      "Signed Proposal - Load Justification Form usage is wrong; also pricing",
    );
    expect(out["pe_rejection_notes_for_design"]).toBe(
      "Load Justification Form - Load Justification Form usage is wrong; also pricing",
    );
  });

  it("matches the 'LJF' abbreviation too", () => {
    const out = composeRejectionNotes([
      item("signed_proposal", "Signed Proposal", "LJF needs the updated panel count"),
    ]);
    expect(out["pe_rejection_notes_for_design"]).toContain("Load Justification Form - ");
  });

  it("does NOT mirror to Design when the Proposal note has no LJF mention", () => {
    const out = composeRejectionNotes([
      item("signed_proposal", "Signed Proposal", "system size mismatch"),
    ]);
    expect(out["pe_rejection_notes_for_sales"]).toBe("Signed Proposal - system size mismatch");
    expect(out["pe_rejection_notes_for_design"]).toBeUndefined();
  });

  it("skips M2 / unknown documents (not in the M1 routing map)", () => {
    const out = composeRejectionNotes([
      item("permission_to_operate", "Permission to Operate (PTO)", "M2 doc"),
      item("signed_interconnection_agreement", "Signed Interconnection Agreement", "M2 doc"),
      item("something_unknown", "Mystery Doc", "ignore me"),
    ]);
    expect(out).toEqual({});
  });

  it("only returns fields that actually have action items", () => {
    const out = composeRejectionNotes([item("photos_per_policy", "Photos per Policy", "blurry")]);
    expect(Object.keys(out)).toEqual(["pe_rejection_notes_for_ops"]);
  });

  it("maps every routed doc to a real pe_rejection_notes_for_* field", () => {
    for (const field of Object.values(PE_DOC_TO_TEAM_FIELD)) {
      expect(field).toMatch(/^pe_rejection_notes_for_/);
    }
  });
});
