# PE File Preparation Tool

Automated audit and assembly system for Participate Energy (PE) milestone submissions. A PM clicks "Run Audit" on a deal, the system scans Google Drive folders and PandaDoc, classifies every file with Claude vision, and reports what's ready, what's missing, and what needs review. When satisfied, the PM clicks "Assemble Package" to copy all matched files into a submission-ready GDrive folder.

## How It Works

### 1. Audit (the main flow)

**Trigger:** PM opens `/dashboards/pe-prep/[dealId]` and clicks "Run Audit".

**API:** `POST /api/pe-prep/[dealId]/audit` — streams SSE events back to the browser as each item is processed.

**Steps:**

1. **Resolve deal** — pulls HubSpot deal properties (address, system type, GDrive root folder ID, PE status). Determines milestone (M1 or M2) and system type (solar, battery, solar+battery).

2. **Build folder map** — scans the deal's GDrive root for numbered subfolders:
   - `0/` — Contracts, proposals, utility bills
   - `2/` — Design documents (plan sets)
   - `5/` — Installation photos
   - `6/` — Inspection cards/permits
   - `7/` — PTO, interconnection, warranty
   - `8/` — Incentives, admin docs

3. **Pull PandaDoc templates** — if `PANDADOC_PE_TEMPLATES_ENABLED=true`:
   - Discovers template IDs for 4 PE documents (Installer Attestation, Customer Acceptance, Progress Lien Waiver, Final Lien Waiver)
   - Searches PandaDoc for completed documents linked to this deal (by HubSpot deal ID metadata, falling back to customer last name in document title)
   - Downloads completed PDFs and uploads them to a "Participate Energy" subfolder in GDrive
   - Marks those checklist items as "found" so the vision classifier doesn't need to search for them

4. **Pre-upload photos** — downloads up to 20 install photos from GDrive folder 5, uploads them all to the Anthropic Files API in parallel. This happens once, up front, so the same photo isn't re-downloaded or re-uploaded when checked against multiple categories.

5. **Batch photo triage** — sends ALL pre-uploaded photos to Claude in a single multi-image API call. The prompt lists all PE photo categories (site address, PV array, module nameplate, electrical, MSP, invoice, inverter label, racking, battery wide, battery nameplate, storage controller) and asks Claude to assign each photo to its best-matching category. Returns a map of `checklistId -> matched photo + verdict`.

6. **Document classification** — for each non-photo checklist item, finds candidate files in the item's designated GDrive folder(s) and classifies them with Claude vision:
   - Downloads the file and uploads to Anthropic Files API
   - Sends it to Claude with a classification prompt listing all PE document types and detailed descriptions of each
   - Claude returns which checklist IDs the document matches, confidence level, signature status, date relevance, and any issues
   - Results are cached by Drive file ID — if the same file appears as a candidate for multiple checklist items, it's only classified once (e.g., a contract package PDF that matches Customer Agreement + Installation Order + Disclosures)

7. **Persist results** — saves the full audit to `PeAuditRun` in the database (categories, per-item results, summary stats, vision call count, duration).

### 2. Status (cached results)

**API:** `GET /api/pe-prep/[dealId]/status`

Returns the latest completed audit run from the database, plus:
- Links to HubSpot deal, PE portal, GDrive folder
- PandaDoc document statuses (created, sent, completed, missing) with clickable links to each document in PandaDoc

This is what the page loads on initial render and after each audit completes.

### 3. Assemble Package

**API:** `POST /api/pe-prep/[dealId]/assemble`

Takes a completed audit run ID and:
- Creates a new GDrive folder named "PE M1 Submission" (or M2) inside the deal's root folder
- Copies every "found" file into that folder with standardized filenames (numbered, categorized)
- Skips duplicate files (e.g., a combined contract package only gets copied once)
- Generates a `_MANIFEST.txt` listing every item, its status, and the destination filename
- Returns the folder URL so the PM can review and submit to PE

## Checklist

### M1 — Inspection Complete (up to 20 items for solar+battery)

**Contract & Proposal:**
- Countersigned Customer Agreement — initialed AND fully signed (folder 0)
- Countersigned Installation Order (folder 0, often combined with CA)
- Required Disclosures — signed/initialed (folder 0, often combined with CA)
- Signed Proposal — from approved tool: Aurora, Energy Toolbase, Solargraf, OpenSolar, Solo, Artemis (folder 0)
- Utility Bill — dated within last 3 months (folder 0)
- Loan Documents — lender must be on PE Approved Lender List (folder 0)
- Incentive Forms — if applicable (folders 0, 8)

