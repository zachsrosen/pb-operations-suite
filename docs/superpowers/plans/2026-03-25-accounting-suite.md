# Accounting Suite Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create an Accounting Suite with a PE Deals & Payments dashboard that auto-calculates lease-factor-based PE payment splits for every PE-tagged HubSpot deal.

**Architecture:** New suite landing page at `/suites/accounting` using `SuitePageShell`, a server-side API route at `/api/accounting/pe-deals` that fetches PE deals from HubSpot and calculates payment splits using the existing lease factor engine, and a client-side dashboard at `/dashboards/pe-deals` with a filterable/sortable table. The PE Dashboard moves from Executive to Accounting.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, React Query v5, HubSpot CRM API, existing `pricing-calculator.ts` lease factor logic, existing `/api/energy-community/check` endpoint.

**Spec:** `docs/superpowers/specs/2026-03-25-accounting-suite-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/pricing-calculator.ts` | Modify | Add DC qualifying brand config constants |
| `src/lib/suite-nav.ts` | Modify | Register Accounting suite + allowlist |
| `src/lib/suite-accents.ts` | Modify | Add green accent for `/suites/accounting` |
| `src/lib/query-keys.ts` | Modify | Add `peDeals` query key |
| `src/components/DashboardShell.tsx` | Modify | Add `pe-deals` + `pe` → Accounting in SUITE_MAP |
| `src/app/page.tsx` | Modify | Add Accounting card to home grid |
| `src/app/suites/executive/page.tsx` | Modify | Remove PE Dashboard + Pricing Calculator cards |
| `src/app/suites/accounting/page.tsx` | Create | Suite landing page |
| `src/app/api/accounting/pe-deals/route.ts` | Create | API route: fetch PE deals, calculate payments |
| `src/app/dashboards/pe-deals/page.tsx` | Create | PE Deals dashboard UI |

---

## Chunk 1: Infrastructure & Suite Registration

### Task 1: Add DC qualifying brand constants to pricing-calculator.ts

**Files:**
- Modify: `src/lib/pricing-calculator.ts`

- [ ] **Step 1: Add config constants after the PE_LEASE block (~line 268)**

```typescript
/** Brands whose modules meet IRA domestic content threshold (50% for solar). Currently none qualify. */
export const DC_QUALIFYING_MODULE_BRANDS: string[] = [];

/** Brands whose batteries meet IRA domestic content threshold (55% for BESS). */
export const DC_QUALIFYING_BATTERY_BRANDS: string[] = ["Tesla"];
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/pricing-calculator.ts
git commit -m "feat: add DC qualifying brand config constants for PE lease factor"
```

---

### Task 2: Register Accounting suite in suite-nav, accents, DashboardShell, home page, and query keys

**Files:**
- Modify: `src/lib/suite-nav.ts`
- Modify: `src/lib/suite-accents.ts`
- Modify: `src/components/DashboardShell.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/lib/query-keys.ts`

- [ ] **Step 1: Add suite entry to `suite-nav.ts`**

Add to the `SUITE_NAV_ENTRIES` array, positioned after Intelligence and before Admin:

```typescript
{
  href: "/suites/accounting",
  title: "Accounting Suite",
  shortLabel: "Accounting",
  description: "PE deal payments, pricing tools, and financial tracking.",
},
```

Add `/suites/accounting` to the `SUITE_SWITCHER_ALLOWLIST` for `ADMIN` and `EXECUTIVE` roles.

- [ ] **Step 2: Add accent to `suite-accents.ts`**

Add to `SUITE_ACCENT_COLORS`, between `executive` and `admin`:

```typescript
"/suites/accounting":               { color: "#10b981", light: "#34d399" },
```

- [ ] **Step 3: Add SUITE_MAP entries in `DashboardShell.tsx`**

Add to `SUITE_MAP` (do NOT add pricing-calculator — it keeps its Executive parent):

```typescript
// Accounting Suite
"/dashboards/pe-deals": { href: "/suites/accounting", label: "Accounting" },
```

Also update the existing `/dashboards/pe` entry from Intelligence to Accounting (the PE Dashboard card is moving to the Accounting suite):

```typescript
// Change:
"/dashboards/pe": { href: "/suites/intelligence", label: "Intelligence" },
// To:
"/dashboards/pe": { href: "/suites/accounting", label: "Accounting" },
```

- [ ] **Step 4: Add home page grid card in `page.tsx`**

Add to `SUITE_LINKS` array, before the Admin Suite entry:

