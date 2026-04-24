# Invoice-First Accounting Pages — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch payment attention logic from deal-property-first to invoice-record-first, add three new accounting pages (Ready to Invoice, Accounts Receivable, Payment Data Mismatch), and leave existing Payment Tracking / Payment Action Queue pages working with accurate counts.

**Architecture:** Server-side derivation in the existing `/api/accounting/payment-tracking` route. New shared helpers in `src/lib/payment-tracking.ts` compute invoice-first effective status, plus three new derived arrays (readyToInvoice, accountsReceivable, paymentDataMismatch) appended to the response. Three new client pages consume the derived arrays — no additional HubSpot API load.

**Tech Stack:** Next.js 16, TypeScript, React 19, React Query, Tailwind v4, existing `DashboardShell` and `MetricCard` primitives.

**Spec:** [docs/superpowers/specs/2026-04-23-invoice-first-accounting-pages-design.md](../specs/2026-04-23-invoice-first-accounting-pages-design.md)

---

## File Structure

**Modified:**
- `src/lib/payment-tracking-types.ts` — add `ReadyToInvoiceEntry`, `AccountsReceivableEntry`, `PaymentDataMismatchEntry`, extend `PaymentTrackingResponse` with the three new arrays.
- `src/lib/payment-tracking.ts` — add `effectivePaidStatus`, rework `computeBucket` to use it, add `deriveReadyToInvoice`, `deriveAccountsReceivable`, `derivePaymentDataMismatch` pure functions, log mismatch count.
- `src/app/api/accounting/payment-tracking/route.ts` — call the three new derive functions, attach to response.
- `src/lib/roles.ts` — add three new routes to ACCOUNTING and ADMIN role definitions (mismatch = ADMIN only).
- `src/app/suites/accounting/page.tsx` — add two new cards (Ready to Invoice, Accounts Receivable). Mismatch page NOT added here — ADMIN only reaches it via direct URL or admin-specific nav.
- `src/app/dashboards/payment-action-queue/PaymentActionQueueClient.tsx` — add link-out row to the three new pages.
- `src/__tests__/lib/payment-tracking.test.ts` — invoice-first tests, derive function tests, mismatch tests.

**Created:**
- `src/app/dashboards/ready-to-invoice/page.tsx` — server shell.
- `src/app/dashboards/ready-to-invoice/ReadyToInvoiceClient.tsx` — page client.
- `src/app/dashboards/accounts-receivable/page.tsx` — server shell.
- `src/app/dashboards/accounts-receivable/AccountsReceivableClient.tsx` — page client.
- `src/app/dashboards/payment-data-mismatch/page.tsx` — server shell, role gate to ADMIN.
- `src/app/dashboards/payment-data-mismatch/PaymentDataMismatchClient.tsx` — page client.

---

## Chunk 1: Invoice-first bucketing

### Task 1: Add effective-status helper

**Files:**
- Modify: `src/lib/payment-tracking.ts` (add near top of file, before `computeBucket`)
- Test: `src/__tests__/lib/payment-tracking.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/lib/payment-tracking.test.ts`:

```ts
import { effectivePaidStatus } from "@/lib/payment-tracking";
import type { InvoiceSummary } from "@/lib/payment-tracking-types";

describe("effectivePaidStatus", () => {
  const paidInvoice: InvoiceSummary = {
    invoiceId: "1", number: "INV-1", status: "paid",
    amountBilled: 1000, amountPaid: 1000, balanceDue: 0,
    invoiceDate: "2026-03-01", dueDate: "2026-03-15", paymentDate: "2026-03-10",
    daysOverdue: null, hubspotUrl: "x",
  };
  const unpaidInvoice: InvoiceSummary = {
    ...paidInvoice, status: "sent", amountPaid: 0, balanceDue: 1000, paymentDate: null,
  };

  it("returns 'paid' when invoice balanceDue is 0 and status is paid", () => {
    expect(effectivePaidStatus("customer", paidInvoice, "Open")).toBe("paid");
  });

  it("returns 'invoiced_unpaid' when invoice attached with balanceDue > 0", () => {
    expect(effectivePaidStatus("customer", unpaidInvoice, "Paid In Full")).toBe("invoiced_unpaid");
  });

  it("falls back to 'paid' from customer deal property when no invoice", () => {
    expect(effectivePaidStatus("customer", undefined, "Paid In Full")).toBe("paid");
  });

  it("falls back to 'not_invoiced' from customer deal property when no invoice and not paid", () => {
    expect(effectivePaidStatus("customer", undefined, "Open")).toBe("not_invoiced");
    expect(effectivePaidStatus("customer", undefined, null)).toBe("not_invoiced");
  });

  it("handles PE status fallback: 'Paid' -> paid, else not_invoiced", () => {
    expect(effectivePaidStatus("pe", undefined, "Paid")).toBe("paid");
    expect(effectivePaidStatus("pe", undefined, "Approved")).toBe("not_invoiced");
  });

  it("treats voided/cancelled invoices as not_invoiced (ignore)", () => {
    const voided = { ...paidInvoice, status: "voided", balanceDue: 0 };
    expect(effectivePaidStatus("customer", voided, "Open")).toBe("not_invoiced");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- payment-tracking.test`
