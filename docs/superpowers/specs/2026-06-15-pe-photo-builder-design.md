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
- **API routes** (added to the same roles' `allowedRoutes` in `src/lib/roles.ts`, and the suite
  card likewise implies the route allowlist):
  - `POST /api/pe/photo-package/triage`
  - `POST /api/pe/photo-package/assemble`

## User flow

1. User types the **PROJ or PE code** and drag-drops N install photos.
2. **Triage** (`POST /triage`, multipart: `code` + photo files):
   - Resolve the deal by code; read **system type** from the PE project record; locate the **SO
     PDF** in the deal's Drive.
   - Screen images (low-res / sliver guard), downscale copies for vision, run `triagePhotoBatch`
     against the full 11-shot checklist (chunked if > the single-call limit).
   - Respond with: per-photo `{ clientId, name, shot, verdict, issues[], equipmentVisible[] }`,
     the resolved `systemType`, `soFound: boolean`, and a **coverage map**.
   - No PDF is built and no files are persisted server-side on this call.
3. The UI renders the **coverage report** and a chip per uploaded photo. The user can **re-tag** a
   mislabeled photo (pick a different shot, or "not a PE shot" to drop it) or **remove** it.
   Thumbnails render client-side from the already-in-browser `File` objects.
4. **Assemble** (`POST /assemble`, multipart: `code` + photo files + `assignments` JSON):
   - Re-receive the same files from the browser, apply the user's final tags, order canonically,
     caption each page, embed the SO (re-fetched by code), and build the PDF.
   - **Stage a copy** to the deal's Participate Energy Drive folder (`findOrCreatePeFolder` +
     `uploadDriveBinaryFile`).
   - Return the PDF for download plus the final coverage map.

### Why two calls with a browser re-submit (no server-side temp store)

Vercel functions are stateless and the filesystem is ephemeral, so full-res originals cannot be
held in memory between `/triage` and `/assemble`. Rather than introduce a blob store (with its own
upload + lifecycle + cleanup), the browser — which already holds the `File` objects — re-sends them
on `/assemble`. `/assemble` trusts the passed tags and skips re-triage, so it is fast and cheap.
Each file carries a stable client-generated `clientId` so tags map back unambiguously (filenames
can collide).

## Coverage / "what's missing" logic

A new pure module, unit-tested, computes the report.

### Required shots per system type

`requiredShotsFor(systemType): ChecklistId[]`

- **solar:** site · PV array · module nameplate · all-electrical · MSP · inverter · racking
- **battery:** site · all-electrical · MSP · storage wide · storage nameplate · storage controller
- **solar+battery:** the union of the two
- **All types additionally require the Sales Order** (the "Invoice & BOM" slot), tracked via
  `soFound` rather than a photo assignment.

This depends on the `appliesTo` correction from PR #1076: shots 4 (all-electrical) and 5 (MSP),
currently mis-tagged SOLAR-only in `PE_M1_CHECKLIST`, are required on battery jobs too.
`requiredShotsFor` derives from the corrected `appliesTo`, so there is a single source of truth.

### Per-shot status (three states)

`computeCoverage(assignments, systemType, soFound): CoverageReport`

For each required shot, given the photos assigned to it:

- **Covered** ✅ — at least one photo with verdict `pass`.
- **Recheck** ⚠️ — one or more photos assigned, but all are `needs_review` (present, but the
  vision flagged legibility/partial framing — verify before submitting).
- **Missing** ❌ — zero photos assigned to that shot.

The Sales Order shows **Covered** if `soFound`, else **Missing**.

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
- **Upload cap** → soft cap ~60 photos / ~200 MB per submission; warn and ask the user to split if
  exceeded (also keeps vision triage within its token budget).

## Testing

- **Unit** (`src/lib/pe-photo-package`): `requiredShotsFor` per system type (incl. SO),
  `computeCoverage` (covered / recheck / missing / bonus, SO-missing), `policyPhotosFilename`.
- **Integration** (the two routes): mocked vision + Drive — triage returns a coverage map and
  per-photo tags; assemble produces a non-empty PDF and calls the Drive stage helper. Auth/role
  gating asserted.

## Out of scope (YAGNI)

- No direct upload to the PE portal (manual / read-only API) — download + Drive copy only.
- No persisted run history or audit of past packages.
- No no-code / standalone mode — the project code is required (drives system type + SO).
- No re-cropping/rotating photos in the UI (rotation is auto-normalized during assembly).
