# IDR Escalation Photo Attachments Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the design team attach photos/snips to an escalation in the IDR meeting hub — at add-time and in-meeting — stored in-app (private Vercel Blob), anchored to `dealId`, viewable during and after the meeting.

**Architecture:** A new `IdrEscalationPhoto` Prisma model keyed by `dealId` (stable across the escalation's queue-row/item hops). Upload/list/delete/patch routes reuse the existing private-blob + streaming-proxy pattern from `catalog/upload-photo` + `catalog/photo`. A pure blob-helper module holds validation constants + a small module for shared logic. UI: an uploader in `AddEscalationDialog` (deferred upload after escalation POST), an "Escalation Photos" gallery in `ProjectDetail` (escalation items only), and a count badge in `ProjectQueue` fed by a batched `groupBy` enrichment on the `sessions/[id]` GET and preview GET.

**Tech Stack:** Next.js 16 App Router, Prisma 7 (Neon), `@vercel/blob`, React Query v5, Jest.

**Spec:** `docs/superpowers/specs/2026-07-09-idr-escalation-photos-design.md` (committed on this branch).

**Ground rules:**
- Work in the worktree `/Users/zach/Downloads/Dev Projects/PB-Operations-Suite-esc-photos` (branch `feat/idr-escalation-photos`, already created; node_modules symlinked; prisma client generated once).
- NEVER run `prisma migrate deploy` / `db execute` / `db push` — migration file only. `npx prisma generate` is allowed.
- Test mock pattern for lib tests: module-level `jest.mock("@/lib/db", …)` / `jest.mock("@/lib/hubspot", …)` as in `src/__tests__/idr-review-types.test.ts`.
- Baseline: `npx tsc --noEmit` has errors only in unrelated `src/__tests__/**`; introduce zero outside that set. `npm run test` has ~36 pre-existing environmental suite failures unrelated to idr-meeting.
- Commit per task; end commit messages with:

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

---

## Chunk 1: Data + API

### Task 1: Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma` (add model near `IdrEscalationQueue`, ~line 2914)
- Create: `prisma/migrations/20260709010000_add_idr_escalation_photo/migration.sql`

- [ ] **Step 1.1:** Add the model:

```prisma
model IdrEscalationPhoto {
  id         String   @id @default(cuid())
  dealId     String
  blobPath   String
  fileName   String
  caption    String?
  sortOrder  Int      @default(0)
  uploadedBy String
  createdAt  DateTime @default(now())

  @@index([dealId])
}
```

- [ ] **Step 1.2:** Migration file (do NOT apply):

```sql
-- Escalation photo attachments, anchored to dealId (additive)
CREATE TABLE "IdrEscalationPhoto" (
  "id"         TEXT NOT NULL,
  "dealId"     TEXT NOT NULL,
  "blobPath"   TEXT NOT NULL,
  "fileName"   TEXT NOT NULL,
  "caption"    TEXT,
  "sortOrder"  INTEGER NOT NULL DEFAULT 0,
  "uploadedBy" TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IdrEscalationPhoto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IdrEscalationPhoto_dealId_idx" ON "IdrEscalationPhoto"("dealId");
```

- [ ] **Step 1.3:** `npx prisma generate` — expect exit 0; `IdrEscalationPhoto` present in `src/generated/prisma`.
- [ ] **Step 1.4:** Commit: `feat(idr): add IdrEscalationPhoto model + migration`

### Task 2: Blob helper module (TDD)

Pure validation + path helpers shared by the routes. No Prisma/Next imports so it's unit-testable.

**Files:**
- Create: `src/lib/idr-escalation-photos.ts`
- Test: `src/__tests__/idr-escalation-photos.test.ts`

- [ ] **Step 2.1:** Write failing tests:

```ts
import { describe, it, expect } from "@jest/globals";
import {
  ESCALATION_PHOTO_PREFIX,
  ALLOWED_PHOTO_TYPES,
  MAX_PHOTO_BYTES,
  validatePhotoUpload,
  isAllowedPhotoPath,
  photoViewerUrl,
} from "@/lib/idr-escalation-photos";

describe("validatePhotoUpload", () => {
  it("accepts a jpeg under the size cap", () => {
    expect(validatePhotoUpload("image/jpeg", 1_000_000)).toBeNull();
  });
  it("rejects a disallowed type", () => {
    expect(validatePhotoUpload("application/pdf", 10)).toMatch(/JPEG|PNG|WebP|GIF/);
  });
  it("rejects an oversized file", () => {
    expect(validatePhotoUpload("image/png", MAX_PHOTO_BYTES + 1)).toMatch(/5\s?MB/i);
  });
});

describe("isAllowedPhotoPath", () => {
  it("accepts a path under the prefix", () => {
    expect(isAllowedPhotoPath(`${ESCALATION_PHOTO_PREFIX}abc.png`)).toBe(true);
  });
  it("rejects paths outside the prefix or with ..", () => {
    expect(isAllowedPhotoPath("catalog-photos/x.png")).toBe(false);
    expect(isAllowedPhotoPath(`${ESCALATION_PHOTO_PREFIX}../secret`)).toBe(false);
  });
});

describe("photoViewerUrl", () => {
  it("builds an encoded same-origin proxy url", () => {
    expect(photoViewerUrl("escalation-photos/a b.png"))
      .toBe("/api/idr-meeting/escalation-photos/view?path=escalation-photos%2Fa%20b.png");
  });
});
```

- [ ] **Step 2.2:** Run → FAIL (module missing). Implement:

```ts
export const ESCALATION_PHOTO_PREFIX = "escalation-photos/";
export const ALLOWED_PHOTO_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
]);
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

/** Returns an error string if invalid, else null. */
export function validatePhotoUpload(type: string, size: number): string | null {
  if (!ALLOWED_PHOTO_TYPES.has(type)) {
    return "Only JPEG, PNG, WebP, and GIF images are allowed";
  }
  if (size > MAX_PHOTO_BYTES) return "Image must be under 5 MB";
  return null;
}

/** Guard for the streaming proxy: only our prefix, no traversal. */
export function isAllowedPhotoPath(path: string): boolean {
  return path.startsWith(ESCALATION_PHOTO_PREFIX) && !path.includes("..");
}

/** Same-origin proxy URL for a private blob pathname. */
export function photoViewerUrl(blobPath: string): string {
  return `/api/idr-meeting/escalation-photos/view?path=${encodeURIComponent(blobPath)}`;
}
```

- [ ] **Step 2.3:** Run → PASS. Commit: `feat(idr): escalation-photo validation + path helpers`

### Task 3: Upload + list route (`POST`/`GET`)

**Files:**
- Create: `src/app/api/idr-meeting/escalation-photos/route.ts`

- [ ] **Step 3.1:** Implement (mirrors `catalog/upload-photo` for storage; auth via `isIdrAllowedRole`):

```ts
import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { validatePhotoUpload, photoViewerUrl, ESCALATION_PHOTO_PREFIX } from "@/lib/idr-escalation-photos";
import { appCache } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const dealId = req.nextUrl.searchParams.get("dealId");
  if (!dealId) return NextResponse.json({ error: "Missing dealId" }, { status: 400 });

  const photos = await prisma.idrEscalationPhoto.findMany({
    where: { dealId },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json({
    photos: photos.map((p) => ({ ...p, viewerUrl: photoViewerUrl(p.blobPath) })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  const dealId = form.get("dealId");
  const caption = form.get("caption");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (typeof dealId !== "string" || !dealId) return NextResponse.json({ error: "Missing dealId" }, { status: 400 });

  const invalid = validatePhotoUpload(file.type, file.size);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("[idr/escalation-photos] Upload blocked: BLOB_READ_WRITE_TOKEN missing");
    return NextResponse.json({ error: "Blob storage not configured — contact an admin." }, { status: 503 });
  }

  const blob = await put(`${ESCALATION_PHOTO_PREFIX}${file.name}`, file, {
    access: "private",
    addRandomSuffix: true,
  });

  const max = await prisma.idrEscalationPhoto.aggregate({
    where: { dealId },
    _max: { sortOrder: true },
  });

  const photo = await prisma.idrEscalationPhoto.create({
    data: {
      dealId,
      blobPath: blob.pathname,
      fileName: file.name,
      caption: typeof caption === "string" && caption.trim() ? caption.trim() : null,
      sortOrder: (max._max.sortOrder ?? -1) + 1,
      uploadedBy: auth.email,
    },
  });

  appCache.invalidate("idr-meeting:preview");
  return NextResponse.json({ ...photo, viewerUrl: photoViewerUrl(photo.blobPath) }, { status: 201 });
}
```

- [ ] **Step 3.2:** `npx tsc --noEmit` (zero non-test errors); `npx eslint` the new file. Commit: `feat(idr): escalation-photos upload + list route`

### Task 4: Viewer proxy + item routes (`view`, `[id]` DELETE/PATCH)

**Files:**
- Create: `src/app/api/idr-meeting/escalation-photos/view/route.ts`
- Create: `src/app/api/idr-meeting/escalation-photos/[id]/route.ts`

- [ ] **Step 4.1:** Viewer (mirrors `catalog/photo`, but IDR-gated + our prefix guard):

```ts
import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { requireApiAuth } from "@/lib/api-auth";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { isAllowedPhotoPath } from "@/lib/idr-escalation-photos";

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "Missing path" }, { status: 400 });
  if (!isAllowedPhotoPath(path)) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  try {
    const result = await get(path, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": result.blob?.contentType || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[idr/escalation-photos/view] Fetch failed:", msg);
    return NextResponse.json({ error: `Fetch failed: ${msg}` }, { status: 500 });
  }
}
```

- [ ] **Step 4.2:** Item route (DELETE removes blob then row; PATCH updates caption/sortOrder):

```ts
import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { photoViewerUrl } from "@/lib/idr-escalation-photos";
import { appCache } from "@/lib/cache";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const photo = await prisma.idrEscalationPhoto.findUnique({ where: { id } });
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await del(photo.blobPath);
  } catch (err) {
    // Non-fatal: still remove the row so the user isn't stuck with a ghost.
    console.error("[idr/escalation-photos] Blob delete failed (continuing):", err);
  }
  await prisma.idrEscalationPhoto.delete({ where: { id } });
  appCache.invalidate("idr-meeting:preview");
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: { caption?: string | null; sortOrder?: number } = {};
  if ("caption" in body) data.caption = typeof body.caption === "string" && body.caption.trim() ? body.caption.trim() : null;
  if ("sortOrder" in body && typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;

  const photo = await prisma.idrEscalationPhoto.update({ where: { id }, data });
  return NextResponse.json({ ...photo, viewerUrl: photoViewerUrl(photo.blobPath) });
}
```

- [ ] **Step 4.3:** `npx tsc --noEmit`; `npx eslint` both files. Commit: `feat(idr): escalation-photo viewer proxy + delete/patch routes`

### Task 4b: Route-behavior tests (TDD-after, thin)

The storage plumbing is copied from proven catalog routes, so cover only the novel branches the spec calls out. Pure-ish: mock `@/lib/db`, `@vercel/blob`, and `@/lib/api-auth`.

**Files:**
- Test: `src/__tests__/api/idr-escalation-photos.test.ts`

- [ ] **Step 4b.1:** Write tests:
  - `GET`/`POST`/`DELETE` return 403 when `requireApiAuth` resolves a non-IDR role (mock `isIdrAllowedRole` via the real module — feed a role like `"SALES"`; assert 403).
  - The `view` route returns 400 for a path outside the prefix or containing `..` (drive `isAllowedPhotoPath` through the handler).
  - `DELETE` still deletes the row and returns `{ ok: true }` when `del()` throws (mock `del` to reject; assert `prisma.idrEscalationPhoto.delete` was called and status 200).

  Follow the handler-invocation style already used in `src/__tests__/api/idr-meeting-search.test.ts` (construct a `NextRequest`, call the exported `GET`/`POST`/`DELETE`, assert on the `NextResponse`). Mock `requireApiAuth` to return `{ email: "x@photonbrothers.com", role: "ADMIN", roles: ["ADMIN"] }` for the happy-path role and a non-IDR role for the 403 cases.

- [ ] **Step 4b.2:** Run → iterate to green. Commit: `test(idr): escalation-photo route auth + path-guard + delete-continues`

## Chunk 2: Count enrichment + UI

### Task 5: Count enrichment on sessions/[id] GET + preview GET

**Files:**
- Modify: `src/app/api/idr-meeting/sessions/[id]/route.ts` (the `itemsWithBadges` map, ~line 63)
- Modify: `src/app/api/idr-meeting/preview/route.ts` (after the escalation-upgrade loop)
- Modify: `src/app/dashboards/idr-meeting/IdrMeetingClient.tsx` (`IdrItem` gains `escalationPhotoCount?: number`)

- [ ] **Step 5.1:** In `sessions/[id]/route.ts`, before building `itemsWithBadges`, compute counts for escalation items:

```ts
const escDealIds = session.items.filter((i) => i.type === "ESCALATION").map((i) => i.dealId);
const photoCounts = new Map<string, number>();
if (escDealIds.length) {
  const grouped = await prisma.idrEscalationPhoto.groupBy({
    by: ["dealId"],
    where: { dealId: { in: escDealIds } },
    _count: { _all: true },
  });
  for (const g of grouped) photoCounts.set(g.dealId, g._count._all);
}
```
Then in the `itemsWithBadges` map add:
```ts
    escalationPhotoCount: item.type === "ESCALATION" ? (photoCounts.get(item.dealId) ?? 0) : undefined,
```

- [ ] **Step 5.2:** In `preview/route.ts`, the `items` element type is inferred from two object literals (the `deals.map(...)` at ~line 92 and the escalation `items.push({...})` at ~line 178). To mutate `escalationPhotoCount` later without a TS2339, **first seed the field in both literals**: add `escalationPhotoCount: undefined as number | undefined,` to each. Then **after** the existing "upgrade existing IDR item to ESCALATION" loop and before `return NextResponse.json({ items })`, apply the enrichment: collect `items.filter((i) => i.type === "ESCALATION").map((i) => i.dealId)`, run one `groupBy` (same shape as Step 5.1), and assign `item.escalationPhotoCount = photoCounts.get(item.dealId) ?? 0` to each escalation item. (Sessions/[id] in Step 5.1 needs no seeding — it builds a fresh literal in its `.map`.)

- [ ] **Step 5.3:** In `IdrMeetingClient.tsx`, add to the `IdrItem` interface: `escalationPhotoCount?: number;`

- [ ] **Step 5.4:** `npx tsc --noEmit` (zero non-test); commit: `feat(idr): batch escalation photo counts into session + preview payloads`

### Task 6: PhotoUploader component + AddEscalationDialog integration

**Files:**
- Create: `src/app/dashboards/idr-meeting/EscalationPhotoUploader.tsx`
- Modify: `src/app/dashboards/idr-meeting/AddEscalationDialog.tsx`

- [ ] **Step 6.1:** Create `EscalationPhotoUploader.tsx` — a controlled component holding pending files (add-time) OR managing existing photos for a dealId (in-meeting). For the add-time dialog it operates in "pending" mode: a file input + a list of chosen files each with an optional caption text input and a remove button. It exposes the chosen `{ file, caption }[]` to the parent via an `onChange` callback (no upload here — the dialog uploads after the escalation is created). Client-side pre-validation reuses the same rules by importing `ALLOWED_PHOTO_TYPES`/`MAX_PHOTO_BYTES` from `@/lib/idr-escalation-photos` (pure module, safe to import client-side). Reject invalid files with a toast, don't add them to the list.

- [ ] **Step 6.2:** In `AddEscalationDialog.tsx`: render `<EscalationPhotoUploader mode="pending" onChange={setPendingPhotos} />` below the reason textarea once `selectedDeal` is set. On submit success (after the escalation POST returns), upload each pending photo **sequentially** (awaited in a `for` loop, not `Promise.all`, to keep `sortOrder` deterministic) via `POST /api/idr-meeting/escalation-photos` with `file`, `dealId = selectedDeal.dealId`, and its caption. A failed photo upload shows a toast but does not roll back the escalation (which already succeeded); continue the loop. Then invalidate `escalationQueue` + preview queries and close.

- [ ] **Step 6.3:** `npx tsc --noEmit`; `npx eslint` both files. Manually confirm the dialog still submits with zero photos (the common path). Commit: `feat(idr): photo uploader in the Add Escalation dialog`

### Task 7: Escalation Photos gallery in ProjectDetail + queue badge

**Files:**
- Create: `src/app/dashboards/idr-meeting/EscalationPhotoGallery.tsx`
- Modify: `src/app/dashboards/idr-meeting/ProjectDetail.tsx` (render below `<PhotoGalleryCard>`, escalation-only)
- Modify: `src/app/dashboards/idr-meeting/ProjectQueue.tsx` (count badge)
- Modify: `src/lib/query-keys.ts` (add `escalationPhotos(dealId)` key)

- [ ] **Step 7.1:** Add query key in `query-keys.ts` under `idrMeeting`:
```ts
    escalationPhotos: (dealId: string) => [...queryKeys.idrMeeting.root, "escalation-photos", dealId] as const,
```

- [ ] **Step 7.2:** Create `EscalationPhotoGallery.tsx` — takes `dealId` + `readOnly`. `useQuery` on `GET /api/idr-meeting/escalation-photos?dealId=` → thumbnail grid (`<img src={viewerUrl}>`). Click a thumbnail → lightbox overlay (full image + caption). Each thumb has (when `!readOnly`): inline caption edit (PATCH), delete button (DELETE + confirm), and the section header has an "Add photos" file input that uploads immediately (POST) then refetches. All mutations invalidate `escalationPhotos(dealId)` and the preview/session queries so the badge count updates. Empty state: a muted "No escalation photos" line with the add control.

- [ ] **Step 7.3:** In `ProjectDetail.tsx`, directly after `<PhotoGalleryCard hubspotDealId={item.dealId} />` (line ~419), add:
```tsx
        {item.type === "ESCALATION" && (
          <EscalationPhotoGallery dealId={item.dealId} readOnly={readOnly} />
        )}
```

- [ ] **Step 7.4:** In `ProjectQueue.tsx`, next to the existing ESCALATION `⚡` prefix (the `item.type === "ESCALATION"` block), add a camera icon + count when photos exist:
```tsx
                    {item.type === "ESCALATION" && (item.escalationPhotoCount ?? 0) > 0 && (
                      <span className="text-[10px] text-muted shrink-0" title={`${item.escalationPhotoCount} photo(s)`}>
                        📷{item.escalationPhotoCount}
                      </span>
                    )}
```

- [ ] **Step 7.5:** `npx tsc --noEmit`; `npx eslint src/app/dashboards/idr-meeting/`; run the IDR test set:
`npx jest src/__tests__/idr-escalation-photos.test.ts src/__tests__/idr-review-types.test.ts src/__tests__/lib/idr-meeting.test.ts src/__tests__/api/idr-meeting-presence.test.ts src/__tests__/api/idr-meeting-search.test.ts`
All green, zero new lint. Commit: `feat(idr): escalation photo gallery + queue count badge`

### Task 8: Final verification + PR

- [ ] **Step 8.1:** `npm run build` — must pass.
- [ ] **Step 8.2:** `git log origin/main..HEAD --stat` — only the spec/plan + files this plan names.
- [ ] **Step 8.3:** Push + `gh pr create`. Title: `feat(idr): escalation photo attachments in the IDR meeting hub`. Body: summary (in-app photo attach for escalations, add-time + in-meeting, dealId-anchored, private blob + proxy, count badge), spec/plan links, HUMAN ACTION (additive migration: new `IdrEscalationPhoto` table, apply before merge), test plan (unit + live: add escalation with photo → badge → detail gallery → survives session start → streams via proxy). Do NOT merge.
