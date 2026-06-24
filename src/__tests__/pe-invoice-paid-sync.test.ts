import { decidePaidFromInvoice, latestPaidTimestamp, type InvoiceLite } from "@/lib/pe-invoice-paid-sync";

const inv = (over: Partial<InvoiceLite>): InvoiceLite => ({
  hsNumber: "INV-00010001PE",
  status: "paid",
  amountBilled: 4267.9,
  paidHistory: ["2026-06-15T10:00:00Z"],
  ...over,
});

describe("latestPaidTimestamp", () => {
  it("returns the latest paid transition (handles revert/re-pay)", () => {
    expect(latestPaidTimestamp(inv({ paidHistory: ["2026-04-30T00:00:00Z", "2026-06-09T00:00:00Z"] }))).toBe("2026-06-09T00:00:00Z");
  });
  it("returns null when never paid", () => {
    expect(latestPaidTimestamp(inv({ paidHistory: [] }))).toBeNull();
  });
});

describe("decidePaidFromInvoice", () => {
  it("flips an Approved milestone to Paid using the matching paid PE invoice's latest paid date", () => {
    const d = decidePaidFromInvoice({
      milestoneStatus: "Approved",
      milestoneAmount: 4267.9,
      invoices: [inv({ amountBilled: 4267.9, paidHistory: ["2026-06-12T00:00:00Z"] })],
    });
    expect(d).toEqual({ paidDate: "2026-06-12T00:00:00Z" });
  });

  it("does nothing when the milestone is not Approved", () => {
    expect(decidePaidFromInvoice({ milestoneStatus: "Submitted", milestoneAmount: 4267.9, invoices: [inv({})] })).toBeNull();
    expect(decidePaidFromInvoice({ milestoneStatus: "Paid", milestoneAmount: 4267.9, invoices: [inv({})] })).toBeNull();
  });

  it("does nothing when no PE invoice matches the milestone amount", () => {
    // invoice exists but for the OTHER milestone amount (PC, not IC)
    expect(decidePaidFromInvoice({ milestoneStatus: "Approved", milestoneAmount: 4267.9, invoices: [inv({ amountBilled: 2133.95 })] })).toBeNull();
  });

  it("ignores a non-PE invoice even at the right amount", () => {
    expect(decidePaidFromInvoice({ milestoneStatus: "Approved", milestoneAmount: 4267.9, invoices: [inv({ hsNumber: "INV-00010001" })] })).toBeNull();
  });

  it("does not flip when the matching PE invoice is still open/unpaid", () => {
    expect(decidePaidFromInvoice({ milestoneStatus: "Approved", milestoneAmount: 3221.35, invoices: [inv({ amountBilled: 3221.35, status: "open", paidHistory: [] })] })).toBeNull();
  });

  it("flips a short-pay (invoice balance 0 but billed less is irrelevant — amount matches the recorded milestone)", () => {
    // Clark-type: recorded milestone amount is the billed amount; paid in full → Paid
    const d = decidePaidFromInvoice({ milestoneStatus: "Approved", milestoneAmount: 4267.9, invoices: [inv({ amountBilled: 4267.9, paidHistory: ["2026-05-21T00:00:00Z"] })] });
    expect(d).toEqual({ paidDate: "2026-05-21T00:00:00Z" });
  });

  it("matches within the dollar tolerance", () => {
    const d = decidePaidFromInvoice({ milestoneStatus: "Approved", milestoneAmount: 4268, invoices: [inv({ amountBilled: 4267.9 })] });
    expect(d).not.toBeNull();
  });

  it("returns null when milestone amount is unknown", () => {
    expect(decidePaidFromInvoice({ milestoneStatus: "Approved", milestoneAmount: null, invoices: [inv({})] })).toBeNull();
  });
});
