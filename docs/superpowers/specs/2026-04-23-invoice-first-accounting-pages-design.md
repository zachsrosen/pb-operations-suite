# Invoice-First Accounting Pages — Design

**Date:** 2026-04-23
**Author:** Zach Rosen (with Claude)
**Status:** Draft — pending review
**Branch:** TBD (new branch off `main`)

## Problem

The Payment Action Queue at [`/dashboards/payment-action-queue`](../../../src/app/dashboards/payment-action-queue/PaymentActionQueueClient.tsx) surfaces the right deals, but has three issues accounting has called out:

1. **Wrong reason for PE deals.** Rows with the PE badge lead with "Post-install, CC not paid", but for most of them the actual blocker is PE M1/M2 not yet paid. The "Why" rule in [`payment-tracking.ts:122-131`](../../../src/lib/payment-tracking.ts:122) fires whenever `cc_invoice_status !== "Paid In Full"` — regardless of whether the invoice record is actually paid.
2. **Reasoning reads stale deal properties, not invoice records.** `computeBucket` uses deal-level status properties (`da_invoice_status`, `cc_invoice_status`, `pe_m1_status`, etc.). These lag or disagree with the actual HubSpot Invoice records that accounting marks paid. Invoice data is already fetched per deal by [`payment-tracking-invoices.ts`](../../../src/lib/payment-tracking-invoices.ts) but only used for money reconciliation, not bucketing.
3. **Two different jobs are conflated into one queue.** "Work is done, please create an invoice" and "Invoice is out, please chase payment" are distinct accounting workflows with distinct SLAs, and need their own views.

## Goals

1. Switch payment attention logic from deal-property-based to invoice-record-based, with deal properties as fallback when no invoice is attached.
2. Add a **Ready to Invoice** page grouped by milestone (DA / CC / PTO / PE M1 / PE M2) so accounting can batch invoice creation.
3. Add an **Accounts Receivable** page grouped by aging bucket (0–30 / 31–60 / 61–90 / 90+) so accounting can prioritize collection.
4. Add a **Payment Data Mismatch** audit page (admin-visible) that surfaces deals where the deal property status disagrees with the invoice record status, so we can track how often the two diverge and whether any upstream HubSpot workflow needs fixing.
5. Existing Payment Tracking overview and Payment Action Queue keep working; their numbers tie out against the new pages.

## Non-goals

- Creating or sending invoices from the dashboard — all invoice creation still happens in HubSpot.
- Writing back to deal properties to reconcile mismatches — the mismatch page is diagnostic only.
- Changing the Payment Tracking overview page structure.
- Mobile-optimized layouts — desktop-first, same as existing accounting pages.
- Building new aging buckets for PE milestones — AR aging uses `hs_days_overdue` from the invoice, which works uniformly for all milestones.

## Terminology

Client-facing labels stay plain English regardless of underlying property names:

| UI label | HubSpot source |
|---|---|
| Design Approved | `layout_approved` (boolean) + `layout_approval_date` |
| Construction Complete | `construction_complete_date` + `dealstage` past Construction |
| PTO Granted | `pto_granted_date` OR `pto_status = "PTO"` |
| Inspection Passed | `inspection_passed_date` |
| DA / CC / PTO / PE M1 / PE M2 | Milestone names used throughout |

## Architecture

### Data flow (after the change)

```
/api/accounting/payment-tracking
  ├─ fetches deals (HubSpot)
  ├─ attaches invoices per milestone (payment-tracking-invoices.ts — already exists)
  ├─ reconcileMoneyWithInvoices (already exists, unchanged)
  └─ computeBucket (CHANGED — now invoice-first)
       ├─ effectivePaidStatus(milestone) →
       │     1. invoice.balanceDue === 0 && invoice.status ∈ {paid, …} → "paid"
       │     2. invoice attached, balanceDue > 0 → "invoiced_unpaid"
       │     3. no invoice attached → fallback to deal property
       │         ("Paid In Full" / "Paid" → "paid", else "not_invoiced")
       └─ uses effectivePaidStatus in every rule
```

### Derived lists (new)

Three new derived arrays computed once per response and reused across pages:

```ts
readyToInvoice: Array<{
  dealId: string;
  milestone: "da" | "cc" | "pto" | "peM1" | "peM2";
  triggerDate: string;          // e.g. layout_approval_date
  daysReady: number;            // now - triggerDate
  expectedAmount: number | null;
  deal: PaymentTrackingDeal;
}>

accountsReceivable: Array<{
  dealId: string;
  milestone: "da" | "cc" | "pto" | "peM1" | "peM2";
  invoice: InvoiceSummary;      // already in PaymentTrackingDeal.invoices
  agingBucket: "0-30" | "31-60" | "61-90" | "90+";
  daysOverdue: number;
  deal: PaymentTrackingDeal;
}>

paymentDataMismatch: Array<{
  dealId: string;
  milestone: "da" | "cc" | "pto" | "peM1" | "peM2";
  dealPropertyStatus: string;   // e.g. "Open"
  invoiceStatus: string;        // e.g. "paid"
  invoiceBalanceDue: number;
  mismatchType: "property_says_unpaid_invoice_paid" | "property_says_paid_invoice_unpaid" | "property_missing_invoice_present";
  deal: PaymentTrackingDeal;
}>
```

