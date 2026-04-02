---
name: pe-turnover
description: Audit Participate Energy turnover package readiness for a HubSpot deal. Use when the user asks to "check PE turnover", "PE readiness", "turnover audit for PROJ-XXXX", "M1/M2 readiness", "what's missing for PE submission", "PE package check", "Participate Energy audit", "turnover status", or wants to verify that a deal's Google Drive folder has all documents and photos required for PE milestone submission.
---

# PE Turnover Readiness Audit

Audits a Participate Energy (PE) deal's Google Drive folder tree against PE's milestone checklists — contract documents, design package, numbered installation photos, admin paperwork, post-install documents, inspection records, and lien waivers.

## Quick Start

The library at `src/lib/pe-turnover.ts` does all the heavy lifting. This skill is a thin orchestration layer.

```typescript
import { runTurnoverAudit, generateTextReport, assemblePackage } from "@/lib/pe-turnover";

// Audit only (auto-detected milestone)
const result = await runTurnoverAudit(dealId);
console.log(generateTextReport(result));

// Audit + assemble into staging folder
const audit = await runTurnoverAudit(dealId, { milestone: "m1" });
if (!Array.isArray(audit)) {
  const assembly = await assemblePackage(audit, rootFolderId);
  console.log(`Package: ${assembly.folderUrl} (${assembly.copied} files)`);
}
```

## Workflow

### 1. Identify the Deal

Get the deal from the user — they'll provide a PROJ number, customer name, or HubSpot deal ID.

Look up the deal in HubSpot:

```
mcp__98214750__search_crm_objects
  objectType: deals
  query: "PROJ-1234" (or customer name)
  properties: [
    "dealname", "dealstage", "pipeline", "tags",
    "is_participate_energy", "participate_energy_status",
    "pe_m1_status", "pe_m2_status", "project_type",
    "address_line_1", "city", "state", "postal_code",
    "all_document_parent_folder_id", "design_documents",
    "site_survey_documents", "permit_documents", "g_drive",
    "pb_location"
  ]
```

If the deal can't be confirmed as PE-financed (no "Participate Energy" tag and `is_participate_energy` is not true), warn the user before proceeding.

### 2. Determine Milestone

Ask the user which milestone to audit, or auto-detect:

| Deal Stage | Milestone |
|------------|-----------|
| Site Survey through Inspection | **M1** (Inspection Complete) |
| Permission To Operate, Close Out | **M2** (Project Complete) |
| Project Complete, Cancelled, On Hold | Terminal — requires `--force` |

Check `pe_m1_status` / `pe_m2_status` — if already Submitted/Approved/Paid, the milestone is terminal (skip unless forced).

### 3. Run the Audit

Execute the audit using the library functions. The orchestrator:

1. **Resolves the deal** — verifies PE financing, extracts system type from `project_type`, gets Drive folder IDs
2. **Builds folder map** — lists root folder subfolders, maps numbered prefixes (0. Sales, 1. Site Survey, etc.) to folder IDs
3. **Walks Drive folders** — for each checklist item, searches the designated folder(s) by file name hints
4. **Matches files** — case-insensitive matching with underscore/hyphen normalization; picks most recent match
5. **Resolves combined files** — contract package items (Customer Agreement + Installation Order + Disclosures) propagate "found" status across the group
6. **Disambiguates lien waivers** — bare "lien waiver" without conditional/final qualifier gets `needs_review`

```bash
# Run via tsx for CLI testing
npx tsx -e "
  import { runTurnoverAudit, generateTextReport } from './src/lib/pe-turnover';
  const result = await runTurnoverAudit('DEAL_ID', { milestone: 'm1' });
  if (Array.isArray(result)) {
    result.forEach(r => console.log(generateTextReport(r)));
  } else {
    console.log(generateTextReport(result));
  }
"
```

### 4. Present the Report

Use `generateTextReport()` for terminal output, or format the `TurnoverAuditResult` object directly for richer display.

**Report format:**
```
PE Turnover Readiness — Smith Residence, 123 Main St, Denver, CO

Deal: 12345 | Type: solar+battery | Milestone: M1 (Inspection Complete)
PE M1 Status: Ready to Submit

CONTRACT & PROPOSAL (4/4)
  ✓ Countersigned Customer Agreement    → contract_package.pdf (combined)
  ✓ Countersigned Installation Order    → contract_package.pdf (combined)
  ✓ Required Disclosures                → contract_package.pdf (combined)
  ✓ Proposal / Quote                    → proposal_smith.pdf

DESIGN PACKAGE (2/2)
  ✓ Approved Planset                    → Smith_Final_Planset_v3.pdf
  ✓ Interconnection Approval            → IA_approval_letter.pdf

PHOTOS (11/11)
  ✓ 1. Pre-Installation Site Photo      → pre_install_front.jpg
  ...

ADMIN (2/2)
  ✓ Installer Attestation               → installer_attestation_signed.pdf
  ✓ Customer Acceptance                 → customer_acceptance.pdf

POST-INSTALL (1/1)
  ✓ Commissioning Report                → commissioning_report.pdf

INSPECTION (1/1)
  ✓ Passed Inspection Report            → inspection_pass_report.pdf

LIEN (1/1)
  ✓ Conditional Lien Waiver (Progress)  → conditional_lien_waiver.pdf

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
READY: 22/22 | MISSING: 0
```

