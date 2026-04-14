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
| `trenching` | Trenching | Custom fixed amount (not in current calculator — pass through as custom adder) |
| `groundMount` | Ground mount | Custom fixed amount |
| `mpuUpgrade` | MPU / service upgrade | Custom fixed amount |
| `evChargerInstall` | EV charger install | Custom fixed amount |

**Custom (dynamic list):**
- User can add arbitrary name + dollar amount entries
- Stored as JSON array: `[{ name: string, amount: number }]`
- Each entry has a remove (x) button
- Add row: text input for name, number input for amount, "+" button

### Mapping Adders to Calculator Inputs

When computing the pricing breakdown:

- **Roof checkboxes** — Only one roof type can apply at a time (they're mutually exclusive in the calculator). If multiple are checked, use the first checked one. If none checked, default to `"comp"` (no adder).
- **Steep pitch** — Maps to `pitchId: "steep1"`. If unchecked, `pitchId: "none"`.
- **2+ storey** — Maps to `storeyId: "2"`. If unchecked, `storeyId: "1"`.
- **Site checkboxes** — These don't have per-watt rates in the current calculator. Sum their associated amounts into `customFixedAdder`. If we don't have dollar amounts for these yet, they contribute $0 to the calculator but still serve as install planning checkmarks.
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

### HubSpot Sync

On sync, write adder state to a single HubSpot deal property:

- **Property name:** `idr_adders` (multi-line text or JSON string)
- **Format:** Comma-separated list of active adders, e.g., `"Tile roof, MPU upgrade, Tree removal ($800)"`
- This is informational — the pricing calculator doesn't read from HubSpot, so we just store a human-readable summary.

---

## Pricing Breakdown

### Data Flow

```
IdrItem snapshot props (module_brand, module_model, module_count,
  inverter_brand, inverter_model, inverter_qty,
  battery_brand, battery_model, battery_count,
  pb_location)
      │
      ▼
matchLineItemToEquipment() — map deal equipment to EQUIPMENT_CATALOG codes
      │
      ▼
Build CalcInput:
  - modules/inverters/batteries from matched equipment
  - pricingSchemeId from LOCATION_SCHEME[pb_location]
  - roofTypeId/storeyId/pitchId from adder checkboxes
  - customFixedAdder from site adders + custom adder amounts
  - activeAdderIds: [] (no PE/org adders in IDR scope)
      │
      ▼
calcPrice(input) → CalcBreakdown
      │
      ▼
Display breakdown + compare finalPrice vs dealAmount
```

### API Endpoint

**`GET /api/idr-meeting/pricing?dealId=X`**

Server-side endpoint that:
1. Fetches the deal's line items from HubSpot (reuses existing `fetchLineItemsForDeal()`)
2. Matches each line item to `EQUIPMENT_CATALOG` via `matchLineItemToEquipment()`
3. Resolves `pricingSchemeId` from the deal's `pb_location` via `LOCATION_SCHEME`
4. Accepts adder state as query params (or reads from IdrItem record)
5. Calls `calcPrice()` and returns `CalcBreakdown`

Alternatively, the calculation can run client-side since `calcPrice()` is a pure function with no API dependencies. The only server call needed is the line item fetch (already available via `/api/idr-meeting/line-items/[dealId]`). **Recommendation: client-side calculation** — avoids a new endpoint and recalculates instantly when adders are toggled.

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
- Green: absolute percentage < 5%
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
- Each checkbox onChange calls `onChange({ adderTileRoof: true })` etc.
- Custom adders onChange calls `onChange({ customAdders: [...] })`

### `PricingBreakdown.tsx`

New component in `src/app/dashboards/idr-meeting/`:

```
<Section title="Pricing Breakdown">
  <PricingBreakdown item={item} lineItems={lineItemsQuery.data?.lineItems} />
</Section>
```

Props: `{ item: IdrItem; lineItems: LineItem[] | undefined }`

Behavior:
- On mount / when `item` or `lineItems` change, build `CalcInput` from item snapshot props + adder state + matched line items
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

Add to `SNAPSHOT_PROPERTIES` in `idr-meeting.ts`:

```typescript
"module_brand", "module_model", "module_count",    // already present
"inverter_brand", "inverter_model", "inverter_qty", // already present
"battery_brand", "battery_model", "battery_count",  // already present
"pb_location",                                      // already present
```

No new HubSpot properties needed for the snapshot — all required equipment and location data is already fetched.

---

## Migration

Single Prisma migration adding 11 fields to `IdrMeetingItem`:
- 10 Boolean fields (all default false)
- 1 Json field (default `[]`)

No data backfill needed — existing items get defaults.

---

## Out of Scope

- PE participation / energy community toggles (excluded per user request)
- Editing the HubSpot deal amount from the IDR view
- Org-level adders (Q1 discount, SoCo discount) — not relevant to IDR meeting flow
- Persisting the calculated breakdown to DB (computed on the fly from current state)
- Dollar amounts for site adders (trenching, ground mount, MPU, EV charger) — these serve as install planning checkmarks; dollar values can be added later
