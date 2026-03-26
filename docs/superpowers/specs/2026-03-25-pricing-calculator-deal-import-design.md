# Pricing Calculator — Deal Import & Compare

**Date:** 2026-03-25
**Status:** Draft

## Problem

Users want to pull a HubSpot deal into the pricing calculator to auto-populate equipment and compare the deal's actual amount against the calculator's computed price. This helps validate whether deals are priced correctly.

## Design

### User Flow

1. User types a deal name into a search bar at the top of the pricing calculator
2. Dropdown shows matching deals (name, amount, location, stage) — searches across all pipelines
3. User selects a deal — confirmation prompt if calculator already has data
4. Calculator auto-populates:
   - Equipment from deal's HubSpot line items (matched to catalog where possible)
   - Location → pricing scheme mapping
   - PE status from deal's `is_participate_energy` property
   - Zip code → Energy Community lookup
5. Comparison banner appears below hero stats showing Deal Amount vs. Calculated Price vs. Delta
6. User can adjust any inputs and watch delta update live

### API: `GET /api/accounting/pricing-calculator/deal-import?dealId=X`

New endpoint that returns everything needed to populate the calculator from a deal. Makes two HubSpot calls:

1. **Deal properties** via `hubspotClient.crm.deals.basicApi.getById()` — fetches `amount`, `dealname`, `pb_location`, `postal_code`, `project_type`, `closedate`, `is_participate_energy`, `pipeline`, `dealstage`
2. **Line items** via existing `fetchLineItemsForDeal(dealId)` — returns associated line items with product enrichment

**Response shape:**
```typescript
interface DealImportResponse {
  deal: {
    dealId: string;
    dealName: string;
    amount: number | null;       // HubSpot deal amount
    pbLocation: string;
    postalCode: string | null;
    projectType: string;         // solar, battery, solar+battery
    isPE: boolean;               // from is_participate_energy property
    closeDate: string | null;
    hubspotUrl: string;
  };
  lineItems: Array<{
    id: string;
    name: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    category: string;            // from HubSpot product_category
    manufacturer: string;
    matchedEquipment: string | null;  // calculator equipment code if matched
  }>;
}
```

**Line item → Equipment matching logic:**

Match HubSpot line items to `EQUIPMENT_CATALOG` entries by:
1. Fuzzy name match (primary) — check if line item name or manufacturer contains key brand+model tokens from catalog entries (e.g., "Hyundai" + "440" → `HiN-T440NF(BK)`, "Powerwall 3" → `Tesla Powerwall 3`). Category-aware — only match modules to modules, inverters to inverters, etc.
2. SKU match (aspirational) — exact match against `code` field. In practice HubSpot SKUs are Zoho-sourced and rarely match OpenSolar component codes, so fuzzy name matching carries the load.
3. Unmatched items returned with `matchedEquipment: null`

The matching runs server-side so the client gets pre-resolved results.

**Deal search:** New lightweight search in the deal-import endpoint that searches across all pipelines (sales, project, D&R). The existing `/api/deals/search` is limited to the sales pipeline and would miss project-stage deals. The new search accepts `?q=` for name search and returns top 10 results with deal ID, name, amount, location, stage label.

### Frontend Changes (`pricing-calculator/page.tsx`)

**Deal Search Bar** — top of page, above hero stats:
- Debounced text input (300ms) calling `/api/accounting/pricing-calculator/deal-import?q=`
- Dropdown results: deal name, amount, location, stage
- On select: fetches `/api/accounting/pricing-calculator/deal-import?dealId=X`
- If calculator has existing data, shows confirm dialog: "Replace current calculator with deal data?"
- Shows loading state during import

**Auto-Population:**
- Matched line items → add to calculator equipment sections with correct qty
- Unmatched line items → shown in an "Unrecognized Items" card below equipment with name, qty, unit price, total. User can see the cost but items don't feed into calculator formulas
- Location → set pricing scheme ID (map `pbLocation` to scheme ID)
- `isPE` → check PE adder, trigger EC lookup with zip code
- Clear existing equipment before populating

**Comparison Banner** — sticky card below hero stats when a deal is loaded:
```
┌─────────────────────────────────────────────────────────┐
│  PROJ-12345 Turner Residence           [✕ Clear Deal]   │
│  Deal Amount: $45,000  │  Calculated: $43,200  │  Δ -$1,800  │
│  Deal Margin: 28%      │  Calc Margin: 32%                    │
└─────────────────────────────────────────────────────────┘
```
- Delta color: green when `deal amount >= calculated` (deal priced at or above calculator), red when `deal amount < calculated` (deal is underpriced — pricing concern)
- Margin shown for both
- "Clear Deal" button removes the comparison and resets to blank calculator
- Banner updates live as user adjusts inputs

**Unrecognized Items Card** — collapsible, shown only when there are unmatched line items:
```
┌─ Unrecognized Line Items (3) ──────────────────────────┐
│  Custom Racking Kit          2 × $450    = $900        │
│  Permit Fee                  1 × $350    = $350        │
│  Misc Hardware               1 × $125    = $125        │
│                              Total: $1,375             │
│  ⓘ These items aren't in the calculator catalog.       │
│    Their cost is not included in the calculated price.  │
└────────────────────────────────────────────────────────┘
```

### Location → Pricing Scheme Mapping

```typescript
const LOCATION_SCHEME: Record<string, string> = {
  "Westminster": "base",
  "Centennial": "base",
  "Colorado Springs": "base",
  "San Luis Obispo": "ventura",
  "Camarillo": "ventura",
};
```

Uses scheme IDs (`"base"`, `"ventura"`, etc.) matching `PRICING_SCHEMES` entries in `pricing-calculator.ts`. This is a best guess — user can override the pricing scheme dropdown after import.

### Files to Create/Modify

| File | Action |
|------|--------|
| `src/app/api/accounting/pricing-calculator/deal-import/route.ts` | **Create** — deal search + deal import endpoint (dual mode: `?q=` for search, `?dealId=` for import) |
| `src/app/dashboards/pricing-calculator/page.tsx` | **Modify** — add search bar, comparison banner, unrecognized items, auto-populate logic |
| `src/lib/pricing-calculator.ts` | **Modify** — add `matchLineItemToEquipment()` helper |

### What This Does NOT Do

- Does not write back to HubSpot (read-only comparison)
- Does not handle bulk deal analysis (single deal at a time)
- Does not modify the existing calculator logic — only adds input population and comparison display
- Does not attempt to match line items to roof type, storey, pitch, or other site settings (those stay manual)
