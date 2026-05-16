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

## Equipment Model Number Cross-Verification

PE requires exact model number consistency across all sources: design planset, Sales Order, PowerHub monitoring, and installation photos. The vision classifier should flag inconsistencies.

### Target Model Numbers (Tesla PW3 System)

| Equipment | Document Model | Physical Hardware |
|-----------|---------------|-------------------|
| Powerwall 3 | 1707000-**21-Y** | 1707000-**21-M** (nameplate) |
| Backup Switch | 1624171-**00-E** | 1624171-00-E |
| Backup Gateway-3 | 1841000-**X1-Y** | 1841000-X1-Y |
| PW3 Expansion Unit | 1807000-**20-B** | 1807000-20-B |

**Important**: Physical hardware shows `-21-M` on the nameplate, documents and PowerHub show `-21-Y`. This is expected — Tesla uses different suffixes for manufacturing variant vs planning SKU. PE checks the **document** model against `1707000-21-Y`. Watch for `-11-M` on nameplates — that is the **wrong hardware variant**.

### Verification Sources

**Source 1: Sales Order (Zoho)** — The SO description line is what PE reviews. PW3 should say `"Tesla 1707000-21-Y"`. Flag `"1707000-XX-Y"` (generic, needs revision) or `"Powerwall 3 (USA module)"` (descriptive, needs revision).

**Source 2: Design Planset** — Electrical Line Diagram page contains specs box + schematic labels with model numbers. CO projects: usually PV-5 (page 6). CA projects: usually PV-4 but varies due to extra sheets. Some plansets show `XX-Y` in BOM table but `21-Y` in diagram labels — the label is correct.

**Source 3: PowerHub Monitoring** — Shows installed hardware model from device firmware.
> **Reliability warning**: PowerHub data was wrong for 3 of 16 verified deals (19% error rate). Czajkowski, He_Steven, and Law showed `21-M` on PowerHub but physical nameplates confirmed `11-M`. **Physical nameplate is ground truth.** PowerHub alone is NOT sufficient to clear a deal.

**Source 4: Photo_10 (Storage Nameplate)** — The ONLY numbered PE photo showing a readable PW3 model number. Look for Tesla Part No. on the side nameplate sticker (silver/gray specs table), NOT the WiFi/QR label on top. Missing from 67% of battery deals as of May 2026.

> **File format gotcha**: Photo files in M1 folder have `.pdf` extension but are actually JPEG images.

**Source 5: Drive_Photos (Raw Installer Uploads)** — `M1/Drive_Photos/` contains raw uploads with descriptive filenames. Often MORE complete than numbered PE photos. Best source for physical nameplate verification when Photo_10 is missing.

Key files by priority:
1. `10__Storage_Nameplate__Compliance_Labels*`
2. `CloseUp_Photo_of_All_standalone_PV_and_ESS_inverter_nameplates*`
3. `Powerwall_3_Serial_Numbers*`

Drive_Photos vs numbered photos: raw source has 20-40+ files vs 11 curated PE photos. When Photo_10 is missing, Drive_Photos almost always has the equivalent.

### PE Photo Completeness Patterns

**Systemic gaps** (as of May 2026):
- **Photo_06 (Invoice/BOM)**: Missing from ALL deals — systemic gap, not per-deal issue
- **Photo_10 (Storage nameplate)**: Missing from 67% of battery deals
- **Photo_05 (Battery)**: Missing from ~33% of battery deals

**Common mislabeled photos**: Photo_10 containing meter/disconnect photos instead of nameplate; Photo_05 containing Gateway-3 interior instead of battery equipment; Photo_11 containing electrical panel instead of controller disconnect.

**Enphase sites**: Cones, Engstrand, Gantman, Garman — IQ Combiner 5 / IQ Battery B05-C01-US00-1-3. Photo_05/09/10/11 are N/A (battery photos don't apply to non-Tesla storage).

### Pre-Escalation: Zuper Additional Visit Check

Before flagging wrong-hardware deals for PW3 swap, check Zuper for "Additional Visit" jobs on that deal — a swap may have already occurred. Look for new nameplate photos showing `21-M` in the job photos.

Deals needing this check (as of May 2026): Czajkowski, He_Steven, Law (confirmed 11-M), Collins, Markland, Rahane (suspected 11-M).

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
