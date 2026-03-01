# Enphase Energy

Manufacturer: Enphase Energy, Inc.
Website: https://enphase.com
Product line: IQ8 Series Microinverters and System Components

---

## IQ8 Series Microinverters

Microinverters that convert DC to AC at each individual solar module, as opposed to a central string inverter. Each module operates independently -- shading or failure on one panel does not affect the rest of the array. The IQ8 series includes grid-forming capability (can form a microgrid without grid reference signal).

### Model Comparison

| Spec | IQ8M | IQ8A | IQ8H |
|------|------|------|------|
| Peak output power | 330 VA | 366 VA | 384 VA |
| Max continuous output | 325 VA | 349 VA | 380 VA |
| Max continuous current | 1.35 A | 1.45 A | 1.58 A |
| Peak efficiency | 97.7% | 97.3% | 97.2% |
| Module wattage range | 260-460 W | 320-460 W | 400-540 W |
| Cell compatibility | 60-cell, 72-cell | 60-cell, 72-cell | 72-cell, bifacial |
| Best fit panel range | 300-400 W | 350-450 W | 450-540 W |

### Model Selection Rule

Match microinverter to module wattage:
- **IQ8M**: Standard residential panels (350-400 W range)
- **IQ8A**: Higher-output residential panels (400-450 W range)
- **IQ8H**: High-power / commercial panels (450 W and above)

The microinverter's peak output must be >= the module's STC wattage for optimal clipping ratio.

### Common Specifications (All IQ8 Models)

| Attribute | Value |
|-----------|-------|
| Output voltage | 240 VAC (residential) |
| Frequency | 60 Hz |
| Power factor range | 0.70 leading to 0.70 lagging |
| Insulation | Double insulated (Class II) |
| Connectors | MC4 DC input (integrated on newer models) |
| Monitoring | Per-module via IQ Gateway + Enphase Enlighten |
| Rapid shutdown | Built-in (module-level, NEC 2017/2020 compliant) |
| Operating temp | -40 C to +65 C |
| Warranty | 25 years |

---

## System Components

### IQ Cable (Trunk Cable / Q Cable)

| Attribute | Value |
|-----------|-------|
| Conductors | 2-wire (L1, Neutral) -- no ground conductor on roof |
| Weight | 50% lighter than legacy trunk cable |
| Ground conductor | Not required (IQ8 is double-insulated, Class II) |
| Variants | Multiple drop spacings (portrait, landscape) |

Microinverters plug into the trunk cable at pre-spaced drop connectors. Cable runs along the underside of the racking rail.

**Commercial variant (QD Cable)**: 4-conductor (L1, L2, L3, Neutral sense), 12 AWG. Required for 3-phase commercial IQ8 systems. Not compatible with residential IQ Cable.

### IQ Gateway (formerly Envoy)

Communications gateway between microinverters and Enphase cloud (Enlighten). Required for monitoring and firmware updates. Connects to home network via WiFi or Ethernet.

### IQ Relay (Q Relay)

Grid interconnection relay that provides the AC disconnect between the microinverter array and the grid. Functions as the utility-required disconnect point.

| Attribute | Value |
|-----------|-------|
| Variants | Single-phase, Multi-phase |
| Capacity | Up to 40 A per phase |
| Location | At main panel or meter |

### Terminator Cap

End cap for the IQ Cable trunk run. Weatherproofs the unused end of the trunk cable after the last microinverter.

---

## Enphase vs. Tesla: System Architecture Comparison

PB installs both Enphase microinverter systems and Tesla string inverter systems. The architecture differs significantly.

### Side-by-Side

| Aspect | Enphase IQ8 | Tesla (Inverter + PW3) |
|--------|------------|----------------------|
| **Inverter type** | Microinverter (one per module) | String inverter (one per system) |
| **DC wiring** | None on roof -- AC from each module | DC strings from modules to inverter |
| **Trunk cable** | IQ Cable (2-wire AC) along rail | PV wire (DC) in home-run strings |
| **Junction box** | Not needed (AC at module) | EZ Solar JB-1.2 for PV-wire to THHN transition |
| **Rapid shutdown** | Built into microinverter (module-level) | Separate rapid shutdown devices required |
| **Monitoring** | Per-module (via IQ Gateway + Enlighten) | String-level (via Tesla app) |
| **Shade tolerance** | Excellent -- each module independent | Limited -- shaded module affects entire string |
| **Battery** | Enphase IQ Battery (or third-party) | Tesla Powerwall 3 |
| **Grid disconnect** | IQ Relay (Q Relay) | Integrated in Tesla inverter/gateway |
| **Expansion** | Add modules + microinverters individually | Add strings (within inverter input limits) |
| **Failure impact** | Single module goes offline | Entire string may be affected |

### BOM Differences (Enphase vs. Tesla Job)

When a PB job uses Enphase instead of Tesla:

**Added to BOM:**
- IQ8M/IQ8A/IQ8H microinverters (qty = number of modules)
- IQ Cable trunk cable (length based on array layout)
- Terminator caps (one per trunk cable run)
- IQ Gateway (one per system)
- IQ Relay (one per system)

**Removed from BOM:**
- Tesla string inverter
- Rapid shutdown devices (e.g., Tigo TS4-A-2F)
- DC home-run PV wire (replaced by AC trunk cable)
- EZ Solar JB-1.2 junction box (no DC wire transition needed)
- DC string fuses / combiners (if applicable)

### How to Identify Enphase Jobs

On PB plansets, Enphase jobs are identified by:
- Equipment schedule lists "Enphase IQ8M" (or IQ8A/IQ8H) instead of Tesla inverter
- Electrical one-line shows microinverters at each module position
- No DC string wiring shown -- trunk cable (AC) runs along rails
- No rapid shutdown devices in the BOM

---

## PB-Specific Usage Notes

- PB uses Enphase on select jobs -- the majority of PB installs use Tesla string inverters
- Enphase model selection is determined by the module wattage on the planset
- IQ Cable drop spacing must match module orientation (portrait vs. landscape) and module-to-module spacing on the racking
- The IQ Gateway installs near the main panel, not on the roof
- Enphase jobs do NOT need the Tigo rapid shutdown devices that Tesla string inverter jobs require

---

## Sources

- [Enphase IQ8M/IQ8A Datasheet](https://enphase.com/download/iq8m-iq8a-microinverter-data-sheet)
- [Enphase IQ8 Series Datasheet (Full)](https://enphase.com/en-lac/download/iq8-series-microinverters-data-sheet)
- [IQ8 Installation & Operation Manual](https://enphase.com/download/iq8-series-microinverter-installation-and-operation-manual)
- [Enphase IQ8 Quick Install Guide](https://enphase.com/download/iq8-series-microinverter-installation-guide)
- [SunWatts - Enphase IQ8 Overview](https://sunwatts.com/enphase-iq8-microinverters/)
