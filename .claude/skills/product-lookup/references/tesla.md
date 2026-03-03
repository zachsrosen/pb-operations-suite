# Tesla Energy Products Reference

Manufacturer reference for Tesla energy storage products used on Photon Brothers solar installations.

---

## Powerwall 3

**Model Number:** 1707000-xx-y (x = style code, y = pedigree; no functional difference between variants)

### Known Part Number Variants

| Part Number | Notes |
|---|---|
| 1707000-11-Y | Older variant |
| 1707000-21-K | Current variant seen in PB plansets |
| 1707000-11-L and higher | Supports metallic OR non-metallic conduit |
| 1707000-21-L and higher | Supports metallic OR non-metallic conduit |

### Specifications

| Spec | Value |
|---|---|
| Nominal Battery Energy | 13.5 kWh |
| Chemistry | LFP (Lithium Iron Phosphate) |
| AC Output (continuous) | 5.8 / 7.6 / 10 / 11.5 kW (config-dependent) |
| Max Continuous Charge | 5 kW (20.8 A AC) |
| Max Solar STC Input | 20 kW DC |
| MPPT Count | 6 |
| Max Current per MPPT | 15 A (13 A on some units) |
| PV DC Input Voltage Range | 60 - 550 V DC |
| PV DC MPPT Voltage Range | 60 - 480 V DC |
| Motor Start (LRA) | 185 A |
| Round-Trip Efficiency | 89% |
| Dimensions | 43.5 x 24 x 7.6 in (1105 x 609 x 193 mm) |
| Weight (installed) | 291.2 lb (132 kg) |
| Weight (unit only) | 272.5 lb (124 kg) |
| Operating Temperature | -20 C to 50 C (-4 F to 122 F) |
| Enclosure | NEMA 3R, IP67 |
| Environment | Indoor and outdoor rated |
| Max Elevation | 3000 m (9843 ft) |
| Warranty | 10 years |
| Certifications | UL 1741:2021, UL 1973, UL 9540, UL 9540A, IEEE 1547:2018 |

### Conduit Rules

- **1707000-11-L and higher** or **1707000-21-L and higher**: Metallic OR non-metallic conduit allowed
- **All other part numbers**: Metallic conduit ONLY
- All installations require minimum NEMA 4 (IPX5) conduit hubs
- Outdoor installs require minimum NEMA 4 fittings; indoor installs with no water risk can use indoor-rated fittings

### PB Usage

- Qty 1 on most residential jobs (paired with Gateway-3)
- Qty 2 on expansion jobs (second unit is an Expansion, not a second PW3)
- Integrated solar inverter eliminates need for separate string inverter on Tesla solar jobs
- Battery-only jobs still use PW3 + Gateway-3 but no solar input connections

---

## Gateway-3

**Model Number:** 1841000-x1-y

### Specifications

| Spec | Value |
|---|---|
| Nominal Voltage | 120/240 V AC split phase |
| Frequency | 60 Hz |
| Continuous Current Rating | 200 A |
| Max Short Circuit Current | 22 kA (Square D or Eaton breaker), 25 kA (Eaton breaker) |
| AC Meter Accuracy | +/- 0.5% |
| Internal Panelboard | 200 A, 8-space / 16-circuit |
| Allowable Breakers | Eaton BR, Siemens QP, or Square D HOM (10-125 A) |
| Overvoltage Category | Cat IV (USA), Cat III (CSA) |
| Dimensions | 26 x 16 x 6 in (660 x 411 x 149 mm) |
| Weight | 36 lb (16.3 kg) |
| Operating Temperature | -20 C to 50 C (-4 F to 122 F) |
| Enclosure | NEMA 3R |
| Environment | Indoor and outdoor rated |
| Max Elevation | 3000 m (9843 ft) |
| Mounting | Wall mount |

### Known Part Number Variants

| Part Number | Notes |
|---|---|
| 1841000-01-C | Listed at distributors (Cooper Electric) |
| 1841000-01-y | Listed at distributors (Soligent) |
| 1841000-x1-y | General model designation |

### Accessories / Service Parts