**Design:**
- Final Plan Set (folder 2)

**Photos (PE numbered 1-11, system-type dependent per Policy 04):**
1. Site address + home
2. Wide-angle PV array (solar only)
3. Module nameplate label + country of origin (solar only)
4. Wide-angle all electrical (solar only)
5. Main service panel, cover off (solar only)
6. Invoice & BOM with domestic content AVL part numbers
7. Inverter/micro/optimizer model (solar only)
8. Racking packaging labels + installed part markings (solar only)
9. Storage wide angle (battery only)
10. EACH storage unit nameplate + country of origin (battery only)
11. Storage controller/disconnect with serial + wiring (battery only)

**Admin:**
- Commissioning Proof — site ID visible, RGM + cell kits, PE site access (folders 5, 8)
- HOA Approval — if applicable (all folders)

**Post-Install (from PandaDoc):**
- Installer Attestation / Exhibit A
- Customer Certificate of Acceptance / Exhibit B

**Inspection:**
- AHJ Signed Final Permit — inspector signature AND date (folder 6)

**Lien:**
- Conditional Progress Lien Waiver (from PandaDoc)

**Compliance:**
- FEOC Compliance — required for 2026+ PTO projects (folders 0, 8)

### M2 — Project Complete (5 items)

- PTO Letter (folder 7)
- Interconnection Agreement (folder 7)
- Warranty Assignment (folder 7)
- Incentive Documentation (folders 7, 8)
- Final Lien Waiver (from PandaDoc)

## Architecture

```
Browser (PE Prep page)
  │
  ├─ GET /api/pe-prep/[dealId]/status    → cached audit + links + PandaDoc statuses
  ├─ POST /api/pe-prep/[dealId]/audit    → SSE stream of audit progress events
  └─ POST /api/pe-prep/[dealId]/assemble → copies files into submission folder
        │
        ▼
pe-audit-orchestrator.ts (runPeAudit)
  ├─ pe-turnover.ts         — checklist definitions, folder mapping, assembly
  ├─ pe-vision-classifier.ts — Claude vision: classifyDocument, triagePhotoBatch
  ├─ pandadoc.ts            — PandaDoc API: template discovery, doc search, PDF download
  ├─ drive-plansets.ts      — Google Drive: list, download, upload, copy, create folder
  ├─ pe-reference-library.ts — approved reference examples for comparison
  └─ pe-avl.ts              — PE Approved Vendor List for equipment validation
```

### Key Files

| File | Purpose |
|------|---------|
| `src/app/dashboards/pe-prep/[dealId]/page.tsx` | Dashboard page — stat cards, checklist cards, photo grid, PandaDoc section |
| `src/app/api/pe-prep/[dealId]/audit/route.ts` | SSE streaming endpoint, 5-min Vercel timeout |
| `src/app/api/pe-prep/[dealId]/status/route.ts` | Cached audit results + deal links + PandaDoc statuses |
| `src/app/api/pe-prep/[dealId]/assemble/route.ts` | File assembly into GDrive submission folder |
| `src/lib/pe-audit-orchestrator.ts` | Main audit loop — folder scan, PandaDoc pull, vision classification |
| `src/lib/pe-vision-classifier.ts` | Claude vision prompts, classification, photo triage, result mapping |
| `src/lib/pe-turnover.ts` | Checklist definitions (M1/M2), system type filtering, package assembly |
| `src/lib/pandadoc.ts` | PandaDoc API client — template discovery, document search, PDF download |
| `src/components/pe-prep/` | UI components: PeAuditProgress, PeChecklistCard, PePhotoGrid, PePhotoModal, PePandaDocSection, PePrepButton |

### Database

```prisma
model PeAuditRun {
  id              String    @id @default(cuid())
  dealId          String
  dealName        String
  milestone       String    // "m1" or "m2"
  systemType      String    // "solar", "battery", "solar+battery"
  status          String    // "running", "completed", "failed"
  triggeredBy     String    // user email
  results         Json?     // full per-category/per-item results
  summary         Json?     // { totalItems, found, missing, needsReview, ... }
  packageFolderId  String?  // GDrive folder ID after assembly
  packageFolderUrl String?
  startedAt       DateTime
  completedAt     DateTime?
  durationMs      Int?
  visionCallCount Int       // how many Claude API calls were made
  pandadocPulled  Int       // how many PandaDocs were downloaded
}
```

