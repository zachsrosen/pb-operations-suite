# EagleView Dual-Folder Delivery + Dashboard RID Links

**Date**: 2026-06-15
**Status**: Draft

## Summary

Two independent improvements to the shipped EagleView TrueDesign auto-pull integration, delivered in one PR:

- **Track A (backend):** when an auto-pulled report is delivered, file it into the deal's **Site Survey** folder in addition to the existing **Design Documents** folder, so the field/ops team finds it via the Zuper job folder link instead of digging through EagleView emails.
- **Track B (frontend):** on the EagleView Orders dashboard, add two external links per order — "Open in TrueDesign" and "View EagleView Order" — built from the report ID (RID) the page already shows.

Ordering, the file-delivery webhook, and the poll cron are unchanged. Track A only changes the delivery (file-storage) step; Track B only changes the dashboard client.

## Motivation

### Track A — folder routing

Nickolas Scarpellino (Ops Manager, San Luis Obispo) asked that EagleView reports land in an accessible Drive folder ("site survey or design") rather than being emailed, since other staff complete surveys and the field team reaches project documents through the Zuper job folder link. EagleView's rep (Geoff Green) confirmed EagleView cannot customize delivery by geography or push to a Drive folder, and pointed at the open API: "build your own retrieval functionalities."

The retrieval already exists. The gap is **where the files land**. Today `fetchAndStoreDeliverables` files reports only into the deal's Design Documents folder (`design_document_folder_id`), falling back to the All Documents parent. The survey/ops team works out of the **Site Survey** folder, so even successfully auto-pulled reports look "missing" from their side. Filing into the Site Survey folder as well closes the gap.

### Track B — dashboard links

Two open Freshservice feature requests from Jacob Campbell (both 2026-06-02, both assigned to Zach, both targeting `/dashboards/eagleview-orders`):

- **"Create link to open True Design"** (`cmpx1kied00ch04l45eabe82c`): launch the design in EagleView's web interface via `https://apps.eagleview.com/truedesign/{RID}`.
- **"EVTD Order Details Page"** (`cmpx4lzio00aq04k5jpichqb0`): link to the EagleView order page via `https://apps.eagleview.com/myev/orders/report/{RID}`.

Both reduce to: surface two external EagleView links per order, constructed from the RID the dashboard already displays.

## Design

### Track A: Dual-folder delivery

#### A0. Prior art and reuse (read before A1)

`src/lib/checks/site-survey-readiness.ts` already solves survey-folder resolution: it defines a 3-pattern set and an async `resolveSurveyFolderId(properties, token)` that does exactly the "direct `site_survey_documents` via `extractFolderId` → else list subfolders of `all_document_parent_folder_id` and pattern-match" logic this spec needs:

```typescript
// site-survey-readiness.ts (existing)
const SITE_SURVEY_FOLDER_PATTERNS = [
  /site\s*survey/i,
  /^1\.\s*site\s*survey$/i,
  /^ss$/i,
];
export async function resolveSurveyFolderId(
  properties: Record<string, string | null>,
  token: string,
): Promise<string | null>;
```

We **reuse the pattern set** (it is more complete than a single `/site\s*survey/i`) but **do not call `resolveSurveyFolderId` directly**, because it takes an explicit Drive `token` and uses that module's local `listSubfolders(rootId, token)`. The EagleView pipeline-deps layer instead uses the self-tokening helpers in `drive-plansets.ts` (`listDriveSubfolders`, `ensureDriveFolder`), which manage the token via `getDriveToken()`. Threading a token through the EagleView path solely to reuse one function would be the more invasive change.

**Plan:** promote `SITE_SURVEY_FOLDER_PATTERNS` to `drive-plansets.ts` as the canonical, exported home, add a self-tokening `findSiteSurveyFolder()` there, and update `site-survey-readiness.ts` to import the shared patterns (removing its local duplicate). The two resolvers stay separate only in their token strategy; the pattern set is shared, not copied.

#### A1. `findSiteSurveyFolder()` — `src/lib/drive-plansets.ts`

New exported helper alongside `findStampedPlansFolder` / `findDAFolder` / `findPhotosFolder`, plus the promoted pattern constant:

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
 */
