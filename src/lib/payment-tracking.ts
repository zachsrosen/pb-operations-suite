/**
 * Pure transformation + bucketing for the accounting payment-tracking page.
 * No I/O. All HubSpot field semantics documented here are validated against
 * live data on 2026-04-21 (see spec).
 */

import type {
  DaStatus,
  HubSpotDealPaymentProps,
  PaymentBucket,
  PaymentStatusGroup,
  PaymentTrackingDeal,
  PaymentTrackingSummary,
  PeStatus,
} from "@/lib/payment-tracking-types";

const PORTAL_ID_ENV = process.env.HUBSPOT_PORTAL_ID ?? "";

const DA_STATUSES: ReadonlyArray<DaStatus> = [
  "Pending Approval",
  "Open",
  "Paid In Full",
];
const PE_STATUSES: ReadonlyArray<PeStatus> = [
  "Ready to Submit",
  "Waiting on Information",
  "Submitted",
  "Rejected",
  "Ready to Resubmit",
  "Resubmitted",
  "Approved",
  "Paid",
];

// Post-install stages per DEAL_STAGE_MAP in src/lib/hubspot.ts:
// Inspection (22580872), Permission To Operate (20461940),
// Close Out (24743347), Project Complete (20440343).
const POST_INSTALL_STAGES = new Set([
  "22580872",
  "20461940",
  "24743347",
  "20440343",
]);

