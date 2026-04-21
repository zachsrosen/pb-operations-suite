# Payment Tracking Page — Design

**Date:** 2026-04-21
**Author:** Zach Rosen (with Claude)
**Status:** Draft — pending review
**Branch:** TBD (new branch off `main`)

## Problem

Accounting currently has no single per-project view of payment progress. Milestone payment statuses and amounts live on HubSpot deal properties (`da_invoice_status`, `cc_invoice_status`, `pto_invoice_status`, `pe_m1_status`, `pe_m2_status`, plus amount/date siblings), but there is no dashboard that pulls them together. The `pe-deals` page is close, but it is PE-only and does not show the non-PE invoice stream (DA / CC / PTO).

The user wants one page, in the Accounting Suite, where every active project is visible with its contract amount, milestone statuses, amounts, and paid dates — grouped by what's outstanding so the team can see where to push.

## Goals

1. Single page in the Accounting Suite showing all active projects with payment progress in one scannable view.
2. Mirror the `pe-deals` visual pattern (sectioned tables, sort, multi-select filters) for consistency.
3. Read from HubSpot deal properties (canonical source) — no new schema beyond the new role.
4. Add a new `ACCOUNTING` role with scope limited to the Accounting Suite.
5. Read-only in v1. Phase 2 will add inline status editing, re-using the existing `StatusDropdown` pattern from `pe-deals`.

## Non-goals

- Payment collection actions (send reminders, generate invoices) — out of scope; belongs in HubSpot workflows.
- Historical payment timeline / ledger — v1 shows only current state, not every event.
- Editing amounts or paid dates inline — all edits continue in HubSpot directly.
- Mobile-optimized layout — desktop-first, same as `pe-deals`.
- Rebuilding `pe-deals` or `pe` dashboards.

## HubSpot property map (validated against live data)

Validated on 2026-04-21 via HubSpot MCP against real deals (82 PE deals with `pe_m1_status` populated; 1,490 non-PE deals with `da_invoice_status=Paid In Full`).

### Non-PE milestones — Customer contract billing

| Milestone | Status property | Amount property | Paid date property | Memo property |
|---|---|---|---|---|
| **M1 / DA Invoice** | `da_invoice_status` | `da_invoice_amount` | `da_invoice_paid` | `da_invoice_memo` |
| **M2 / CC Invoice** | `cc_invoice_status` | `cc_invoice_amount` | `cc_invoice_paid` | — |
| **M3 / PTO Invoice** | `pto_invoice_status` | `pto_invoice_amount` (almost always $0) | `pto_invoice_paid` | `pto_invoice_memo` |

**Status enum (all three):** `Pending Approval` → `Open` → `Paid In Full`.

**Canonical M3 = PTO, not `m3_invoice_*`.** Both sets exist in HubSpot, but `m3_invoice_status` / `m3_invoice_paid` are blank on recent deals and have no supporting amount/memo fields. `pto_invoice_*` is the live set.

**Contract split observed:** `da_invoice_amount` + `cc_invoice_amount` = `deal.amount` (50/50 split is typical, e.g. $14,070 → $7,035 + $7,035). PTO invoice amount is $0 in 100% of sampled non-PE deals; treat PTO as a status-only closeout gate with no dollar column.

### PE milestones — Additional revenue from Participate Energy (on top of customer contract)

| Milestone | Status property | Amount property | Approval date | Rejection date | Submission date |
|---|---|---|---|---|---|
| **PE M1 (IC payment)** | `pe_m1_status` | `pe_payment_ic` (auto-calc) | `pe_m1_approval_date` | `pe_m1_rejection_date` | `pe_m1_submission_date` |
| **PE M2 (PC payment)** | `pe_m2_status` | `pe_payment_pc` (auto-calc) | `pe_m2_approval_date` | `pe_m2_rejection_date` | `pe_m2_submission_date` |

**Status enum (both):** `Ready to Submit` → `Waiting on Information` → `Submitted` → `Rejected` → `Ready to Resubmit` → `Resubmitted` → `Approved` → `Paid` (8 states, same as `pe-deals`).

**Revenue model:** PE deals still collect the full `deal.amount` from the customer via DA + CC. PE M1 + PE M2 are additional payments from the PE program, stacking on top. Example: PROJ-9473 — `amount=$28,728` (DA $14,364 + CC $14,364, both Paid In Full), plus `pe_payment_ic=$6,703` + `pe_payment_pc=$3,352` = **$38,783 total PB revenue** vs $28,728 customer contract. Summary must separate these flows.

`pe_total_pb_revenue` is auto-calculated by HubSpot and is the source of truth for total PB revenue per PE deal.

