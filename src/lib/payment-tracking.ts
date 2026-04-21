/**
 * Pure transformation + bucketing for the accounting payment-tracking page.
 * No I/O. All HubSpot field semantics documented here are validated against
 * live data on 2026-04-21 (see spec).
 */

import type {
  DaStatus,
  HubSpotDealPaymentProps,
  PaymentBucket,
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
}): { bucket: PaymentBucket; attentionReasons: string[] } {
  const reasons: string[] = [];
  const close = args.closeDate ? new Date(args.closeDate) : null;
  const daysSinceClose = close ? daysBetween(args.asOf, close) : 0;

  // Rule 1: attention
  if (args.peM1Status === "Rejected") reasons.push("PE M1 Rejected");
  if (args.peM2Status === "Rejected") reasons.push("PE M2 Rejected");
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
  // PE M1 Paid but PE M2 still pre-submit for >14 days
  if (
    args.isPE &&
    args.peM1Status === "Paid" &&
    (args.peM2Status === "Ready to Submit" ||
      args.peM2Status === "Waiting on Information")
  ) {
    const approval = args.peM1ApprovalDate ? new Date(args.peM1ApprovalDate) : null;
    if (approval && daysBetween(args.asOf, approval) > 14) {
      reasons.push("PE M1 Paid >14 days, M2 not submitted");
    }
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
  // Rule 4: customer side complete. PE buckets take precedence only if PE
  // progress is meaningful.
  if (args.ptoStatus !== "Paid In Full") {
    if (!args.isPE) return { bucket: "awaiting_pto", attentionReasons: [] };
    // PE deal with PE progress started → skip to PE buckets
    if (args.peM1Status && args.peM1Status !== "Ready to Submit") {
      // fall through to PE bucket
    } else {
      return { bucket: "awaiting_pto", attentionReasons: [] };
    }
  }
  // Rule 5/6: PE only
  if (args.isPE) {
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

  const customerCollected =
    (daStatus === "Paid In Full" ? daAmount ?? 0 : 0) +
    (ccStatus === "Paid In Full" ? ccAmount ?? 0 : 0);
  const customerOutstanding = Math.max(0, customerContractTotal - customerCollected);

  const peBonusTotal = isPE ? (peM1Amount ?? 0) + (peM2Amount ?? 0) : null;
  const peBonusCollected = isPE
    ? (peM1Status === "Paid" ? peM1Amount ?? 0 : 0) +
      (peM2Status === "Paid" ? peM2Amount ?? 0 : 0)
    : null;
  const peBonusOutstanding =
    peBonusTotal !== null && peBonusCollected !== null
      ? Math.max(0, peBonusTotal - peBonusCollected)
      : null;

  const totalPBRevenue = isPE
    ? parseNumber(props.pe_total_pb_revenue) ?? customerContractTotal + (peBonusTotal ?? 0)
    : customerContractTotal;

  const totalCollectable = customerContractTotal + (peBonusTotal ?? 0);
  const totalCollected = customerCollected + (peBonusCollected ?? 0);
  const collectedPct = totalCollectable > 0 ? (totalCollected / totalCollectable) * 100 : 0;

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
    attentionReasons,

    paidInFullFlag: parsePaidInFull(props.paid_in_full),

    hubspotUrl,
  };
}

export function computeSummary(deals: PaymentTrackingDeal[]): PaymentTrackingSummary {
  let customerContractTotal = 0;
  let customerCollected = 0;
  let peBonusTotal = 0;
  let peBonusCollected = 0;
  let totalPBRevenue = 0;

  for (const d of deals) {
    customerContractTotal += d.customerContractTotal;
    customerCollected += d.customerCollected;
    peBonusTotal += d.peBonusTotal ?? 0;
    peBonusCollected += d.peBonusCollected ?? 0;
    totalPBRevenue += d.totalPBRevenue;
  }

  const customerOutstanding = Math.max(0, customerContractTotal - customerCollected);
  const peBonusOutstanding = Math.max(0, peBonusTotal - peBonusCollected);
  const totalCollectable = customerContractTotal + peBonusTotal;
  const totalCollected = customerCollected + peBonusCollected;
  const collectedPct = totalCollectable > 0 ? (totalCollected / totalCollectable) * 100 : 0;

  return {
    customerContractTotal,
    customerCollected,
    customerOutstanding,
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
];
