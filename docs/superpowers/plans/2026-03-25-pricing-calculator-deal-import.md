# Pricing Calculator — Deal Import & Compare Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a HubSpot deal search bar to the pricing calculator that auto-populates equipment from deal line items and shows a comparison banner with the deal amount vs. calculated price.

**Architecture:** New API endpoint handles both deal search (across all pipelines) and deal import (fetches deal properties + line items + equipment matching). The frontend adds a search bar at the top, a comparison banner below hero stats, and an unrecognized items card. All existing calculator logic is untouched — we only add input population and comparison display.

**Tech Stack:** Next.js API route, HubSpot CRM API (deals, line items, associations), React state management, existing `pricing-calculator.ts` helpers.

**Spec:** `docs/superpowers/specs/2026-03-25-pricing-calculator-deal-import-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/pricing-calculator.ts` | Modify | Add `matchLineItemToEquipment()` helper and `LOCATION_SCHEME` map |
| `src/app/api/accounting/pricing-calculator/deal-import/route.ts` | Create | Dual-mode endpoint: `?q=` for search, `?dealId=` for import |
| `src/app/dashboards/pricing-calculator/page.tsx` | Modify | Add DealSearchBar, ComparisonBanner, UnrecognizedItems, auto-populate logic |

---

## Chunk 1: Equipment Matching Helper

### Task 1: Add `matchLineItemToEquipment()` to pricing-calculator.ts

**Files:**
- Modify: `src/lib/pricing-calculator.ts` (append after `EQUIPMENT_CATALOG`, ~line 129)

- [ ] **Step 1: Add the LOCATION_SCHEME map and matching function**

Add at the end of `src/lib/pricing-calculator.ts` (before the `// Calculator input / output types` section, around line 305):

```typescript
// ---------------------------------------------------------------------------
// Deal import helpers
// ---------------------------------------------------------------------------

/** Map normalized PB location → pricing scheme ID */
export const LOCATION_SCHEME: Record<string, string> = {
  Westminster: "base",
  Centennial: "base",
  "Colorado Springs": "base",
  "San Luis Obispo": "ventura",
  Camarillo: "ventura",
};

/** Token sets for fuzzy matching line items to catalog equipment */
const MATCH_TOKENS: Array<{ code: string; category: string; tokens: string[] }> =
  EQUIPMENT_CATALOG.map((e) => ({
    code: e.code,
    category: e.category,
    tokens: e.label
      .toLowerCase()
      .replace(/[()]/g, "")
      .split(/[\s/]+/)
      .filter((t) => t.length > 2),
  }));

/**
 * Match a HubSpot line item to an EQUIPMENT_CATALOG entry.
 * Returns the equipment code or null if no match found.
 *
 * Strategy:
 * 1. Category-aware fuzzy name match — line item name/manufacturer must
 *    contain enough tokens from the catalog label.
 * 2. Aspirational SKU match against code field.
 */
export function matchLineItemToEquipment(
  name: string,
  sku: string,
  category: string,
  manufacturer: string,
): string | null {
  const haystack = `${name} ${manufacturer}`.toLowerCase();

  // Map HubSpot product_category to our category
  const catMap: Record<string, string> = {
    module: "module",
    solar_panel: "module",
    inverter: "inverter",
    battery: "battery",
    energy_storage: "battery",
    ev_charger: "other",
    other: "other",
  };
  const mappedCat = catMap[category.toLowerCase()] || "";

  // Try SKU exact match first (rarely succeeds but cheap)
  const skuMatch = EQUIPMENT_CATALOG.find(
    (e) => sku && e.code.toLowerCase() === sku.toLowerCase(),
  );
  if (skuMatch) return skuMatch.code;

  // Fuzzy name match — find catalog item with highest token overlap
  let bestCode: string | null = null;
  let bestScore = 0;

  for (const entry of MATCH_TOKENS) {
    // If we know the category, filter to matching category
    if (mappedCat && entry.category !== mappedCat) continue;

    const matched = entry.tokens.filter((t) => haystack.includes(t));
    // Require at least 2 tokens or all tokens if only 1
    const score = matched.length;
    const threshold = entry.tokens.length === 1 ? 1 : 2;
    if (score >= threshold && score > bestScore) {
      bestScore = score;
      bestCode = entry.code;
    }
  }

  return bestCode;
}
```

