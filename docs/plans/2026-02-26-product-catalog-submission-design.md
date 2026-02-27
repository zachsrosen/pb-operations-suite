# Product Catalog Submission Redesign

**Date:** 2026-02-26
**Status:** Design — awaiting implementation plan

## Problem

The current product submission form (`PushToSystemsModal`) is a generic modal with the same 6 fields for every product type. A solar module, an inverter, and a battery all get the same Brand / Model / Description / Category / Unit Spec / Unit Label inputs. Category-specific data (wattage, cell type, kWh capacity, MPPT channels, chemistry, etc.) has nowhere to go.

## Solution

Replace the modal with a full-page form at `/dashboards/catalog/new` that renders category-specific field sections based on the selected product category. Store specs in per-category database tables. Push field values to HubSpot, Zuper, and Zoho based on a configurable mapping.

## Architecture: Approach A — Single Page, Dynamic Field Sections

One route (`/dashboards/catalog/new`) with a category selector at top. A `<CategoryFields category={category} />` component swaps in the right field set. Category field definitions live in a config object — not separate components.

### Page Layout

```
┌─────────────────────────────────────────────────────┐
│  DashboardShell: "Add Product to Catalog"           │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─ Category Selector ────────────────────────────┐ │
│  │  [Module] [Battery] [Inverter] [EV Charger]    │ │
│  │  [Mounting Hardware] [Electrical Hardware] ...  │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  ┌─ Product Identity ─────────────────────────────┐ │
│  │  Brand (searchable dropdown)  │  Model / Part# │ │
│  │  SKU                         │  Description    │ │
│  │  Vendor Name                 │  Vendor Part#   │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  ┌─ Category Specs (dynamic) ─────────────────────┐ │
│  │  [Fields specific to selected category]        │ │
│  │  e.g. Wattage, Cell Type, Efficiency for Module│ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  ┌─ Pricing & Details ────────────────────────────┐ │
│  │  Unit Cost  │  Sell Price  │  Hard to Procure  │ │
│  │  Length     │  Width       │  Weight            │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  ┌─ Push to Systems ──────────────────────────────┐ │
│  │  ☑ Internal  ☑ HubSpot  ☑ Zuper  ☑ Zoho      │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│              [Cancel]  [Submit for Approval]         │
└─────────────────────────────────────────────────────┘
```

### Entry Points

1. Direct navigation to `/dashboards/catalog/new`
2. "Add to Systems" from BOM rows → navigates with `?prefill=` query params (brand, model, description, category)
3. Replaces the existing `PushToSystemsModal` with a redirect

## Categories

Using HubSpot's `product_category` enum as the source of truth (15 values):

| Display Label | Prisma Enum | Has Spec Fields? |
|---|---|---|
| Module | MODULE | ✅ 8 fields |
| Battery | BATTERY | ✅ 8 fields |
| Battery Expansion | BATTERY_EXPANSION | ✅ 8 fields (same as Battery) |
| Inverter | INVERTER | ✅ 7 fields |
| Optimizer | OPTIMIZER | ❌ |
| Gateway | GATEWAY | ❌ |
| D&R | D_AND_R | ❌ |
| Service | SERVICE | ❌ |
| Adder & Services | ADDER_SERVICES | ❌ |
| EV Charger | EV_CHARGER | ✅ 6 fields |
| Tesla System Components | TESLA_SYSTEM_COMPONENTS | ❌ |
| Project Milestones | PROJECT_MILESTONES | ❌ |
| Relay Device | RELAY_DEVICE | ✅ 3 fields |
| Electrical Hardware | ELECTRICAL_HARDWARE | ✅ 4 fields |
| Mounting Hardware | MOUNTING_HARDWARE | ✅ 6 fields |

Old enum values (`RAPID_SHUTDOWN`, `RACKING`, `ELECTRICAL_BOS`, `MONITORING`) get migrated to the new names.

## Common Fields (all categories)

