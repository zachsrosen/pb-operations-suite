# BOM Persistence, Drive Integration, PDF Export & Email Design

**Date:** 2026-02-21
**Status:** Approved
**Scope:** BOM dashboard enhancements — URL-based deal persistence, Google Drive design file picker, project quick links, PDF export, print mode, email notification

---

## 1. URL-Based Deal Persistence

### Goal
Survive page refresh, enable bookmarking and sharing of a deal's BOM history.

### URL Shape
```
/dashboards/bom?deal=<hs_object_id>
```

### Behavior
- On page load, read `?deal=` from `useSearchParams()`
- Fetch deal via new `GET /api/projects/[id]` route → set `linkedProject` state
- This triggers the existing `useEffect` that loads snapshot history
- When user links a project via search, call `router.replace('/dashboards/bom?deal=<id>')` (no reload)
- Unlinking calls `router.replace('/dashboards/bom')` (clears param)

### New Route: `GET /api/projects/[id]`
- Accepts `id` = HubSpot `hs_object_id`
- Fetches single deal from HubSpot with the extended property list (see section 2)
- Returns `{ hs_object_id, dealname, address, designFolderUrl, driveUrl, openSolarUrl, zuperUid }`
- Reuses existing `hubspot.ts` client + `searchWithRetry()`

### Search Input
- Placeholder: `"Search by name, address, or project number…"`
- No backend change — `project_number` (`projectNumber`) is already in the search filter in `/api/projects/route.ts`

---

## 2. Google Drive Design File Picker

### Setup (One-time, manual)
Share PB design folders in Google Drive with the service account email (`GOOGLE_SERVICE_ACCOUNT_EMAIL` env var) — read-only access. Done once, works for all users.

### New HubSpot Properties to Fetch
Add to the properties array in `hubspot.ts` and to `transformDealToProject()`:

| HubSpot property | Transformed field | Usage |
|---|---|---|
| `design_document_folder_id` | `designFolderUrl` | Drive folder ID for file picker |
| `g_drive` | `driveUrl` | General G-Drive link (quick link) |
| `link_to_opensolar` / `os_project_link` | `openSolarUrl` | OpenSolar quick link |
| `zuper_site_survey_uid` | `zuperUid` | Construct Zuper app URL |
| `os_project_id` | `openSolarId` | Fallback OpenSolar ID |

### New API Route: `GET /api/bom/drive-files?folderId=<id>`
- Auth: `google.auth.JWT` using `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (same credentials as Calendar)
- Scope: `https://www.googleapis.com/auth/drive.readonly`
- Calls `drive.files.list` with:
  - `q: "'<folderId>' in parents and mimeType='application/pdf' and trashed=false"`
  - `fields: 'files(id,name,modifiedTime,size)'`
  - `orderBy: 'modifiedTime desc'`
- Returns `{ files: [{ id, name, modifiedTime, size }] }`
- Errors gracefully — if service account lacks access, returns `{ files: [], error: "Drive access not configured" }`

### New Package
```
npm install googleapis
```

### BOM Page UI — Quick Links Panel
Shown immediately below the project link card when a project is linked. Only renders links that have values.

```
┌─────────────────────────────────────────────────────┐
│  Quick Links                                         │
│  [HubSpot Deal ↗]  [G-Drive ↗]  [OpenSolar ↗]  [Zuper ↗] │
└─────────────────────────────────────────────────────┘
```

- **HubSpot Deal:** `https://app.hubspot.com/contacts/<accountId>/deal/<hs_object_id>` — always shown
- **G-Drive:** `g_drive` property value — shown if set
- **OpenSolar:** `os_project_link` or `link_to_opensolar` — shown if set
- **Zuper:** construct from `zuper_site_survey_uid` — shown if set

### BOM Page UI — Design Files Picker
Shown below the quick links panel when `design_document_folder_id` is set.

```
┌─────────────────────────────────────────────────────┐
│  Design Files  [3 PDFs]                              │
│  ┌──────────────────────────────────────────────┐   │
│  │ 📄 Nguyen_RevC_Stamped.pdf   Jan 15  4.2MB   │   │
│  │ 📄 Nguyen_RevB_Stamped.pdf   Dec 12  3.8MB   │   │
│  │ 📄 Nguyen_RevA_Stamped.pdf   Nov 30  3.1MB   │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

- Loads via `GET /api/bom/drive-files?folderId=<design_document_folder_id>` when project is linked
- Clicking a file immediately starts extraction (sets `uploadFile` equivalent, calls extraction flow with Drive file ID)
- Uses existing `handleExtractDrive` flow — constructs `https://drive.google.com/uc?export=download&id=<fileId>`
- Shows spinner per-file while extracting; disables other files during extraction

---

## 3. PDF BOM Export

### New Package
```
npm install @react-pdf/renderer
```