```typescript
{
  href: "/suites/accounting",
  title: "Accounting Suite",
  description: "PE deal payments, pricing tools, and financial tracking.",
  tag: "ACCOUNTING",
  tagColor: "green",
  visibility: "owner_admin",
},
```

- [ ] **Step 5: Add query key in `query-keys.ts`**

Add a `peDeals` section to the `queryKeys` object:

```typescript
peDeals: {
  root: ["peDeals"] as const,
  list: () => [...queryKeys.peDeals.root, "list"] as const,
},
```

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 7: Commit**

```bash
git add src/lib/suite-nav.ts src/lib/suite-accents.ts src/components/DashboardShell.tsx src/app/page.tsx src/lib/query-keys.ts
git commit -m "feat: register Accounting suite in nav, accents, home grid, and query keys"
```

---

### Task 3: Create Accounting suite landing page + move cards from Executive

**Files:**
- Create: `src/app/suites/accounting/page.tsx`
- Modify: `src/app/suites/executive/page.tsx`

- [ ] **Step 1: Create suite page**

Create `src/app/suites/accounting/page.tsx`:

```typescript
import { redirect } from "next/navigation";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
  // ── Tools ──
  {
    href: "/dashboards/pricing-calculator",
    title: "Pricing Calculator",
    description: "Price solar + battery systems with PE lease value calculator and COGS breakdown.",
    tag: "PRICING",
    icon: "💲",
    section: "Tools",
  },

  // ── Participate Energy ──
  {
    href: "/dashboards/pe-deals",
    title: "PE Deals & Payments",
    description: "All PE-tagged deals with auto-calculated EPC, lease factor, and payment splits.",
    tag: "PE",
    icon: "⚡",
    section: "Participate Energy",
  },
  {
    href: "/dashboards/pe",
    title: "PE Dashboard",
    description: "Participate Energy milestone tracking and compliance monitoring.",
    tag: "PE",
    icon: "📊",
    section: "Participate Energy",
  },
];

export default async function AccountingSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/accounting");
  const allowed = ["ADMIN", "EXECUTIVE"];
  if (!allowed.includes(user.role)) redirect("/");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/accounting"
      title="Accounting Suite"
      subtitle="PE deal payments, pricing tools, and financial tracking."
      cards={LINKS}
      role={user.role}
    />
  );
}
```

- [ ] **Step 2: Remove PE Dashboard and Pricing Calculator cards from Executive suite**

In `src/app/suites/executive/page.tsx`, remove both cards from the "Programs" section:
- The PE Dashboard card (`href: "/dashboards/pe"`, around lines 79–86)
- The Pricing Calculator card (`href: "/dashboards/pricing-calculator"`, around lines 72–78)

Both cards now live on the Accounting suite page. The Pricing Calculator stays accessible via Executive breadcrumb and route permissions.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 4: Test in browser**

Navigate to `/suites/accounting` — should show 3 cards (Pricing Calculator, PE Deals & Payments, PE Dashboard).
Navigate to `/suites/executive` — PE Dashboard and Pricing Calculator cards should no longer appear.

- [ ] **Step 5: Commit**

```bash
git add src/app/suites/accounting/page.tsx src/app/suites/executive/page.tsx
git commit -m "feat: create Accounting suite page, move PE Dashboard + Pricing Calculator from Executive"
```

---

## Chunk 2: API Route

### Task 4: Create PE deals API route

**Files:**
- Create: `src/app/api/accounting/pe-deals/route.ts`

This is the core task. The API route fetches PE-tagged deals from HubSpot across Sales and Project pipelines, resolves company associations, performs Energy Community lookups, calculates per-deal lease factors, and returns payment breakdowns.

- [ ] **Step 1: Create the API route file**