### Fields NOT trusted

- `paid_in_full` (string "true"/"false") — confirmed unreliable. Example: PROJ-8827 has `paid_in_full=true` but `pe_m1_status=Ready to Submit`. **Computed completion must use per-milestone statuses only.**
- `m3_invoice_status`, `m3_invoice_paid` — legacy duplicates of `pto_invoice_*`. Do not read.

## Architecture

### Data layer

**New API route:** `GET /api/accounting/payment-tracking`

- Auth: requires session + role in `[ADMIN, EXECUTIVE, ACCOUNTING]`. 403 otherwise.
- Pulls deals from HubSpot using `searchWithRetry()` in `lib/hubspot.ts`:
  - Pipelines: Sales (`HUBSPOT_PIPELINE_SALES`) + Project (`HUBSPOT_PIPELINE_PROJECT`). D&R and Roofing pipelines excluded — no invoice milestones there.
  - Filter: `dealstage` not in the `closed lost` / `dead` stages. All active stages included (sales through post-PTO).
  - Batch-reads all payment properties plus `dealname`, `amount`, `pb_location`, `dealstage`, `closedate`, `hs_object_id`, `payment_method`, and an identifier for PE (`pe_m1_status` populated is the marker).
- Server-side transform computes per-deal:
  - `isPE: boolean` — any PE status property is non-null.
  - `customerContractTotal: number` — from `deal.amount`.
  - `customerCollected: number` — sum of `da_invoice_amount` and `cc_invoice_amount` where status is `Paid In Full`.
  - `customerOutstanding: number` — `customerContractTotal - customerCollected`.
  - `peBonusTotal: number | null` — `pe_payment_ic + pe_payment_pc` (PE only).
  - `peBonusCollected: number | null` — sum of PE payments where status is `Paid`.
  - `peBonusOutstanding: number | null`.
  - `totalPBRevenue: number` — prefer `pe_total_pb_revenue` when PE, else `customerContractTotal`.
  - `collectedPct: number` — `(customerCollected + (peBonusCollected ?? 0)) / (customerContractTotal + (peBonusTotal ?? 0))`.
  - `bucket: PaymentBucket` — enum assigned by the bucketing function below.
  - `attentionReasons: string[]` — for attention-bucketed deals (e.g., "PE M1 Rejected", "M2 open >30 days post-install", "Stuck post-PTO").
- Cache: `accounting:payment-tracking`, TTL 5 min. SSE invalidation cascades from `deals:*` upstream events — wire this the same way the service priority queue does (cascade listener in `src/lib/cache.ts`, 500ms debounce to avoid thundering herd on bulk webhooks).
- Add `queryKeys.paymentTracking` to `src/lib/query-keys.ts` for client React Query integration.
- Response shape:
  ```ts
  {
    lastUpdated: string; // ISO
    summary: {
      customerContractTotal: number;
      customerCollected: number;
      customerOutstanding: number;
      peBonusTotal: number;
      peBonusCollected: number;
      peBonusOutstanding: number;
      totalPBRevenue: number;
      collectedPct: number;
      dealCount: number;
    };
    deals: PaymentTrackingDeal[]; // see type below
  }
  ```

**`PaymentTrackingDeal` type** (mirrors existing `PeDeal` style):
```ts
interface PaymentTrackingDeal {
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

  // Non-PE milestones (always present, PE too)
  daStatus: "Pending Approval" | "Open" | "Paid In Full" | null;
  daAmount: number | null;
  daPaidDate: string | null;
  daMemo: string | null;

  ccStatus: "Pending Approval" | "Open" | "Paid In Full" | null;
  ccAmount: number | null;
  ccPaidDate: string | null;

  ptoStatus: "Pending Approval" | "Open" | "Paid In Full" | null;
  ptoMemo: string | null;

  // PE-only (null when !isPE)
  peM1Status: string | null; // 8-state enum
  peM1Amount: number | null; // pe_payment_ic
  peM1ApprovalDate: string | null;
  peM1RejectionDate: string | null;

  peM2Status: string | null;
  peM2Amount: number | null; // pe_payment_pc
  peM2ApprovalDate: string | null;
  peM2RejectionDate: string | null;

  peBonusTotal: number | null;
  peBonusCollected: number | null;
  peBonusOutstanding: number | null;

  totalPBRevenue: number;
  collectedPct: number;
  bucket: PaymentBucket;
  attentionReasons: string[];

  // HubSpot's own paid-in-full flag, shown for reference alongside the computed
  // completion state. NOT used to determine bucket — see "Fields NOT trusted".
  paidInFullFlag: boolean | null; // parsed from `paid_in_full` string property

  hubspotUrl: string;
}

type PaymentBucket =
  | "attention"
  | "awaiting_m1"
  | "awaiting_m2"
  | "awaiting_pto"
  | "awaiting_pe_m1"
  | "awaiting_pe_m2"
  | "fully_collected";
```

