---
name: sales-advisor
description: Use when the user asks to "qualify this deal", "check this lead", "prep for handoff", "what's missing for ops", "review this sale", "validate this system", "handoff checklist", or any task involving sales deal qualification, equipment validation, or sales-to-ops handoff preparation.
version: 0.1.0
---

# Sales Advisor Skill

Assist PB salespeople from lead qualification through handoff to ops.

## Context

- PandaDoc contracts are already fully automated for sales — skill does NOT touch PandaDoc
- OpenSolar is the proposal engine — skill does NOT generate proposals
- This skill focuses on: qualifying leads, validating equipment configs, and ensuring clean handoffs
- **Skills complete HubSpot tasks only** — HubSpot workflows handle status transitions and pipeline moves

## Prerequisites

1. **Deal ID** — the HubSpot deal (PROJ-XXXX number or deal ID)

## Workflow

### Step 0: Gather Context

1. Fetch deal properties:
   ```
   GET /api/projects/<dealId>
   ```
   Extract: module_brand, module_model, module_count, module_wattage,
   inverter_brand, inverter_model, inverter_qty, battery_brand, battery_model,
   battery_count, battery_expansion_count, system_size, ev_count,
   pb_location, project_type, dealstage,
   all_document_parent_folder_id, os_project_id

2. Fetch AHJ data:
   ```
   GET /api/ahj?dealId=<dealId>
   ```
   Check: Does an AHJ record exist? What jurisdiction? Any unusual requirements?

3. Fetch utility data:
   ```
   GET /api/utility?dealId=<dealId>
   ```
   Check: Does a utility record exist? Interconnection feasibility?

4. Fetch open tasks:
   ```
   GET /api/tasks?dealId=<dealId>
   ```

### Step 1: Qualify Lead

Determine if PB can serve this project and flag risks early.

**Jurisdiction Check:**
- [ ] AHJ record exists for this deal
- [ ] PB serves this AHJ (check if it's in a known service area)
- [ ] Note any unusual code requirements from AHJ (stamping_requirements, fire_offsets_required)

**Utility Check:**
- [ ] Utility record exists for this deal
- [ ] Check interconnection feasibility (submission_type, design_notes)
- [ ] Note timeline expectations if available

**Red Flags:**
- [ ] HOA restrictions (check deal notes/custom fields)
- [ ] Historical landmark designation
- [ ] Complex roof type (tile, flat, standing seam, shake)
- [ ] Extreme AHJ requirements (unusual stamping, high wind/snow design loads)
- [ ] Very large system (>20kW may have additional utility requirements)

**Output:** Go/No-Go recommendation with specific reasons, added as task notes.

### Step 2: Validate Sold System

Confirm the equipment configuration on the deal is valid and compatible.

**Equipment Validation:**
- [ ] Module brand/model is a known product
  - Invoke product-lookup: verify module exists in references
- [ ] Inverter brand/model is valid (if specified)
  - Invoke product-lookup: verify inverter specs
- [ ] Battery brand/model is valid (if specified)
  - Invoke product-lookup: verify battery specs

**Compatibility Checks:**
- [ ] Inverter supports the number of modules (string sizing)
  - Invoke product-lookup: check inverter input limits vs module Voc/Isc
- [ ] Battery count matches expansion kit needs
  - Tesla: 1 expansion kit per additional PW3 beyond the first
  - Invoke product-lookup: check Tesla expansion rules
- [ ] Module is compatible with standard racking
  - Invoke product-lookup: check module frame thickness vs clamp range

**Utility Requirements:**
- [ ] AC disconnect present if ac_disconnect_required_ = true
- [ ] Production meter accounted for if is_production_meter_required_ = true
- [ ] Backup switch configuration valid if backup_switch_allowed_ = true/false

**Output:** Equipment validation report as task notes. Flag any issues needing salesperson attention.

### Step 3: Handoff Checklist

Verify everything is in place for a clean transition from sales to project pipeline.

**Required HubSpot Fields:**
- [ ] module_brand — populated
- [ ] module_model — populated
- [ ] module_count — populated
- [ ] system_size — populated
- [ ] battery_brand — populated (if battery project)
- [ ] battery_count — populated (if battery project)
- [ ] pb_location — populated
- [ ] project_type — populated

**External Systems:**
- [ ] Google Drive folder exists (all_document_parent_folder_id is populated)
- [ ] OpenSolar project linked (os_project_id is populated)
- [ ] Contract status verified (PandaDoc — should be signed)

**Zoho Customer:**
- [ ] Search Zoho for matching customer:
  ```
  GET /api/bom/zoho-customers?search=<customer name from deal>
  ```
  - If found: note the Zoho customer ID
  - If not found: flag for ops to create

**Site Survey:**
- [ ] Site survey data available (check deal properties or task completion)

**Output:** Handoff readiness checklist as task notes. List every missing item with what action is needed.
Complete the "Complete Contract and Deal Review" task if all items pass:
```
PATCH /api/tasks { taskId, action: "complete", notes: "<handoff checklist>" }
```

### Step 4: Pricing Review (Stretch Goal)

Sanity-check the sold price against expected equipment costs.

- Compare system_size and module_count against expected $/W range
- Check if incentive programs apply (SGIP, N3CE, CPA — based on utility/location)
- Flag margin concerns

**Output:** Pricing review summary as task notes.

## Task Subject to Handler Mapping

| Task Subject Pattern | Handler | Notes |
|---------------------|---------|-------|
| `Complete Contract and Deal Review - *` | Step 3: Handoff Checklist | Full handoff verification |
| `Confirm if launched into Hatch` | Step 1: Qualify Lead | Initial deal qualification |
| `Missing AHJ - *` | Step 1: Qualify Lead (partial) | AHJ population needed |

## Integration Points

- **product-lookup** — equipment specs, compatibility, qty rules

**API routes used:**
- `GET /api/projects/<dealId>` — deal properties
- `GET /api/ahj?dealId=<dealId>` — AHJ data
- `GET /api/utility?dealId=<dealId>` — utility data
- `GET /api/tasks?dealId=<dealId>` — open HubSpot tasks
- `PATCH /api/tasks` — complete tasks / add notes
- `GET /api/bom/zoho-customers?search=<name>` — Zoho customer lookup

## Important Notes

1. **Never update status fields or pipeline stages directly** — only complete tasks.
2. **PandaDoc is already automated** for sales contracts. Do not duplicate this.
3. **OpenSolar handles proposals** — this skill validates the sold system, not the proposal.
4. **Inverter may be null** — for Tesla battery systems, the inverter (Gateway-3) is implicit and may not be set on the deal.
5. **Location suffix convention** — task subjects end with `- ZRS`, `- WMS`, etc. Strip when matching patterns.
