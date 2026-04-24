/**
 * Pure transformation + bucketing for the accounting payment-tracking page.
 * No I/O. All HubSpot field semantics documented here are validated against
 * live data on 2026-04-21 (see spec).
 */

import type {
  AccountsReceivableEntry,
  AgingBucket,
  DaStatus,
  HubSpotDealPaymentProps,
  InvoiceSummary,
  Milestone,
  MismatchType,
  PaymentBucket,
  PaymentDataMismatchEntry,
  PaymentStatusGroup,
  PaymentTrackingDeal,
  PaymentTrackingSummary,
  PeStatus,
  ReadyToInvoiceEntry,
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

/** Effective paid status for a milestone — invoice-first, deal-property fallback.
 *
 * "customer" milestones use DA/CC/PTO status enum ("Paid In Full").
 * "pe" milestones use PE status enum ("Paid").
 *
 * Returns:
 *   "paid"            — invoice.balanceDue === 0 AND invoice.status indicates paid,
 *                       OR no invoice + deal property says paid
 *   "invoiced_unpaid" — invoice attached, balanceDue > 0, status active
 *   "not_invoiced"    — no invoice AND deal property does not say paid,
 *                       OR invoice attached with voided/cancelled/draft status
 */
export type EffectivePaidStatus = "paid" | "invoiced_unpaid" | "not_invoiced";

export const PAID_INVOICE_STATUSES = new Set(["paid"]);
export const IGNORED_INVOICE_STATUSES = new Set(["voided", "cancelled", "draft"]);

export function effectivePaidStatus(
  side: "customer" | "pe",
  invoice: InvoiceSummary | undefined,
  propertyStatus: string | null
): EffectivePaidStatus {
  if (invoice) {
    const status = (invoice.status ?? "").toLowerCase();
    if (IGNORED_INVOICE_STATUSES.has(status)) return "not_invoiced";
    if (invoice.balanceDue === 0 && PAID_INVOICE_STATUSES.has(status)) return "paid";
    return "invoiced_unpaid";
  }
  if (side === "customer") {
    return propertyStatus === "Paid In Full" ? "paid" : "not_invoiced";
  }
  return propertyStatus === "Paid" ? "paid" : "not_invoiced";
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
  // Attached invoice records — invoice-first bucketing. Falls back to deal
  // property when a milestone has no invoice attached.
  invoices?: PaymentTrackingDeal["invoices"];
}): { bucket: PaymentBucket; attentionReasons: string[] } {
  const reasons: string[] = [];
  const close = args.closeDate ? new Date(args.closeDate) : null;
  const daysSinceClose = close ? daysBetween(args.asOf, close) : 0;

  // Invoice-first effective statuses (falls back to deal property when no invoice).
  const daEff = effectivePaidStatus("customer", args.invoices?.da, args.daStatus);
  const ccEff = effectivePaidStatus("customer", args.invoices?.cc, args.ccStatus);
  const ptoEff = effectivePaidStatus("customer", args.invoices?.pto, args.ptoStatus);
  const peM1Eff = effectivePaidStatus("pe", args.invoices?.peM1, args.peM1Status);
  const peM2Eff = effectivePaidStatus("pe", args.invoices?.peM2, args.peM2Status);

  // Rule 1: attention. PE M1/M2 "Rejected" means PE rejected our DOCUMENTS
  // — that's an ops/turnover issue, NOT an accounting issue. Accounting
  // only cares about invoice paid/unpaid status. Skip those signals here.
  if (close && daysSinceClose > 30) {
    if (daEff !== "paid" && args.daStatus === "Open") reasons.push("DA Open >30 days past close");
    if (ccEff !== "paid" && args.ccStatus === "Open") reasons.push("CC Open >30 days past close");
    if (ptoEff !== "paid" && args.ptoStatus === "Open") reasons.push("PTO Open >30 days past close");
  }
  // Post-install and CC not paid (not already covered by >30 day rule)
  if (
    args.dealStage &&
    POST_INSTALL_STAGES.has(args.dealStage) &&
    ccEff !== "paid" &&
    daEff === "paid" &&
    !reasons.some((r) => r.startsWith("CC Open"))
  ) {
    reasons.push("Post-install, CC not paid");
  }

  // "Ready to invoice but not invoiced" — work milestone has been hit but
  // accounting hasn't issued the invoice yet.
  if (args.isDesignApproved && daEff !== "paid") {
    reasons.push("Design approved — DA invoice not paid");
  }
  if (args.isConstructionComplete && ccEff !== "paid") {
    reasons.push("Construction complete — CC invoice not paid");
  }
  // PTO only applies to non-PE deals.
  if (!args.isPE && args.isPtoGranted && ptoEff !== "paid") {
    reasons.push("PTO granted — PTO invoice not paid");
  }
  // PE statuses: "Approved" means PE has signed off on our docs but we
  // haven't been paid. "Paid" means money has arrived. Anything else is
  // upstream (Submitted / Resubmitted) so not yet ready to invoice.
  if (args.isPE && args.isInspectionPassed && args.peM1Status === "Approved" && peM1Eff !== "paid") {
    reasons.push("Inspection passed + PE approved M1 — M1 not paid");
  }
  if (args.isPE && args.isPtoGranted && args.peM2Status === "Approved" && peM2Eff !== "paid") {
    reasons.push("PTO granted + PE approved M2 — M2 not paid");
  }

  if (reasons.length > 0) return { bucket: "attention", attentionReasons: reasons };

  // Bucket ladder — invoice-first.
  if (daEff !== "paid") return { bucket: "awaiting_m1", attentionReasons: [] };
  if (ccEff !== "paid") return { bucket: "awaiting_m2", attentionReasons: [] };
  if (!args.isPE) {
    if (ptoEff !== "paid") return { bucket: "awaiting_pto", attentionReasons: [] };
  } else {
    if (peM1Eff !== "paid") return { bucket: "awaiting_pe_m1", attentionReasons: [] };
    if (peM2Eff !== "paid") return { bucket: "awaiting_pe_m2", attentionReasons: [] };
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

// ── Derived entry helpers ─────────────────────────────────────────────────

function daysBetweenDates(a: Date, b: string | null): number | null {
  if (!b) return null;
  const bd = new Date(b);
  if (!Number.isFinite(bd.getTime())) return null;
  return Math.floor((a.getTime() - bd.getTime()) / 86_400_000);
}

function entryBase(deal: PaymentTrackingDeal) {
  return {
    dealId: deal.dealId,
    dealName: deal.dealName,
    pbLocation: deal.pbLocation,
    isPE: deal.isPE,
    hubspotUrl: deal.hubspotUrl,
  };
}

/**
 * Derive "Ready to Invoice" entries — milestones whose work trigger is met,
 * NOT already marked paid on the deal property, AND no invoice attached yet.
 *
 * PE deals do NOT include PTO (PE pays via M1/M2 instead).
 * PE M1/M2 require `pe_m?_status ∈ {Approved, Paid}` — a Submitted/Rejected
 * milestone is an ops issue, not an accounting-ready-to-invoice signal.
 * If PE M1/M2 is already "Paid" on the deal property without an invoice,
 * that's a data-quality issue (surfaces in derivePaymentDataMismatch), not a
 * ready-to-invoice signal.
 */
export function deriveReadyToInvoice(
  deals: PaymentTrackingDeal[],
  asOf: Date = new Date()
): ReadyToInvoiceEntry[] {
  const out: ReadyToInvoiceEntry[] = [];
  for (const deal of deals) {
    const base = {
      ...entryBase(deal),
      dealStage: deal.dealStage,
      dealStageLabel: deal.dealStageLabel,
    };
    if (
      deal.isDesignApproved &&
      !deal.invoices?.da &&
      deal.daStatus !== "Paid In Full"
    ) {
      out.push({
        ...base,
        milestone: "da",
        triggerDate: deal.designApprovalDate,
        daysReady: daysBetweenDates(asOf, deal.designApprovalDate),
        expectedAmount: deal.daAmount,
      });
    }
    if (
      deal.isConstructionComplete &&
      !deal.invoices?.cc &&
      deal.ccStatus !== "Paid In Full"
    ) {
      out.push({
        ...base,
        milestone: "cc",
        triggerDate: deal.constructionCompleteDate,
        daysReady: daysBetweenDates(asOf, deal.constructionCompleteDate),
        expectedAmount: deal.ccAmount,
      });
    }
    if (
      !deal.isPE &&
      deal.isPtoGranted &&
      !deal.invoices?.pto &&
      deal.ptoStatus !== "Paid In Full"
    ) {
      out.push({
        ...base,
        milestone: "pto",
        triggerDate: deal.ptoGrantedDate,
        daysReady: daysBetweenDates(asOf, deal.ptoGrantedDate),
        expectedAmount: null, // PTO invoice amount is typically $0
      });
    }
    if (
      deal.isPE &&
      deal.isInspectionPassed &&
      deal.peM1Status === "Approved" && // Paid excluded — that's not "ready to invoice"
      !deal.invoices?.peM1
    ) {
      out.push({
        ...base,
        milestone: "peM1",
        triggerDate: deal.inspectionPassedDate,
        daysReady: daysBetweenDates(asOf, deal.inspectionPassedDate),
        expectedAmount: deal.peM1Amount,
      });
    }
    if (
      deal.isPE &&
      deal.isPtoGranted &&
      deal.peM2Status === "Approved" &&
      !deal.invoices?.peM2
    ) {
      out.push({
        ...base,
        milestone: "peM2",
        triggerDate: deal.ptoGrantedDate,
        daysReady: daysBetweenDates(asOf, deal.ptoGrantedDate),
        expectedAmount: deal.peM2Amount,
      });
    }
  }
  return out;
}

function computeAgingBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue >= 90) return "90+";
  if (daysOverdue >= 61) return "61-90";
  if (daysOverdue >= 31) return "31-60";
  return "0-30";
}

