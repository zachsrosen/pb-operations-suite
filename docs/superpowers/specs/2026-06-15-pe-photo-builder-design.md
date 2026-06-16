# PE Photos-per-Policy Builder — Design Spec

**Date:** 2026-06-15
**Status:** Approved design, pending implementation plan
**Builds on:** PR #1076 (policy-photos selection/captioning fix + `appliesTo` corrections). This
feature assumes that fix is merged, since it shares the assembly/triage code path.

## Goal

A self-serve web page in pbtechops.com where a user (Layla, a PM, an admin) enters a project
code, drops the install photos, and gets back an AI-verified, page-labeled "Photos per Policy"
PDF — with the Sales Order embedded — plus an on-screen coverage report that flags any required
shot that is missing or only weakly covered. The finished PDF downloads and is also saved to the
deal's Participate Energy Drive folder. The user still uploads to the PE portal manually (PE's
API is read-only).

This is the manual-input sibling of the existing `pe-policy-photos` CLI skill, which pulls photos
*from Drive by deal code*. Here the human supplies the photos directly.

## Users & access

- **Page:** `/dashboards/pe-photo-builder`, surfaced as a card on the **Accounting suite**
  landing page.
- **Roles:** ADMIN, OWNER, PROJECT_MANAGER, ACCOUNTING, SALES_MANAGER.
- **Suite card:** the Accounting suite is visible to ADMIN, OWNER, ACCOUNTING, SALES_MANAGER —
  **not** PROJECT_MANAGER. PMs get the page+API allowlist and reach it by direct URL only (mirrors
  the existing executive-dashboard pattern noted in CLAUDE.md). The page also gets a card on the
  PM-visible Operations suite so PMs have a surface to land on.
- **API routes** (added to the same roles' `allowedRoutes` in `src/lib/roles.ts`, and each suite
  card likewise implies the route allowlist for every role that sees the suite):
  - `POST /api/pe/photo-package/upload-token` — issues a Vercel Blob client-upload token
  - `POST /api/pe/photo-package/triage` (JSON body)
  - `POST /api/pe/photo-package/assemble` (JSON body)

## User flow

1. User types the **PROJ or PE code** and drag-drops N install photos. The browser uploads each
   photo **directly to Vercel Blob** via `@vercel/blob/client` `upload()` (which calls
   `/upload-token` for a client token, exactly like the existing `bom/upload-token` flow). Each
   upload returns a blob URL; the browser keeps `{ clientId, name, blobUrl }` per photo and renders
   thumbnails from the in-browser `File` objects. (This bypasses the serverless request-body size
   limit — photos never transit a route handler.)
2. **Triage** (`POST /triage`, JSON: `{ code, photos: [{ clientId, name, blobUrl }] }`):
   - Resolve the deal by code; read **system type** from the PE project record; locate the **SO
     PDF** in the deal's Drive.
   - Fetch each blob, screen images (low-res / sliver guard), downscale copies for vision, run
     `triagePhotoBatch` against the full 11-shot checklist (chunked if > the single-call limit).
   - Respond with: per-photo `{ clientId, name, shot, verdict, issues[], equipmentVisible[] }`,
     the resolved `systemType`, `soFound: boolean`, and a **coverage map**.
   - No PDF is built on this call; the blobs persist (they are the durable store between calls).
3. The UI renders the **coverage report** and a chip per uploaded photo. The user can **re-tag** a
   mislabeled photo (pick a different shot, or "not a PE shot" to drop it) or **remove** it.
4. **Assemble** (`POST /assemble`, JSON: `{ code, assignments: [{ clientId, blobUrl, shotId|null }] }`):
   - Fetch the full-res blobs for kept assignments (`shotId !== null`), apply the user's final tags,
     order canonically, caption each page, embed the SO (re-fetched by code), and build the PDF.
   - **Stage a copy** to the deal's Participate Energy Drive folder (`findOrCreatePeFolder` +
     `uploadDriveBinaryFile`).
   - Return the PDF for download plus the final coverage map.

### Why Blob + two JSON calls (no server-side temp store, no body-size limit)

Vercel route handlers have a small request-body limit (multi-MB), so a 60-photo multipart POST
would hard-fail. The codebase already solves this for planset PDFs with a Blob client-upload token
(`/api/bom/upload-token` + `@vercel/blob/client`): the browser uploads straight to Blob and the
route only ever sees a tiny JSON body of blob URLs. We reuse that pattern. The blobs are the durable
store **between** `/triage` and `/assemble`, so neither call re-uploads bytes and the server stays
stateless. Each photo carries a stable client-generated `clientId` so tags map back unambiguously
(filenames can collide).

`/assemble` reconciles the assignments by `clientId`/`blobUrl`: it uses only entries with a non-null
`shotId`; an entry whose blob fetch fails is skipped with a warning in the response (it simply won't
appear in the PDF) rather than failing the whole request. Blobs are written under a per-session
pathname prefix and rely on Blob's retention (no explicit cleanup in v1 — a documented follow-up).

