# PE Turnover Readiness Skill — Design Spec

**Date:** 2026-03-31
**Status:** Draft
**Author:** Zach + Claude

## Overview

A skill and shared library to audit and assemble Participate Energy turnover packages for residential solar projects. Given a deal, the system verifies PE financing, detects system type, walks the project's Google Drive folder tree, matches files to PE's checklist requirements, optionally verifies photos via AI vision, and produces a gap report with assembly capability.

## Context

Participate Energy (PE) is a financing/monitoring partner. PE-financed projects require two milestone submission packages to release funding:

- **M1 — Inspection Complete:** Releases up to 2/3 of the Remaining Amount
- **M2 — Project Complete:** Releases the balance

Each milestone has specific document, photo, and form requirements defined in PE's Turnover & Milestone Package Deliverables Policy (v1.0, 12/3/2025) and Quality and Photo Requirements Policy (v1.0, 1/5/2026).

### Existing Infrastructure

- **PE deal identification:** HubSpot `tags` includes "Participate Energy", plus `is_participate_energy` and `participate_energy_status` properties
- **PE milestone tracking:** `pe_m1_status` and `pe_m2_status` deal properties with values: Ready to Submit, Waiting on Information, Submitted, Rejected, Ready to Resubmit, Resubmitted, Approved, Paid
- **PE deals dashboard:** `/dashboards/pe-deals` — shows all PE deals with milestone status, payment breakdown, and filtering
- **System type:** `project_type` deal property ("solar", "battery", "solar+battery")
- **Google Drive:** `all_document_parent_folder_id` deal property → standardized folder tree (0. Sales through 8. Incentives)
- **Drive integration:** `lib/drive-plansets.ts` — token management, folder navigation, PDF/image listing, download. Note: existing functions are specialized (PDFs only via `listDrivePdfs`, images only via `listDriveImages`). This skill will need new utility functions (see New Drive Utilities below).
- **Install photo review:** Existing skill uses Claude vision to verify install photos against planset. Uses `downloadDriveImage()` which handles HEIC→JPEG conversion automatically (important for iPhone photos).
- **Drive folder properties:** `design_documents`, `site_survey_documents`, `permit_documents`, `all_document_parent_folder_id`

### Required HubSpot Deal Properties

The `resolvePEDeal()` function must fetch these properties (via `getDealProperties()` from `lib/hubspot.ts`):

```typescript
const PE_TURNOVER_PROPERTIES = [
  // Identity
  "hs_object_id", "dealname", "dealstage", "pipeline",
  // PE identification
  "tags", "is_participate_energy", "participate_energy_status",
  // PE milestones
  "pe_m1_status", "pe_m2_status",
  // System type
  "project_type",
  // Address (codebase uses address_line_1/postal_code, not address/zip)
  "address_line_1", "city", "state", "postal_code",
  // Drive folders
  "all_document_parent_folder_id", "design_documents",
  "site_survey_documents", "permit_documents", "g_drive",
  // Contact/company for name resolution
  "pb_location",
];
```

## Phased Approach

### Phase A (Now): Skill + Shared Library
- Claude Code skill (`/pe-turnover`) for on-demand audit
- Shared `lib/pe-turnover.ts` module with all reusable logic
- Terminal output with gap report
- Optional photo verification via vision
- Optional file assembly into staging folder/zip

### Phase B (Soon): API Route + Dashboard Widget
- `POST /api/pe-turnover/[dealId]` — programmatic checklist evaluation returning JSON
- Dashboard widget on PE deals page or deal detail showing turnover readiness progress
- Clickable items with Drive links to found files

### Phase C (After B Stabilizes): Pipeline Automation
- Auto-trigger audit when deal reaches inspection-complete or PTO stages
- Email notification to TPO@photonbrothers.com with gap report
- Optional HubSpot property updates for `pe_m1_status` / `pe_m2_status` (TBD)

## Detailed Design

### Skill Interface

**Invocation:** `/pe-turnover <dealId or customer name>`

