# Accounting Suite — Design Spec

**Date**: 2026-03-25
**Status**: Draft
**Scope**: Suite landing page + PE Deals & Payments dashboard (v1)

---

## Problem

PB has no structured view for accounting to track Participate Energy payment obligations. PE deals require lease-factor-based payment calculations that differ from the flat 30% customer discount. Accounting has no consistent process — this is the first structured view.

## Solution

Create a new **Accounting Suite** (`/suites/accounting`) with two pages at launch:

1. **Pricing Calculator** (existing) — linked from the suite landing page
2. **PE Deals & Payments** (new) — table of all PE-tagged deals with auto-calculated payment splits

Future pages (not in v1): Revenue Reconciliation, Project Margins, Sales Order Status, Commission Tracker.

---

## Suite Landing Page

**Route**: `/suites/accounting`
**Component**: `SuitePageShell` (existing pattern)
**Accent color**: green

### Cards

| Card | Route | Section | Tag | Icon |
|------|-------|---------|-----|------|
| Pricing Calculator | `/dashboards/pricing-calculator` | Tools | PRICING | 💲 |
| PE Deals & Payments | `/dashboards/pe-deals` | Participate Energy | PE | ⚡ |

### Future Cards (not built in v1)

| Card | Section | Tag |
|------|---------|-----|
| Revenue Reconciliation | Revenue | REVENUE |
| Project Margins | Revenue | MARGINS |
| Sales Order Status | Operations | SO |
| Commission Tracker | Operations | COMMISSION |

### Role Access

**ADMIN, EXECUTIVE** only. (OWNER normalizes to EXECUTIVE per Prisma schema.)

Add Accounting to the suite switcher in `suite-nav.ts` for ADMIN and EXECUTIVE, positioned after Intelligence and before Admin.

### Route Permissions

Add `/suites/accounting` and `/dashboards/pe-deals` to `role-permissions.ts` for EXECUTIVE. ADMIN already has wildcard access.

---

## PE Deals & Payments Page

**Route**: `/dashboards/pe-deals`
**Layout**: `DashboardShell` with orange accent, full width

### Data Source

HubSpot deals where the PE tag is set. During implementation, discover which property is most reliable by checking a known PE deal. Candidates:

- `participate_energy_status` (preferred — most explicit)
- `is_participate_energy` (boolean flag)
- `tags` containing "Participate Energy" (fallback)

Query across Sales and Project pipelines (`HUBSPOT_PIPELINE_SALES`, `HUBSPOT_PIPELINE_PROJECT`) using `searchWithRetry()`.

### HubSpot Properties Required

**Deal identification & status:**
- `dealname`, `amount`, `dealstage`, `closedate`
- PE identifier property (see above)
- PE M1 status property — discover exact internal name during implementation by inspecting a PE deal's properties in HubSpot
- PE M2 status property — same as above

**System type & equipment:**
- `project_type` — solar vs battery vs solar+battery
- `battery_count`, `battery_brand` — for battery DC qualification
- `module_brand` — for solar DC qualification (currently none qualify)

**Location & address:**
- `pb_location` — PB office location
- `postal_code` — for Energy Community lookup

**Associations:**
- Deal → Company (for company name display)

### Per-Deal Lease Factor Calculation

Each deal gets its own lease factor using `calcLeaseFactorAdjustment()` from `pricing-calculator.ts`:

| Input | Derivation |
|-------|-----------|
| System type | From `project_type` HubSpot property |
| Solar DC | Check `module_brand` against a qualifying brands list. Currently no PB panels qualify (Hyundai 40% < 50% threshold). Use a config constant `DC_QUALIFYING_MODULE_BRANDS: string[]` so it's easy to update when PB switches vendors. |
| Battery DC | Check `battery_brand` against a qualifying brands list (`DC_QUALIFYING_BATTERY_BRANDS = ["Tesla"]`). Currently Tesla PW3 at 60.5% meets the 55% threshold. |
| Energy Community | Auto-lookup via `/api/energy-community/check` using deal's `postal_code` |

**EC lookup optimization**: Cache results by zip code in the server-side cache (`lib/cache.ts`) with 24h TTL. PB operates in ~5 Colorado + California markets, so most deals share a small set of zips.

### Payment Formulas

Per deal (EPC = HubSpot deal `amount`):

```
Customer Pays       = EPC × 0.7                        (flat 30% off, always)
PE Customer Share   = EPC / lease_factor                (PE's internal calculation)
PE Payment to PB    = EPC − (EPC / lease_factor)        (what PE owes PB)
PE @ IC             = PE Payment × 2/3                  (at Inspection Complete)
PE @ PC             = PE Payment × 1/3                  (at Project Complete)
Total PB Revenue    = Customer Pays + PE Payment to PB
```

When lease factor = baseline 1.4285714: Total PB Revenue = EPC (100%).
When lease factor < baseline (no-bonus penalty): Total PB Revenue < EPC.
When lease factor > baseline (DC bonus): Total PB Revenue > EPC.

### Table Columns

