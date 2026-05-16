---
name: pe-file-prep
description: Prepare PE (Participate Energy) milestone submission files — AI vision classification, PandaDoc auto-pull, and package assembly
---

# PE File Preparation

Prepare Participate Energy milestone submission packages (M1 = Inspection Complete, M2 = Project Complete).

## Trigger Phrases
- "prepare PE files for PROJ-1234"
- "PE file prep for Smith"
- "get PE package ready for deal 12345"
- "PE turnover for [deal]"
- "what's missing for PE submission"
- "M1/M2 readiness check"

## What This Does

1. **Resolves the deal** from HubSpot (by deal ID, project name, or customer name)
2. **Runs the AI-powered audit**: walks GDrive folders, uses Claude vision to classify each document and verify each photo against PE checklist requirements
3. **Includes few-shot reference examples**: approved documents from previously Paid PE deals are included alongside candidate files so the classifier knows what a passing submission looks like
4. **Cross-checks equipment against PE AVL**: the Approved Vendor List is fetched from Raceway API and included in prompts so the classifier flags non-approved equipment
5. **Auto-pulls PandaDoc documents**: downloads completed Attestation, Acceptance, and Lien Waiver PDFs into GDrive
6. **Reports results** with AI verdicts, confidence levels, and issues for each item
7. **Offers package assembly**: copies all found + warned files into a staging folder

## Feature Flag

Requires `PE_FILE_PREP_ENABLED=true` in environment. PandaDoc auto-pull also requires `PANDADOC_PE_TEMPLATES_ENABLED=true`.

## Dashboard UI

The standalone prep page lives at `/dashboards/pe-prep/[dealId]`. PMs access it via the "Prep" button on the PE Submission Gap dashboard.

---

## GDrive Folder Structure

Each deal has a parent folder (HubSpot property `all_document_parent_folder_id`):

```
{dealId}/
  0. Sales           — contracts, proposals, disclosures, utility bills
  1. Site Survey      — site survey docs
  2. Design           — plansets, design packages
  3. Permitting       — permit applications, approved permits
  4. Interconnections — IA applications, signed IAs
  5. Installation     — install photos, commissioning, monitoring screenshots
  6. Inspections      — inspection cards, signed permits, CoA
  7. PTO & Closeout   — PTO letters, final waivers, warranty docs
  8. Incentives       — rebate apps, incentive approvals
  Participate Energy/ — PE-specific docs (SO PDFs, consolidated PE uploads)
```

## M1 Checklist (Inspection Complete)

### Onboarding Documents (folder 0. Sales)

| Document | File Patterns | Notes |
|---|---|---|
| Customer Agreement (PPA/ESA) | `PE_CON_{state}_{name}_{street}.pdf`, `ca_signed`, `contract_package` | Countersigned PPA/ESA. Often combined with IO+Disclosures in one contract package PDF |
| Installation Order | `io_signed`, `installation order`, `contract_package` | Often bundled in same PDF as Customer Agreement |
| State Disclosures | `disclosure`, `contract_package` | Often bundled with CA+IO. State-specific, must be signed/initialed |
| Utility Bill | `utility bill`, `electric bill`, `xcel`, `usage` | Must be dated within 12 months, show 12 months of usage history |

### Post-Install Documents

| Document | Source | File Patterns | Notes |
|---|---|---|---|
| Signed Proposal | Folder 0 | `Proposal{N}_OS{number}_HS{dealId}.pdf`, `proposal`, `quote` | Signed or digitally acknowledged by customer |
| Design Plan | Folder 2 | `PROJ-{number} {LastName}, {FirstName} REV_{letter} {date}.pdf` | Final planset accepted by customer. Uses planset picker |
| Signed Final Permit | Folder 6 | `Inspection_Card_Upload`, `inspection_{timestamp}.pdf`, `final_inspection` | AHJ signed inspection card proving inspection passed |
| Access to Monitoring | Folder 5 | `commissioning`, `monitoring`, `site_id`, `enphase`, `solaredge`, `tesla_app` | Screenshot confirming system owner has monitoring access. For Tesla systems, suggest the PowerHub screenshot skill |
| Signed Interconnection Agreement | Folder 4 | `CO DER Interconnection Agreement`, `Renewable Battery Connect Agreement`, `ia_signed`, `net metering` | Signed by utility and customer |

### PandaDoc Template Documents (search all folders)

These 4 docs are created via PandaDoc templates, NOT manual uploads. The audit auto-pulls completed ones.

| Document | PandaDoc Template Name | Checklist ID |
|---|---|---|
| Certificate of Acceptance (Exhibit B) | `PE Customer Certificate of Acceptance - {Name}` | `m1.post_install.acceptance` |
| Attestation of Customer Payment (Exhibit A) | `PE Installer Attestation - {Name}` | `m1.post_install.attestation` |
| Conditional Progress Lien Waiver | `Progress Lien Waiver PROJ-{N} \| {Name} \| {Address}` | `m1.lien.conditional` |

PandaDoc statuses: Draft → Sent → Viewed → Completed. Signature docs (CoA, Attestation) need "Completed" = signed. Waivers are finalized internally without signature.

Lauren Soderholm typically creates these. The signed PDFs may also appear in GDrive `7. PTO & Closeout/` or `Participate Energy/`.

