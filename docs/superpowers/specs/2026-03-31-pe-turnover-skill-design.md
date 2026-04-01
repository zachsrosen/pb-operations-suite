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
- **Drive integration:** `lib/drive-plansets.ts` — token management, folder navigation, PDF/image listing, download
- **Install photo review:** Existing skill uses Claude vision to verify install photos against planset
- **Drive folder properties:** `design_documents`, `site_survey_documents`, `permit_documents`, `all_document_parent_folder_id`

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
- `--milestone m1|m2|both` — which milestone to audit (default: auto-detect from deal stage)
- `--assemble` — collect found files into local staging folder/zip
- `--verify-photos` — enable AI vision analysis of photos against PE requirements
- `--verbose` — show file-level detail (size, modified date, Drive URL) for each item

### Deal Resolution Flow

1. Input is numeric → HubSpot deal ID lookup
2. Input is text → HubSpot deal search by name/address
3. Verify PE financing: `tags` includes "Participate Energy" or `is_participate_energy` is truthy
4. Read `project_type` deal property for system type (solar / battery / solar+battery)
5. Auto-detect milestone from deal stage if `--milestone` not specified
6. Fetch `all_document_parent_folder_id` for Drive root folder

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
  status: "found" | "likely" | "missing" | "needs_review";
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
    ready: boolean;           // true if all required items found
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
| 1 | Site address + home in background | All | Exterior photo with visible address |
| 2 | Wide-angle PV array (all modules) | Solar, PV+Storage | Wide shot showing full array |
| 3 | Module nameplate label (mfg, model, serial, ratings, origin, cert) | Solar, PV+Storage | Close-up, legible nameplate |
| 4 | Wide-angle all electrical equipment | Solar, PV+Storage | Indoor + outdoor electrical |
| 5 | Main service panel (cover off, breakers visible) | Solar, PV+Storage | MSP interior shot |
| 6 | Invoice & BOM (project name/address, part numbers on AVL) | All | Invoice/BOM document |
| 7 | Inverter/micro/optimizer model photo | Solar, PV+Storage | Legible inverter model |
| 8 | Racking parts + markings (packaging + individual parts) | Solar, PV+Storage | Racking labels/markings |
| 9 | Storage wide angle (bracket & enclosure) | PV+Storage, Battery | Battery system overview |
| 10 | Storage nameplate & compliance labels | PV+Storage, Battery | Battery nameplate close-up |
| 11 | Storage controller/disconnect (serial + wiring) | PV+Storage, Battery | Controller with serial visible |

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
| Conditional Progress Lien Waiver | `lien waiver, conditional_waiver, progress_waiver, lien` |

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
| Final Lien Waiver | `final_waiver, lien_waiver, unconditional_waiver, final_lien` |

### Combined File Handling

Customer Agreement, Installation Order, and Disclosures are frequently combined into a single PDF (e.g., `PE_Contract_Package_Smith.pdf`). The matching logic:

1. Try to match each item individually first
2. If any item in a `combinedWith` group matches a file, mark all items in the group as `found` with `combinedFile: true`
3. Display combined items with a visual grouping indicator in the report

### Drive File Discovery

1. Extract `all_document_parent_folder_id` from deal
2. List top-level subfolders, match by prefix number (`0.`, `1.`, `2.`, etc.)
3. For items with `searchAllFolders: false`, search preferred `driveFolders` first (+ 1 level of subfolders)
4. For items with `searchAllFolders: true`, breadth-first search across all subfolders (max 2 levels)
5. For planset, delegate to existing `pickBestPlanset()` in `drive-plansets.ts`
6. For photos, list all images in `5. Installation` folder recursively (max 3 levels via `listDriveImagesRecursive`)

**File matching:** Case-insensitive substring match of `fileHints` against filename. Multiple matches → pick most recently modified.

**Performance guardrails:**
- Cache folder listings per deal during a single run
- Cap image downloads for vision at 30 photos
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
  — Loan Documents              → N/A (no loan)

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
READY: 16/23 items | MISSING: 5 | NEEDS REVIEW: 1 | N/A: 1
```

**JSON (Phase B API):** Returns `TurnoverAuditResult` as defined above.

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
        01_site_address.jpg
        02_pv_array_wide.jpg
        03_module_nameplate.jpg
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
    missing.txt
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
- FEOC compliance checking (item 13 in PE's M1 checklist — complex regulatory check)
- Incentive form validation (varies by project/state)
- Loan document validation (varies by lender)

## Open Questions

1. Are there PE deals with non-standard Drive folder structures we should handle?
2. Should the skill flag when `pe_m1_status` or `pe_m2_status` is already "Submitted" or "Approved" (i.e., don't re-audit)?
3. For Photo 6 (Invoice & BOM), should we pull from Zoho SO export if not found in Drive?
4. HOA applicability — is there a deal property that indicates HOA, or should this always be flagged as "verify if applicable"?
