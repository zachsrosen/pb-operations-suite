# PB Operations Suite — Skills Reference

Overview of all Claude Code skills, what they do, and how they connect.

---

## BOM Pipeline Skills

These five skills form an end-to-end pipeline for extracting equipment from plansets, generating Sales Orders, and validating them against ops data.

```
find-design-plans → planset-bom → bom-to-so → bom-so-analysis
                                       ↑               ↑
                                  product-lookup   product-lookup
```

### find-design-plans

> Locate the stamped planset PDF for a given project.

**Trigger:** "find the planset for PROJ-XXXX", "where are the design docs?"

**What it does:**
1. Looks up the HubSpot deal (`design_documents` or `all_document_parent_folder_id`)
2. Navigates the Google Drive folder structure to the Design folder
3. Lists PDFs via `/api/bom/drive-files` (breadth-first, depth 4)
4. Returns the file ID of the stamped planset

**Key detail:** Uses the app's Drive endpoint, NOT the Google Drive MCP (which only supports Google Docs). Requires a logged-in user session for auth.

---

### planset-bom

> Extract a complete Bill of Materials from a stamped planset PDF.

**Trigger:** "read a planset", "generate a BOM", "extract equipment from plans"

**What it does:**
1. Reads the planset PDF sheet by sheet (PV-0 through PV-6)
2. Extracts project metadata (system size, module count, roof type, arrays)
3. Pulls the BOM table from PV-2 (primary equipment source)
4. Scans electrical diagrams on PV-4 for items not in the BOM table (IMO RSU, AC disconnect, wire)
5. Outputs structured data in CSV, Markdown, and JSON formats

**Key details:**
- IMO RSU switch is on PV-4 SLD, NOT in PV-2 BOM table — must scan diagram explicitly
- AC disconnect: 3-wire = TGN3322R (GE), 2-wire = DG222URB (Eaton)
- `model` field = part number, `description` = marketing name
- Roof type from PV-0 DESIGN CRITERIA determines racking selection
- Invokes **product-lookup** when qty rules depend on manufacturer specs

---

### bom-to-so

> Convert a saved BOM snapshot into a Zoho Sales Order and compare against ops.

**Trigger:** "create an SO", "compare auto vs ops SO", "post-processor rules"

**What it does:**
1. Resolves the Zoho customer (auto-match by HubSpot contact ID, fallback to name search)
2. Creates a draft SO in Zoho via `POST /api/bom/create-so`
3. Runs the SO post-processor (SKU swaps, item removal, qty adjustments, missing item additions)
4. Fetches the ops-created SO from Zoho for comparison
5. Compares equipment line items (normalize, match by SKU/name, classify differences)

**Key details:**
- Two post-processors in the pipeline: BOM post-processor (at save, cosmetic) and SO post-processor (at create, mutates line items)
- Idempotent — if snapshot already has a `zohoSoId`, returns the existing SO
- Debug mode via `X-BOM-Debug: true` header shows full corrections and job context
- Invokes **product-lookup** for SKU variant selection

---

### product-lookup

> Look up solar equipment specs, installation quantities, sizing rules, and compatibility.

**Trigger:** "how many snow dogs per array?", "XR10 vs XR100?", "clamp range for this module?"

**What it does:**
1. Checks curated manufacturer reference files (9 manufacturers covered)
2. Answers from reference data with source citations
3. Falls back to web search if product isn't documented
4. Flags gaps for future reference file additions

**Reference files cover:**

| Manufacturer | Products |
|-------------|----------|
| IronRidge | XR10/XR100 rails, HUG attachment, UFO/CAMO clamps, splices, ground lugs |
| Tesla | Powerwall 3, Gateway-3, MCI-2, expansion kit, backup switch, wall mount |
| Alpine Snow Guards | Snow Dog (BLK/CLR), qty rules, pitch limits |
| IMO | SI16-PEL64R-2 rapid shutdown switch |
| SEG Solar | SEG-440-BTD-BG module, frame dims, clamp range |
| Hyundai Solar | HiN-T440NF(BK) module, frame dims, clamp range |
| EZ Solar | JB-1.2 junction box |
| S-5! | ProteaBracket, standing seam clamps |
| Enphase | IQ8 series, trunk cable, Q relay |
| NEC Tables | Ampacity (310.16), conductor sizing (690.8), rapid shutdown (690.12), 120% rule (705.12), grounding (250) |