**Flags:**
- `--milestone m1|m2|both` — which milestone to audit (default: auto-detect from deal stage). `both` runs two independent audits sequentially and prints both reports. Phase B API returns an array of two `TurnoverAuditResult` objects.
- `--assemble` — collect found files into local staging folder/zip
- `--verify-photos` — enable AI vision analysis of photos against PE requirements
- `--verbose` — show file-level detail (size, modified date, Drive URL) for each item

### Deal Resolution Flow

1. Input is numeric → HubSpot deal ID lookup
2. Input is text → HubSpot deal search by name/address
3. Verify PE financing: `tags` includes "Participate Energy" or `is_participate_energy` is truthy
4. Read `project_type` deal property for system type (solar / battery / solar+battery)
5. Auto-detect milestone from deal stage if `--milestone` not specified (see Stage-to-Milestone Mapping below)
6. Fetch `all_document_parent_folder_id` for Drive root folder
7. Validate folder structure: list top-level subfolders and confirm numbered prefix pattern exists (see Folder Validation below)

### Stage-to-Milestone Mapping

When `--milestone` is not specified, the skill infers which milestone to audit from the deal's current stage:

| Deal Stage | Milestone |
|------------|-----------|
| Pre-construction stages (Survey, RTB, Design, Permitting, Interconnection) | M1 (proactive — shows what's needed before install) |
| Construction, Inspection | M1 |
| PTO Submitted, PTO Received | M2 |
| Project Complete, Cancelled | Warn: milestone already in terminal state, require `--force` |

If `pe_m1_status` is "Submitted", "Approved", or "Paid", the skill warns and skips M1 unless `--force` is passed. Same logic for `pe_m2_status` and M2.

### Checklist Data Model

```typescript
type SystemType = "solar" | "battery" | "solar+battery";

interface ChecklistItem {
  id: string;                    // e.g., "m1.contract.customer_agreement"
  label: string;                 // "Countersigned Customer Agreement"
  category: string;              // grouping key
  milestone: "m1" | "m2";
  appliesTo: SystemType[];       // which system types need this item
  driveFolders: string[];        // preferred folder(s) to search, e.g., ["0. Sales"]
  searchAllFolders: boolean;     // if true, search breadth-first across all subfolders
  fileHints: string[];           // case-insensitive filename patterns
  combinedWith?: string[];       // IDs of items commonly in the same file
  isPhoto: boolean;              // true for PE photo requirements
  pePhotoNumber?: number;        // PE's photo checklist number (1-11)
}

interface ChecklistResult {
  item: ChecklistItem;
  status: "found" | "likely" | "missing" | "needs_review" | "not_applicable" | "error";
  statusNote?: string;           // human-readable reason (e.g., "No loan on this deal", "Drive folder inaccessible: 403")
  foundFile?: {
    name: string;
    id: string;
    url: string;
    modifiedTime: string;
    size: number;
  };
  combinedFile?: boolean;        // true if this item shares a file with others
  visionResult?: {               // only when --verify-photos
    status: "pass" | "fail" | "needs_review";
    notes: string;
  };
}

// When --milestone both is used, the top-level return is an array of two results.
// Each milestone is a self-contained audit. The skill runs M1 first, then M2,
// and prints both reports sequentially. Phase B API returns the array as JSON.
type TurnoverAuditOutput = TurnoverAuditResult | [TurnoverAuditResult, TurnoverAuditResult];

interface TurnoverAuditResult {
  dealId: string;
  dealName: string;
  address: string;
  systemType: SystemType;
  milestone: "m1" | "m2";
  categories: {
    name: string;
    label: string;
    items: ChecklistResult[];
    found: number;
    total: number;
  }[];
  summary: {
    totalItems: number;
    found: number;
    missing: number;
    needsReview: number;
    notApplicable: number;
    errors: number;
    ready: boolean;           // true if all required items are found (N/A and error items excluded from denominator)
  };
}
```

### M1 — Inspection Complete Checklist

**Contract & Proposal** (search: 0. Sales)
| Item | Combined? | File Hints |
|------|-----------|------------|
| Countersigned Customer Agreement | Often combined ↓ | `customer agreement, CA_signed, contract_package` |
| Countersigned Installation Order | Often combined ↑ | `installation order, IO_signed, contract_package` |
| Required Disclosures | Often combined ↑ | `disclosure, contract_package` |
| Signed Proposal | — | `proposal, quote` |
| Utility Bill (12mo usage) | — | `utility bill, utility_bill, electric bill, xcel, usage` |
| Loan Documents (if applicable) | — | `loan, sunraise, financing` |
| Incentive Forms (if applicable) | — | `incentive, rebate, 3ce, xcel_rebate` |

**Design Package** (search: 2. Design / Stamped Plans)
| Item | File Hints |
|------|------------|
| Final Plan Set | Uses existing `pickBestPlanset()` logic from `drive-plansets.ts` |

**Photos** (search: 5. Installation)
| PE # | Requirement | System Types | File Hints / Vision Check |
|------|-------------|-------------|---------------------------|
| 1 | Site address + home in background | solar, solar+battery, battery | Hints: `address, exterior, front, street`. Relies primarily on vision classification — most install photos are generic `IMG_XXXX.jpg` |
| 2 | Wide-angle PV array (all modules) | solar, solar+battery | Hints: `array, modules, panels, roof`. Vision: confirms full array visible |
| 3 | Module nameplate label (mfg, model, serial, ratings, origin, cert) | solar, solar+battery | Hints: `nameplate, label, serial`. Vision: confirms all 6 required fields legible |
| 4 | Wide-angle all electrical equipment | solar, solar+battery | Hints: `electrical, equipment, indoor, outdoor`. Vision: indoor + outdoor equipment visible |
| 5 | Main service panel (cover off, breakers visible) | solar, solar+battery | Hints: `msp, panel, breaker, service_panel`. Vision: cover off, breakers visible |
| 6 | Invoice & BOM (project name/address, part numbers on AVL) | solar, solar+battery, battery | Hints: `invoice, bom, bill_of_materials`. May be a photo/scan in install folder OR a PDF from Zoho SO export (check both). Vision: project name/address and part numbers visible |
| 7 | Inverter/micro/optimizer model photo | solar, solar+battery | Hints: `inverter, microinverter, optimizer, enphase, solaredge`. Vision: legible model number |
| 8 | Racking parts + markings (packaging + individual parts) | solar, solar+battery | Hints: `racking, rail, ironridge, unirac, clamp`. Vision: (a) packaging/box labels AND (b) mill/extrusion marks on parts — PE requires both |
| 9 | Storage wide angle (bracket & enclosure) | solar+battery, battery | Hints: `battery, storage, powerwall, encharge`. Vision: bracket and enclosure visible |
| 10 | Storage nameplate & compliance labels | solar+battery, battery | Hints: `battery_label, storage_nameplate, battery_serial`. Vision: manufacturer, model, serial, specs, country of origin all legible |
| 11 | Storage controller/disconnect (serial + wiring) | solar+battery, battery | Hints: `controller, gateway, disconnect, battery_disconnect`. Vision: serial number visible + wiring in single shot |

> **Note on Photo 6:** This item blurs the line between photo and document. The matching logic checks both: (a) image files in the install photos folder (photo/scan of invoice), and (b) PDF files in install or sales folders (Zoho SO export, BOM PDF). If not found in Drive, the skill suggests exporting from the BOM pipeline.

**Admin** (search: 5. Installation, 8. Incentives)
| Item | File Hints |
|------|------------|
| Commissioning Proof (monitoring access screenshot) | `commissioning, monitoring, site_id, enphase, solaredge, tesla_app` |
| HOA Approval (if applicable) | `hoa, homeowner association` |

**Post-Install** (search: all folders — PandaDoc destination TBD)
| Item | File Hints |
|------|------------|
| Installer Attestation (Exhibit A) | `attestation, exhibit_a, installer_attestation` |
| Customer Acceptance Certificate (Exhibit B) | `acceptance, exhibit_b, customer_acceptance, certificate_of_acceptance` |

**Inspection** (search: 6. Inspections)
| Item | File Hints |
|------|------------|
| AHJ Signed Final Permit / Inspection Card | `inspection, permit, inspection_card, final_inspection, passed` |

**Lien** (search: all folders — PandaDoc destination TBD)
| Item | File Hints |
|------|------------|
| Conditional Progress Lien Waiver | `conditional_waiver, progress_waiver, conditional_lien`. Note: bare "lien waiver" without qualifier → `needs_review` (could be M1 conditional or M2 final) |

### M2 — Project Complete Checklist

**PTO** (search: 7. PTO & Closeout)
| Item | File Hints |
|------|------------|
| PTO Letter | `pto, permission to operate, pto_letter` |
| Interconnection Agreement | `interconnection, IA_signed, net metering, interconnection_agreement` |

**Warranty & Incentives** (search: 7. PTO & Closeout, 8. Incentives)
| Item | File Hints |
|------|------------|
| Warranty Assignment | `warranty, warranty_assignment` |
| Incentive Documentation | `incentive, rebate, approval_letter` |

**Lien** (search: all folders)
| Item | File Hints |
|------|------------|
| Final Lien Waiver | `final_waiver, unconditional_waiver, final_lien`. Note: bare "lien waiver" without qualifier → `needs_review` |

### Combined File Handling

Customer Agreement, Installation Order, and Disclosures are frequently combined into a single PDF (e.g., `PE_Contract_Package_Smith.pdf`). The matching logic:

1. Try to match each item individually first
2. If any item in a `combinedWith` group matches a file, mark all items in the group as `found` with `combinedFile: true`
3. Display combined items with a visual grouping indicator in the report

### Folder Validation

Before auditing, the skill validates the root folder structure:

1. List immediate children of `all_document_parent_folder_id`
2. Check for numbered prefix subfolders (`0.`, `1.`, `2.`, etc.)
3. If fewer than 3 numbered subfolders found → warn: "Non-standard Drive folder structure. Results may be incomplete. Found: [list subfolders]"
4. If the root folder itself appears to be a subfolder (e.g., named "2. Design") → warn and attempt to navigate up one level
5. Continue with best-effort audit regardless — never abort

### New Drive Utility Functions

`lib/drive-plansets.ts` needs these additions for pe-turnover:

```typescript
// List subfolders of a given folder (not in existing API)
listDriveSubfolders(folderId: string): Promise<DriveFolder[]>

// List ALL files in a folder (not just PDFs or images)
listDriveFiles(folderId: string): Promise<DriveFile[]>

// Download any file type (existing functions are PDF-only or image-only)
downloadDriveFile(fileId: string): Promise<Buffer>
```

These are thin wrappers around the Google Drive API using existing token management from `getDriveToken()`. The image download path should still use `downloadDriveImage()` for HEIC→JPEG conversion support (common with iPhone photos from crews).

### Drive File Discovery

1. Extract `all_document_parent_folder_id` from deal
2. Validate folder structure (see Folder Validation above)
3. List top-level subfolders via `listDriveSubfolders()`, match by prefix number (`0.`, `1.`, `2.`, etc.)
4. For items with `searchAllFolders: false`, search preferred `driveFolders` first (+ 1 level of subfolders)
5. For items with `searchAllFolders: true`, breadth-first search across all subfolders (max 2 levels)
6. For planset, delegate to existing `listPlansetPdfs()` → `pickBestPlanset()` chain in `drive-plansets.ts` (handles Stamped Plans subfolder navigation automatically)
7. For photos, list all images in `5. Installation` folder recursively (max 3 levels via `listDriveImagesRecursive`)
8. For non-photo documents, use `listDriveFiles()` to find PDFs, DOCX, PNG, etc.

**File matching:** Case-insensitive substring match of `fileHints` against filename. Multiple matches → pick most recently modified.

**Lien waiver disambiguation:** If a file matches generic "lien waiver" without a qualifier (conditional/progress/final/unconditional), mark as `needs_review` rather than auto-assigning to M1 or M2.

**Error handling:** If a Drive API call fails (403 permission denied, 404 folder deleted), log the error, mark affected items as `needs_review` with note "Drive folder inaccessible", and continue with remaining folders. Never abort the entire audit for a single folder failure.

**Performance guardrails:**
- Cache folder listings per deal during a single run
- Cap image downloads for vision at 50 photos (raised from 30 — PV+Storage installs can have many photos, and vision needs to classify unlabeled images against all 11 PE requirements). Pre-filter by `fileHints` before downloading when possible.
- Skip files > 50MB

### Photo Verification (--verify-photos)

When enabled, downloads photos from Drive and sends to Claude vision with a structured prompt per PE photo requirement. Each photo gets:

- **`pass`** — meets PE requirement, required information visible and legible
- **`fail`** — photo exists but doesn't meet criteria (e.g., nameplate not legible, MSP cover still on)
- **`needs_review`** — ambiguous, flagged for human review

Vision prompt includes PE's specific requirements for each numbered photo (e.g., "Photo 3 must clearly show manufacturer name, model number, serial number, electrical ratings, country of origin, and certification").

For unlabeled photos (`IMG_XXXX.jpg`), vision first classifies what the photo shows, then matches it to the most appropriate PE photo number.

### Output Format

**Terminal (Phase A):**
```
PE Turnover Readiness — Smith, 123 Main St, Denver
Deal: 12345678 | Type: PV+Storage | Milestone: M1 (Inspection Complete)
PE M1 Status: Ready to Submit

CONTRACT & PROPOSAL (5/6)
  ✓ Customer Agreement  ┐
  ✓ Installation Order  ├→ PE_Contract_Smith.pdf (combined)
  ✓ Disclosures         ┘
  ✓ Signed Proposal             → Smith_Proposal_v3.pdf
  ✗ Utility Bill                → MISSING
  — Loan Documents              → N/A (no loan on this deal)

DESIGN PACKAGE (1/1)
  ✓ Final Plan Set              → PROJ-1234_Stamped_Plans.pdf

PHOTOS (8/11 required for PV+Storage)
  ✓ 1. Site address + home      → IMG_4501.jpg
  ✓ 2. Wide-angle PV array      → IMG_4510.jpg
  ✗ 3. Module nameplate         → MISSING
  ✓ 4. All electrical equip     → IMG_4515.jpg
  ✓ 5. Main service panel       → IMG_4518.jpg
  ✓ 6. Invoice & BOM            → BOM_Smith.pdf
  ✓ 7. Inverter model           → IMG_4520.jpg
  ✗ 8. Racking parts            → MISSING
  ✓ 9. Storage wide angle       → IMG_4525.jpg
  ✓ 10. Storage nameplate       → IMG_4527.jpg
  ? 11. Storage controller      → IMG_4530.jpg (needs_review)

ADMIN (1/1)
  ✓ Commissioning Proof         → Enphase_Site_ID.png

POST-INSTALL (0/2)
  ✗ Installer Attestation       → MISSING (search all folders)
  ✗ Customer Acceptance Cert    → MISSING (search all folders)

INSPECTION (1/1)
  ✓ AHJ Final Permit            → Inspection_Card_Signed.pdf

LIEN (0/1)
  ✗ Conditional Progress Waiver → MISSING (search all folders)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
READY: 16/25 items | MISSING: 5 | NEEDS REVIEW: 1 | N/A: 3
```

**With `--milestone both`:** Prints both reports sequentially with a separator.

**JSON (Phase B API):** Returns `TurnoverAuditResult` for a single milestone, or `[TurnoverAuditResult, TurnoverAuditResult]` for `both`.

### Assembly (--assemble)

Creates a local staging folder with PE naming convention:

```
pe-turnover/
  123-Main-St_Denver/
    M1/
      contract/
        01_customer_agreement.pdf       (or combined contract package)
      proposal/
        02_proposal.pdf
        03_utility_bill.pdf
      design/
        04_final_planset.pdf
      photos/
        photo_01_site_address.jpg
        photo_02_pv_array_wide.jpg
        photo_03_module_nameplate.jpg
        ...
      admin/
        commissioning_proof.png
      post_install/
        installer_attestation.pdf
        customer_acceptance.pdf
      inspection/
        ahj_final_permit.pdf
      lien/
        conditional_progress_waiver.pdf
    M2/                                  ← only present with --milestone both
      pto/
        pto_letter.pdf
        interconnection_agreement.pdf
      warranty/
        warranty_assignment.pdf
      incentives/
        incentive_documentation.pdf
      lien/
        final_lien_waiver.pdf
    missing.txt                          ← combined punch list for all milestones
```

With `--assemble`, also optionally creates a zip named per PE convention: `123_Main-St_Denver.zip`.

### Architecture: Shared Module

`lib/pe-turnover.ts` contains all logic. The skill is a thin wrapper.

```
lib/pe-turnover.ts
  ├── PE_M1_CHECKLIST          — static checklist definition
  ├── PE_M2_CHECKLIST          — static checklist definition
  ├── PE_PHOTO_REQUIREMENTS    — photo mapping with vision prompts
  ├── resolvePEDeal()          — deal lookup + validation + system type
  ├── auditDriveFiles()        — folder walk + file matching
  ├── auditPhotos()            — photo discovery + optional vision
  ├── matchFile()              — filename heuristic matching
  ├── assemblePackage()        — download + rename + zip
  ├── generateTextReport()     — formatted terminal output
  └── generateJsonReport()     — structured JSON for API (Phase B)
```

Phase B adds `/api/pe-turnover/[dealId]/route.ts` calling the same functions.
Phase C adds a trigger in the pipeline/webhook layer and an email template.

### Integration Points

- **PE Deals Dashboard** (`/dashboards/pe-deals`): Phase B adds a "Turnover Readiness" column or expandable row with audit results
- **Email** (Phase C): Notification to TPO@photonbrothers.com using React Email template via existing dual-provider email system
- **HubSpot** (Phase C, TBD): Optional update of `pe_m1_status` / `pe_m2_status` based on audit results

### File Hint Iteration

The `fileHints` arrays are starting estimates. After running against real projects, we'll iterate:
1. Run skill against 5-10 PE deals
2. Note which items are `missing` but actually exist with unexpected filenames
3. Add new patterns to `fileHints`
4. Repeat until hit rate is high

Similarly, the photo-to-PE-number mapping via vision will improve with real data.

## Out of Scope

- PandaDoc integration (Installer Attestation, Customer Acceptance, Lien Waivers are being automated separately)
- Uploading to PE's portal (manual step for now)
- FEOC compliance checking (Foreign Entity of Concern certification — PE M1 item 13, requires supply chain verification beyond file matching)
- Incentive form validation (varies by project/state)
- Loan document validation (varies by lender)

### Assembly File Naming

When `--assemble` is used, files are renamed to a consistent scheme:

| Category | Naming Pattern | Example |
|----------|---------------|---------|
| Contract & Proposal | `{nn}_{item_slug}.{ext}` | `01_customer_agreement.pdf` |
| Design | `04_final_planset.pdf` | |
| Photos | `photo_{pe_number:02d}_{pe_label_slug}.{ext}` | `photo_01_site_address.jpg` |
| Admin | `{item_slug}.{ext}` | `commissioning_proof.png` |
| Post-Install | `{item_slug}.{ext}` | `installer_attestation.pdf` |
| Inspection | `ahj_final_permit.{ext}` | |
| Lien | `{item_slug}.{ext}` | `conditional_progress_waiver.pdf` |

The zip file is named per PE's submission guideline: `{street_number}_{street_name}_{city}.zip` (e.g., `123_Main-St_Denver.zip`).

## Open Questions

1. Are there PE deals with non-standard Drive folder structures we should handle? (Folder validation will warn but continue best-effort)
2. For Photo 6 (Invoice & BOM), should we pull from Zoho SO export if not found in Drive?
3. HOA applicability — is there a deal property that indicates HOA, or should this always be flagged as "verify if applicable"?
