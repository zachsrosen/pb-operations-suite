# IDR Meeting Hub: Escalation Photo Attachments

**Date:** 2026-07-09
**Status:** Draft — pending review
**Requested by:** Elliott Gunning (design team) via Google Chat, 2026-07-08

## Problem

When the design team adds an escalation to the IDR meeting queue, any photos
or screenshots pertaining to it have nowhere to live in the tool. Today the
options are dropping them in the deal's survey folder (Drive) or screen-sharing
during the meeting. Elliott asked for a way to attach the photos/snips to the
escalation itself, "to keep the escalation notes/photos/snips organized for
better visibility" and for record-keeping.

Unlike IDR / New Construction / D&R-Service review items — which have a design
or survey folder already linked in the detail panel — escalations are the
ad-hoc case with no such folder surfaced, so this gap is escalation-specific.

## Decisions (confirmed with Zach, 2026-07-09)

1. **Escalation-only.** Photo attachments apply only to escalation items, not
   other review types (they already have Drive folders).
2. **Upload at add-time and in-meeting.** Photos can be attached when adding the
   escalation (Add Project dialog) and added/removed later from the escalation
   item's detail panel.
3. **In-app only.** Photos live in the meeting hub, viewable during and after
   the meeting. Nothing is pushed to HubSpot or Drive. Durable storage in
   Vercel Blob (private).
4. **Optional caption per photo.** Each photo may carry a short label; optional
   so it never blocks a quick upload.
5. **Images only, 5 MB each** (JPEG/PNG/WebP/GIF) — mirrors the existing
   `catalog/upload-photo` constraints.

## Design pivot from the brainstorm: anchor to `dealId`, not queue/item rows

The brainstorm proposed a polymorphic photo table keyed to the escalation's
`IdrEscalationQueue` row and/or its `IdrMeetingItem`. Reading the lifecycle
code changed this:

- `DELETE /api/idr-meeting/escalation-queue/[id]` is a **soft delete**
  (`status → DISMISSED`); the row is never removed, so a FK
  `onDelete: Cascade` would never fire.
- `DELETE /api/idr-meeting/items/[id]` on an escalation item **re-queues** it —
  it creates a *new* `IdrEscalationQueue` row and deletes the item. If photos
  were FK'd to the item with cascade, skipping an escalation (which re-queues
  it for next week) would destroy its photos.

So an escalation's identity spans a chain of queue-row and item instances over
its life (queue A → item X → skip → queue B → item Y → …). The only stable key
across every hop is **`dealId`**. Anchoring photos to `dealId`:

- survives consume, skip, and re-queue with zero re-linking logic;
- sidesteps the cascade-delete footgun entirely (photos are deleted only by
  explicit user action);
- matches the product intent — the photos belong to "this deal's escalation,"
  and are shown wherever that deal appears as an escalation.

Accepted trade-off: if the same deal is escalated again later for an unrelated
reason, the earlier photos still show. Escalations per deal are rare and
sequential, and prior-escalation context is usually relevant; this is
acceptable and can be revisited if it ever bites.

## Design

### 1. Data model

New model `IdrEscalationPhoto`:

```prisma
model IdrEscalationPhoto {
  id         String   @id @default(cuid())
  dealId     String                     // stable anchor across queue/item hops
  blobPath   String                     // Vercel Blob pathname (private)
  fileName   String
  caption    String?
  sortOrder  Int      @default(0)
  uploadedBy String                     // user email
  createdAt  DateTime @default(now())

  @@index([dealId])
}
```

No FK to queue or item — decoupled from their volatile lifecycle by design.
Additive migration (new table only); applied to prod by Zach before merge, per
convention.

### 2. Storage — reuse the private-blob + proxy pattern

Identical to `src/app/api/catalog/upload-photo`:

- Upload with `put(\`escalation-photos/${file.name}\`, file, { access: "private", addRandomSuffix: true })`.
- Private blobs cannot be used directly in `<img src>` (they require the blob
  auth header), so reads go through a same-origin proxy that streams the blob
  behind session auth.
- Validation: `ALLOWED_TYPES` = jpeg/png/webp/gif; `MAX_SIZE` = 5 MB; 503 when
  `BLOB_READ_WRITE_TOKEN` is unset.

### 3. API routes (`/api/idr-meeting/escalation-photos/`)

All gated on the existing `isIdrAllowedRole(auth.role)` (403 otherwise), matching
every other IDR route.

- `POST` (multipart form: `file`, `dealId`, optional `caption`) — validates,
  uploads to Blob, creates the row with `sortOrder` = current max + 1 for that
  `dealId`, sets `uploadedBy = auth.email`, returns the row plus its proxy
  `viewerUrl`. See the concurrency note below.
- `GET ?dealId=…` — list photos for a deal, ordered by `sortOrder`, each with
  its `viewerUrl`.
