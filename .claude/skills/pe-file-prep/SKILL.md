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

## What This Does

1. **Resolves the deal** from HubSpot (by deal ID, project name, or customer name)
2. **Runs the AI-powered audit**: walks GDrive folders, uses Claude vision to classify each document and verify each photo against PE checklist requirements
3. **Auto-pulls PandaDoc documents**: downloads completed Attestation, Acceptance, and Lien Waiver PDFs into GDrive
4. **Reports results** with AI verdicts, confidence levels, and issues for each item
5. **Offers package assembly**: copies all found + warned files into a staging folder

## Usage

```
User: prepare PE files for PROJ-1234
```

The skill resolves the deal, runs the audit via the pe-audit-orchestrator library, and presents results. For missing items, it provides actionable guidance (e.g., "Create PandaDoc from template", "For Tesla systems, use the PowerHub screenshot skill").

## Feature Flag

Requires `PE_FILE_PREP_ENABLED=true` in environment.

## Cross-Skill Integration

- **pe-portal-scraping**: Separate skill for browser-based PE portal interaction
- **PowerHub screenshot**: Separate skill for pulling commissioning proof from Tesla PowerHub. If commissioning photo is missing, this skill suggests using it.

## Implementation

Uses `runPeAudit()` from `src/lib/pe-audit-orchestrator.ts` which orchestrates:
- `src/lib/pe-vision-classifier.ts` — Claude Sonnet vision classification
- `src/lib/pandadoc.ts` — PandaDoc template discovery + PDF download
- `src/lib/pe-turnover.ts` — checklist definitions, folder mapping, assembly
- `src/lib/drive-plansets.ts` — Google Drive file operations