export async function findSiteSurveyFolder(parentFolderId: string): Promise<string | null> {
  const subfolders = await listDriveSubfolders(parentFolderId).catch(() => []);
  const match = subfolders.find((f) =>
    SITE_SURVEY_FOLDER_PATTERNS.some((p) => p.test(f.name)),
  );
  return match?.id ?? null;
}
```

**Error handling note:** unlike `findStampedPlansFolder` (which uses a raw `fetch` and returns `null` on `!res.ok`), this helper calls `listDriveSubfolders`, which **throws** on a non-OK response. To honor the "swallow list errors → return `null`" contract — and so the A3 graceful-degradation guarantee ("survey unresolvable → deliver to Design only, not a failure") actually holds — the call MUST be wrapped in `.catch(() => [])` (the same pattern already used by `ensureDriveFolder` in `eagleview-pipeline-deps.ts`). This is shown explicitly above.

After promoting the constant, update `src/lib/checks/site-survey-readiness.ts` to import `SITE_SURVEY_FOLDER_PATTERNS` from `@/lib/drive-plansets` and delete its local copy. `resolveSurveyFolderId` is otherwise unchanged.

#### A2. Resolve the survey folder — `src/lib/eagleview-pipeline-deps.ts`

- Add `site_survey_documents` to the `DEAL_PROPERTIES` array fetched by `fetchDealAddress`.
- Add `driveSiteSurveyFolderId: string | null` to the `DealAddressFields` type (in `eagleview-pipeline.ts`) and populate it in `fetchDealAddress`:

  ```typescript
  driveSiteSurveyFolderId:
    extractFolderId(props.site_survey_documents ?? "") ?? null,
  ```

  (`extractFolderId` already exists in `drive-plansets.ts` and handles both raw IDs and Drive URLs.)

  Note (pre-existing asymmetry, not introduced here): the existing `driveDesignDocumentsFolderId` is assigned raw (`props.design_document_folder_id ?? props.design_documents`) without `extractFolderId`. We route the survey field through `extractFolderId` deliberately because `site_survey_documents` is stored as a Drive URL. A reviewer comparing the two fields should not "fix" the survey field to match the design field — the design field is the inconsistent one, and changing it is out of scope.

- The "find the subfolder" fallback is resolved at delivery time, not here, because it requires a Drive API call against `all_document_parent_folder_id` and we only want to make that call when a survey-folder ID was not already supplied. See A3.

#### A3. File into both folders — `src/lib/eagleview-pipeline.ts` (`fetchAndStoreDeliverables`)

Current behavior: resolve one `parentFolderId` (design → all-docs fallback), create `eagleview-{reportId}` subfolder, download + upload each file there, record file IDs on the order row.

New behavior:

1. **Resolve destination parents** into a list of `{ label, parentFolderId }` targets:
   - **Design** (unchanged precedence): `driveDesignDocumentsFolderId ?? driveAllDocumentsFolderId`.
   - **Site Survey**: `driveSiteSurveyFolderId` if present; else `findSiteSurveyFolder(driveAllDocumentsFolderId)` (only attempted when `all_document_parent_folder_id` is set).
   - Deduplicate by `parentFolderId` (guard against design == survey).
2. If **no** targets resolve → `FAILED` with reason `drive_folder_missing` (unchanged failure semantics; now requires *both* to be missing).
3. For each target, `ensureDriveFolder(dealId, parentFolderId, "eagleview-{reportId}")` to get/create the `eagleview-{reportId}` subfolder. A folder-create failure for one target is logged to Sentry and that target is skipped — it does not abort the other.
4. **Download each file once** (from `links.links`), then upload the bytes to **each resolved target subfolder**. Per-file, per-target upload failures are caught and logged (existing partial-success behavior preserved).
5. **`driveFolderId` on the order row** records the **Design** target's subfolder ID (preserving today's meaning and the existing `imageDriveFileId` / `layoutJsonDriveFileId` / etc. mapping, which is keyed off the design upload). If Design didn't resolve but Survey did, `driveFolderId` records the Survey subfolder so the row still points at a real delivered location.
6. **HubSpot delivery note** lists both folders when both delivered, e.g. "EagleView files delivered to Design and Site Survey folders (N files): …". When only one resolved, name only that one.
7. Return `DELIVERED` if at least one target received at least one file; `FAILED` only if every upload to every target failed.

**Graceful degradation summary:**

| Design folder | Survey folder | Result |
|---|---|---|
| resolves | resolves | files in both, note names both |
| resolves | missing | files in Design only, warning logged, note names Design |
| missing | resolves | files in Survey only, `driveFolderId` = survey subfolder, note names Survey |
| missing | missing | `FAILED` / `drive_folder_missing` (unchanged) |

#### A4. Subfolder naming

Keep `eagleview-{reportId}` in both folders. Rationale: consistency with the existing design-folder behavior, and the report ID gives a natural dedup/idempotency key (re-delivery finds the existing subfolder via `ensureDriveFolder` rather than creating duplicates).

### Track B: Dashboard RID links

#### B1. `EagleViewOrdersClient.tsx`

The order-status block already renders `Report #{order.reportId}` when the reportId is real (it guards `!order.reportId.startsWith("pending:")`). In that same guarded block, render two external links:

```tsx
{order.reportId && !order.reportId.startsWith("pending:") && (
  <>
    <span>— Report #{order.reportId}</span>
    <a
      href={`https://apps.eagleview.com/truedesign/${order.reportId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="underline hover:no-underline"
    >
      Open in TrueDesign
    </a>
    <a
      href={`https://apps.eagleview.com/myev/orders/report/${order.reportId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="underline hover:no-underline"
    >
      View EagleView Order
    </a>
  </>
)}
```

Final styling follows the surrounding card tokens (text-xs, theme colors). The links are plain `<a>` tags — no new state, no new fetch, no backend change. The RID is the EagleView ReportId already present on `EagleViewOrderSummary`.

#### B2. Link semantics

- "Open in TrueDesign" → `https://apps.eagleview.com/truedesign/{RID}` (ticket `cmpx1kied…`).
- "View EagleView Order" → `https://apps.eagleview.com/myev/orders/report/{RID}` (ticket `cmpx4lzio…`).
- Both open in a new tab. No links shown for orders without a real reportId (e.g. `pending:` placeholders, FAILED-before-order rows).

## Data Flow

```
TDP report completes
  └─ file-delivery webhook OR poll cron        (unchanged)
       └─ fetchAndStoreDeliverables(reportId)
            ├─ resolve targets: [Design, Site Survey]   (NEW: 2 targets)
            ├─ download each file once
            ├─ upload bytes → eagleview-{RID} subfolder in EACH target
            ├─ order.driveFolderId = Design subfolder    (unchanged meaning)
            └─ HubSpot note links both folders            (NEW: names both)

Dashboard (/dashboards/eagleview-orders)
  └─ order card shows Report #{RID}
       ├─ + "Open in TrueDesign" → apps.eagleview.com/truedesign/{RID}   (NEW)
       └─ + "View EagleView Order" → apps.eagleview.com/myev/orders/report/{RID}  (NEW)
```

## Error Handling

- **Survey folder unresolvable:** log a warning, deliver to Design only. Not a failure.
- **One target's subfolder create fails:** Sentry capture, skip that target, continue with the other.
- **Per-file / per-target upload fails:** caught and logged per the existing loop; partial success preserved.
- **Both targets missing:** `FAILED` / `drive_folder_missing` — identical to today's single-folder failure.
- **Dashboard links:** static URL construction; no runtime failure path. Absent for non-real reportIds.

## Testing

Extend `src/__tests__/eagleview-pipeline.test.ts` (or the existing EagleView test file) with mock-deps cases:

- `findSiteSurveyFolder`: matches `1. Site Survey`, `Site Survey - CA`, `Site Survey`; returns `null` when no subfolder matches; returns `null` when the list call throws.
- `fetchAndStoreDeliverables`:
  - both folders resolve → `uploadToDrive` called for each file × 2 targets; `DELIVERED`; note names both.
  - survey missing (no `site_survey_documents`, `findSiteSurveyFolder` → null) → uploads to Design only; `DELIVERED`.
  - design missing but survey resolves → uploads to Survey only; `driveFolderId` = survey subfolder; `DELIVERED`.
  - both missing → `FAILED` / `drive_folder_missing`.
  - dedup: design folder ID == survey folder ID → single target, no double upload.

Track B is static URL construction; a lightweight render assertion (links present with correct hrefs for a real reportId, absent for `pending:`) is sufficient.

## Out of Scope

- **CA (SLO / Camarillo) auto-pull coverage.** Auto-pull is supposed to cover CA via the HubSpot `order_eagleview` workflow; if CA deals aren't enrolled, that is HubSpot workflow configuration, not a code change. To be verified separately after this ships (check whether recent SLO/Camarillo deals have `EagleViewOrder` rows).
- **Account-wide retrieval** of manually-placed EagleView orders (orders never placed through PB's system). Not addressed here.
- **New DB column** for the survey folder ID. `driveFolderId` continues to record the primary (Design) subfolder; the survey folder is captured in the HubSpot note. A queryable `siteSurveyDriveFolderId` column can be added later if needed.
- **Drive shortcuts** as an alternative to dual upload. Dual upload chosen for simplicity (no new Drive infrastructure); the extra storage per report is a few MB.
