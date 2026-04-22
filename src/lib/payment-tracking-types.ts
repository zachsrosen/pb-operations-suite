/**
 * Payment tracking domain types — shared by the API route, client page, and
 * pure transformation functions in payment-tracking.ts.
 *
 * See spec: docs/superpowers/specs/2026-04-21-payment-tracking-page-design.md
 */

export type DaStatus = "Pending Approval" | "Open" | "Paid In Full";
export type CcStatus = DaStatus;
export type PtoStatus = DaStatus;

export type PeStatus =
  | "Ready to Submit"
  | "Waiting on Information"
  | "Submitted"
  | "Rejected"
  | "Ready to Resubmit"
  | "Resubmitted"
  | "Approved"
  | "Paid";

export type PaymentBucket =
  | "attention"
  | "awaiting_m1"
  | "awaiting_m2"
  | "awaiting_pto"
  | "awaiting_pe_m1"
  | "awaiting_pe_m2"
  | "fully_collected";

export interface PaymentTrackingDeal {
  dealId: string;
  dealName: string;
  pbLocation: string;
  dealStage: string;
  dealStageLabel: string;
  closeDate: string | null;
  isPE: boolean;

  customerContractTotal: number;
  customerCollected: number;
  customerOutstanding: number;

  daStatus: DaStatus | null;
  daAmount: number | null;
  daPaidDate: string | null;
  daMemo: string | null;

  ccStatus: CcStatus | null;
  ccAmount: number | null;
  ccPaidDate: string | null;

  // PTO is status-only in v1; amount is always $0 so the column is omitted.
  ptoStatus: PtoStatus | null;
  ptoMemo: string | null;

  peM1Status: PeStatus | null;
  peM1Amount: number | null;
  peM1ApprovalDate: string | null;
  peM1RejectionDate: string | null;

  peM2Status: PeStatus | null;
  peM2Amount: number | null;
  peM2ApprovalDate: string | null;
  peM2RejectionDate: string | null;

  peBonusTotal: number | null;
  peBonusCollected: number | null;
  peBonusOutstanding: number | null;

  totalPBRevenue: number;
  collectedPct: number;
  bucket: PaymentBucket;
  attentionReasons: string[];

  /** HubSpot `paid_in_full` string property, parsed. Display-only — not used for bucketing. */
  paidInFullFlag: boolean | null;

  // Project-progress booleans + dates. Used to compute "ready to invoice"
  // attention signals for each milestone:
  //   - DA  ready when isDesignApproved
  //   - CC  ready when isConstructionComplete
  //   - PTO ready when isPtoGranted
  //   - PE M1 ready when isInspectionPassed AND peM1Status === "Approved"
  //   - PE M2 ready when isPtoGranted AND peM2Status === "Approved"
  isDesignApproved: boolean;
  designApprovalDate: string | null;
  isConstructionComplete: boolean;
  constructionCompleteDate: string | null;
  isInspectionPassed: boolean;
  inspectionPassedDate: string | null;
  isPtoGranted: boolean;
  ptoGrantedDate: string | null;

  hubspotUrl: string;

  /** Invoice records associated with this deal, keyed by milestone. Undefined
   *  when the deal has no associated invoice records yet (older deals or
   *  pre-invoice phase). */
  invoices?: {
    da?: InvoiceSummary;
    cc?: InvoiceSummary;
    pto?: InvoiceSummary;
    peM1?: InvoiceSummary;
    peM2?: InvoiceSummary;
  };
}

/** Summary of a HubSpot invoice associated with a deal milestone. */
export interface InvoiceSummary {
  invoiceId: string;
  number: string | null; // hs_number, e.g. "INV-00010737"
  status: string | null; // hs_invoice_status: paid / sent / draft / voided / etc.
  amountBilled: number | null;
  amountPaid: number | null;
  balanceDue: number | null;
  invoiceDate: string | null; // ISO date
  dueDate: string | null;
  paymentDate: string | null;
  daysOverdue: number | null;
  hubspotUrl: string;
}

export interface PaymentTrackingSummary {
  customerContractTotal: number;
  customerCollected: number;
  customerOutstanding: number;
  peBonusTotal: number;
  peBonusCollected: number;
  peBonusOutstanding: number;
  totalPBRevenue: number;
  collectedPct: number;
  dealCount: number;
}

export interface PaymentTrackingResponse {
  lastUpdated: string;
  summary: PaymentTrackingSummary;
  deals: PaymentTrackingDeal[];
}

/** Raw HubSpot property shape (all strings/nulls as HubSpot returns them). */
export interface HubSpotDealPaymentProps {
  hs_object_id?: string | null;
  dealname?: string | null;
  amount?: string | null;
  pb_location?: string | null;
  dealstage?: string | null;
  closedate?: string | null;

  da_invoice_status?: string | null;
  da_invoice_amount?: string | null;
  da_invoice_paid?: string | null;
  da_invoice_memo?: string | null;

  cc_invoice_status?: string | null;
  cc_invoice_amount?: string | null;
  cc_invoice_paid?: string | null;

  pto_invoice_status?: string | null;
  pto_invoice_memo?: string | null;

  pe_m1_status?: string | null;
  pe_m2_status?: string | null;
  pe_payment_ic?: string | null;
  pe_payment_pc?: string | null;
  pe_m1_approval_date?: string | null;
  pe_m1_rejection_date?: string | null;
  pe_m1_submission_date?: string | null;
  pe_m2_approval_date?: string | null;
  pe_m2_rejection_date?: string | null;
  pe_m2_submission_date?: string | null;
  pe_total_pb_revenue?: string | null;

  paid_in_full?: string | null;

  layout_approved?: string | null; // "Is Design Approved?" — boolean as string
  layout_approval_date?: string | null;
  is_construction_complete_?: string | null;
  construction_complete_date?: string | null;
  is_inspection_passed_?: string | null;
  inspections_completion_date?: string | null;
  is_pto_granted_?: string | null;
  pto_completion_date?: string | null;
}