## Coverage / "what's missing" logic

A new pure module, unit-tested, computes the report.

### Required shots per system type

`requiredShotsFor(systemType): ChecklistId[]`

- **solar:** site · PV array · module nameplate · all-electrical · MSP · inverter · racking
- **battery:** site · all-electrical · MSP · storage wide · storage nameplate · storage controller
- **solar+battery:** the union of the two
- **All types additionally require the Sales Order** (the "Invoice & BOM" slot), tracked via
  `soFound` rather than a photo assignment.

This requires a small data fix in `PE_M1_CHECKLIST` (this feature's first task, NOT in PR #1076):
shots 4 (all-electrical) and 5 (MSP) are mis-tagged SOLAR-only but are required on battery jobs
too. `requiredShotsFor` derives from the corrected `appliesTo`, so there is a single source of truth.

### Per-shot status (three states)

`computeCoverage(assignments, systemType, soFound): CoverageReport`

For each required shot, given the photos assigned to it:

- **Covered** ✅ — at least one photo with verdict `pass`.
- **Recheck** ⚠️ — one or more photos assigned, but all are `needs_review` (present, but the
  vision flagged legibility/partial framing — verify before submitting).
- **Missing** ❌ — zero photos assigned to that shot.

The Sales Order is rendered as a **distinct document row** in the coverage report (visually
separated from the photo shots, with no re-tag affordance, since no uploaded photo can satisfy
it). It shows **Covered** if `soFound`, else **Missing**.

Photos matched to a shot that is *not* required for this system type are listed as **Bonus**
(kept in the PDF, not counted against coverage). Photos the user drops (or the vision tags as
not-a-PE-shot) are excluded.

"Missing" therefore means *truly absent* — the noisy `needs_review` flags from the vision land in
their own **Recheck** bucket, not in Missing.

## Reuse, not rebuild (refactor)

Lift the reusable assembly/resolution logic out of `scripts/pe-photo-submit.ts` into a new shared
module `src/lib/pe-photo-package.ts`, consumed by **both** the CLI skill and the web routes:

- Deal resolution by PE code (the `searchDealsByPeCode` + `pickDealByAddress` logic).
- Source-folder / SO location (`locateSalesOrderPdf`, `extractFolderId`).
- The captioned-page PDF builder (`appendImagePage`) and SO-embed step.
- Canonical ordering (`orderPolicyPhotos`) and `policyPhotosFilename`.

Vision (`triagePhotoBatch`, `uploadToAnthropic`), Drive helpers, and `normalizeSystemType` are
reused as-is. The CLI script is then a thin wrapper over the shared module (no behavior change,
covered by its existing tests).

## Error handling

- **Code resolves to 0 deals** → 404-style error: "No deal found for that code."
- **Code resolves to >1 deals** → return the candidate addresses; the UI asks the user to pick.
- **SO not in Drive** → coverage marks Sales Order **Missing**; the PDF still assembles without it
  (matching current CLI behavior), with a banner telling the user to attach it manually.
- **No usable photos** (all sliver/low-res) → clear error listing what was rejected and why.
- **Anthropic transient (503 "file storage unavailable")** → retry with backoff; if it still
  fails, surface "vision service busy, try again."
- **Upload cap** → a **count** cap (~60 photos), enforced client-side before upload, that keeps
  vision triage within its token budget. Photo *bytes* go straight to Blob (not through a route
  handler), so the serverless request-body limit is a non-issue — the triage/assemble JSON bodies
  carry only blob URLs. Individual file size is bounded by Blob's own limits.
- **Blob upload / fetch failure** → a photo that fails to upload is reported in the UI and excluded;
  a blob the server can't fetch during triage/assemble is skipped with a warning (per the
  reconciliation rules above), never a 500.
- **`BLOB_READ_WRITE_TOKEN` missing** → `/upload-token` returns 503 "Blob storage not configured"
  (same as `bom/upload-token`).

## Testing

- **Unit** (`src/lib/pe-photo-coverage`): `requiredShotsFor` per system type (excludes the SO slot
  from photo shots), `computeCoverage` (covered / recheck / missing / bonus, SO-missing, complete).
- **Integration** (the routes): mocked vision + Drive + Blob fetch — triage returns a coverage map
  and per-photo tags from blob URLs; assemble produces a non-empty PDF and calls the Drive stage
  helper. Auth via `requireApiAuth`; route-level authorization is enforced by middleware (roles.ts).

## Out of scope (YAGNI)

- No direct upload to the PE portal (manual / read-only API) — download + Drive copy only.
- No persisted run history or audit of past packages.
- No no-code / standalone mode — the project code is required (drives system type + SO).
- No re-cropping/rotating photos in the UI (rotation is auto-normalized during assembly).
