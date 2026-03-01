---
name: design-reviewer
description: Use when the user asks to "review this design", "check the planset for PROJ-XXXX", "run a design review", "generate a DA", "send design approval", "send a revision request", "what needs to change in this design", "re-review this planset", "check the updated plans", or any task involving verifying a vendor planset against AHJ codes, utility requirements, sold equipment, or generating a design approval document.
version: 0.1.0
---

# Design Reviewer Skill

Automate PB's internal design review: compliance checks, equipment matching, layout review, revision management, and design approval document generation.

## Context

- PB outsources planset creation to a vendor
- The internal designer REVIEWS vendor work — does not create designs
- This skill automates the review checklist and manages the revision cycle
- Revisions are sent to the vendor via their portal
- Design approval documents are generated via PandaDoc
- **Skills complete HubSpot tasks only** — HubSpot workflows handle status transitions and pipeline moves

## Prerequisites

Before starting a design review, gather:
1. **Deal ID** — the HubSpot deal (PROJ-XXXX number or deal ID)
2. **Planset** — the vendor's planset PDF (use find-design-plans skill to locate)

## Workflow

### Step 0: Gather Context

1. Fetch deal properties:
   ```
   GET /api/projects/<dealId>
   ```
   Extract: module_brand, module_model, module_count, module_wattage,
   inverter_brand, inverter_model, inverter_qty, battery_brand, battery_model,
   battery_count, battery_expansion_count, system_size, ev_count,
   design_status, layout_status, pb_location

2. Fetch AHJ requirements:
   ```
   GET /api/ahj?dealId=<dealId>
   ```
   Extract: nec_code, ibc_code, ifc_code, design_wind_speed, design_snow_load,
   fire_offsets_required (boolean), fire_code_notes (text — contains setback specifics),
   fire_inspection_required, stamping_requirements

3. Fetch utility requirements:
   ```
   GET /api/utility?dealId=<dealId>
   ```
   Extract: ac_disconnect_required_ (note trailing underscore), is_production_meter_required_,
   backup_switch_allowed_, submission_type (interconnection method), design_notes

4. Fetch open HubSpot tasks for this deal:
   ```
   GET /api/tasks?dealId=<dealId>
   ```
   Identify which review step we're on based on task subject patterns.

5. Parse the task body for embedded context:
   The task body (HTML) contains structured data. Extract:
   - `Design Plans:` or `Design Folder:` — Google Drive link
   - `Project Type:` — Solar, Battery, etc.
   - `AHJ:` — jurisdiction name (verify matches API data)
   - `Utility:` — utility company name (verify matches API data)
   - `Sales Notes:` — free text from salesperson
   - `Interconnection Status:` — current status (optional — not present on initial review tasks)
   - `DA Rejection Reason:` — why DA was rejected (revision tasks only)

6. Locate and read the planset:
   - Use the Drive link from the task body, OR
   - Invoke the find-design-plans skill to locate it
   - Then invoke the planset-bom skill to extract the BOM

### Step 1: Compliance Check

Compare the planset against AHJ and utility requirements:

**AHJ Compliance:**
- [ ] Fire offsets: if fire_offsets_required = true, check fire_code_notes for specific setback distances (ridge, eave, valley, hip, pathway width) and verify planset complies
- [ ] Wind speed rating of racking meets AHJ design_wind_speed
  - Invoke product-lookup: check IronRidge XR10/XR100 load tables for the installed racking
- [ ] Snow load rating of racking meets AHJ design_snow_load
  - Invoke product-lookup: check racking snow load ratings
- [ ] Rapid shutdown compliant with NEC 690.12 (check nec_code from AHJ)
  - For Tesla systems: MCI-2 rapid shutdown transmitter per module
  - For Enphase systems: module-level shutdown built into microinverter
  - For other inverters: check for compliant MLPE
- [ ] Stamping requirements noted for engineering handoff (stamping_requirements)

**Utility Compliance:**
- [ ] AC disconnect present if ac_disconnect_required_ = true
- [ ] Production meter present if is_production_meter_required_ = true
- [ ] Backup switch configuration matches utility rules (backup_switch_allowed_)
- [ ] Interconnection submission type matches utility requirements (submission_type)

**Output:** Compliance report with PASS/FAIL per item and code references.
If ALL items pass, complete the relevant compliance task via:
```
PATCH /api/tasks { taskId, action: "complete", notes: "<compliance report>" }
```
If any FAIL, add findings as notes and proceed to Step 4 (Revision Management).

### Step 2: Equipment Match

Compare what was SOLD (HubSpot deal) vs what was DESIGNED (planset BOM):

| Check | Sold (HubSpot) | Designed (Planset BOM) | Match? |
|-------|----------------|----------------------|--------|
| Module brand/model | deal.module_brand + module_model | BOM module | |
| Module count | deal.module_count | BOM qty | |
| Module wattage | deal.module_wattage | BOM spec | |
| Inverter brand/model | deal.inverter_brand + inverter_model | BOM inverter | |
| Inverter qty | deal.inverter_qty | BOM qty | |
| Battery brand/model | deal.battery_brand + battery_model | BOM battery | |
| Battery count | deal.battery_count | BOM qty | |
| Expansion kit count | deal.battery_expansion_count | BOM expansion | |
| EV charger | deal.ev_count | BOM EV charger | |

**Note:** Inverter fields may be null on the deal (e.g., Tesla battery systems where Gateway-3 is implicit). If inverter_brand is null, check the planset BOM for what was designed and verify it's appropriate for the battery system.