const AR_IGNORE_STATUSES = new Set(["draft", "voided", "cancelled", "paid"]);

/**
 * Derive Accounts Receivable entries — invoices attached with balanceDue > 0
 * and status not in {draft, voided, cancelled, paid}. Grouped by aging
 * bucket via `hs_days_overdue` (clamped to 0 for not-yet-due invoices).
 */
export function deriveAccountsReceivable(
  deals: PaymentTrackingDeal[]
): AccountsReceivableEntry[] {
  const out: AccountsReceivableEntry[] = [];
  const milestones: Milestone[] = ["da", "cc", "pto", "peM1", "peM2"];
  for (const deal of deals) {
    if (!deal.invoices) continue;
    for (const m of milestones) {
      const inv = deal.invoices[m];
      if (!inv) continue;
      if ((inv.balanceDue ?? 0) <= 0) continue;
      const status = (inv.status ?? "").toLowerCase();
      if (AR_IGNORE_STATUSES.has(status)) continue;
      const daysOverdue = Math.max(0, inv.daysOverdue ?? 0);
      out.push({
        ...entryBase(deal),
        milestone: m,
        invoice: inv,
        agingBucket: computeAgingBucket(daysOverdue),
        daysOverdue,
      });
    }
  }
  return out;
}

/**
 * Derive payment-data mismatches — deals where the deal-property status
 * disagrees with the attached invoice record. Diagnostic; no business logic.
 */
