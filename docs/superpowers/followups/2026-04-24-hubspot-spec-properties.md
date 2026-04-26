# Follow-up: Create HubSpot Product spec properties

**Status:** Spawned 2026-04-24 from M3.2 audit (catalog sync hardening plan).

## Context

When auditing HubSpot Products properties (via `scripts/_pull-hubspot-product-properties.ts`, output saved to `scripts/hubspot-product-properties.json`), we found that the only spec-related properties HubSpot exposes today are:

| Property | Label | Used by |
|---|---|---|
| `dc_size` | DC Size (Wattage) | MODULE.wattage |
| `capacity__kw_` | Capacity (kW) | BATTERY.continuousPowerKw, EV_CHARGER.powerKw |
| `size__kwh_` | Size (kWh) | BATTERY.capacityKwh |
| `energy_storage_capacity` | Energy Storage Capacity | BATTERY.energyStorageCapacity |

All four are already wired via `hubspotProperty` keys in `src/lib/catalog-fields.ts`. **M3.2 (the original "wire additional HubSpot mappings" task) is therefore a no-op until HubSpot properties are created for the unmapped spec fields.**

## What's missing in HubSpot

The unmapped spec fields (~30 of them) live in our DB only. To surface any of them in HubSpot, you'd need to CREATE the property in HubSpot first via Settings → Properties → Products → Create property.

High-value candidates if you want to invest in HubSpot spec data:

### MODULE
- `module_efficiency` (number, %)
- `module_cell_type` (enumeration: Mono PERC / TOPCon / HJT / Poly / Thin Film)
- `module_voc` (number, V)
- `module_isc` (number, A)

### INVERTER
- `inverter_phase` (enumeration: Single / Three-phase)
- `inverter_type` (enumeration: String / Micro / Hybrid / Central)
- `inverter_mppt_channels` (number)

### BATTERY
- `battery_chemistry` (enumeration: LFP / NMC)

### EV_CHARGER
- `evcharger_connector_type` (enumeration: J1772 / NACS / CCS)
- `evcharger_level` (enumeration: Level 1 / Level 2 / DC Fast)

### RACKING
- `racking_roof_attachment` (enumeration: Comp Shingle / Tile / Metal / S-Tile)

## Wiring is automatic once properties exist

Thanks to M3.3 (the generalized mapping registry), once a HubSpot property exists, the wiring is a one-line edit per spec field in `src/lib/catalog-fields.ts`:

```typescript
{ key: "efficiency", label: "Efficiency", type: "number", hubspotProperty: "module_efficiency", ... }
```

The `buildCategoryExternalEdges()` function picks up the new edge automatically. No code-side work beyond editing the field def.

## Recommendation

Ship the higher-leverage M3 work first (M3.1 Zoho category switch, M3.4 Zuper custom fields). Tackle HubSpot property creation as a separate Phase B operational task when there's ops headroom — it's purely additive value, doesn't unblock anything else.