For each equipment item, invoke **product-lookup** to verify compatibility:
- Module frame thickness fits racking clamp range (UFO mid clamp or CAMO end clamp)
- Rail (XR10/XR100) supports module weight at planned span
- Inverter supports the string configuration shown in planset
- Battery count matches expansion kit requirements (Tesla: 1 expansion per additional PW3)

**Output:** Equipment match report as table. Add as task notes.

### Step 3: Layout Review Assist

Read planset PV-0 (cover/site plan) and PV-1 (roof plan):

- Check array orientations — flag north-facing arrays as concern
- Check roof pitch — flag extreme pitches (>45° or <5°)
- Verify arrays clear of setback zones (distances from Step 1)
- Check for split arrays across multiple roof planes
- Verify module count per string matches inverter input specs
- Note any visible shading obstructions (trees, chimneys, vents)
- Check snow guard requirements (if design_snow_load > 0, invoke product-lookup for Alpine Snow Guard rules)

**Output:** Layout review notes with:
- Automated checks that pass
- Items flagged for human review (with reason)
- Items that definitely fail

**This step is SEMI-AUTOMATED** — the skill flags concerns, the designer makes the final call on spatial/visual items.

### Step 4: Revision Management

If ANY items failed in Steps 1-3:

1. **Aggregate all findings** into a structured revision request:
   ```
   REVISION REQUEST — PROJ-XXXX — [Date]
   Revision #{N} (increment from task subject pattern)

   MUST FIX:
   1. [Issue] — [What's wrong] — [What's needed, with code/spec reference]
   2. ...

   RECOMMENDED:
   1. [Issue] — [Suggestion]
   ```

2. Invoke **product-lookup** for correct specs and part numbers to include in the request
3. Invoke **engineering-reviewer** for structural/electrical input on technical issues
4. Format the revision request for vendor portal submission
5. Complete the "Send Plans For DA Revisions" task:
   ```
   PATCH /api/tasks { taskId, action: "complete", notes: "<revision request summary>" }
   ```

**On re-review** (when "Retrieve DA Revisions #{N}" task appears):
1. Re-run Steps 1-3 on the updated planset
2. Compare against previous revision request — verify each item was addressed
3. Generate a delta report:
   - Fixed items
   - Still outstanding items
   - New issues found
4. Determine if customer-visible changes require a new DA document

### Step 5: Design Approval Flow

When all review steps pass (no must-fix items):

1. Extract final BOM (should already be done from planset-bom in Step 0)
2. Gather equipment details from product-lookup (specs, key features)
3. Gather equipment photos (SolarView or AI-generated images — TBD)
4. Extract layout image from planset
5. Create DA document via PandaDoc:
   ```
   POST /api/pandadoc/create-da
   Body: {
     dealId: "<dealId>",
     customerName: "<from deal>",
     customerEmail: "<from deal contact>",
     equipment: [BOM items with specs],
     systemSizeKw: <from deal>,
     moduleCount: <from deal>,
     layoutImageUrl: "<image URL>",
     equipmentPhotoUrls: [photo URLs]
   }
   ```
6. Send DA to customer for signature
7. Complete the relevant task:
   ```
   PATCH /api/tasks { taskId, action: "complete", notes: "DA sent to customer via PandaDoc" }
   ```

After customer response:
- **Approved** — Complete "Upload Approved DA Document" task
- **Changes requested** — Go back to Step 4 (revision management)

## Task Subject to Handler Mapping

| Task Subject Pattern | Handler | Notes |
|---------------------|---------|-------|
| `Complete Initial Design Review - *` | Steps 1-3: Full review | First review of vendor planset |
| `Complete Final Design Review For Stamping - *` | Steps 1-2: Re-verify | Post-DA approval, ready for PE stamp |
| `Send Plans For DA Revisions #* - *` | Step 4: Create revision request | Designer identified issues |
| `Retrieve DA Revisions #* - *` | Steps 1-3: Re-review | Vendor submitted revised plans |
| `Upload Approved DA Document - *` | Step 5: Post-approval upload | DA signed by customer |
| `Upload Approved DA Document to Participate - *` | Step 5: Participate-specific | Participate Energy projects |
| `Follow Up On DA Approval - *` | N/A (manual) | 3+ day no-response follow-up |

## Integration Points

- **find-design-plans** — locate planset PDF in Google Drive
- **planset-bom** — extract BOM from planset PDF
- **product-lookup** — equipment specs, compatibility, qty rules, load tables
- **engineering-reviewer** — technical input for revision requests (structural/electrical)

**API routes used:**
- `GET /api/projects/<dealId>` — deal properties
- `GET /api/ahj?dealId=<dealId>` — AHJ requirements
- `GET /api/utility?dealId=<dealId>` — utility requirements
- `GET /api/tasks?dealId=<dealId>` — open HubSpot tasks
- `PATCH /api/tasks` — complete tasks / add notes
- `POST /api/pandadoc/create-da` — create DA document (Phase 1b)

## Important Notes

1. **Never update status fields directly** — only complete tasks. HubSpot workflows handle `design_status`, `layout_status`, and pipeline stage transitions.
2. **Task bodies contain sensitive data** — portal logins/passwords may appear. Never expose these in skill output.
3. **Revision tracking is built into task names** — `#1`, `#2`, etc. indicate revision round. Use this for delta reporting.
4. **Parse task bodies for context** — Drive links, AHJ, utility, revision reasons are embedded in the HTML body. Extract these to avoid redundant API calls.
5. **Location suffix convention** — task subjects end with `- ZRS`, `- WMS`, etc. These are location codes. Strip them when matching patterns.