## Performance Optimizations

The audit must complete within Vercel's 5-minute function timeout (`maxDuration = 300`). Key optimizations:

1. **Document classification cache** — `Map<driveFileId, VisionResult>`. Multiple checklist items often share the same candidate folder (e.g., CA, IO, Disclosures all look at folder 0). Each file is downloaded, uploaded to Anthropic, and classified once. Subsequent items reuse the cached result and just check if their ID is in `matchedChecklistIds`.

2. **Photo pre-upload** — all install photos are downloaded from GDrive and uploaded to the Anthropic Files API in a single parallel batch before any classification begins. Eliminates redundant download/upload work.

3. **Batch photo triage** — instead of calling `verifyPhoto()` individually for each photo item against each candidate (O(items x candidates) = 36+ API calls), all photos are sent to Claude in a single multi-image API call that classifies AND verifies every photo against every PE photo category simultaneously. This converts ~36 sequential vision calls (~15 min) into 1 call (~30-45s).

4. **Mutual exclusion post-processing** — if a document matches both contract package IDs (CA/IO/Disclosures) and "proposal", the proposal match is dropped. A contract package is definitionally not a standalone sales proposal.

5. **PandaDoc overrides** — items sourced from PandaDoc are resolved before vision classification starts, so the classifier doesn't waste API calls searching for documents that were already pulled.

## Deep PE Verification

Beyond simple classification, the audit performs PE-specific content verification aligned with PE's official policies (Policy 01 AVL, Policy 04 Quality & Photo Requirements, Policy 06 Turnover Deliverables, Policy 08 Approved Platforms, Policy 10 Approved Lender List).

### Cross-Referencing

PE validates that customer name, property address, system size, and equipment match ACROSS all documents. The classifier extracts this data from each document so the PM can cross-reference.

### Photo Verification (PE Policy 04)

Each photo category has specific PASS/FAIL criteria matching PE's Quality Standards & Photo Requirements:

| Photo | Key Verification | Common Rejection |
|-------|-----------------|------------------|
| 1. Site address | Street number legible, house fully visible | Address not readable |
| 2. PV array | ENTIRE array in frame from distance | Array cut off at edges |
| 3. Module nameplate | Brand + model + serial + wattage + **country of origin** + certifications legible | Label blurry/illegible, no country of origin |
| 4. All electrical | Inverter + disconnect + meter + conduit in one frame | Only one component shown |
| 5. MSP (breaker panel) | Dead-front cover REMOVED, breakers visible | **Cover still on (top rejection)** |
| 6. Invoice/BOM | Equipment line items with **domestic content AVL part numbers**, brand/model/qty readable | Spreadsheet screenshot, no vendor, parts don't match AVL |
| 7. Inverter nameplate | Brand + model + serial + ratings legible | Label blurry from distance |
| 8. Racking parts | **BOTH** packaging/box labels AND markings on installed parts | Only packaging OR only installed parts (need both) |
| 9. Battery wide | Full system visible with mounting context | Battery cut off in frame |
| 10. Battery nameplate | **EACH unit**: brand + model + serial + kWh + **country of origin** | Label obscured, wrong PW3 variant (11-M/11-J) |
| 11. Storage controller | Device identifiable, **serial number visible**, wiring in single shot | Wrong equipment, serial not readable |

Equipment found in nameplate photos (brand, model, serial) is extracted and displayed in the UI for cross-referencing against the proposal and plan set.

### Document Verification (PE Policy 06)

