# Payment Tracking Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a per-project payment progress dashboard in the Accounting Suite, plus a new `ACCOUNTING` role scoped to that suite.

**Architecture:** Two-PR rollout. PR 1 = additive Prisma enum migration (`ACCOUNTING`) applied to prod **before** PR 2 merges. PR 2 = role definition, new dashboard at `/dashboards/payment-tracking`, new API route at `/api/accounting/payment-tracking`, cache cascade wired off `deals:*`. Read-only in v1; inline status editing deferred to Phase 2.

**Tech Stack:** Next.js 16 / React 19, Prisma 7 on Neon Postgres, React Query v5, NextAuth v5 session, Tailwind v4 with theme tokens, HubSpot deal property batch-reads via `searchWithRetry()` in `src/lib/hubspot.ts`.

**Spec:** `docs/superpowers/specs/2026-04-21-payment-tracking-page-design.md`

---

## File Structure

### PR 1 — migration only
- Create: `prisma/migrations/<ts>_add_accounting_user_role/migration.sql`

### PR 2 — code

**Role layer**
- Modify: `src/lib/roles.ts` — add `ACCOUNTING` `RoleDefinition`, register in `ROLES` map.
- Modify: `src/app/suites/accounting/page.tsx` — include `ACCOUNTING` in gate.

**Domain / data layer**
- Create: `src/lib/payment-tracking.ts` — transform function, bucketing rules, summary math. Pure functions, no I/O. Heavily unit-tested.
- Create: `src/lib/payment-tracking-types.ts` — `PaymentTrackingDeal`, `PaymentBucket`, summary types.
- Create: `src/lib/payment-tracking-cache.ts` — cascade listener (mirrors `service-priority-cache.ts`).
- Modify: `src/lib/cache.ts` — register `PAYMENT_TRACKING` cache key.
- Modify: `src/lib/query-keys.ts` — add `paymentTracking` key; add mapping in `cacheKeyToQueryKeys`.

**API layer**
- Create: `src/app/api/accounting/payment-tracking/route.ts` — GET route; session + role check; HubSpot fetch; cache + cascade init.

**UI layer**
- Create: `src/app/dashboards/payment-tracking/page.tsx` — server component wrapper that authorizes then renders client.
- Create: `src/app/dashboards/payment-tracking/PaymentTrackingClient.tsx` — client component, filters, sections.
- Create: `src/app/dashboards/payment-tracking/DealSection.tsx` — reusable table section.
- Create: `src/app/dashboards/payment-tracking/StatusPill.tsx` — colored status pill for milestone states.
- Create: `src/app/dashboards/payment-tracking/PaidInFullIndicator.tsx` — the `paid_in_full` flag cell with disagreement warning.
- Modify: `src/app/suites/accounting/page.tsx` — add "Payment Tracking" card.

**Tests**
- Create: `src/__tests__/lib/payment-tracking.test.ts` — bucketing, summary math, attention reasons, `paid_in_full` ignored for bucketing, M3 vs PTO property handling.
- Create: `src/__tests__/api/accounting/payment-tracking-auth.test.ts` — role guard test (ACCOUNTING allowed, VIEWER denied, ADMIN + EXECUTIVE allowed).
- Create: `src/__tests__/lib/accounting-role-roundtrip.test.ts` — Prisma enum round-trip (catches migration-not-applied state).

---

## Chunk 1: PR 1 — Prisma enum migration

### Task 1: Generate migration file

**Files:**
- Create: `prisma/migrations/<YYYYMMDDHHMMSS>_add_accounting_user_role/migration.sql`

- [ ] **Step 1.1: Compute timestamp**

Run: `date +%Y%m%d%H%M%S`
Capture the output, e.g. `20260421180000`. Use it as the migration folder prefix.

- [ ] **Step 1.2: Create migration folder and SQL file**

Run:
```bash
cd "/Users/zach/Downloads/Dev Projects/PB-Operations-Suite"
mkdir -p "prisma/migrations/<ts>_add_accounting_user_role"
cat > "prisma/migrations/<ts>_add_accounting_user_role/migration.sql" <<'SQL'
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ACCOUNTING';
SQL
```

This mirrors `prisma/migrations/20260321000000_add_sales_manager_role/migration.sql` verbatim.

- [ ] **Step 1.3: Update `prisma/schema.prisma`**

Modify the `UserRole` enum in `prisma/schema.prisma:17-32` — add `ACCOUNTING // Accounting — Accounting Suite access only` as a new line above `VIEWER`.

Expected diff: one added line in the enum block.

- [ ] **Step 1.4: Regenerate Prisma client locally**

Run:
```bash
npx prisma generate
```

Expected: generates into `src/generated/prisma` without errors. `UserRole` in the generated enum now includes `ACCOUNTING`.

- [ ] **Step 1.5: Commit PR 1**

```bash
git add prisma/schema.prisma prisma/migrations/<ts>_add_accounting_user_role/
git commit -m "feat(migration): add ACCOUNTING user role

Additive enum value. Must be applied to prod BEFORE the code PR
that references UserRole.ACCOUNTING merges to main, or NextAuth
session loads fail on Vercel (see feedback_prisma_migration_before_code).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 1.6: ⚠️ HALT — request user approval to apply to prod**

**Do not proceed to PR 2 until the user confirms the migration is live in prod.** Run `npm run db:migrate` is the orchestrator's job — subagents must not invoke prisma migrate deploy (see `feedback_subagents_no_migrations`).

Surface to user: "PR 1 committed. Please apply migration to prod via `scripts/migrate-prod.sh` (or equivalent), then confirm before I proceed to PR 2."

---

## Chunk 2: PR 2 — Types, pure functions, tests

### Task 2: Domain types

**Files:**
- Create: `src/lib/payment-tracking-types.ts`

- [ ] **Step 2.1: Write the types file**

Exact content:

```ts
// src/lib/payment-tracking-types.ts
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
}
```

- [ ] **Step 2.2: Commit**

```bash
git add src/lib/payment-tracking-types.ts
git commit -m "feat(accounting): add payment-tracking domain types"
```

### Task 3: Pure transform function — tests first

**Files:**
- Create: `src/__tests__/lib/payment-tracking.test.ts`

- [ ] **Step 3.1: Write failing tests**

Exact content:

```ts
// src/__tests__/lib/payment-tracking.test.ts
import {
  transformDeal,
  computeSummary,
  computeBucket,
} from "@/lib/payment-tracking";
import type { HubSpotDealPaymentProps } from "@/lib/payment-tracking-types";

