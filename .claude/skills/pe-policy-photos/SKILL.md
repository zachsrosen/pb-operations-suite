---
name: pe-policy-photos
description: Use when assembling the PE (Participate Energy) "Photos per Policy" submission package — pulling a project's install photos from Google Drive, AI-classifying them against PE's required shot list, and assembling an ordered PDF (with the Sales Order embedded) for upload. Triggered by "prep the policy photos for PROJ-XXXX / [customer]", "build the Photos per Policy package", "PE install photo package", or "policy photos for my recent submissions".
version: 0.1.0
---

# PE Photos per Policy

Assemble the PE portal **Photos per Policy** package for one project or a batch: pull install photos from the project's Drive `installation_documents` folder, classify each with Claude vision against PE's required shot list (conditioned on system type), order them canonically, embed the Zoho Sales Order, and produce an upload-ready PDF plus a checklist with portal links.

**You upload manually.** The PE API is read-only — this skill never touches the portal. It builds the PDF and (optionally) stages a copy into the project's Drive `Participate Energy` folder; you upload through `raceway.participate.energy`.

## When to use

- "Prep the policy photos for PROJ-9618" / "...for Kovari"
- "Build the Photos per Policy package for these projects: ..."
- "Do my policy-photo submissions from the last 24h"

## Requirements

- `PE_FILE_PREP_ENABLED=true` (gates vision; the skill hard-stops without it).
- Run from the repo root with the project `.env` loaded.

## How to run

```bash
# Single project
PE_FILE_PREP_ENABLED=true node --env-file=.env --import tsx \
  scripts/pe-photo-submit.ts --doc policy-photos --project CO2604-KOVA18

# Explicit list
PE_FILE_PREP_ENABLED=true node --env-file=.env --import tsx \
  scripts/pe-photo-submit.ts --doc policy-photos --batch "CO2604-KOVA18,CO2604-ROSE24"

# Your policy-photo uploads in the last 24h
PE_FILE_PREP_ENABLED=true node --env-file=.env --import tsx \
  scripts/pe-photo-submit.ts --doc policy-photos --batch recent --hours 24

# Add --no-stage to skip copying the PDF into the Drive Participate Energy folder
```

## What it does

1. **Resolves the project** — finds the HubSpot deal by `pe_project_id` (never the PE-side record id, which 404s); disambiguates by address if a customer name matches two deals.
2. **Finds the install photos** — from the deal's **`installation_documents`** Drive folder (the dedicated HubSpot property), listed **recursively** (photos are nested in subfolders like "Electrical Install" / "PV Install"; bounded to 60). The numbered `5. Installation` subfolder is a fallback only.
3. **Screens + classifies** — drops low-res/sliver images, downscales a copy to ≤2000px for vision, then runs Claude triage over the whole batch, matching each photo to a PE shot. The required shots are **conditioned on system type** (solar / battery / solar+battery): e.g. a storage-only system drops the module/array/racking shots.
4. **Orders + embeds** — orders kept photos by the canonical shot sequence and embeds the project's **Zoho Sales Order PDF** at its #6 ("Invoice & BOM") rank. The SO is **located** in the Drive `Participate Energy` / `Sales` folder — never regenerated; if absent it's flagged and the package is assembled without it.
5. **Delivers** — writes `{street}_{city}.pdf` to `~/Downloads/pe-policy-photos-pdfs/` plus an `UPLOAD-CHECKLIST.md`. Unless `--no-stage`, also stages a copy into the Drive `Participate Energy` folder.

## Flags to eyeball before uploading

- `failed verify` / `needs review` — a photo the model rejected or was unsure about.
- `Sales Order PDF not found` — the package was built without item #6; locate/attach it.
- `no images in the installation_documents folder` — no install photos filed for that project.
- vision `issues` — e.g. "nameplate not legible", "array partially cut off" — common PE rejection reasons, worth fixing before submitting.

## Notes

- Output filename + ordering match PE's approved-on-v1 packages (`{street}_{city}.pdf`).
- A shot can be satisfied by multiple photos (e.g. several array angles) — all matching photos are included.
- Deferred (spec §6): few-shot grounding with approved-on-v1 references is not yet wired into the batch triage (a follow-up that extends the shared classifier).
- Spec: `docs/superpowers/specs/2026-06-15-pe-photo-submission-skills-design.md`.