| Column | Source |
|--------|--------|
| Deal Name | `dealname` (links to HubSpot) |
| Company | Associated company name |
| PB Location | `pb_location` |
| Deal Stage | `dealstage` (mapped to label via pipeline stage map) |
| Close Date | `closedate` |
| System Type | `project_type` |
| EC Status | Auto-lookup from `postal_code` |
| Lease Factor | Calculated per deal |
| EPC Price | `amount` |
| Customer Pays | EPC × 0.7 |
| PE Payment Total | EPC − (EPC / factor) |
| PE @ IC (2/3) | PE Payment × 2/3 |
| PE @ PC (1/3) | PE Payment × 1/3 |
| Total PB Revenue | Customer + PE Payment |
| PE M1 Status | HubSpot property (discover during implementation) |
| PE M2 Status | HubSpot property (discover during implementation) |

### Table Features

- Sort by any column (default: close date descending)
- Filter by PB location (`MultiSelectFilter`)
- Filter by deal stage (`MultiSelectFilter`)
- Search by deal name or company
- Click deal name → opens deal in HubSpot (external link, new tab)
- CSV export via `DashboardShell` `exportData` prop

### Hero Stats Row

Four `StatCard` components at the top:

| Stat | Value | Color |
|------|-------|-------|
| PE Deals | Count of visible deals | orange |
| Total EPC | Sum of EPC prices | blue |
| Total PE Receivable | Sum of PE Payment Total | emerald |
| Total PB Revenue | Sum of Total PB Revenue | green |

Stats update reactively when filters change (show filtered totals).

### Error Handling

- **HubSpot API errors**: Use `searchWithRetry()` with standard exponential backoff on 429s. Show error state in UI if all retries fail.
- **EC lookup failures**: If the EC check fails for a zip code, default `energyCommunity = false` for that deal and show a warning indicator in the EC Status column. Do not block the entire page for partial failures.
- **Missing deal properties**: If `amount` is null/0, show "—" for all calculated columns. If `postal_code` is missing, skip EC lookup and default to false. If `project_type` is missing, default to "solar" (most common).
- **Stage label mapping**: Use the pipeline stage map cache (5-min TTL, existing pattern) to resolve stage IDs to labels. Deals may span Sales and Project pipelines.

### Caching & Data Fetching

- **React Query key**: Add `peDeals` to `lib/query-keys.ts`
- **Stale time**: 5 minutes (accounting data is not real-time critical)
- **No SSE**: PE deals don't need real-time push updates. Manual refresh is sufficient.
- **Expected volume**: PB has dozens of PE deals at most, not hundreds. No pagination needed for v1. If volume grows, add server-side pagination later.

### API Route

**`GET /api/accounting/pe-deals`**

Follows the existing API grouping pattern (domain prefix).

- Fetches all PE-tagged deals from HubSpot with required properties
- Resolves company associations (batch read)
- Performs EC lookups for unique zip codes (cached)
- Returns deal array with all calculated fields

Response shape:
```typescript
interface PeDeal {
  dealId: string;
  dealName: string;
  companyName: string;
  pbLocation: string;
  dealStage: string;
  dealStageLabel: string;
  closeDate: string | null;
  systemType: "solar" | "battery" | "solar+battery";
  epcPrice: number;
  // EC & lease factor
  postalCode: string;
  energyCommunity: boolean;
  solarDC: boolean;
  batteryDC: boolean;
  leaseFactor: number;
  // Calculated payments
  customerPays: number;
  pePaymentTotal: number;
  pePaymentIC: number;
  pePaymentPC: number;
  totalPBRevenue: number;
  // PE milestones
  peM1Status: string | null;
  peM2Status: string | null;
  // Links
  hubspotUrl: string;
}
```

---

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `src/app/suites/accounting/page.tsx` | Suite landing page |
| `src/app/dashboards/pe-deals/page.tsx` | PE Deals dashboard (client component) |
| `src/app/api/accounting/pe-deals/route.ts` | API route fetching PE deals + calculations |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/suite-nav.ts` | Add Accounting suite for ADMIN, EXECUTIVE |
| `src/lib/role-permissions.ts` | Add `/suites/accounting` and `/dashboards/pe-deals` to EXECUTIVE routes |
| `src/lib/query-keys.ts` | Add `peDeals` query key |
| `src/lib/pricing-calculator.ts` | Export `DC_QUALIFYING_MODULE_BRANDS` and `DC_QUALIFYING_BATTERY_BRANDS` config constants |

### Reused

- `calcLeaseFactorAdjustment()` and `PE_LEASE` constants from `pricing-calculator.ts`
- `/api/energy-community/check` for EC lookups (already built)
- `searchWithRetry()` from `hubspot.ts` for deal fetching
- `DashboardShell`, `StatCard`, `MultiSelectFilter` UI components
- Server-side cache (`lib/cache.ts`) for EC results

---

## Out of Scope (v1)

- Payment receipt tracking (accounting marks IC/PC as received)
- Per-deal lease factor overrides
- Revenue reconciliation dashboards
- Project margin analysis
- Commission tracking
- Sales order status tracking