### New API Route: `POST /api/bom/export-pdf`
- Body: `{ snapshotId?: string, bomData?: BomData, dealName?: string }`
- If `snapshotId` provided: fetch from `ProjectBomSnapshot` table
- If `bomData` provided directly: use as-is (for unsaved/edited BOMs)
- Renders PDF via `@react-pdf/renderer` server-side
- Returns `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="BOM-<dealName>-v<version>.pdf"`

### PDF Layout
```
┌────────────────────────────────────────────────────┐
│  [PB Logo]    Planset BOM — {customer}             │
│               {address}                            │
│               {moduleCount} modules · {kWdc} kWdc  │
│               Rev {plansetRev} · Stamped {date}    │
├────────────────────────────────────────────────────┤
│  MODULES                                           │
│  Brand      Model        Qty   Spec                │
│  SunPower   SPR-400     28    400W                 │
├────────────────────────────────────────────────────┤
│  INVERTERS  ...                                    │
├────────────────────────────────────────────────────┤
│  Validation                                        │
│  ✅ Module count match   ✅ Battery kWh   ⚪ OCPD  │
├────────────────────────────────────────────────────┤
│  Footer: Generated by PB Ops · 2026-02-21 · user@photonbrothers.com │
└────────────────────────────────────────────────────┘
```

### New React PDF Component
`src/components/BomPdfDocument.tsx` — `@react-pdf/renderer` document component, accepts `BomData + dealName + version + generatedBy`. Used only by the API route (server-side).

### BOM Page UI Changes
Add to action bar:
- **"↓ Export PDF"** — POSTs to `/api/bom/export-pdf` with current `bom` + `items`, triggers download
- **"🖨 Print"** — calls `window.print()`

Add `<style media="print">` tag to the page:
- Hides `DashboardShell` nav, header, action bar, history panel, diff view, import panel
- Shows only project info card + BOM tables
- Forces black text, no backgrounds, table borders visible
- Page break before each category section

---

## 4. Email Notification

### Trigger
After successful `saveSnapshot()` completes — fire and forget (does not block UI).

### Recipient
Currently logged-in user's email (from `useSession()` → `session.user.email`).

### Transport
Gmail API via the existing Google service account (same `googleapis` package being added for Drive). Uses service account with domain-wide delegation to send as `ops@photonbrothers.com` (or whichever sender address is configured), no Resend dependency.

### New API Route: `POST /api/bom/notify`
- Body: `{ snapshotId, userEmail, dealName, dealId, version, sourceFile, itemCount, projectInfo }`
- Fetches nothing — all data passed in body to keep it fast
- Auth: same `google.auth.JWT` used for Drive + Calendar, with `https://www.googleapis.com/auth/gmail.send` scope added
- Sends via `gmail.users.messages.send` with RFC 2822 formatted message

### Email Contents
- **Subject:** `BOM v{version} extracted — {dealName}`
- **Body (HTML):**
  - Deal name, address, system size (kWdc / modules)
  - Version number, source filename, item count, who extracted it
  - Category summary: "Modules (1 item), Inverters (2 items), ..."
  - CTA button: "View BOM →" → `https://pbtechops.com/dashboards/bom?deal={dealId}`
- Styled simply — matches existing Resend email templates in the project if any exist

### Called From
`saveSnapshot()` in `bom/page.tsx` — after the save succeeds, fire-and-forget:
```ts
fetch("/api/bom/notify", { method: "POST", body: JSON.stringify({...}) })
  // no await — don't block
```

---

## 5. Implementation Order

1. **`/api/projects/[id]`** — single deal fetch route
2. **HubSpot property additions** — `hubspot.ts` + `transformDealToProject()`
3. **URL persistence** — `bom/page.tsx` reads/writes `?deal=` param
4. **Quick links panel** — UI only, data from step 2
5. **`googleapis` install + `/api/bom/drive-files`** — Drive file listing
6. **Design files picker UI** — `bom/page.tsx`
7. **`@react-pdf/renderer` install + `BomPdfDocument` component** — PDF template
8. **`/api/bom/export-pdf`** — PDF generation route
9. **Print stylesheet** — `<style media="print">` in `bom/page.tsx`
10. **`/api/bom/notify`** — email route
11. **Wire email call** into `saveSnapshot()`
12. **Search placeholder update** — 1-line change

---

## 6. New Packages

```
npm install googleapis @react-pdf/renderer
```

- `googleapis` — covers Drive file listing **and** Gmail sending (one package, two uses)
- `@react-pdf/renderer` — types are bundled, no `@types/` needed

---

## 7. Environment Variables

No new env vars needed — all credentials already exist:
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` ✅
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` ✅
- `GMAIL_SENDER_EMAIL` — the Google Workspace email address to send from (e.g. `ops@photonbrothers.com`); service account must have domain-wide delegation with `gmail.send` scope granted for this address

One-time manual step: share PB design Drive folders with `GOOGLE_SERVICE_ACCOUNT_EMAIL`.

---

## 8. What This Does NOT Change

- Existing chunked upload flow — unchanged
- Existing history/snapshot/diff feature — unchanged
- Existing catalog comparison columns — unchanged
- HubSpot write-back — still none