const BASE: HubSpotDealPaymentProps = {
  hs_object_id: "123",
  dealname: "PROJ-0001 | Test, Person | 1 Main St",
  amount: "10000",
  pb_location: "Centennial",
  dealstage: "20440343",
  closedate: "2026-03-01T00:00:00Z",
  paid_in_full: "false",
};

describe("transformDeal — non-PE", () => {
  it("parses DA + CC amounts and statuses", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        da_invoice_amount: "5000",
        da_invoice_paid: "2026-03-10",
        cc_invoice_status: "Open",
        cc_invoice_amount: "5000",
      },
      new Date("2026-04-21")
    );
    expect(deal.isPE).toBe(false);
    expect(deal.customerContractTotal).toBe(10000);
    expect(deal.customerCollected).toBe(5000);
    expect(deal.customerOutstanding).toBe(5000);
    expect(deal.daStatus).toBe("Paid In Full");
    expect(deal.daAmount).toBe(5000);
    expect(deal.daPaidDate).toBe("2026-03-10");
    expect(deal.ccStatus).toBe("Open");
  });

  it("lands in awaiting_m1 bucket when DA is Open", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Open",
        da_invoice_amount: "5000",
        cc_invoice_status: "Pending Approval",
        cc_invoice_amount: "5000",
      },
      new Date("2026-03-15") // 14 days after close — not overdue
    );
    expect(deal.bucket).toBe("awaiting_m1");
  });

  it("lands in awaiting_m2 when DA paid, CC open", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        da_invoice_amount: "5000",
        da_invoice_paid: "2026-03-10",
        cc_invoice_status: "Open",
        cc_invoice_amount: "5000",
      },
      new Date("2026-03-15")
    );
    expect(deal.bucket).toBe("awaiting_m2");
  });

  it("lands in awaiting_pto when DA + CC paid, PTO open", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Paid In Full",
        pto_invoice_status: "Open",
      },
      new Date("2026-03-15")
    );
    expect(deal.bucket).toBe("awaiting_pto");
  });

  it("lands in fully_collected when all three milestones are Paid In Full", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Paid In Full",
        pto_invoice_status: "Paid In Full",
      },
      new Date("2026-03-15")
    );
    expect(deal.bucket).toBe("fully_collected");
  });
});

describe("transformDeal — attention bucket", () => {
  it("lands in attention when any PE status is Rejected", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Paid In Full",
        pe_m1_status: "Rejected",
      },
      new Date("2026-03-15")
    );
    expect(deal.bucket).toBe("attention");
    expect(deal.attentionReasons).toContain("PE M1 Rejected");
  });

  it("lands in attention when CC is Open >30 days past close", () => {
    const deal = transformDeal(
      {
        ...BASE,
        closedate: "2026-02-01T00:00:00Z",
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Open",
        cc_invoice_amount: "5000",
      },
      new Date("2026-04-21") // ~79 days after close
    );
    expect(deal.bucket).toBe("attention");
  });
});

describe("transformDeal — PE deals", () => {
  it("detects PE and computes PE bonus", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        da_invoice_amount: "5000",
        cc_invoice_status: "Paid In Full",
        cc_invoice_amount: "5000",
        pto_invoice_status: "Paid In Full",
        pe_m1_status: "Paid",
        pe_m2_status: "Paid",
        pe_payment_ic: "6000",
        pe_payment_pc: "3000",
        pe_total_pb_revenue: "19000",
      },
      new Date("2026-04-21")
    );
    expect(deal.isPE).toBe(true);
    expect(deal.peBonusTotal).toBe(9000);
    expect(deal.peBonusCollected).toBe(9000);
    expect(deal.peBonusOutstanding).toBe(0);
    expect(deal.totalPBRevenue).toBe(19000);
    expect(deal.bucket).toBe("fully_collected");
  });

  it("lands in awaiting_pe_m1 when customer side complete and PE M1 not Paid", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Paid In Full",
        pto_invoice_status: "Paid In Full",
        pe_m1_status: "Submitted",
        pe_m2_status: "Ready to Submit",
        pe_payment_ic: "6000",
        pe_payment_pc: "3000",
      },
      new Date("2026-04-21")
    );
    expect(deal.bucket).toBe("awaiting_pe_m1");
  });

  it("lands in awaiting_pe_m2 when PE M1 paid but PE M2 not Paid", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Paid In Full",
        pto_invoice_status: "Paid In Full",
        pe_m1_status: "Paid",
        pe_m2_status: "Submitted",
        pe_payment_ic: "6000",
        pe_payment_pc: "3000",
      },
      new Date("2026-04-21")
    );
    expect(deal.bucket).toBe("awaiting_pe_m2");
  });
});

describe("transformDeal — paid_in_full flag", () => {
  it("ignores paid_in_full=true when milestones are not all Paid", () => {
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Pending Approval",
        paid_in_full: "true", // HubSpot says yes, milestones say no
      },
      new Date("2026-04-21")
    );
    expect(deal.paidInFullFlag).toBe(true);
    expect(deal.bucket).toBe("awaiting_m1");
  });

  it("parses paid_in_full=false as false", () => {
    const deal = transformDeal({ ...BASE, paid_in_full: "false" }, new Date("2026-04-21"));
    expect(deal.paidInFullFlag).toBe(false);
  });

  it("parses missing paid_in_full as null", () => {
    const { paid_in_full: _unused, ...propsWithoutFlag } = BASE;
    const deal = transformDeal(propsWithoutFlag, new Date("2026-04-21"));
    expect(deal.paidInFullFlag).toBe(null);
  });
});

describe("transformDeal — property canonicalization", () => {
  it("ignores m3_invoice_status when pto_invoice_status is blank", () => {
    // We intentionally do NOT fall back to m3_invoice_*. pto_invoice_* is canonical.
    const deal = transformDeal(
      {
        ...BASE,
        da_invoice_status: "Paid In Full",
        cc_invoice_status: "Paid In Full",
        pto_invoice_status: undefined,
        // m3_invoice_status is never read; pass through should be harmless
      } as HubSpotDealPaymentProps,
      new Date("2026-04-21")
    );
    expect(deal.ptoStatus).toBe(null);
  });
});

