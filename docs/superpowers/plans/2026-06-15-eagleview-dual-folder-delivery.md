# EagleView Dual-Folder Delivery + Dashboard RID Links Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** File auto-pulled EagleView TrueDesign reports into a deal's Site Survey folder in addition to Design Documents, and add two RID-derived EagleView links to each order card on the dashboard.

**Architecture:** Track A touches only the delivery step. A new `findSiteSurveyFolder` helper lives in `drive-plansets.ts` (reusing the existing site-survey pattern set, promoted there as the canonical home). `eagleview-pipeline-deps.ts` resolves the survey folder's direct ID and injects `findSiteSurveyFolder` into `PipelineDeps`; `fetchAndStoreDeliverables` resolves a deduped list of Design + Site Survey targets, downloads each file once, and uploads to every target with graceful degradation. Track B adds a pure `eagleview-links` URL helper and renders two `<a>` tags in the orders client.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Jest + @testing-library/react, Google Drive REST v3, HubSpot CRM.

**Spec:** `docs/superpowers/specs/2026-06-15-eagleview-dual-folder-delivery-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `src/lib/drive-plansets.ts` | Add exported `SITE_SURVEY_FOLDER_PATTERNS` + `findSiteSurveyFolder()` (self-tokening, swallows list errors) |
| Modify | `src/lib/checks/site-survey-readiness.ts` | Import shared `SITE_SURVEY_FOLDER_PATTERNS`; delete local copy |
| Modify | `src/lib/eagleview-pipeline.ts` | Add `driveSiteSurveyFolderId` to `DealAddressFields`; add `findSiteSurveyFolder` to `PipelineDeps`; dual-folder `fetchAndStoreDeliverables`; update order-time note wording |
| Modify | `src/lib/eagleview-pipeline-deps.ts` | Fetch `site_survey_documents`; populate `driveSiteSurveyFolderId` via `extractFolderId`; wire `findSiteSurveyFolder` |
| Create | `src/lib/eagleview-links.ts` | Pure `eagleViewLinks(reportId)` URL builder |
| Modify | `src/app/dashboards/eagleview-orders/EagleViewOrdersClient.tsx` | Render "Open in TrueDesign" + "View EagleView Order" links |
| Modify | `src/__tests__/eagleview-pipeline.test.ts` | Fixture updates + dual-folder delivery test cases |
| Modify | `src/__tests__/drive-plansets.test.ts` (create if absent) | `SITE_SURVEY_FOLDER_PATTERNS` matching tests |
| Create | `src/__tests__/eagleview-links.test.ts` | URL helper tests |

---

## Chunk 1: Survey-folder helper + pattern reuse

### Task 1: `findSiteSurveyFolder` in drive-plansets + pattern reuse

**Files:**
- Modify: `src/lib/drive-plansets.ts` (add after `listDriveSubfolders`, ~line 677)
- Modify: `src/lib/checks/site-survey-readiness.ts:168-173`
- Test: `src/__tests__/drive-plansets.test.ts`

- [ ] **Step 1: Write the failing pattern test**

Check whether `src/__tests__/drive-plansets.test.ts` exists. If it does, append; if not, create it with this content:

```typescript
import { SITE_SURVEY_FOLDER_PATTERNS } from "@/lib/drive-plansets";