Expected: FAIL — `effectivePaidStatus is not a function`

- [ ] **Step 3: Implement `effectivePaidStatus`**

Add to `src/lib/payment-tracking.ts` (above `computeBucket`):

```ts
/** Effective paid status for a milestone — invoice-first, deal-property fallback.
 *
 * "customer" milestones use DA/CC/PTO status enum ("Paid In Full").
 * "pe" milestones use PE status enum ("Paid").
 *
 * Returns:
 *   "paid"            — invoice.balanceDue === 0 AND status indicates paid,
 *                       OR no invoice + deal property says paid
 *   "invoiced_unpaid" — invoice attached, balanceDue > 0, status active
 *   "not_invoiced"    — no invoice AND deal property does not say paid,
 *                       OR invoice attached with voided/cancelled/draft status
 */
export type EffectivePaidStatus = "paid" | "invoiced_unpaid" | "not_invoiced";

const PAID_INVOICE_STATUSES = new Set(["paid"]);
const IGNORED_INVOICE_STATUSES = new Set(["voided", "cancelled", "draft"]);

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
```

Also add `InvoiceSummary` to the imports at the top of the file:

```ts
import type {
  DaStatus,
  HubSpotDealPaymentProps,
  InvoiceSummary,
  PaymentBucket,
  PaymentStatusGroup,
  PaymentTrackingDeal,
  PaymentTrackingSummary,
  PeStatus,
} from "@/lib/payment-tracking-types";
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- payment-tracking.test`
Expected: all `effectivePaidStatus` tests PASS. Existing tests continue to pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payment-tracking.ts src/__tests__/lib/payment-tracking.test.ts
git commit -m "feat(accounting): add effectivePaidStatus helper (invoice-first)"
```

### Task 2: Switch computeBucket to invoice-first

**Files:**
- Modify: `src/lib/payment-tracking.ts:93-183` (computeBucket) and the `transformDeal` call site `:286-301`
- Test: `src/__tests__/lib/payment-tracking.test.ts`

- [ ] **Step 1: Add failing tests for PE deal with CC invoice Paid**

Append to `src/__tests__/lib/payment-tracking.test.ts`:

```ts
describe("computeBucket — invoice-first", () => {
  const paidInvoice = (): InvoiceSummary => ({
    invoiceId: "1", number: "INV-1", status: "paid",
    amountBilled: 1000, amountPaid: 1000, balanceDue: 0,
    invoiceDate: "2026-03-01", dueDate: "2026-03-15", paymentDate: "2026-03-10",
    daysOverdue: null, hubspotUrl: "x",
  });

  it("PE deal: CC invoice Paid but deal property says Open → CC-unpaid reason does NOT fire", () => {
    const result = computeBucket({
      daStatus: "Paid In Full", ccStatus: "Open", ptoStatus: null,
      peM1Status: "Approved", peM2Status: null, isPE: true,
      closeDate: "2026-03-01", dealStage: "22580872", // Inspection
      peM1ApprovalDate: null, asOf: new Date("2026-04-23"),
      isDesignApproved: true, isConstructionComplete: true,
      isInspectionPassed: true, isPtoGranted: false,
      invoices: { da: paidInvoice(), cc: paidInvoice() },
    });
    expect(result.attentionReasons).not.toContain("Post-install, CC not paid");
    expect(result.attentionReasons).not.toContain("Construction complete — CC invoice not paid");
    // PE M1 reason still fires (M1 approved but not paid)
    expect(result.attentionReasons).toContain("Inspection passed + PE approved M1 — M1 not paid");
  });

  it("Non-PE deal: CC invoice balanceDue > 0 → CC-unpaid reason fires (invoice-first)", () => {
    const unpaid: InvoiceSummary = { ...paidInvoice(), status: "sent", amountPaid: 0, balanceDue: 500 };
    const result = computeBucket({
      daStatus: "Paid In Full", ccStatus: "Paid In Full", ptoStatus: null,
      peM1Status: null, peM2Status: null, isPE: false,
      closeDate: "2026-03-01", dealStage: "22580872",
      peM1ApprovalDate: null, asOf: new Date("2026-04-23"),
      isDesignApproved: true, isConstructionComplete: true,
      isInspectionPassed: false, isPtoGranted: false,
      invoices: { da: paidInvoice(), cc: unpaid },
    });
    expect(result.attentionReasons).toContain("Post-install, CC not paid");
  });

  it("No invoices attached → falls back to deal properties (unchanged behavior)", () => {
    const result = computeBucket({
      daStatus: "Paid In Full", ccStatus: "Open", ptoStatus: null,
      peM1Status: null, peM2Status: null, isPE: false,
      closeDate: "2026-03-01", dealStage: "22580872",
      peM1ApprovalDate: null, asOf: new Date("2026-04-23"),
      isDesignApproved: true, isConstructionComplete: true,
      isInspectionPassed: false, isPtoGranted: false,
      invoices: undefined,
    });
    expect(result.attentionReasons).toContain("Post-install, CC not paid");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- payment-tracking.test`
Expected: FAIL — `invoices` is not a recognized arg, or reasons don't match.

- [ ] **Step 3: Update `computeBucket` signature and logic**

In `src/lib/payment-tracking.ts`, change `computeBucket`'s args to accept optional `invoices` and rewrite each rule that references status-comparisons to use `effectivePaidStatus`:

```ts
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
  isDesignApproved?: boolean;
  isConstructionComplete?: boolean;
  isInspectionPassed?: boolean;
  isPtoGranted?: boolean;
  invoices?: PaymentTrackingDeal["invoices"];
}): { bucket: PaymentBucket; attentionReasons: string[] } {
  const reasons: string[] = [];
  const close = args.closeDate ? new Date(args.closeDate) : null;
  const daysSinceClose = close ? daysBetween(args.asOf, close) : 0;

  // Invoice-first effective statuses. Fall back to deal property when no invoice.
  const daEff = effectivePaidStatus("customer", args.invoices?.da, args.daStatus);
  const ccEff = effectivePaidStatus("customer", args.invoices?.cc, args.ccStatus);
  const ptoEff = effectivePaidStatus("customer", args.invoices?.pto, args.ptoStatus);
  const peM1Eff = effectivePaidStatus("pe", args.invoices?.peM1, args.peM1Status);
  const peM2Eff = effectivePaidStatus("pe", args.invoices?.peM2, args.peM2Status);

  // Rule 1: >30 days past close — per-milestone "Open" flag, invoice-first.
  if (close && daysSinceClose > 30) {
    if (daEff !== "paid" && args.daStatus === "Open") reasons.push("DA Open >30 days past close");
    if (ccEff !== "paid" && args.ccStatus === "Open") reasons.push("CC Open >30 days past close");
    if (ptoEff !== "paid" && args.ptoStatus === "Open") reasons.push("PTO Open >30 days past close");
  }
  // Post-install, CC not paid (invoice-first)
  if (
    args.dealStage &&
    POST_INSTALL_STAGES.has(args.dealStage) &&
    ccEff !== "paid" &&
    daEff === "paid" &&
    !reasons.some((r) => r.startsWith("CC Open"))
  ) {
    reasons.push("Post-install, CC not paid");
  }

  // Ready-to-invoice signals — only fire when milestone trigger met AND
  // not paid (effective status).
  if (args.isDesignApproved && daEff !== "paid") {
    reasons.push("Design approved — DA invoice not paid");
  }
  if (args.isConstructionComplete && ccEff !== "paid") {
    reasons.push("Construction complete — CC invoice not paid");
  }
  if (!args.isPE && args.isPtoGranted && ptoEff !== "paid") {
    reasons.push("PTO granted — PTO invoice not paid");
  }
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
```

- [ ] **Step 4: Call `computeBucket` a second time from the API route after invoices attach**

`computeBucket` currently runs inside `transformDeal`, BEFORE invoices attach. We need bucketing to happen AFTER. Options:

1. Recompute bucket in `reconcileMoneyWithInvoices` (simplest — already runs post-attach).
2. Export a `recomputeBucketWithInvoices(deal)` helper and call it from the API route.

Choose option 1. Update `reconcileMoneyWithInvoices` in `src/lib/payment-tracking-invoices.ts:346` to re-run bucket compute:

```ts
// At the end of reconcileMoneyWithInvoices, recompute bucket with invoice data:
const rebucket = computeBucket({
  daStatus: deal.daStatus, ccStatus: deal.ccStatus, ptoStatus: deal.ptoStatus,
  peM1Status: deal.peM1Status, peM2Status: deal.peM2Status, isPE: deal.isPE,
  closeDate: deal.closeDate, dealStage: deal.dealStage,
  peM1ApprovalDate: deal.peM1ApprovalDate, asOf: new Date(),
  isDesignApproved: deal.isDesignApproved,
  isConstructionComplete: deal.isConstructionComplete,
  isInspectionPassed: deal.isInspectionPassed,
  isPtoGranted: deal.isPtoGranted,
  invoices: deal.invoices,
});
deal.bucket = rebucket.bucket;
deal.attentionReasons = rebucket.attentionReasons;
// Re-derive statusGroup since attentionReasons changed.
deal.statusGroup = rebucket.attentionReasons.length > 0 ? "issues" : deal.statusGroup;
```

Import `computeBucket` in `payment-tracking-invoices.ts`.

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test -- payment-tracking.test`
Expected: all tests PASS including new invoice-first ones.

- [ ] **Step 6: Commit**

```bash
git add src/lib/payment-tracking.ts src/lib/payment-tracking-invoices.ts src/__tests__/lib/payment-tracking.test.ts
git commit -m "feat(accounting): invoice-first bucketing — invoice record wins over deal property"
```

---

## Chunk 2: Derive arrays (readyToInvoice, accountsReceivable, mismatch)

### Task 3: Add derived-types to payment-tracking-types.ts

**Files:**
- Modify: `src/lib/payment-tracking-types.ts`

- [ ] **Step 1: Add new types**

Append to `src/lib/payment-tracking-types.ts`:

```ts
export type Milestone = "da" | "cc" | "pto" | "peM1" | "peM2";

export interface ReadyToInvoiceEntry {
  dealId: string;
  dealName: string;
  pbLocation: string;
  dealStage: string;
  dealStageLabel: string;
  isPE: boolean;
  milestone: Milestone;
  triggerDate: string | null;
  daysReady: number | null;
  expectedAmount: number | null;
  hubspotUrl: string;
}

export type AgingBucket = "0-30" | "31-60" | "61-90" | "90+";

export interface AccountsReceivableEntry {
  dealId: string;
  dealName: string;
  pbLocation: string;
  isPE: boolean;
  milestone: Milestone;
  invoice: InvoiceSummary;
  agingBucket: AgingBucket;
  daysOverdue: number;
  hubspotUrl: string;
}

export type MismatchType =
  | "property_says_unpaid_invoice_paid"
  | "property_says_paid_invoice_unpaid"
  | "property_missing_invoice_present";

export interface PaymentDataMismatchEntry {
  dealId: string;
  dealName: string;
  pbLocation: string;
  isPE: boolean;
  milestone: Milestone;
  mismatchType: MismatchType;
  dealPropertyStatus: string | null;
  invoice: InvoiceSummary;
  hubspotUrl: string;
}
```

Extend `PaymentTrackingResponse`:

```ts
export interface PaymentTrackingResponse {
  lastUpdated: string;
  summary: PaymentTrackingSummary;
  deals: PaymentTrackingDeal[];
  readyToInvoice: ReadyToInvoiceEntry[];
  accountsReceivable: AccountsReceivableEntry[];
  paymentDataMismatch: PaymentDataMismatchEntry[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/payment-tracking-types.ts
git commit -m "feat(accounting): add derived entry types (readyToInvoice, AR, mismatch)"
```

### Task 4: Implement `deriveReadyToInvoice`

**Files:**
- Modify: `src/lib/payment-tracking.ts`
- Test: `src/__tests__/lib/payment-tracking.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/__tests__/lib/payment-tracking.test.ts`:

```ts
import { deriveReadyToInvoice } from "@/lib/payment-tracking";
import type { PaymentTrackingDeal } from "@/lib/payment-tracking-types";

const makeDeal = (overrides: Partial<PaymentTrackingDeal>): PaymentTrackingDeal => ({
  dealId: "1", dealName: "Test", pbLocation: "DTC", dealStage: "22580872",
  dealStageLabel: "Inspection", closeDate: "2026-03-01", isPE: false,
  customerContractTotal: 1000, customerCollected: 0, customerOutstanding: 0, notYetInvoiced: 1000,
  daStatus: null, daAmount: 500, daPaidDate: null, daMemo: null,
  ccStatus: null, ccAmount: 500, ccPaidDate: null,
  ptoStatus: null, ptoMemo: null,
  peM1Status: null, peM1Amount: null, peM1ApprovalDate: null, peM1RejectionDate: null,
  peM2Status: null, peM2Amount: null, peM2ApprovalDate: null, peM2RejectionDate: null,
  peBonusTotal: null, peBonusCollected: null, peBonusOutstanding: null,
  totalPBRevenue: 1000, collectedPct: 0, bucket: "awaiting_m1", statusGroup: "not_started",
  attentionReasons: [], paidInFullFlag: null,
  isDesignApproved: false, designApprovalDate: null,
  isConstructionComplete: false, constructionCompleteDate: null,
  isInspectionPassed: false, inspectionPassedDate: null,
  isPtoGranted: false, ptoGrantedDate: null,
  hubspotUrl: "x",
  ...overrides,
});

describe("deriveReadyToInvoice", () => {
  const asOf = new Date("2026-04-23");

  it("includes deal when layout_approved + no DA invoice", () => {
    const deals = [makeDeal({ isDesignApproved: true, designApprovalDate: "2026-04-13" })];
    const result = deriveReadyToInvoice(deals, asOf);
    expect(result).toHaveLength(1);
    expect(result[0].milestone).toBe("da");
    expect(result[0].daysReady).toBe(10);
  });

  it("excludes deal when layout_approved but DA invoice attached (any state)", () => {
    const deals = [makeDeal({
      isDesignApproved: true,
      invoices: { da: { invoiceId: "i", number: "INV-1", status: "sent", amountBilled: 500, amountPaid: 0, balanceDue: 500, invoiceDate: "2026-04-13", dueDate: null, paymentDate: null, daysOverdue: null, hubspotUrl: "x" } }
    })];
    expect(deriveReadyToInvoice(deals, asOf)).toHaveLength(0);
  });

  it("PE M1 ready only when inspectionPassed + peM1Status=Approved + no PE M1 invoice", () => {
    const ready = makeDeal({
      isPE: true, isInspectionPassed: true, inspectionPassedDate: "2026-04-13",
      peM1Status: "Approved", peM1Amount: 300,
    });
    const notReady = makeDeal({
      isPE: true, isInspectionPassed: true, peM1Status: "Submitted",
    });
    const result = deriveReadyToInvoice([ready, notReady], asOf);
    expect(result.map(r => r.milestone)).toEqual(["peM1"]);
  });

  it("PTO NOT a milestone for PE deals", () => {
    const deals = [makeDeal({ isPE: true, isPtoGranted: true, ptoGrantedDate: "2026-04-13" })];
    const result = deriveReadyToInvoice(deals, asOf);
    expect(result.find(r => r.milestone === "pto")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- payment-tracking.test`
Expected: FAIL — `deriveReadyToInvoice` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/payment-tracking.ts`:

```ts
import type {
  ReadyToInvoiceEntry,
  AccountsReceivableEntry,
  AgingBucket,
  PaymentDataMismatchEntry,
  MismatchType,
  Milestone,
} from "@/lib/payment-tracking-types";

// Helpers shared across derive functions.
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

    // DA
    if (deal.isDesignApproved && !deal.invoices?.da) {
      out.push({
        ...base, milestone: "da",
        triggerDate: deal.designApprovalDate,
        daysReady: daysBetweenDates(asOf, deal.designApprovalDate),
        expectedAmount: deal.daAmount,
      });
    }
    // CC
    if (deal.isConstructionComplete && !deal.invoices?.cc) {
      out.push({
        ...base, milestone: "cc",
        triggerDate: deal.constructionCompleteDate,
        daysReady: daysBetweenDates(asOf, deal.constructionCompleteDate),
        expectedAmount: deal.ccAmount,
      });
    }
    // PTO (non-PE only)
    if (!deal.isPE && deal.isPtoGranted && !deal.invoices?.pto) {
      out.push({
        ...base, milestone: "pto",
        triggerDate: deal.ptoGrantedDate,
        daysReady: daysBetweenDates(asOf, deal.ptoGrantedDate),
        expectedAmount: null, // PTO invoice amount is typically $0
      });
    }
    // PE M1
    if (
      deal.isPE && deal.isInspectionPassed &&
      (deal.peM1Status === "Approved" || deal.peM1Status === "Paid") &&
      !deal.invoices?.peM1
    ) {
      out.push({
        ...base, milestone: "peM1",
        triggerDate: deal.inspectionPassedDate,
        daysReady: daysBetweenDates(asOf, deal.inspectionPassedDate),
        expectedAmount: deal.peM1Amount,
      });
    }
    // PE M2
    if (
      deal.isPE && deal.isPtoGranted &&
      (deal.peM2Status === "Approved" || deal.peM2Status === "Paid") &&
      !deal.invoices?.peM2
    ) {
      out.push({
        ...base, milestone: "peM2",
        triggerDate: deal.ptoGrantedDate,
        daysReady: daysBetweenDates(asOf, deal.ptoGrantedDate),
        expectedAmount: deal.peM2Amount,
      });
    }
  }

  return out;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- payment-tracking.test`
Expected: all `deriveReadyToInvoice` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payment-tracking.ts src/__tests__/lib/payment-tracking.test.ts
git commit -m "feat(accounting): add deriveReadyToInvoice pure function"
```

### Task 5: Implement `deriveAccountsReceivable`

**Files:**
- Modify: `src/lib/payment-tracking.ts`
- Test: `src/__tests__/lib/payment-tracking.test.ts`

- [ ] **Step 1: Write failing tests**

Append tests:

```ts
import { deriveAccountsReceivable } from "@/lib/payment-tracking";

describe("deriveAccountsReceivable", () => {
  const withInvoice = (milestone: "da" | "cc", balanceDue: number, daysOverdue: number | null): PaymentTrackingDeal => {
    const inv: InvoiceSummary = {
      invoiceId: `${milestone}-1`, number: `INV-${milestone}`, status: "sent",
      amountBilled: 1000, amountPaid: 1000 - balanceDue, balanceDue,
      invoiceDate: "2026-03-01", dueDate: "2026-03-15", paymentDate: null,
      daysOverdue, hubspotUrl: "x",
    };
    return makeDeal({ invoices: { [milestone]: inv } });
  };

  it("buckets invoice with daysOverdue 15 into 0-30", () => {
    const result = deriveAccountsReceivable([withInvoice("da", 500, 15)]);
    expect(result).toHaveLength(1);
    expect(result[0].agingBucket).toBe("0-30");
  });

  it("buckets invoice with daysOverdue 95 into 90+", () => {
    const result = deriveAccountsReceivable([withInvoice("cc", 500, 95)]);
    expect(result[0].agingBucket).toBe("90+");
  });

  it("excludes fully-paid invoices (balanceDue === 0)", () => {
    expect(deriveAccountsReceivable([withInvoice("da", 0, 15)])).toHaveLength(0);
  });

  it("excludes voided / draft / cancelled invoices", () => {
    const d = withInvoice("da", 500, 15);
    d.invoices!.da!.status = "voided";
    expect(deriveAccountsReceivable([d])).toHaveLength(0);
  });

  it("treats negative daysOverdue (not yet due) as 0-30", () => {
    const result = deriveAccountsReceivable([withInvoice("da", 500, -5)]);
    expect(result[0].agingBucket).toBe("0-30");
    expect(result[0].daysOverdue).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- payment-tracking.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `src/lib/payment-tracking.ts`:

```ts
function computeAgingBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue >= 90) return "90+";
  if (daysOverdue >= 61) return "61-90";
  if (daysOverdue >= 31) return "31-60";
  return "0-30";
}

