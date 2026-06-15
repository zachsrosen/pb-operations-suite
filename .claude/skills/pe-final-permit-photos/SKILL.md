---
name: pe-final-permit-photos
description: Use when assembling the PE (Participate Energy) "Signed Final Permit" document for upload — pulling a project's inspection/permit photos from Google Drive into one upload-ready PDF, AI-verified. Triggered by "prep final permit photos for PROJ-XXXX / Torpey", "build the final permit PDF", "final permit submission for [customer]", "my final permit submissions today", or replacing single-PNG final-permit uploads with a combined PDF.
version: 0.1.0
---

# PE Final Permit Photos

Assemble the PE portal **Signed Final Permit** document for one project or a batch: pull the signed/finaled-permit or passed-inspection photos from the project's Drive folder, verify each with Claude vision, and produce an upload-ready PDF plus a checklist with portal links.

**You upload manually.** The PE API is read-only — this skill never touches the portal. It builds the PDF and (optionally) stages a copy into the project's Drive `Participate Energy` folder; you upload the new version through `raceway.participate.energy`.

## When to use

- "Prep the final permit photos for PROJ-9717" / "...for Torpey"
- "Build the final permit PDF for these projects: ..."
- "Do my final permit submissions from the last 24h" (rebuild what you uploaded as PNGs into PDFs)

## Requirements

- `PE_FILE_PREP_ENABLED=true` in the environment (gates the vision verification; the skill hard-stops without it).
- Run from the repo root with the project `.env` loaded.

## How to run

```bash
# Single project (PE code, e.g. CO2605-TORP2)
PE_FILE_PREP_ENABLED=true node --env-file=.env --import tsx \
  scripts/pe-photo-submit.ts --doc final-permit --project CO2605-TORP2

# Explicit list
PE_FILE_PREP_ENABLED=true node --env-file=.env --import tsx \
  scripts/pe-photo-submit.ts --doc final-permit --batch "CO2605-TORP2,CO2604-MURR9"

# Everything you uploaded in the last 24h (your uploads only)
PE_FILE_PREP_ENABLED=true node --env-file=.env --import tsx \
  scripts/pe-photo-submit.ts --doc final-permit --batch recent --hours 24

# Add --no-stage to skip copying the PDF into the Drive Participate Energy folder
```

## What it does

1. **Resolves the project** — finds the HubSpot deal by its `pe_project_id` (never the PE-side record id, which 404s); if a customer name matches two deals, it disambiguates by the PE project's address and flags if still ambiguous.
2. **Finds the photos** — from the deal's dedicated **`inspection_documents`** / **`permit_documents`** Drive folders (HubSpot properties), listed recursively. Falls back to the numbered **6. Inspections** / **3. Permitting** subfolders when those properties aren't populated.
3. **Screens + verifies** — drops low-res/sliver images (the Torpey-style 661×111 strip), then asks Claude vision to confirm each is a permit/inspection document. PE accepts several forms — a signed/finaled permit, a finaled-permit portal screenshot, or a passed final-inspection record — so all of those are kept; clearly-wrong docs are excluded.
4. **Assembles** the kept images into one PDF, ordered chronologically, named `{PEcode}_{LastName}_Final_Permit.pdf`.
5. **Delivers** to `~/Downloads/pe-final-permit-pdfs/` plus an `UPLOAD-CHECKLIST.md` (one row per project: checkbox, customer, PDF, portal link, flags). Unless `--no-stage`, also uploads a copy to the project's Drive `Participate Energy` folder.

## Flags to eyeball before uploading

The run surfaces per-image flags — review them, since vision is advisory:
- `too small / extreme aspect` — a junk/cropped image was skipped (get a real photo).
- `not a permit/inspection document` — an image was excluded as off-topic.
- vision `issues` — e.g. "no inspector signature visible", "permit shows a hold" — worth a glance before you submit.
- `source folder is empty` / `not found` — no photos in folder 6/3 for that project.

## Notes

- Output filenames and ordering match the conventions in PE's approved-on-v1 packages.
- Deferred (spec §6): few-shot grounding with approved-on-v1 reference examples is not yet wired; the verifier runs against the PE checklist definition today.
- Spec: `docs/superpowers/specs/2026-06-15-pe-photo-submission-skills-design.md`.