### Bucketing rules (first match wins, checked top to bottom)

Define "**customer side complete**" = `daStatus=Paid In Full` AND `ccStatus=Paid In Full`. PTO status is not a prerequisite — PE M1 submissions often run in parallel with PTO closeout, so PE buckets do not require `ptoStatus=Paid In Full`.

1. **`attention`** — any of:
   - Any PE status = `Rejected`.
   - Any invoice status = `Open` for >30 days past `closedate`.
   - `dealstage` is post-install (install complete / inspection / PTO) AND `ccStatus` ≠ `Paid In Full`.
   - PE deal with `peM1Status=Paid` for >14 days but `peM2Status` still in pre-submit states (`Ready to Submit` / `Waiting on Information`).
2. **`awaiting_m1`** — `daStatus` ≠ `Paid In Full`.
3. **`awaiting_m2`** — `daStatus=Paid In Full` AND `ccStatus` ≠ `Paid In Full`.
4. **`awaiting_pto`** — customer side complete AND `ptoStatus` ≠ `Paid In Full` AND (not a PE deal OR PE side not yet meaningful — i.e., `peM1Status` is null or `Ready to Submit`). Non-PE deals end here if PTO isn't closed; PE deals with active PE progress skip to PE buckets even if PTO is still open.
5. **`awaiting_pe_m1`** — PE deal AND customer side complete AND `peM1Status` ≠ `Paid`.
6. **`awaiting_pe_m2`** — PE deal AND customer side complete AND `peM1Status=Paid` AND `peM2Status` ≠ `Paid`.
7. **`fully_collected`** — all applicable milestones terminal (non-PE: DA/CC/PTO all `Paid In Full`; PE: same plus PE M1 and PE M2 = `Paid`).

Bucket conditions are checked top to bottom; first match wins. The ordering above makes them effectively disjoint: attention traps problem deals first, then each milestone-gap bucket tests a condition that later buckets assume already satisfied.

### UI layer

**Page:** `src/app/dashboards/payment-tracking/page.tsx` (`"use client"`).

Wrap in `<DashboardShell title="Payment Tracking" accentColor="emerald" fullWidth>`. Include CSV export via `exportData` prop.

**Sections (top to bottom):**
1. Summary strip — 4 `StatCard`s across top:
   - Customer Contract (total / collected / outstanding, stacked)
   - PE Bonus (total / collected / outstanding, stacked; muted when no PE in filter)
   - Total PB Revenue
   - % Collected (large percent, gauge-style)
2. Filter bar — reuses `MultiSelectFilter`:
   - Location multi-select
   - Project type: All / PE only / Non-PE only (radio)
   - Status bucket multi-select (all buckets shown)
   - Stage multi-select (derived from returned deal stages)
   - Close date range (two date inputs)
   - Search (name / deal ID / address substring)
   - "Outstanding only" toggle (default ON) — hides `fully_collected` bucket
3. Sectioned tables — one collapsible section per bucket. Each section renders a `<DealSection>` component modeled after `pe-deals` but with payment-tracking columns. Fully Collected is collapsed by default; if its expanded row count is >500, render it with a simple "Show all N" pagination (load first 500, click to reveal rest) rather than React-window — keeps implementation simple and matches the pattern used elsewhere.

**Section order and headers:**
- 🚨 Attention Needed (expanded, red accent border-l)
- 💼 Awaiting M1 / DA Invoice (expanded, amber accent)
- 🔨 Awaiting M2 / CC Invoice (expanded, amber)
- 📋 PTO Closeout Pending (expanded, blue)
- ⚡ Awaiting PE M1 (expanded, cyan)
- 🎯 Awaiting PE M2 (expanded, cyan)
- ✅ Fully Collected (collapsed, emerald)

**Row columns** (sortable):
- Deal (link to HubSpot, truncated with full-name tooltip)
- Loc (short code)
- Stage (truncated, full label in tooltip)
- Type (PE / STD chip)
- Close date
- Contract $
- DA: status pill · amount · paid date (or `—`)
- CC: status pill · amount · paid date
- PTO: status pill only
- PE M1: status pill · amount · paid date (blank for non-PE)
- PE M2: status pill · amount · paid date (blank for non-PE)
- Total Revenue
- Collected / Outstanding / %
- **Paid In Full?** — compact indicator sourced from HubSpot's `paid_in_full` string property.
  - `true` → emerald ✓ pill
  - `false` → muted dash
  - `null` → `—`
  - If the HubSpot flag disagrees with the computed completion (`collectedPct=100` vs flag=`false`, or vice versa), add a ⚠️ warning icon alongside the pill with a tooltip reading "HubSpot flag and milestone statuses disagree — trust the milestones." This exposes the data-quality issue visibly so accounting can fix it at the source in HubSpot rather than hiding it.

