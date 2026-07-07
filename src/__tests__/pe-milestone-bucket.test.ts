import {
  statusBucket,
  milestoneDocCounts,
  milestoneDocBucket,
} from "@/lib/pe-milestone-bucket";

// Build a docName -> status map from pairs.
const docs = (pairs: Record<string, string>) => new Map<string, string>(Object.entries(pairs));

// A full M1 doc set (onboarding + ic) at a given status, then override some.
const M1_DOCS = [
  "Customer Agreement (PPA/ESA)", "Installation Order", "State Disclosures", "Utility Bill",
  "Signed Proposal", "Design Plan", "Photos per Policy", "Signed Final Permit",
  "Access to Monitoring", "Certificate of Acceptance", "Attestation of Customer Payment",
  "Conditional Progress Lien Waiver",
];
const m1All = (status: string, overrides: Record<string, string> = {}) => {
  const base: Record<string, string> = {};
  for (const d of M1_DOCS) base[d] = status;
  return docs({ ...base, ...overrides });
};

describe("statusBucket", () => {
  it("maps waiting/ready/action/review/approved/paid", () => {
    expect(statusBucket("Waiting on Information")).toBe("waiting");
    expect(statusBucket("Ready to Submit")).toBe("ready");
    expect(statusBucket("Rejected")).toBe("action");
    expect(statusBucket("Internally Rejected")).toBe("action");
    expect(statusBucket("Resubmitted")).toBe("review");
    expect(statusBucket("Submitted")).toBe("review");
    expect(statusBucket("Approved")).toBe("approved");
    expect(statusBucket("Paid")).toBe("paid");
    expect(statusBucket("Something Else")).toBe("other");
    expect(statusBucket(null)).toBe("other");
  });
});

describe("milestoneDocCounts", () => {
  it("counts flagged and missing across owed M1 docs", () => {
    const c = milestoneDocCounts("IC", m1All("UNDER_REVIEW", {
      "Customer Agreement (PPA/ESA)": "ACTION_REQUIRED",
      "Utility Bill": "NOT_UPLOADED",
    }), "Resubmitted");
    expect(c.flagged).toBe(1);
    expect(c.missing).toBe(1);
    expect(c.total).toBe(12);
  });

  it("does not count a NOT_UPLOADED doc as missing once the milestone is approved/paid (waived)", () => {
    const c = milestoneDocCounts("IC", m1All("APPROVED", { "Utility Bill": "NOT_UPLOADED" }), "Approved");
    expect(c.missing).toBe(0); // waived
  });

  it("skips a conditional doc (Bill of Materials) when PE created no slot", () => {
    // BOM not in the map → not owed → total excludes it (12, not 13).
    const c = milestoneDocCounts("IC", m1All("APPROVED"), "Approved");
    expect(c.total).toBe(12);
  });

  it("counts the conditional doc when PE included its slot", () => {
    const c = milestoneDocCounts("IC", m1All("APPROVED", { "Bill of Materials": "NOT_UPLOADED" }), "Submitted");
    expect(c.total).toBe(13);
    expect(c.missing).toBe(1);
  });

  it("PC counts only pc-section docs", () => {
    const c = milestoneDocCounts("PC", docs({
      "Signed Interconnection Agreement": "UNDER_REVIEW",
      "Permission to Operate (PTO)": "NOT_UPLOADED",
      "Conditional Waiver — Final Payment": "APPROVED",
      // M1 docs present but must be ignored for PC:
      "Customer Agreement (PPA/ESA)": "ACTION_REQUIRED",
    }), "Ready to Submit");
    expect(c.total).toBe(3);
    expect(c.flagged).toBe(0);
    expect(c.missing).toBe(1);
  });
});

describe("milestoneDocBucket — all docs uploaded", () => {
  it("flagged doc → action (Rooney: Resubmitted status hiding a rejection)", () => {
    expect(milestoneDocBucket("IC", m1All("APPROVED", {
      "Signed Proposal": "ACTION_REQUIRED",
    }), "Resubmitted")).toBe("action");
  });

  it("all in, none flagged, some under review → review (even if status says Waiting)", () => {
    expect(milestoneDocBucket("IC", m1All("UNDER_REVIEW"), "Waiting on Information")).toBe("review");
  });

  it("all approved + status Approved → approved (stays)", () => {
    expect(milestoneDocBucket("IC", m1All("APPROVED"), "Approved")).toBe("approved");
  });

  it("all approved + status Paid → paid (stays)", () => {
    expect(milestoneDocBucket("IC", m1All("APPROVED"), "Paid")).toBe("paid");
  });

  it("Ready to Submit status but all docs actually uploaded, none flagged → review", () => {
    expect(milestoneDocBucket("IC", m1All("UNDER_REVIEW"), "Ready to Submit")).toBe("review");
  });
});

describe("milestoneDocBucket — a doc still missing", () => {
  it("Waiting on Information + missing → waiting", () => {
    expect(milestoneDocBucket("IC", m1All("UNDER_REVIEW", {
      "Certificate of Acceptance": "NOT_UPLOADED",
    }), "Waiting on Information")).toBe("waiting");
  });

  it("Internally Rejected + missing → waiting", () => {
    expect(milestoneDocBucket("IC", m1All("UNDER_REVIEW", {
      "Photos per Policy": "NOT_UPLOADED",
    }), "Internally Rejected")).toBe("waiting");
  });

  it("Ready to Submit + missing → stays ready", () => {
    expect(milestoneDocBucket("IC", m1All("UNDER_REVIEW", {
      "Certificate of Acceptance": "NOT_UPLOADED",
    }), "Ready to Submit")).toBe("ready");
  });

  it("any other status + missing → keeps its status bucket (Submitted → review)", () => {
    expect(milestoneDocBucket("IC", m1All("UNDER_REVIEW", {
      "Utility Bill": "NOT_UPLOADED",
    }), "Submitted")).toBe("review");
  });
});

describe("milestoneDocBucket — no doc data", () => {
  it("empty doc map → falls back to the status bucket (unchanged behavior)", () => {
    expect(milestoneDocBucket("IC", new Map(), "Submitted")).toBe("review");
    expect(milestoneDocBucket("IC", new Map(), "Waiting on Information")).toBe("waiting");
    expect(milestoneDocBucket("PC", new Map(), "Approved")).toBe("approved");
  });
});