These are computed server-side in the same route and returned on the existing `PaymentTrackingResponse`. Client pages filter/group; they don't re-derive.

### Ready-to-invoice trigger rules

A milestone is "ready" when its trigger condition is met AND no invoice is attached for that milestone (`deal.invoices[milestone] === undefined`):

| Milestone | Trigger |
|---|---|
| DA | `layout_approved = true` |
| CC | `construction_complete_date` populated OR `dealstage` in Inspection/PTO/CloseOut/Complete |
| PTO (non-PE only) | `pto_granted_date` populated OR `pto_status = "PTO"` |
| PE M1 (PE only) | `inspection_passed_date` populated AND `pe_m1_status ∈ {Approved, Paid}` |
| PE M2 (PE only) | `pto_granted_date` populated AND `pe_m2_status ∈ {Approved, Paid}` |

Note for PE M1/M2: "ready to invoice" requires PE-side approval of our documents. If PE status is `Submitted` / `Rejected` / etc., that's an ops issue (not an accounting issue) and stays out of this queue.

### AR aging rule

A milestone is "AR" when an invoice is attached AND `invoice.balanceDue > 0` AND `invoice.status ∉ {voided, draft}`. Aging bucket derives from `hs_days_overdue` — which HubSpot computes against the invoice's due date — falling back to `invoice_date` when `hs_days_overdue` is null.

### Mismatch detection

For each of the 5 milestones, compute both:
- `propertyPaid` = deal property indicates paid (`"Paid In Full"` for customer milestones; `"Paid"` for PE)
- `invoicePaid` = invoice attached AND `balanceDue === 0` AND status indicates paid

Mismatch types:
- `property_says_unpaid_invoice_paid` — invoice was paid but deal property didn't update (most common expected case)
- `property_says_paid_invoice_unpaid` — deal property was manually set but invoice shows balance owed (suspicious; possible data entry error)
- `property_missing_invoice_present` — invoice exists with paid status but deal property is null/empty

Log a count to `console.log` on every request so we can trend frequency over time. Future enhancement: persist to DB for trend charts, but v1 is point-in-time.

## Pages

### 1. Ready to Invoice — `/dashboards/ready-to-invoice`

Sections (collapsible, rendered in milestone order):

1. **Design Approved — ready to invoice DA** (`layout_approved = true`, no DA invoice)
2. **Construction Complete — ready to invoice CC** (CC trigger met, no CC invoice)
3. **PTO Granted — ready to invoice PTO** (non-PE only, no PTO invoice)
4. **PE M1 Ready — inspection passed + PE approved** (PE only, no PE M1 invoice)
5. **PE M2 Ready — PTO granted + PE approved** (PE only, no PE M2 invoice)

Columns: Deal, Stage, Expected Amount, Days Ready, "Open in HubSpot" link (deep-linked to create-invoice UI when possible).

Hero stats: 4-up grid
- Total Milestones Ready (count)
- Total $ to Invoice (sum of expected amounts across all milestones)
- Oldest Milestone (max daysReady)
- Ready Today (count with daysReady = 0)

Filters: Location (multi-select), Deal Type (PE / Standard / All), Milestone (multi-select). Sorts per section.

### 2. Accounts Receivable — `/dashboards/accounts-receivable`

Sections (collapsible, by aging bucket):

1. **90+ days overdue** — sorted by daysOverdue desc
2. **61–90 days** — sorted by daysOverdue desc
3. **31–60 days** — sorted by daysOverdue desc
4. **0–30 days** — sorted by daysOverdue desc (includes not-yet-overdue invoices)

Columns: Deal, Milestone, Invoice #, Billed, Paid, Balance Due, Days Overdue, Invoice Link.

Hero stats: 4-up grid
- Total Outstanding (sum of balanceDue)
- 90+ Days (sum + count)
- 61–90 (sum + count)
- 0–60 (sum + count)

Filters: Location, Deal Type, Milestone. Sort within each section.

### 3. Payment Data Mismatch — `/dashboards/payment-data-mismatch`

Admin/Accounting only. Sections by mismatch type:

1. **Property says unpaid, invoice paid** — highlight invoice.paymentDate vs. dealProperty value
2. **Property says paid, invoice unpaid** — yellow warning, investigate
3. **Property missing, invoice present** — orange, data quality issue

Columns: Deal, Milestone, Deal Property Status, Invoice Status, Invoice Balance, Invoice Payment Date, Link to Invoice, Link to Deal.

Hero stats: 3-up
- Total Mismatches (count)
- Mismatch Rate (% of deals with ≥1 mismatch)
- Most Mismatched Milestone (e.g., "CC: 42 deals")

No filters beyond location. Pure diagnostic view.

## Impact on existing pages

### Payment Action Queue (`/dashboards/payment-action-queue`)