| Part Number | Description |
|---|---|
| 2065063-xx-y | Square D Lug Divider Kit (required with Square D main breaker) |
| 1549184-xx-y | 2" Conduit Hub Kit |
| 1549184-01-y | 1.25" Conduit Hub Kit |
| 1534278-50-y | Replacement Top Hatch |
| 1486318-20-A | Replacement Glass Door |

### PB Usage

- Qty 1 per system (always paired with PW3)
- Controls grid connection and backup switchover
- Present on ALL PW3 jobs (solar+battery and battery-only)
- NOT used when system uses Backup Switch instead (see below)
- Auto-detects outages for seamless backup transition

---

## MCI-2 (Mid-Circuit Interrupter)

**Part Number:** MCI-2 (P/N: 1879359-15-B at distributors)

PV rapid shutdown device meeting NEC Article 690. Required on all Tesla solar installations.

### Variants

| Variant | Nominal Current (IMP) | Max Short Circuit (ISC) |
|---|---|---|
| MCI-2 (Standard) | 13 A | 17 A |
| MCI-2 High Current | 15 A | 19 A |

### Specifications

| Spec | Value |
|---|---|
| Max System Voltage | 1000 V DC (limited to 600 V by PW3) |
| Max Disconnect Voltage | 165 V DC per unit (additive in series) |
| Max MCI per String | 5 |
| Control Method | Power Line Excitation |
| Passive State | Normally open (fail-safe shutdown) |
| Max Power Consumption | 7 W |
| Connectors | MC4 or MC4-EVO2 |
| Dimensions | 0.9 x 6.8 x 1.8 in (22 x 173 x 45 mm) |
| Weight | 0.26 lb (129 g) |
| Operating Temperature | -45 C to 70 C (-49 F to 158 F) |
| Enclosure | NEMA 4X / IP65 |
| Housing | Plastic |
| Warranty | 25 years |
| Certifications | UL 1741 PVRSE, UL 3741 |

### Quantity Rules

- **Per-string method:** 1 MCI-2 per string (installed mid-string)
- **Per-module method:** Qty = ceil(module_count / 2) -- one MCI-2 per two modules
- Standard MCI-2 for modules up to 13 A IMP; High Current for modules up to 15 A IMP
- NOT used on battery-only jobs (no PV array = no rapid shutdown needed)

---

## Powerwall 3 Expansion

**Model Number:** 1807000-xx-y

Battery-only expansion unit -- no inverter, no solar input. Uses the master PW3's integrated inverter.

### Known Part Number Variants

| Part Number | Notes |
|---|---|
| 1807000-20-B | Current variant seen in PB orders |
| 1807000-00-Y | Listed at distributors (Rexel) |

### Specifications

| Spec | Value |
|---|---|
| Nominal Battery Energy | 13.5 kWh |
| Voltage Range | 52 - 92 V DC |
| Dimensions | 43.5 x 24 x 6.6 in (1105 x 609 x 168 mm) |
| Weight (installed, wall mount) | 261.2 lb (118.5 kg) |
| Weight (unit only) | 242.5 lb (110 kg) |
| Operating Temperature | -20 C to 50 C (-4 F to 122 F) |
| Storage Temperature | -20 C to 30 C |
| Enclosure | NEMA 3R, IP67 |
| Environment | Indoor and outdoor rated |
| Max Elevation | 3000 m (9843 ft) |
| Connection | Expansion Harness to master PW3 |
| Max Expansion Units | 3 per PW3 (total 54 kWh with master) |
| Compatibility | Powerwall 3 ONLY |
| Certifications | UL 1973, UL 9540, UL 9540A |

### PB Usage

- Qty 1 on most expansion jobs (2x PW3 total = 27 kWh)
- Requires Expansion Stacking Kit for wall-mount config
- Always paired with a master PW3 -- never standalone
- Expansion jobs also require the Expansion Harness for DC connection

---

## Backup Switch

**Model Number:** 1624171-xx-y

Alternative to Gateway-3 for grid connection control. Installs behind the utility meter.

### Known Part Number Variants