- [ ] **Step 2: Verify the module compiles**

Run: `npx tsc --noEmit 2>&1 | grep pricing-calculator`
Expected: No errors from pricing-calculator.ts

- [ ] **Step 3: Commit**

```bash
git add src/lib/pricing-calculator.ts
git commit -m "feat: add matchLineItemToEquipment() and LOCATION_SCHEME helpers"
```

---

## Chunk 2: Deal Import API Endpoint

### Task 2: Create the deal-import API route

**Files:**
- Create: `src/app/api/accounting/pricing-calculator/deal-import/route.ts`

This endpoint has two modes:
- `?q=searchTerm` — returns matching deals across all pipelines (for the search dropdown)
- `?dealId=123` — returns full deal data with line items and equipment matching (for import)

- [ ] **Step 1: Create the endpoint file**

Create `src/app/api/accounting/pricing-calculator/deal-import/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import {
  hubspotClient,
  searchWithRetry,
  fetchLineItemsForDeal,
} from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { PIPELINE_IDS, getStageMaps } from "@/lib/deals-pipeline";
import { normalizeLocation } from "@/lib/locations";
import {
  matchLineItemToEquipment,
  LOCATION_SCHEME,
} from "@/lib/pricing-calculator";

// ---------------------------------------------------------------------------
// Reverse pipeline lookup: HubSpot pipeline ID → pipeline key
// ---------------------------------------------------------------------------

function pipelineKeyFromId(pipelineId: string): string | null {
  for (const [key, id] of Object.entries(PIPELINE_IDS)) {
    if (id === pipelineId) return key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Search mode: ?q=term
// ---------------------------------------------------------------------------

const SEARCH_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "amount",
  "pb_location",
  "dealstage",
  "pipeline",
];

async function searchDeals(query: string) {
  const stageMaps = await getStageMaps();

  // Search across sales + project + D&R pipelines
  const pipelineKeys = ["sales", "project", "dnr"];
  const allResults: Array<{
    dealId: string;
    dealName: string;
    amount: number | null;
    location: string | null;
    stageLabel: string;
    pipeline: string;
  }> = [];

  for (const pKey of pipelineKeys) {
    const pipelineId = PIPELINE_IDS[pKey];
    if (!pipelineId) continue;

    try {
      const response = await searchWithRetry({
        filterGroups: [
          {
            filters: [
              {
                propertyName: "dealname",
                operator: FilterOperatorEnum.ContainsToken,
                value: `*${query}*`,
              },
              {
                propertyName: "pipeline",
                operator: FilterOperatorEnum.Eq,
                value: pipelineId,
              },
            ],
          },
        ],
        properties: SEARCH_PROPERTIES,
        sorts: [
          { propertyName: "dealname", direction: "ASCENDING" },
        ] as unknown as string[],
        limit: 10,
      });

      const stageMap = stageMaps[pKey] || {};
      for (const deal of response.results) {
        const props = deal.properties;
        allResults.push({
          dealId: String(props.hs_object_id),
          dealName: String(props.dealname || ""),
          amount: props.amount ? parseFloat(String(props.amount)) : null,
          location: normalizeLocation(String(props.pb_location || "")),
          stageLabel:
            stageMap[String(props.dealstage || "")] ||
            String(props.dealstage || ""),
          pipeline: pKey,
        });
      }
    } catch {
      // Skip pipeline if search fails
    }
  }

  // Sort by name relevance (exact prefix first) and limit to 10
  const q = query.toLowerCase();
  allResults.sort((a, b) => {
    const aStart = a.dealName.toLowerCase().startsWith(q) ? 0 : 1;
    const bStart = b.dealName.toLowerCase().startsWith(q) ? 0 : 1;
    if (aStart !== bStart) return aStart - bStart;
    return a.dealName.localeCompare(b.dealName);
  });

  return allResults.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Import mode: ?dealId=X
// ---------------------------------------------------------------------------

const IMPORT_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "amount",
  "pb_location",
  "postal_code",
  "project_type",
  "closedate",
  "is_participate_energy",
  "pipeline",
  "dealstage",
];

async function importDeal(dealId: string) {
  const portalId = process.env.HUBSPOT_PORTAL_ID || "21710069";

  // Fetch deal properties
  const dealResponse = await hubspotClient.crm.deals.basicApi.getById(
    dealId,
    IMPORT_PROPERTIES,
  );
  const props = dealResponse.properties;

  const pbLocation = normalizeLocation(String(props.pb_location || ""));

  const deal = {
    dealId: String(props.hs_object_id),
    dealName: String(props.dealname || "Untitled"),
    amount: props.amount ? parseFloat(String(props.amount)) : null,
    pbLocation,
    postalCode: String(props.postal_code || "").trim() || null,
    projectType: String(props.project_type || "").toLowerCase(),
    isPE: String(props.is_participate_energy || "").toLowerCase() === "true",
    closeDate: props.closedate ? String(props.closedate) : null,
    hubspotUrl: `https://app.hubspot.com/contacts/${portalId}/record/0-3/${dealId}`,
  };

  // Fetch line items
  const rawLineItems = await fetchLineItemsForDeal(dealId);

  const lineItems = rawLineItems.map((li) => ({
    id: li.id,
    name: li.name,
    sku: li.sku,
    quantity: li.quantity,
    unitPrice: li.price,
    totalPrice: li.amount,
    category: li.productCategory,
    manufacturer: li.manufacturer,
    matchedEquipment: matchLineItemToEquipment(
      li.name,
      li.sku,
      li.productCategory,
      li.manufacturer,
    ),
  }));

  return { deal, lineItems };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q");
  const dealId = searchParams.get("dealId");

  if (!query && !dealId) {
    return NextResponse.json(
      { error: "Provide ?q= for search or ?dealId= for import" },
      { status: 400 },
    );
  }

  try {
    if (dealId) {
      const result = await importDeal(dealId);
      return NextResponse.json(result);
    }

    const results = await searchDeals(query!);
    return NextResponse.json({ results });
  } catch (err) {
    console.error("[deal-import] Error:", err);
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Verify the endpoint compiles**

Run: `npx tsc --noEmit 2>&1 | grep deal-import`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/accounting/pricing-calculator/deal-import/route.ts
git commit -m "feat: add deal-import API endpoint with search and import modes"
```

---

## Chunk 3: Frontend — Deal Search Bar, Comparison Banner, Auto-Populate

### Task 3: Add deal import UI to the pricing calculator page

**Files:**
- Modify: `src/app/dashboards/pricing-calculator/page.tsx`

This task adds three things to the existing page:
1. A deal search bar at the top (above hero stats)
2. A comparison banner below hero stats (when deal loaded)
3. An unrecognized items card (when unmatched line items exist)
4. Auto-populate logic that sets equipment + config state from imported deal data

**Important context for the implementer:**
- The page is 790 lines. The equipment state lives at lines 168-173: `modSel`, `invSel`, `batSel`, `othSel` (all `EquipmentSelection[]`).
- Pricing scheme is `schemeId` (line 176), set via `setSchemeId`.
- PE is controlled by `activeAdders` (line 183) — PE is active when `activeAdders.includes("pe")`.
- Energy Community is `energyCommunity` (line 185) + `ecZip` (line 188) for the zip lookup.
- The `CalcBreakdown` result from `calcPrice()` is in `const calc = useMemo(...)` around line 227.
- Hero stats are at ~line 280 in a grid of 4 `StatCard` components.
- `EQUIPMENT_CATALOG` items have `code` and `category` fields. The state arrays hold `{ code, qty }`.

- [ ] **Step 1: Add deal import types and state**

At the top of the file, after existing imports, add:

```typescript
import { LOCATION_SCHEME } from "@/lib/pricing-calculator";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
```

Add these types after the existing imports block:

```typescript
// ---------------------------------------------------------------------------
// Deal import types
// ---------------------------------------------------------------------------

interface DealSearchResult {
  dealId: string;
  dealName: string;
  amount: number | null;
  location: string | null;
  stageLabel: string;
  pipeline: string;
}

interface ImportedLineItem {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  category: string;
  manufacturer: string;
  matchedEquipment: string | null;
}

interface ImportedDeal {
  deal: {
    dealId: string;
    dealName: string;
    amount: number | null;
    pbLocation: string | null;
    postalCode: string | null;
    projectType: string;
    isPE: boolean;
    closeDate: string | null;
    hubspotUrl: string;
  };
  lineItems: ImportedLineItem[];
}
```

Inside the `PricingCalculatorPage` component, after the existing EC state (around line 196), add:

```typescript
  // Deal import
  const [dealSearch, setDealSearch] = useState("");
  const [dealResults, setDealResults] = useState<DealSearchResult[]>([]);
  const [dealSearching, setDealSearching] = useState(false);
  const [dealSearchOpen, setDealSearchOpen] = useState(false);
  const [importedDeal, setImportedDeal] = useState<ImportedDeal | null>(null);
  const [dealImporting, setDealImporting] = useState(false);
  const [showImportConfirm, setShowImportConfirm] = useState<string | null>(null);
  const [unmatchedItems, setUnmatchedItems] = useState<ImportedLineItem[]>([]);
```

- [ ] **Step 2: Add deal search handler**

After the deal import state, add:

```typescript
  // Deal search — debounced
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleDealSearch = useCallback((query: string) => {
    setDealSearch(query);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (query.length < 2) {
      setDealResults([]);
      setDealSearchOpen(false);
      return;
    }
    setDealSearching(true);
    setDealSearchOpen(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/accounting/pricing-calculator/deal-import?q=${encodeURIComponent(query)}`,
        );
        if (!res.ok) throw new Error();
        const data = await res.json();
        setDealResults(data.results || []);
      } catch {
        setDealResults([]);
      } finally {
        setDealSearching(false);
      }
    }, 300);
  }, []);
```

Add `useRef` to the React import at the top of the file.

- [ ] **Step 3: Add deal import handler**

After the search handler, add:

```typescript
  const hasExistingData =
    modSel.length > 0 || invSel.length > 0 || batSel.length > 0 || othSel.length > 0;

  const handleDealSelect = useCallback(
    (dealId: string) => {
      setDealSearchOpen(false);
      if (hasExistingData) {
        setShowImportConfirm(dealId);
        return;
      }
      executeDealImport(dealId);
    },
    [hasExistingData],
  );

  const executeDealImport = useCallback(
    async (dealId: string) => {
      setDealImporting(true);
      setShowImportConfirm(null);
      try {
        const res = await fetch(
          `/api/accounting/pricing-calculator/deal-import?dealId=${dealId}`,
        );
        if (!res.ok) throw new Error();
        const data: ImportedDeal = await res.json();
        setImportedDeal(data);

        // Partition line items into matched and unmatched
        const matched = data.lineItems.filter((li) => li.matchedEquipment);
        const unmatched = data.lineItems.filter((li) => !li.matchedEquipment);
        setUnmatchedItems(unmatched);

        // Group matched items by category
        const newMods: EquipmentSelection[] = [];
        const newInvs: EquipmentSelection[] = [];
        const newBats: EquipmentSelection[] = [];
        const newOther: EquipmentSelection[] = [];

        for (const li of matched) {
          const equip = EQUIPMENT_CATALOG.find(
            (e) => e.code === li.matchedEquipment,
          );
          if (!equip) continue;
          const sel = { code: equip.code, qty: li.quantity };
          switch (equip.category) {
            case "module":
              newMods.push(sel);
              break;
            case "inverter":
              newInvs.push(sel);
              break;
            case "battery":
              newBats.push(sel);
              break;
            case "other":
              newOther.push(sel);
              break;
          }
        }

        // Merge duplicates (same code → sum qty)
        const merge = (arr: EquipmentSelection[]) => {
          const map = new Map<string, number>();
          for (const s of arr) map.set(s.code, (map.get(s.code) || 0) + s.qty);
          return Array.from(map, ([code, qty]) => ({ code, qty }));
        };

        setModSel(merge(newMods));
        setInvSel(merge(newInvs));
        setBatSel(merge(newBats));
        setOthSel(merge(newOther));

        // Set pricing scheme from location
        if (data.deal.pbLocation) {
          const scheme = LOCATION_SCHEME[data.deal.pbLocation];
          if (scheme) setSchemeId(scheme);
        }

        // Set PE status
        if (data.deal.isPE) {
          setActiveAdders((prev) =>
            prev.includes("pe") ? prev : [...prev, "pe"],
          );
          // Trigger EC lookup if zip available
          if (data.deal.postalCode && /^\d{5}$/.test(data.deal.postalCode)) {
            setEcZip(data.deal.postalCode);
          }
        } else {
          setActiveAdders((prev) => prev.filter((a) => a !== "pe"));
        }

        setDealSearch(data.deal.dealName);
      } catch {
        console.error("[deal-import] Failed to import deal");
      } finally {
        setDealImporting(false);
      }
    },
    [setModSel, setInvSel, setBatSel, setOthSel, setSchemeId, setActiveAdders, setEcZip],
  );

  const clearDeal = useCallback(() => {
    setImportedDeal(null);
    setUnmatchedItems([]);
    setDealSearch("");
    setModSel([]);
    setInvSel([]);
    setBatSel([]);
    setOthSel([]);
    setSchemeId("base");
    setActiveAdders(["pe"]);
    setEcZip("");
    setEnergyCommunity(false);
    setCustomAdder(0);
  }, []);
```

- [ ] **Step 4: Add the DealSearchBar JSX**

Inside the `DashboardShell`, right before the hero stats grid (`<div className="grid grid-cols-2 md:grid-cols-4 ...`), add:

```tsx
      {/* Deal Search */}
      <div className="relative mb-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <input
              type="text"
              placeholder="Search HubSpot deal to import..."
              value={dealSearch}
              onChange={(e) => handleDealSearch(e.target.value)}
              onFocus={() => dealResults.length > 0 && setDealSearchOpen(true)}
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-foreground text-sm placeholder:text-muted"
            />
            {dealSearching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {dealSearchOpen && dealResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-surface-elevated border border-border rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                {dealResults.map((d) => (
                  <button
                    key={d.dealId}
                    onClick={() => handleDealSelect(d.dealId)}
                    className="w-full text-left px-3 py-2 hover:bg-surface-2 transition-colors border-b border-border/50 last:border-0"
                  >
                    <div className="text-sm font-medium text-foreground truncate">
                      {d.dealName}
                    </div>
                    <div className="text-xs text-muted flex gap-2">
                      {d.amount != null && (
                        <span>
                          {d.amount.toLocaleString("en-US", {
                            style: "currency",
                            currency: "USD",
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      )}
                      {d.location && <span>{d.location}</span>}
                      <span>{d.stageLabel}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {dealImporting && (
            <span className="text-xs text-muted">Importing...</span>
          )}
        </div>
      </div>

      {/* Import confirm dialog */}
      {showImportConfirm && (
        <ConfirmDialog
          title="Replace Calculator Data?"
          message="Importing a deal will replace your current equipment and settings. Continue?"
          confirmLabel="Replace"
          onConfirm={() => executeDealImport(showImportConfirm)}
          onCancel={() => setShowImportConfirm(null)}
        />
      )}
```

- [ ] **Step 5: Add the ComparisonBanner JSX**

Right after the hero stats grid, before the main content columns, add:

```tsx
      {/* Deal Comparison Banner */}
      {importedDeal && (
        <div className="mb-6 bg-surface rounded-lg border border-border p-4 shadow-card">
          <div className="flex items-center justify-between mb-2">
            <a
              href={importedDeal.deal.hubspotUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-orange-400 hover:underline truncate"
            >
              {importedDeal.deal.dealName}
            </a>
            <button
              onClick={clearDeal}
              className="text-xs text-muted hover:text-foreground px-2 py-1 rounded hover:bg-surface-2"
            >
              ✕ Clear Deal
            </button>
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <span className="text-muted">Deal Amount: </span>
              <span className="font-semibold text-foreground">
                {importedDeal.deal.amount != null
                  ? importedDeal.deal.amount.toLocaleString("en-US", {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: 0,
                    })
                  : "—"}
              </span>
            </div>
            <div>
              <span className="text-muted">Calculated: </span>
              <span className="font-semibold text-foreground">
                {calc
                  ? calc.customerPrice.toLocaleString("en-US", {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: 0,
                    })
                  : "—"}
              </span>
            </div>
            {importedDeal.deal.amount != null && calc && (
              <div>
                <span className="text-muted">Δ </span>
                <span
                  className={`font-semibold ${
                    unmatchedItems.length > 0
                      ? "text-muted"
                      : importedDeal.deal.amount >= calc.customerPrice
                        ? "text-emerald-400"
                        : "text-red-400"
                  }`}
                >
                  {(importedDeal.deal.amount - calc.customerPrice).toLocaleString(
                    "en-US",
                    {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: 0,
                      signDisplay: "always",
                    },
                  )}
                </span>
              </div>
            )}
          </div>
          {unmatchedItems.length > 0 && (
            <div className="mt-2 text-xs text-yellow-400">
              ⚠ Comparison incomplete —{" "}
              {unmatchedItems
                .reduce((s, li) => s + li.totalPrice, 0)
                .toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                  maximumFractionDigits: 0,
                })}{" "}
              in unrecognized items not included in calculated price
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 6: Add the UnrecognizedItems card**

After the equipment section in the left column (after the last `<EquipSection>` for "Other"), add:

```tsx
            {/* Unrecognized line items from deal import */}
            {unmatchedItems.length > 0 && (
              <details className="mt-3 bg-surface-2 rounded-lg border border-border p-3">
                <summary className="text-sm font-medium text-yellow-400 cursor-pointer">
                  Unrecognized Line Items ({unmatchedItems.length})
                </summary>
                <div className="mt-2 space-y-1">
                  {unmatchedItems.map((li) => (
                    <div
                      key={li.id}
                      className="flex justify-between text-xs text-muted"
                    >
                      <span className="truncate mr-2">{li.name}</span>
                      <span className="whitespace-nowrap">
                        {li.quantity} × $
                        {li.unitPrice.toLocaleString()} = $
                        {li.totalPrice.toLocaleString()}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs font-medium text-foreground border-t border-border pt-1 mt-1">
                    <span>Total</span>
                    <span>
                      $
                      {unmatchedItems
                        .reduce((s, li) => s + li.totalPrice, 0)
                        .toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-1">
                    These items aren&apos;t in the calculator catalog and are not
                    included in the calculated price.
                  </p>
                </div>
              </details>
            )}
```

- [ ] **Step 7: Add click-outside handler for search dropdown**

Add a click-outside effect to close the dropdown. After the search handler, add:

```typescript
  // Close search dropdown on outside click
  const searchRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setDealSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
```

Add `useEffect` to the React import. Wrap the deal search `<div className="relative mb-4">` with `ref={searchRef}`.

- [ ] **Step 8: Verify the page compiles**

Run: `npx tsc --noEmit 2>&1 | grep pricing-calculator`
Expected: No errors

- [ ] **Step 9: Smoke test in browser**

Run: `npm run dev`
Navigate to: `http://localhost:3000/dashboards/pricing-calculator`
Verify:
1. Search bar appears at the top
2. Typing 2+ characters shows search results dropdown
3. Selecting a deal populates equipment and shows comparison banner
4. Unrecognized items card appears if there are unmatched line items
5. "Clear Deal" button resets everything
6. Delta color is green when deal >= calculated, red when deal < calculated, gray when unmatched items exist

- [ ] **Step 10: Commit**

```bash
git add src/app/dashboards/pricing-calculator/page.tsx
git commit -m "feat: add deal import search bar, comparison banner, and auto-populate to pricing calculator"
```

---

## Chunk 4: Route Permission & Final Verification

### Task 4: Add the new API route to role permissions

**Files:**
- Modify: `src/lib/role-permissions.ts`

The `/api/accounting` prefix is already in the allowed routes for all relevant roles (added in the earlier accounting suite work). Verify this covers the new sub-path.

- [ ] **Step 1: Verify `/api/accounting` covers the new endpoint**

Check that `role-permissions.ts` already includes `/api/accounting` in the `allowedRoutes` for PM, OPS_MGR, OPS, TECH_OPS, and SALES_MANAGER. The middleware uses segment-boundary matching so `/api/accounting` covers `/api/accounting/pricing-calculator/deal-import`.

Run: `grep -n "api/accounting" src/lib/role-permissions.ts`
Expected: Multiple hits showing `/api/accounting` in role allowlists

- [ ] **Step 2: Full type check**

Run: `npx tsc --noEmit`
Expected: No new errors (only pre-existing test file errors)

- [ ] **Step 3: Final commit and push**

```bash
git push
```
