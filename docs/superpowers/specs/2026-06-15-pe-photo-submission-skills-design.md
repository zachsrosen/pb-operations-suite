# PE Photo Submission Skills — Design Spec

- **Date:** 2026-06-15
- **Author:** Zach Rosen (with Claude)
- **Status:** Draft — pending review
- **Topic:** Two focused skills for assembling PE (Participate Energy) photo-based submission packages from Drive

---

## 1. Overview

Two new lightweight skills that turn a project's Drive photos into an upload-ready PDF for a specific PE portal document, verified by AI vision against the gold standard of packages PE approved on the first try.

- **Skill A — `pe-final-permit-photos`**: assembles the **Signed Final Permit** doc from folder **6. Inspections** (fallback **3. Permitting**).
- **Skill B — `pe-policy-photos`**: assembles the **Photos per Policy** doc from folder **5. Installation** (the system-type-conditioned shot set), plus the embedded Zoho Sales Order.

Both are deliberately narrower than the existing `pe-file-prep` skill (which does the full M1/M2 audit, PandaDoc pulls, and package assembly across all folders). These two do one thing: produce a correct, upload-ready PDF for one photo-based PE doc.

### Why this exists

This workflow was run by hand on 2026-06-15 across 13 projects (replacing single-PNG Final Permit submissions with multi-photo PDFs). It worked but was entirely manual. The two skills codify it, add AI verification, and make it repeatable for single projects or batches.

---

## 2. Goals & non-goals

### Goals
- Resolve a project (single) or set of projects (batch, incl. "my submissions in the last N hours") to the right Drive photos.
- Verify each photo with Claude vision against approved-on-v1 reference examples; flag wrong/low-quality/missing shots before building anything.
- Assemble a correctly-ordered PDF matching Layla's approved conventions.
- Deliver locally (PDF + `UPLOAD-CHECKLIST.md` with portal links) **and** stage a copy into the project's Drive `Participate Energy` folder.
- Never silently emit a junk PDF — every skip/flag is surfaced.

### Non-goals (YAGNI)
- **No portal auto-upload.** The PE API is read-only; the user uploads through the portal manually.
- **No PandaDoc pulls, no M1/M2 status logic.** `pe-file-prep` owns the heavyweight audit.
- **No new infrastructure.** Everything reuses existing `lib/` modules.

---

## 3. Architecture: two thin skills over one shared engine

Both skills run the same pipeline, differing only in four parameters: source folder, target PE doc, verification prompt, and required-shots logic. So the implementation is **one shared script** with two thin `SKILL.md` wrappers.

```
.claude/skills/pe-final-permit-photos/SKILL.md   → invokes engine --doc final-permit
.claude/skills/pe-policy-photos/SKILL.md          → invokes engine --doc policy-photos
scripts/pe-photo-submit.ts                        → shared engine (doc-type aware)
```

### Doc-type config table