function parseNumber(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseDaStatus(v: string | null | undefined): DaStatus | null {
  if (!v) return null;
  return (DA_STATUSES as readonly string[]).includes(v) ? (v as DaStatus) : null;
}

function parsePeStatus(v: string | null | undefined): PeStatus | null {
  if (!v) return null;
  return (PE_STATUSES as readonly string[]).includes(v) ? (v as PeStatus) : null;
}

function parsePaidInFull(v: string | null | undefined): boolean | null {
  if (v === null || v === undefined || v === "") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

/** HubSpot booleans come back as strings. Treat anything other than the
 *  literal "true" as false (incl. null/undefined/empty). */
function parseBool(v: string | null | undefined): boolean {
  return v === "true";
}

function daysBetween(a: Date, b: Date): number {
  const ms = Math.abs(a.getTime() - b.getTime());
  return ms / (1000 * 60 * 60 * 24);
}

/**
 * Bucketing core. Exported separately so tests can exercise it without a full
 * deal fixture, and so the transform can call it with derived fields.
 *
 * First-match-wins. Rule order:
 *   1. attention (rejected / overdue / stuck post-install / PE M1 paid >14d stuck)
 *   2. awaiting_m1 — DA not Paid In Full
 *   3. awaiting_m2 — DA paid, CC not Paid In Full
 *   4. awaiting_pto — DA + CC paid, PTO not Paid In Full (skipped for PE deals
 *      with meaningful PE progress so PE buckets take precedence)
 *   5. awaiting_pe_m1 — PE deal, customer side complete, PE M1 not Paid
 *   6. awaiting_pe_m2 — PE deal, customer side complete, PE M1 paid, PE M2 not Paid
 *   7. fully_collected — everything terminal
 */
export function computeBucket(args: {
  daStatus: DaStatus | null;
  ccStatus: DaStatus | null;
  ptoStatus: DaStatus | null;
  peM1Status: PeStatus | null;
  peM2Status: PeStatus | null;
  isPE: boolean;
  closeDate: string | null;
  dealStage: string | null;
  peM1ApprovalDate: string | null;
  asOf: Date;
  // Project-progress signals — used to flag "ready to invoice" attention.
  isDesignApproved?: boolean;
  isConstructionComplete?: boolean;
  isInspectionPassed?: boolean;
  isPtoGranted?: boolean;
}): { bucket: PaymentBucket; attentionReasons: string[] } {
  const reasons: string[] = [];
  const close = args.closeDate ? new Date(args.closeDate) : null;
  const daysSinceClose = close ? daysBetween(args.asOf, close) : 0;

  // Rule 1: attention. PE M1/M2 "Rejected" means PE rejected our DOCUMENTS
  // — that's an ops/turnover issue, NOT an accounting issue. Accounting
  // only cares about invoice paid/unpaid status. Skip those signals here.
  if (close && daysSinceClose > 30) {
    if (args.daStatus === "Open") reasons.push("DA Open >30 days past close");
    if (args.ccStatus === "Open") reasons.push("CC Open >30 days past close");
    if (args.ptoStatus === "Open") reasons.push("PTO Open >30 days past close");
  }
  // Post-install and CC not paid (not already covered by >30 day rule)
  if (
    args.dealStage &&
    POST_INSTALL_STAGES.has(args.dealStage) &&
    args.ccStatus !== "Paid In Full" &&
    args.daStatus === "Paid In Full" &&
    !reasons.some((r) => r.startsWith("CC Open"))
  ) {
    reasons.push("Post-install, CC not paid");
  }
  // (Removed: "PE M1 Paid >14 days, M2 not submitted" — that's an ops
  // workflow issue, not an accounting payment-collection concern.)

  // "Ready to invoice but not invoiced" — work milestone has been hit but
  // accounting hasn't issued the invoice yet (status not Paid In Full / Paid).
  // These are the most actionable signals on the page: someone needs to bill.
  if (args.isDesignApproved && args.daStatus !== "Paid In Full") {
    reasons.push("Design approved — DA invoice not paid");
  }
  if (args.isConstructionComplete && args.ccStatus !== "Paid In Full") {
    reasons.push("Construction complete — CC invoice not paid");
  }
  // PTO only applies to non-PE deals.
  if (!args.isPE && args.isPtoGranted && args.ptoStatus !== "Paid In Full") {
    reasons.push("PTO granted — PTO invoice not paid");
  }
  // PE statuses: "Approved" means PE has signed off on our docs but we
  // haven't been paid. "Paid" means money has arrived. Anything else is
  // upstream (Submitted / Resubmitted) so not yet ready to invoice.
  if (args.isPE && args.isInspectionPassed && args.peM1Status === "Approved") {
    reasons.push("Inspection passed + PE approved M1 — M1 not paid");
  }
  if (args.isPE && args.isPtoGranted && args.peM2Status === "Approved") {
    reasons.push("PTO granted + PE approved M2 — M2 not paid");
  }

  if (reasons.length > 0) return { bucket: "attention", attentionReasons: reasons };

  // Rule 2
  if (args.daStatus !== "Paid In Full") {
    return { bucket: "awaiting_m1", attentionReasons: [] };
  }
  // Rule 3
  if (args.ccStatus !== "Paid In Full") {
    return { bucket: "awaiting_m2", attentionReasons: [] };
  }
  // Rule 4: PTO closeout (NON-PE only). PE deals don't have a PTO milestone.
  if (!args.isPE) {
    if (args.ptoStatus !== "Paid In Full") {
      return { bucket: "awaiting_pto", attentionReasons: [] };
    }
  } else {
    // PE deals: customer side is complete after DA + CC. PE M1/M2 follow.
    if (args.peM1Status !== "Paid") {
      return { bucket: "awaiting_pe_m1", attentionReasons: [] };
    }
    if (args.peM2Status !== "Paid") {
      return { bucket: "awaiting_pe_m2", attentionReasons: [] };
    }
  }
  return { bucket: "fully_collected", attentionReasons: [] };
}

export function transformDeal(
  props: HubSpotDealPaymentProps,
  asOf: Date = new Date(),
  resolveStageLabel: (stageId: string) => string = (s) => s
): PaymentTrackingDeal {
  const dealId = props.hs_object_id ?? "";
  const customerContractTotal = parseNumber(props.amount) ?? 0;

  const daStatus = parseDaStatus(props.da_invoice_status);
  const daAmount = parseNumber(props.da_invoice_amount);
  const daPaidDate = props.da_invoice_paid || null;
  const daMemo = props.da_invoice_memo || null;

  const ccStatus = parseDaStatus(props.cc_invoice_status);
  const ccAmount = parseNumber(props.cc_invoice_amount);
  const ccPaidDate = props.cc_invoice_paid || null;

  const ptoStatus = parseDaStatus(props.pto_invoice_status);
  const ptoMemo = props.pto_invoice_memo || null;

  const peM1Status = parsePeStatus(props.pe_m1_status);
  const peM2Status = parsePeStatus(props.pe_m2_status);
  const peM1Amount = parseNumber(props.pe_payment_ic);
  const peM2Amount = parseNumber(props.pe_payment_pc);
  const peM1ApprovalDate = props.pe_m1_approval_date || null;
  const peM1RejectionDate = props.pe_m1_rejection_date || null;
  const peM2ApprovalDate = props.pe_m2_approval_date || null;
  const peM2RejectionDate = props.pe_m2_rejection_date || null;

  const isPE = peM1Status !== null || peM2Status !== null;

  const isDesignApproved = parseBool(props.layout_approved);
  const designApprovalDate = props.layout_approval_date || null;
  const isConstructionComplete = parseBool(props.is_construction_complete_);
  const constructionCompleteDate = props.construction_complete_date || null;
  const isInspectionPassed = parseBool(props.is_inspection_passed_);
  const inspectionPassedDate = props.inspections_completion_date || null;
  const isPtoGranted = parseBool(props.is_pto_granted_);
  const ptoGrantedDate = props.pto_completion_date || null;

  // ── Money model ──
  // deal.amount (customerContractTotal) is the TOTAL contract for both PE
  // and non-PE deals.
  //
  // Non-PE: customer pays 100% via DA + CC + PTO.
  // PE:     customer pays ~70% via DA + CC ONLY (PTO does NOT apply); PE
  //         program pays the other ~30% via PE M1 + PE M2.
  //
  // peBonus* fields are kept for backwards compat but represent PE's
  // PORTION of the deal, NOT additional revenue beyond the contract.
  // Customer-side starting point. PTO is added in reconcileMoneyWithInvoices
  // (non-PE only) when the invoice is attached — the deal property
  // `pto_invoice_amount` is almost always $0 so we don't read it here.
  const customerCollected =
    (daStatus === "Paid In Full" ? daAmount ?? 0 : 0) +
    (ccStatus === "Paid In Full" ? ccAmount ?? 0 : 0);

  const peBonusTotal = isPE ? (peM1Amount ?? 0) + (peM2Amount ?? 0) : null;
  const peBonusCollected = isPE
    ? (peM1Status === "Paid" ? peM1Amount ?? 0 : 0) +
      (peM2Status === "Paid" ? peM2Amount ?? 0 : 0)
    : null;

  // Initial outstanding values — invoice-aware values are filled in by
  // reconcileMoneyWithInvoices after invoice attachment. Pre-attach,
  // outstanding/notYetInvoiced default to "everything not collected" /
  // "everything not billed via deal-property amount".
  const totalCollected = customerCollected + (peBonusCollected ?? 0);
  const customerOutstanding = 0; // refilled by reconcileMoneyWithInvoices
  const peBonusOutstanding = isPE ? 0 : null;
  const notYetInvoiced = Math.max(0, customerContractTotal - totalCollected);

  // Total revenue PB receives = the deal contract. For PE deals this still
  // equals deal.amount because PE pays a portion (not extra) of the same
  // contract. Use pe_total_pb_revenue when present (HubSpot's own calc).
  const totalPBRevenue = isPE
    ? parseNumber(props.pe_total_pb_revenue) ?? customerContractTotal
    : customerContractTotal;

  const collectedPct =
    customerContractTotal > 0 ? (totalCollected / customerContractTotal) * 100 : 0;

  // Count applicable milestones for the status-group calc. PTO is non-PE only.
  const applicableMilestones: boolean[] = [
    daStatus === "Paid In Full",
    ccStatus === "Paid In Full",
  ];
  if (!isPE) {
    applicableMilestones.push(ptoStatus === "Paid In Full");
  } else {
    applicableMilestones.push(peM1Status === "Paid");
    applicableMilestones.push(peM2Status === "Paid");
  }
  const allPaid = applicableMilestones.every((p) => p);
  const somePaid = applicableMilestones.some((p) => p);
  const baseStatusGroup: PaymentStatusGroup = allPaid
    ? "fully_paid"
    : somePaid
    ? "partially_paid"
    : "not_started";

  const { bucket, attentionReasons } = computeBucket({
    daStatus,
    ccStatus,
    ptoStatus,
    peM1Status,
    peM2Status,
    isPE,
    closeDate: props.closedate ?? null,
    dealStage: props.dealstage ?? null,
    peM1ApprovalDate,
    asOf,
    isDesignApproved,
    isConstructionComplete,
    isInspectionPassed,
    isPtoGranted,
  });

  const hubspotUrl = PORTAL_ID_ENV
    ? `https://app.hubspot.com/contacts/${PORTAL_ID_ENV}/record/0-3/${dealId}`
    : `https://app.hubspot.com/contacts/_/record/0-3/${dealId}`;

  return {
    dealId,
    dealName: props.dealname ?? "(unnamed)",
    pbLocation: props.pb_location ?? "",
    dealStage: props.dealstage ?? "",
    dealStageLabel: resolveStageLabel(props.dealstage ?? ""),
    closeDate: props.closedate ?? null,
    isPE,

    customerContractTotal,
    customerCollected,
    customerOutstanding,
    notYetInvoiced,

    daStatus,
    daAmount,
    daPaidDate,
    daMemo,

    ccStatus,
    ccAmount,
    ccPaidDate,

    ptoStatus,
    ptoMemo,

    peM1Status,
    peM1Amount,
    peM1ApprovalDate,
    peM1RejectionDate,

    peM2Status,
    peM2Amount,
    peM2ApprovalDate,
    peM2RejectionDate,

    peBonusTotal,
    peBonusCollected,
    peBonusOutstanding,

    totalPBRevenue,
    collectedPct,
    bucket,
    // Top-level status group: attention always wins. Otherwise: if work
    // milestone is hit but nothing's paid, that's "ready to invoice".
    // Else: fully paid / partially paid / not started.
    statusGroup:
      attentionReasons.length > 0
        ? "issues"
        : !somePaid &&
          (isDesignApproved || isConstructionComplete || isPtoGranted || isInspectionPassed)
        ? "ready_to_invoice"
        : baseStatusGroup,
    attentionReasons,

    paidInFullFlag: parsePaidInFull(props.paid_in_full),

    isDesignApproved,
    designApprovalDate,
    isConstructionComplete,
    constructionCompleteDate,
    isInspectionPassed,
    inspectionPassedDate,
    isPtoGranted,
    ptoGrantedDate,

    hubspotUrl,
  };
}

export function computeSummary(deals: PaymentTrackingDeal[]): PaymentTrackingSummary {
  let customerContractTotal = 0;
  let customerCollected = 0;
  let customerOutstanding = 0;
  let notYetInvoiced = 0;
  let peBonusTotal = 0;
  let peBonusCollected = 0;
  let peBonusOutstanding = 0;
  let totalPBRevenue = 0;

  for (const d of deals) {
    customerContractTotal += d.customerContractTotal;
    customerCollected += d.customerCollected;
    customerOutstanding += d.customerOutstanding;
    notYetInvoiced += d.notYetInvoiced;
    peBonusTotal += d.peBonusTotal ?? 0;
    peBonusCollected += d.peBonusCollected ?? 0;
    peBonusOutstanding += d.peBonusOutstanding ?? 0;
    totalPBRevenue += d.totalPBRevenue;
  }

  const totalCollected = customerCollected + peBonusCollected;
  // % collected NOT capped — PE markup can legitimately push individual
  // deals above 100% and the user wants that visibility.
  const collectedPct =
    customerContractTotal > 0 ? (totalCollected / customerContractTotal) * 100 : 0;

  return {
    customerContractTotal,
    customerCollected,
    customerOutstanding,
    notYetInvoiced,
    peBonusTotal,
    peBonusCollected,
    peBonusOutstanding,
    totalPBRevenue,
    collectedPct,
    dealCount: deals.length,
  };
}

/** Property list used by the API route for batch-reads. */
export const PAYMENT_TRACKING_PROPERTIES: string[] = [
  "hs_object_id",
  "dealname",
  "amount",
  "pb_location",
  "dealstage",
  "closedate",
  "da_invoice_status",
  "da_invoice_amount",
  "da_invoice_paid",
  "da_invoice_memo",
  "cc_invoice_status",
  "cc_invoice_amount",
  "cc_invoice_paid",
  "pto_invoice_status",
  "pto_invoice_memo",
  "pe_m1_status",
  "pe_m2_status",
  "pe_payment_ic",
  "pe_payment_pc",
  "pe_m1_approval_date",
  "pe_m1_rejection_date",
  "pe_m1_submission_date",
  "pe_m2_approval_date",
  "pe_m2_rejection_date",
  "pe_m2_submission_date",
  "pe_total_pb_revenue",
  "paid_in_full",
  // Project-progress booleans + dates (drives ready-to-invoice attention).
  "layout_approved",
  "layout_approval_date",
  "is_construction_complete_",
  "construction_complete_date",
  "is_inspection_passed_",
  "inspections_completion_date",
  "is_pto_granted_",
  "pto_completion_date",
];
