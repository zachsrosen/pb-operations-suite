import {
  composeRejectionNotes,
  composeAllRejectionComments,
  composeRejectedDocuments,
  peInternalIdFromPortalUrl,
  sameDocSelection,
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
    expect(out["pe_rejection_notes_for_design"]).toBe("Design Plan:\n• issue with model number");
    expect(out["pe_rejection_notes_for_sales"]).toBe("Signed Proposal:\n• wrong system size");
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
    expect(out["pe_rejection_notes_for_sales"]).toBe("Signed Proposal:\n• current issue");
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
      "Customer Agreement (PPA/ESA):\n• missing signature\n\nUtility Bill:\n• illegible\n\nInstallation Order:\n• outdated",
    );
  });

  it("emits a header with a placeholder bullet when the doc is rejected but PE left no note", () => {
    const out = composeRejectionNotes(docs({ designPlan: "RESPONSE_NEEDED" }), []);
    expect(out["pe_rejection_notes_for_design"]).toBe("Design Plan:\n• (no reviewer note provided)");
  });

  it("dedupes identical issue lines and splits multi-issue blobs into bullets", () => {
    const out = composeRejectionNotes(docs({ designPlan: "RESPONSE_NEEDED" }), [
      item("design_plan", "Design Plan", "[H106] incomplete\n[H200] also wrong"),
      item("design_plan", "Design Plan", "[H106] incomplete\n[H200] also wrong"), // duplicate from PE
    ]);
    expect(out["pe_rejection_notes_for_design"]).toBe(
      "Design Plan:\n• [H106] incomplete\n• [H200] also wrong",
    );
  });

  it("mirrors ONLY the LJF lines to Design; proposal-document comments stay with Sales", () => {
    const out = composeRejectionNotes(docs({ signedProposal: "RESPONSE_NEEDED" }), [
      item(
        "signed_proposal",
        "Signed Proposal",
        "Page 14 — 30% tax credit language in the proposal\nPage 10 — offset exceeds 135%, submit a Load Justification form",
      ),
    ]);
    // Sales sees the full proposal note (both lines).
    expect(out["pe_rejection_notes_for_sales"]).toBe(
      "Signed Proposal:\n• Page 14 — 30% tax credit language in the proposal\n• Page 10 — offset exceeds 135%, submit a Load Justification form",
    );
    // Design sees ONLY the LJF line — not the 30% proposal comment.
    expect(out["pe_rejection_notes_for_design"]).toBe(
      "Load Justification Form:\n• Page 10 — offset exceeds 135%, submit a Load Justification form",
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
      "Signed Interconnection Agreement:\n• missing signature\n\nPermission to Operate (PTO):\n• utility denied",
    );
    expect(out["pe_rejection_notes_for_accounting"]).toBe(
      "Conditional Waiver — Final Payment:\n• amount wrong",
    );
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

describe("composeAllRejectionComments", () => {
  it("combines every rejected doc into one field, one block per doc", () => {
    const out = composeAllRejectionComments(
      docs({
        designPlan: "RESPONSE_NEEDED",
        photos: "RESPONSE_NEEDED",
        customerAgreement: "RESPONSE_NEEDED",
      }),
      [
        item("design_plan", "Design Plan", "module mismatch"),
        item("photos_per_policy", "Photos per Policy", "blurry"),
        item("customer_agreement", "Customer Agreement (PPA/ESA)", "missing signature"),
      ],
    );
    expect(out).toBe(
      "Design Plan:\n• module mismatch\n\n" +
        "Photos per Policy:\n• blurry\n\n" +
        "Customer Agreement (PPA/ESA):\n• missing signature",
    );
  });

  it("does NOT duplicate the LJF line — Proposal block carries it, no separate LJF block", () => {
    const out = composeAllRejectionComments(docs({ signedProposal: "RESPONSE_NEEDED" }), [
      item(
        "signed_proposal",
        "Signed Proposal",
        "Page 14 — 30% language in proposal\nPage 10 — offset exceeds 135%, submit a Load Justification form",
      ),
    ]);
    expect(out).toBe(
      "Signed Proposal:\n• Page 14 — 30% language in proposal\n• Page 10 — offset exceeds 135%, submit a Load Justification form",
    );
    expect(out).not.toContain("Load Justification Form:");
  });

  it("returns an empty string when nothing is currently rejected", () => {
    expect(composeAllRejectionComments(docs({ designPlan: "APPROVED" }), [])).toBe("");
  });
});

describe("composeRejectedDocuments", () => {
  it("ticks pe_m1_documents for each currently-rejected M1 doc (checkbox labels, not PE names)", () => {
    const out = composeRejectedDocuments(
      docs({
        designPlan: "RESPONSE_NEEDED",
        photos: "RESPONSE_NEEDED",
        customerAgreement: "RESPONSE_NEEDED",
      }),
      [
        item("design_plan", "Design Plan", "x"),
        item("photos_per_policy", "Photos per Policy", "x"),
        item("customer_agreement", "Customer Agreement (PPA/ESA)", "x"),
      ],
    );
    // Output is sorted so the same set always serializes identically — an
    // unsorted re-write would look like a "change" to HubSpot and re-fire the
    // per-team task workflows on every webhook retry.
    expect(out.pe_m1_documents).toBe("Customer Agreement;Design Plan;Photos");
    expect(out.pe_m2_documents).toBeUndefined();
  });

  it("emits a deterministically-sorted set regardless of input doc order", () => {
    const a = composeRejectedDocuments(
      docs({ photos: "RESPONSE_NEEDED", designPlan: "RESPONSE_NEEDED", customerAgreement: "RESPONSE_NEEDED" }),
      [],
    );
    const b = composeRejectedDocuments(
      docs({ customerAgreement: "RESPONSE_NEEDED", photos: "RESPONSE_NEEDED", designPlan: "RESPONSE_NEEDED" }),
      [],
    );
    expect(a.pe_m1_documents).toBe(b.pe_m1_documents);
    expect(a.pe_m1_documents).toBe("Customer Agreement;Design Plan;Photos");
  });

  it("excludes APPROVED / under-review / not-uploaded docs", () => {
    const out = composeRejectedDocuments(
      docs({ designPlan: "APPROVED", photos: "PENDING_REVIEW", utilityBill: null }),
      [item("design_plan", "Design Plan", "stale")],
    );
    expect(out).toEqual({});
  });

  it("Proposal with only an LJF note ticks just 'Load Justification Form'", () => {
    const out = composeRejectedDocuments(docs({ signedProposal: "RESPONSE_NEEDED" }), [
      item("signed_proposal", "Signed Proposal", "Energy offset exceeds 135% — submit a Load Justification form"),
    ]);
    expect(out.pe_m1_documents).toBe("Load Justification Form");
  });

  it("Proposal with a proposal-document note ticks just 'Proposal'", () => {
    const out = composeRejectedDocuments(docs({ signedProposal: "RESPONSE_NEEDED" }), [
      item("signed_proposal", "Signed Proposal", "Remove the 30% tax credit language from the proposal"),
    ]);
    expect(out.pe_m1_documents).toBe("Proposal");
  });

  it("Proposal with mixed issues (proposal + LJF) ticks BOTH", () => {
    const out = composeRejectedDocuments(docs({ signedProposal: "RESPONSE_NEEDED" }), [
      item(
        "signed_proposal",
        "Signed Proposal",
        "Page 14 — 30% discount language visible in the proposal\nPage 10 — offset exceeds 135%, requires Load Justification",
      ),
    ]);
    expect(out.pe_m1_documents).toBe("Load Justification Form;Proposal");
  });

  it("Proposal rejected with no note defaults to 'Proposal'", () => {
    const out = composeRejectedDocuments(docs({ signedProposal: "RESPONSE_NEEDED" }), []);
    expect(out.pe_m1_documents).toBe("Proposal");
  });

  it("ticks pe_m2_documents with the M2 checkbox values (PTO and waiver differ from labels)", () => {
    const out = composeRejectedDocuments(
      docs({
        signedInterconnectionAgreement: "RESPONSE_NEEDED",
        permissionToOperate: "RESPONSE_NEEDED",
        conditionalWaiverReleaseFinalPayment: "RESPONSE_NEEDED",
      }),
      [],
    );
    expect(out.pe_m2_documents).toBe(
      "Conditional Waiver and Release;Permission to Operate;Signed Interconnection Agreement",
    );
    expect(out.pe_m1_documents).toBeUndefined();
  });

  it("dedupes (PE returns duplicate action items)", () => {
    const out = composeRejectedDocuments(docs({ photos: "RESPONSE_NEEDED" }), [
      item("photos_per_policy", "Photos per Policy", "x"),
      item("photos_per_policy", "Photos per Policy", "x"),
    ]);
    expect(out.pe_m1_documents).toBe("Photos");
  });

  it("returns {} when nothing is currently rejected", () => {
    expect(composeRejectedDocuments(docs({ designPlan: "APPROVED" }), [])).toEqual({});
  });
});

describe("sameDocSelection", () => {
  it("treats the same set in a different order as unchanged", () => {
    expect(
      sameDocSelection("Installation Order;Customer Agreement;Proposal", "Customer Agreement;Installation Order;Proposal"),
    ).toBe(true);
  });

  it("treats an added or removed doc as changed", () => {
    expect(sameDocSelection("Proposal", "Proposal;Customer Agreement")).toBe(false);
    expect(sameDocSelection("Proposal;Customer Agreement", "Proposal")).toBe(false);
  });

  it("ignores whitespace and duplicate entries", () => {
    expect(sameDocSelection("Proposal; Customer Agreement ", "Customer Agreement;Proposal;Proposal")).toBe(true);
  });

  it("treats empty/blank/undefined as the empty set (equal to each other)", () => {
    expect(sameDocSelection("", undefined)).toBe(true);
    expect(sameDocSelection(null, "")).toBe(true);
    expect(sameDocSelection("", "Proposal")).toBe(false);
  });
});