| Aspect | `final-permit` | `policy-photos` |
|---|---|---|
| Source Drive folder(s) | `6` (Inspections), fallback `3` (Permitting) | `5` (Installation) |
| PE doc key (`PeDocuments`) | `signedFinalPermit` | `photos` |
| Shot model | single category: signed/passed permit card | system-type-conditioned checklist (`pe-turnover` photo items) |
| Extra artifacts | none | embed Zoho **Sales Order PDF** (Invoice & BOM, item #6) |
| Output filename | `{ProjCode}_{LastName}_Final_Permit.pdf` | `{street}_{city}.pdf` (Layla convention) |
| Vision prompt | confirm signed & passed/finaled permit or inspection card | classify each photo against required shots; flag missing |

---

## 4. Pipeline stages (shared engine)

1. **Resolve targets**
   - **Single:** PROJ code / customer / dealId. Resolve the HubSpot deal by **`pe_project_id` search** (never the PE-side `_hubspot.recordId` — it 404s). Match the PE project via `listAllProjects`.
   - **Batch:** explicit list of PROJ codes, OR "my submissions in the last N h" → scan the target doc's `versions[]` for uploads by the current user in-window (the pattern used today).
2. **Resolve Drive folder.** Deal → `all_document_parent_folder_id` → `buildFolderMap` → the target numbered subfolder(s).
3. **Pull + verify photos.** List + download images. Run `pe-vision-classifier`:
   - **Final Permit:** confirm each image is a *signed and passed/finaled* permit or inspection card. Exclude non-matching; flag low-res slivers (the Torpey case: 661×111 image).
   - **Policy Photos:** classify each image against the system-type-applicable shots; map present shots, **flag missing required shots**. A shot may be satisfied by multiple photos (e.g., 6 array shots in KOVA18).
4. **Fetch extra artifacts (policy-photos only).** Locate the project's Zoho Sales Order PDF (Invoice & BOM) for item #6 from the project's Drive — `Participate Energy` folder first, then folder `0. Sales`. **If absent, flag the package and continue without #6 — do not regenerate** (regeneration is out of scope; surfacing the gap is enough). This keeps stage 4 within the already-listed Drive modules.
5. **Assemble PDF** (`pdf-lib` + `sharp`), photos in canonical order (Section 5), SO PDF pages embedded at the #6 position. The policy-photos output filename is derived from the PE project's **structured address** (`assets`/project street + city), never by parsing the HubSpot deal name (deal names are unreliable and collide — see the Bucey case, §7).
6. **Deliver.** Write local PDF to `~/Downloads/pe-<doctype>-pdfs/` + `UPLOAD-CHECKLIST.md` (PE portal links from `listAllProjects` + flags). Stage a copy into the project's Drive `Participate Energy` folder via `findOrCreatePeFolder` + `uploadDriveBinaryFile`.
7. **Report** a summary table with per-project counts, flags, and the portal link.

---

## 5. Photos-per-Policy canonical structure

Derived from four approved-on-v1 packages: San Simeon (PV+Storage, 14pp), ROSE24 (Storage-Only, 8pp), HURL51 (CA Storage-Only, 5pp), KOVA18 (PV+Storage, 22pp).

**Shot list is conditioned on system type** via `filterChecklist(checklist, systemType)` — `SystemType = "solar" | "battery" | "solar+battery"`, normalized from PE `assets.systemType` ("PV+Storage", "Storage Only", etc.).

Canonical order (superset; items filtered out for the system type are skipped):

| # | Shot | Applies to | Notes |
|---|---|---|---|
| 1 | Site address + home | ALL | MLS/Zillow exterior — **no GPS watermark expected**, don't flag |
| 2 | Wide-angle PV array / roof | SOLAR | may be **many** photos |
| 3 | Module nameplate | SOLAR | e.g. Hyundai HiN-T440NF |
| 4 | Wide-angle all electrical | SOLAR | exterior wall / garage |
| 5 | Main service panel (cover off) | SOLAR | labeled breakers |
| 6 | **Invoice & BOM** | ALL | **embedded Zoho SO PDF**, not a photo |
| 7 | Inverter/micro model | SOLAR | nameplate |
| 8 | Racking parts + markings | SOLAR | clamps/rails |
| 9 | Storage wide angle | STORAGE | Powerwalls in situ |
| 10 | Storage nameplate & labels | STORAGE | Tesla BESS label |
| 11 | Storage controller/disconnect | STORAGE | gateway internals, battery disconnect, SSID/monitoring label |

Field photos (#2–#11) carry GPS+timestamp watermarks — a positive signal for the classifier.

**Final Permit** is a single-category doc: 1–3 signed/passed permit or inspection-card images from folder 6, ordered chronologically.

---

## 6. Reference library (approved-on-v1)

The vision classifier uses few-shot reference examples drawn from documents **PE approved on version 1** (`PeDocumentInfo.status === "APPROVED" && versions.length === 1`) — a cleaner "first-try pass" signal than the existing `pe-reference-library.findApprovedDeals()` heuristic (which keys on `pe_m1_status === "Paid"` at the deal level).

- Extend `pe-reference-library.ts` with a doc-level approved-on-v1 selector that scans `listAllProjects()` and ranks gold examples per doc type.
- As of 2026-06-15 the corpus is healthy: **31** Photos-per-Policy and **68** Signed Final Permit docs approved on v1.
- Reuse the existing `PeReferenceDoc` table + Anthropic Files caching (`getReferenceExamples`).

---

## 7. Edge cases (lessons from the 2026-06-15 manual run)

- **Stale PE recordId** → always resolve deals via `pe_project_id` search.
- **Duplicate `pe_project_id`** on multiple deals (the Bucey case) → disambiguate by matching the PE project address to the deal address; flag if still ambiguous, never guess silently.
- **Empty target folder / 0 images** → skip + flag.
- **Too-small / low-res image** (Torpey 661×111) → flag, do not silently emit.
- **Final Permit filed in folder 3** (some AHJs issue a combined permit+inspection card) → check folder 6 then 3.
- **Multiple HubSpot deals per customer surname** is expected; the surname-only `pe-crossref` matcher can re-stamp duplicates (out of scope to fix here; noted).

---

## 8. Reused modules (no new infra)

- `lib/pe-api.ts` — `listAllProjects`, `PeDocuments`, portal URLs, `versions[]`.
- `lib/hubspot.ts` — `searchWithRetry` (deal resolution by `pe_project_id`), `getDealProperties`.
- `lib/pe-turnover.ts` — photo checklist, `filterChecklist`, `buildFolderMap`, system-type normalization.
- `lib/drive-plansets.ts` — `extractFolderId`, `listDriveImages`, `downloadDriveImage`, `listDriveFilesRecursive`, `uploadDriveBinaryFile`.
- `lib/pe-audit-orchestrator.ts` — `findOrCreatePeFolder`.
- `lib/pe-vision-classifier.ts` — `verifyPhoto`, `triagePhotoBatch`, `classifyBatch`.
- `lib/pe-reference-library.ts` — `PeReferenceDoc`, `getReferenceExamples` (+ new approved-on-v1 selector).
- `pdf-lib` + `sharp` — assembly (image → page; embed SO PDF pages).

---

## 9. Feature flag

Vision verification reuses the existing `PE_FILE_PREP_ENABLED` flag (same Anthropic Files / classifier dependency). AI verification is the core value of these skills, so **with the flag off the skills hard-stop** with a clear message ("PE_FILE_PREP_ENABLED required for photo verification"). No heuristic-only assembly path — that would be a separate, larger feature and is explicitly out of scope (YAGNI).

---

## 10. Open questions for implementation plan

1. Batch "last N hours" default window, and whether it filters to the current user only by default (today's run was implicitly "my uploads").
2. Whether the `UPLOAD-CHECKLIST.md` should carry over the existing `pe-final-permit-pdfs` checklist format verbatim or unify both doc types into one format.

---

## 11. Testing

- Unit: target resolution (single/batch), folder-map → subfolder selection, system-type → shot filter, filename derivation, duplicate-deal disambiguation.
- Integration (against the 2026-06-15 gold set): rebuild ROSE24 / KOVA18 / HURL51 / San Simeon packages and diff page structure against the approved originals.
- Vision: verify the classifier accepts approved-on-v1 references and rejects the Torpey sliver.
