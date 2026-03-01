# Role-Based Skills Design: Sales Advisor, Design Reviewer, Engineering Reviewer

**Date:** 2026-03-01
**Status:** Approved design — ready for implementation planning

---

## Overview

Three new Claude Code skills that automate end-to-end solar project workflows for Photon Brothers — from sales qualification through design review through engineering prep. Each skill maps to a specific role and operates as a **task execution engine** within PB's existing HubSpot automation.

### Core Architecture: Task-Driven Execution

```
HubSpot workflow creates tasks
    → Skill picks up open tasks for a deal
    → Skill does the work
    → Skill completes HubSpot tasks (with notes/findings)
    → HubSpot workflow detects task completion
    → Status properties update automatically
    → Pipeline stage moves automatically
```

**Skills never update status fields or pipeline stages directly.** They complete tasks, and HubSpot workflows handle everything downstream. This keeps the skills simple and the automation logic centralized in HubSpot.

### Status Fields (read-only for skills, driven by task completion workflows)

| Pipeline | Status Fields | Driven By |
|----------|--------------|-----------|
| Sales | Sales pipeline deal stages | Deal stage transitions |
| Project | `design_status`, `layout_status` | Task completion workflows |
| Project | `permitting_status`, `interconnection_status` | Task completion workflows |
| Project | `construction_status`, `final_inspection_status`, `pto_status` | Task completion workflows |

### Shared Data Sources

All three skills share access to:
- **HubSpot deal properties** — equipment, dates, team, links
- **AHJ custom object** — permit turnaround, NEC/IBC/IFC codes, wind/snow loads, fire offsets, stamping requirements
- **Utility custom object** — interconnection rules, AC disconnect, production meter, backup switch, design rules
- **product-lookup skill** — manufacturer specs, qty rules, compatibility, SKU variants
- **HubSpot Tasks API** — fetch open tasks, complete tasks, add task notes

---

## Skill 1: `sales-advisor`

### Purpose
Assist PB salespeople from lead qualification through handoff to ops.

### Triggers
- "qualify this deal", "check this lead"
- "prep for handoff", "what's missing for ops"
- "review this sale", "validate this system"

### Pipeline
Sales pipeline deal stages

### PandaDoc
Already fully automated for sales contracts — skill does not touch PandaDoc.

### Task Handlers

#### 1. Qualify Lead
**What it does:** Determines if PB can serve this project and flags risks early.

- Pull AHJ data → check if PB serves this jurisdiction, check for unusual code requirements
- Pull utility data → check interconnection feasibility, timeline expectations
- Check roof type/complexity indicators if available
- Flag red flags (HOA, historical landmark, complex roof, extreme AHJ requirements)

**Output:** Go/No-Go recommendation with specific reasons, added as task notes.

#### 2. Validate Sold System
**What it does:** Confirms the equipment configuration on the deal is valid and compatible.

- Read deal equipment fields (module brand/model/count, inverter, battery, expansion)
- Cross-reference product-lookup → is this configuration valid?
- Check utility rules → AC disconnect required? Production meter? Backup switch allowed?
- Check compatibility (inverter supports battery count, module fits racking, etc.)
- Flag incompatibilities or missing equipment

**Output:** Equipment validation report as task notes. Flag any issues that need salesperson attention before handoff.

#### 3. Handoff Checklist
**What it does:** Verifies everything is in place for a clean transition from sales to project pipeline.

- Scan required HubSpot deal fields → list what's missing or empty
- Check Zoho customer exists (search by name or future hubspot_contact_id match)
- Verify Google Drive folder structure exists (all_document_parent_folder_id populated)
- Verify OpenSolar project linked (os_project_id populated)
- Check contract status (PandaDoc — verify signed)
- Verify site survey data available

**Output:** Handoff readiness checklist as task notes. List every missing item with what action is needed.

#### 4. Pricing Review (stretch goal)
**What it does:** Sanity-check the sold price against expected equipment costs.

- Compare sold price vs expected cost from product catalog / Zoho inventory pricing
- Check incentive eligibility (SGIP, N3CE, CPA, etc.) and whether they're applied
- Flag margin concerns

