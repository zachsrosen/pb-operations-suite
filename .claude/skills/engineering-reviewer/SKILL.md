---
name: engineering-reviewer
description: Use when the user asks to "run an engineering review", "check the electrical design for PROJ-XXXX", "review the SLD", "prep for PE stamp", "structural review", "prep permit package", "what's missing for permits", or any task involving pre-PE-stamp electrical/structural validation and permit package preparation.
version: 0.1.0
---

# Engineering Reviewer Skill

Pre-PE-stamp electrical and structural validation, code compliance package preparation, and permit package readiness verification.

## Context

- PE stamp is outsourced to an external firm
- This skill prepares everything the PE needs and validates the design before sending
- The skill also preps the permit package that the permitting team will submit
- **Skills complete HubSpot tasks only** — HubSpot workflows handle status transitions and pipeline moves

## Prerequisites

Before starting an engineering review, gather:
1. **Deal ID** — the HubSpot deal (PROJ-XXXX number or deal ID)
2. **Planset** — the approved planset (post-design-review)

## Workflow

### Step 0: Gather Context

1. Fetch deal properties:
   ```
   GET /api/projects/<dealId>
   ```
   Extract: module_brand, module_model, module_count, module_wattage,
   inverter_brand, inverter_model, battery_brand, battery_model,
   battery_count, system_size, design_status, pb_location

2. Fetch AHJ requirements:
   ```
   GET /api/ahj?dealId=<dealId>
   ```
   Extract: nec_code, ibc_code, ifc_code, design_wind_speed, design_snow_load,
   fire_offsets_required, fire_code_notes, stamping_requirements

3. Fetch utility requirements:
   ```
   GET /api/utility?dealId=<dealId>
   ```
   Extract: ac_disconnect_required_, is_production_meter_required_,
   backup_switch_allowed_, submission_type, design_notes

4. Fetch open HubSpot tasks:
   ```
   GET /api/tasks?dealId=<dealId>
   ```

5. Locate and read planset (find-design-plans + planset-bom skills)
   Focus on PV-4 (single-line diagram) and PV-5/PV-6 (detail sheets)

### Step 1: Electrical Validation

Review the electrical design on the SLD (PV-4) for code compliance.

**Wire Sizing (NEC 310.16 / 690.8):**
- [ ] PV source circuit conductors: ampacity ≥ Isc × 1.56
  - Invoke product-lookup: get module Isc from spec sheet
  - Invoke product-lookup: reference nec-tables.md for ampacity table
- [ ] PV output circuit conductors: sized for total array current
- [ ] AC output conductors: sized per inverter output current rating

**Overcurrent Protection (NEC 690.9):**
- [ ] PV source circuit fuses ≤ module series fuse rating
- [ ] Backfeed breaker sized correctly for inverter output

**Breaker / Panel (NEC 705.12):**
- [ ] 120% rule check: main breaker + backfeed breaker ≤ 120% of bus rating
  - Example: 200A panel → max backfeed = 40A (200 × 1.2 - 200)
- [ ] If 120% rule fails, check for line-side tap or subpanel solution
- [ ] Backfeed breaker at opposite end from main breaker

**Voltage Drop:**
- [ ] Branch circuit voltage drop ≤ 2%
- [ ] Feeder voltage drop ≤ 3%
- [ ] Use formula: VD% = (2 × L × I × R) / (V × 1000)
  - Invoke product-lookup: reference nec-tables.md for conductor resistance values

**Rapid Shutdown (NEC 690.12):**
- [ ] Compliant with NEC edition from AHJ (nec_code)
  - NEC 2017: conductors >10 ft from array boundary de-energized in 30s
  - NEC 2020/2023: module-level ≤ 80V in 30s
- [ ] For Tesla: verify MCI-2 count = module count
- [ ] For Enphase: built-in (microinverter = MLPE)
- [ ] For string inverters: verify MLPE/rapid shutdown device present

**String Sizing:**
- [ ] Voc at lowest expected temperature ≤ inverter max input voltage
  - Invoke product-lookup: get module Voc, temperature coefficient
- [ ] Vmp at highest expected temperature ≥ inverter min MPPT voltage
- [ ] Isc × number of parallel strings ≤ inverter max input current

**Grounding (NEC 250):**
- [ ] Equipment grounding conductor (EGC) sized per NEC 250.122
- [ ] Grounding electrode conductor (GEC) sized per NEC 250.66
  - Invoke product-lookup: reference nec-tables.md for sizing tables

**Output:** Electrical review checklist (pass/flag per item with NEC code references).

### Step 2: Structural Validation

Verify the racking and attachment design handles local environmental loads.