Status pill colors (reuse Tailwind pills already in use):
- DA/CC/PTO: `Pending Approval` → zinc, `Open` → amber, `Paid In Full` → emerald
- PE M1/M2: `Ready to Submit` / `Waiting on Information` → zinc, `Submitted` / `Resubmitted` → blue, `Rejected` → red, `Ready to Resubmit` → amber, `Approved` → cyan, `Paid` → emerald

Use the exact HubSpot enum value `"Waiting on Information"` as the source of truth; the pill label can abbreviate to "Waiting" if space is tight but the underlying value must match HubSpot exactly when sent back (Phase 2 inline edit).

**Attention rows** display a small inline badge listing `attentionReasons[0]` with a tooltip for the full list.

### Role layer

**New role: `ACCOUNTING`.**

- Prisma migration: additive `ALTER TYPE "UserRole" ADD VALUE 'ACCOUNTING'`. Additive enum changes are safe and reversible by dropping usage before removal. Migration file will be added but not applied automatically — orchestrator applies with user approval per repo conventions.
- **Critical ordering:** the migration must be applied to production **BEFORE the code PR that references `UserRole.ACCOUNTING` merges to `main`.** Vercel regenerates the Prisma client on build; if the production database's `UserRole` enum lacks `ACCOUNTING`, any query that touches `User.roles` fails — including NextAuth session loading — which takes the whole app down. This is a hard rule (see `feedback_prisma_migration_before_code.md` in user memory).
- `src/lib/roles.ts` — add `ACCOUNTING` `RoleDefinition`:
  - `label: "Accounting"`, badge `{ color: "emerald", abbrev: "ACCT" }`, `scope: "global"`, `visibleInPicker: true`.
  - `suites: ["/suites/accounting"]`.
  - `allowedRoutes: ["/", "/suites/accounting", "/dashboards/payment-tracking", "/dashboards/pe-deals", "/dashboards/pe", "/dashboards/pricing-calculator", "/api/accounting", "/api/accounting/payment-tracking", "/api/auth", "/api/deals", "/api/projects", "/api/session"]` plus any baseline routes mirrored from other narrow roles.
  - `defaultCapabilities`: all false.
  - `normalizesTo: "ACCOUNTING"`.