**Used by:** planset-bom (qty rules during extraction), bom-to-so (SKU selection), bom-so-analysis (validating ops quantities), design-reviewer (compliance checks), engineering-reviewer (electrical/structural validation)

---

### bom-so-analysis

> Batch-compare auto-generated SOs against ops-created SOs to validate and improve post-processor rules.

**Trigger:** "run the SO analysis", "compare auto vs ops SOs", "improve post-processor"

**What it does:**
1. Selects jobs (by PROJ number, warehouse, or "all with ops SOs")
2. For each job: fresh BOM extraction → auto SO creation → ops SO fetch → comparison
3. Classifies all jobs (job type, warehouse, equipment, racking)
4. Runs pattern analysis (item frequency, qty formulas, breaker patterns, missing items)
5. Proposes post-processor rule improvements with evidence
6. Writes findings to `/Users/zach/Downloads/SOs/`

**Key details:**
- ALWAYS runs fresh BOM extraction — never reuses old snapshots
- Invokes **find-design-plans**, **planset-bom**, **bom-to-so**, and **product-lookup** during the pipeline
- Target: ~125 SOs across all warehouses
- Outputs per-job comparison files + session-level dataset and analysis

---

## Role-Based Skills

Three skills that automate end-to-end solar project workflows — from sales qualification through design review through engineering prep. Each maps to a role and operates as a **task execution engine** within PB's HubSpot automation.

```
HubSpot workflow creates tasks
    → Skill picks up open tasks for a deal
    → Skill does the work (compliance checks, equipment validation, etc.)
    → Skill completes HubSpot tasks (with notes/findings)
    → HubSpot workflow detects completion → status updates → pipeline moves
```

**Skills never update status fields or pipeline stages directly.**

### design-reviewer

> Automate the internal designer's review of vendor plansets, manage revisions, and generate design approval documents.

**Trigger:** "review this design", "check planset for PROJ-XXXX", "generate DA", "send revision request"

**What it does:**
1. Compliance check — AHJ codes (fire offsets, wind/snow, NEC), utility requirements (AC disconnect, production meter)
2. Equipment match — sold (HubSpot) vs designed (planset BOM)
3. Layout review assist — flag concerns for human review (north-facing, extreme pitch, setbacks)
4. Revision management — structured revision requests for vendor, delta reports on re-review
5. Design approval flow — PandaDoc DA creation and sending (Phase 1b)

**Task patterns:** `Complete Initial Design Review`, `Complete Final Design Review For Stamping`, `Send Plans For DA Revisions #N`, `Retrieve DA Revisions #N`, `Upload Approved DA Document`

**Uses:** planset-bom, find-design-plans, product-lookup, engineering-reviewer, Tasks API, AHJ/Utility custom objects

---

### engineering-reviewer

> Pre-PE-stamp electrical/structural validation, code compliance packages, and permit package prep.

**Trigger:** "engineering review for PROJ-XXXX", "check the SLD", "prep for PE stamp", "prep permit package"

**What it does:**
1. Electrical validation — wire sizing (NEC 310.16/690.8), OCPD, 120% rule, rapid shutdown, string sizing, grounding
2. Structural validation — wind/snow loads vs racking, module mounting, roof attachment
3. Code compliance package — structured summary for PE reviewer
4. Permit package prep — verify all required documents exist in Drive

**Task patterns:** `Retrieve Plans for Stamping`, `Upload Stamped Plans & PE Letter`, `Submit Permit To AHJ`, `Submit Interconnection Application To The Utility`

**Uses:** planset-bom, find-design-plans, product-lookup (incl. NEC tables), Tasks API, AHJ/Utility custom objects

---

### sales-advisor

> Assist salespeople from lead qualification through handoff to ops.

**Trigger:** "qualify this deal", "validate this system", "prep for handoff", "what's missing for ops"