- `DELETE /[id]` — delete the blob (`del(blobPath)`) then the row. Blob-delete
  failure is logged but does not block row deletion (avoid a dangling row the
  user can't clear).
- `PATCH /[id]` (JSON: `caption?`, `sortOrder?`) — update label / ordering.
- `GET /view?path=…` — the streaming proxy viewer. Requires an IDR role, and
  validates the path is under the `escalation-photos/` prefix **and** contains
  no `..` segment before streaming (mirrors both guards in the catalog viewer).

**sortOrder concurrency:** add-time uploads run **sequentially** (awaited one at
a time), not `Promise.all`, so each `max+1` sees the prior insert and ordering
is deterministic. This keeps the "new photo gets max+1 per dealId" invariant
true and avoids duplicate sort keys. (Ties would only cost display order, never
data, but sequential upload is simplest and also gives clearer per-file error
handling.)

### 4. UI

**Add Project dialog** (`AddEscalationDialog.tsx`) — a compact uploader appears
once a deal is selected, below the reason field: a file picker + a thumbnail
strip of pending files with optional per-file caption inputs. Files are held
client-side and uploaded only **after** the escalation POST succeeds (keyed by
the now-known `dealId`), so cancelling the dialog uploads nothing. Upload
failures surface a toast but do not roll back the created escalation (the photos
can be re-added from the detail panel).

**Detail panel** (`ProjectDetail.tsx`, escalation items only) — a section titled
**"Escalation Photos"** (distinct from the existing full-width
`PhotoGalleryCard` "Site Photos" section that renders HubSpot/Zuper photos for
every item — the two must not be confused). The new section renders below the
existing Site Photos gallery and **only when `item.type === "ESCALATION"`**. It
shows the deal's escalation photos as a thumbnail grid: click to enlarge
(lightbox), inline caption edit, delete, and an add-more file picker. Loaded via
`GET ?dealId=`.

The `type === "ESCALATION"` gate matters because photos anchor to `dealId`: a
deal escalated once and later appearing as a regular IDR/NEW_CONSTRUCTION/
DNR_SERVICE item shares the same `dealId`. Gating the section on item type (not
on photo presence) keeps escalation photos from bleeding onto non-escalation
panels.

**Preview/queue** — the queued escalation, before a session exists, also reads
by `dealId`, so any add-time photos are visible in the prep view too.

**Queue badge + count plumbing.** A small camera icon + count badge on the
**escalation** row in `ProjectQueue.tsx` signals attached photos. `ProjectQueue`
renders from `displayItems`, which is the **preview** payload before a session
and the **`GET /api/idr-meeting/sessions/[id]`** payload during a live meeting
(`IdrMeetingClient` uses `sessionQuery` → the `[id]` GET, not the POST create
route). So the count enrichment must be added to **both** of these read routes:

- `GET /api/idr-meeting/sessions/[id]/route.ts` — the authoritative live path
  (reads `item.type` from the DB).
- `GET /api/idr-meeting/preview/route.ts` — the prep path. Run the enrichment
  **after** the "upgrade existing IDR item to ESCALATION" loop so freshly
  upgraded escalations are counted.

The POST `sessions/route.ts` create response is *not* enriched — the client
discards it and immediately refetches the `[id]` GET, and its in-memory items
don't reflect the DB escalation-upgrade anyway.

To avoid an N+1, each route: collect the `dealId`s of `type === "ESCALATION"`
items, run a single
`prisma.idrEscalationPhoto.groupBy({ by: ["dealId"], where: { dealId: { in } }, _count: true })`,
and attach `escalationPhotoCount` to those items only (non-escalation items get
no count / no badge). The badge renders when `type === "ESCALATION" &&
escalationPhotoCount > 0`. `IdrItem` gains an optional
`escalationPhotoCount?: number`.

### 5. Lifecycle

Because photos anchor to `dealId`, the consume (queue → item), skip/re-queue
(item → new queue), and direct-add paths need **no photo-linkage changes** — the
photos are found by `dealId` regardless of which container currently represents
the escalation. Photos persist until explicitly deleted; that persistence is the
record-keeping Elliott asked for. No cascade, no re-link, no orphan cleanup on
dismiss/skip.

The only change to those routes is additive: the `sessions/[id]` GET and the
preview GET attach `escalationPhotoCount` to escalation items via the single
batched `groupBy` described in §4. This is a read-only enrichment of the
payload, not a change to how items are created or consumed.

### 6. Out of scope

- No push to HubSpot notes or Drive.
- No photos on non-escalation review types.
- No PDF/document attachments (images only).
- No automatic cleanup of photos for dismissed/never-consumed escalations —
  they remain queryable by `dealId` and cost little; explicit delete is the
  removal path.

## Testing

- Upload validation: rejects disallowed MIME types and >5 MB; 503 without blob
  token.
- Auth: non-IDR role gets 403 on every route; the proxy viewer rejects paths
  outside the `escalation-photos/` prefix and paths containing `..`.
- `sortOrder` assignment: sequential uploads yield max+1 per `dealId` with no
  duplicate keys.
- List-by-`dealId` ordering.
- Delete removes row even if blob-delete throws (logged, non-fatal).
- Count batching: `groupBy` attaches `escalationPhotoCount` only to escalation
  items; a non-escalation item sharing the same `dealId` gets no count and no
  badge.
- Component: uploader defers upload until after escalation creation; the
  Escalation Photos section and badge render only for `type === "ESCALATION"`
  items and only when a photo exists.

## Rollout

1. Additive migration (new `IdrEscalationPhoto` table) — applied by Zach before
   merge.
2. Ship code. No feature flag. The uploader and gallery appear immediately;
   with no photos attached, escalation UX is unchanged.
3. Verify: add an escalation with a photo, confirm it shows in the queue badge
   and the detail panel, survives a session start, and streams via the proxy.
