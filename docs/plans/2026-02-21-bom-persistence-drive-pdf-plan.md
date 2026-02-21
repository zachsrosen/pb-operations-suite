# BOM Persistence, Drive Integration, PDF Export & Email Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add URL-based deal persistence, Google Drive design file picker, project quick links, PDF BOM export, print mode, and Gmail email notification to the BOM dashboard.

**Architecture:** Twelve sequential tasks, each committed independently. Shared JWT auth helper extracted from `google-calendar.ts` pattern. No new packages for auth (hand-rolled RS256 JWT). One new package: `@react-pdf/renderer` for server-side PDF generation.

**Tech Stack:** Next.js App Router API routes, hand-rolled Google JWT (same pattern as `src/lib/google-calendar.ts`), `@react-pdf/renderer`, Gmail API (RFC 2822 messages via service account), `useSearchParams` + `router.replace` for URL state.

---

## Task 1: Add `GET /api/projects/[id]` — single deal fetch

**Files:**
- Create: `src/app/api/projects/[id]/route.ts`

**Context:**
- `hubspot.ts` exports `hubspotClient` (line 5) and `transformDealToProject` (line 614)
- The `Project` interface is exported from `src/lib/hubspot.ts` (line 243)
- Existing `DEAL_PROPERTIES` array (lines 395–538) — we will extend it in Task 2; for now use as-is

**Step 1: Create the route**

```typescript
// src/app/api/projects/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { fetchAllProjects } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireApiAuth(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing deal id" }, { status: 400 });

  try {
    // Use cached project list — same as the main projects route
    const cached = appCache.get<ReturnType<typeof Array.prototype.filter>>(CACHE_KEYS.PROJECTS);
    const projects = cached ?? await fetchAllProjects();

    const project = projects.find((p) => String(p.id) === id);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    return NextResponse.json({ project });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch project" },
      { status: 500 }
    );
  }
}
```

**Step 2: Verify build passes**
```bash
cd /Users/zach/Downloads/PB-Operations-Suite
npm run build 2>&1 | grep -E "error TS|Error:|✓ Compiled"
```
Expected: `✓ Compiled successfully`

**Step 3: Commit**
```bash
git add src/app/api/projects/[id]/route.ts
git commit -m "feat(api): add GET /api/projects/[id] single deal route"
```

---

## Task 2: Add new HubSpot properties to `hubspot.ts`

**Files:**
- Modify: `src/lib/hubspot.ts`

**Context:**
- `DEAL_PROPERTIES` array ends at line 538
- `Project` interface ends at line 378
- `transformDealToProject` is at line 614; the return object is a large literal — add new fields at the end of the return, in the "Team" section area

**Step 1: Add properties to `DEAL_PROPERTIES` array**

Find the closing `];` of `DEAL_PROPERTIES` (line 538) and insert before it:

```typescript
  // External system links & folder IDs
  "design_document_folder_id",
  "g_drive",
  "link_to_opensolar",
  "os_project_link",
  "os_project_id",
  "zuper_site_survey_uid",
```

**Step 2: Add fields to `Project` interface**

After the closing brace of the QC metrics section (before line 378 `}`), add:

```typescript
  // External links & folder IDs
  designFolderUrl: string | null;   // design_document_folder_id (Drive folder ID)
  driveUrl: string | null;          // g_drive (general Drive folder link)
  openSolarUrl: string | null;      // os_project_link or link_to_opensolar
  openSolarId: string | null;       // os_project_id
  zuperUid: string | null;          // zuper_site_survey_uid
```

**Step 3: Add mapping in `transformDealToProject`**

Find the closing `};` of the return object (around line 800+) and add before it:

```typescript
    // External links
    designFolderUrl: String(deal.design_document_folder_id || "").trim() || null,
    driveUrl: String(deal.g_drive || "").trim() || null,
    openSolarUrl: String(deal.os_project_link || deal.link_to_opensolar || "").trim() || null,
    openSolarId: String(deal.os_project_id || "").trim() || null,
    zuperUid: String(deal.zuper_site_survey_uid || "").trim() || null,
```

**Step 4: Verify build**
```bash
npm run build 2>&1 | grep -E "error TS|Error:|✓ Compiled"
```
Expected: `✓ Compiled successfully`

**Step 5: Commit**
```bash
git add src/lib/hubspot.ts
git commit -m "feat(hubspot): add design folder, Drive, OpenSolar, Zuper fields to Project"
```

---

## Task 3: URL persistence in BOM page — `?deal=` param

**Files:**
- Modify: `src/app/dashboards/bom/page.tsx`

**Context:**
- `linkedProject` state is at line 353
- `ProjectResult` interface at line 58: `{ hs_object_id, dealname, address? }`
- `handleProjectSearch` is at line 640 area
- The clear button handler is around line 950
- Page currently exports `default function BomDashboard()`

**Step 1: Add imports at top of file**

The file already imports `React, useState, useCallback, useRef, useEffect`. Add `useRouter` and `useSearchParams`:

```typescript
import { useRouter, useSearchParams } from "next/navigation";
```

**Step 2: Add router + searchParams inside the component**

After `const { addToast } = useToast();` add:

```typescript
  const router = useRouter();
  const searchParams = useSearchParams();
```

**Step 3: Add `useEffect` to load deal from URL param on mount**

Add after the existing history-loading `useEffect`:

```typescript
  /* ---- Load deal from ?deal= URL param on mount ---- */
  useEffect(() => {
    const dealId = searchParams.get("deal");
    if (!dealId || linkedProject) return;
    fetch(`/api/projects/${encodeURIComponent(dealId)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: { project: { id: number; name: string; address: string; designFolderUrl: string | null; driveUrl: string | null; openSolarUrl: string | null; zuperUid: string | null } }) => {
        const p = data.project;
        setLinkedProject({
          hs_object_id: String(p.id),
          dealname: p.name,
          address: p.address,
          designFolderUrl: p.designFolderUrl,
          driveUrl: p.driveUrl,
          openSolarUrl: p.openSolarUrl,
          zuperUid: p.zuperUid,
        });
      })
      .catch(() => {/* silent — bad param, just ignore */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
```

**Step 4: Update `ProjectResult` interface to include new fields**

```typescript
interface ProjectResult {
  hs_object_id: string;
  dealname: string;
  address?: string;
  designFolderUrl?: string | null;
  driveUrl?: string | null;
  openSolarUrl?: string | null;
  zuperUid?: string | null;
}
```

**Step 5: Update project search selection to push URL param and include new fields**

Find the project search results `onClick` handler (around line 1060). Replace `setLinkedProject(p)` block:

```typescript
onClick={() => {
  setLinkedProject(p);
  setProjectSearch("");
  setProjectResults([]);
  setSavedVersion(null);
  router.replace(`/dashboards/bom?deal=${encodeURIComponent(p.hs_object_id)}`);
}}
```

**Step 6: Update `/api/projects` search to return new fields in results**

Find the projects search result mapper in `src/app/api/projects/route.ts`. The response already returns full `Project` objects — the `ProjectResult` shape is just what the BOM page picks out. The new fields (`designFolderUrl`, etc.) will already be present in the response after Task 2. The BOM page just needs to pick them up when setting `linkedProject`.

Update the search result `onClick` to also extract the new fields from the search result:

```typescript
onClick={() => {
  setLinkedProject({
    hs_object_id: p.hs_object_id,
    dealname: p.dealname,
    address: p.address,
    designFolderUrl: (p as ProjectResult & { designFolderUrl?: string }).designFolderUrl,
    driveUrl: (p as ProjectResult & { driveUrl?: string }).driveUrl,
    openSolarUrl: (p as ProjectResult & { openSolarUrl?: string }).openSolarUrl,
    zuperUid: (p as ProjectResult & { zuperUid?: string }).zuperUid,
  });
  ...
}}
```

Note: the projects search API returns slim objects. Update the search fetch to request the new fields — or just use the `/api/projects/[id]` route after selection. Simpler: after `setLinkedProject(p)` fires, a second fetch to `/api/projects/${p.hs_object_id}` enriches the project. **Simplest approach:** just update the search to return the extra fields (they're already in `Project` after Task 2).

**Step 7: Update Unlink to clear URL param**

Find `onClick={() => { setLinkedProject(null); setSnapshots([]); setSavedVersion(null); }}` and add:

```typescript
router.replace("/dashboards/bom");
```

**Step 8: Update Clear button similarly**

Find the Clear button handler and add `router.replace("/dashboards/bom");`

**Step 9: Update search placeholder**

Change `"Search by project name or address…"` to `"Search by name, address, or project number…"`

**Step 10: Verify build**
```bash
npm run build 2>&1 | grep -E "error TS|Error:|✓ Compiled"
```

**Step 11: Commit**
```bash
git add src/app/dashboards/bom/page.tsx
git commit -m "feat(bom): URL-based deal persistence via ?deal= param"
```

---

## Task 4: Quick links panel UI

**Files:**
- Modify: `src/app/dashboards/bom/page.tsx`

**Context:**
- The project link card is around line 1020 in the JSX
- `linkedProject` now has `designFolderUrl`, `driveUrl`, `openSolarUrl`, `zuperUid`
- Zuper app URL pattern: `https://app.zuper.co/jobs/<zuperUid>` (confirm with team if different)
- HubSpot deal URL: `https://app.hubspot.com/contacts/21710069/deal/<hs_object_id>`

**Step 1: Add `QuickLinks` sub-component at bottom of file** (after `CatalogDot`)

```tsx
function QuickLinks({ project }: { project: ProjectResult }) {
  const links: Array<{ label: string; href: string; color: string }> = [
    {
      label: "HubSpot",
      href: `https://app.hubspot.com/contacts/21710069/deal/${project.hs_object_id}`,
      color: "text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800",
    },
  ];

  if (project.driveUrl) {
    links.push({ label: "G-Drive", href: project.driveUrl, color: "text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800" });
  }
  if (project.openSolarUrl) {
    links.push({ label: "OpenSolar", href: project.openSolarUrl, color: "text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800" });
  }
  if (project.zuperUid) {
    links.push({ label: "Zuper", href: `https://app.zuper.co/jobs/${project.zuperUid}`, color: "text-cyan-600 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800" });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {links.map(({ label, href, color }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg border text-xs font-medium bg-surface hover:bg-surface-2 transition-colors ${color}`}
        >
          {label} ↗
        </a>
      ))}
    </div>
  );
}
```

**Step 2: Insert `<QuickLinks>` in JSX**

Find the project link card closing `</div>` (the one wrapping the whole "Link to HubSpot Project" card). Insert immediately after it, inside the `{bom && (<>...</>)}` block:

```tsx
{/* Quick Links */}
{linkedProject && (
  <div className="rounded-xl bg-surface border border-t-border p-4 shadow-card">
    <h3 className="text-xs font-semibold text-muted mb-2 uppercase tracking-wide">Quick Links</h3>
    <QuickLinks project={linkedProject} />
  </div>
)}
```

**Step 3: Build + commit**
```bash
npm run build 2>&1 | grep -E "error TS|Error:|✓ Compiled"
git add src/app/dashboards/bom/page.tsx
git commit -m "feat(bom): add quick links panel (HubSpot, Drive, OpenSolar, Zuper)"
```

---

## Task 5: `GET /api/bom/drive-files` — list PDFs in a Drive folder

**Files:**
- Create: `src/app/api/bom/drive-files/route.ts`

**Context:**
- `google-calendar.ts` has `getCredentials()`, `parseServiceAccountPrivateKey()`, `getServiceAccountToken()`, `signRS256()`, `base64UrlEncode()` — we'll replicate the token pattern, not import it (it's not exported)
- Service account needs Drive read access granted to the design folders
- New env var needed: none (reuses `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`)
- The service account calls Drive as itself (no impersonation needed for shared folders — `sub` claim omitted)

**Step 1: Create a shared Google auth helper**

Create `src/lib/google-auth.ts`:

```typescript
// src/lib/google-auth.ts
// Shared Google service account JWT helper — used by Drive, Gmail, Calendar

import crypto from "crypto";

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function parsePrivateKey(raw: string): string {
  return raw.replace(/\\n/g, "\n").trim();
}

async function signRS256(input: string, privateKeyPem: string): Promise<string> {
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(input);
  sign.end();
  const sig = sign.sign(privateKeyPem);
  return sig.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export async function getServiceAccountToken(scopes: string[], impersonateEmail?: string): Promise<string> {
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!serviceAccountEmail || !rawKey) throw new Error("Google service account credentials not configured");

  const privateKey = parsePrivateKey(rawKey);
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    iss: serviceAccountEmail,
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  if (impersonateEmail) claims.sub = impersonateEmail;

  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify(claims));
  const sig = await signRS256(`${header}.${payload}`, privateKey);
  const jwt = `${header}.${payload}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json() as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`Google token error: ${data.error ?? "unknown"}`);
  return data.access_token;
}
```

**Step 2: Create the drive-files route**

```typescript
// src/app/api/bom/drive-files/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getServiceAccountToken } from "@/lib/google-auth";

export const runtime = "nodejs";
export const maxDuration = 15;

interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  size: string;
}