| Field | Type | Required? |
|---|---|---|
| Brand / Manufacturer | Searchable dropdown (HubSpot's 33-value enum + "Add new") | Yes |
| Model / Part Number | Text | Yes |
| SKU | Text | No (auto-suggest from category+brand+model) |
| Description | Textarea | Yes |
| Vendor Name | Text | No |
| Vendor Part Number | Text | No |
| Unit Cost | Currency (USD) | No |
| Sell Price | Currency (USD) | No |
| Hard to Procure | Toggle | No |
| Length | Number | No |
| Width | Number | No |
| Weight | Number | No |

## Category-Specific Fields

### Module
| Field | Type | HubSpot Property |
|---|---|---|
| DC Size (Wattage) | Number | `dc_size` (exists) |
| Efficiency (%) | Number | custom property |
| Cell Type | Dropdown: Mono PERC, TOPCon, HJT, Poly, Thin Film | custom property |
| Voc (V) | Number | custom property |
| Isc (A) | Number | custom property |
| Vmp (V) | Number | custom property |
| Imp (A) | Number | custom property |
| Temp Coefficient Pmax (%/°C) | Number | custom property |

### Inverter
| Field | Type | HubSpot Property |
|---|---|---|
| AC Output (kW) | Number | `ac_size` (exists) |
| Max DC Input (kW) | Number | custom property |
| Phase | Dropdown: Single, Three-phase | custom property |
| Nominal AC Voltage | Dropdown: 240V, 208V, 480V | custom property |
| MPPT Channels | Number | custom property |
| Max Input Voltage (V) | Number | custom property |
| Inverter Type | Dropdown: String, Micro, Hybrid, Central | custom property |

### Battery + Battery Expansion
| Field | Type | HubSpot Property |
|---|---|---|
| Capacity (kWh) | Number | `size__kwh_` (exists) |
| Energy Storage Capacity | Number | `energy_storage_capacity` (exists) |
| Usable Capacity (kWh) | Number | custom property |
| Continuous Power (kW) | Number | `capacity__kw_` (exists) |
| Peak Power (kW) | Number | custom property |
| Chemistry | Dropdown: LFP, NMC | custom property |
| Round-Trip Efficiency (%) | Number | custom property |
| Nominal Voltage (V) | Number | custom property |

### EV Charger
| Field | Type | HubSpot Property |
|---|---|---|
| Charger Power (kW) | Number | `capacity__kw_` (exists) |
| Connector Type | Dropdown: J1772, NACS, CCS | custom property |
| Amperage (A) | Number | custom property |
| Voltage (V) | Number | custom property |
| Level | Dropdown: Level 1, Level 2, DC Fast | custom property |
| WiFi / Smart Features | Toggle | custom property |

### Mounting Hardware
| Field | Type | HubSpot Property |
|---|---|---|
| Mount Type | Dropdown: Roof, Ground, Carport, Flat Roof | custom property |
| Material | Dropdown: Aluminum, Steel | custom property |
| Tilt Range | Text | custom property |
| Wind Rating (mph) | Number | custom property |
| Snow Load (psf) | Number | custom property |
| Roof Attachment | Dropdown: Comp Shingle, Tile, Metal, S-Tile | custom property |

### Electrical Hardware
| Field | Type | HubSpot Property |
|---|---|---|
| Component Type | Dropdown: Conduit, Wire, Disconnect, Breaker, Combiner | custom property |
| Gauge / Size | Text | custom property |
| Voltage Rating (V) | Number | custom property |
| Material | Dropdown: Copper, Aluminum, PVC, EMT | custom property |

### Relay Device
| Field | Type | HubSpot Property |
|---|---|---|
| Device Type | Dropdown: Gateway, Meter, CT, Consumption Monitor | custom property |
| Connectivity | Dropdown: WiFi, Cellular, Ethernet, Zigbee | custom property |
| Compatible Inverters | Text | custom property |

## Database Schema

### Update `EquipmentCategory` Enum

Replace the current 8-value enum with 15 values matching HubSpot. Migrate existing rows.

### Per-Category Spec Tables

Each has a 1:1 relation to `EquipmentSku` via `skuId`:

- **ModuleSpec** — skuId, wattage, efficiency, cellType, voc, isc, vmp, imp, tempCoefficient
- **InverterSpec** — skuId, acOutputKw, maxDcInput, phase, nominalAcVoltage, mpptChannels, maxInputVoltage, inverterType
- **BatterySpec** — skuId, capacityKwh, energyStorageCapacity, usableCapacityKwh, continuousPowerKw, peakPowerKw, chemistry, roundTripEfficiency, nominalVoltage
  - Used by both Battery and Battery Expansion categories
- **EvChargerSpec** — skuId, powerKw, connectorType, amperage, voltage, level, smartFeatures
- **MountingHardwareSpec** — skuId, mountType, material, tiltRange, windRating, snowLoad, roofAttachment
- **ElectricalHardwareSpec** — skuId, componentType, gaugeSize, voltageRating, material
- **RelayDeviceSpec** — skuId, deviceType, connectivity, compatibleInverters

### Update `PendingCatalogPush`

Add a `metadata Json?` column to store category-specific field values before approval. Spec tables only get written on approval.

### Add `sku` field to `EquipmentSku`

Currently missing — needed for cross-system sync.

## Cross-System Push Logic

### What each system receives

| System | Common Fields | Category-Specific Fields | Notes |
|---|---|---|---|
| **Internal DB** | All | All (spec tables) | Source of truth |
| **HubSpot** | name, manufacturer, hs_sku, description, product_category, price, hs_cost_of_goods_sold, status, hard_to_procure, length, width | All via custom properties (~35 new) | Richest external system |
| **Zuper** | Part Name, Part Number, Brand, Category, Description, Unit Purchase Price, Unit Selling Price, Specification | TBD — custom fields possible | 9 categories need adding to Zuper |
| **Zoho** | name, sku, part_number, description, rate, purchase_rate, vendor_name, status | TBD — custom fields possible | Wire 5+ existing fields we're ignoring |

### Per-field push decisions: TBD

See `docs/product-property-mapping-simple.csv` — the "Push to HubSpot?", "Push to Zuper?", "Push to Zoho?" columns need to be filled in. The form and DB design work regardless; the push mapping is config that can be adjusted later.

### Zuper `Specification` field

Auto-generate a formatted string from the primary spec per category:
- Module: "410W Mono PERC"
- Inverter: "7.6kW Single-Phase String"
- Battery: "13.5kWh LFP"
- EV Charger: "11.5kW Level 2 NACS"

### Zuper categories to add (9)

Module, Optimizer, Gateway, D&R, Service, Adder & Services, EV Charger, Tesla System Components, Project Milestones

### Zoho fields to wire (currently ignored in code)

`rate`, `purchase_rate`, `vendor_name`, `part_number`, `unit` — all exist in Zoho's API, just not read/written by our client.

## Pre-Implementation Work (outside code)

1. **HubSpot:** Create ~35 custom properties on the Product object
2. **Zuper:** Add 9 missing categories in Parts & Services Settings
3. **Zuper:** Fix "Electrical Hardwire" typo → "Electrical Hardware" (if possible)
4. **Zuper/Zoho custom fields:** Create as determined by the push mapping spreadsheet
5. **Zoho:** No config changes needed for standard fields — just code wiring

## Migration

- Rename `EquipmentCategory` enum values: `RAPID_SHUTDOWN` → removed, `RACKING` → `MOUNTING_HARDWARE`, `ELECTRICAL_BOS` → `ELECTRICAL_HARDWARE`, `MONITORING` → `RELAY_DEVICE`
- Migrate existing `EquipmentSku` rows to new enum values
- Add 7 new enum values
- `PushToSystemsModal` component retired, replaced with redirect to `/dashboards/catalog/new`

## Reference

- Property mapping spreadsheet: `docs/product-property-mapping-simple.csv`
- Detailed mapping with types: `docs/product-property-mapping.csv`
