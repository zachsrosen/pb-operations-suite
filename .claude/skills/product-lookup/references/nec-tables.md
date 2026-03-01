# NEC Reference Tables — Residential Solar PV

## Product Info
- **Category:** ELECTRICAL REFERENCE
- **Applicable codes:** NEC 2017, NEC 2020, NEC 2023

## NEC 310.16 — Conductor Ampacity (75°C Column, Copper)

| AWG | Ampacity (75°C) |
|-----|----------------|
| 14  | 20A |
| 12  | 25A |
| 10  | 35A |
| 8   | 50A |
| 6   | 65A |
| 4   | 85A |
| 3   | 100A |
| 2   | 115A |
| 1   | 130A |
| 1/0 | 150A |
| 2/0 | 175A |
| 3/0 | 200A |
| 4/0 | 230A |

## NEC 690.8 — PV Circuit Conductor Sizing

- Maximum circuit current = Isc x 1.25 (for continuous duty)
- Conductor ampacity >= maximum circuit current x 1.25 (temperature/conduit correction)
- Effective requirement: conductor ampacity >= Isc x 1.56
- For parallel strings: use sum of Isc from all parallel strings

## NEC 690.9 — Overcurrent Protection

- PV source circuit OCPD <= series fuse rating of module
- PV output circuit: size per 690.8 calculations
- Inverter output circuit: per manufacturer specs and NEC 240

## NEC 690.12 — Rapid Shutdown (2017/2020/2023)

**NEC 2017:**
- Conductors >10 ft from array boundary must be de-energized within 30 seconds
- Array boundary = 5 ft from array in all directions, from roof surface to top of array + 1 ft

**NEC 2020/2023:**
- Within array boundary: each PV module must be reduced to <= 80V within 30 seconds, <= 1V within 30 seconds of shutdown initiation
- Module-level shutdown required (MLPE: microinverters, DC optimizers, or rapid shutdown transmitters)
- Tesla MCI-2: 1 per module (transmitter-based shutdown)
- Enphase IQ8: built-in (microinverter = module-level shutdown)

## NEC 690.11 — Arc-Fault Protection (2017+)

- DC arc-fault circuit protection required for PV systems on or penetrating buildings
- Listed PV arc-fault circuit interrupter (Type 1 or Type 2)
- Most string inverters include built-in AFCI

## Voltage Drop Calculation

Formula: VD% = (2 x L x I x R) / (V x 1000)
- L = one-way conductor length (feet)
- I = current (amps)
- R = conductor resistance (ohms/1000ft at 75 deg C)
- V = system voltage

| AWG | Resistance (ohms/1000ft, 75 deg C, Copper) |
|-----|--------------------------------------|
| 14  | 3.14 |
| 12  | 1.98 |
| 10  | 1.24 |
| 8   | 0.778 |
| 6   | 0.491 |
| 4   | 0.308 |
| 3   | 0.245 |
| 2   | 0.194 |

**Targets:**
- Branch circuits: <= 2% voltage drop
- Feeder circuits: <= 3% voltage drop
- Total (branch + feeder): <= 5%

## NEC 250 — Grounding

### Equipment Grounding Conductor (EGC) — NEC 250.122

| OCPD Rating | Minimum EGC (Copper) |
|-------------|---------------------|
| 15A | 14 AWG |
| 20A | 12 AWG |
| 30A | 10 AWG |
| 40A | 10 AWG |
| 60A | 10 AWG |
| 100A | 8 AWG |
| 200A | 6 AWG |

### Grounding Electrode Conductor (GEC) — NEC 250.66

| Largest Service Conductor | Minimum GEC (Copper) |
|--------------------------|---------------------|
| 2 AWG or smaller | 8 AWG |
| 1 AWG or 1/0 | 6 AWG |
| 2/0 or 3/0 | 4 AWG |
| Over 3/0 through 350 kcmil | 2 AWG |

## NEC 705.12 — Point of Connection (Utility Interconnection)

### 120% Rule (Backfeed Breaker)
- Sum of backfeed breaker + main breaker <= 120% of bus rating
- Backfeed breaker must be at opposite end from main breaker
- Example: 200A panel -> max total = 240A -> max backfeed = 40A

### Supply-Side Connection (Line-Side Tap)
- Alternative to load-side connection
- Used when 120% rule cannot be met
- Requires service-rated tap conductors
- Must be installed between meter and main panel

## String Sizing Guidelines

### Temperature Correction for Voc
- Voc_max = Voc_stc x [1 + (Tc_min - 25 deg C) x (temp coefficient Voc / 100)]
- Use lowest expected temperature for the site (from ASHRAE data or local climate)
- Voc_max must be <= inverter maximum input voltage

### Minimum Voltage Check
- Vmp_min = Vmp_stc x [1 + (Tc_max - 25 deg C) x (temp coefficient Vmp / 100)]
- Use highest expected cell temperature (typically 65-75 deg C)
- Vmp_min of string must be >= inverter minimum MPPT voltage