- **Also add the new routes to existing roles that should reach them** (critical — middleware silently returns 403 if a route is absent from a role's `allowedRoutes`; see `feedback_api_route_role_allowlist.md`):
  - `ADMIN.allowedRoutes` — add `"/dashboards/payment-tracking"`.
  - `EXECUTIVE.allowedRoutes` — add `"/dashboards/payment-tracking"`.
  - `/api/accounting/payment-tracking` is covered by the existing `/api/accounting` entry via segment-boundary prefix matching in `isPathAllowedByAccess` (`src/lib/user-access.ts:404`), so no additional API entries are needed for ADMIN / EXECUTIVE / roles that already have `/api/accounting`. `ACCOUNTING` gets both the suite path and `/api/accounting` to match that same pattern.
- `src/app/suites/accounting/page.tsx` — update `allowed` to `["ADMIN", "EXECUTIVE", "ACCOUNTING"]`.
- `src/app/dashboards/payment-tracking/page.tsx` — server-side role check against the same list (server component wrapper redirects if unauthorized). Client component rendered below.
- Admin UI (`/admin/users`) already reads role options from the enum; `ACCOUNTING` will appear automatically after migration + Prisma client regen.

**Per-user capability fallback:** Not needed. Access is binary; any finer grain can be handled by adding `extraAllowedRoutes` per user as the existing override pattern supports.

## Data flow

```
User loads /dashboards/payment-tracking
  └─ middleware.ts role check → allow if ACCOUNTING|ADMIN|EXECUTIVE
  └─ page.tsx (client) useQuery(queryKeys.paymentTracking)
      └─ GET /api/accounting/payment-tracking
          ├─ Auth check: session role
          ├─ Cache lookup (5 min TTL)
          ├─ MISS → searchWithRetry() Sales + Project pipelines
          │      → batch-read payment properties (chunks of 100)
          │      → transform each deal → PaymentTrackingDeal
          │      → bucketize, compute summary
          ├─ Cache set
          └─ Return { summary, deals, lastUpdated }
      ↳ Client filters/sorts client-side (all deals returned)
      ↳ SSE ("/api/stream" cacheKeyFilter="accounting:payment-tracking") invalidates on HubSpot deal updates
```

## Error handling

- HubSpot 429 / 5xx: already handled by `searchWithRetry()` (exponential backoff).
- HubSpot 403/404: surface as inline banner on page; degrade to last cached response if available.
- Unauthorized access: middleware returns 403 silently; the dashboard page redirects to `/` if the server-side role check fails.
- Malformed property values (e.g., numeric field containing a string): log to Sentry, coerce to null, deal still renders with `—`.
- Empty result: page renders "No deals match the current filters" in each empty section.

## Testing strategy

**Unit tests (`src/__tests__/api/accounting/payment-tracking.test.ts`):**
- Bucketing — one deal per bucket fixture confirms bucket output.
- Summary math — customer vs PE totals sum correctly, including mixed PE / non-PE sets.
- Attention reasons — each attention condition fires correctly and reasons are ordered.
- `paid_in_full` is ignored — fixture with `paid_in_full=true` + `da_invoice_status=Pending Approval` lands in `awaiting_m1`.
- M3 vs PTO — deals with populated `m3_invoice_status` but blank `pto_invoice_status` treated as `pto_invoice_status=null` (no fallback).

**Integration tests:**
- Role guard — `ACCOUNTING` user can access `/api/accounting/payment-tracking` and `/dashboards/payment-tracking`; a `VIEWER` user cannot; `ADMIN` and `EXECUTIVE` both succeed (guards against the "forgot to add to every role's allowlist" regression).
- Prisma enum round-trip — create a user with `roles: ["ACCOUNTING"]`, read it back, assert shape. Catches the case where code deploys against a prod DB that hasn't received the migration.

**Manual QA checklist:**
- Load page as ADMIN, EXECUTIVE, ACCOUNTING, VIEWER (only last should be blocked).
- Verify at least one known project appears in each bucket.
- Filters compose correctly (Location + PE + Outstanding).
- CSV export contains all columns and respects active filters.
- Dark mode + light mode both render cleanly.

## Rollout

1. **PR 1 — Prisma migration only.** Adds `ACCOUNTING` to the `UserRole` enum. Nothing else.
   - Merge PR 1 to `main`.
   - **Apply to production immediately after merge** via `scripts/migrate-prod.sh` (orchestrator + user approval). The enum value must exist in prod DB before PR 2 ships.
   - Verify: `psql "$DATABASE_URL" -c "\dT+ UserRole"` shows `ACCOUNTING`.
2. **PR 2 — Code.** Only merge after the prod migration above is confirmed applied.
   - `src/lib/roles.ts` — new `ACCOUNTING` role definition + `/dashboards/payment-tracking` and `/api/accounting/payment-tracking` added to `ADMIN` and `EXECUTIVE` `allowedRoutes`.
   - `src/app/suites/accounting/page.tsx` — allow `ACCOUNTING`.
   - `src/app/dashboards/payment-tracking/page.tsx` + `src/app/api/accounting/payment-tracking/route.ts`.
   - `src/lib/query-keys.ts` — add `paymentTracking` key.
   - Components + tests.
3. Zach assigns `ACCOUNTING` role to target users via `/admin/users`.
4. Phase 2 (separate PR): inline status editing — replace pills with `StatusDropdown` for users with `ACCOUNTING | ADMIN | EXECUTIVE`, POST to existing `/api/hubspot/update-deal` endpoint.

## Open questions

- **Exact stage filter:** "active" stages are implied as everything except closed-lost / dead-deal variants. Should we include Sales pipeline pre-deposit stages (e.g., quoting) or start from "closed won" onward? Default plan: include everything not in a dead-state to preserve visibility into upcoming work; revisit if noise is excessive.
- **`pe-deals` redirect / merge:** should the new Payment Tracking page eventually subsume `pe-deals`? Not in v1, but worth noting.
- **PE-only accounting flows (referrals / disbursements):** not surfaced here. Out of scope.

## References

- Existing pattern: `src/app/dashboards/pe-deals/page.tsx`
- Role definition file: `src/lib/roles.ts`
- Accounting suite landing: `src/app/suites/accounting/page.tsx`
- HubSpot client: `src/lib/hubspot.ts`
- HubSpot property validation: live MCP query against PROJ-8827, PROJ-9456, PROJ-9473, PROJ-2627, PROJ-2753, PROJ-3754 (2026-04-21)