export function derivePaymentDataMismatch(
  deals: PaymentTrackingDeal[]
): PaymentDataMismatchEntry[] {
  const out: PaymentDataMismatchEntry[] = [];
  const customerChecks: Array<{ m: Milestone; prop: "daStatus" | "ccStatus" | "ptoStatus" }> = [
    { m: "da", prop: "daStatus" },
    { m: "cc", prop: "ccStatus" },
    { m: "pto", prop: "ptoStatus" },
  ];
  const peChecks: Array<{ m: Milestone; prop: "peM1Status" | "peM2Status" }> = [
    { m: "peM1", prop: "peM1Status" },
    { m: "peM2", prop: "peM2Status" },
  ];

  const classify = (
    deal: PaymentTrackingDeal,
    milestone: Milestone,
    side: "customer" | "pe",
    propertyStatus: string | null
  ) => {
    const inv = deal.invoices?.[milestone];
    if (!inv) return;
    const status = (inv.status ?? "").toLowerCase();
    if (IGNORED_INVOICE_STATUSES.has(status)) return;
    const invPaid = inv.balanceDue === 0 && PAID_INVOICE_STATUSES.has(status);
    const propPaid =
      side === "customer" ? propertyStatus === "Paid In Full" : propertyStatus === "Paid";

    let type: MismatchType | null = null;
    if (!propertyStatus && invPaid) type = "property_missing_invoice_present";
    else if (!propPaid && invPaid) type = "property_says_unpaid_invoice_paid";
    else if (propPaid && !invPaid) type = "property_says_paid_invoice_unpaid";

    if (type) {
      out.push({
        ...entryBase(deal),
        milestone,
        mismatchType: type,
        dealPropertyStatus: propertyStatus,
        invoice: inv,
      });
    }
  };

  for (const deal of deals) {
    for (const { m, prop } of customerChecks) classify(deal, m, "customer", deal[prop]);
    for (const { m, prop } of peChecks) classify(deal, m, "pe", deal[prop]);
  }
  return out;
}
