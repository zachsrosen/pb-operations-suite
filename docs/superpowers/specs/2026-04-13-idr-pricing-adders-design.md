# IDR Meeting — Pricing Breakdown & Adders Checklist

**Date:** 2026-04-13
**Status:** Draft
**Scope:** Two new sections in the IDR Meeting ProjectDetail right column

---

## Problem

The IDR meeting view shows the deal amount from HubSpot but provides no visibility into how that price was built — no COGS breakdown, no margin, no price-per-watt, and no way to see whether the deal price matches what the pricing calculator would produce. The team also has no structured way to track which site/roof adders apply to a deal during the IDR meeting.

## Solution

Add two new sections to the ProjectDetail right column, positioned below Meeting Notes and above AHJ & Utility Codes:

1. **Adders Checklist** — checkboxes for roof and site adders, plus custom name+amount entries. Persists to the IdrItem record and syncs to HubSpot.
2. **Pricing Breakdown** — read-only cost breakdown computed by the existing `calcPrice()` engine, with a mismatch comparison against the HubSpot deal amount.

Adders sit above Pricing Breakdown because toggling adders feeds into the price calculation.

---

## Adders Checklist

### Adder Categories

**Roof (6 checkboxes):**
| ID | Label | Maps to `ROOF_TYPES` / `STOREY_ADDERS` / `PITCH_ADDERS` |
|----|-------|----------------------------------------------------------|
| `tileRoof` | Tile roof | `ROOF_TYPES["tile"]` |
| `metalRoof` | Metal roof | `ROOF_TYPES["metal"]` |
| `flatFoamRoof` | Flat/foam | `ROOF_TYPES["flat"]` |
| `shakeRoof` | Shake | `ROOF_TYPES["shake"]` |
| `steepPitch` | Steep pitch (>7:12) | `PITCH_ADDERS["steep1"]` |
| `twoStorey` | 2+ storey | `STOREY_ADDERS["2"]` |

**Site (4 checkboxes):**
| ID | Label | Pricing impact |
|----|-------|---------------|
| `trenching` | Trenching | Planning-only flag, no pricing impact (future: add dollar amount input) |
| `groundMount` | Ground mount | Planning-only flag, no pricing impact |
| `mpuUpgrade` | MPU / service upgrade | Planning-only flag, no pricing impact |
| `evChargerInstall` | EV charger install | Planning-only flag, no pricing impact |

> **Note:** Site adders are install-planning checkmarks only. They do not affect the pricing calculation. Dollar amount inputs for these can be added in a future iteration.

**Custom (dynamic list):**
- User can add arbitrary name + dollar amount entries
- Stored as JSON array: `[{ name: string, amount: number }]`
- Each entry has a remove (x) button
- Add row: text input for name, number input for amount, "+" button

### Mapping Adders to Calculator Inputs

When computing the pricing breakdown:

- **Roof checkboxes** — Mutually exclusive: render as radio-style behavior. Checking one unchecks any other roof type. Precedence if somehow multiple are set: tile > metal > flat/foam > shake. If none checked, default to `"comp"` (no adder).
- **Steep pitch** — Maps to `pitchId: "steep1"`. If unchecked, `pitchId: "none"`.
- **2+ storey** — Maps to `storeyId: "2"`. If unchecked, `storeyId: "1"`.
- **Site checkboxes** — Planning-only flags with no pricing impact. They do NOT feed into `customFixedAdder`.
- **Custom entries** — Sum all custom amounts into `customFixedAdder`.

### Persistence

New fields on `IdrMeetingItem` Prisma model:

```prisma
// Adder checkboxes
adderTileRoof       Boolean @default(false)
adderMetalRoof      Boolean @default(false)
adderFlatFoamRoof   Boolean @default(false)
adderShakeRoof      Boolean @default(false)
adderSteepPitch     Boolean @default(false)
adderTwoStorey      Boolean @default(false)
adderTrenching      Boolean @default(false)
adderGroundMount    Boolean @default(false)
adderMpuUpgrade     Boolean @default(false)
adderEvCharger      Boolean @default(false)

// Custom adders — JSON array of {name: string, amount: number}
customAdders        Json    @default("[]")
```

These fields follow the same pattern as existing editable fields (difficulty, installerCount, etc.) — updated via the `PATCH /api/idr-meeting/items/[id]` endpoint and synced to HubSpot on "Sync to HubSpot" click.