**What it does:**
1. Qualify lead — AHJ/utility check, red flag scan (HOA, complex roof, extreme requirements)
2. Validate sold system — equipment compatibility checks via product-lookup
3. Handoff checklist — verify all required fields, Drive folder, OpenSolar link, Zoho customer, contract
4. Pricing review (stretch) — $/W sanity check

**Task patterns:** `Complete Contract and Deal Review`, `Confirm if launched into Hatch`, `Missing AHJ`

**Uses:** product-lookup, Tasks API, AHJ/Utility custom objects, Zoho customer API

**Note:** PandaDoc contracts already automated for sales. OpenSolar handles proposals. This skill validates, not creates.

---

## Operations Skills

### zuper-debug

> Debug Zuper field service integration issues.

**Trigger:** "Zuper API problem", "job sync issue", "scheduling mismatch", "status comparison"

**What it does:**
1. Identifies the scope (which API route, which Zuper entity)
2. Checks the route handler code for known gotchas
3. Queries live data via Zuper MCP tools or app API
4. Compares expected vs actual state

**Key Zuper gotchas documented:**
- `assigned_to` can only be set at job CREATION, not updates
- Custom fields: GET returns array, POST expects object
- Status lives in `current_job_status`, not `status`
- Job categories have separate status workflows

---

### new-dashboard

> Scaffold a new dashboard page with DashboardShell, data fetching, and metric cards.

**Trigger:** "create a new dashboard", "add a dashboard page"

**What it does:**
1. Parses dashboard name into slug and component name
2. Creates page file from template with DashboardShell wrapper
3. Sets up data fetching (HubSpot, Zuper, or custom API)
4. Wires up metric cards (StatCard, MiniStat, MetricCard, SummaryCard)
5. Adds navigation entry

---

## DevOps Skills

### deploy

> Run preflight checks, build, and deploy to Vercel.

**Trigger:** "deploy", "push to production", "ship it"

**What it does:**
1. Checks for uncommitted changes
2. Runs preflight checks (`npm run preflight`)
3. Builds the project (`npm run build`)
4. Deploys to Vercel
5. Verifies the deployment

---

### release-notes

> Generate release notes from git commits.

**Trigger:** "write release notes", "what changed since last release?"

**What it does:**
1. Reads git log for the specified commit range
2. Groups commits by type (Features, Bug Fixes, Improvements, Infrastructure)
3. Generates formatted release notes

---

## Skill Dependency Map

```
User Request
    │
    ├─ "Review design for PROJ-9491"
    │   └─ design-reviewer
    │       ├─ find-design-plans (locate planset)
    │       ├─ planset-bom (extract BOM)
    │       ├─ product-lookup (compatibility, load tables)
    │       ├─ engineering-reviewer (technical input for revisions)
    │       └─ Tasks API + AHJ/Utility custom objects
    │
    ├─ "Engineering review for PROJ-9081"
    │   └─ engineering-reviewer
    │       ├─ planset-bom (SLD reading)
    │       ├─ product-lookup (NEC tables, structural specs)
    │       ├─ find-design-plans (document verification)
    │       └─ Tasks API + AHJ/Utility custom objects
    │
    ├─ "Qualify this deal" / "Prep for handoff"
    │   └─ sales-advisor
    │       ├─ product-lookup (equipment validation)
    │       ├─ Zoho customer API (handoff check)
    │       └─ Tasks API + AHJ/Utility custom objects
    │
    ├─ "Read planset for PROJ-8596"
    │   └─ find-design-plans → planset-bom → (product-lookup)
    │
    ├─ "Create SO from this BOM"
    │   └─ bom-to-so → (product-lookup)
    │
    ├─ "Run batch SO analysis"
    │   └─ bom-so-analysis
    │       ├─ find-design-plans (per job)
    │       ├─ planset-bom (per job)
    │       ├─ bom-to-so (per job)
    │       └─ product-lookup (during pattern analysis)
    │
    ├─ "How many HUGs for 27 modules?"
    │   └─ product-lookup
    │
    ├─ "Zuper jobs not syncing"
    │   └─ zuper-debug
    │
    ├─ "Create a scheduling dashboard"
    │   └─ new-dashboard
    │
    ├─ "Deploy to production"
    │   └─ deploy
    │
    └─ "What shipped this week?"
        └─ release-notes
```
