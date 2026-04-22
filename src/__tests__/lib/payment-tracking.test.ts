import {
  transformDeal,
  computeSummary,
  computeBucket,
} from "@/lib/payment-tracking";
import type { HubSpotDealPaymentProps } from "@/lib/payment-tracking-types";

const BASE: HubSpotDealPaymentProps = {
  hs_object_id: "123",
  dealname: "PROJ-0001 | Test, Person | 1 Main St",
  amount: "10000",
  pb_location: "Centennial",
  dealstage: "20440342", // Construction — pre-install, safe default for tests
  closedate: "2026-03-01T00:00:00Z",
  paid_in_full: "false",
};

describe("transformDeal — non-PE", () => {
  it("parses DA + CC amounts and statuses", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        da_invoice_amount: "5000",
        da_invoice_paid: "2026-03-10",
        cc_invoice_status: "Open",
        cc_invoice_amount: "5000",
      },
      new Date("2026-03-15")
    );
    expect(deal.isPE).toBe(false);
    expect(deal.customerContractTotal).toBe(10000);
    expect(deal.customerCollected).toBe(5000);
    expect(deal.customerOutstanding).toBe(5000);
    expect(deal.daStatus).toBe("Paid In Full");
    expect(deal.daAmount).toBe(5000);
    expect(deal.daPaidDate).toBe("2026-03-10");
    expect(deal.ccStatus).toBe("Open");
  });

  it("lands in awaiting_m1 bucket when DA is Open", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Open",
        da_invoice_amount: "5000",
        cc_invoice_status: "Pending Approval",
        cc_invoice_amount: "5000",
      },
      new Date("2026-03-15") // 14 days after close — not overdue
    );
    expect(deal.bucket).toBe("awaiting_m1");
  });

  it("lands in awaiting_m2 when DA paid, CC open", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        da_invoice_amount: "5000",
        da_invoice_paid: "2026-03-10",
        cc_invoice_status: "Open",
        cc_invoice_amount: "5000",
      },
      new Date("2026-03-15")
    );
    expect(deal.bucket).toBe("awaiting_m2");
  });

  it("lands in awaiting_pto when DA + CC paid, PTO open", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Paid In Full",
        pto_invoice_status: "Open",
      },
      new Date("2026-03-15")
    );
    expect(deal.bucket).toBe("awaiting_pto");
  });

  it("lands in fully_collected when all three milestones are Paid In Full", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Paid In Full",
        pto_invoice_status: "Paid In Full",
      },
      new Date("2026-03-15")
    );
    expect(deal.bucket).toBe("fully_collected");
  });
});

describe("transformDeal — attention bucket", () => {
  it("lands in attention when any PE status is Rejected", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Paid In Full",
        pe_m1_status: "Rejected",
      },
      new Date("2026-03-15")
    );
    expect(deal.bucket).toBe("attention");
    expect(deal.attentionReasons).toContain("PE M1 Rejected");
  });

  it("lands in attention when CC is Open >30 days past close", () => {
    const deal = transformDeal(
      {
        ...BASE,
        closedate: "2026-02-01T00:00:00Z",
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Open",
        cc_invoice_amount: "5000",
      },
      new Date("2026-04-21") // ~79 days after close
    );
    expect(deal.bucket).toBe("attention");
  });

  it("lands in attention when CC not paid and stage is post-install", () => {
    const deal = transformDeal(
      {
        ...BASE,
        dealstage: "22580872", // Inspection — post-install
        closedate: "2026-04-10T00:00:00Z", // recent — not overdue by 30 days
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Open",
        cc_invoice_amount: "5000",
      },
      new Date("2026-04-21")
    );
    expect(deal.bucket).toBe("attention");
    expect(deal.attentionReasons).toContain("Post-install, CC not paid");
  });
});