const AR_IGNORE_STATUSES = new Set(["draft", "voided", "cancelled", "paid"]);

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
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- payment-tracking.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payment-tracking.ts src/__tests__/lib/payment-tracking.test.ts
git commit -m "feat(accounting): add deriveAccountsReceivable with aging buckets"
```

### Task 6: Implement `derivePaymentDataMismatch`

**Files:**
- Modify: `src/lib/payment-tracking.ts`
- Test: `src/__tests__/lib/payment-tracking.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { derivePaymentDataMismatch } from "@/lib/payment-tracking";

describe("derivePaymentDataMismatch", () => {
  const paidInv: InvoiceSummary = {
    invoiceId: "1", number: "INV-1", status: "paid",
    amountBilled: 1000, amountPaid: 1000, balanceDue: 0,
    invoiceDate: "2026-03-01", dueDate: null, paymentDate: "2026-03-10",
    daysOverdue: null, hubspotUrl: "x",
  };
  const unpaidInv: InvoiceSummary = { ...paidInv, status: "sent", amountPaid: 0, balanceDue: 1000, paymentDate: null };

  it("flags property_says_unpaid_invoice_paid when deal prop Open but invoice paid", () => {
    const deals = [makeDeal({ daStatus: "Open", invoices: { da: paidInv } })];
    const result = derivePaymentDataMismatch(deals);
    expect(result).toHaveLength(1);
    expect(result[0].mismatchType).toBe("property_says_unpaid_invoice_paid");
  });

  it("flags property_says_paid_invoice_unpaid when deal prop Paid In Full but invoice has balance", () => {
    const deals = [makeDeal({ ccStatus: "Paid In Full", invoices: { cc: unpaidInv } })];
    const result = derivePaymentDataMismatch(deals);
    expect(result[0].mismatchType).toBe("property_says_paid_invoice_unpaid");
  });

  it("flags property_missing_invoice_present when prop null but paid invoice exists", () => {
    const deals = [makeDeal({ daStatus: null, invoices: { da: paidInv } })];
    expect(derivePaymentDataMismatch(deals)[0].mismatchType).toBe("property_missing_invoice_present");
  });

  it("PE status 'Paid' vs invoice unpaid also flagged", () => {
    const deals = [makeDeal({ isPE: true, peM1Status: "Paid", invoices: { peM1: unpaidInv } })];
    expect(derivePaymentDataMismatch(deals)[0].mismatchType).toBe("property_says_paid_invoice_unpaid");
  });

  it("no mismatch when property and invoice agree", () => {
    const deals = [makeDeal({ daStatus: "Paid In Full", invoices: { da: paidInv } })];
    expect(derivePaymentDataMismatch(deals)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- payment-tracking.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
export function derivePaymentDataMismatch(
  deals: PaymentTrackingDeal[]
): PaymentDataMismatchEntry[] {
  const out: PaymentDataMismatchEntry[] = [];
  const customerM: Array<{ m: Milestone; status: keyof PaymentTrackingDeal }> = [
    { m: "da", status: "daStatus" },
    { m: "cc", status: "ccStatus" },
    { m: "pto", status: "ptoStatus" },
  ];
  const peM: Array<{ m: Milestone; status: keyof PaymentTrackingDeal }> = [
    { m: "peM1", status: "peM1Status" },
    { m: "peM2", status: "peM2Status" },
  ];

  for (const deal of deals) {
    const check = (m: Milestone, side: "customer" | "pe", propStatus: string | null) => {
      const inv = deal.invoices?.[m];
      if (!inv) return;
      const status = (inv.status ?? "").toLowerCase();
      if (IGNORED_INVOICE_STATUSES.has(status)) return;
      const invPaid = inv.balanceDue === 0 && PAID_INVOICE_STATUSES.has(status);
      const propPaid = side === "customer" ? propStatus === "Paid In Full" : propStatus === "Paid";

      let type: MismatchType | null = null;
      if (!propStatus && invPaid) type = "property_missing_invoice_present";
      else if (!propPaid && invPaid) type = "property_says_unpaid_invoice_paid";
      else if (propPaid && !invPaid) type = "property_says_paid_invoice_unpaid";

      if (type) {
        out.push({
          ...entryBase(deal),
          milestone: m,
          mismatchType: type,
          dealPropertyStatus: propStatus,
          invoice: inv,
        });
      }
    };

    for (const { m, status } of customerM) check(m, "customer", deal[status] as string | null);
    for (const { m, status } of peM) check(m, "pe", deal[status] as string | null);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- payment-tracking.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payment-tracking.ts src/__tests__/lib/payment-tracking.test.ts
git commit -m "feat(accounting): add derivePaymentDataMismatch diagnostic helper"
```

### Task 7: Wire derive functions into the API route

**Files:**
- Modify: `src/app/api/accounting/payment-tracking/route.ts`

- [ ] **Step 1: Import and call**

Read current file, then modify the response-building section to include the three new arrays:

```ts
import {
  deriveReadyToInvoice,
  deriveAccountsReceivable,
  derivePaymentDataMismatch,
} from "@/lib/payment-tracking";

// ... after deals are built and invoices attached ...

const readyToInvoice = deriveReadyToInvoice(deals);
const accountsReceivable = deriveAccountsReceivable(deals);
const paymentDataMismatch = derivePaymentDataMismatch(deals);

console.log(
  `[payment-tracking] derived: ${readyToInvoice.length} ready-to-invoice, ` +
  `${accountsReceivable.length} AR entries, ${paymentDataMismatch.length} mismatches`
);

return NextResponse.json({
  lastUpdated: new Date().toISOString(),
  summary,
  deals,
  readyToInvoice,
  accountsReceivable,
  paymentDataMismatch,
} satisfies PaymentTrackingResponse);
```

- [ ] **Step 2: Run build + tests**

Run: `npm run build && npm test -- payment-tracking.test`
Expected: build succeeds, tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/accounting/payment-tracking/route.ts
git commit -m "feat(accounting): attach derived arrays to payment-tracking response"
```

---

## Chunk 3: New dashboard pages

### Task 8: Role + route setup

**Files:**
- Modify: `src/lib/roles.ts`

- [ ] **Step 1: Add routes to ACCOUNTING, OWNER, ADMIN**

In `src/lib/roles.ts`:

- Append `/dashboards/ready-to-invoice` and `/dashboards/accounts-receivable` to the `allowedRoutes` arrays for ACCOUNTING, OWNER, and ADMIN.
- Append `/dashboards/payment-data-mismatch` to ADMIN's `allowedRoutes` only.

- [ ] **Step 2: Commit**

```bash
git add src/lib/roles.ts
git commit -m "feat(accounting): add route allowlist for new pages"
```

### Task 9: Ready-to-Invoice page

**Files:**
- Create: `src/app/dashboards/ready-to-invoice/page.tsx`
- Create: `src/app/dashboards/ready-to-invoice/ReadyToInvoiceClient.tsx`

- [ ] **Step 1: Server shell**

`src/app/dashboards/ready-to-invoice/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import ReadyToInvoiceClient from "./ReadyToInvoiceClient";

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/dashboards/ready-to-invoice");
  const allowed = ["ADMIN", "OWNER", "ACCOUNTING"];
  if (!user.roles.some(r => allowed.includes(r))) redirect("/");
  return <ReadyToInvoiceClient />;
}
```

- [ ] **Step 2: Client — section-by-milestone**

`src/app/dashboards/ready-to-invoice/ReadyToInvoiceClient.tsx`:

Reference the existing `PaymentActionQueueClient.tsx` for shell, SSE, filters patterns. Grouping logic:

```tsx
const MILESTONE_LABELS: Record<Milestone, string> = {
  da: "Design Approved — ready to invoice DA",
  cc: "Construction Complete — ready to invoice CC",
  pto: "PTO Granted — ready to invoice PTO",
  peM1: "PE M1 Ready (inspection passed + PE approved)",
  peM2: "PE M2 Ready (PTO granted + PE approved)",
};

const sections = (["da", "cc", "pto", "peM1", "peM2"] as const).map(m => ({
  milestone: m,
  label: MILESTONE_LABELS[m],
  entries: filtered.filter(e => e.milestone === m),
}));
```

Hero stats: Total Milestones Ready (count), Total $ to Invoice (sum of `expectedAmount`), Oldest Milestone (max `daysReady`), Ready Today (count where `daysReady === 0`).

Table columns per section: Deal (link), Stage, Expected Amount, Days Ready, Trigger Date, Open in HubSpot.

Use `DashboardShell` with `accentColor="green"` (new-money signal) and `title="Ready to Invoice"`.

- [ ] **Step 3: Run build + dev smoke**

Run: `npm run build`
Expected: build succeeds.

Visit `http://localhost:3000/dashboards/ready-to-invoice` in dev and verify at least one section renders.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/ready-to-invoice
git commit -m "feat(accounting): add Ready to Invoice page grouped by milestone"
```

### Task 10: Accounts Receivable page

**Files:**
- Create: `src/app/dashboards/accounts-receivable/page.tsx`
- Create: `src/app/dashboards/accounts-receivable/AccountsReceivableClient.tsx`

- [ ] **Step 1: Server shell** — mirror Task 9 step 1 but for `/accounts-receivable`.

- [ ] **Step 2: Client — section-by-aging-bucket**

Sections in order: `90+`, `61-90`, `31-60`, `0-30`. Within each, sort by `daysOverdue` desc.

Columns: Deal, Milestone, Invoice #, Billed, Paid, Balance Due, Days Overdue, Invoice Link.

Hero stats: Total Outstanding (sum balanceDue across all), 90+ Days sum+count, 61–90 sum+count, 0–60 sum+count.

Use `DashboardShell` with `accentColor="red"` (overdue signal).

Invoice link uses `entry.invoice.hubspotUrl` directly.

- [ ] **Step 3: Run build + dev smoke**

Run: `npm run build`

Visit `http://localhost:3000/dashboards/accounts-receivable`.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/accounts-receivable
git commit -m "feat(accounting): add Accounts Receivable page grouped by aging bucket"
```

### Task 11: Payment Data Mismatch page (ADMIN only)

**Files:**
- Create: `src/app/dashboards/payment-data-mismatch/page.tsx`
- Create: `src/app/dashboards/payment-data-mismatch/PaymentDataMismatchClient.tsx`

- [ ] **Step 1: Server shell — ADMIN only**

```tsx
const allowed = ["ADMIN"];
if (!user.roles.some(r => allowed.includes(r))) redirect("/");
```

- [ ] **Step 2: Client — section-by-mismatch-type**

Sections:
1. "Property says unpaid, invoice paid" — most common expected
2. "Property says paid, invoice unpaid" — yellow warning
3. "Property missing, invoice present" — orange, data quality

Columns: Deal, Milestone, Deal Property Status, Invoice Status, Invoice Balance, Invoice Payment Date, Invoice Link, Deal Link.

Hero stats: Total Mismatches (count), Mismatch Rate (distinct deals with ≥1 mismatch / total deals), Most Mismatched Milestone (group by milestone, max).

Use `DashboardShell` with `accentColor="yellow"` (diagnostic).

- [ ] **Step 3: Run build + dev smoke**

Run: `npm run build`

Visit page as admin user.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/payment-data-mismatch
git commit -m "feat(accounting): add Payment Data Mismatch diagnostic page (ADMIN only)"
```

### Task 12: Wire into Accounting Suite + Action Queue link row

**Files:**
- Modify: `src/app/suites/accounting/page.tsx`
- Modify: `src/app/dashboards/payment-action-queue/PaymentActionQueueClient.tsx`

- [ ] **Step 1: Add two cards to Accounting Suite**

In `src/app/suites/accounting/page.tsx`, append to the `Tools` section:

```tsx
{
  href: "/dashboards/ready-to-invoice",
  title: "Ready to Invoice",
  description: "Work milestones hit but no invoice created yet — grouped by milestone.",
  tag: "ACCOUNTING",
  icon: "🧾",
  section: "Tools",
},
{
  href: "/dashboards/accounts-receivable",
  title: "Accounts Receivable",
  description: "Invoices sent but unpaid, grouped by aging bucket.",
  tag: "ACCOUNTING",
  icon: "⏳",
  section: "Tools",
},
```

(Mismatch page NOT added here — admins access via direct URL.)

- [ ] **Step 2: Add link-out row to Payment Action Queue**

In the Action Queue header area (above filters), add:

```tsx
<div className="flex gap-2 text-xs">
  <Link href="/dashboards/ready-to-invoice" className="text-muted hover:text-foreground">Ready to Invoice →</Link>
  <Link href="/dashboards/accounts-receivable" className="text-muted hover:text-foreground">Accounts Receivable →</Link>
</div>
```

- [ ] **Step 3: Build + smoke**

Run: `npm run build`

Visit accounting suite, verify new cards. Visit payment-action-queue, verify link row.

- [ ] **Step 4: Commit**

```bash
git add src/app/suites/accounting/page.tsx src/app/dashboards/payment-action-queue/PaymentActionQueueClient.tsx
git commit -m "feat(accounting): add suite cards + action queue navigation for new pages"
```

---

## Chunk 4: Verification

### Task 13: Full test + build + manual smoke

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: no new errors.

- [ ] **Step 3: Manual smoke against dev data**

Start: `npm run dev`

Checks:
- `/dashboards/payment-action-queue` — PE deals no longer lead with "Post-install, CC not paid" when CC invoice is actually paid.
- `/dashboards/ready-to-invoice` — non-empty, sections show deals with expected triggers.
- `/dashboards/accounts-receivable` — non-empty, sections show invoices with balances.
- `/dashboards/payment-data-mismatch` — loads as admin, denied for non-admin.

- [ ] **Step 4: Spot-check numerical consistency**

For any 3 deals in Ready to Invoice, open in HubSpot and confirm:
- Milestone trigger condition is met (e.g., Layout Approved checked)
- No invoice exists for that milestone

For any 3 entries in Accounts Receivable, open the invoice in HubSpot and confirm:
- Balance matches
- Days overdue matches

- [ ] **Step 5: Commit any smoke-fix patches**

If smoke turns up issues, fix them and commit per-issue. Otherwise proceed.

- [ ] **Step 6: Final tidy commit (if needed)**

```bash
git status
# If anything uncommitted that belongs with this feature, commit now.
```

### Task 14: Update CLAUDE.md reference

**Files:**
- Modify: `CLAUDE.md` (dashboard directory section)

- [ ] **Step 1: Add new pages to dashboard directory**

In the **Inventory & BOM** or **Executive & BI** style list — find the accounting grouping and add:

```
**Accounting**: payment-tracking, payment-action-queue, ready-to-invoice, accounts-receivable, payment-data-mismatch (admin)
```

(If accounting is not already its own row in the Dashboard Directory, add it.)

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add new accounting pages to dashboard directory"
```

---

## Review checklist (for PR)

- [ ] Invoice-first logic verified: PE deal with paid CC invoice no longer shows "Post-install, CC not paid"
- [ ] Fallback to deal property when no invoice attached — tested
- [ ] Ready to Invoice excludes deals that already have invoice attached (any state)
- [ ] AR excludes voided / draft / cancelled / paid invoices
- [ ] Mismatch page ADMIN-only; non-admin users get redirect
- [ ] All three new pages render with real data
- [ ] Existing Payment Tracking + Action Queue pages unchanged visually, improved under the hood
- [ ] Route allowlist updated in `src/lib/roles.ts` for every role that sees the pages
