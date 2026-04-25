# Follow-up: Define 15 Zuper Product custom fields in admin

**Status:** Spawned 2026-04-24 from Phase B step 3 of catalog sync hardening.

## Context

Phase B step 3 was supposed to define 15 Zuper Product custom fields per [external mappings spec § 2](../specs/2026-04-24-catalog-sync-external-mappings.md#2-zuper-product-custom-fields--proposed-schema). Probing the Zuper REST API (`scripts/_zuper-custom-field-probe.ts`) found **no public endpoint for defining custom fields programmatically** — all candidates returned 404 except `/property` which is the real-estate properties resource, not field schema.

## What's needed

Zach (or a Zuper admin) needs to define these 15 fields manually in Zuper admin → Settings → Custom Fields → Product:

### MODULE — 5 fields
| Label | Type | Notes |
|---|---|---|
| Module Wattage (W) | NUMBER | |
| Module Efficiency (%) | NUMBER | 0–100 |
| Module Cell Type | DROPDOWN | Mono PERC / TOPCon / HJT / Poly / Thin Film |
| Module Voc (V) | NUMBER | |
| Module Isc (A) | NUMBER | |

### INVERTER — 4 fields
| Label | Type | Notes |
|---|---|---|
| Inverter AC Output (kW) | NUMBER | |
| Inverter Phase | DROPDOWN | Single / Three-phase |
| Inverter Type | DROPDOWN | String / Micro / Hybrid / Central |
| Inverter MPPT Channels | NUMBER | |

### BATTERY — 3 fields (also apply to BATTERY_EXPANSION)
| Label | Type | Notes |
|---|---|---|
| Battery Capacity (kWh) | NUMBER | |
| Battery Chemistry | DROPDOWN | LFP / NMC |
| Battery Continuous Power (kW) | NUMBER | |

### EV_CHARGER — 2 fields
| Label | Type | Notes |
|---|---|---|
| EV Charger Connector | DROPDOWN | J1772 / NACS / CCS |
| EV Charger Level | DROPDOWN | Level 1 / Level 2 / DC Fast |

### RACKING — 1 field
| Label | Type | Notes |
|---|---|---|
| Racking Roof Attachment | DROPDOWN | Comp Shingle / Tile / Metal / S-Tile |

## Mobile visibility

Per Zach's decision (default yes): add the fields to the Zuper mobile Product detail screen so techs see specs in the field.

## After fields are defined

Edit `src/lib/catalog-fields.ts` to add `zuperCustomField` keys per the spec § 2 table. Concrete diffs:

```typescript
// MODULE
{ key: "wattage",     label: "DC Size (Wattage)", type: "number", ..., zuperCustomField: "pb_module_wattage" },
{ key: "efficiency",  label: "Efficiency", ..., zuperCustomField: "pb_module_efficiency_pct" },
{ key: "cellType",    label: "Cell Type", type: "dropdown", ..., zuperCustomField: "pb_module_cell_type" },
{ key: "voc",         ..., zuperCustomField: "pb_module_voc_v" },
{ key: "isc",         ..., zuperCustomField: "pb_module_isc_a" },

// INVERTER
{ key: "acOutputKw",  ..., zuperCustomField: "pb_inverter_ac_output_kw" },
{ key: "phase",       ..., zuperCustomField: "pb_inverter_phase" },
{ key: "inverterType",..., zuperCustomField: "pb_inverter_type" },
{ key: "mpptChannels",..., zuperCustomField: "pb_inverter_mppt_channels" },

// BATTERY
{ key: "capacityKwh",       ..., zuperCustomField: "pb_battery_capacity_kwh" },
{ key: "chemistry",         ..., zuperCustomField: "pb_battery_chemistry" },
{ key: "continuousPowerKw", ..., zuperCustomField: "pb_battery_continuous_kw" },

// EV_CHARGER
{ key: "connectorType", ..., zuperCustomField: "pb_evcharger_connector" },
{ key: "level",         ..., zuperCustomField: "pb_evcharger_level" },

// RACKING
{ key: "roofAttachment",..., zuperCustomField: "pb_racking_roof_type" },
```

The mapping registry (M3.3 `buildCategoryExternalEdges`) and the M3.4 plumbing in `createOrUpdateZuperPart` pick these up automatically. No further code changes needed for the create path.

## Zuper API field-key resolution

Zuper's storage uses the `meta_data` array with human-readable labels as keys (e.g., `"label": "Module Wattage (W)"`, `"value": 400`). When we POST `custom_fields: { pb_module_wattage: 400 }`, Zuper resolves the snake_case key against existing field definitions to find the matching label. So **the snake_case keys MUST match what Zuper expects** — typically Zuper auto-generates a `field_key` from the label (e.g., "Module Wattage (W)" → `module_wattage_w`). Verify the actual generated keys after defining the fields in admin and adjust the `pb_*` keys above to match.

If Zuper allows custom keys, use the `pb_*` form. If it generates them from labels, use whatever Zuper produces. Run `scripts/_pull-zuper-product-schema.ts` again after defining fields and compare the `meta_data` shape on a sample product to confirm key naming.

## Backfill

Per spec § 2 open Q 2.2: yes, backfill existing Zuper Products from existing InternalProduct specs after the fields exist. Build a small `scripts/_backfill-zuper-product-customfields.ts` that walks every InternalProduct with a populated spec, maps to the Zuper customFields shape (using the same `buildZuperCustomFieldsFromMetadata` helper), and POSTs an update. ~30 min runtime estimated.

## Update path (out of scope today)

The M3.4 update branch in `src/lib/catalog-sync.ts:executeZuperSync` has a `TODO(M3.4)` — when a Sync Modal user changes a spec field on an existing product, the change currently routes through the generic `mapping ?? change.field` write which lands top-level instead of nested under `custom_fields`. Fix when the fields are populated.
