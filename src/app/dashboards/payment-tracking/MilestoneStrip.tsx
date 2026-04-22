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

type DotState =
  | "paid" // emerald — invoice paid in full / status = Paid
  | "open" // amber — invoice issued, balance due
  | "pending" // zinc — work milestone hit, invoice not yet issued (or pending approval)
  | "rejected" // red — PE rejected our docs
  | "blocked" // off — milestone not yet hit (work isn't done)
  | "ready"; // blue ring — work IS done but invoice not paid (actionable)

const DOT_CLASS: Record<DotState, string> = {
  paid: "bg-emerald-500 border-emerald-500",
  open: "bg-amber-500 border-amber-500",
  pending: "bg-zinc-500 border-zinc-500",
  rejected: "bg-red-500 border-red-500",
  blocked: "bg-transparent border-zinc-700",
  ready: "bg-amber-500 border-amber-300 ring-2 ring-amber-400/50",
};

function dotForDa(status: DaStatus | null, ready: boolean): DotState {
  if (status === "Paid In Full") return "paid";
  if (status === "Open") return ready ? "ready" : "open";
  if (status === "Pending Approval") return "pending";
  return ready ? "ready" : "blocked";
}

function dotForPe(status: PeStatus | null, ready: boolean): DotState {
  if (!status) return ready ? "ready" : "blocked";
  if (status === "Paid") return "paid";
  if (status === "Rejected") return "rejected";
  if (status === "Approved") return "ready";
  if (status === "Submitted" || status === "Resubmitted") return "open";
  return ready ? "ready" : "pending";
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
  return [
    `${d.label}: ${d.status ?? "—"}`,
    `Amount: ${fmtMoney(d.amount)}`,
    d.paidDate ? `Paid: ${d.paidDate.slice(0, 10)}` : null,
    d.invoice ? `Invoice ${d.invoice.number ?? d.invoice.invoiceId}` : null,
    d.invoice?.balanceDue && d.invoice.balanceDue > 0
      ? `Balance due: ${fmtMoney(d.invoice.balanceDue)}`
      : null,
    d.state === "ready" ? "⚠ Ready to invoice (work complete, not paid)" : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function MilestoneStrip({ deal }: { deal: PaymentTrackingDeal }) {
  const dots: DotInfo[] = [
    {
      label: "DA",
      state: dotForDa(deal.daStatus, deal.isDesignApproved && deal.daStatus !== "Paid In Full"),
      status: deal.daStatus,
      amount: deal.daAmount,
      paidDate: deal.daPaidDate,
      invoice: deal.invoices?.da,
    },
    {
      label: "CC",
      state: dotForDa(
        deal.ccStatus,
        deal.isConstructionComplete && deal.ccStatus !== "Paid In Full"
      ),
      status: deal.ccStatus,
      amount: deal.ccAmount,
      paidDate: deal.ccPaidDate,
      invoice: deal.invoices?.cc,
    },
    {
      label: "PTO",
      state: dotForDa(
        deal.ptoStatus,
        deal.isPtoGranted && deal.ptoStatus !== "Paid In Full"
      ),
      status: deal.ptoStatus,
      amount: deal.invoices?.pto?.amountBilled ?? null,
      paidDate: deal.invoices?.pto?.paymentDate ?? null,
      invoice: deal.invoices?.pto,
    },
  ];

  if (deal.isPE) {
    dots.push({
      label: "PE M1",
      state: dotForPe(
        deal.peM1Status,
        deal.isInspectionPassed && deal.peM1Status === "Approved"
      ),
      status: deal.peM1Status,
      amount: deal.peM1Amount,
      paidDate: deal.peM1ApprovalDate,
      invoice: deal.invoices?.peM1,
    });
    dots.push({
      label: "PE M2",
      state: dotForPe(
        deal.peM2Status,
        deal.isPtoGranted && deal.peM2Status === "Approved"
      ),
      status: deal.peM2Status,
      amount: deal.peM2Amount,
      paidDate: deal.peM2ApprovalDate,
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
        // Wrap in invoice link when one exists.
        return d.invoice ? (
          <a
            key={d.label}
            href={d.invoice.hubspotUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:opacity-70"
            onClick={(e) => e.stopPropagation()}
          >
            {dot}
          </a>
        ) : (
          <span key={d.label}>{dot}</span>
        );
      })}
    </div>
  );
}