| Document | Verification Checks |
|----------|-------------------|
| Plan Set | Site plan + single-line diagram + structural + equipment schedule present; equipment brand/model extracted; PW3 part number checked for placeholder (XX) or wrong variant (11-M/11-J) |
| Proposal | Must use approved simulation tool (Aurora, Energy Toolbase, Solargraf, OpenSolar, Solo, Artemis); system size, equipment list, pricing, production estimates; load justification if >135% of annual usage |
| Utility Bill | **Date within 3 months** (not 12), usage history visible, customer name/address match contract |
| Loan Docs | Lender must be on PE Approved Lender List (Credit Human, Honolulu CU, Wheelhouse CU) |
| Commissioning | Monitoring platform online with **site ID visible**, **RGM + cell kits required**, PE has site owner access, address matches contract |
| AHJ Permit | Inspector signature **AND date**, final inspection, homeowner name/address match contract |
| Contracts | CA initialed AND fully signed by both parties, IO system size/components match other docs, customer name/address visible |
| Attestation/Acceptance | Signed, customer name/address match contract |
| Lien Waivers | Progress: amount = installation package fees; Final: amount = interconnection package fees |
| PTO Letter | From utility (not installer), authorizes operation, **both dates present** (in letter + issuance), name/address match contract |
| Interconnection | Signed by both utility and customer/installer, name/address match contract |
| FEOC Compliance | Equipment complies with FEOC rules for 2026+ PTO projects (PE Policy 01 §3); no Prohibited Foreign Entity components |

### Equipment Cross-Reference (PE Policy 01 AVL)

When the AVL (Approved Vendor List) is available, equipment identified in documents and photos is cross-checked against PE's approved list. Key AVL categories:
- **BESS**: Tesla PW3 (1707000-21-y), Enphase IQ Battery, SolarEdge HomeHub Battery, Qcells, Generac PWRcell
- **Modules**: REC Group (Alpha Pure RX), Hyundai (NF/HiN), Qcells (Q.PEAK/Q.TRON), Silfab (PRIME), Tesla (TSP-4xx)
- **Inverters**: SolarEdge HomeHub, Enphase IQ8/IQ9, Tesla (1538000-xx-y), Generac PWRmicro
- **Racking**: IronRidge, SnapNrack, Unirac, Pegasus, K2, Tesla, Silfab

FEOC Material Assistance Cost Ratio thresholds for 2026: Solar 40%, Battery 55%. Domestic Content threshold for 2026 construction: 50%.

## Feature Flags

| Flag | Purpose |
|------|---------|
| `PE_FILE_PREP_ENABLED` | Master kill switch — all 3 API routes return 404 if `!= "true"` |
| `PANDADOC_PE_TEMPLATES_ENABLED` | Enables PandaDoc template discovery + document search + PDF download |

## Access Control

Roles with access: **PROJECT_MANAGER**, **OPERATIONS_MANAGER**, **ACCOUNTING** (plus ADMIN and OWNER).

Routes: `/dashboards/pe-prep`, `/api/pe-prep` — both must be in the role's `allowedRoutes` in `src/lib/roles.ts`.

## PandaDoc Integration

Four PE-specific PandaDoc templates:

| Template | Checklist ID | GDrive Filename |
|----------|-------------|-----------------|
| PE Installer Attestation | `m1.post_install.attestation` | `PE_Installer_Attestation.pdf` |
| PE Customer Certificate of Acceptance | `m1.post_install.acceptance` | `PE_Customer_Acceptance.pdf` |
| Progress Lien Waiver | `m1.lien.conditional` | `PE_Progress_Lien_Waiver.pdf` |
| PE Conditional Waiver and Release on Final Payment | `m2.lien.final` | `PE_Final_Lien_Waiver.pdf` |

**Discovery:** Template IDs are resolved at runtime via `GET /templates?q={pattern}`. Can be overridden with env vars (`PANDADOC_PE_ATTESTATION_TEMPLATE_ID`, etc.).

**Search strategy:** First searches by `template_id` + `metadata_hubspot.deal_id`. If that returns nothing (common — docs created via HubSpot's native CRM card don't always set the metadata), falls back to searching by `template_id` + document name containing the customer's last name (extracted from the deal name pattern: `PROJ-9542 | Brownell, Matt | 16578 W 55th Dr, ...`).

**Download:** Only completed documents are downloaded. Sent/viewed/draft documents are reported with their current status so the PM knows what's pending.

## SSE Event Types

The audit endpoint streams these events:

| Type | When | Data |
|------|------|------|
| `started` | Audit begins | milestone, systemType, totalItems |
| `progress` | Each item classified | itemId, label, status, file?, issues? |
| `pandadoc` | Each PandaDoc processed | key, status, action |
| `diagnostic` | Infrastructure updates | message (folder count, pre-upload status, triage progress) |
| `completed` | Audit done | auditRunId, summary |
| `error` | Fatal error | message |