**Output:** Pricing review summary as task notes.

### Data Sources
- HubSpot deal properties (equipment, dates, links, team)
- AHJ custom object (jurisdiction feasibility, code requirements)
- Utility custom object (interconnection rules, design requirements)
- product-lookup skill (equipment specs, compatibility)
- Zoho customer search (handoff verification)
- Google Drive (folder existence check)

---

## Skill 2: `design-reviewer`

### Purpose
Automate and assist the internal designer's review of vendor plansets, manage revisions with the vendor, and generate design approval documents via PandaDoc.

**This is the highest-value skill — directly addresses the design review bottleneck.**

### Context
- PB outsources initial design/planset creation to a vendor
- The internal designer's job is to **review** the vendor's work, not create designs
- The designer is responsible for compliance verification, equipment matching, layout review, revision coordination, and DA document creation/sending
- Revisions come from: customer feedback on DA, internal QC catches, PE/AHJ rejection

### Triggers
- "review this design", "check planset for PROJ-XXXX"
- "generate DA", "send design approval"
- "send revision request", "what needs to change"
- "re-review this planset", "check the updated plans"

### Status Fields (read-only)
- `design_status` — Ready for Design → In Progress → Ready For Review → Final Review/Stamping → Draft Complete → DA Approved → Submitted To Engineering → Design Complete
- `layout_status` — design approval tracking

### Task Handlers

#### 1. Compliance Check
**What it does:** Automatically verifies the vendor's planset against AHJ codes and utility requirements.

- Fetch AHJ data → setbacks, fire offsets, wind/snow loads, NEC/IBC/IFC codes, stamping requirements
- Fetch utility rules → AC disconnect required, production meter required, backup switch allowed, interconnection type
- Read planset via planset-bom → extract designed system details
- Compare designed system vs AHJ requirements (setback distances, fire offset compliance, structural adequacy for wind/snow)
- Compare designed system vs utility requirements (required equipment present, correct configuration)
- Invoke product-lookup → verify equipment meets code requirements (e.g., racking rated for wind/snow load)

**Output:** Compliance report (pass/fail per requirement with specific code references) as task notes.

#### 2. Equipment Match
**What it does:** Verifies what was designed matches what was sold.

- Pull HubSpot deal → what was sold (module brand/model/count, inverter, battery, expansion, EV)
- Pull planset BOM via planset-bom → what was designed
- Compare sold vs designed → flag mismatches (wrong module, different count, missing battery, etc.)
- Invoke product-lookup → validate compatibility of designed equipment
  - Module frame thickness fits clamp range
  - Rail supports module weight and span
  - Inverter supports module string configuration
  - Battery count matches expansion kit needs

**Output:** Equipment match report (matched / mismatched / missing items) as task notes.

#### 3. Layout Review Assist
**What it does:** Flags layout concerns that need human review.

- Read planset PV-0/PV-1 → array layout, orientation, tilt, roof areas
- Check arrays against AHJ setback requirements (fire, ridge, eave, valley)
- Flag unusual configurations (north-facing arrays, extreme pitch, split arrays across multiple roof planes)
- Note potential shading concerns if visible in plans
- Check module count per array matches string sizing for inverter

**Output:** Layout review notes (automated flags + areas flagged for human judgment) as task notes. This is semi-automated — the skill flags concerns, the designer makes the call.

#### 4. Revision Management
**What it does:** Generates structured revision requests for the vendor and manages the re-review cycle.

When issues are found in steps 1-3:
- Aggregate all findings into a structured revision request
  - What's wrong (specific issue)
  - What's needed (specific fix, with code/spec references)
  - Priority (must-fix vs nice-to-have)
- Invoke product-lookup → include correct specs, part numbers, and installation requirements in the revision request
- Invoke engineering-reviewer → get structural/electrical input on technical issues
- Format for vendor communication (clear, actionable items)
- Complete the "send revision request" task

On re-review (updated planset received):
- Re-run compliance check, equipment match, and layout review on updated planset
- Compare against previous revision request → verify each item was addressed
- Determine if changes require a new DA document (customer-visible changes = new DA)