export async function GET(request: NextRequest) {
  const session = await requireApiAuth(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const folderId = request.nextUrl.searchParams.get("folderId");
  if (!folderId) return NextResponse.json({ error: "folderId required" }, { status: 400 });

  try {
    const token = await getServiceAccountToken([
      "https://www.googleapis.com/auth/drive.readonly",
    ]);

    const query = encodeURIComponent(
      `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`
    );
    const fields = encodeURIComponent("files(id,name,modifiedTime,size)");
    const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&orderBy=modifiedTime+desc`;

    const driveRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!driveRes.ok) {
      const err = await driveRes.json().catch(() => ({})) as { error?: { message?: string } };
      return NextResponse.json(
        { files: [], error: err.error?.message ?? `Drive error ${driveRes.status}` },
        { status: 200 } // Return 200 with empty list so UI can show graceful message
      );
    }

    const data = await driveRes.json() as { files: DriveFile[] };
    return NextResponse.json({ files: data.files ?? [] });
  } catch (e) {
    return NextResponse.json(
      { files: [], error: e instanceof Error ? e.message : "Drive fetch failed" },
      { status: 200 }
    );
  }
}
```

**Step 3: Build + commit**
```bash
npm run build 2>&1 | grep -E "error TS|Error:|✓ Compiled"
git add src/lib/google-auth.ts src/app/api/bom/drive-files/route.ts
git commit -m "feat(bom): add Drive file listing via service account JWT"
```

---

## Task 6: Design files picker UI in BOM page

**Files:**
- Modify: `src/app/dashboards/bom/page.tsx`

**Step 1: Add `DriveFile` type and `driveFiles` state**

Add type near other interfaces:
```typescript
interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  size: string;
}
```

Add state after `savedVersion` state:
```typescript
const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
const [driveFilesLoading, setDriveFilesLoading] = useState(false);
const [driveFilesError, setDriveFilesError] = useState<string | null>(null);
const [extractingDriveFileId, setExtractingDriveFileId] = useState<string | null>(null);
```

**Step 2: Add `useEffect` to load Drive files when project with folder is linked**

After the history-loading `useEffect`:

```typescript
/* ---- Load Drive design files when project has a design folder ---- */
useEffect(() => {
  const folderId = linkedProject?.designFolderUrl;
  if (!folderId) { setDriveFiles([]); return; }
  setDriveFilesLoading(true);
  setDriveFilesError(null);
  fetch(`/api/bom/drive-files?folderId=${encodeURIComponent(folderId)}`)
    .then((r) => r.json())
    .then((data: { files: DriveFile[]; error?: string }) => {
      setDriveFiles(data.files ?? []);
      if (data.error) setDriveFilesError(data.error);
    })
    .catch(() => setDriveFilesError("Failed to load design files"))
    .finally(() => setDriveFilesLoading(false));
}, [linkedProject?.designFolderUrl]);
```

**Step 3: Add `handleExtractDriveFile` callback**

```typescript
/* ---- Extract from a Drive file ID directly (from design files picker) ---- */
const handleExtractDriveFile = useCallback(async (file: DriveFile) => {
  setExtractingDriveFileId(file.id);
  setImportError(null);
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${file.id}`;
  try {
    const proxyRes = await fetch("/api/bom/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driveUrl: downloadUrl, fileId: file.id }),
    });
    const data = await safeFetchBom(proxyRes);
    loadBomData(data);
    addToast({ type: "success", title: `BOM extracted from ${file.name}` });
    if (linkedProject) await saveSnapshot(data, file.name, downloadUrl);
  } catch (e) {
    addToast({ type: "error", title: e instanceof Error ? e.message : "Extraction failed" });
  } finally {
    setExtractingDriveFileId(null);
  }
}, [safeFetchBom, loadBomData, addToast, linkedProject, saveSnapshot]);
```

**Step 4: Add Design Files card in JSX**

Place after the Quick Links panel, before the action bar:

```tsx
{/* Design Files — from HubSpot design_document_folder_id */}
{linkedProject?.designFolderUrl && (bom || driveFiles.length > 0 || driveFilesLoading) && (
  <div className="rounded-xl bg-surface border border-t-border shadow-card overflow-hidden">
    <div className="flex items-center justify-between px-5 py-3 border-b border-t-border bg-surface-2">
      <h3 className="text-sm font-semibold text-foreground">
        Design Files
        {!driveFilesLoading && driveFiles.length > 0 && (
          <span className="ml-2 text-xs text-muted font-normal">{driveFiles.length} PDF{driveFiles.length !== 1 ? "s" : ""}</span>
        )}
      </h3>
    </div>
    {driveFilesLoading ? (
      <p className="px-5 py-4 text-xs text-muted animate-pulse">Loading files…</p>
    ) : driveFilesError ? (
      <p className="px-5 py-4 text-xs text-red-500">{driveFilesError}</p>
    ) : driveFiles.length === 0 ? (
      <p className="px-5 py-4 text-xs text-muted">No PDFs found in design folder.</p>
    ) : (
      <div className="divide-y divide-[color:var(--border)]">
        {driveFiles.map((file) => {
          const isExtracting = extractingDriveFileId === file.id;
          const anyExtracting = extractingDriveFileId !== null;
          const sizeKb = file.size ? Math.round(Number(file.size) / 1024) : null;
          return (
            <button
              key={file.id}
              onClick={() => handleExtractDriveFile(file)}
              disabled={anyExtracting}
              className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-surface-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
            >
              <span className="text-lg flex-shrink-0">{isExtracting ? "⏳" : "📄"}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground font-medium truncate">{file.name}</p>
                <p className="text-xs text-muted">
                  {new Date(file.modifiedTime).toLocaleDateString()}
                  {sizeKb && ` · ${sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`}`}
                </p>
              </div>
              {isExtracting ? (
                <span className="text-xs text-cyan-500 animate-pulse">Extracting…</span>
              ) : (
                <span className="text-xs text-muted opacity-0 group-hover:opacity-100 transition-opacity">Extract →</span>
              )}
            </button>
          );
        })}
      </div>
    )}
  </div>
)}
```

**Step 5: Build + commit**
```bash
npm run build 2>&1 | grep -E "error TS|Error:|✓ Compiled"
git add src/app/dashboards/bom/page.tsx
git commit -m "feat(bom): add Design Files picker from Drive folder"
```

---

## Task 7: Install `@react-pdf/renderer` + create `BomPdfDocument` component

**Files:**
- Create: `src/components/BomPdfDocument.tsx`

**Step 1: Install package**
```bash
cd /Users/zach/Downloads/PB-Operations-Suite
npm install @react-pdf/renderer
```

**Step 2: Create the PDF document component**

```typescript
// src/components/BomPdfDocument.tsx
// Server-only — used exclusively by /api/bom/export-pdf, never imported client-side
import React from "react";
import {
  Document, Page, Text, View, StyleSheet, Font,
} from "@react-pdf/renderer";

// Type-only import to avoid bundling issues
type BomData = {
  project: {
    customer?: string; address?: string;
    systemSizeKwdc?: number | string; systemSizeKwac?: number | string;
    moduleCount?: number | string; plansetRev?: string; stampDate?: string;
    utility?: string; ahj?: string;
  };
  items: Array<{
    category: string; brand: string | null; model: string | null;
    description: string; qty: number | string;
    unitSpec?: string | number | null; unitLabel?: string | null;
  }>;
  validation?: {
    moduleCountMatch?: boolean | null;
    batteryCapacityMatch?: boolean | null;
    ocpdMatch?: boolean | null;
    warnings?: string[];
  };
};

const CATEGORY_ORDER = [
  "MODULE", "BATTERY", "INVERTER", "EV_CHARGER",
  "RAPID_SHUTDOWN", "RACKING", "ELECTRICAL_BOS", "MONITORING",
];
const CATEGORY_LABELS: Record<string, string> = {
  MODULE: "Modules", BATTERY: "Storage", INVERTER: "Inverter",
  EV_CHARGER: "EV Charger", RAPID_SHUTDOWN: "Rapid Shutdown",
  RACKING: "Racking & Mounting", ELECTRICAL_BOS: "Electrical BOS",
  MONITORING: "Monitoring",
};

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, padding: 36, color: "#1a1a1a" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16, borderBottomWidth: 2, borderBottomColor: "#0891b2", paddingBottom: 10 },
  headerLeft: { flex: 1 },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", color: "#0891b2" },
  subtitle: { fontSize: 10, color: "#555", marginTop: 2 },
  meta: { fontSize: 8, color: "#777", marginTop: 6 },
  sectionHeader: { backgroundColor: "#f0f9ff", padding: "4 8", marginTop: 10, marginBottom: 2, flexDirection: "row", alignItems: "center" },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 9, color: "#0891b2" },
  table: { borderWidth: 1, borderColor: "#e5e7eb" },
  tableHeader: { flexDirection: "row", backgroundColor: "#f9fafb", borderBottomWidth: 1, borderBottomColor: "#e5e7eb" },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8, padding: "3 5", color: "#6b7280" },
  td: { fontSize: 8, padding: "3 5", color: "#1a1a1a" },
  colBrand: { width: "18%" }, colModel: { width: "22%" },
  colDesc: { width: "38%" }, colQty: { width: "8%" }, colSpec: { width: "14%" },
  validation: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12, padding: 8, backgroundColor: "#f9fafb", borderWidth: 1, borderColor: "#e5e7eb" },
  validBadge: { fontSize: 8, padding: "2 6", borderRadius: 4 },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: "#aaa" },
});

function validLabel(v: boolean | null | undefined): string {
  if (v === true) return "✓";
  if (v === false) return "✗";
  return "–";
}

export function BomPdfDocument({
  bom, dealName, version, generatedBy, generatedAt,
}: {
  bom: BomData;
  dealName?: string;
  version?: number;
  generatedBy?: string;
  generatedAt: string;
}) {
  const { project, items, validation } = bom;
  const grouped = CATEGORY_ORDER.reduce<Record<string, typeof items>>((acc, cat) => {
    const catItems = items.filter((i) => i.category === cat);
    if (catItems.length) acc[cat] = catItems;
    return acc;
  }, {});

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>Planset BOM</Text>
            <Text style={styles.subtitle}>{project.customer ?? dealName ?? "—"}</Text>
            {project.address && <Text style={styles.meta}>{project.address}</Text>}
            <Text style={styles.meta}>
              {[
                project.moduleCount && `${project.moduleCount} modules`,
                project.systemSizeKwdc && `${project.systemSizeKwdc} kWdc`,
                project.systemSizeKwac && `${project.systemSizeKwac} kWac`,
              ].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <View>
            {project.plansetRev && <Text style={styles.meta}>Rev {project.plansetRev}</Text>}
            {project.stampDate && <Text style={styles.meta}>Stamped {project.stampDate}</Text>}
            {version && <Text style={styles.meta}>v{version}</Text>}
          </View>
        </View>

        {/* BOM Sections */}
        {CATEGORY_ORDER.filter((cat) => grouped[cat]).map((cat) => (
          <View key={cat}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{CATEGORY_LABELS[cat] ?? cat}</Text>
            </View>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.th, styles.colBrand]}>Brand</Text>
                <Text style={[styles.th, styles.colModel]}>Model</Text>
                <Text style={[styles.th, styles.colDesc]}>Description</Text>
                <Text style={[styles.th, styles.colQty]}>Qty</Text>
                <Text style={[styles.th, styles.colSpec]}>Spec</Text>
              </View>
              {grouped[cat].map((item, i) => (
                <View key={i} style={[styles.tableRow, i % 2 === 1 ? { backgroundColor: "#fafafa" } : {}]}>
                  <Text style={[styles.td, styles.colBrand]}>{item.brand ?? "—"}</Text>
                  <Text style={[styles.td, styles.colModel]}>{item.model ?? "—"}</Text>
                  <Text style={[styles.td, styles.colDesc]}>{item.description}</Text>
                  <Text style={[styles.td, styles.colQty]}>{String(item.qty)}</Text>
                  <Text style={[styles.td, styles.colSpec]}>
                    {item.unitSpec != null ? `${item.unitSpec}${item.unitLabel ? ` ${item.unitLabel}` : ""}` : ""}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ))}

        {/* Validation */}
        {validation && (
          <View style={styles.validation}>
            <Text style={[styles.validBadge, { backgroundColor: validation.moduleCountMatch ? "#dcfce7" : "#fee2e2" }]}>
              {validLabel(validation.moduleCountMatch)} Module count
            </Text>
            <Text style={[styles.validBadge, { backgroundColor: validation.batteryCapacityMatch ? "#dcfce7" : validation.batteryCapacityMatch === false ? "#fee2e2" : "#f3f4f6" }]}>
              {validLabel(validation.batteryCapacityMatch)} Battery kWh
            </Text>
            <Text style={[styles.validBadge, { backgroundColor: validation.ocpdMatch ? "#dcfce7" : validation.ocpdMatch === false ? "#fee2e2" : "#f3f4f6" }]}>
              {validLabel(validation.ocpdMatch)} OCPD
            </Text>
            {validation.warnings?.map((w, i) => (
              <Text key={i} style={[styles.validBadge, { backgroundColor: "#fef9c3" }]}>⚠ {w}</Text>
            ))}
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>Generated by PB Ops · {generatedAt}</Text>
          <Text>{generatedBy ?? ""}</Text>
        </View>
      </Page>
    </Document>
  );
}
```

**Step 3: Build + commit**
```bash
npm run build 2>&1 | grep -E "error TS|Error:|✓ Compiled"
git add src/components/BomPdfDocument.tsx package.json package-lock.json
git commit -m "feat(bom): add BomPdfDocument react-pdf component"
```

---

## Task 8: `POST /api/bom/export-pdf` route

**Files:**
- Create: `src/app/api/bom/export-pdf/route.ts`

**Context:**
- `@react-pdf/renderer` exports `renderToBuffer` for server-side rendering
- Route accepts either `snapshotId` (fetch from DB) or raw `bomData` in body
- Must use `nodejs` runtime (not edge — `@react-pdf/renderer` requires Node)

```typescript
// src/app/api/bom/export-pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { BomPdfDocument } from "@/components/BomPdfDocument";
import React from "react";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const session = await requireApiAuth(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    snapshotId?: string;
    bomData?: unknown;
    dealName?: string;
    version?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let bomData: unknown = body.bomData;
  let dealName: string | undefined = body.dealName;
  let version: number | undefined = body.version;

  if (body.snapshotId) {
    const snap = await prisma.projectBomSnapshot.findUnique({
      where: { id: body.snapshotId },
      select: { bomData: true, dealName: true, version: true },
    });
    if (!snap) return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
    bomData = snap.bomData;
    dealName = snap.dealName;
    version = snap.version;
  }

  if (!bomData) return NextResponse.json({ error: "bomData required" }, { status: 400 });

  const generatedAt = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
  const email = session.user?.email ?? undefined;
  const safeName = (dealName ?? "BOM").replace(/[^a-z0-9_-]/gi, "_");
  const filename = version ? `BOM-${safeName}-v${version}.pdf` : `BOM-${safeName}.pdf`;

  try {
    const buffer = await renderToBuffer(
      React.createElement(BomPdfDocument, {
        bom: bomData as Parameters<typeof BomPdfDocument>[0]["bom"],
        dealName,
        version,
        generatedBy: email,
        generatedAt,
      })
    );

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "PDF generation failed" },
      { status: 500 }
    );
  }
}
```

**Step 2: Build + commit**
```bash
npm run build 2>&1 | grep -E "error TS|Error:|✓ Compiled"
git add src/app/api/bom/export-pdf/route.ts
git commit -m "feat(bom): add PDF export API route via react-pdf"
```

---

## Task 9: PDF export + Print buttons in BOM page

**Files:**
- Modify: `src/app/dashboards/bom/page.tsx`

**Step 1: Add `handleExportPdf` callback** (after `handleSaveInventory`)

```typescript
/* ---- Export PDF ---- */
const handleExportPdf = useCallback(async () => {
  if (!bom) return;
  try {
    const res = await fetch("/api/bom/export-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bomData: { ...bom, items: items.map(({ id: _id, ...rest }) => rest) },
        dealName: linkedProject?.dealname,
        version: savedVersion ?? undefined,
      }),
    });
    if (!res.ok) throw new Error(`PDF export failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `BOM-${(bom.project.customer ?? linkedProject?.dealname ?? "export").replace(/\s+/g, "_")}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    addToast({ type: "error", title: e instanceof Error ? e.message : "PDF export failed" });
  }
}, [bom, items, linkedProject, savedVersion, addToast]);
```

**Step 2: Add buttons to action bar**

Find the action bar div (the one with `↓ Export CSV`, `⎘ Copy Markdown`, `↑ Save to Inventory`). Add after Save to Inventory:

```tsx
<button
  onClick={handleExportPdf}
  className="px-4 py-2 rounded-lg bg-surface border border-t-border text-sm text-foreground hover:bg-surface-2 transition-colors"
>
  ↓ Export PDF
</button>
<button
  onClick={() => window.print()}
  className="px-4 py-2 rounded-lg bg-surface border border-t-border text-sm text-foreground hover:bg-surface-2 transition-colors"
>
  🖨 Print
</button>
```

**Step 3: Add print CSS**

Add a `<style>` tag inside the component return, as the first child of the outermost `<DashboardShell>` wrapper — or better, add it as a sibling `<>` fragment:

Replace the outer return with:
```tsx
return (
  <>
    <style>{`
      @media print {
        nav, header, [data-dashboard-shell-header], [data-dashboard-shell-nav],
        .action-bar, .history-panel, .diff-panel, .import-panel,
        .quick-links-panel, .design-files-panel {
          display: none !important;
        }
        body { background: white !important; }
        .bom-table-section { page-break-inside: avoid; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #e5e7eb; padding: 4px 8px; font-size: 11px; }
      }
    `}</style>
    <DashboardShell title="Planset BOM" accentColor="cyan">
      ...
    </DashboardShell>
  </>
);
```

Also add `className="bom-table-section"` to each category table wrapper div.

**Step 4: Build + commit**
```bash
npm run build 2>&1 | grep -E "error TS|Error:|✓ Compiled"
git add src/app/dashboards/bom/page.tsx
git commit -m "feat(bom): add Export PDF and Print buttons"
```

---

## Task 10: `POST /api/bom/notify` — Gmail notification

**Files:**
- Create: `src/app/api/bom/notify/route.ts`

**Context:**
- Uses `google-auth.ts` from Task 5
- Gmail API requires service account with domain-wide delegation
- Scope: `https://www.googleapis.com/auth/gmail.send`
- Must impersonate a real Google Workspace user (e.g. `ops@photonbrothers.com`) — set as `GMAIL_SENDER_EMAIL` env var
- RFC 2822 message must be base64url-encoded for the Gmail API

```typescript
// src/app/api/bom/notify/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getServiceAccountToken } from "@/lib/google-auth";

export const runtime = "nodejs";
export const maxDuration = 15;

function makeRfc2822(opts: {
  from: string; to: string; subject: string; html: string;
}): string {
  const boundary = `boundary_${Date.now()}`;
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    opts.html,
    ``,
    `--${boundary}--`,
  ];
  return lines.join("\r\n");
}

function base64url(str: string): string {
  return Buffer.from(str).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export async function POST(request: NextRequest) {
  const session = await requireApiAuth(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const senderEmail = process.env.GMAIL_SENDER_EMAIL;
  if (!senderEmail) {
    // Silently skip if not configured — don't fail the BOM save
    return NextResponse.json({ skipped: true, reason: "GMAIL_SENDER_EMAIL not configured" });
  }

  let body: {
    userEmail: string;
    dealName: string;
    dealId: string;
    version: number;
    sourceFile?: string | null;
    itemCount: number;
    projectInfo?: {
      customer?: string;
      address?: string;
      systemSizeKwdc?: number | string;
      moduleCount?: number | string;
    };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userEmail, dealName, dealId, version, sourceFile, itemCount, projectInfo } = body;
  const bomUrl = `https://pbtechops.com/dashboards/bom?deal=${encodeURIComponent(dealId)}`;

  const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
  <div style="background:#0891b2;padding:20px 24px;border-radius:8px 8px 0 0">
    <h1 style="color:white;margin:0;font-size:20px">BOM v${version} Extracted</h1>
    <p style="color:#cffafe;margin:4px 0 0">${dealName}</p>
  </div>
  <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-top:none">
    ${projectInfo?.customer ? `<p style="margin:0 0 4px"><strong>${projectInfo.customer}</strong></p>` : ""}
    ${projectInfo?.address ? `<p style="margin:0 0 12px;color:#555">${projectInfo.address}</p>` : ""}
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">
      <tr><td style="padding:4px 0;color:#555">Version</td><td style="padding:4px 0"><strong>v${version}</strong></td></tr>
      <tr><td style="padding:4px 0;color:#555">Items</td><td style="padding:4px 0"><strong>${itemCount}</strong></td></tr>
      ${projectInfo?.systemSizeKwdc ? `<tr><td style="padding:4px 0;color:#555">System size</td><td style="padding:4px 0"><strong>${projectInfo.systemSizeKwdc} kWdc</strong></td></tr>` : ""}
      ${projectInfo?.moduleCount ? `<tr><td style="padding:4px 0;color:#555">Modules</td><td style="padding:4px 0"><strong>${projectInfo.moduleCount}</strong></td></tr>` : ""}
      ${sourceFile ? `<tr><td style="padding:4px 0;color:#555">Source</td><td style="padding:4px 0">${sourceFile}</td></tr>` : ""}
    </table>
    <a href="${bomUrl}" style="display:inline-block;background:#0891b2;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">View BOM →</a>
  </div>
  <p style="color:#aaa;font-size:12px;text-align:center;margin-top:12px">PB Ops · Photon Brothers</p>
</div>`;

  try {
    const token = await getServiceAccountToken(
      ["https://www.googleapis.com/auth/gmail.send"],
      senderEmail
    );

    const raw = base64url(makeRfc2822({
      from: `PB Ops <${senderEmail}>`,
      to: userEmail,
      subject: `BOM v${version} extracted — ${dealName}`,
      html,
    }));

    const gmailRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(senderEmail)}/messages/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
      }
    );

    if (!gmailRes.ok) {
      const err = await gmailRes.json().catch(() => ({})) as { error?: { message?: string } };
      console.error("[bom/notify] Gmail send failed:", err);
      return NextResponse.json({ error: err.error?.message ?? "Gmail error" }, { status: 500 });
    }

    return NextResponse.json({ sent: true });
  } catch (e) {
    console.error("[bom/notify]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Send failed" }, { status: 500 });
  }
}
```

**Step 2: Build + commit**
```bash
npm run build 2>&1 | grep -E "error TS|Error:|✓ Compiled"
git add src/app/api/bom/notify/route.ts src/lib/google-auth.ts
git commit -m "feat(bom): add Gmail notification route via service account"
```

---

## Task 11: Wire email into `saveSnapshot()`

**Files:**
- Modify: `src/app/dashboards/bom/page.tsx`

**Context:**
- `saveSnapshot` is a `useCallback` — `session.user.email` needs to come from `useSession()`
- `useSession` is from `next-auth/react` — already used elsewhere in the app

**Step 1: Add `useSession` import**
```typescript
import { useSession } from "next-auth/react";
```

**Step 2: Get session inside component**
```typescript
const { data: session } = useSession();
```

**Step 3: Add fire-and-forget notify call inside `saveSnapshot`, after the history reload**

```typescript
// Fire-and-forget email notification
if (session?.user?.email) {
  fetch("/api/bom/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userEmail: session.user.email,
      dealName: linkedProject.dealname,
      dealId: linkedProject.hs_object_id,
      version: saved.version,
      sourceFile,
      itemCount: bomData.items.length,
      projectInfo: {
        customer: bomData.project?.customer,
        address: bomData.project?.address,
        systemSizeKwdc: bomData.project?.systemSizeKwdc,
        moduleCount: bomData.project?.moduleCount,
      },
    }),
  }).catch(() => {/* silent */});
}
```

**Step 4: Add `session` to the `saveSnapshot` `useCallback` dependency array**

**Step 5: Build + commit**
```bash
npm run build 2>&1 | grep -E "error TS|Error:|✓ Compiled"
git add src/app/dashboards/bom/page.tsx
git commit -m "feat(bom): send Gmail notification after BOM save"
```

---

## Task 12: Environment variables + one-time Drive setup

**This task is operational, not code.**

**Step 1: Add env var to Vercel**
In Vercel dashboard → Project Settings → Environment Variables, add:
```
GMAIL_SENDER_EMAIL = ops@photonbrothers.com
```
(or whichever Google Workspace email should send the notifications — must be in the same Workspace as the service account)

**Step 2: Grant service account Gmail send permission**
In Google Workspace Admin → Security → API Controls → Domain-wide delegation:
- Add the service account client ID
- Scopes: `https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/drive.readonly`

**Step 3: Share design folders with service account**
In Google Drive, share each design folder (or their parent) with `GOOGLE_SERVICE_ACCOUNT_EMAIL` — Viewer access. This is a one-time step per folder hierarchy.

**Step 4: Deploy**
```bash
git push origin codex/push-main-bundle
```
Then deploy via Vercel dashboard or `vercel --prod`.

---

## Summary of new files

| File | Purpose |
|---|---|
| `src/lib/google-auth.ts` | Shared service account JWT helper |
| `src/app/api/projects/[id]/route.ts` | Single deal fetch |
| `src/app/api/bom/drive-files/route.ts` | List PDFs in Drive folder |
| `src/app/api/bom/export-pdf/route.ts` | Generate PDF via react-pdf |
| `src/app/api/bom/notify/route.ts` | Send Gmail notification |
| `src/components/BomPdfDocument.tsx` | react-pdf document component |

## Modified files

| File | What changes |
|---|---|
| `src/lib/hubspot.ts` | +5 properties + interface fields + transform mapping |
| `src/app/dashboards/bom/page.tsx` | URL persistence, quick links, design picker, PDF export, print, email wiring |