### Photos per Policy (11 required, folder 5. Installation)

| # | Photo | Applies To | What to Look For |
|---|---|---|---|
| 1 | Site address + home exterior | All | Full front of house, address visible on mailbox or home |
| 2 | Wide-angle PV array | Solar | Full array visible from distance, on roof |
| 3 | Module nameplate label | Solar | Brand, model, serial number, specs — must be legible |
| 4 | Wide-angle all electrical | Solar | Inverter, disconnect, meter, conduit runs visible |
| 5 | Main service panel (cover off) | Solar | Breakers and wiring visible, cover REMOVED |
| 6 | Invoice & BOM | All | Actual invoice document, not a spreadsheet screenshot |
| 7 | Inverter/micro/optimizer model | Solar | Nameplate must be legible |
| 8 | Racking parts + markings | Solar | Rails, clamps, flashings with brand/model visible |
| 9 | Storage wide angle | Storage | Full battery system installation visible |
| 10 | Storage nameplate & labels | Storage | Brand, model, serial number, capacity specs |
| 11 | Storage controller/disconnect | Storage | Equipment must be identifiable |

**Photo subfolder structure**: Within `5. Installation/`, photos live in two subfolder types:
- **`Participate Energy/`** — PE-specific photos named with checklist numbers (`{N}__{description}`, e.g. `9__Storage_Wide_Angle`). Also includes a consolidated PDF. **Use this subfolder for PE audit.**
- **`Xcel PTO Photos/`** — utility PTO process photos (IEEE grid codes). NOT for PE submission.

**Multiple construction jobs** create duplicate subfolder sets. When multiple `Participate Energy/` subfolders exist, use the most recent one (latest consolidated PDF timestamp).

## M2 Checklist (Project Complete)

| Document | Source | File Patterns | Notes |
|---|---|---|---|
| Permission to Operate (PTO) | Folder 7 | `pto`, `permission to operate`, `pto_letter` | Official PTO letter from utility. Often a forwarded email PDF. For exceptions, email ICT@participate.energy |
| Conditional Waiver — Final Payment | PandaDoc | `PE Conditional Waiver and Release on Final Payment - {Name}` | M2 final waiver, checklist ID `m2.lien.final` |

Additional M2 items checked but not separate upload slots:
- Warranty Registration Proof (folder 7)
- Incentive Documentation Proof (folder 7 or 8)
- Final Invoice and Payment Proof

## Common Gotchas

1. **Multiple PE folders**: Some deals have two `Participate Energy/` folders at the parent level (different creators/dates). Use the most recently modified one
2. **Contract package bundling**: CA, IO, and Disclosures are often combined in one PDF (`PE_CON_` file). The classifier handles multi-document PDFs
3. **Subfolder nesting**: Files aren't always at top level — check subfolders (e.g., `6. Inspections/Inspection/` not just `6. Inspections/`)
4. **Interconnection subfolder naming**: Named after the utility (e.g., `Xcel docs/`), not standardized
5. **PTO letter format**: Often a forwarded email PDF, not a formal letter
6. **PandaDoc docs won't be in GDrive** until the signed PDF is downloaded and placed there — the auto-pull handles this

## Common PE Rejection Reasons

Flag these proactively when the vision classifier detects them:
- Incomplete signatures or missing initials
- Name/address inconsistencies across documents
- Expired utility bills or outdated information
- Poor quality photos or missing required angles
- Unsigned or incomplete forms
- Equipment not on PE's Approved Vendor List

## Milestone Payment Structure

| Milestone | Payment | Trigger |
|---|---|---|
| Inspection Complete (M1) | Up to 2/3 of Remaining Amount | Pass AHJ final inspection + upload all IC docs |
| Project Complete (M2) | Balance of Remaining Amount | Achieve PTO + upload all PC docs |

"Remaining Amount" = 25-35% of system cost that PE pays through its lease factor.

## PE Contacts

- `support@participate.energy` — general support
- `ICT@participate.energy` — PTO exceptions/escalation
- `channel@participate.energy` — program/incentive questions

## Cross-Skill Integration

- **pe-turnover**: Alias that redirects here
- **PowerHub screenshot**: If commissioning/monitoring photo is missing for a Tesla system, suggest this skill
- **pe-portal-scraping**: Separate skill for browser-based PE portal interaction (not part of this audit)

## Implementation

Uses `runPeAudit()` from `src/lib/pe-audit-orchestrator.ts` which orchestrates:
- `src/lib/pe-vision-classifier.ts` — Claude Sonnet vision classification with reference examples
- `src/lib/pe-reference-library.ts` — few-shot examples from approved PE deals
- `src/lib/pe-avl.ts` — Approved Vendor List fetch and equipment cross-check
- `src/lib/pandadoc.ts` — PandaDoc template discovery + PDF download
- `src/lib/pe-turnover.ts` — checklist definitions, folder mapping, assembly
- `src/lib/drive-plansets.ts` — Google Drive file operations

Key HubSpot deal properties:
- `all_document_parent_folder_id` — parent GDrive folder ID
- `pe_project_id` — PE project ID (e.g., CO2601-SCHA2)
- `pe_portal_url` — direct link to PE portal project page
- `pe_m1_status` / `pe_m2_status` — milestone submission status
- `is_participate_energy` — PE enrollment flag