**Output:** Structured revision request document. On re-review: delta report showing what was fixed vs what remains.

#### 5. Design Approval Flow
**What it does:** Generates and sends the design approval document to the customer.

When all review tasks pass:
- Extract final BOM via planset-bom
- Gather equipment details from product-lookup (specs, photos)
- Gather equipment photos (SolarView or AI-generated images)
- Extract layout image from planset
- Create DA document via PandaDoc API:
  - Equipment list with specs
  - Array layout image
  - Equipment photos
  - System size and production summary
- Send DA to customer for signature via PandaDoc
- Complete the "DA sent" task

After customer response:
- If approved → complete "DA approved" task
- If customer requests changes → feeds back into revision management (step 4)

### Data Sources
- HubSpot deal properties + AHJ + Utility custom objects
- planset-bom skill (BOM extraction from vendor planset)
- product-lookup skill (specs, compatibility, qty validation)
- engineering-reviewer skill (technical input for revisions)
- find-design-plans skill (locate planset in Google Drive)
- PandaDoc API (DA document creation and sending)
- SolarView / AI image generation (equipment photos)

---

## Skill 3: `engineering-reviewer`

### Purpose
Pre-PE-stamp electrical and structural validation, code compliance package preparation, and permit package readiness verification. Feeds into permitting but does not own the permitting process.

### Context
- PE stamp is outsourced to an external firm
- This skill prepares everything the PE needs and validates the design before sending
- The skill also preps the permit package that permitting team will submit

### Triggers
- "engineering review for PROJ-XXXX"
- "check electrical design", "review the SLD"
- "prep for PE stamp", "structural review"
- "prep permit package", "what's missing for permits"

### Status Fields (read-only)
- `design_status` (Submitted To Engineering → Design Complete)

### Task Handlers

#### 1. Electrical Validation
**What it does:** Reviews the electrical design on the SLD for code compliance.

- Read planset PV-4 (single-line diagram) via planset-bom
- Check wire sizing vs NEC ampacity tables (conductor size for circuit current)
- Verify breaker sizing (main panel, subpanel, backfeed breaker)
- Check voltage drop calculations (< 2% branch, < 3% feeder per NEC recommendation)
- Verify rapid shutdown compliance (NEC 690.12) — correct RSU placement and wiring
- Validate inverter/module string sizing (Voc, Isc within inverter limits considering temperature)
- Verify grounding (equipment ground, GEC sizing)
- Invoke product-lookup → manufacturer electrical specs for installed equipment

**Output:** Electrical review checklist (pass/flag per item with NEC code references) as task notes.

#### 2. Structural Validation
**What it does:** Verifies the racking and attachment design handles local environmental loads.

- Fetch AHJ data → design_wind_speed, design_snow_load
- Cross-reference product-lookup → racking load ratings
  - IronRidge XR10/XR100 span tables
  - Attachment spacing (HUG, L-foot, S-5! clamp rated loads)
  - Module weight and clamp compatibility
- Check roof attachment pattern vs calculated load requirements
- Verify module clamp selection (frame thickness within clamp range)
- Check rail splice placement (not in span center)
- For snow country: verify snow guard qty and placement per Alpine guidelines

**Output:** Structural review checklist (pass/flag per item) as task notes.

#### 3. Code Compliance Package
**What it does:** Compiles all code requirements into a structured package for the PE reviewer.

- Pull all AHJ codes: NEC edition year, IBC, IFC, local amendments
- Pull AHJ structural requirements: wind speed, snow load, exposure category, seismic
- Pull stamping requirements: wet stamp, digital, state PE license required, which states
- Pull fire code requirements: setbacks, pathways, rapid shutdown
- Compile into structured document the PE can reference during stamp review

**Output:** Code compliance summary document as task notes.

#### 4. Permit Package Prep
**What it does:** Verifies all required documents exist and are ready for the permitting team.

- Check Google Drive (via find-design-plans) for required documents:
  - Stamped planset (PV-0 through PV-6)
  - PE stamp / engineering letter
  - Equipment spec sheets (modules, inverter, battery, racking)
  - Single-line diagram
  - Structural calculations (if required by AHJ)
  - Load calculations
