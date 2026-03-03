# IMO Rapid Shutdown Switch

Manufacturer: IMO Precision Controls
Website: https://imopc.com
Product line: SI TRUE DC Solar Isolator range

---

## SI16-PEL64R-2 (Enclosed DC Disconnect Switch)

2-pole enclosed DC disconnect switch used as a rapid shutdown control unit in PV systems. Triggers Tesla MCI-2 module-level shutdown devices via 16/2 communication wire. The operator-independent spring mechanism provides guaranteed fast-break contact action with arc suppression in 3 ms typical (5 ms max).

### Specifications

| Attribute | Value |
|-----------|-------|
| Model | SI16-PEL64R-2 |
| Poles | 2 (single string) |
| Rated current | 16 A |
| Voltage (IEC) | 800 VDC |
| Voltage (UL) | 600 VDC |
| Contact distance per pole | 8 mm |
| Contact resistance per pole | 1.75 mOhm |
| Arc suppression time | 3 ms typical, 5 ms max |
| Enclosure rating | IP66 / NEMA 4X |
| Housing material | Self-extinguishing plastic |
| Body color | Grey |
| Handle | Lockable black rotary (locks in OFF position) |
| Dimensions | 180 x 98 x 107 mm (7.09 x 3.86 x 4.21 in) |
| Certifications | UL 508, cUL, CSA, CE |
| Switching mechanism | Operator-independent spring snap action |
| Warranty | 1 year |

### NEC Rapid Shutdown Compliance

The SI16-PEL64R-2 serves as the initiating device for NEC 690.12 rapid shutdown. When switched to OFF, it signals MCI-2 module-level electronics to de-energize conductors within the array boundary to less than 80 V within 30 seconds.

- NEC 2017 (690.12): Compliant as rapid shutdown initiation switch
- NEC 2020 (690.12): Compliant when paired with module-level shutdown devices (MCI-2)

---

## Installation Rules

### Quantity

- **Always 1 per job** -- a single SI16-PEL64R-2 controls the entire array's rapid shutdown

### Wiring

- Connected to Tesla MCI-2 devices via **16/2 communication wire**
- The comm wire daisy-chains from the SI16-PEL64R-2 to each MCI-2 unit on the roof
- MCI-2 devices are the module-level component; the SI16 is the control/initiation switch

### Mounting

- Typically mounted near the main service panel or inverter location
- Accessible to first responders per NEC 690.12 requirements
- Lockable handle allows lockout/tagout during maintenance

---

## PB-Specific Notes

### Planset Location

- **PV-4 (SLD diagram)**: The SI16-PEL64R-2 appears here as the rapid shutdown switch
- **PV-2 (BOM table)**: NOT listed -- this product is absent from the standard BOM table on plansets
- Extraction must pull this from the SLD, not rely on the BOM table

### BOM Category

- Category: **RAPID_SHUTDOWN**
- Always paired with MCI-2 devices in the BOM (the MCI-2 handles module-level shutdown; the SI16 initiates it)

### Common Configurations

| System Type | SI16-PEL64R-2 | MCI-2 Devices | Notes |
|-------------|---------------|---------------|-------|
| Tesla solar (any size) | 1 | Varies by module count | SI16 triggers all MCI-2 units |
| Battery-only | 0 | 0 | No array = no rapid shutdown needed |