describe("computeSummary", () => {
  it("sums customer and PE revenue separately", () => {
    const deals = [
      transformDeal(
        {
          ...BASE,
          hs_object_id: "1",
          da_invoice_status: "Paid In Full",
          da_invoice_amount: "5000",
          cc_invoice_status: "Open",
          cc_invoice_amount: "5000",
        },
        new Date("2026-04-21")
      ),
      transformDeal(
        {
          ...BASE,
          hs_object_id: "2",
          amount: "20000",
          da_invoice_status: "Paid In Full",
          da_invoice_amount: "10000",
          cc_invoice_status: "Paid In Full",
          cc_invoice_amount: "10000",
          pto_invoice_status: "Paid In Full",
          pe_m1_status: "Paid",
          pe_m2_status: "Paid",
          pe_payment_ic: "6000",
          pe_payment_pc: "3000",
          pe_total_pb_revenue: "29000",
        },
        new Date("2026-04-21")
      ),
    ];

    const summary = computeSummary(deals);
    expect(summary.customerContractTotal).toBe(30000);
    expect(summary.customerCollected).toBe(25000); // 5k + 10k + 10k
    expect(summary.customerOutstanding).toBe(5000);
    expect(summary.peBonusTotal).toBe(9000);
    expect(summary.peBonusCollected).toBe(9000);
    expect(summary.totalPBRevenue).toBe(39000); // 10k customer deal #1 + 29k PE deal #2
    expect(summary.dealCount).toBe(2);
  });
});