**Status icons:**
- `✓` Found
- `~` Likely match (lower confidence)
- `✗` Missing
- `?` Needs manual review
- `—` Not applicable (filtered by system type)
- `!` Error (could not check)

### 5. Assemble the Package (optional)

After presenting the audit report, offer to assemble the package. This copies all found files into a `PE Turnover - M1` (or M2) staging folder in the deal's Google Drive root, with clean filenames.

```typescript
import { assemblePackage } from "@/lib/pe-turnover";

// auditResult from step 4, rootFolderId from deal properties
const assembly = await assemblePackage(auditResult, rootFolderId);
console.log(`Folder: ${assembly.folderUrl}`);
console.log(`Copied: ${assembly.copied} files`);
if (assembly.missing.length > 0) {
  console.log(`Missing: ${assembly.missing.join(", ")}`);
}
```

**Behavior:**
- Creates a flat folder with files named like `01_Customer_Agreement.pdf`, `Photo_01_Site_Address.jpg`
- Combined files (contract package) are copied once, not duplicated
- Uploads a `_MANIFEST.txt` listing all items and their statuses
- If `PE Turnover - M1` already exists, creates `PE Turnover - M1 (2)`, `(3)`, etc.
- Returns folder URL, copy count, and list of still-missing items

After assembly, present the result and list any missing items the PM still needs to add manually.

### 6. Actionable Next Steps

Based on the gap report, suggest concrete actions:

- **Missing contract docs** → Check PandaDoc or ask sales to re-send
- **Missing photos** → List which PE photo numbers are absent; link to PE Photo Requirements
- **Missing inspection report** → Check if inspection has been scheduled/passed
- **Missing lien waiver** → Remind PM to get lien waiver from subcontractors
- **needs_review items** → Flag for manual verification (e.g., generic lien waiver without conditional/final qualifier)
- **Missing planset** → Check design folder, may need design team to upload final version

For `--milestone both`, present M1 and M2 reports sequentially with a combined summary.

---

## M1 Checklist (Inspection Complete)

25 items across 7 categories — filtered by system type (solar, battery, solar+battery):

| Category | Items |
|----------|-------|
| **Contract & Proposal** | Customer Agreement, Installation Order, Disclosures, Proposal/Quote, Utility Bill |
| **Design Package** | Approved Planset, Interconnection Approval |
| **Photos** | 11 numbered PE photos (pre-install site, electrical, system, inverter, battery, meter, disconnect, monitoring, label, BOM/invoice, post-install) |
| **Admin** | Installer Attestation, Customer Acceptance |
| **Post-Install** | Commissioning Report |
| **Inspection** | Passed Inspection Report |
| **Lien** | Conditional Lien Waiver (Progress Payment) |

## M2 Checklist (Project Complete)

5 items across 4 categories:

| Category | Items |
|----------|-------|
| **PTO** | PTO Letter / Utility Approval |
| **Warranty** | Equipment Warranty Registration |
| **Incentives** | Incentive/Rebate Confirmation |
| **Lien** | Final (Unconditional) Lien Waiver, HOA Approval |

---

## System Type Filtering

System type comes from the `project_type` deal property:
- `"solar"` → solar-only items
- `"battery"` → storage-only items (e.g., Photos 5 and 8 are battery-specific)
- `"solar+battery"` or anything containing "battery"/"storage" → all items

Items with `appliesTo` that doesn't include the deal's system type are marked `not_applicable`.

## Drive Folder Structure

Expected project folder hierarchy (from `all_document_parent_folder_id`):

```
Project Root/
├── 0. Sales/           ← contracts, proposals, utility bills
├── 1. Site Survey/     ← survey docs and photos
├── 2. Design/          ← plansets (also via design_documents property)
├── 3. Permitting/      ← interconnection approvals, permits
├── 4. Construction/    ← construction docs
├── 5. Installation/    ← installation photos (recursive scan for PE photos)
├── 6. Inspection/      ← inspection reports
├── 7. PTO/             ← PTO letters
└── 8. Incentives/      ← rebate confirmations, commissioning reports
```

The audit validates this structure exists and warns if fewer than 3 numbered subfolders are found.

## Tips

- **Contract package** — Customer Agreement, Installation Order, and Disclosures are usually combined in a single PDF. The audit handles this via `combinedWith` groups — if one is found, all three are marked as found.
- **Installer Attestation & Customer Acceptance** — These post-install docs don't have a fixed folder location. The audit searches all folders (`searchAllFolders: true`).
- **Photos use recursive scan** — The Installation folder (5.) is scanned recursively up to 3 levels deep, up to 50 images.
- **Photo 6 (Invoice/BOM)** — This PE photo number checks both the Installation photos AND document folders (0. Sales, 4. Construction) since it may be a document rather than a photo.
- **Lien waivers** — A bare "lien waiver" file without "conditional"/"final"/"unconditional" qualifier gets `needs_review` status. The user must manually verify which type it is.
- **PandaDoc automation** — Installer Attestation and Customer Acceptance documents are being automated via PandaDoc. If missing, check PandaDoc status on the deal.
- **Force mode** — Use `{ force: true }` to audit deals in terminal stages (Project Complete, Cancelled) or with terminal PE statuses (Submitted, Approved, Paid).
