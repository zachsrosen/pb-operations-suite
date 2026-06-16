# PE Photos-per-Policy Builder Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-serve web page in pbtechops.com where a user enters a project code, drops install photos, and gets back an AI-verified, labeled "Photos per Policy" PDF (SO embedded) plus a coverage report flagging missing/recheck required shots, staged to the deal's Drive.

**Architecture:** Two POST routes (`/triage`, `/assemble`) under `/api/pe/photo-package/`, a client page at `/dashboards/pe-photo-builder`, a new pure coverage module (`pe-photo-coverage.ts`), and a shared assembly module (`pe-photo-package.ts`) refactored out of the existing CLI script so the skill and the web routes share one code path. The browser re-submits files on assemble (no server-side temp store, since Vercel is stateless).

**Tech Stack:** Next.js 16 route handlers, React 19 client component, `pdf-lib` + `sharp` for PDF assembly, existing `triagePhotoBatch` (Anthropic vision), Drive helpers, Jest for tests.

**Spec:** `docs/superpowers/specs/2026-06-15-pe-photo-builder-design.md`

**Branch note:** This branch is stacked on `fix/pe-policy-photos-completeness` (PR #1076), which contains the fixed `orderPolicyPhotos` and captioned `appendImagePage`. The `appliesTo` correction for shots 4/5 is NOT in #1076 — it is Task 1 here.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/pe-turnover.ts` (modify) | Correct `appliesTo` for shots 4 (electrical) + 5 (MSP) → `ALL`. |
| `src/lib/pe-photo-coverage.ts` (NEW) | Pure: `requiredShotsFor(systemType)`, `computeCoverage(...)`, coverage types. No I/O. |
| `src/lib/pe-photo-package.ts` (NEW) | Shared I/O assembly: extract `appendImagePage`, `searchDealsByPeCode`, `resolveSourceFolderId`, `locateSalesOrderPdf`, `normalizeSystemType`, `buildFolderMap` usage, root-folder extraction; add `assemblePackage(...)` and a `resolveDealContext(code)` helper. |
| `scripts/pe-photo-submit.ts` (modify) | Import the extracted helpers from `@/lib/pe-photo-package` instead of defining them inline. No behavior change. |
| `src/app/api/pe/photo-package/upload-token/route.ts` (NEW) | POST: issue a Vercel Blob client-upload token (mirrors `bom/upload-token`). |
| `src/app/api/pe/photo-package/triage/route.ts` (NEW) | POST (JSON `{code, photos:[{clientId,name,blobUrl}]}`): resolve deal/systemType/SO, fetch blobs, screen+downscale+triage, return coverage + per-photo tags. |
| `src/app/api/pe/photo-package/assemble/route.ts` (NEW) | POST (JSON `{code, assignments:[{clientId,blobUrl,shotId}]}`): fetch full-res blobs, assemble PDF, stage to Drive, return PDF. |
| `src/app/dashboards/pe-photo-builder/page.tsx` (NEW) | Client page: code input, dropzone, triage call, coverage report, re-tag/drop, assemble + download. |
| `src/components/pe-builder/CoverageReport.tsx` (NEW) | Renders the three-state coverage report + SO row. |
| `src/components/pe-builder/PhotoChip.tsx` (NEW) | Per-photo thumbnail + shot dropdown + drop control. |
| `src/lib/roles.ts` (modify) | Add `/dashboards/pe-photo-builder` + `/api/pe/photo-package` to ADMIN(*), OWNER, PROJECT_MANAGER, ACCOUNTING, SALES_MANAGER. |
| `src/app/suites/accounting/page.tsx` (modify) | Add a builder card. |
| `src/app/suites/operations/page.tsx` (modify) | Add a builder card (PM landing surface). |
| `src/__tests__/lib/pe-photo-coverage.test.ts` (NEW) | Unit tests for the pure module. |
| `src/__tests__/api/pe-photo-package.test.ts` (NEW) | Integration tests for both routes (mocked vision + Drive). |

---

## Chunk 1: Pure logic + shared refactor

### Task 1: Correct `appliesTo` for electrical + MSP shots

PE shots 4 (all-electrical) and 5 (MSP) are required on battery jobs too, but are mis-tagged `SOLAR` in the checklist. This is the single source of truth `requiredShotsFor` will read.

**Files:**
- Modify: `src/lib/pe-turnover.ts` (the two photo items `m1.photos.4_electrical`, `m1.photos.5_msp`)
- Test: `src/__tests__/lib/pe-photo-coverage.test.ts` (added in Task 2 — this task is verified via that suite)

- [ ] **Step 1: Locate the two items.** Run `grep -n "m1.photos.4_electrical\|m1.photos.5_msp" src/lib/pe-turnover.ts`. Each item has an `appliesTo:` line a few lines below the `id:`.

- [ ] **Step 2: Change both `appliesTo: SOLAR` → `appliesTo: ALL`** for those two items only. Leave shots 2, 3, 7, 8 (`SOLAR`) and 9, 10, 11 (`STORAGE`) unchanged. The `ALL`/`SOLAR`/`STORAGE` constants are defined near line 142.

- [ ] **Step 3: Verify nothing else regressed.** Run `npx jest pe-photo-submit` (the existing CLI unit tests). Expected: still green (those tests mock `pe-turnover` with their own checklist, so they are unaffected — this confirms no import breakage).

- [ ] **Step 4: Typecheck.** Run `npx tsc --noEmit -p tsconfig.json 2>&1 | grep pe-turnover || echo clean`. Expected: `clean`.

- [ ] **Step 5: Commit.**
```bash
git add src/lib/pe-turnover.ts
git commit -m "fix(pe): electrical + MSP shots apply to all system types, not solar-only"
```

---

### Task 2: Pure coverage module

**Files:**
- Create: `src/lib/pe-photo-coverage.ts`
- Test: `src/__tests__/lib/pe-photo-coverage.test.ts`

Background types (already in the codebase):
- `SystemType = "solar" | "battery" | "solar+battery"` (`@/lib/pe-turnover`)
- `PE_M1_CHECKLIST: ChecklistItem[]`, each with `{ id, label, isPhoto, appliesTo, pePhotoNumber }` (`@/lib/pe-turnover`)
- `triagePhotoBatch(photos, photoItems)` returns `{ assignments: Map<number, { checklistId, verdict: "pass"|"fail"|"needs_review", confidence, issues: string[], equipmentVisible: string[] }> }` — **keyed by input photo index**, and photos the vision couldn't match are **absent** from the Map. The route (Task 5) converts this Map into the flat `Assignment[]` that `computeCoverage` consumes; this pure module only deals with the already-flattened array.

- [ ] **Step 1: Write the failing test** (`src/__tests__/lib/pe-photo-coverage.test.ts`). Mock `@/lib/pe-turnover` exactly like `src/__tests__/pe-photo-submit.test.ts` does (the 11-item photo checklist with corrected `appliesTo`: shots 4 and 5 = ALL), so the suite runs without Prisma.

```typescript
jest.mock("@/lib/pe-turnover", () => {
  const ALL = ["solar", "battery", "solar+battery"];
  const SOLAR = ["solar", "solar+battery"];
  const STORAGE = ["battery", "solar+battery"];
  const PE_M1_CHECKLIST = [
    { id: "m1.photos.1_site_address", label: "Site address + home", isPhoto: true, appliesTo: ALL },
    { id: "m1.photos.2_pv_array", label: "Wide-angle PV array", isPhoto: true, appliesTo: SOLAR },
    { id: "m1.photos.3_module_nameplate", label: "Module nameplate label", isPhoto: true, appliesTo: SOLAR },
    { id: "m1.photos.4_electrical", label: "Wide-angle all electrical", isPhoto: true, appliesTo: ALL },
    { id: "m1.photos.5_msp", label: "Main service panel (cover off)", isPhoto: true, appliesTo: ALL },
    { id: "m1.photos.6_invoice_bom", label: "Invoice & BOM", isPhoto: true, appliesTo: ALL },
    { id: "m1.photos.7_inverter", label: "Inverter/micro/optimizer model", isPhoto: true, appliesTo: SOLAR },
    { id: "m1.photos.8_racking", label: "Racking parts + markings", isPhoto: true, appliesTo: SOLAR },
    { id: "m1.photos.9_storage_wide", label: "Storage wide angle", isPhoto: true, appliesTo: STORAGE },
    { id: "m1.photos.10_storage_nameplate", label: "Storage nameplate & labels", isPhoto: true, appliesTo: STORAGE },
    { id: "m1.photos.11_storage_controller", label: "Storage controller/disconnect", isPhoto: true, appliesTo: STORAGE },
  ];
  return { PE_M1_CHECKLIST };
});

import { requiredShotsFor, computeCoverage } from "@/lib/pe-photo-coverage";

describe("requiredShotsFor", () => {
  it("solar = site, pv, module, electrical, msp, inverter, racking (no SO, no storage)", () => {
    expect(requiredShotsFor("solar").map((s) => s.id)).toEqual([
      "m1.photos.1_site_address", "m1.photos.2_pv_array", "m1.photos.3_module_nameplate",
      "m1.photos.4_electrical", "m1.photos.5_msp", "m1.photos.7_inverter", "m1.photos.8_racking",
    ]);
  });
  it("battery = site, electrical, msp, storage wide/nameplate/controller (no solar shots)", () => {
    expect(requiredShotsFor("battery").map((s) => s.id)).toEqual([
      "m1.photos.1_site_address", "m1.photos.4_electrical", "m1.photos.5_msp",
      "m1.photos.9_storage_wide", "m1.photos.10_storage_nameplate", "m1.photos.11_storage_controller",
    ]);
  });
  it("solar+battery = union of both", () => {
    expect(requiredShotsFor("solar+battery").map((s) => s.id)).toContain("m1.photos.2_pv_array");
    expect(requiredShotsFor("solar+battery").map((s) => s.id)).toContain("m1.photos.9_storage_wide");
  });
  it("excludes the invoice_bom shot from photo shots (tracked separately as SO)", () => {
    expect(requiredShotsFor("battery").map((s) => s.id)).not.toContain("m1.photos.6_invoice_bom");
  });
});

describe("computeCoverage", () => {
  const A = (checklistId: string, verdict = "pass") => ({ checklistId, verdict, issues: [], equipmentVisible: [] });

  it("marks a shot covered when it has a pass", () => {
    const r = computeCoverage([A("m1.photos.1_site_address")], "battery", true);
    expect(r.shots.find((s) => s.id === "m1.photos.1_site_address")!.status).toBe("covered");
  });
  it("marks a shot recheck when only needs_review", () => {
    const r = computeCoverage([A("m1.photos.4_electrical", "needs_review")], "battery", true);
    expect(r.shots.find((s) => s.id === "m1.photos.4_electrical")!.status).toBe("recheck");
  });
  it("marks a shot missing when no photo assigned", () => {
    const r = computeCoverage([], "battery", true);
    expect(r.shots.find((s) => s.id === "m1.photos.5_msp")!.status).toBe("missing");
  });
  it("ignores fail-verdict photos for coverage", () => {
    const r = computeCoverage([A("m1.photos.5_msp", "fail")], "battery", true);
    expect(r.shots.find((s) => s.id === "m1.photos.5_msp")!.status).toBe("missing");
  });
  it("SO row reflects soFound", () => {
    expect(computeCoverage([], "battery", true).salesOrder).toBe("covered");
    expect(computeCoverage([], "battery", false).salesOrder).toBe("missing");
  });
  it("lists non-required matched shots as bonus", () => {
    const r = computeCoverage([A("m1.photos.2_pv_array")], "battery", true); // PV on a battery job
    expect(r.bonus.map((b) => b.id)).toContain("m1.photos.2_pv_array");
  });
  it("complete flag true only when no missing required shots and SO present", () => {
    const full = requiredShotsFor("battery").map((s) => A(s.id));
    expect(computeCoverage(full, "battery", true).complete).toBe(true);
    expect(computeCoverage(full, "battery", false).complete).toBe(false); // SO missing
  });
});
```

- [ ] **Step 2: Run it; verify it fails.** `npx jest pe-photo-coverage` → FAIL ("Cannot find module '@/lib/pe-photo-coverage'").

- [ ] **Step 3: Implement `src/lib/pe-photo-coverage.ts`.**

```typescript
/**
 * Pure coverage logic for the PE Photos-per-Policy package. No I/O.
 * `requiredShotsFor` derives from PE_M1_CHECKLIST.appliesTo (single source of
 * truth); the Sales Order (invoice_bom slot) is tracked separately via soFound.
 */
import { PE_M1_CHECKLIST, type SystemType } from "@/lib/pe-turnover";

export interface RequiredShot { id: string; label: string; pePhotoNumber?: number; }
export type ShotStatus = "covered" | "recheck" | "missing";
export interface ShotCoverage extends RequiredShot { status: ShotStatus; count: number; }
export interface CoverageReport {
  systemType: SystemType;
  shots: ShotCoverage[];
  salesOrder: "covered" | "missing";
  bonus: RequiredShot[];
  complete: boolean;
}

// The invoice/BOM shot is the Sales Order — never counted as a photo shot.
const SO_SHOT_ID = "m1.photos.6_invoice_bom";

export function requiredShotsFor(systemType: SystemType): RequiredShot[] {
  return PE_M1_CHECKLIST
    .filter((i) => i.isPhoto && i.id !== SO_SHOT_ID && i.appliesTo.includes(systemType))
    .map((i) => ({ id: i.id, label: i.label, pePhotoNumber: i.pePhotoNumber }));
}

interface Assignment { checklistId: string; verdict: "pass" | "fail" | "needs_review"; }

export function computeCoverage(
  assignments: Assignment[],
  systemType: SystemType,
  soFound: boolean,
): CoverageReport {
  const required = requiredShotsFor(systemType);
  const requiredIds = new Set(required.map((s) => s.id));

  // Group non-fail assignments by shot.
  const byShot = new Map<string, Assignment[]>();
  for (const a of assignments) {
    if (a.verdict === "fail") continue;
    if (!byShot.has(a.checklistId)) byShot.set(a.checklistId, []);
    byShot.get(a.checklistId)!.push(a);
  }

  const shots: ShotCoverage[] = required.map((s) => {
    const matched = byShot.get(s.id) ?? [];
    const status: ShotStatus = matched.length === 0
      ? "missing"
      : matched.some((a) => a.verdict === "pass") ? "covered" : "recheck";
    return { ...s, status, count: matched.length };
  });

  // Bonus = matched real photo shots that aren't required for this system type
  // and aren't the SO slot.
  const photoShotIds = new Set(PE_M1_CHECKLIST.filter((i) => i.isPhoto && i.id !== SO_SHOT_ID).map((i) => i.id));
  const labelById = new Map(PE_M1_CHECKLIST.map((i) => [i.id, i.label]));
  const bonus: RequiredShot[] = [...byShot.keys()]
    .filter((id) => photoShotIds.has(id) && !requiredIds.has(id))
    .map((id) => ({ id, label: labelById.get(id) ?? id }));

  const salesOrder = soFound ? "covered" : "missing";
  const complete = shots.every((s) => s.status !== "missing") && soFound;
  return { systemType, shots, salesOrder, bonus, complete };
}
```

- [ ] **Step 4: Run it; verify it passes.** `npx jest pe-photo-coverage` → PASS (all cases).

- [ ] **Step 5: Typecheck.** `npx tsc --noEmit -p tsconfig.json 2>&1 | grep pe-photo-coverage || echo clean` → `clean`.

- [ ] **Step 6: Commit.**
```bash
git add src/lib/pe-photo-coverage.ts src/__tests__/lib/pe-photo-coverage.test.ts
git commit -m "feat(pe): pure coverage module — requiredShotsFor + computeCoverage"
```

---

### Task 3: Extract shared assembly into `pe-photo-package.ts`

Refactor — move reusable helpers out of the CLI script so both the script and the new routes import them. No behavior change; the existing `pe-photo-submit` tests must stay green.

**Files:**
- Create: `src/lib/pe-photo-package.ts`
- Modify: `scripts/pe-photo-submit.ts` (import the moved helpers instead of defining them)

- [ ] **Step 1: Locate exact lines** with `grep -n "function normalizeSystemType\|function searchDealsByPeCode\|function resolveSourceFolderId\|function locateSalesOrderPdf\|function appendImagePage\|DealSearchResult" scripts/pe-photo-submit.ts` (line numbers drift; don't trust the approximations below).

- [ ] **Step 2: Create `src/lib/pe-photo-package.ts`** and move these verbatim from `scripts/pe-photo-submit.ts` (adjusting imports to absolute `@/lib/...`):
  - `normalizeSystemType`
  - `DealSearchResult` interface + `searchDealsByPeCode`
  - `resolveSourceFolderId`
  - `locateSalesOrderPdf`
  - `appendImagePage` (the captioned version, `(doc, img, caption?, font?)`)
  - `UsableImage` interface if referenced by the moved code.
  Also add a new exported helper **`resolveDealContext(code: string)`** that encapsulates the full folder chain the route needs (today inline in `processProject`): search the deal (`searchDealsByPeCode`), pick by address (`pickDealByAddress` from `@/lib/pe-photo-submit`) returning candidates on ambiguity, extract the root folder from `all_document_parent_folder_id ?? g_drive` via `extractFolderId`, call `buildFolderMap(rootFolderId)` (from `@/lib/pe-turnover`), then `resolveSourceFolderId(props, folderMap.byPrefix, "policy-photos")`, and `locateSalesOrderPdf(rootFolderId)`. Return `{ deal, systemType?, rootFolderId, sourceFolderId, soBuffer, ambiguous?, candidates? }`. Keep dependencies (`searchWithRetry`, `extractFolderId`, `buildFolderMap`, Drive helpers, `sharp`, `pdf-lib`, `DOC_CONFIGS`).

- [ ] **Step 3: Update `scripts/pe-photo-submit.ts`** to delete the moved definitions and `import { normalizeSystemType, searchDealsByPeCode, resolveSourceFolderId, locateSalesOrderPdf, appendImagePage } from "@/lib/pe-photo-package";`. Leave `processProject`/`main` in the script (it may keep its inline chain or adopt `resolveDealContext` — either is fine as long as behavior is unchanged).

- [ ] **Step 4: Fix the stale test mock** so both PE test files agree with production: in `src/__tests__/pe-photo-submit.test.ts`, change the mocked `m1.photos.4_electrical` and `m1.photos.5_msp` `appliesTo` from `SOLAR` to `ALL` (matching Task 1). Update any test expectation that depended on the old solar-only filtering.

- [ ] **Step 5: Run the existing CLI tests.** `npx jest pe-photo-submit` → PASS (**21** tests). They import `@/lib/pe-photo-submit` (not the script), so add a one-line import smoke to actually exercise the refactor: `node --import tsx -e 'import("./scripts/pe-photo-submit.ts").catch(e=>{if(!/Pass --doc/.test(e.message)){console.error(e);process.exit(1)}})'` → exits 0 (the script's `main` throws the expected "Pass --doc" arg error, proving its imports resolve).

- [ ] **Step 6: Typecheck.** `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "pe-photo-package|pe-photo-submit" || echo clean` → `clean`.

- [ ] **Step 7: Commit.**
```bash
git add src/lib/pe-photo-package.ts scripts/pe-photo-submit.ts src/__tests__/pe-photo-submit.test.ts
git commit -m "refactor(pe): extract shared assembly helpers into lib/pe-photo-package"
```

---

## Chunk 2: API routes, page, access

### Task 4: `assemblePackage` helper (shared, testable core of both routes)

Add a single function that turns a deal code + an ordered list of `{ buffer, caption }` photos into a PDF with the SO embedded — used by `/assemble`. Keep it in `pe-photo-package.ts`.

**Files:**
- Modify: `src/lib/pe-photo-package.ts`
- Test: covered by the route integration test in Task 6 (this is thin glue over already-tested helpers).

- [ ] **Step 1: Add `assemblePackage`.**
```typescript
import { PDFDocument, StandardFonts } from "pdf-lib";

export interface PackagePhoto { buffer: Buffer; caption: string; }

/** Build the labeled PDF, embedding `soBuffer` (if present) at `soInsertIndex`. */
export async function assemblePackage(
  photos: PackagePhoto[],
  soBuffer: Buffer | null,
  soInsertIndex: number,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const embedSO = async () => {
    if (!soBuffer) return;
    const so = await PDFDocument.load(soBuffer, { ignoreEncryption: true });
    const copied = await pdf.copyPages(so, so.getPageIndices());
    copied.forEach((p) => pdf.addPage(p));
  };
  for (let i = 0; i < photos.length; i++) {
    if (i === soInsertIndex) await embedSO();           // before page i — matches the CLI
    await appendImagePage(pdf, photos[i].buffer, photos[i].caption, font);
  }
  if (soInsertIndex >= photos.length) await embedSO();  // SO ranks at/after every photo
  return pdf.save();
}
```

`soInsertIndex` is the index of the first photo that ranks **after** the invoice/BOM slot — identical to the CLI's `soInsertIndex` semantics (`scripts/pe-photo-submit.ts`, the `embedSalesOrder` call inside the assembly loop). The `/assemble` route computes it the same way the CLI does (count of kept photos whose shot rank is `< invoice_bom` rank).

- [ ] **Step 2: Typecheck.** `npx tsc --noEmit -p tsconfig.json 2>&1 | grep pe-photo-package || echo clean` → `clean`.
- [ ] **Step 3: Commit.**
```bash
git add src/lib/pe-photo-package.ts
git commit -m "feat(pe): assemblePackage helper for PDF + SO embed"
```

### Task 5: `/triage` route

**Files:**
- Create: `src/app/api/pe/photo-package/triage/route.ts`
- Test: `src/__tests__/api/pe-photo-package.test.ts` (shared with Task 6)

Top of file: `export const runtime = "nodejs";` and `export const maxDuration = 300;` (vision is slow). Add the route to `vercel.json` `functions` if that file enumerates per-route durations (check; the existing entries use `maxDuration: 300`).

Contract:
- Request JSON: `{ code: string, photos: [{ clientId: string, name: string, blobUrl: string }] }`.
- Response 200: `{ systemType, soFound, coverage: CoverageReport, photos: [{ clientId, name, shot, verdict, issues, equipmentVisible }] }`. A photo absent from the triage Map gets `shot: null, verdict: "needs_review"` with an `issues: ["unmatched — vision could not assign a shot"]`.
- Errors: 400 (no code / no photos), 401 (unauthenticated — from `requireApiAuth`), 404 (no deal), 409 (ambiguous deal → `{ error, candidates: [{id,address}] }`), 502 (vision failure after retry). **No in-handler role check** — route-level authorization is enforced by middleware via the Task 7 `roles.ts` allowlist (`requireApiAuth` only authenticates).

- [ ] **Step 1: Write the failing integration test** in `src/__tests__/api/pe-photo-package.test.ts`. Mock `@/lib/api-auth` (`requireApiAuth` → `{ email: "x@photonbrothers.com", name: "X", role: "ACCOUNTING", roles: ["ACCOUNTING"], ip: "", userAgent: "" }`), `@/lib/pe-api` (`listAllProjects` → one battery project `projectId: "CO9999-TEST1"`, `assets.systemType: "Storage Only"`), `@/lib/pe-photo-package` (`resolveDealContext` → `{ deal, rootFolderId: "root", sourceFolderId: "src", soBuffer: <tiny PDF buffer>, ambiguous: false }`), `@vercel/blob` or global `fetch` for the blob fetch (→ a small PNG buffer), and `@/lib/pe-vision-classifier` (`uploadToAnthropic` → "fid"; `triagePhotoBatch` → `{ assignments: new Map([[0, { checklistId: "m1.photos.1_site_address", verdict: "pass", confidence: "high", issues: [], equipmentVisible: [] }]]) }` — `confidence` is `"high"|"medium"|"low"`, not a number). Mock **global `fetch`** for blob retrieval (the routes fetch blob URLs directly, not via the Blob SDK). POST JSON `{ code: "CO9999-TEST1", photos: [{ clientId: "c1", name: "a.png", blobUrl: "https://blob/a.png" }] }`. Assert 200, `systemType==="battery"`, the site shot `covered`, `m1.photos.5_msp` `missing`, and `soFound===true`.

- [ ] **Step 2: Run it; verify it fails.** `npx jest pe-photo-package` → FAIL (route module not found).

- [ ] **Step 3: Implement the route.**
  - `const auth = await requireApiAuth(); if (auth instanceof NextResponse) return auth;` (authentication only — authorization is middleware's job).
  - Parse JSON body; 400 if `code` or `photos` empty.
  - `const project = (await listAllProjects()).find(p => p.projectId === code);` 404 if none. `const systemType = normalizeSystemType(project.assets.systemType);`
  - `const ctx = await resolveDealContext(code);` — if `ctx.ambiguous` return 409 with `ctx.candidates`; if no deal return 404. `const soFound = !!ctx.soBuffer;`
  - For each `photos[i]`: `fetch(blobUrl)` → `Buffer.from(await res.arrayBuffer())`; `sharp(buf).metadata()` → `isUsableImage(w,h)` (skip + flag if not); downscale a copy `sharp(buf).resize({width:2000,height:2000,fit:"inside",withoutEnlargement:true}).jpeg({quality:85})`; `uploadToAnthropic(...)`. Keep an `inputs[]` array parallel to a `usable[]` array (preserving index↔clientId).
  - `const { assignments } = await triagePhotoBatch(inputs, PE_M1_CHECKLIST.filter(i=>i.isPhoto));`
  - **Convert the Map → per-photo results:** iterate `usable` by index `i`; look up `assignments.get(i)`; if present, emit `{ clientId, name, shot: a.checklistId, verdict: a.verdict, issues: a.issues, equipmentVisible: a.equipmentVisible }`; if absent, emit the `shot: null` unmatched record. Build the flat `Assignment[]` (only entries present in the Map) for coverage.
  - `const coverage = computeCoverage(flatAssignments, systemType, soFound);`
  - Return `{ systemType, soFound, coverage, photos }`.

- [ ] **Step 4: Run it; verify it passes.** `npx jest pe-photo-package` → PASS.
- [ ] **Step 5: Typecheck.** grep clean for the route file.
- [ ] **Step 6: Commit.** `feat(pe): /api/pe/photo-package/triage route`.

### Task 6: `/assemble` route

**Files:**
- Create: `src/app/api/pe/photo-package/assemble/route.ts`
- Test: extend `src/__tests__/api/pe-photo-package.test.ts`

Top of file: `export const runtime = "nodejs";` and `export const maxDuration = 300;`.

Contract:
- Request JSON: `{ code: string, assignments: [{ clientId: string, blobUrl: string, shotId: string | null }] }` (null `shotId` = dropped).
- Behavior: keep only entries with a non-null `shotId`; fetch each blob (full-res, for the PDF); an entry whose blob fetch fails is skipped and recorded as a warning (never a 500). Order kept photos by canonical PE sequence (`orderPolicyPhotos` against the `PE_M1_CHECKLIST` photo shots); caption each `"<pePhotoNumber> — <label>"`; resolve SO via `resolveDealContext(code)`; `assemblePackage(...)` with the SO slotted at the invoice rank; stage to Drive (`findOrCreatePeFolder` + `uploadDriveBinaryFile`); respond with the PDF (`application/pdf`, `Content-Disposition: attachment; filename="<policyPhotosFilename>"`) and an `X-PE-Warnings` header (JSON) for any skips/Drive-staging failures.
- Auth: `requireApiAuth()` (authentication only; authorization via middleware/roles.ts — same as triage).

- [ ] **Step 1: Write the failing test.** Same mocks as Task 5 plus `@/lib/drive-plansets` `uploadDriveBinaryFile`/`@/lib/pe-audit-orchestrator` `findOrCreatePeFolder` mocked, and `fetch`→PNG buffer. POST JSON `{ code:"CO9999-TEST1", assignments:[{clientId:"c1", blobUrl:"https://blob/a.png", shotId:"m1.photos.1_site_address"}] }`. Assert 200, `content-type: application/pdf`, body length > 0, and that the Drive stage helper was called once.

- [ ] **Step 2: Run; verify fail.** `npx jest pe-photo-package` → FAIL.

- [ ] **Step 3: Implement the route.** Auth (authentication only). Parse JSON; filter to kept assignments (`shotId !== null`). For each, `fetch(blobUrl)` → buffer (full-res, NOT downscaled — this is the PDF); on fetch failure push a warning and skip. Build `ClassifiedPhoto[] = { fileId: clientId, shotId }` and order via `orderPolicyPhotos(classified)`; map ordered → `{ buffer, caption }` using a `clientId → buffer` map and `"<pePhotoNumber> — <label>"` captions (label/number from `PE_M1_CHECKLIST`). Compute `soInsertIndex` = count of kept photos whose shot rank `< m1.photos.6_invoice_bom` rank (same as the CLI). `const so = (await resolveDealContext(code)).soBuffer;` then `const bytes = await assemblePackage(packagePhotos, so, soInsertIndex);`. Stage to Drive in try/catch (failure → warning, not a 500). Return `new NextResponse(Buffer.from(bytes), { headers: { "content-type":"application/pdf", "content-disposition":`attachment; filename="${policyPhotosFilename(addr)}"`, "x-pe-warnings": JSON.stringify(warnings) } })`. `policyPhotosFilename` + `orderPolicyPhotos` from `@/lib/pe-photo-submit`.

- [ ] **Step 4: Run; verify pass.** `npx jest pe-photo-package` → PASS.
- [ ] **Step 5: Typecheck** grep clean.
- [ ] **Step 6: Commit.** `feat(pe): /api/pe/photo-package/assemble route`.

### Task 7: Blob upload-token route + role allowlist + suite cards

**Files:**
- Create: `src/app/api/pe/photo-package/upload-token/route.ts`
- Modify: `src/lib/roles.ts`, `src/app/suites/accounting/page.tsx`, `src/app/suites/operations/page.tsx`

- [ ] **Step 1: Upload-token route.** Copy the structure of `src/app/api/bom/upload-token/route.ts` verbatim, changing only: the allowed-roles set to `{ADMIN, OWNER, PROJECT_MANAGER, ACCOUNTING, SALES_MANAGER}`, the activity-log `requestPath`/`entityName` to `pe_photo_package`, and the token's `pathname` prefix to `pe-photo-package/<code>/<clientId>-<name>`. It must: `requireApiAuth()`; 403 if role not allowed; 503 if `!process.env.BLOB_READ_WRITE_TOKEN`; return `generateClientTokenFromReadWriteToken(...)` with `addRandomSuffix: false`. (The client calls this implicitly via `@vercel/blob/client` `upload()`.)

- [ ] **Step 2: Roles.** In `src/lib/roles.ts`, add `"/dashboards/pe-photo-builder"` and `"/api/pe/photo-package"` to `allowedRoutes` for OWNER, PROJECT_MANAGER, ACCOUNTING, SALES_MANAGER (ADMIN is `["*"]`, no change). The single `/api/pe/photo-package` prefix covers `upload-token`, `triage`, and `assemble`. Match the existing string-array style (see ACCOUNTING ~lines 1491–1517). Note `BLOB_READ_WRITE_TOKEN` must be set in the env (it already is — used by `bom/upload-token`).

- [ ] **Step 3: Accounting card.** Add to the `LINKS` array in `src/app/suites/accounting/page.tsx`:
```typescript
{ href: "/dashboards/pe-photo-builder", title: "PE Photo Builder",
  description: "Drop install photos + enter a project code to build a labeled Photos-per-Policy PDF and flag missing shots.",
  tag: "PE", icon: "📸", section: "Tools" },
```

- [ ] **Step 4: Operations card.** Add the same card object to the `BASE_LINKS` array in `src/app/suites/operations/page.tsx` (section `"Tools"` or the nearest existing section).

- [ ] **Step 5: Typecheck.** `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "roles|suites/accounting|suites/operations" || echo clean` → `clean`.
- [ ] **Step 6: Commit.** `feat(pe): route allowlist + suite cards for PE photo builder`.

### Task 8: The builder page + components

**Files:**
- Create: `src/app/dashboards/pe-photo-builder/page.tsx`, `src/components/pe-builder/CoverageReport.tsx`, `src/components/pe-builder/PhotoChip.tsx`

- [ ] **Step 1: `PhotoChip.tsx`** — a client component: props `{ photo: {clientId, name, shot, verdict, issues}, objectUrl, shotOptions, onRetag, onDrop }`. Renders the thumbnail (`<img src={objectUrl}>`), the current shot label with verdict color (pass=green, needs_review=amber, fail=red), a `<select>` of shot options + "Not a PE shot (drop)", and a remove button. No data fetching.

- [ ] **Step 2: `CoverageReport.tsx`** — props `{ coverage: CoverageReport }`. Renders the SO row (distinct, no re-tag), then each required shot with a status pill (✅ Covered / ⚠️ Recheck / ❌ Missing) and count, then a "Bonus" list. Pure presentational.

- [ ] **Step 3: `page.tsx`** — `"use client"`, wrapped in `<DashboardShell title="PE Photo Builder" accentColor="emerald">`. State: `code`, `files: { clientId, file, objectUrl, blobUrl?, uploading }[]`, `triage` result, `assignments` (editable map of `clientId → shotId | null`), `loading`, `error`. Flow:
  - Code input + dropzone. On drop, enforce a **count** cap (≤60 files, else inline warning), generate a `clientId` + `URL.createObjectURL` per file, then upload each directly to Blob via `import { upload } from "@vercel/blob/client"`: `await upload(`pe-photo-package/${code}/${clientId}-${file.name}`, file, { access: "public", handleUploadUrl: "/api/pe/photo-package/upload-token" })` → store the returned `url` as `blobUrl`. Show per-file upload progress.
  - "Check coverage" → `POST /api/pe/photo-package/triage` with JSON `{ code, photos: files.map(f => ({ clientId, name, blobUrl })) }`. On 409 show candidate picker; on 404 show "no deal."
  - Render `<CoverageReport>` + a grid of `<PhotoChip>` (thumbnail from `objectUrl`); retag/drop edits `assignments`.
  - "Build PDF" → `POST /api/pe/photo-package/assemble` with JSON `{ code, assignments: files.map(f => ({ clientId, blobUrl, shotId: assignments[f.clientId] ?? <triage shot> })) }`; receive the PDF blob; `URL.createObjectURL` → trigger download; surface `X-PE-Warnings`.
  - Revoke object URLs on unmount.

- [ ] **Step 4: Typecheck.** `npx tsc --noEmit -p tsconfig.json 2>&1 | grep pe-photo-builder || echo clean` → `clean`.

- [ ] **Step 5: Lint.** `npx eslint src/app/dashboards/pe-photo-builder src/components/pe-builder` → no errors.

- [ ] **Step 6: Preview-verify.** With the dev server running, load `/dashboards/pe-photo-builder`, confirm the page renders without console errors (use the preview tools; this is a UI page so verification applies). A full end-to-end upload needs live HubSpot/Drive/Anthropic, so verify render + form wiring only; note that full E2E is validated manually against a real deal.

- [ ] **Step 7: Commit.** `feat(pe): PE photo builder page + coverage/chip components`.

---

## Final verification (after all tasks)

- [ ] `npx jest pe-photo` → all PE suites green.
- [ ] `npx tsc --noEmit -p tsconfig.json` → no NEW errors in touched files (pre-existing unrelated test-file errors may remain).
- [ ] `npx eslint src/app/api/pe/photo-package src/app/dashboards/pe-photo-builder src/lib/pe-photo-coverage.ts src/lib/pe-photo-package.ts` → clean.
- [ ] Dispatch final code-review subagent over the whole branch diff.
- [ ] Use superpowers:finishing-a-development-branch (PR, stacked on #1076).