Create `src/app/api/accounting/pe-deals/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { searchWithRetry, hubspotClient } from "@/lib/hubspot";
import { PIPELINE_IDS, getStageMaps } from "@/lib/deals-pipeline";
import {
  PE_LEASE,
  calcLeaseFactorAdjustment,
  DC_QUALIFYING_MODULE_BRANDS,
  DC_QUALIFYING_BATTERY_BRANDS,
  type PeSystemType,
} from "@/lib/pricing-calculator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PeDeal {
  dealId: string;
  dealName: string;
  companyName: string | null;
  pbLocation: string;
  dealStage: string;
  dealStageLabel: string;
  closeDate: string | null;
  systemType: "solar" | "battery" | "solar+battery";
  epcPrice: number | null;
  customerPays: number | null;
  pePaymentTotal: number | null;
  pePaymentIC: number | null;
  pePaymentPC: number | null;
  totalPBRevenue: number | null;
  postalCode: string | null;
  energyCommunity: boolean;
  ecLookupFailed: boolean;
  solarDC: boolean;
  batteryDC: boolean;
  leaseFactor: number;
  peM1Status: string | null;
  peM2Status: string | null;
  milestoneHighlight: "m1" | "m2" | null; // "m1" if at PTO stage, "m2" if at Close Out
  hubspotUrl: string;
}

// ---------------------------------------------------------------------------
// EC cache — simple Map with 24h TTL (EC designations update annually)
// ---------------------------------------------------------------------------

const EC_TTL = 24 * 60 * 60 * 1000;
const ecCache = new Map<string, { result: boolean; ts: number }>();

async function lookupEC(zip: string): Promise<{ ec: boolean; failed: boolean }> {
  const cached = ecCache.get(zip);
  if (cached && Date.now() - cached.ts < EC_TTL) {
    return { ec: cached.result, failed: false };
  }
  try {
    const res = await fetch(
      `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/energy-community/check?zip=${zip}`,
    );
    if (!res.ok) return { ec: false, failed: true };
    const data = await res.json();
    ecCache.set(zip, { result: data.isEnergyCommunity, ts: Date.now() });
    return { ec: data.isEnergyCommunity, failed: false };
  } catch {
    return { ec: false, failed: true };
  }
}

// ---------------------------------------------------------------------------
// HubSpot deal properties to fetch
// ---------------------------------------------------------------------------

const PE_DEAL_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "amount",
  "dealstage",
  "pipeline",
  "closedate",
  "pb_location",
  "postal_code",
  "project_type",
  "battery_count",
  "battery_brand",
  "module_brand",
  // PE-specific — update these after discovering exact property names
  "participate_energy_status",
  "is_participate_energy",
  // PE M1/M2 — placeholder names, update after HubSpot inspection
  "pe_m1_status",
  "pe_m2_status",
];

// ---------------------------------------------------------------------------
// Fetch PE deals from a single pipeline
// ---------------------------------------------------------------------------

async function fetchPeDealsFromPipeline(
  pipelineKey: string,
  peFilterProperty: string,
): Promise<Record<string, unknown>[]> {
  const pipelineId = PIPELINE_IDS[pipelineKey];
  if (!pipelineId) return [];

  const allDeals: Record<string, unknown>[] = [];

  if (pipelineId === "default") {
    // HubSpot's search API rejects pipeline="default" as a filter value.
    // Workaround: query by deal stage IDs (same pattern as deals/route.ts).
    // Use filterGroups to batch stages (HubSpot allows up to 5 per request).
    const stageMaps = await getStageMaps();
    const stageIds = Object.keys(stageMaps[pipelineKey] || {});
    const BATCH_SIZE = 5;

    for (let i = 0; i < stageIds.length; i += BATCH_SIZE) {
      const batch = stageIds.slice(i, i + BATCH_SIZE);
      if (i > 0) await new Promise((r) => setTimeout(r, 150));

      let after: string | undefined;
      do {
        const searchRequest = {
          filterGroups: batch.map((stageId) => ({
            filters: [
              { propertyName: "dealstage", operator: "EQ" as const, value: stageId },
              { propertyName: peFilterProperty, operator: "HAS_PROPERTY" as const },
            ],
          })),
          properties: PE_DEAL_PROPERTIES,
          limit: 100,
          ...(after ? { after } : {}),
        };
        const response = await searchWithRetry(searchRequest);
        allDeals.push(...response.results.map((d) => d.properties));
        after = response.paging?.next?.after;
      } while (after);
    }
  } else {
    // Non-default pipelines can filter by pipeline ID directly
    let after: string | undefined;
    do {
      const searchRequest = {
        filterGroups: [{
          filters: [
            { propertyName: "pipeline", operator: "EQ" as const, value: pipelineId },
            { propertyName: peFilterProperty, operator: "HAS_PROPERTY" as const },
          ],
        }],
        properties: PE_DEAL_PROPERTIES,
        sorts: [{ propertyName: "closedate", direction: "DESCENDING" }],
        limit: 100,
        ...(after ? { after } : {}),
      };
      const response = await searchWithRetry(searchRequest);
      allDeals.push(...response.results.map((d) => d.properties));
      after = response.paging?.next?.after;
    } while (after);
  }

  return allDeals;
}

// ---------------------------------------------------------------------------
// Resolve company names from deal associations
// ---------------------------------------------------------------------------

async function resolveCompanyNames(
  dealIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (dealIds.length === 0) return map;

  try {
    const batchSize = 100;
    for (let i = 0; i < dealIds.length; i += batchSize) {
      const batch = dealIds.slice(i, i + batchSize);
      const response =
        await hubspotClient.crm.associations.batchApi.read("deals", "companies", {
          inputs: batch.map((id) => ({ id })),
        });

      const companyIds = new Set<string>();
      const dealToCompany = new Map<string, string>();

      for (const result of response.results) {
        const companyId = result.to?.[0]?.id;
        if (companyId) {
          companyIds.add(companyId);
          dealToCompany.set(result.from.id, companyId);
        }
      }

      if (companyIds.size > 0) {
        const companies =
          await hubspotClient.crm.companies.batchApi.read({
            inputs: Array.from(companyIds).map((id) => ({ id })),
            properties: ["name"],
          });

        const companyNameMap = new Map<string, string>();
        for (const co of companies.results) {
          companyNameMap.set(co.id, co.properties.name || "Unknown");
        }

        for (const [dealId, companyId] of dealToCompany) {
          map.set(dealId, companyNameMap.get(companyId) || "Unknown");
        }
      }
    }
  } catch (err) {
    console.error("[pe-deals] Failed to resolve company names:", err);
  }

  return map;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allowed = ["ADMIN", "EXECUTIVE"];
  if (!allowed.includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const portalId = process.env.HUBSPOT_PORTAL_ID || "21710069";

  try {
    // Determine PE filter property — try participate_energy_status first
    const peFilterProperty = "participate_energy_status";

    // Fetch PE deals from Sales + Project pipelines
    const [salesDeals, projectDeals] = await Promise.all([
      fetchPeDealsFromPipeline("sales", peFilterProperty),
      fetchPeDealsFromPipeline("project", peFilterProperty),
    ]);

    // Deduplicate by deal ID (a deal could appear in both if pipeline changed)
    const dealsMap = new Map<string, Record<string, unknown>>();
    for (const deal of [...salesDeals, ...projectDeals]) {
      const id = String(deal.hs_object_id);
      if (!dealsMap.has(id)) dealsMap.set(id, deal);
    }
    const rawDeals = Array.from(dealsMap.values());

    // Resolve stage labels
    const stageMaps = await getStageMaps();
    const allStageMaps = { ...stageMaps.sales, ...stageMaps.project } as Record<string, string>;

    // Resolve company names
    const dealIds = rawDeals.map((d) => String(d.hs_object_id));
    const companyNames = await resolveCompanyNames(dealIds);

    // Batch EC lookups by unique zip code
    const uniqueZips = new Set<string>();
    for (const deal of rawDeals) {
      const zip = String(deal.postal_code || "").trim();
      if (/^\d{5}$/.test(zip)) uniqueZips.add(zip);
    }

    const ecResults = new Map<string, { ec: boolean; failed: boolean }>();
    await Promise.all(
      Array.from(uniqueZips).map(async (zip) => {
        const result = await lookupEC(zip);
        ecResults.set(zip, result);
      }),
    );

    // Transform deals
    const deals: PeDeal[] = rawDeals.map((deal) => {
      const dealId = String(deal.hs_object_id);
      const amount = deal.amount ? parseFloat(String(deal.amount)) : null;
      const epcPrice = amount && amount > 0 ? amount : null;
      const postalCode = String(deal.postal_code || "").trim() || null;
      const zip5 = postalCode && /^\d{5}$/.test(postalCode) ? postalCode : null;
      const stageId = String(deal.dealstage || "");
      const stageLabel = allStageMaps[stageId] || stageId;

      // System type
      const projectType = String(deal.project_type || "").toLowerCase();
      const batteryCount = parseInt(String(deal.battery_count || "0")) || 0;
      let systemType: PeSystemType = "solar";
      if (projectType.includes("battery") && projectType.includes("solar")) {
        systemType = "solar+battery";
      } else if (projectType.includes("battery") || (batteryCount > 0 && !projectType)) {
        systemType = batteryCount > 0 && !projectType.includes("solar") ? "battery" : "solar+battery";
      }

      // DC qualifications
      const moduleBrand = String(deal.module_brand || "");
      const batteryBrand = String(deal.battery_brand || "");
      const solarDC =
        moduleBrand.length > 0 &&
        DC_QUALIFYING_MODULE_BRANDS.some((b) =>
          moduleBrand.toLowerCase().includes(b.toLowerCase()),
        );
      const batteryDC =
        batteryCount > 0 &&
        DC_QUALIFYING_BATTERY_BRANDS.some((b) =>
          batteryBrand.toLowerCase().includes(b.toLowerCase()),
        );

      // Energy Community
      const ecResult = zip5 ? ecResults.get(zip5) : undefined;
      const energyCommunity = ecResult?.ec ?? false;
      const ecLookupFailed = ecResult?.failed ?? false;

      // Lease factor
      const adjustment = calcLeaseFactorAdjustment(systemType, solarDC, batteryDC, energyCommunity);
      const leaseFactor = PE_LEASE.baselineFactor + adjustment;

      // Payment calculations — null if no EPC price
      let customerPays: number | null = null;
      let pePaymentTotal: number | null = null;
      let pePaymentIC: number | null = null;
      let pePaymentPC: number | null = null;
      let totalPBRevenue: number | null = null;

      if (epcPrice !== null) {
        customerPays = epcPrice * 0.7;
        pePaymentTotal = epcPrice - epcPrice / leaseFactor;
        pePaymentIC = pePaymentTotal * (2 / 3);
        pePaymentPC = pePaymentTotal * (1 / 3);
        totalPBRevenue = customerPays + pePaymentTotal;
      }

      return {
        dealId,
        dealName: String(deal.dealname || "Untitled"),
        companyName: companyNames.get(dealId) || null,
        pbLocation: String(deal.pb_location || ""),
        dealStage: stageId,
        dealStageLabel: stageLabel,
        closeDate: deal.closedate ? String(deal.closedate) : null,
        systemType,
        epcPrice,
        customerPays,
        pePaymentTotal,
        pePaymentIC,
        pePaymentPC,
        totalPBRevenue,
        postalCode,
        energyCommunity,
        ecLookupFailed,
        solarDC,
        batteryDC,
        leaseFactor,
        peM1Status: deal.pe_m1_status ? String(deal.pe_m1_status) : null,
        peM2Status: deal.pe_m2_status ? String(deal.pe_m2_status) : null,
        // Highlight deals at payment milestone stages
        milestoneHighlight:
          stageLabel === "Permission To Operate" ? "m1" as const
          : stageLabel === "Close Out" ? "m2" as const
          : null,
        hubspotUrl: `https://app.hubspot.com/contacts/${portalId}/deal/${dealId}`,
      };
    });

    return NextResponse.json({ deals, lastUpdated: new Date().toISOString() });
  } catch (err) {
    console.error("[pe-deals] Error fetching PE deals:", err);
    return NextResponse.json({ error: "Failed to fetch PE deals" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep "pe-deals" | head -10`
Expected: No errors in the new file. Fix any type issues with HubSpot client methods — the exact API may need adjustment based on the installed `@hubspot/api-client` version. Reference `src/lib/hubspot.ts` and `src/app/api/deals/route.ts` for working patterns.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/accounting/pe-deals/route.ts
git commit -m "feat: add PE deals API route with lease factor and EC lookups"
```

---

## Chunk 3: Dashboard UI

### Task 5: Create PE Deals dashboard page

**Files:**
- Create: `src/app/dashboards/pe-deals/page.tsx`

- [ ] **Step 1: Create the dashboard page**

Create `src/app/dashboards/pe-deals/page.tsx`:

```typescript
"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import MultiSelectFilter from "@/components/ui/MultiSelectFilter";
import { queryKeys } from "@/lib/query-keys";

// ---------------------------------------------------------------------------
// Types (mirrors API response)
// ---------------------------------------------------------------------------

interface PeDeal {
  dealId: string;
  dealName: string;
  companyName: string | null;
  pbLocation: string;
  dealStage: string;
  dealStageLabel: string;
  closeDate: string | null;
  systemType: "solar" | "battery" | "solar+battery";
  epcPrice: number | null;
  customerPays: number | null;
  pePaymentTotal: number | null;
  pePaymentIC: number | null;
  pePaymentPC: number | null;
  totalPBRevenue: number | null;
  postalCode: string | null;
  energyCommunity: boolean;
  ecLookupFailed: boolean;
  solarDC: boolean;
  batteryDC: boolean;
  leaseFactor: number;
  peM1Status: string | null;
  peM2Status: string | null;
  milestoneHighlight: "m1" | "m2" | null; // "m1" if at PTO stage, "m2" if at Close Out
  hubspotUrl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function fmtFull(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

type SortKey = keyof PeDeal;
type SortDir = "asc" | "desc";

function sortDeals(deals: PeDeal[], key: SortKey, dir: SortDir): PeDeal[] {
  return [...deals].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") {
      return dir === "asc" ? av - bv : bv - av;
    }
    return dir === "asc"
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });
}

// ---------------------------------------------------------------------------
// Section component — renders a labeled table of deals
// ---------------------------------------------------------------------------

const COLUMNS: [SortKey, string][] = [
  ["dealName", "Deal"],
  ["companyName", "Company"],
  ["pbLocation", "Location"],
  ["dealStageLabel", "Stage"],
  ["closeDate", "Close Date"],
  ["systemType", "Type"],
  ["energyCommunity", "EC"],
  ["leaseFactor", "Factor"],
  ["epcPrice", "EPC Price"],
  ["customerPays", "Customer"],
  ["pePaymentTotal", "PE Total"],
  ["pePaymentIC", "PE @ IC"],
  ["pePaymentPC", "PE @ PC"],
  ["totalPBRevenue", "PB Revenue"],
  ["peM1Status", "M1"],
  ["peM2Status", "M2"],
];

function DealSection({
  title,
  subtitle,
  accent,
  deals,
  sortKey,
  sortDir,
  sortArrow,
  toggleSort,
}: {
  title: string;
  subtitle: string;
  accent?: "orange" | "emerald";
  deals: PeDeal[];
  sortKey: SortKey;
  sortDir: SortDir;
  sortArrow: (key: SortKey) => string;
  toggleSort: (key: SortKey) => void;
}) {
  const accentBorder = accent === "orange"
    ? "border-l-orange-400"
    : accent === "emerald"
      ? "border-l-emerald-400"
      : "border-l-transparent";

  return (
    <div>
      <div className={`flex items-baseline gap-3 mb-2 ${accent ? `border-l-2 ${accentBorder} pl-3` : ""}`}>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="text-xs text-muted">{subtitle}</span>
      </div>
      <div className="overflow-x-auto bg-surface rounded-lg border border-border shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {COLUMNS.map(([key, label]) => (
                <th
                  key={key}
                  onClick={() => toggleSort(key)}
                  className="px-3 py-2.5 text-xs font-medium text-muted whitespace-nowrap cursor-pointer hover:text-foreground select-none"
                >
                  {label}{sortArrow(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {deals.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-muted">
                  No deals
                </td>
              </tr>
            ) : (
              deals.map((deal) => (
                <tr key={deal.dealId} className="border-b border-border/50 hover:bg-surface-2/50">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <a
                      href={deal.hubspotUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-orange-400 hover:text-orange-300 hover:underline"
                    >
                      {deal.dealName}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">{deal.companyName ?? "—"}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">{deal.pbLocation || "—"}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">{deal.dealStageLabel}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">
                    {deal.closeDate ? new Date(deal.closeDate).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap capitalize">
                    {deal.systemType.replace("+", " + ")}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {deal.ecLookupFailed ? (
                      <span className="text-yellow-400" title="EC lookup failed">⚠️</span>
                    ) : deal.energyCommunity ? (
                      <span className="text-emerald-400">Yes</span>
                    ) : (
                      <span className="text-muted">No</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap text-right">{deal.leaseFactor.toFixed(3)}</td>
                  <td className="px-3 py-2 text-foreground whitespace-nowrap text-right font-medium">{fmtFull(deal.epcPrice)}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap text-right">{fmtFull(deal.customerPays)}</td>
                  <td className="px-3 py-2 text-blue-400 whitespace-nowrap text-right font-medium">{fmtFull(deal.pePaymentTotal)}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap text-right">{fmtFull(deal.pePaymentIC)}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap text-right">{fmtFull(deal.pePaymentPC)}</td>
                  <td className="px-3 py-2 text-emerald-400 whitespace-nowrap text-right font-medium">{fmtFull(deal.totalPBRevenue)}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">{deal.peM1Status ?? "—"}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">{deal.peM2Status ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PeDealsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.peDeals.list(),
    queryFn: async () => {
      const res = await fetch("/api/accounting/pe-deals");
      if (!res.ok) throw new Error("Failed to fetch PE deals");
      return res.json() as Promise<{ deals: PeDeal[]; lastUpdated: string }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState<string[]>([]);
  const [stageFilter, setStageFilter] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("closeDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const deals = data?.deals ?? [];
  const lastUpdated = data?.lastUpdated
    ? new Date(data.lastUpdated).toLocaleTimeString()
    : undefined;

  // Filter options
  const locationOptions = useMemo(
    () => [...new Set(deals.map((d) => d.pbLocation).filter(Boolean))].sort(),
    [deals],
  );
  const stageOptions = useMemo(
    () =>
      [...new Map(deals.map((d) => [d.dealStage, d.dealStageLabel])).entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [deals],
  );

  // Apply filters
  const filtered = useMemo(() => {
    let result = deals;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.dealName.toLowerCase().includes(q) ||
          (d.companyName && d.companyName.toLowerCase().includes(q)),
      );
    }
    if (locationFilter.length > 0) {
      result = result.filter((d) => locationFilter.includes(d.pbLocation));
    }
    if (stageFilter.length > 0) {
      result = result.filter((d) => stageFilter.includes(d.dealStage));
    }
    return sortDeals(result, sortKey, sortDir);
  }, [deals, search, locationFilter, stageFilter, sortKey, sortDir]);

  // Split into priority sections
  const m1Deals = useMemo(() => filtered.filter((d) => d.milestoneHighlight === "m1"), [filtered]);
  const m2Deals = useMemo(() => filtered.filter((d) => d.milestoneHighlight === "m2"), [filtered]);
  const allDeals = filtered;

  // Summary stats (exclude deals with null pricing)
  const totalEPC = filtered.reduce((s, d) => s + (d.epcPrice ?? 0), 0);
  const totalPEReceivable = filtered.reduce((s, d) => s + (d.pePaymentTotal ?? 0), 0);
  const totalRevenue = filtered.reduce((s, d) => s + (d.totalPBRevenue ?? 0), 0);

  // CSV export data
  const exportData = filtered.map((d) => ({
    "Deal Name": d.dealName,
    Company: d.companyName ?? "",
    "PB Location": d.pbLocation,
    "Deal Stage": d.dealStageLabel,
    "Close Date": d.closeDate ?? "",
    "System Type": d.systemType,
    "Energy Community": d.energyCommunity ? "Yes" : "No",
    "Lease Factor": d.leaseFactor.toFixed(7),
    "EPC Price": d.epcPrice ?? "",
    "Customer Pays": d.customerPays ?? "",
    "PE Payment Total": d.pePaymentTotal ?? "",
    "PE @ IC": d.pePaymentIC ?? "",
    "PE @ PC": d.pePaymentPC ?? "",
    "Total PB Revenue": d.totalPBRevenue ?? "",
    "PE M1": d.peM1Status ?? "",
    "PE M2": d.peM2Status ?? "",
  }));

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  if (error) {
    return (
      <DashboardShell title="PE Deals & Payments" accentColor="orange">
        <div className="text-center py-12 text-red-400">
          Failed to load PE deals. Please try again.
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title="PE Deals & Payments"
      accentColor="orange"
      fullWidth
      lastUpdated={lastUpdated}
      exportData={{ data: exportData, filename: "pe-deals-payments.csv" }}
    >
      {/* Hero Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 stagger-grid">
        <StatCard
          key={String(filtered.length)}
          label="PE Deals"
          value={String(filtered.length)}
          color="orange"
        />
        <StatCard
          key={String(totalEPC)}
          label="Total EPC"
          value={fmt(totalEPC)}
          color="blue"
        />
        <StatCard
          key={String(totalPEReceivable)}
          label="Total PE Receivable"
          value={fmt(totalPEReceivable)}
          color="emerald"
        />
        <StatCard
          key={String(totalRevenue)}
          label="Total PB Revenue"
          value={fmt(totalRevenue)}
          color="green"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search deals or companies..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 rounded bg-surface-2 border border-border text-foreground text-sm w-64"
        />
        <MultiSelectFilter
          label="Location"
          options={locationOptions.map((l) => ({ value: l, label: l }))}
          selected={locationFilter}
          onChange={setLocationFilter}
        />
        <MultiSelectFilter
          label="Stage"
          options={stageOptions}
          selected={stageFilter}
          onChange={setStageFilter}
        />
      </div>

      {/* Tables by section */}
      {isLoading ? (
        <div className="text-center py-12 text-muted">Loading PE deals...</div>
      ) : (
        <div className="space-y-8">
          {m1Deals.length > 0 && (
            <DealSection
              title="M1 — Permission To Operate"
              subtitle={`${m1Deals.length} deal${m1Deals.length !== 1 ? "s" : ""} pending PE payment (2/3)`}
              accent="orange"
              deals={m1Deals}
              sortKey={sortKey}
              sortDir={sortDir}
              sortArrow={sortArrow}
              toggleSort={toggleSort}
            />
          )}
          {m2Deals.length > 0 && (
            <DealSection
              title="M2 — Close Out"
              subtitle={`${m2Deals.length} deal${m2Deals.length !== 1 ? "s" : ""} pending PE payment (1/3)`}
              accent="emerald"
              deals={m2Deals}
              sortKey={sortKey}
              sortDir={sortDir}
              sortArrow={sortArrow}
              toggleSort={toggleSort}
            />
          )}
          <DealSection
            title="All PE Deals"
            subtitle={`${allDeals.length} total`}
            deals={allDeals}
            sortKey={sortKey}
            sortDir={sortDir}
            sortArrow={sortArrow}
            toggleSort={toggleSort}
          />
        </div>
      )}
    </DashboardShell>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep "pe-deals" | head -10`
Expected: No errors. If `MultiSelectFilter` has a different prop signature, check `src/components/ui/MultiSelectFilter.tsx` and adjust.

- [ ] **Step 3: Test in browser**

Navigate to `/dashboards/pe-deals`. Verify:
- Hero stats row renders (may show 0s if no PE deals in dev environment)
- Filters render (location, stage dropdowns)
- Search input works
- Table headers are clickable for sorting
- "Back to Accounting" breadcrumb link appears in DashboardShell header
- CSV export button works in DashboardShell

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/pe-deals/page.tsx
git commit -m "feat: add PE Deals & Payments dashboard with sortable table"
```

---

## Chunk 4: Verification & Cleanup

### Task 6: End-to-end verification

- [ ] **Step 1: Full build check**

Run: `npx tsc --noEmit`
Fix any type errors in the new files.

- [ ] **Step 2: Verify all navigation paths**

1. Home page (`/`) — Accounting Suite card should be visible for ADMIN/EXECUTIVE
2. Suite switcher — Accounting should appear in the dropdown
3. `/suites/accounting` — 3 cards: Pricing Calculator, PE Deals & Payments, PE Dashboard
4. `/dashboards/pe-deals` — Dashboard loads with "Back to Accounting" breadcrumb, shows M1/M2 priority sections (if any deals are at PTO or Close Out) above the All PE Deals table
5. `/dashboards/pricing-calculator` — Still has "Back to Executive" breadcrumb (NOT Accounting)
6. `/suites/executive` — PE Dashboard and Pricing Calculator cards no longer shown
7. `/dashboards/pe` — Now shows "Back to Accounting" breadcrumb (was Intelligence)

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: address verification issues in Accounting suite"
```

---

## Implementation Notes

### PE M1/M2 Property Discovery

During implementation of Task 4, discover the exact HubSpot property names for PE milestone statuses (M1 = Permission To Operate, M2 = Close Out). To do this:

1. Find a known PE deal ID in HubSpot
2. Use the HubSpot API to list all properties on that deal:
   ```bash
   curl -s "https://api.hubapi.com/crm/v3/objects/deals/{dealId}?properties=*" \
     -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN" | jq '.properties | keys[]' | grep -i pe
   ```
3. Update `PE_DEAL_PROPERTIES` array and `peM1Status`/`peM2Status` field mappings in the API route

### Milestone Sections

The dashboard splits deals into three sections: M1 (deals at "Permission To Operate" stage — pending 2/3 PE payment), M2 (deals at "Close Out" stage — pending 1/3 PE payment), and All PE Deals. The `milestoneHighlight` field on each deal is derived from the deal's stage label matching against these stage names.

### Sales Pipeline "default" Workaround

The API route uses the same pattern as `deals/route.ts` — for the sales pipeline (ID = `"default"`), it queries by individual deal stage IDs batched in groups of 5 via HubSpot's `filterGroups` (OR logic). Each filterGroup combines a stage filter AND the PE property filter. This ensures only sales pipeline PE deals are returned, with no cross-pipeline contamination from D&R/Service/Roofing pipelines.

### EC Lookup Self-Call

The API route calls `/api/energy-community/check` via `fetch()` using `NEXTAUTH_URL`. In production this works fine. In development, ensure the dev server is running on the expected port. An alternative is to extract the EC lookup logic into a shared function in `src/lib/` — but for v1, the self-call is simpler and reuses the existing endpoint directly.