describe("SITE_SURVEY_FOLDER_PATTERNS", () => {
  const matches = (name: string) =>
    SITE_SURVEY_FOLDER_PATTERNS.some((p) => p.test(name));

  it.each([
    "Site Survey",
    "1. Site Survey",
    "Site Survey - CA",
    "site survey",
    "SiteSurvey",
    "SS",
  ])("matches %s", (name) => {
    expect(matches(name)).toBe(true);
  });

  it.each(["Design", "Stamped Plans", "2. Design", "DA", "Construction"])(
    "does not match %s",
    (name) => {
      expect(matches(name)).toBe(false);
    },
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --no-coverage src/__tests__/drive-plansets.test.ts`
Expected: FAIL — `SITE_SURVEY_FOLDER_PATTERNS` is not exported from `@/lib/drive-plansets`.

- [ ] **Step 3: Add the pattern constant + helper to `drive-plansets.ts`**

Insert immediately after `listDriveSubfolders` (after its closing brace, ~line 677):

```typescript
/** Site survey subfolder patterns (canonical home; imported by site-survey-readiness.ts). */
export const SITE_SURVEY_FOLDER_PATTERNS = [
  /site\s*survey/i,
  /^1\.\s*site\s*survey$/i,
  /^ss$/i,
];

/**
 * Look for a "Site Survey" subfolder inside the given parent folder.
 * Matches names like "1. Site Survey", "Site Survey - CA", "SS".
 * Returns the subfolder ID if found, null otherwise.
 *
 * NOTE: listDriveSubfolders throws on a non-OK Drive response, so the call is
 * wrapped in `.catch(() => [])` — this helper must never throw, so the
 * EagleView delivery path can degrade to "Design only" instead of failing.
 */
export async function findSiteSurveyFolder(parentFolderId: string): Promise<string | null> {
  const subfolders = await listDriveSubfolders(parentFolderId).catch(() => []);
  const match = subfolders.find((f) =>
    SITE_SURVEY_FOLDER_PATTERNS.some((p) => p.test(f.name)),
  );
  return match?.id ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --no-coverage src/__tests__/drive-plansets.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `site-survey-readiness.ts` to import the shared patterns**

In `src/lib/checks/site-survey-readiness.ts`, delete the local block (lines ~168-173):

```typescript
/** Site survey subfolder patterns. */
const SITE_SURVEY_FOLDER_PATTERNS = [
  /site\s*survey/i,
  /^1\.\s*site\s*survey$/i,
  /^ss$/i,
];
```

Then add the import to the existing `drive-plansets` import (the file already imports `extractFolderId` and others from there — extend that import; do NOT add a second import line). If no existing `drive-plansets` import is present, add:

```typescript
import { SITE_SURVEY_FOLDER_PATTERNS } from "@/lib/drive-plansets";
```

`resolveSurveyFolderId` is otherwise unchanged.

- [ ] **Step 6: Verify site-survey-readiness still type-checks and its tests pass**

Run: `npx tsc --noEmit 2>&1 | grep -i "site-survey-readiness\|drive-plansets" || echo "no type errors in touched files"`
Run: `npm test -- --no-coverage site-survey 2>&1 | tail -15` (if a site-survey test exists; otherwise skip)
Expected: no type errors referencing these files; any existing site-survey tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/drive-plansets.ts src/lib/checks/site-survey-readiness.ts src/__tests__/drive-plansets.test.ts
git commit -m "feat(eagleview): add findSiteSurveyFolder helper, share survey-folder patterns

Promote SITE_SURVEY_FOLDER_PATTERNS to drive-plansets as the canonical home;
site-survey-readiness imports it. New findSiteSurveyFolder swallows list
errors so the EagleView delivery path can degrade gracefully.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Chunk 2: Pipeline dual-folder delivery

### Task 2: Wire survey-folder resolution into types + deps

**Files:**
- Modify: `src/lib/eagleview-pipeline.ts:60-73` (`DealAddressFields`), `:75-100` (`PipelineDeps`)
- Modify: `src/lib/eagleview-pipeline-deps.ts:26-40` (`DEAL_PROPERTIES`), `:42-64` (`fetchDealAddress`), `:80-95` (`defaultPipelineDeps`)
- Test: `src/__tests__/eagleview-pipeline.test.ts` (fixtures)

- [ ] **Step 1: Add `driveSiteSurveyFolderId` to `DealAddressFields`**

In `src/lib/eagleview-pipeline.ts`, inside `DealAddressFields` (after `driveAllDocumentsFolderId`, line 72):

```typescript
  /** Fallback parent folder. */
  driveAllDocumentsFolderId: string | null;
  /** Direct Site Survey folder ID (from site_survey_documents). Null → resolve via findSiteSurveyFolder at delivery. */
  driveSiteSurveyFolderId: string | null;
```

- [ ] **Step 2: Add `findSiteSurveyFolder` to `PipelineDeps`**

In `PipelineDeps` (after `ensureDriveFolder`, before `uploadToDrive`, ~line 90):

```typescript
  /** Find the "Site Survey" subfolder under a parent folder. Returns null if none. Must never throw. */
  findSiteSurveyFolder: (parentFolderId: string) => Promise<string | null>;
```

- [ ] **Step 3: Wire deps in `eagleview-pipeline-deps.ts`**

Add `site_survey_documents` to `DEAL_PROPERTIES` (after `all_document_parent_folder_id`, line 39):

```typescript
  "all_document_parent_folder_id",
  "site_survey_documents",
```

Add the import for `findSiteSurveyFolder` + `extractFolderId` to the existing `drive-plansets` import block (lines 10-14):

```typescript
import {
  uploadDriveBinaryFile,
  createDriveFolder,
  listDriveSubfolders,
  findSiteSurveyFolder,
  extractFolderId,
} from "@/lib/drive-plansets";
```

In `fetchDealAddress`, add the survey field to the returned object (after `driveAllDocumentsFolderId`, line 62):

```typescript
    driveAllDocumentsFolderId: props.all_document_parent_folder_id ?? null,
    driveSiteSurveyFolderId: extractFolderId(props.site_survey_documents ?? "") ?? null,
```

In `defaultPipelineDeps`, add the injected helper (after `ensureDriveFolder,` line 90):

```typescript
    ensureDriveFolder,
    findSiteSurveyFolder,
```

- [ ] **Step 4: Update test fixtures so existing tests still compile**

In `src/__tests__/eagleview-pipeline.test.ts`:

In `mkDealAddress`, add the field INSIDE the object literal, before the `...over` spread (after `driveAllDocumentsFolderId`, ~line 125 — must be before the spread on ~line 126 so per-test overrides win):

```typescript
  driveAllDocumentsFolderId: "folder_all_001",
  driveSiteSurveyFolderId: null,
  ...over,
```

In `mkDeps`, add the mock alongside `ensureDriveFolder` (default returns `null` so existing tests stay Design-only):

```typescript
  const ensureDriveFolder = jest.fn(async () => "drive_folder_123");
  const findSiteSurveyFolder = jest.fn(async () => null);
```

`mkDeps` has an **explicit inline return-type annotation** that lists every spy as `jest.Mock` (the `spies: { … }` block, ~lines 130-141). Add `findSiteSurveyFolder` in THREE places:

1. The `spies` **type annotation** block — add alongside `ensureDriveFolder: jest.Mock;` (~line 138). Omitting this is a compile error in Task 3's tests:

```typescript
    ensureDriveFolder: jest.Mock;
    findSiteSurveyFolder: jest.Mock;
```

2. The returned **deps object** (~line 174):

```typescript
    ensureDriveFolder,
    findSiteSurveyFolder,
```

3. The returned **`spies` object** (~line 185):

```typescript
      ensureDriveFolder,
      findSiteSurveyFolder,
```

- [ ] **Step 5: Verify it compiles and existing tests still pass**

Run: `npm test -- --no-coverage src/__tests__/eagleview-pipeline.test.ts 2>&1 | tail -20`
Expected: PASS. The existing happy-path test still sees one target (Design), so `uploadToDrive` is still called 2×. The `drive_folder_missing` test still passes (design + all-docs null, survey null, `findSiteSurveyFolder` mock → null).

- [ ] **Step 6: Commit**

```bash
git add src/lib/eagleview-pipeline.ts src/lib/eagleview-pipeline-deps.ts src/__tests__/eagleview-pipeline.test.ts
git commit -m "feat(eagleview): resolve site survey folder in pipeline deps

Add driveSiteSurveyFolderId to DealAddressFields and findSiteSurveyFolder to
PipelineDeps; populate the direct ID from site_survey_documents and inject the
subfolder finder. No behavior change yet — wiring only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 3: Dual-folder `fetchAndStoreDeliverables`

**Files:**
- Modify: `src/lib/eagleview-pipeline.ts:249-257` (order-time note) and `:302-387` (`fetchAndStoreDeliverables` body)
- Test: `src/__tests__/eagleview-pipeline.test.ts`

- [ ] **Step 1: Write the failing tests for dual-folder behavior**

In `src/__tests__/eagleview-pipeline.test.ts`, inside the `describe("fetchAndStoreDeliverables", ...)` block, add the four tests below.

**Critical seeding detail:** the existing tests seed the order row by calling `await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" })` first (there is NO `seedDeliverableOrder` helper) — the `placeOrder` mock makes that row's `reportId` `"12345"`. `orderTrueDesign` ALSO calls `fetchDealAddress` once at order time. Therefore any `fetchDealAddress` / `findSiteSurveyFolder` override MUST use the persistent `mockResolvedValue` (NOT `mockResolvedValueOnce`), or the override is consumed by `orderTrueDesign` and the delivery call gets the default. Set overrides BEFORE calling `orderTrueDesign`.

```typescript
  it("uploads to BOTH design and site survey when both resolve", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    deps.spies.fetchDealAddress.mockResolvedValue(
      mkDealAddress({ driveSiteSurveyFolderId: "folder_survey_001" }),
    );
    // distinct subfolder per parent so the two targets don't collapse
    deps.spies.ensureDriveFolder.mockImplementation(
      async (_dealId: string, parent: string) => `sub_${parent}`,
    );
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });

    const r = await fetchAndStoreDeliverables(deps, "12345");

    expect(r.status).toBe("DELIVERED");
    expect(deps.spies.uploadToDrive).toHaveBeenCalledTimes(4); // 2 files × 2 targets
    expect(deps.spies.ensureDriveFolder).toHaveBeenCalledTimes(2);
    const noteBody = deps.spies.postDealNote.mock.calls.at(-1)?.[1] as string;
    expect(noteBody).toMatch(/Design and Site Survey folders/);
  });

  it("resolves the survey folder via findSiteSurveyFolder fallback", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    // survey direct ID stays null (mkDealAddress default) → fallback path
    deps.spies.findSiteSurveyFolder.mockResolvedValue("folder_survey_fallback");
    deps.spies.ensureDriveFolder.mockImplementation(
      async (_dealId: string, parent: string) => `sub_${parent}`,
    );
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });

    const r = await fetchAndStoreDeliverables(deps, "12345");

    expect(r.status).toBe("DELIVERED");
    expect(deps.spies.findSiteSurveyFolder).toHaveBeenCalledWith("folder_all_001");
    expect(deps.spies.uploadToDrive).toHaveBeenCalledTimes(4);
  });

  it("delivers to survey only when design is missing", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    deps.spies.fetchDealAddress.mockResolvedValue(
      mkDealAddress({
        driveDesignDocumentsFolderId: null,
        driveAllDocumentsFolderId: null,
        driveSiteSurveyFolderId: "folder_survey_only",
      }),
    );
    deps.spies.ensureDriveFolder.mockImplementation(
      async (_dealId: string, parent: string) => `sub_${parent}`,
    );
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });

    const r = await fetchAndStoreDeliverables(deps, "12345");

    expect(r.status).toBe("DELIVERED");
    expect(deps.spies.uploadToDrive).toHaveBeenCalledTimes(2); // one target, 2 files
    expect(r.driveFolderId).toBe("sub_folder_survey_only");
  });

  it("does not double-upload when design and survey resolve to the same folder", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    deps.spies.fetchDealAddress.mockResolvedValue(
      mkDealAddress({ driveSiteSurveyFolderId: "folder_design_001" }), // == design
    );
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });

    const r = await fetchAndStoreDeliverables(deps, "12345");

    expect(r.status).toBe("DELIVERED");
    expect(deps.spies.uploadToDrive).toHaveBeenCalledTimes(2); // deduped to one target
  });
```

Keep the existing happy-path test (single target → 2 uploads, `driveFolderId === "drive_folder_123"`) intact — with `findSiteSurveyFolder` defaulting to `null` and `driveSiteSurveyFolderId` defaulting to `null`, that test still resolves only the Design target.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --no-coverage src/__tests__/eagleview-pipeline.test.ts -t "fetchAndStoreDeliverables" 2>&1 | tail -25`
Expected: the four new tests FAIL (current code uploads to one folder, note says "design-docs folder", no dedup of survey).

- [ ] **Step 3: Replace the folder-resolution + upload section of `fetchAndStoreDeliverables`**

In `src/lib/eagleview-pipeline.ts`, replace everything from the `// 2. Resolve Drive folder` comment through the `return { status: "DELIVERED", driveFolderId };` at the end of the function (the current lines ~302-386) with:

```typescript
  // 2. Resolve Drive folder targets — Design (existing precedence) + Site Survey.
  const dealFields = await deps.fetchDealAddress(order.dealId);

  const designParent =
    dealFields?.driveDesignDocumentsFolderId ??
    dealFields?.driveAllDocumentsFolderId ??
    null;

  // Site Survey: prefer the direct ID; else find the subfolder under the
  // all-documents root. The Drive find call only runs here, at delivery time.
  let surveyParent: string | null = dealFields?.driveSiteSurveyFolderId ?? null;
  if (!surveyParent && dealFields?.driveAllDocumentsFolderId) {
    surveyParent = await deps.findSiteSurveyFolder(dealFields.driveAllDocumentsFolderId);
  }

  // Deduped target list. Design first so it owns the recorded driveFolderId
  // and per-type file IDs (the DB columns reference openable design-folder files).
  const targets: Array<{ label: string; parentFolderId: string }> = [];
  if (designParent) targets.push({ label: "Design", parentFolderId: designParent });
  if (surveyParent && surveyParent !== designParent) {
    targets.push({ label: "Site Survey", parentFolderId: surveyParent });
  }

  if (targets.length === 0) {
    return { status: "FAILED", reason: "drive_folder_missing" };
  }

  // Ensure the eagleview-{reportId} subfolder in each target. A create failure
  // for one target is logged and skipped, not fatal to the others.
  const resolved: Array<{ label: string; folderId: string }> = [];
  for (const t of targets) {
    try {
      const folderId = await deps.ensureDriveFolder(
        order.dealId,
        t.parentFolderId,
        `eagleview-${reportIdStr}`,
      );
      resolved.push({ label: t.label, folderId });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "eagleview", phase: "ensureDriveFolder" },
        extra: { reportId: reportIdStr, dealId: order.dealId, target: t.label },
      });
    }
  }

  if (resolved.length === 0) {
    return { status: "FAILED", reason: "drive_folder_create_failed" };
  }

  // The "primary" target owns the recorded driveFolderId + per-type file IDs.
  // Prefer Design; fall back to the first resolved target (e.g. survey-only).
  const primary = resolved.find((r) => r.label === "Design") ?? resolved[0];

  // 3. Download each file ONCE, then upload the bytes to every resolved target.
  const fileIdByType: Record<string, string> = {};
  const uploadedNames: string[] = [];
  const deliveredLabels = new Set<string>();

  for (const link of links.links) {
    let bytes: ArrayBuffer;
    try {
      bytes = await deps.client.downloadFile(link.link);
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "eagleview", phase: "downloadFile" },
        extra: { reportId: reportIdStr, fileType: link.fileType },
      });
      continue; // can't upload a file we couldn't download
    }
    const { mimeType, ext } = inferMimeAndExt(link);
    const filename = sanitizeFilename(`${link.fileType}.${ext}`);

    for (const target of resolved) {
      try {
        const uploaded = await deps.uploadToDrive(target.folderId, filename, bytes, mimeType);
        deliveredLabels.add(target.label);
        if (target.folderId === primary.folderId) {
          fileIdByType[normalizeFileType(link.fileType)] = uploaded.id;
          uploadedNames.push(uploaded.name);
        }
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: "eagleview", phase: "downloadAndUpload" },
          extra: { reportId: reportIdStr, fileType: link.fileType, target: target.label },
        });
        // Continue; partial success across files/targets is better than none.
      }
    }
  }

  if (deliveredLabels.size === 0) {
    return { status: "FAILED", reason: "all_uploads_failed" };
  }

  // 4. Update order row — driveFolderId + per-type IDs come from the primary folder.
  await deps.prisma.eagleViewOrder.update({
    where: { id: order.id },
    data: {
      status: "DELIVERED",
      deliveredAt: new Date(),
      driveFolderId: primary.folderId,
      imageDriveFileId: fileIdByType["image"] ?? null,
      layoutJsonDriveFileId: fileIdByType["layout"] ?? null,
      shadeJsonDriveFileId: fileIdByType["shade"] ?? null,
      reportPdfDriveFileId: fileIdByType["report-pdf"] ?? null,
      reportXmlDriveFileId: fileIdByType["report-xml"] ?? null,
    },
  });

  // 5. Best-effort HubSpot note naming the folder(s) the files landed in.
  const labels = [...deliveredLabels];
  const folderText =
    labels.length > 1
      ? `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]} folders`
      : `${labels[0]} folder`;
  await deps
    .postDealNote(
      order.dealId,
      `<p>EagleView files delivered to ${folderText} (${uploadedNames.length} files): ${uploadedNames
        .map((n) => `<code>${escapeHtml(n)}</code>`)
        .join(", ")}.</p>`,
    )
    .catch((err) => {
      console.warn("[eagleview-pipeline] delivered-note failed", err);
    });

  return { status: "DELIVERED", driveFolderId: primary.folderId };
```

Note: `deps.ensureDriveFolder`'s first arg (`order.dealId`) is currently ignored by the real implementation (`_dealId`), so passing it per target is harmless and preserves the injected signature.

- [ ] **Step 4: Update the order-time note wording (advisory fix from spec review)**

In `orderTrueDesign`, line 253, change the singular folder reference:

```typescript
      `<p>EagleView TrueDesign ordered (Report #${realReportId}). Files will land in the design and site survey folders when delivery completes.</p>`,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- --no-coverage src/__tests__/eagleview-pipeline.test.ts 2>&1 | tail -25`
Expected: PASS — all new dual-folder tests plus the unchanged existing tests (single-target happy path = 2 uploads, `drive_folder_missing`, `no_files_yet`, `order_not_found`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/eagleview-pipeline.ts src/__tests__/eagleview-pipeline.test.ts
git commit -m "feat(eagleview): deliver reports to Site Survey + Design folders

fetchAndStoreDeliverables now resolves a deduped Design+Site Survey target
list, downloads each file once, uploads to every target, and names the
delivered folders in the HubSpot note. Degrades gracefully: delivers to
whichever folder(s) resolve, FAILED only if neither does.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Chunk 3: Dashboard RID links (Track B)

### Task 4: EagleView link helper + order-card links

**Files:**
- Create: `src/lib/eagleview-links.ts`
- Create: `src/__tests__/eagleview-links.test.ts`
- Modify: `src/app/dashboards/eagleview-orders/EagleViewOrdersClient.tsx:200-202`

- [ ] **Step 1: Write the failing helper test**

Create `src/__tests__/eagleview-links.test.ts`:

```typescript
import { eagleViewLinks } from "@/lib/eagleview-links";

describe("eagleViewLinks", () => {
  it("builds TrueDesign + order-page URLs from a real RID", () => {
    expect(eagleViewLinks("71412250")).toEqual({
      trueDesign: "https://apps.eagleview.com/truedesign/71412250",
      orderPage: "https://apps.eagleview.com/myev/orders/report/71412250",
    });
  });

  it("returns null for empty or pending reportIds", () => {
    expect(eagleViewLinks(null)).toBeNull();
    expect(eagleViewLinks("")).toBeNull();
    expect(eagleViewLinks("pending:abc")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --no-coverage src/__tests__/eagleview-links.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the helper**

Create `src/lib/eagleview-links.ts`:

```typescript
/**
 * Build EagleView web-interface links from a report ID (RID).
 *
 * Requested in Freshservice tickets cmpx1kied… ("Create link to open True
 * Design") and cmpx4lzio… ("EVTD Order Details Page"). Returns null when there
 * is no real RID yet (null / empty / "pending:" placeholder).
 */
export interface EagleViewLinks {
  trueDesign: string;
  orderPage: string;
}

export function eagleViewLinks(reportId: string | null | undefined): EagleViewLinks | null {
  if (!reportId || reportId.startsWith("pending:")) return null;
  return {
    trueDesign: `https://apps.eagleview.com/truedesign/${reportId}`,
    orderPage: `https://apps.eagleview.com/myev/orders/report/${reportId}`,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --no-coverage src/__tests__/eagleview-links.test.ts`
Expected: PASS.

- [ ] **Step 5: Render the links in the order card**

In `src/app/dashboards/eagleview-orders/EagleViewOrdersClient.tsx`, add the import near the top (with the other imports):

```typescript
import { eagleViewLinks } from "@/lib/eagleview-links";
```

Replace the existing Report # span (lines 200-202):

```tsx
                  {order.reportId && !order.reportId.startsWith("pending:") && (
                    <span>— Report #{order.reportId}</span>
                  )}
```

with:

```tsx
                  {(() => {
                    const links = eagleViewLinks(order.reportId);
                    if (!links) return null;
                    return (
                      <>
                        <span>— Report #{order.reportId}</span>
                        <a
                          href={links.trueDesign}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:no-underline"
                        >
                          Open in TrueDesign
                        </a>
                        <a
                          href={links.orderPage}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:no-underline"
                        >
                          View EagleView Order
                        </a>
                      </>
                    );
                  })()}
```

The links sit in the same flex status row (`text-xs`), so they inherit the row's spacing. If the row needs explicit gaps, confirm the parent `div` uses `gap-2` (it does at line ~189-198); no extra styling needed.

- [ ] **Step 6: Verify the component type-checks**

Run: `npx tsc --noEmit 2>&1 | grep -i "EagleViewOrdersClient\|eagleview-links" || echo "no type errors in touched files"`
Expected: no type errors referencing these files.

- [ ] **Step 7: Commit**

```bash
git add src/lib/eagleview-links.ts src/__tests__/eagleview-links.test.ts src/app/dashboards/eagleview-orders/EagleViewOrdersClient.tsx
git commit -m "feat(eagleview): add TrueDesign + order-page links to order cards

Surfaces 'Open in TrueDesign' and 'View EagleView Order' links built from the
RID on each order card. Closes Jacob Campbell's two Freshservice feature
requests (cmpx1kied…, cmpx4lzio…).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Chunk 4: Verification

### Task 5: Full verification pass

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: No errors. If pre-existing errors appear in files this plan did NOT touch, compare against `git stash`-clean `origin/main` to confirm they are not introduced here; the bar is "no NEW errors in touched files" (`eagleview-pipeline.ts`, `eagleview-pipeline-deps.ts`, `eagleview-links.ts`, `drive-plansets.ts`, `site-survey-readiness.ts`, `EagleViewOrdersClient.tsx`, and the three test files).

- [ ] **Step 2: Run all touched test suites**

Run: `npm test -- --no-coverage src/__tests__/eagleview-pipeline.test.ts src/__tests__/eagleview-links.test.ts src/__tests__/drive-plansets.test.ts 2>&1 | tail -30`
Expected: All pass.

- [ ] **Step 3: Lint the changed files**

Run: `npm run lint 2>&1 | tail -20`
Expected: No new lint errors in changed files.

- [ ] **Step 4: Build**

Run: `npm run build 2>&1 | tail -20`
Expected: Clean build.

- [ ] **Step 5: Fix anything the above surfaced, then final commit if needed**

```bash
git add -A && git commit -m "chore(eagleview): verification fixes" # only if fixes were needed
```

---

## Post-merge follow-up (not part of this plan)

- **CA (SLO / Camarillo) auto-pull coverage** — confirm CA deals are enrolled in the HubSpot `order_eagleview` workflow. Check whether recent SLO/Camarillo deals have `EagleViewOrder` rows; if not, fix workflow enrollment (HubSpot config, not code).