describe("transformDeal — PE deals", () => {
  it("detects PE and computes PE bonus", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        da_invoice_amount: "5000",
        cc_invoice_status: "Paid In Full",
        cc_invoice_amount: "5000",
        pto_invoice_status: "Paid In Full",
        pe_m1_status: "Paid",
        pe_m2_status: "Paid",
        pe_payment_ic: "6000",
        pe_payment_pc: "3000",
        pe_total_pb_revenue: "19000",
      },
      new Date("2026-04-21")
    );
    expect(deal.isPE).toBe(true);
    expect(deal.peBonusTotal).toBe(9000);
    expect(deal.peBonusCollected).toBe(9000);
    expect(deal.peBonusOutstanding).toBe(0);
    expect(deal.totalPBRevenue).toBe(19000);
    expect(deal.bucket).toBe("fully_collected");
  });

  it("lands in awaiting_pe_m1 when customer side complete and PE M1 not Paid", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Paid In Full",
        pto_invoice_status: "Paid In Full",
        pe_m1_status: "Submitted",
        pe_m2_status: "Ready to Submit",
        pe_payment_ic: "6000",
        pe_payment_pc: "3000",
      },
      new Date("2026-04-21")
    );
    expect(deal.bucket).toBe("awaiting_pe_m1");
  });

  it("lands in awaiting_pe_m2 when PE M1 paid but PE M2 not Paid", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Paid In Full",
        pto_invoice_status: "Paid In Full",
        pe_m1_status: "Paid",
        pe_m2_status: "Submitted",
        pe_payment_ic: "6000",
        pe_payment_pc: "3000",
      },
      new Date("2026-04-21")
    );
    expect(deal.bucket).toBe("awaiting_pe_m2");
  });
});

describe("transformDeal — paid_in_full flag", () => {
  it("ignores paid_in_full=true when milestones are not all Paid", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Pending Approval",
        paid_in_full: "true", // HubSpot says yes, milestones say no
      },
      new Date("2026-04-21")
    );
    expect(deal.paidInFullFlag).toBe(true);
    expect(deal.bucket).toBe("awaiting_m1");
  });

  it("parses paid_in_full=false as false", () => {
    const deal = transformDeal({ ...BASE, paid_in_full: "false" }, new Date("2026-04-21"));
    expect(deal.paidInFullFlag).toBe(false);
  });

  it("parses missing paid_in_full as null", () => {
    const { paid_in_full: _unused, ...propsWithoutFlag } = BASE;
    const deal = transformDeal(propsWithoutFlag, new Date("2026-04-21"));
    expect(deal.paidInFullFlag).toBe(null);
  });
});

describe("transformDeal — property canonicalization", () => {
  it("treats missing pto_invoice_status as null (no m3 fallback)", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Paid In Full",
      },
      new Date("2026-04-21")
    );
    expect(deal.ptoStatus).toBe(null);
  });
});

describe("computeSummary", () => {
  it("sums customer and PE revenue separately", () => {
    const deals = [
      transformDeal(
        {
          ...BASE,
          hs_object_id: "1",
          da_invoice_status: "Paid In Full",
          da_invoice_amount: "5000",
          cc_invoice_status: "Open",
          cc_invoice_amount: "5000",
        },
        new Date("2026-03-15")
      ),
      transformDeal(
        {
          ...BASE,
          hs_object_id: "2",
          amount: "20000",
          da_invoice_status: "Paid In Full",
          da_invoice_amount: "10000",
          cc_invoice_status: "Paid In Full",
          cc_invoice_amount: "10000",
          pto_invoice_status: "Paid In Full",
          pe_m1_status: "Paid",
          pe_m2_status: "Paid",
          pe_payment_ic: "6000",
          pe_payment_pc: "3000",
          pe_total_pb_revenue: "29000",
        },
        new Date("2026-04-21")
      ),
    ];

    const summary = computeSummary(deals);
    expect(summary.customerContractTotal).toBe(30000);
    expect(summary.customerCollected).toBe(25000); // 5k + 10k + 10k
    expect(summary.customerOutstanding).toBe(5000);
    expect(summary.peBonusTotal).toBe(9000);
    expect(summary.peBonusCollected).toBe(9000);
    expect(summary.totalPBRevenue).toBe(39000); // 10k customer deal #1 + 29k PE deal #2
    expect(summary.dealCount).toBe(2);
  });
});

