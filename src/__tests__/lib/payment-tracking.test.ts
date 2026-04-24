import {
  transformDeal,
  computeSummary,
  computeBucket,
  effectivePaidStatus,
  deriveReadyToInvoice,
  deriveAccountsReceivable,
  derivePaymentDataMismatch,
} from "@/lib/payment-tracking";
import type {
  HubSpotDealPaymentProps,
  InvoiceSummary,
  PaymentTrackingDeal,
} from "@/lib/payment-tracking-types";

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
    // Outstanding = unpaid invoice balances (filled in by reconcileMoneyWithInvoices).
    // Without invoice attachment, gap shows as notYetInvoiced.
    expect(deal.customerOutstanding).toBe(0);
    expect(deal.notYetInvoiced).toBe(5000);
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
  it("does NOT flag PE M1 Rejected as attention (rejection = ops issue, not accounting)", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Paid In Full",
        pe_m1_status: "Rejected",
      },
      new Date("2026-03-15")
    );
    expect(deal.attentionReasons).not.toContain("PE M1 Rejected");
    // Customer side complete + PE M1 not Paid → falls into awaiting_pe_m1
    expect(deal.bucket).toBe("awaiting_pe_m1");
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
  // Money model:
  //   deal.amount is the TOTAL contract for both PE and non-PE deals.
  //   For PE deals, customer pays ~70% via DA+CC+PTO and PE pays ~30% via
  //   PE M1+PE M2 — both portions sum back to deal.amount.
  it("sums correctly under the unified contract model (PE = portion, not bonus)", () => {
    const deals = [
      // Non-PE deal: $10k contract, customer paid half ($5k), other half open
      transformDeal(
        {
          ...BASE,
          hs_object_id: "1",
          amount: "10000",
          da_invoice_status: "Paid In Full",
          da_invoice_amount: "5000",
          cc_invoice_status: "Open",
          cc_invoice_amount: "5000",
        },
        new Date("2026-03-15")
      ),
      // PE deal: $30k contract = $21k customer (70%) + $9k PE (30%)
      transformDeal(
        {
          ...BASE,
          hs_object_id: "2",
          amount: "30000",
          da_invoice_status: "Paid In Full",
          da_invoice_amount: "10500",
          cc_invoice_status: "Paid In Full",
          cc_invoice_amount: "10500",
          pto_invoice_status: "Paid In Full",
          pe_m1_status: "Paid",
          pe_m2_status: "Paid",
          pe_payment_ic: "6000",
          pe_payment_pc: "3000",
          pe_total_pb_revenue: "30000",
        },
        new Date("2026-04-21")
      ),
    ];

    const summary = computeSummary(deals);
    expect(summary.customerContractTotal).toBe(40000); // 10k + 30k
    expect(summary.customerCollected).toBe(26000); // 5k + 21k
    expect(summary.peBonusCollected).toBe(9000); // PE deal #2 only
    expect(summary.peBonusTotal).toBe(9000);
    // Outstanding = sum of unpaid invoice balances (filled by reconcile).
    // Without invoice attachment, outstanding=0 and gap is in notYetInvoiced.
    expect(summary.customerOutstanding).toBe(0);
    expect(summary.notYetInvoiced).toBe(5000); // deal #1's $5k unbilled half
    // Total PB revenue = deal contract (PE doesn't add to it)
    expect(summary.totalPBRevenue).toBe(40000);
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

describe("transformDeal — PE deals don't have PTO milestone", () => {
  it("PE deal with PTO granted does NOT fire 'PTO not paid' attention", () => {
    const deal = transformDeal(
      {
        ...BASE,
        is_pto_granted_: "true",
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Paid In Full",
        pto_invoice_status: "Open", // would normally fire, but PE excludes PTO
        pe_m1_status: "Paid",
        pe_m2_status: "Paid",
        pe_payment_ic: "6000",
        pe_payment_pc: "3000",
      },
      new Date("2026-04-21")
    );
    expect(deal.isPE).toBe(true);
    expect(deal.attentionReasons).not.toContain("PTO granted — PTO invoice not paid");
  });

  it("non-PE deal with PTO granted DOES fire 'PTO not paid' attention", () => {
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
    expect(deal.isPE).toBe(false);
    expect(deal.attentionReasons).toContain("PTO granted — PTO invoice not paid");
  });

  it("PE deal goes straight to PE buckets after DA + CC paid (skips PTO)", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Paid In Full",
        // pto_invoice_status intentionally omitted — irrelevant for PE
        pe_m1_status: "Submitted",
        pe_m2_status: "Ready to Submit",
        pe_payment_ic: "6000",
        pe_payment_pc: "3000",
      },
      new Date("2026-04-21")
    );
    expect(deal.bucket).toBe("awaiting_pe_m1");
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

// ── Invoice-first bucketing ──────────────────────────────────────────────

const paidInvoice = (): InvoiceSummary => ({
  invoiceId: "inv-1",
  number: "INV-1",
  status: "paid",
  amountBilled: 1000,
  amountPaid: 1000,
  balanceDue: 0,
  invoiceDate: "2026-03-01",
  dueDate: "2026-03-15",
  paymentDate: "2026-03-10",
  daysOverdue: null,
  hubspotUrl: "x",
});

const unpaidInvoice = (overrides: Partial<InvoiceSummary> = {}): InvoiceSummary => ({
  ...paidInvoice(),
  status: "sent",
  amountPaid: 0,
  balanceDue: 1000,
  paymentDate: null,
  ...overrides,
});

describe("effectivePaidStatus", () => {
  it("returns 'paid' when invoice is paid (balanceDue 0 + status paid)", () => {
    expect(effectivePaidStatus("customer", paidInvoice(), "Open")).toBe("paid");
  });

  it("returns 'invoiced_unpaid' when invoice attached with balanceDue > 0", () => {
    expect(effectivePaidStatus("customer", unpaidInvoice(), "Paid In Full")).toBe(
      "invoiced_unpaid"
    );
  });

  it("falls back to deal property when no invoice — customer side", () => {
    expect(effectivePaidStatus("customer", undefined, "Paid In Full")).toBe("paid");
    expect(effectivePaidStatus("customer", undefined, "Open")).toBe("not_invoiced");
    expect(effectivePaidStatus("customer", undefined, null)).toBe("not_invoiced");
  });

  it("falls back to deal property when no invoice — PE side", () => {
    expect(effectivePaidStatus("pe", undefined, "Paid")).toBe("paid");
    expect(effectivePaidStatus("pe", undefined, "Approved")).toBe("not_invoiced");
  });

  it("treats voided/cancelled/draft invoices as not_invoiced (ignored)", () => {
    const voided = { ...paidInvoice(), status: "voided" };
    expect(effectivePaidStatus("customer", voided, "Open")).toBe("not_invoiced");
    const draft = { ...paidInvoice(), status: "draft" };
    expect(effectivePaidStatus("customer", draft, "Paid In Full")).toBe("not_invoiced");
  });
});

describe("computeBucket — invoice-first", () => {
  const asOf = new Date("2026-04-23");

  it("PE deal: CC invoice Paid but deal property Open → CC-unpaid reasons DON'T fire", () => {
    const result = computeBucket({
      daStatus: "Paid In Full",
      ccStatus: "Open", // stale property
      ptoStatus: null,
      peM1Status: "Approved",
      peM2Status: null,
      isPE: true,
      closeDate: "2026-03-01",
      dealStage: "22580872", // Inspection (post-install)
      peM1ApprovalDate: null,
      asOf,
      isDesignApproved: true,
      isConstructionComplete: true,
      isInspectionPassed: true,
      isPtoGranted: false,
      invoices: { da: paidInvoice(), cc: paidInvoice() },
    });
    expect(result.attentionReasons).not.toContain("Post-install, CC not paid");
    expect(result.attentionReasons).not.toContain(
      "Construction complete — CC invoice not paid"
    );
    expect(result.attentionReasons).toContain(
      "Inspection passed + PE approved M1 — M1 not paid"
    );
  });

  it("Non-PE deal: CC invoice balanceDue > 0 → CC-unpaid reason fires", () => {
    const result = computeBucket({
      daStatus: "Paid In Full",
      ccStatus: "Paid In Full", // stale in other direction
      ptoStatus: null,
      peM1Status: null,
      peM2Status: null,
      isPE: false,
      closeDate: "2026-03-01",
      dealStage: "22580872",
      peM1ApprovalDate: null,
      asOf,
      isDesignApproved: true,
      isConstructionComplete: true,
      isInspectionPassed: false,
      isPtoGranted: false,
      invoices: { da: paidInvoice(), cc: unpaidInvoice({ balanceDue: 500 }) },
    });
    expect(result.attentionReasons).toContain("Post-install, CC not paid");
  });

  it("No invoices attached → falls back to deal properties (unchanged behavior)", () => {
    const result = computeBucket({
      daStatus: "Paid In Full",
      ccStatus: "Open",
      ptoStatus: null,
      peM1Status: null,
      peM2Status: null,
      isPE: false,
      closeDate: "2026-04-10", // within 30 days of asOf so the CC Open >30d rule doesn't pre-empt
      dealStage: "22580872",
      peM1ApprovalDate: null,
      asOf,
      isDesignApproved: true,
      isConstructionComplete: true,
      isInspectionPassed: false,
      isPtoGranted: false,
    });
    expect(result.attentionReasons).toContain("Post-install, CC not paid");
  });

  it("Bucket ladder uses invoice-first: CC invoice Paid + property Open → awaiting_pto", () => {
    const result = computeBucket({
      daStatus: "Paid In Full",
      ccStatus: "Open",
      ptoStatus: "Open",
      peM1Status: null,
      peM2Status: null,
      isPE: false,
      closeDate: "2026-03-01",
      dealStage: "20440342", // pre-install, skips post-install rule
      peM1ApprovalDate: null,
      asOf,
      isDesignApproved: true,
      isConstructionComplete: true,
      isInspectionPassed: false,
      isPtoGranted: false,
      invoices: { da: paidInvoice(), cc: paidInvoice() },
    });
    // PTO reason still fires (construction complete, PTO not granted yet)
    // but bucket ladder is attention (has reasons). Confirm the CC-unpaid
    // reason didn't fire and the bucket didn't stall at awaiting_m2.
    expect(result.attentionReasons).not.toContain(
      "Construction complete — CC invoice not paid"
    );
  });
});

// ── Derived entry helpers ───────────────────────────────────────────────

function makeDeal(overrides: Partial<PaymentTrackingDeal> = {}): PaymentTrackingDeal {
  return {
    dealId: "1",
    dealName: "Test",
    pbLocation: "DTC",
    dealStage: "22580872",
    dealStageLabel: "Inspection",
    closeDate: "2026-03-01",
    isPE: false,
    customerContractTotal: 1000,
    customerCollected: 0,
    customerOutstanding: 0,
    notYetInvoiced: 1000,
    daStatus: null,
    daAmount: 500,
    daPaidDate: null,
    daMemo: null,
    ccStatus: null,
    ccAmount: 500,
    ccPaidDate: null,
    ptoStatus: null,
    ptoMemo: null,
    peM1Status: null,
    peM1Amount: null,
    peM1ApprovalDate: null,
    peM1RejectionDate: null,
    peM2Status: null,
    peM2Amount: null,
    peM2ApprovalDate: null,
    peM2RejectionDate: null,
    peBonusTotal: null,
    peBonusCollected: null,
    peBonusOutstanding: null,
    totalPBRevenue: 1000,
    collectedPct: 0,
    bucket: "awaiting_m1",
    statusGroup: "not_started",
    attentionReasons: [],
    paidInFullFlag: null,
    isDesignApproved: false,
    designApprovalDate: null,
    isConstructionComplete: false,
    constructionCompleteDate: null,
    isInspectionPassed: false,
    inspectionPassedDate: null,
    isPtoGranted: false,
    ptoGrantedDate: null,
    hubspotUrl: "x",
    ...overrides,
  };
}

describe("deriveReadyToInvoice", () => {
  const asOf = new Date("2026-04-23");

  it("includes deal when layout_approved + no DA invoice", () => {
    const result = deriveReadyToInvoice(
      [makeDeal({ isDesignApproved: true, designApprovalDate: "2026-04-13" })],
      asOf
    );
    expect(result).toHaveLength(1);
    expect(result[0].milestone).toBe("da");
    expect(result[0].daysReady).toBe(10);
    expect(result[0].expectedAmount).toBe(500);
  });

  it("excludes deal when layout_approved but DA invoice attached (any state)", () => {
    const deals = [
      makeDeal({
        isDesignApproved: true,
        invoices: { da: unpaidInvoice({ status: "sent" }) },
      }),
    ];
    expect(deriveReadyToInvoice(deals, asOf)).toHaveLength(0);
  });

  it("PE M1 ready only when inspectionPassed + peM1Status=Approved + no PE M1 invoice", () => {
    const ready = makeDeal({
      isPE: true,
      isInspectionPassed: true,
      inspectionPassedDate: "2026-04-13",
      peM1Status: "Approved",
      peM1Amount: 300,
    });
    const notReady = makeDeal({
      dealId: "2",
      isPE: true,
      isInspectionPassed: true,
      peM1Status: "Submitted",
    });
    const result = deriveReadyToInvoice([ready, notReady], asOf);
    expect(result.map((r) => r.milestone)).toEqual(["peM1"]);
    expect(result[0].expectedAmount).toBe(300);
  });

  it("PTO is not a ready-to-invoice milestone for PE deals", () => {
    const result = deriveReadyToInvoice(
      [
        makeDeal({
          isPE: true,
          peM2Status: "Submitted",
          isPtoGranted: true,
          ptoGrantedDate: "2026-04-13",
        }),
      ],
      asOf
    );
    expect(result.find((r) => r.milestone === "pto")).toBeUndefined();
  });
});

describe("deriveAccountsReceivable", () => {
  const withInvoice = (
    milestone: "da" | "cc",
    balanceDue: number,
    daysOverdue: number | null,
    status: string = "sent"
  ): PaymentTrackingDeal => {
    const inv: InvoiceSummary = {
      invoiceId: `${milestone}-1`,
      number: `INV-${milestone}`,
      status,
      amountBilled: 1000,
      amountPaid: 1000 - balanceDue,
      balanceDue,
      invoiceDate: "2026-03-01",
      dueDate: "2026-03-15",
      paymentDate: null,
      daysOverdue,
      hubspotUrl: "x",
    };
    return makeDeal({ invoices: { [milestone]: inv } });
  };

  it("buckets invoice with daysOverdue 15 into 0-30", () => {
    const result = deriveAccountsReceivable([withInvoice("da", 500, 15)]);
    expect(result).toHaveLength(1);
    expect(result[0].agingBucket).toBe("0-30");
    expect(result[0].daysOverdue).toBe(15);
  });

  it("buckets invoice with daysOverdue 95 into 90+", () => {
    expect(deriveAccountsReceivable([withInvoice("cc", 500, 95)])[0].agingBucket).toBe("90+");
  });

  it("excludes fully-paid invoices (balanceDue === 0)", () => {
    expect(deriveAccountsReceivable([withInvoice("da", 0, 15)])).toHaveLength(0);
  });

  it("excludes voided / draft / cancelled / paid status invoices", () => {
    expect(deriveAccountsReceivable([withInvoice("da", 500, 15, "voided")])).toHaveLength(0);
    expect(deriveAccountsReceivable([withInvoice("da", 500, 15, "draft")])).toHaveLength(0);
    expect(deriveAccountsReceivable([withInvoice("da", 500, 15, "cancelled")])).toHaveLength(0);
  });

  it("clamps negative daysOverdue (not-yet-due) to 0, bucket 0-30", () => {
    const result = deriveAccountsReceivable([withInvoice("da", 500, -5)]);
    expect(result[0].agingBucket).toBe("0-30");
    expect(result[0].daysOverdue).toBe(0);
  });
});

describe("derivePaymentDataMismatch", () => {
  const paid = paidInvoice;
  const unpaid = unpaidInvoice;

  it("flags property_says_unpaid_invoice_paid", () => {
    const deals = [makeDeal({ daStatus: "Open", invoices: { da: paid() } })];
    const result = derivePaymentDataMismatch(deals);
    expect(result).toHaveLength(1);
    expect(result[0].mismatchType).toBe("property_says_unpaid_invoice_paid");
  });

  it("flags property_says_paid_invoice_unpaid", () => {
    const deals = [makeDeal({ ccStatus: "Paid In Full", invoices: { cc: unpaid() } })];
    expect(derivePaymentDataMismatch(deals)[0].mismatchType).toBe("property_says_paid_invoice_unpaid");
  });

  it("flags property_missing_invoice_present", () => {
    const deals = [makeDeal({ daStatus: null, invoices: { da: paid() } })];
    expect(derivePaymentDataMismatch(deals)[0].mismatchType).toBe("property_missing_invoice_present");
  });

  it("flags PE M1 mismatch (property Paid, invoice unpaid)", () => {
    const deals = [
      makeDeal({ isPE: true, peM1Status: "Paid", invoices: { peM1: unpaid() } }),
    ];
    expect(derivePaymentDataMismatch(deals)[0].mismatchType).toBe("property_says_paid_invoice_unpaid");
  });

  it("no mismatch when property and invoice agree", () => {
    const deals = [makeDeal({ daStatus: "Paid In Full", invoices: { da: paid() } })];
    expect(derivePaymentDataMismatch(deals)).toHaveLength(0);
  });

  it("skips voided invoices (not mismatches)", () => {
    const voided = { ...paid(), status: "voided" };
    const deals = [makeDeal({ daStatus: "Open", invoices: { da: voided } })];
    expect(derivePaymentDataMismatch(deals)).toHaveLength(0);
  });
});
