/**
 * Compact 5-dot milestone strip. Replaces the 15+ per-milestone columns
 * with a single visual: ● ● ○ ○ ○ . Hover any dot for the full status,
 * amount, paid date, and invoice link.
 */
import type {
  PaymentTrackingDeal,
  DaStatus,
  PeStatus,
  InvoiceSummary,
} from "@/lib/payment-tracking-types";

// Dot state hierarchy, simplified to reflect what accounting cares about:
//   paid       = collected (full or close to it)
//   partial    = sent + some payment received, balance due
//   sent       = invoice exists in HubSpot, no payment yet
//   draft      = invoice exists but not yet sent (HubSpot status = draft)
//   ready      = work milestone complete, no invoice exists yet (action!)
//   not_ready  = milestone not yet triggered (no work done)
type DotState = "paid" | "partial" | "sent" | "draft" | "ready" | "not_ready";

const DOT_CLASS: Record<DotState, string> = {
  paid: "bg-emerald-500 border-emerald-500",
  partial: "bg-amber-500 border-amber-300 ring-1 ring-emerald-400/40",
  sent: "bg-amber-500 border-amber-500",
  draft: "bg-zinc-500 border-zinc-400 ring-1 ring-zinc-300/40",
  ready: "bg-amber-500 border-amber-300 ring-2 ring-amber-400/60",
  not_ready: "bg-transparent border-zinc-700",
};

const DOT_LABEL: Record<DotState, string> = {
  paid: "Paid",
  partial: "Partial payment received",
  sent: "Sent / awaiting payment",
  draft: "Draft / not sent",
  ready: "Ready to invoice (work done, no invoice)",
  not_ready: "Not yet ready",
};

/**
 * Pick a dot state. Prefer the actual invoice record (truth) over deal-
 * property status. Order:
 *   - invoice paid in full → paid
 *   - invoice paid > 0 but balance > 0 → partial
 *   - invoice exists, status=open, no payment → sent
 *   - invoice exists, status=draft → draft
 *   - no invoice, work milestone hit → ready
 *   - else → not_ready
 */
function dotState(args: {
  invoice?: InvoiceSummary;
  dealStatus: DaStatus | PeStatus | null;
  workComplete: boolean;
}): DotState {
  const inv = args.invoice;
  if (inv) {
    const paid = inv.amountPaid ?? 0;
    const balance = inv.balanceDue ?? 0;
    if (inv.status === "paid" || (paid > 0 && balance <= 0.5)) return "paid";
    if (paid > 0 && balance > 0) return "partial";
    if (inv.status === "draft") return "draft";
    return "sent"; // open / unspecified — invoice issued, no payment yet
  }
  // No invoice. Fall back to deal-property status.
  const s = args.dealStatus;
  if (s === "Paid In Full" || s === "Paid") return "paid";
  // Without an invoice record, we can't tell sent vs draft from deal props
  // alone. Show as "ready" if work is complete, else "not_ready".
  return args.workComplete ? "ready" : "not_ready";
}

