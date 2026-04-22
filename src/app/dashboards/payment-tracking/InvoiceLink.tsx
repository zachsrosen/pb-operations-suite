import type { InvoiceSummary } from "@/lib/payment-tracking-types";

function fmt(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * Tiny invoice icon next to a milestone status pill. Hover shows real invoice
 * numbers (billed/paid/balance/due date). Click opens the invoice in HubSpot.
 *
 * Renders nothing when no invoice is associated for this milestone (older deal,
 * pre-invoice phase, or just no record yet).
 */
export function InvoiceLink({ invoice }: { invoice: InvoiceSummary | undefined }) {
  if (!invoice) return null;

  const tooltipLines = [
    `Invoice ${invoice.number ?? invoice.invoiceId}`,
    invoice.status ? `Status: ${invoice.status}` : null,
    `Billed: ${fmt(invoice.amountBilled)}`,
    `Paid:   ${fmt(invoice.amountPaid)}`,
    invoice.balanceDue !== null && invoice.balanceDue > 0
      ? `Balance: ${fmt(invoice.balanceDue)}`
      : null,
    invoice.invoiceDate ? `Invoiced: ${invoice.invoiceDate.slice(0, 10)}` : null,
    invoice.dueDate ? `Due: ${invoice.dueDate.slice(0, 10)}` : null,
    invoice.paymentDate ? `Paid: ${invoice.paymentDate.slice(0, 10)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <a
      href={invoice.hubspotUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={tooltipLines}
      className="ml-1 text-blue-400 hover:text-blue-300"
      onClick={(e) => e.stopPropagation()}
    >
      🧾
    </a>
  );
}