- Stays as-is visually.
- Under the hood, uses invoice-first bucketing, so PE rows stop mis-leading with "Post-install, CC not paid" when CC is actually paid on the invoice record.
- Add a breadcrumb/link-out row: "Split view: [Ready to Invoice] [Accounts Receivable] [Data Mismatches]" so accounting can navigate to the focused pages.

### Payment Tracking (`/dashboards/payment-tracking`)

- No behavior change. Same data, same layout.
- Milestone strip already uses invoice data; this spec doesn't touch it.

## Role access

All four pages (existing + new) visible to `ADMIN`, `OWNER`, `ACCOUNTING`. Data Mismatch additionally visible to `ADMIN` only (so non-admin accounting users aren't confused by diagnostic data they can't act on).

Route additions to `src/lib/roles.ts`:
- `/dashboards/ready-to-invoice` — ADMIN, OWNER, ACCOUNTING
- `/dashboards/accounts-receivable` — ADMIN, OWNER, ACCOUNTING
- `/dashboards/payment-data-mismatch` — ADMIN only
- API: existing `/api/accounting/payment-tracking` already covers these (same response).

Suite card additions to Accounting Suite landing page.

## Testing strategy

### Unit tests — `src/__tests__/lib/payment-tracking.test.ts`

Add fixtures for:
- PE deal where CC invoice is Paid but `cc_invoice_status` = "Open" → invoice-first correctly excludes from CC-unpaid reason
- PE deal where `pe_m1_status` = "Paid" but no PE M1 invoice attached → falls back to deal property correctly
- Non-PE deal where DA invoice has `balanceDue === 0` and `status = "paid"` → effectivePaidStatus returns "paid"
- Deal with no invoices attached at all → falls back to deal properties (unchanged behavior)
- Mismatch: `da_invoice_status = "Open"` + DA invoice `balanceDue = 0` → flagged `property_says_unpaid_invoice_paid`
- Mismatch: `pe_m1_status = "Paid"` + PE M1 invoice `balanceDue > 0` → flagged `property_says_paid_invoice_unpaid`

Ready-to-invoice derivations:
- `layout_approved = true` + no DA invoice → ready
- `layout_approved = true` + DA invoice attached (any state) → NOT ready
- PE deal + `pe_m1_status = "Approved"` + `inspection_passed_date` + no PE M1 invoice → ready
- PE deal + `pe_m1_status = "Submitted"` + inspection passed → NOT ready (PE-side not done)

AR derivations:
- Invoice `balanceDue > 0` + `daysOverdue = 15` → bucket "0-30"
- Invoice `balanceDue > 0` + `daysOverdue = 95` → bucket "90+"
- Invoice `balanceDue = 0` → NOT in AR

### Integration / manual smoke

- Load each new page against live HubSpot data, verify counts tie out:
  - `readyToInvoice.length + accountsReceivable.length` ≈ Payment Action Queue attention count (minor differences acceptable — e.g., pure "property mismatch with no invoice" rows sit in Mismatch only).
- Spot-check 3 PE deals that previously showed "Post-install, CC not paid" — confirm the Why column now reads correctly after invoice-first switch.
- Spot-check 3 non-PE deals in Ready to Invoice with `layout_approved = true` — confirm they're missing a DA invoice in HubSpot.

## Open questions

1. **AR aging — should we exclude voided / draft invoices?** Proposal: yes, by filtering `invoice.status ∉ {"draft", "voided", "cancelled"}`. Accounting teams typically don't chase voided invoices.
2. **Data Mismatch page — ADMIN only or ACCOUNTING too?** Proposal: ADMIN only for v1 (diagnostic / data-quality tooling). Can widen later if accounting wants it.
3. **Persist mismatch counts for trending?** Out of scope for v1. If the number is big, we add a daily cron that snapshots to a new `PaymentDataMismatchSnapshot` table.
4. **Linking into HubSpot invoice creation UI** — HubSpot doesn't expose a deep link for "create invoice for this deal pre-filled with milestone X". For v1, the "Open in HubSpot" button links to the deal record; accounting clicks into invoices tab manually. Not worth trying to deep-link until we confirm HubSpot supports it.

## Risks

- **Invoice-first change alters bucket counts.** Some deals will shift between `awaiting_m1` / `attention` / `fully_collected`. We should ship the new pages first (additive), then flip the existing action queue to invoice-first in a follow-up commit so the change is reviewable independently.
- **Response payload size.** Three new derived arrays get appended. They reference the same deals (array of summaries, not full deal objects). Expected size increase ~10% of existing response. Acceptable.
- **New page ≠ new data cost.** All three pages hit the same existing endpoint, so no additional HubSpot API load.

## Success criteria

1. A PE deal with CC invoice Paid (balanceDue 0) no longer shows "Post-install, CC not paid" in any view.
2. Ready-to-Invoice page shows at least one deal per milestone for recent data (spot check against HubSpot).
3. AR totals tie out: sum of all AR rows × `balanceDue` ≈ sum of `customerOutstanding + peBonusOutstanding` across deals.
4. Data Mismatch page shows a non-zero count, and each entry is clickable to both the invoice record and the deal.
5. No regression on existing Payment Tracking or Payment Action Queue pages.