function fmtMoney(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

interface DotInfo {
  label: string;
  state: DotState;
  status: string | null;
  amount: number | null;
  paidDate: string | null;
  invoice?: InvoiceSummary;
}

function tooltip(d: DotInfo): string {
  const lines: string[] = [`${d.label}: ${DOT_LABEL[d.state]}`];
  if (d.invoice) {
    lines.push(`Invoice ${d.invoice.number ?? d.invoice.invoiceId}`);
    lines.push(`Billed: ${fmtMoney(d.invoice.amountBilled)}`);
    lines.push(`Paid:   ${fmtMoney(d.invoice.amountPaid)}`);
    if (d.invoice.balanceDue && d.invoice.balanceDue > 0) {
      lines.push(`Balance: ${fmtMoney(d.invoice.balanceDue)}`);
    }
    if (d.invoice.invoiceDate) lines.push(`Invoiced: ${d.invoice.invoiceDate.slice(0, 10)}`);
    if (d.invoice.paymentDate) lines.push(`Paid: ${d.invoice.paymentDate.slice(0, 10)}`);
    else if (d.paidDate) lines.push(`Paid: ${d.paidDate.slice(0, 10)}`);
  } else {
    lines.push(`Amount: ${fmtMoney(d.amount)}`);
    if (d.paidDate) lines.push(`Paid: ${d.paidDate.slice(0, 10)}`);
    if (d.status) lines.push(`Status: ${d.status}`);
  }
  if (d.state === "ready") lines.push("⚠ Click into the deal to invoice this");
  return lines.join("\n");
}

export function MilestoneStrip({ deal }: { deal: PaymentTrackingDeal }) {
  // Prefer invoice amount/date when an invoice is attached; deal-property
  // values are sometimes null even when the milestone is paid.
  //
  // Milestone strip composition:
  //   Non-PE: DA + CC + PTO   (3 dots — customer pays 100% across all 3)
  //   PE:     DA + CC + PE M1 + PE M2  (4 dots — no PTO; PE replaces it)
  const dots: DotInfo[] = [
    {
      label: "DA",
      state: dotState({
        invoice: deal.invoices?.da,
        dealStatus: deal.daStatus,
        workComplete: deal.isDesignApproved,
      }),
      status: deal.daStatus,
      amount: deal.invoices?.da?.amountBilled ?? deal.daAmount,
      paidDate: deal.invoices?.da?.paymentDate ?? deal.daPaidDate,
      invoice: deal.invoices?.da,
    },
    {
      label: "CC",
      state: dotState({
        invoice: deal.invoices?.cc,
        dealStatus: deal.ccStatus,
        workComplete: deal.isConstructionComplete,
      }),
      status: deal.ccStatus,
      amount: deal.invoices?.cc?.amountBilled ?? deal.ccAmount,
      paidDate: deal.invoices?.cc?.paymentDate ?? deal.ccPaidDate,
      invoice: deal.invoices?.cc,
    },
  ];

  if (!deal.isPE) {
    dots.push({
      label: "PTO",
      state: dotState({
        invoice: deal.invoices?.pto,
        dealStatus: deal.ptoStatus,
        workComplete: deal.isPtoGranted,
      }),
      status: deal.ptoStatus,
      amount: deal.invoices?.pto?.amountBilled ?? null,
      paidDate: deal.invoices?.pto?.paymentDate ?? null,
      invoice: deal.invoices?.pto,
    });
  }

  if (deal.isPE) {
    dots.push({
      label: "PE M1",
      state: dotState({
        invoice: deal.invoices?.peM1,
        dealStatus: deal.peM1Status,
        workComplete: deal.isInspectionPassed && deal.peM1Status === "Approved",
      }),
      status: deal.peM1Status,
      amount: deal.invoices?.peM1?.amountBilled ?? deal.peM1Amount,
      paidDate: deal.invoices?.peM1?.paymentDate ?? deal.peM1ApprovalDate,
      invoice: deal.invoices?.peM1,
    });
    dots.push({
      label: "PE M2",
      state: dotState({
        invoice: deal.invoices?.peM2,
        dealStatus: deal.peM2Status,
        workComplete: deal.isPtoGranted && deal.peM2Status === "Approved",
      }),
      status: deal.peM2Status,
      amount: deal.invoices?.peM2?.amountBilled ?? deal.peM2Amount,
      paidDate: deal.invoices?.peM2?.paymentDate ?? deal.peM2ApprovalDate,
      invoice: deal.invoices?.peM2,
    });
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      {dots.map((d) => {
        const dot = (
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full border ${DOT_CLASS[d.state]}`}
            title={tooltip(d)}
          />
        );
        // Click any dot to open the parent DEAL in HubSpot. The deal page
        // shows associated invoices — that's a reliable URL we know works,
        // unlike the per-invoice URL patterns which kept breaking. Tooltip
        // still shows invoice number + amounts so the user knows what they
        // were clicking.
        return (
          <a
            key={d.label}
            href={deal.hubspotUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:opacity-70"
            onClick={(e) => e.stopPropagation()}
          >
            {dot}
          </a>
        );
      })}
    </div>
  );
}