- Check AHJ-specific permit requirements (some AHJs need additional documents)
- Flag missing or outdated documents
- Verify document versions match the final approved design

**Output:** Permit readiness checklist (complete/missing per document) as task notes.

### Data Sources
- HubSpot deal properties + AHJ + Utility custom objects
- planset-bom skill (SLD reading, electrical details)
- product-lookup skill (manufacturer electrical/structural specs)
- find-design-plans skill (locate documents in Google Drive)

---

## Integration Map

```
SALES PIPELINE                          PROJECT PIPELINE
┌─────────────────┐
│  sales-advisor   │
│                  │
│  Task handlers:  │
│  • Qualify lead  │
│  • Validate equip│
│  • Handoff check │
│  • Pricing review│
└────────┬────────┘
         │ Tasks complete → Closed Won → Project Pipeline
         │
         │              ┌──────────────────────┐
         └─────────────►│   design-reviewer     │
                        │                      │
                        │   Task handlers:     │
                        │   • Compliance check │◄── AHJ + Utility data
                        │   • Equipment match  │◄── planset-bom
                        │   • Layout review    │◄── product-lookup
                        │   • Revision mgmt   │◄── engineering-reviewer
                        │   • DA flow         │──► PandaDoc API
                        └──────────┬───────────┘
                                   │
                          ┌────────▼────────┐
                          │  Revision needed?│
                          └─┬─────────────┬─┘
                        yes │             │ no
                    ┌───────▼──────┐  ┌───▼──────────────────┐
                    │ Vendor revise │  │ engineering-reviewer  │
                    │ (skill writes │  │                      │
                    │  revision req)│  │ Task handlers:       │
                    └───────┬──────┘  │ • Electrical review  │◄── planset-bom
                            │         │ • Structural review  │◄── product-lookup
                            └──► back │ • Code compliance pkg│◄── AHJ data
                             to design│ • Permit package prep│◄── Google Drive
                              reviewer└──────────┬───────────┘
                                                 │
                                        Tasks complete
                                                 │
                                        ┌────────▼────────┐
                                        │  PE stamp (ext)  │
                                        │  → Permitting    │
                                        └─────────────────┘
```

## Shared Dependencies

```
All three skills
    ├── HubSpot Tasks API (fetch open tasks, complete tasks, add notes)
    ├── HubSpot Deals API (deal properties, equipment, dates, links)
    ├── HubSpot Custom Objects (AHJ, Utility)
    └── product-lookup skill (manufacturer reference data)

design-reviewer additionally
    ├── planset-bom skill (BOM extraction)
    ├── find-design-plans skill (locate planset PDFs)
    ├── engineering-reviewer skill (technical input for revisions)
    └── PandaDoc API (DA document creation)

engineering-reviewer additionally
    ├── planset-bom skill (SLD/electrical reading)
    └── find-design-plans skill (document verification)
```

## Implementation Priority

1. **design-reviewer** — highest value, directly addresses bottleneck
2. **engineering-reviewer** — natural extension, shares data sources with design-reviewer
3. **sales-advisor** — valuable but less urgent (sales contracts already automated)

## New Integration Required

- **PandaDoc API** — needed for design-reviewer DA document creation and sending. Requires: API key, template IDs, field mapping from HubSpot deal to PandaDoc template fields.
- **HubSpot Tasks API** — needed for all three skills. Read open tasks, complete tasks, add notes. This may already be accessible through the existing HubSpot client but needs task-specific methods.
- **SolarView / AI image generation** — needed for equipment photos in DA documents. Scope TBD.

## Open Questions

1. **HubSpot task names** — need the exact task names/types that workflows create for each stage so skills can match tasks to handlers
2. **PandaDoc template structure** — need the DA template ID and field mapping
3. **Equipment photo source** — SolarView integration details, or AI image generation approach
4. **Vendor communication channel** — how are revision requests sent to the vendor today? (email, portal, shared doc?)
5. **PE firm interface** — how does the code compliance package get to the PE? (email, portal?)