**Required whitelist updates** (7 files):
1. `src/app/api/idr-meeting/items/[id]/route.ts` — add all 11 fields to `EDITABLE_FIELDS`
2. `src/app/api/idr-meeting/prep/route.ts` — add all 11 fields to `PREP_FIELDS`; validate `customAdders` on this route too
3. `src/app/api/idr-meeting/sessions/route.ts` — add fields to `pickPrepFields()` helper so prep data carries into live sessions
4. `src/app/api/idr-meeting/items/[id]/route.ts` DELETE handler — include adder fields when re-queuing skipped escalation items
5. `src/app/api/idr-meeting/items/[id]/sync/route.ts` — add adder serialization to `buildHubSpotPropertyUpdates()` and `buildHubSpotNoteBody()`
6. `src/app/api/idr-meeting/preview/route.ts` — ensure preview merge path reads/writes adder fields from `IdrEscalationQueue`
7. `src/app/api/idr-meeting/sessions/[id]/route.ts` — session-complete auto-sync must include `idr_adders` property and adder content in the note body (otherwise "finish meeting" flow skips adder sync for any items not manually synced)

**`customAdders` validation:** Max 20 entries. Name max 100 chars, must be non-empty. Amount can be negative (discounts). Validate in the PATCH handler before persisting.

### HubSpot Sync

On sync, write adder state to a single HubSpot deal property:

- **Property name:** `idr_adders` (multi-line text)
- **Prerequisite:** Create this property in HubSpot (group: `dealinformation`, type: `string`, fieldType: `textarea`) — either manually in HubSpot settings or via the Properties API during migration
- **Format:** Comma-separated list of active adders, e.g., `"Tile roof, MPU upgrade, Tree removal ($800)"`
- This is informational — the pricing calculator doesn't read from HubSpot, so we just store a human-readable summary

---

## Pricing Breakdown

### Data Flow

```
lineItemsQuery (existing, from /api/idr-meeting/line-items/[dealId])
  → returns LineItem[] with name, sku, quantity, productCategory, manufacturer, price, amount
      │
      ▼
matchLineItemToEquipment(name, sku, category, manufacturer)
  → maps each line item to an EQUIPMENT_CATALOG code
      │
      ▼
Build CalcInput:
  - modules/inverters/batteries from matched equipment + quantities
  - pricingSchemeId from LOCATION_SCHEME[normalizeLocation(item.region)]
    (item.region stores raw pb_location which may be non-canonical;
     normalize before lookup, fall back to "base" if unrecognized)
  - roofTypeId/storeyId/pitchId from adder checkboxes
  - customFixedAdder from custom adder amounts only (site adders are planning-only)
  - activeAdderIds: [] (no PE/org adders in IDR scope)
      │
      ▼
calcPrice(input) → CalcBreakdown
      │
      ▼
Display breakdown + compare finalPrice vs dealAmount
```

> **Note:** The calculation does NOT use IdrItem snapshot props for equipment. It uses line items fetched from HubSpot, which have the `sku`, `name`, `manufacturer`, and `productCategory` needed for `matchLineItemToEquipment()`. The IdrItem's `region` field (= `pb_location`) is used only for pricing scheme resolution via `normalizeLocation()`. If the normalized location is not in `LOCATION_SCHEME`, fall back to `"base"` (Colorado) and display a warning: "Unknown location — using default pricing scheme."

### Calculation Approach

Client-side calculation — `calcPrice()` is a pure function with no server dependencies. The only server call needed is the line item fetch (already available via `/api/idr-meeting/line-items/[dealId]`). No new API endpoint required. Recalculates instantly when adders are toggled.

> **PE deal caveat:** The IDR pricing breakdown excludes PE/org-level adders (`activeAdderIds: []`). For PE deals (visible by their "Participate" tag), the HubSpot deal amount stores full PB revenue (`hsAmount`), not the customer price. The delta will reflect this difference. Consider showing a note: "PE/org-level adders not included" when the deal has a PE-related tag.

### Display Sections

**Cost breakdown table (read-only):**
| Row | Source field |
|-----|-------------|
| Equipment COGS | `breakdown.cogs` |
| Labour | `breakdown.labour` |
| Acquisition | `breakdown.acquisition` |
| Fulfillment | `breakdown.fulfillment` |
| Adders | `breakdown.extraCosts + breakdown.fixedAdderTotal` |
| **Total Cost** | `breakdown.totalCosts` |
| Markup (X%) | `breakdown.markupPct` — percentage label |
| **Calculated Price** | `breakdown.finalPrice` |

**System metrics (read-only, dark inset):**
| Row | Source |
|-----|--------|
| PPW (price/watt) | `breakdown.finalPrice / breakdown.totalWatts` |
| System Size | `breakdown.totalWatts / 1000` kW |

**Mismatch comparison (always visible, color-coded):**
| Row | Source |
|-----|--------|
| Calculator | `breakdown.finalPrice` |
| HubSpot Deal | `item.dealAmount` |
| Delta | `dealAmount - finalPrice` (absolute + percentage) |