**Wind Load:**
- [ ] AHJ design_wind_speed recorded
- [ ] Racking system rated for wind speed
  - Invoke product-lookup: IronRidge XR10/XR100 load tables
  - Check roof attachment pattern (IronRidge HUG or L-foot spacing)
- [ ] Attachment spacing meets or exceeds required pattern for wind zone

**Snow Load:**
- [ ] AHJ design_snow_load recorded
- [ ] Racking rated for snow load
  - Invoke product-lookup: racking snow load ratings
- [ ] If snow load > 0: snow guard qty and placement
  - Invoke product-lookup: Alpine Snow Guard rules (pitch limits, qty per array)

**Module Mounting:**
- [ ] Clamp selection: module frame thickness within clamp range
  - Invoke product-lookup: UFO mid clamp / CAMO end clamp compatibility
- [ ] Rail span: does not exceed max for module weight
  - Invoke product-lookup: IronRidge span tables
- [ ] Rail splice placement: not at mid-span (structural weak point)

**Roof Attachment:**
- [ ] Attachment type appropriate for roof material (composition, tile, metal)
  - Composition: HUG or lag bolt with flashing
  - Tile: tile hook or comp-out
  - Metal/standing seam: S-5! clamp
- [ ] Attachment rated for pull-out load at site conditions

**Output:** Structural review checklist (pass/flag per item).

### Step 3: Code Compliance Package

Compile all code requirements into a structured document for the PE reviewer.

```
CODE COMPLIANCE SUMMARY — PROJ-XXXX — [Date]

APPLICABLE CODES:
- NEC: [nec_code from AHJ]
- IBC: [ibc_code from AHJ]
- IFC: [ifc_code from AHJ]

STRUCTURAL REQUIREMENTS:
- Design wind speed: [design_wind_speed] mph
- Design snow load: [design_snow_load] psf
- Exposure category: [from AHJ if available]
- Seismic design category: [from AHJ if available]

FIRE CODE:
- Fire offsets required: [fire_offsets_required]
- Fire code notes: [fire_code_notes]
- Rapid shutdown: [NEC 690.12 compliance status from Step 1]

STAMPING REQUIREMENTS:
- [stamping_requirements from AHJ]
- PE stamp type: [wet stamp / digital / state-specific]

UTILITY REQUIREMENTS:
- AC disconnect: [required/not required]
- Production meter: [required/not required]
- Backup switch: [allowed/not allowed]
- Interconnection method: [submission_type]
```

**Output:** Code compliance summary document as task notes.

### Step 4: Permit Package Prep

Verify all required documents exist and are ready for the permitting team.

Check Google Drive (via find-design-plans) for:
- [ ] Stamped planset (PV-0 through PV-6)
- [ ] PE stamp / engineering letter
- [ ] Equipment spec sheets:
  - [ ] Modules
  - [ ] Inverter
  - [ ] Battery (if applicable)
  - [ ] Racking
- [ ] Single-line diagram (should be in planset PV-4)
- [ ] Structural calculations (if required by AHJ)
- [ ] Load calculations

Check AHJ-specific requirements:
- [ ] Any additional documents noted in AHJ record
- [ ] Document versions match the final approved design

**Output:** Permit readiness checklist (complete/missing per document).
Complete the relevant task:
```
PATCH /api/tasks { taskId, action: "complete", notes: "<permit readiness checklist>" }
```

## Task Subject to Handler Mapping

| Task Subject Pattern | Handler | Notes |
|---------------------|---------|-------|
| `Retrieve Plans for Stamping - *` | Steps 1-3: Full engineering review | Post-design-approval |
| `Submit Permit To AHJ - *` | Step 4: Permit package prep | Ready for AHJ submission |
| `Submit Interconnection Application To The Utility - *` | Step 4: Utility submission prep | Ready for utility submission |

## Integration Points

- **find-design-plans** — locate documents in Google Drive
- **planset-bom** — SLD reading, electrical details extraction
- **product-lookup** — manufacturer electrical/structural specs, NEC reference tables

**API routes used:**
- `GET /api/projects/<dealId>` — deal properties
- `GET /api/ahj?dealId=<dealId>` — AHJ codes and structural requirements
- `GET /api/utility?dealId=<dealId>` — utility rules
- `GET /api/tasks?dealId=<dealId>` — open HubSpot tasks
- `PATCH /api/tasks` — complete tasks / add notes

## Important Notes

1. **Never update status fields directly** — only complete tasks.
2. **Task bodies contain sensitive data** — portal logins/passwords for AHJ and utility portals. Never expose these in skill output.
3. **NEC edition matters** — always check which NEC edition the AHJ uses (nec_code). NEC 2017, 2020, and 2023 have different rapid shutdown requirements.
4. **This skill feeds into design-reviewer** — the design-reviewer calls engineering-reviewer for structural/electrical input during revision management.