describe("computeBucket — disjointness", () => {
  it("first-match-wins — attention beats milestone buckets", () => {
    const bucket = computeBucket({
      daStatus: "Paid In Full",
      ccStatus: "Paid In Full",
      ptoStatus: "Open",
      peM1Status: "Rejected", // triggers attention
      peM2Status: null,
      closeDate: "2026-03-01T00:00:00Z",
      dealStage: "20440343",
      peM1ApprovalDate: null,
      isPE: true,
      asOf: new Date("2026-04-21"),
    });
    expect(bucket.bucket).toBe("attention");
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `npm run test -- src/__tests__/lib/payment-tracking.test.ts`
Expected: FAIL with "Cannot find module '@/lib/payment-tracking'".

- [ ] **Step 3.3: Commit the tests**

```bash
git add src/__tests__/lib/payment-tracking.test.ts
git commit -m "test(accounting): failing tests for payment-tracking transform + bucketing"
```

### Task 4: Implement pure transform

**Files:**
- Create: `src/lib/payment-tracking.ts`

- [ ] **Step 4.1: Write implementation**

Exact content (long — but all of it needs to land as one file):

```ts
// src/lib/payment-tracking.ts
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
  // Post-install and CC not paid. Post-install stages per DEAL_STAGE_MAP in
  // src/lib/hubspot.ts: Inspection (22580872), Permission To Operate (20461940),
  // Close Out (24743347), Project Complete (20440343).
  const POST_INSTALL_STAGES = new Set([
    "22580872",
    "20461940",
    "24743347",
    "20440343",
  ]);
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
```

- [ ] **Step 4.2: Run tests to verify they pass**

Run: `npm run test -- src/__tests__/lib/payment-tracking.test.ts`
Expected: All tests PASS.

- [ ] **Step 4.3: Commit**

```bash
git add src/lib/payment-tracking.ts
git commit -m "feat(accounting): pure payment-tracking transform + bucketing"
```

---

## Chunk 3: PR 2 — Cache, query-keys, role registration

### Task 5: Cache key + cascade listener

**Files:**
- Modify: `src/lib/cache.ts`
- Create: `src/lib/payment-tracking-cache.ts`

- [ ] **Step 5.1: Add cache key**

Edit `src/lib/cache.ts`. Locate the `CACHE_KEYS` export block (line 256). Add `PAYMENT_TRACKING: "accounting:payment-tracking",` above the closing `} as const`.

- [ ] **Step 5.2: Write cascade listener**

Create `src/lib/payment-tracking-cache.ts` with exact content (mirrors `service-priority-cache.ts`):

```ts
// src/lib/payment-tracking-cache.ts
/**
 * Singleton cache cascade listener for the accounting payment-tracking view.
 * Watches upstream `deals:*` invalidations and debounces invalidation of the
 * payment-tracking cache.
 */

import { appCache, CACHE_KEYS } from "@/lib/cache";

const DEBOUNCE_MS = 500;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

export function initPaymentTrackingCascade(): void {
  if (initialized) return;
  initialized = true;

  appCache.subscribe((key: string, _timestamp: number) => {
    if (!key.startsWith("deals:")) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      appCache.invalidate(CACHE_KEYS.PAYMENT_TRACKING);
      debounceTimer = null;
    }, DEBOUNCE_MS);
  });
}
```

- [ ] **Step 5.3: Commit**

```bash
git add src/lib/cache.ts src/lib/payment-tracking-cache.ts
git commit -m "feat(accounting): register payment-tracking cache key + cascade"
```

### Task 6: Query keys

**Files:**
- Modify: `src/lib/query-keys.ts`

- [ ] **Step 6.1: Add paymentTracking key**

In the `queryKeys` export, add after the existing last entry but before the closing `};`:

```ts
  paymentTracking: {
    root: ["paymentTracking"] as const,
    list: () => [...queryKeys.paymentTracking.root, "list"] as const,
  },
```

- [ ] **Step 6.2: Wire into cacheKeyToQueryKeys**

In the `cacheKeyToQueryKeys` function, add near the top (before the fallback `return []`):

```ts
  if (serverKey.startsWith("accounting:payment-tracking"))
    return [queryKeys.paymentTracking.root];
```

- [ ] **Step 6.3: Commit**

```bash
git add src/lib/query-keys.ts
git commit -m "feat(accounting): register paymentTracking query key"
```

### Task 7: ACCOUNTING role definition

**Files:**
- Modify: `src/lib/roles.ts`

- [ ] **Step 7.1: Add role definition**

In `src/lib/roles.ts`, after the `VIEWER` definition (~line 829) and before `OWNER`, insert:

```ts
const ACCOUNTING: RoleDefinition = {
  label: "Accounting",
  description: "Accounting team — Accounting Suite, payment tracking, pricing tools",
  normalizesTo: "ACCOUNTING",
  visibleInPicker: true,
  suites: ["/suites/accounting"],
  allowedRoutes: [
    "/",
    "/suites/accounting",
    "/dashboards/payment-tracking",
    "/dashboards/pe-deals",
    "/dashboards/pe",
    "/dashboards/pricing-calculator",
    "/api/accounting",
    "/api/auth",
    "/api/deals",
    "/api/projects",
    "/api/session",
    "/api/stream",
  ],
  landingCards: [],
  scope: "global",
  badge: { color: "emerald", abbrev: "ACCT" },
  defaultCapabilities: {
    canScheduleSurveys: false,
    canScheduleInstalls: false,
    canScheduleInspections: false,
    canSyncZuper: false,
    canManageUsers: false,
    canManageAvailability: false,
    canEditDesign: false,
    canEditPermitting: false,
    canViewAllLocations: true,
  },
};
```

- [ ] **Step 7.2: Register in ROLES map**

In the `ROLES` map (line 927), add `ACCOUNTING,` on its own line among the other entries (placement is cosmetic, but put it alphabetically near ADMIN for readability — i.e. right after ADMIN).

- [ ] **Step 7.3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: NO errors. If the `UserRole` enum type doesn't have `ACCOUNTING`, rerun `npx prisma generate`.

- [ ] **Step 7.4: Commit**

```bash
git add src/lib/roles.ts
git commit -m "feat(accounting): register ACCOUNTING role definition"
```

### Task 8: Accounting suite gate

**Files:**
- Modify: `src/app/suites/accounting/page.tsx`

- [ ] **Step 8.1: Update allowed list + add card**

Change `const allowed = ["ADMIN", "EXECUTIVE"];` to `const allowed = ["ADMIN", "EXECUTIVE", "ACCOUNTING"];`.

Add to the `LINKS` array, as the FIRST entry (so it appears first):

```ts
  {
    href: "/dashboards/payment-tracking",
    title: "Payment Tracking",
    description: "Per-project payment progress across DA, CC, PTO, and PE milestones.",
    tag: "ACCOUNTING",
    icon: "💵",
    section: "Tools",
  },
```

- [ ] **Step 8.2: Commit**

```bash
git add src/app/suites/accounting/page.tsx
git commit -m "feat(accounting): gate in ACCOUNTING role; link Payment Tracking"
```

### Task 9: Prisma enum round-trip test

**Files:**
- Create: `src/__tests__/lib/accounting-role-roundtrip.test.ts`

- [ ] **Step 9.1: Write test**

```ts
// src/__tests__/lib/accounting-role-roundtrip.test.ts
import { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";

describe("ACCOUNTING role", () => {
  it("exists in the Prisma UserRole enum", () => {
    expect(UserRole.ACCOUNTING).toBe("ACCOUNTING");
  });

  it("has a RoleDefinition registered in ROLES", () => {
    expect(ROLES.ACCOUNTING).toBeDefined();
    expect(ROLES.ACCOUNTING.suites).toContain("/suites/accounting");
  });

  it("has /dashboards/payment-tracking in allowedRoutes", () => {
    expect(ROLES.ACCOUNTING.allowedRoutes).toContain("/dashboards/payment-tracking");
  });
});
```

- [ ] **Step 9.2: Run test**

Run: `npm run test -- src/__tests__/lib/accounting-role-roundtrip.test.ts`
Expected: PASS.

- [ ] **Step 9.3: Commit**

```bash
git add src/__tests__/lib/accounting-role-roundtrip.test.ts
git commit -m "test(accounting): Prisma enum + role registration round-trip"
```

---

## Chunk 4: PR 2 — API route

### Task 10: API route with auth + HubSpot fetch

**Files:**
- Create: `src/app/api/accounting/payment-tracking/route.ts`
- Create: `src/__tests__/api/accounting/payment-tracking-auth.test.ts`

- [ ] **Step 10.1: Look up helpers used by similar routes**

Run (for reference — do not modify):
```bash
grep -l "getCurrentUser\|searchWithRetry\|HUBSPOT_PIPELINE_" src/app/api/deals/ 2>/dev/null | head -3
```
Find a recent deals-reading route and mirror its imports.

- [ ] **Step 10.2: Write the route**

Create `src/app/api/accounting/payment-tracking/route.ts`:

```ts
// src/app/api/accounting/payment-tracking/route.ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { searchWithRetry } from "@/lib/hubspot";
import { getStageMaps } from "@/lib/deals-pipeline";
import {
  transformDeal,
  computeSummary,
  PAYMENT_TRACKING_PROPERTIES,
} from "@/lib/payment-tracking";
import { initPaymentTrackingCascade } from "@/lib/payment-tracking-cache";
import type {
  HubSpotDealPaymentProps,
  PaymentTrackingResponse,
} from "@/lib/payment-tracking-types";

// Ensure cascade listener is initialized once per process. Safe to call
// repeatedly — the listener is idempotent.
initPaymentTrackingCascade();

const ALLOWED_ROLES = new Set(["ADMIN", "EXECUTIVE", "ACCOUNTING"]);
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.roles.some((r: string) => ALLOWED_ROLES.has(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cached = appCache.get<PaymentTrackingResponse>(CACHE_KEYS.PAYMENT_TRACKING);
  if (cached) return NextResponse.json(cached);

  const salesPipeline = process.env.HUBSPOT_PIPELINE_SALES ?? "default";
  const projectPipeline = process.env.HUBSPOT_PIPELINE_PROJECT ?? "6900017";

  // Fetch deals from Sales + Project pipelines. Exclude closed-lost / dead.
  const filterGroups = [
    {
      filters: [
        { propertyName: "pipeline", operator: "IN", values: [salesPipeline, projectPipeline] },
        { propertyName: "dealstage", operator: "NOT_IN", values: ["closedlost", "closed_lost", "dead"] },
      ],
    },
  ];

  const props: HubSpotDealPaymentProps[] = [];
  let after: string | undefined;
  // Paginate via searchWithRetry — the helper handles 429 + 5xx retries.
  // searchWithRetry signature: (searchBody) => Promise<{ results, paging }>
  // The shape depends on how the existing hubspot.ts wrapper is defined; mirror
  // the pattern in /api/deals/ routes.
  for (let page = 0; page < 50; page++) {
    const body: Record<string, unknown> = {
      filterGroups,
      properties: PAYMENT_TRACKING_PROPERTIES,
      limit: 100,
    };
    if (after) body.after = after;

    const resp = await searchWithRetry(body);
    for (const r of resp.results ?? []) {
      props.push(r.properties as HubSpotDealPaymentProps);
    }
    after = resp.paging?.next?.after;
    if (!after) break;
  }

  const maps = await getStageMaps().catch(() => ({}));
  const mergedStageMap: Record<string, string> = {
    ...(maps[salesPipeline] ?? {}),
    ...(maps[projectPipeline] ?? {}),
  };

  const asOf = new Date();
  const deals = props.map((p) =>
    transformDeal(p, asOf, (stageId) => mergedStageMap[stageId] ?? stageId)
  );

  const summary = computeSummary(deals);
  const response: PaymentTrackingResponse = {
    lastUpdated: asOf.toISOString(),
    summary,
    deals,
  };

  appCache.set(CACHE_KEYS.PAYMENT_TRACKING, response, CACHE_TTL_MS);
  return NextResponse.json(response);
}
```

Note: `searchWithRetry` and `getStageMap` signatures — if they don't match exactly, adjust after running the typecheck. The correct imports/signatures are discoverable from `src/lib/hubspot.ts` and existing deal routes.

- [ ] **Step 10.3: Write auth test**

```ts
// src/__tests__/api/accounting/payment-tracking-auth.test.ts
import { GET } from "@/app/api/accounting/payment-tracking/route";

jest.mock("@/lib/auth-utils", () => ({
  getCurrentUser: jest.fn(),
}));
jest.mock("@/lib/hubspot", () => ({
  searchWithRetry: jest.fn().mockResolvedValue({ results: [], paging: undefined }),
}));
jest.mock("@/lib/deals-pipeline", () => ({
  getStageMaps: jest.fn().mockResolvedValue({}),
}));
jest.mock("@/lib/payment-tracking-cache", () => ({
  initPaymentTrackingCascade: jest.fn(),
}));

import { getCurrentUser } from "@/lib/auth-utils";

describe("/api/accounting/payment-tracking GET — auth", () => {
  beforeEach(() => jest.clearAllMocks());

  it("401 when no session", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("403 for VIEWER", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ email: "v@p.com", roles: ["VIEWER"] });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("200 for ACCOUNTING", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ email: "a@p.com", roles: ["ACCOUNTING"] });
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("200 for ADMIN", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ email: "admin@p.com", roles: ["ADMIN"] });
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("200 for EXECUTIVE", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ email: "e@p.com", roles: ["EXECUTIVE"] });
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 10.4: Run tests**

Run: `npm run test -- src/__tests__/api/accounting/payment-tracking-auth.test.ts`
Expected: PASS. If signature mismatches on `searchWithRetry` or `getStageMap`, fix imports in the route until tests pass.

- [ ] **Step 10.5: Commit**

```bash
git add src/app/api/accounting/payment-tracking/route.ts \
  src/__tests__/api/accounting/payment-tracking-auth.test.ts
git commit -m "feat(accounting): payment-tracking API route + role guard tests"
```

---

## Chunk 5: PR 2 — UI components

### Task 11: StatusPill + PaidInFullIndicator components

**Files:**
- Create: `src/app/dashboards/payment-tracking/StatusPill.tsx`
- Create: `src/app/dashboards/payment-tracking/PaidInFullIndicator.tsx`

- [ ] **Step 11.1: Write StatusPill**

```tsx
// src/app/dashboards/payment-tracking/StatusPill.tsx
import type { DaStatus, PeStatus } from "@/lib/payment-tracking-types";

type AnyStatus = DaStatus | PeStatus;

const DA_COLORS: Record<DaStatus, string> = {
  "Pending Approval": "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
  "Open": "bg-amber-500/20 text-amber-300 border-amber-500/30",
  "Paid In Full": "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

const PE_COLORS: Record<PeStatus, string> = {
  "Ready to Submit": "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
  "Waiting on Information": "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
  "Submitted": "bg-blue-500/20 text-blue-300 border-blue-500/30",
  "Resubmitted": "bg-blue-500/20 text-blue-300 border-blue-500/30",
  "Rejected": "bg-red-500/20 text-red-300 border-red-500/30",
  "Ready to Resubmit": "bg-amber-500/20 text-amber-300 border-amber-500/30",
  "Approved": "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  "Paid": "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

export function StatusPill({ status }: { status: AnyStatus | null }) {
  if (!status) return <span className="text-muted">—</span>;
  const cls = (DA_COLORS as Record<string, string>)[status] ?? (PE_COLORS as Record<string, string>)[status];
  const label = status === "Waiting on Information" ? "Waiting" : status;
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] border whitespace-nowrap ${cls ?? ""}`}
      title={status}
    >
      {label}
    </span>
  );
}
```

- [ ] **Step 11.2: Write PaidInFullIndicator**

```tsx
// src/app/dashboards/payment-tracking/PaidInFullIndicator.tsx
export function PaidInFullIndicator({
  flag,
  computedPct,
}: {
  flag: boolean | null;
  computedPct: number;
}) {
  const computedPaid = computedPct >= 99.9;
  const disagreement =
    (flag === true && !computedPaid) || (flag === false && computedPaid);

  if (flag === null) return <span className="text-muted">—</span>;

  return (
    <span className="inline-flex items-center gap-1">
      {flag ? (
        <span className="text-emerald-400" title="HubSpot paid_in_full = true">✓</span>
      ) : (
        <span className="text-muted" title="HubSpot paid_in_full = false">—</span>
      )}
      {disagreement && (
        <span
          className="text-amber-400 text-xs"
          title="HubSpot flag and milestone statuses disagree — trust the milestone statuses."
        >
          ⚠️
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 11.3: Commit**

```bash
git add src/app/dashboards/payment-tracking/StatusPill.tsx \
  src/app/dashboards/payment-tracking/PaidInFullIndicator.tsx
git commit -m "feat(accounting): StatusPill + PaidInFullIndicator components"
```

### Task 12: DealSection component

**Files:**
- Create: `src/app/dashboards/payment-tracking/DealSection.tsx`

- [ ] **Step 12.1: Write DealSection**

This is a large file but self-contained. It mirrors the `DealSection` in `src/app/dashboards/pe-deals/page.tsx` but with payment-tracking columns.

```tsx
// src/app/dashboards/payment-tracking/DealSection.tsx
"use client";

import { useState } from "react";
import type { PaymentTrackingDeal } from "@/lib/payment-tracking-types";
import { StatusPill } from "./StatusPill";
import { PaidInFullIndicator } from "./PaidInFullIndicator";

function fmt(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const LOCATION_SHORT: Record<string, string> = {
  "Centennial": "DTC",
  "Westminster": "WST",
  "Colorado Springs": "CSP",
  "San Luis Obispo": "SLO",
  "Camarillo": "CAM",
};
const shortLocation = (loc: string) => LOCATION_SHORT[loc] ?? loc.slice(0, 3).toUpperCase();

function truncate(s: string, n = 22) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

interface Props {
  title: string;
  accent: "red" | "amber" | "blue" | "cyan" | "emerald";
  deals: PaymentTrackingDeal[];
  defaultCollapsed?: boolean;
  rowLimit?: number; // for Fully Collected pagination
}

const ACCENT_BORDER: Record<Props["accent"], string> = {
  red: "border-l-red-400",
  amber: "border-l-amber-400",
  blue: "border-l-blue-400",
  cyan: "border-l-cyan-400",
  emerald: "border-l-emerald-400",
};

export function DealSection({ title, accent, deals, defaultCollapsed = false, rowLimit }: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [showAll, setShowAll] = useState(false);
  const effectiveDeals = rowLimit && !showAll ? deals.slice(0, rowLimit) : deals;
  const hidden = deals.length - effectiveDeals.length;

  return (
    <div className="mb-6">
      <div className={`flex items-baseline gap-3 mb-2 border-l-2 ${ACCENT_BORDER[accent]} pl-3`}>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-sm font-semibold text-foreground hover:text-muted"
        >
          {collapsed ? "▶" : "▼"} {title}
        </button>
        <span className="text-xs text-muted">{deals.length} deal{deals.length === 1 ? "" : "s"}</span>
      </div>
      {!collapsed && (
        <div className="bg-surface rounded-lg border border-border shadow-card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="px-2 py-1.5 text-left font-medium text-muted">Deal</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted">Loc</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted">Stage</th>
                <th className="px-2 py-1.5 text-center font-medium text-muted">Type</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted">Close</th>
                <th className="px-2 py-1.5 text-right font-medium text-muted">Contract</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted">DA</th>
                <th className="px-2 py-1.5 text-right font-medium text-muted">DA $</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted">DA Paid</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted">CC</th>
                <th className="px-2 py-1.5 text-right font-medium text-muted">CC $</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted">CC Paid</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted">PTO</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted">PE M1</th>
                <th className="px-2 py-1.5 text-right font-medium text-muted">PE M1 $</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted">PE M2</th>
                <th className="px-2 py-1.5 text-right font-medium text-muted">PE M2 $</th>
                <th className="px-2 py-1.5 text-right font-medium text-muted">Total Rev</th>
                <th className="px-2 py-1.5 text-right font-medium text-muted">Outstanding</th>
                <th className="px-2 py-1.5 text-right font-medium text-muted">%</th>
                <th className="px-2 py-1.5 text-center font-medium text-muted">Paid?</th>
              </tr>
            </thead>
            <tbody>
              {effectiveDeals.length === 0 ? (
                <tr>
                  <td colSpan={21} className="px-3 py-6 text-center text-muted">No deals</td>
                </tr>
              ) : (
                effectiveDeals.map((d) => (
                  <tr key={d.dealId} className="border-b border-border/50 hover:bg-surface-2/50">
                    <td className="px-2 py-1.5">
                      <a href={d.hubspotUrl} target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300 hover:underline" title={d.dealName}>
                        {truncate(d.dealName)}
                      </a>
                      {d.attentionReasons.length > 0 && (
                        <span className="ml-1 text-amber-400" title={d.attentionReasons.join("\n")}>⚠️</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-muted" title={d.pbLocation}>{shortLocation(d.pbLocation)}</td>
                    <td className="px-2 py-1.5 text-muted" title={d.dealStageLabel}>{truncate(d.dealStageLabel, 12)}</td>
                    <td className="px-2 py-1.5 text-center">
                      {d.isPE ? <span className="text-blue-400">PE</span> : <span className="text-muted">STD</span>}
                    </td>
                    <td className="px-2 py-1.5 text-muted">{d.closeDate ? new Date(d.closeDate).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" }) : "—"}</td>
                    <td className="px-2 py-1.5 text-right font-medium">{fmt(d.customerContractTotal)}</td>
                    <td className="px-2 py-1.5"><StatusPill status={d.daStatus} /></td>
                    <td className="px-2 py-1.5 text-right text-muted">{fmt(d.daAmount)}</td>
                    <td className="px-2 py-1.5 text-muted">{d.daPaidDate ?? "—"}</td>
                    <td className="px-2 py-1.5"><StatusPill status={d.ccStatus} /></td>
                    <td className="px-2 py-1.5 text-right text-muted">{fmt(d.ccAmount)}</td>
                    <td className="px-2 py-1.5 text-muted">{d.ccPaidDate ?? "—"}</td>
                    <td className="px-2 py-1.5"><StatusPill status={d.ptoStatus} /></td>
                    <td className="px-2 py-1.5">{d.isPE ? <StatusPill status={d.peM1Status} /> : <span className="text-muted">—</span>}</td>
                    <td className="px-2 py-1.5 text-right text-muted">{d.isPE ? fmt(d.peM1Amount) : "—"}</td>
                    <td className="px-2 py-1.5">{d.isPE ? <StatusPill status={d.peM2Status} /> : <span className="text-muted">—</span>}</td>
                    <td className="px-2 py-1.5 text-right text-muted">{d.isPE ? fmt(d.peM2Amount) : "—"}</td>
                    <td className="px-2 py-1.5 text-right font-medium text-emerald-400">{fmt(d.totalPBRevenue)}</td>
                    <td className="px-2 py-1.5 text-right text-muted">{fmt(d.customerOutstanding + (d.peBonusOutstanding ?? 0))}</td>
                    <td className="px-2 py-1.5 text-right text-muted">{d.collectedPct.toFixed(0)}%</td>
                    <td className="px-2 py-1.5 text-center"><PaidInFullIndicator flag={d.paidInFullFlag} computedPct={d.collectedPct} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {hidden > 0 && (
            <div className="px-3 py-2 text-center text-xs text-muted border-t border-border">
              <button onClick={() => setShowAll(true)} className="text-blue-400 hover:underline">
                Show {hidden} more…
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 12.2: Commit**

```bash
git add src/app/dashboards/payment-tracking/DealSection.tsx
git commit -m "feat(accounting): DealSection table component"
```

### Task 13: Client page

**Files:**
- Create: `src/app/dashboards/payment-tracking/PaymentTrackingClient.tsx`

- [ ] **Step 13.1: Write client component**

```tsx
// src/app/dashboards/payment-tracking/PaymentTrackingClient.tsx
"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { queryKeys } from "@/lib/query-keys";
import { useSSE } from "@/hooks/useSSE";
import type {
  PaymentBucket,
  PaymentTrackingDeal,
  PaymentTrackingResponse,
} from "@/lib/payment-tracking-types";
import { DealSection } from "./DealSection";

const BUCKET_META: {
  key: PaymentBucket;
  title: string;
  accent: "red" | "amber" | "blue" | "cyan" | "emerald";
  defaultCollapsed?: boolean;
  rowLimit?: number;
}[] = [
  { key: "attention", title: "🚨 Attention Needed", accent: "red" },
  { key: "awaiting_m1", title: "💼 Awaiting M1 / DA Invoice", accent: "amber" },
  { key: "awaiting_m2", title: "🔨 Awaiting M2 / CC Invoice", accent: "amber" },
  { key: "awaiting_pto", title: "📋 PTO Closeout Pending", accent: "blue" },
  { key: "awaiting_pe_m1", title: "⚡ Awaiting PE M1", accent: "cyan" },
  { key: "awaiting_pe_m2", title: "🎯 Awaiting PE M2", accent: "cyan" },
  { key: "fully_collected", title: "✅ Fully Collected", accent: "emerald", defaultCollapsed: true, rowLimit: 500 },
];

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function PaymentTrackingClient() {
  const { data, refetch } = useQuery<PaymentTrackingResponse>({
    queryKey: queryKeys.paymentTracking.list(),
    queryFn: async () => {
      const res = await fetch("/api/accounting/payment-tracking");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });

  useSSE(() => { refetch(); }, { url: "/api/stream", cacheKeyFilter: "accounting:payment-tracking" });

  const [locationFilter, setLocationFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<"all" | "pe" | "std">("all");
  const [stageFilter, setStageFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [outstandingOnly, setOutstandingOnly] = useState(true);

  const allLocations = useMemo(() => Array.from(new Set((data?.deals ?? []).map((d) => d.pbLocation).filter(Boolean))).sort(), [data?.deals]);
  const allStages = useMemo(() => Array.from(new Set((data?.deals ?? []).map((d) => d.dealStageLabel).filter(Boolean))).sort(), [data?.deals]);

  const filtered = useMemo(() => {
    const deals = data?.deals ?? [];
    return deals.filter((d) => {
      if (locationFilter.length && !locationFilter.includes(d.pbLocation)) return false;
      if (typeFilter === "pe" && !d.isPE) return false;
      if (typeFilter === "std" && d.isPE) return false;
      if (stageFilter.length && !stageFilter.includes(d.dealStageLabel)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!d.dealName.toLowerCase().includes(q) && !d.dealId.includes(q)) return false;
      }
      if (outstandingOnly && d.bucket === "fully_collected") return false;
      return true;
    });
  }, [data?.deals, locationFilter, typeFilter, stageFilter, search, outstandingOnly]);

  const byBucket = useMemo(() => {
    const out: Record<PaymentBucket, PaymentTrackingDeal[]> = {
      attention: [],
      awaiting_m1: [],
      awaiting_m2: [],
      awaiting_pto: [],
      awaiting_pe_m1: [],
      awaiting_pe_m2: [],
      fully_collected: [],
    };
    for (const d of filtered) out[d.bucket].push(d);
    return out;
  }, [filtered]);

  const summary = data?.summary;

  const csvRows = useMemo(() => {
    return filtered.map((d) => ({
      dealId: d.dealId,
      name: d.dealName,
      location: d.pbLocation,
      stage: d.dealStageLabel,
      type: d.isPE ? "PE" : "STD",
      closeDate: d.closeDate ?? "",
      contract: d.customerContractTotal,
      daStatus: d.daStatus ?? "",
      daAmount: d.daAmount ?? "",
      daPaid: d.daPaidDate ?? "",
      ccStatus: d.ccStatus ?? "",
      ccAmount: d.ccAmount ?? "",
      ccPaid: d.ccPaidDate ?? "",
      ptoStatus: d.ptoStatus ?? "",
      peM1Status: d.peM1Status ?? "",
      peM1Amount: d.peM1Amount ?? "",
      peM2Status: d.peM2Status ?? "",
      peM2Amount: d.peM2Amount ?? "",
      totalRevenue: d.totalPBRevenue,
      outstanding: d.customerOutstanding + (d.peBonusOutstanding ?? 0),
      collectedPct: d.collectedPct.toFixed(1),
      paidInFullFlag: d.paidInFullFlag === null ? "" : String(d.paidInFullFlag),
      bucket: d.bucket,
    }));
  }, [filtered]);

  return (
    <DashboardShell
      title="Payment Tracking"
      accentColor="emerald"
      lastUpdated={data?.lastUpdated}
      exportData={{ data: csvRows, filename: "payment-tracking.csv" }}
      fullWidth
    >
      {/* Summary strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <StatCard
          label="Customer Contract"
          value={summary ? fmt(summary.customerContractTotal) : "—"}
          sublabel={summary ? `Collected ${fmt(summary.customerCollected)} · Outstanding ${fmt(summary.customerOutstanding)}` : ""}
          accent="orange"
        />
        <StatCard
          label="PE Bonus Revenue"
          value={summary ? fmt(summary.peBonusTotal) : "—"}
          sublabel={summary ? `Collected ${fmt(summary.peBonusCollected)} · Outstanding ${fmt(summary.peBonusOutstanding)}` : ""}
          accent="cyan"
        />
        <StatCard
          label="Total PB Revenue"
          value={summary ? fmt(summary.totalPBRevenue) : "—"}
          sublabel={summary ? `${summary.dealCount} deals` : ""}
          accent="emerald"
        />
        <StatCard
          label="% Collected"
          value={summary ? `${summary.collectedPct.toFixed(1)}%` : "—"}
          sublabel=""
          accent="emerald"
        />
      </div>

      {/* Filter bar */}
      <div className="bg-surface rounded-lg border border-border shadow-card p-3 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <MultiSelectFilter
            label="Location"
            options={allLocations.map((l) => ({ value: l, label: l }))}
            selected={locationFilter}
            onChange={setLocationFilter}
          />
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted">Type:</span>
            {(["all", "pe", "std"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-2 py-0.5 rounded border ${typeFilter === t ? "bg-surface-elevated border-border-strong text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
          <MultiSelectFilter
            label="Stage"
            options={allStages.map((s) => ({ value: s, label: s }))}
            selected={stageFilter}
            onChange={setStageFilter}
          />
          <input
            type="text"
            placeholder="Search deal / ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-surface-2 border border-border rounded px-2 py-1 text-xs text-foreground placeholder-muted"
          />
          <label className="flex items-center gap-1 text-xs text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={outstandingOnly}
              onChange={(e) => setOutstandingOnly(e.target.checked)}
            />
            Outstanding only
          </label>
        </div>
      </div>

      {/* Sections */}
      {BUCKET_META.map((meta) => {
        const deals = byBucket[meta.key];
        if (outstandingOnly && meta.key === "fully_collected") return null;
        if (deals.length === 0) return null;
        return (
          <DealSection
            key={meta.key}
            title={meta.title}
            accent={meta.accent}
            deals={deals}
            defaultCollapsed={meta.defaultCollapsed}
            rowLimit={meta.rowLimit}
          />
        );
      })}
    </DashboardShell>
  );
}
```

- [ ] **Step 13.2: Commit**

```bash
git add src/app/dashboards/payment-tracking/PaymentTrackingClient.tsx
git commit -m "feat(accounting): PaymentTrackingClient with filters + sections"
```

### Task 14: Server wrapper page

**Files:**
- Create: `src/app/dashboards/payment-tracking/page.tsx`

- [ ] **Step 14.1: Write server component**

```tsx
// src/app/dashboards/payment-tracking/page.tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import PaymentTrackingClient from "./PaymentTrackingClient";

export default async function PaymentTrackingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/dashboards/payment-tracking");
  const allowed = new Set(["ADMIN", "EXECUTIVE", "ACCOUNTING"]);
  if (!user.roles.some((r: string) => allowed.has(r))) redirect("/");
  return <PaymentTrackingClient />;
}
```

- [ ] **Step 14.2: Run typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. Resolve any errors before proceeding.

- [ ] **Step 14.3: Run full test suite**

Run: `npm run test`
Expected: All tests PASS (payment-tracking + accounting-role-roundtrip + payment-tracking-auth).

- [ ] **Step 14.4: Commit**

```bash
git add src/app/dashboards/payment-tracking/page.tsx
git commit -m "feat(accounting): payment tracking server wrapper + role gate"
```

---

## Chunk 6: Verification

### Task 15: Local dev server smoke test

- [ ] **Step 15.1: Start dev server**

Run: `npm run dev` (background)

- [ ] **Step 15.2: Verify page renders**

Visit http://localhost:3000/dashboards/payment-tracking while logged in as an ADMIN user. Verify the page loads, shows summary StatCards and at least one non-empty section.

Take screenshot of result for the summary message.

- [ ] **Step 15.3: Verify role gate**

If you have a second account available, confirm a `VIEWER` is redirected to `/`. Otherwise skip this manual step — the integration test in Step 10.3 covers it.

- [ ] **Step 15.4: Verify CSV export**

Click "Export" on the page. Confirm the downloaded CSV has all expected columns and at least one row.

- [ ] **Step 15.5: Stop dev server**

Kill the background dev process.

- [ ] **Step 15.6: Final commit (no-op if nothing changed)**

No code change expected here — this is verification. If dev server flushed any build artifact into `.next/`, leave it untracked.

- [ ] **Step 15.7: Push branch and open PR 2**

```bash
git push -u origin HEAD
gh pr create --title "feat(accounting): payment tracking dashboard + ACCOUNTING role" --body "$(cat <<'EOF'
## Summary
- New /dashboards/payment-tracking in the Accounting Suite
- New ACCOUNTING user role scoped to the Accounting Suite
- Per-project payment progress across DA, CC, PTO, PE M1, PE M2
- Read-only in v1; inline status editing deferred to Phase 2

## Test plan
- [x] Bucketing + summary unit tests pass
- [x] API route auth guard passes for ACCOUNTING/ADMIN/EXECUTIVE, rejects VIEWER
- [x] Prisma enum round-trip test passes
- [x] Dev server smoke test: summary + sections render
- [x] CSV export works

Spec: docs/superpowers/specs/2026-04-21-payment-tracking-page-design.md
Plan: docs/superpowers/plans/2026-04-21-payment-tracking-page.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the implementer

- **HubSpot portal ID**: the `HUBSPOT_PORTAL_ID` env var is already set in prod (see `.env.example`). If not available at runtime, the transform falls back to a generic URL without breaking.
- **Stage map**: `getStageMap` in `lib/hubspot.ts` caches its result. Fetch both Sales + Project pipeline maps and merge before applying labels.
- **Pipeline filter values**: `HUBSPOT_PIPELINE_SALES` and `HUBSPOT_PIPELINE_PROJECT` must be present. If either is missing, the route falls back to a sane default rather than failing.
- **Test data**: no fixtures are committed. Tests build HubSpot property objects inline from `BASE` spreads. If you need integration-test fixtures, save them into `src/__tests__/fixtures/payment-tracking/` — do NOT commit real customer names.
- **Dep `DashboardShell`**: already exists at `src/components/DashboardShell.tsx` and accepts `title`, `accentColor`, `lastUpdated`, `exportData`, `fullWidth`. If any prop shape has changed recently, the typecheck will surface it immediately.
- **`useSSE` hook**: in `src/hooks/useSSE.ts`, signature `useSSE(callback, { url, cacheKeyFilter })`. Confirm usage matches current export; adjust if the second argument is a different shape.
- **`MultiSelectFilter`**: in `src/components/ui/MultiSelectFilter.tsx`. The `options` prop takes `{ value, label }[]`. Verify field names if the component has evolved.