**Color thresholds for delta:**
- Percentage = `|delta| / dealAmount` (denominator is always the HubSpot deal amount)
- If `dealAmount` is 0 or null, show "N/A" instead of a percentage
- Green: < 5%
- Yellow: 5% - 15%
- Red: > 15%

### Equipment Matching Edge Cases

When `matchLineItemToEquipment()` returns null for a line item (unrecognized equipment):
- Display a warning: "X items could not be matched to the pricing catalog"
- Show unmatched items as a list below the breakdown
- Still compute the breakdown with matched items — unmatched items contribute $0 to COGS, which will naturally inflate the mismatch delta and draw attention

---

## UI Components

### `AddersChecklist.tsx`

New component in `src/app/dashboards/idr-meeting/`:

```
<Section title="Adders Checklist">
  <AddersChecklist item={item} onChange={handleFieldChange} readOnly={readOnly} />
</Section>
```

Props: `{ item: IdrItem; onChange: (updates: Partial<IdrItem>) => void; readOnly: boolean }`

Layout:
- Two-column grid of checkboxes grouped by category (ROOF, SITE headers)
- Custom adders list below with name/amount per row + remove button
- Add-custom row: text input + dollar input + "+" button
- **Roof checkbox onChange** sends all four roof fields in one update to enforce mutual exclusivity: `onChange({ adderTileRoof: true, adderMetalRoof: false, adderFlatFoamRoof: false, adderShakeRoof: false })`. This prevents stale true values from prior selections surviving the optimistic merge/PATCH flow.
- Site/pitch/storey checkboxes send single-field updates: `onChange({ adderTrenching: true })`
- Custom adders onChange calls `onChange({ customAdders: [...] })`

### `PricingBreakdown.tsx`

New component in `src/app/dashboards/idr-meeting/`:

```
<Section title="Pricing Breakdown">
  <PricingBreakdown item={item} lineItems={lineItemsQuery.data?.lineItems} />
</Section>
```

Props: `{ item: IdrItem; lineItems: LineItem[] | undefined }`

> **Important:** The existing `lineItemsQuery` type assertion in `ProjectDetail.tsx` must be widened to include `sku`, `price`, and `amount` fields (the API already returns them — only the client-side type narrows them out). Use the full `LineItem` interface from `hubspot.ts` or at minimum add `sku: string`.

Behavior:
- On mount / when `item` or `lineItems` change, build `CalcInput` from adder state + matched line items
- Call `calcPrice(input)` (client-side, pure function)
- Render cost table, system metrics, and mismatch comparison
- If line items are loading, show skeleton
- If no line items, show "No equipment data available"

### Integration in `ProjectDetail.tsx`

Right column order:
1. Install Planning (existing)
2. DA Status Actions (existing)
3. Meeting Notes (existing)
4. **Adders Checklist** (new)
5. **Pricing Breakdown** (new)
6. AHJ & Utility Codes (existing)

---

## IdrItem Type Changes

Add to the `IdrItem` TypeScript interface in `IdrMeetingClient.tsx`:

```typescript
// Adder checkboxes
adderTileRoof: boolean;
adderMetalRoof: boolean;
adderFlatFoamRoof: boolean;
adderShakeRoof: boolean;
adderSteepPitch: boolean;
adderTwoStorey: boolean;
adderTrenching: boolean;
adderGroundMount: boolean;
adderMpuUpgrade: boolean;
adderEvCharger: boolean;

// Custom adders
customAdders: Array<{ name: string; amount: number }>;
```

---

## HubSpot Snapshot Properties

No new HubSpot snapshot properties needed. Equipment data comes from line items (separate query), and `pb_location` is already captured as `IdrItem.region`.

---

## Migration

Single Prisma migration adding 11 fields to **both** `IdrMeetingItem` and `IdrEscalationQueue`:
- 10 Boolean fields (all default false)
- 1 Json field (default `[]`)

Both models need the same fields because prep-mode edits persist through `IdrEscalationQueue` and merge back into preview items. Without the escalation queue columns, adders entered in prep mode will not survive skip/re-queue or session creation.

No data backfill needed — existing rows get defaults.

---

## Out of Scope

- PE participation / energy community toggles (excluded per user request)
- Editing the HubSpot deal amount from the IDR view
- Org-level adders (Q1 discount, SoCo discount) — not relevant to IDR meeting flow
- Persisting the calculated breakdown to DB (computed on the fly from current state)
- Dollar amounts for site adders (trenching, ground mount, MPU, EV charger) — these serve as install planning checkmarks; dollar values can be added later