describe("transformDeal — edge cases", () => {
  it("post-install with DA still not paid goes to awaiting_m1, not attention (within 30 days of close)", () => {
    // Intentional: DA-first principle. Post-install CC-not-paid attention
    // rule is guarded by `daStatus === "Paid In Full"`, so DA-open deals
    // fall through to awaiting_m1 regardless of stage. The >30-day rule is
    // the only thing that would flag them earlier.
    const deal = transformDeal(
      {
        ...BASE,
        dealstage: "22580872", // Inspection (post-install)
        closedate: "2026-04-15T00:00:00Z", // recent — not >30 days
        da_invoice_status: "Open",
        da_invoice_amount: "5000",
      },
      new Date("2026-04-21")
    );
    expect(deal.bucket).toBe("awaiting_m1");
  });

  it("PE M1 Paid but peM1ApprovalDate null does not fire stuck-M2 attention", () => {
    // Defensive: without an approval date we can't measure "> 14 days stuck".
    // Deal should NOT be flagged as attention on that basis.
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Paid In Full",
        pto_invoice_status: "Paid In Full",
        pe_m1_status: "Paid",
        pe_m2_status: "Ready to Submit",
        pe_payment_ic: "6000",
        pe_payment_pc: "3000",
        // pe_m1_approval_date intentionally omitted
      },
      new Date("2026-04-21")
    );
    expect(deal.bucket).toBe("awaiting_pe_m2");
    expect(deal.attentionReasons).not.toContain("PE M1 Paid >14 days, M2 not submitted");
  });
});

describe("transformDeal — ready-to-invoice triggers", () => {
  it("flags 'design approved but DA not paid' as attention", () => {
    const deal = transformDeal(
      {
        ...BASE,
        layout_approved: "true",
        layout_approval_date: "2026-04-01",
        da_invoice_status: "Pending Approval",
      },
      new Date("2026-04-21")
    );
    expect(deal.bucket).toBe("attention");
    expect(deal.attentionReasons).toContain("Design approved — DA invoice not paid");
    expect(deal.isDesignApproved).toBe(true);
  });

  it("flags 'construction complete but CC not paid' as attention", () => {
    const deal = transformDeal(
      {
        ...BASE,
        is_construction_complete_: "true",
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Open",
      },
      new Date("2026-04-21")
    );
    expect(deal.attentionReasons).toContain("Construction complete — CC invoice not paid");
  });

  it("flags 'PTO granted but PTO not paid'", () => {
    const deal = transformDeal(
      {
        ...BASE,
        is_pto_granted_: "true",
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Paid In Full",
        pto_invoice_status: "Open",
      },
      new Date("2026-04-21")
    );
    expect(deal.attentionReasons).toContain("PTO granted — PTO invoice not paid");
  });

  it("flags 'inspection passed + PE approved M1' for PE deal", () => {
    const deal = transformDeal(
      {
        ...BASE,
        is_inspection_passed_: "true",
        pe_m1_status: "Approved",
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Paid In Full",
      },
      new Date("2026-04-21")
    );
    expect(deal.bucket).toBe("attention");
    expect(deal.attentionReasons).toContain("Inspection passed + PE approved M1 — M1 not paid");
  });

  it("does NOT fire PE M1 ready when PE M1 is just Submitted (not Approved)", () => {
    const deal = transformDeal(
      {
        ...BASE,
        is_inspection_passed_: "true",
        pe_m1_status: "Submitted",
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Paid In Full",
        pto_invoice_status: "Paid In Full",
      },
      new Date("2026-04-21")
    );
    expect(deal.attentionReasons).not.toContain("Inspection passed + PE approved M1 — M1 not paid");
  });

  it("does NOT fire when no triggers met (just plain awaiting_m1)", () => {
    const deal = transformDeal({ ...BASE, da_invoice_status: "Open" }, new Date("2026-03-15"));
    expect(deal.attentionReasons.length).toBe(0);
    expect(deal.bucket).toBe("awaiting_m1");
  });

  it("parses booleans correctly (true/false/missing)", () => {
    const a = transformDeal({ ...BASE, layout_approved: "true" }, new Date("2026-04-21"));
    expect(a.isDesignApproved).toBe(true);
    const b = transformDeal({ ...BASE, layout_approved: "false" }, new Date("2026-04-21"));
    expect(b.isDesignApproved).toBe(false);
    const c = transformDeal(BASE, new Date("2026-04-21"));
    expect(c.isDesignApproved).toBe(false);
  });
});

describe("computeBucket — disjointness", () => {
  it("first-match-wins — attention beats milestone buckets", () => {
    const bucket = computeBucket({
      daStatus: "Paid In Full",
      ccStatus: "Paid In Full",
      ptoStatus: "Open",
      peM1Status: "Rejected", // triggers attention
      peM2Status: null,
      closeDate: "2026-03-01T00:00:00Z",
      dealStage: "20440343",
      peM1ApprovalDate: null,
      isPE: true,
      asOf: new Date("2026-04-21"),
    });
    expect(bucket.bucket).toBe("attention");
  });
});