| Part Number | Notes |
|---|---|
| 1624171-00-x | General model (Soligent, Greentech) |
| 1624171-00-X | Listed at distributors |

### Specifications

| Spec | Value |
|---|---|
| Continuous Load Rating | 200 A |
| Voltage | 120/240 V AC split phase |
| Max Short Circuit Current | 22 kA (with breaker) |
| AC Meter Accuracy | +/- 0.5% |
| Communication | CAN bus |
| Expected Service Life | 21 years |
| Conduit Compatibility | 1/2-inch NPT |
| Meter Compatibility | ANSI Type 2S ringless or ring type |
| External Interface | Contactor manual override + Reset button |
| Dimensions | 6.9 x 8.1 x 2.9 in (176 x 205 x 74 mm) |
| Weight | 2.8 lb |
| Operating Temperature | -40 C to 50 C (-40 F to 122 F) |
| Storage Temperature | -40 C to 85 C (-40 F to 185 F) |
| Enclosure | NEMA 3R |
| Warranty | 10 years |

### PB Usage

- Appears on SOME PB jobs (not all)
- When present, triggers different breaker/disconnect configuration in the design
- Installs behind utility meter or in standalone meter panel downstream of meter
- Auto-detects outages like Gateway-3
- Much smaller/lighter than Gateway-3 (2.8 lb vs 36 lb)

---

## Wall Mount & Stacking Kits

### Expansion Stacking Kit

**Part Number:** 1978069-xx-y (e.g., 1978069-00-B)

| Spec | Value |
|---|---|
| Weight (bracket) | 4.2 lb (1.9 kg) |
| Weight (accessories) | 1.5 lb (0.7 kg) |

**Kit contents:** 1x Mounting Bracket, 4x Mounting Bracket Shims, 4x Mounting Bracket Fasteners, 6x Fir Tree Plugs, 1x Fan Front Cover

### Expansion Wall Mount Kit

**Part Number:** 1978069-00-X

Used for wall-mounting an Expansion unit adjacent to (not stacked on) the master PW3.

### PB Usage

- Stacking Kit required when wall-mounting Expansion unit on top of or below master PW3
- Wall Mount Kit for side-by-side wall-mount configurations
- Shims in Stacking Kit are only used when bracket mounts to front of Expansion unit (not direct-to-wall)

---

## Part Number Quick Reference

All known Tesla part number families used on PB installations:

| Prefix | Product | Example |
|---|---|---|
| 1707000-xx-y | Powerwall 3 | 1707000-21-K |
| 1807000-xx-y | PW3 Expansion | 1807000-20-B |
| 1841000-x1-y | Gateway-3 | 1841000-01-C |
| 1624171-xx-y | Backup Switch | 1624171-00-X |
| 1978069-xx-y | PW3 Stacking/Wall Mount Kit | 1978069-00-B |
| 1879359-xx-y | MCI-2 | 1879359-15-B |
| 2065063-xx-y | GW3 Square D Lug Divider Kit | 2065063-xx-y |
| 1549184-xx-y | GW3 Conduit Hub Kit | 1549184-xx-y |

### Part Number Format Notes

- **xx** or **x1** = style/revision code
- **y** = pedigree suffix (manufacturing traceability)
- Style and pedigree codes do NOT affect functionality
- Conduit compatibility DOES depend on part number -- see Powerwall 3 conduit rules above

---

## Common PB System Configurations

| Configuration | Components | Notes |
|---|---|---|
| Solar + 1x Battery | 1x PW3 + 1x Gateway-3 + MCI-2s | Most common residential job |
| Solar + 1x Battery + Backup Switch | 1x PW3 + 1x Backup Switch + MCI-2s | Different breaker/disconnect config |
| Solar + 2x Battery (Expansion) | 1x PW3 + 1x Expansion + 1x Gateway-3 + Stacking Kit + MCI-2s | 27 kWh total |
| Battery-Only | 1x PW3 + 1x Gateway-3 | No solar equipment, no MCI-2s |
| Battery-Only + Backup Switch | 1x PW3 + 1x Backup Switch | No solar equipment, no MCI-2s |
