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
  `dealId`, returns the row plus its proxy `viewerUrl`.
- `GET ?dealId=…` — list photos for a deal, ordered by `sortOrder`, each with
  its `viewerUrl`.
- `DELETE /[id]` — delete the blob (`del(blobPath)`) then the row. Blob-delete
  failure is logged but does not block row deletion (avoid a dangling row the
  user can't clear).
- `PATCH /[id]` (JSON: `caption?`, `sortOrder?`) — update label / ordering.
- `GET /view?path=…` — the streaming proxy viewer. Validates the path is under
  the `escalation-photos/` prefix before streaming, and requires an IDR role.

### 4. UI

**Add Project dialog** (`AddEscalationDialog.tsx`) — a compact uploader appears
once a deal is selected, below the reason field: a file picker + a thumbnail
strip of pending files with optional per-file caption inputs. Files are held
client-side and uploaded only **after** the escalation POST succeeds (keyed by
the now-known `dealId`), so cancelling the dialog uploads nothing. Upload
failures surface a toast but do not roll back the created escalation (the photos
can be re-added from the detail panel).

**Detail panel** (`ProjectDetail.tsx`, escalation items only) — a "Photos"
section rendering the deal's photos as a thumbnail grid: click to enlarge
(lightbox), inline caption edit, delete, and an add-more file picker. This is
the primary in-meeting view and management surface. Loaded via `GET ?dealId=`.

**Preview/queue** — the queued escalation, before a session exists, also reads
by `dealId`, so any add-time photos are visible in the prep view too.

A small camera icon + count badge on the escalation row in `ProjectQueue.tsx`
signals that photos are attached (only when count > 0).

### 5. Lifecycle

Because photos anchor to `dealId`, the consume (queue → item), skip/re-queue
(item → new queue), and direct-add paths need **no changes** — the photos are
found by `dealId` regardless of which container currently represents the
escalation. Photos persist until explicitly deleted; that persistence is the
record-keeping Elliott asked for. No cascade, no re-link, no orphan cleanup on
dismiss/skip.

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
  outside the `escalation-photos/` prefix.
- `sortOrder` assignment: new photo gets max+1 per `dealId`.
- List-by-`dealId` ordering.
- Delete removes row even if blob-delete throws (logged, non-fatal).
- Component: uploader defers upload until after escalation creation; detail
  panel renders grid + count badge only when photos exist.

## Rollout

1. Additive migration (new `IdrEscalationPhoto` table) — applied by Zach before
   merge.
2. Ship code. No feature flag. The uploader and gallery appear immediately;
   with no photos attached, escalation UX is unchanged.
3. Verify: add an escalation with a photo, confirm it shows in the queue badge
   and the detail panel, survives a session start, and streams via the proxy.
