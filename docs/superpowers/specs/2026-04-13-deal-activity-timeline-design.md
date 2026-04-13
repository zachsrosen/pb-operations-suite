# Deal Activity Timeline & Notes

**Date:** 2026-04-13
**Status:** Draft

## Problem

The deal detail page is entirely read-only mirror data. There is no way for the ops team to leave internal notes on a deal, no unified view of what has happened on a deal over time, and no visibility into customer communications without leaving the app to check HubSpot.

## Solution

Two features added to the deal detail page as a full-width tabbed section at the bottom of the main content pane:

1. **Activity tab** — unified chronological feed of all deal events (sync changes, internal notes, Zuper job updates, photos, HubSpot engagements) with a note composer at the top. Notes sync to HubSpot and Zuper in the background.
2. **Communications tab** — read-only view of HubSpot engagements (emails, calls, notes, meetings) for focused review of customer interactions.

## Data Model

### New: `DealNote`

```prisma
model DealNote {
  id                  String   @id @default(cuid())
  dealId              String
  deal                Deal     @relation(fields: [dealId], references: [id], onDelete: Cascade)
  content             String   @db.VarChar(5000)
  authorEmail         String
  authorName          String
  hubspotSyncStatus   String?  // "PENDING" | "SYNCED" | "FAILED"
  zuperSyncStatus     String?  // "PENDING" | "SYNCED" | "FAILED" | "SKIPPED"
  createdAt           DateTime @default(now())

  @@index([dealId, createdAt])
}
```

- Immutable: no update or delete operations exposed via API.
- Cascade delete when deal is removed.
- Author stored as email + name separately (survives user deletion).
- Sync statuses track background push to external systems.
- Content capped at 5,000 characters (enforced at API and DB level).
- Requires Prisma migration. This is a local-only addition to the deal mirror — not synced from HubSpot.

### No new models for timeline or communications

The timeline is a read-time aggregation across existing tables. Communications are fetched live from HubSpot with caching.

## API Endpoints

**Route param convention:** All `[dealId]` route params accept the Deal's internal cuid (`Deal.id`). The route handler resolves `deal.hubspotDealId` from the Deal record when calling HubSpot/Zuper APIs.

### `POST /api/deals/[dealId]/notes`

- **Auth:** Any authenticated user.
- **Body:** `{ content: string }`
- **Behavior:**
  1. Look up `Deal` by `dealId` (cuid). Return 404 if not found.
  2. Validate content is non-empty and <= 5,000 characters.
  3. Check `ZuperJobCache` for linked jobs by `deal.hubspotDealId`. Set initial `zuperSyncStatus` to `"SKIPPED"` if none.
  4. Create `DealNote` with `hubspotSyncStatus: "PENDING"`, `zuperSyncStatus: "PENDING"` (or `"SKIPPED"`).
  5. Return created note immediately.
  6. Background sync via `safeWaitUntil()` from `lib/safe-wait-until.ts` (uses `@vercel/functions` `waitUntil()` on Vercel, falls back to fire-and-forget locally). This keeps the serverless function alive after the response so sync completes reliably:
     - **HubSpot:** Call new `createDealNote()` in `lib/hubspot.ts` (see Note Sync Pipeline). Takes `hubspotDealId` and `noteBody`. On success update to `"SYNCED"`, on failure `"FAILED"`.
     - **Zuper:** For each linked job, call `zuper.appendJobNote(jobUid, noteText)` (existing method). On success `"SYNCED"`, on failure `"FAILED"`.
  7. Invalidate SSE cache key `deals:{hubspotDealId}` so other viewers see the new note.
- **Returns:** `{ note: DealNote }`

### `GET /api/deals/[dealId]/timeline`

- **Auth:** Any authenticated user.
- **Query params:**
  - `all=true` — full history (default: 90 days)
  - `cursorTs=<ISO timestamp>` + `cursorId=<event id>` — composite cursor as two separate query params, avoiding parsing ambiguity (ISO timestamps contain `:`)
- **Time window:** Unless `all=true`, compute `windowStart = now() - 90 days`. This floor is applied to every source:
  - Historical DB sources: add `createdAt >= windowStart` to the WHERE clause.
  - Snapshot sources (Zuper jobs, photos): filter in-memory by `timestamp >= windowStart`.
  - HubSpot engagements: filter in-memory by `timestamp >= windowStart`.
  
  When `all=true`, no floor is applied — all history is eligible for cursor-based pagination.
- **Behavior:** Look up Deal by cuid, then fan-out parallel queries across 5 sources:

| Source | Table/API | Filter | Nature |
|--------|-----------|--------|--------|
| Notes | `DealNote` | by `dealId` (cuid) | Historical (append-only, has `createdAt`) |
| Sync changes | `DealSyncLog` | by `dealId` (cuid), status != SKIPPED | Historical (append-only, has `createdAt`) |
| Zuper jobs | `ZuperJobCache` | by `deal.hubspotDealId` | **Snapshot** — current state only (see below) |
| Photos | `zuper.getJobPhotos()` | via ZuperJobCache job UIDs, cached 5-min | Snapshot — fetched from Zuper API |
| HubSpot engagements | HubSpot API (cached) | by `deal.hubspotDealId` associations | Historical (HubSpot stores timestamps) |

**Zuper jobs are snapshots, not historical events.** `ZuperJobCache` stores the current cached state of each linked job (title, status, scheduled dates) with a `lastSyncedAt` timestamp but no append-only history. The timeline renders each linked job as a single summary event using `scheduledStart` (or `lastSyncedAt` as fallback) for the timestamp — e.g. "Site Survey scheduled for Apr 15" or "Construction job — Started". Photos are fetched from the Zuper API, cached 5 minutes, and each assigned a timestamp from `created_at` (or the job's `lastSyncedAt` as fallback).

- **Pagination strategy:** Uses a composite cursor (`timestamp:id`) to handle events that share the same timestamp. Multiple batch sync logs, photos from the same upload, or HubSpot engagements rounded to the same second would otherwise be lost at page boundaries. The full flow:
  1. Read `cursorTs` and `cursorId` from query params. Both absent = first page. Both required if either is present (400 otherwise).
  2. Historical DB sources (DealNote, DealSyncLog) are queried with: `WHERE (createdAt < cursorTimestamp) OR (createdAt = cursorTimestamp AND id < cursorId)` — pushed to the DB via a compound ORDER BY (timestamp DESC, id DESC).
  3. Snapshot sources (Zuper jobs, photos) are fetched in full (small cardinality) then filtered in-memory with the same `(timestamp, id)` comparison.
  4. HubSpot engagements are fetched from cache then filtered in-memory with the same comparison.
  5. All filtered results are merged, sorted by `(timestamp DESC, id DESC)`, and truncated to 50 items.
  6. `nextCursor` is `{ ts: string, id: string }` from the 50th event, or `null` if fewer than 50 results. The client passes these back as `cursorTs` + `cursorId` query params on the next request.
  
  This is lossless — no events are skipped even when multiple events share a timestamp.

- **Normalization:** All sources map to a common shape:

```typescript
interface TimelineEvent {
  id: string;
  type: "note" | "sync" | "zuper" | "photo" | "email" | "call" | "meeting" | "hubspot_note";
  timestamp: string;       // ISO 8601
  title: string;           // e.g. "Note by Zach Rosen", "4 fields updated via manual sync"
  detail: string | null;   // note body, email subject, field diffs summary
  author: string | null;
  metadata: Record<string, unknown> | null;  // type-specific data (sync diffs, photo URL, etc.)
}
```

- **Returns:** `{ events: TimelineEvent[], nextCursor: { ts: string; id: string } | null }` — `null` if no more pages.
- **Pagination:** 50 events per page, sorted by `(timestamp DESC, id DESC)`.

### `GET /api/deals/[dealId]/communications`

- **Auth:** Any authenticated user.
- **Query params:** `all=true` (default: 90 days)
- **Time window:** Unless `all=true`, compute `windowStart = now() - 90 days`. After fetching engagements from HubSpot (or cache), filter to only those with `timestamp >= windowStart`. The `:recent` cache key stores the full HubSpot response (not pre-filtered), and the 90-day filter is applied after cache retrieval — this avoids stale window boundaries baked into the cache.
- **Behavior:** Look up Deal by cuid, then fetch HubSpot engagements associated with the deal. Four object types queried separately via HubSpot CRM v3 associations API:

| Object Type | Association Endpoint | Key Fields |
|-------------|---------------------|-----------|
| `emails` | `deals/{id}/associations/emails` | subject, from, to, body (HTML stripped), timestamp |
| `calls` | `deals/{id}/associations/calls` | disposition, duration, notes, timestamp |
| `notes` | `deals/{id}/associations/notes` | body, timestamp, createdBy |
| `meetings` | `deals/{id}/associations/meetings` | title, attendees, startTime, endTime |

Each association lookup returns IDs, which are then batch-read for properties.

- **Caching:** 5-minute in-memory TTL via `lib/cache.ts`. Two cache keys to avoid cross-contamination between windowed and full-history requests:
  - `deal-engagements:{hubspotDealId}:recent` — default 90-day window
  - `deal-engagements:{hubspotDealId}:all` — full history
  
  Add both key variants to `CACHE_KEYS` in cache.ts. Both invalidated on manual deal sync.
- **Returns:** `{ engagements: Engagement[] }` with type-specific shape per engagement.

## Note Sync Pipeline

### New function: `createDealNote()` in `lib/hubspot.ts`

A generalized version of `createDealTimelineNote()` from `lib/idr-meeting.ts`. The IDR version hard-codes `IDR_MEETING_MENTION_OWNER_IDS` for @mentions which is IDR-specific. The new function:

- Takes `hubspotDealId: string` and `noteBody: string`
- Creates a HubSpot note object via `hubspotClient.crm.objects.notes.basicApi.create()`
- Associates to the deal with type ID 214 (note-to-deal)
- Does NOT add @mentions (unlike the IDR version)

### Zuper sync: uses existing `zuper.appendJobNote()`

The Zuper client already has `appendJobNote(jobUid, note)` which appends text to the job's `job_notes` field. This is used rather than creating a discrete note activity, since Zuper's job notes are a text field, not a separate notes API.

### Full flow

```
User submits note
  ├─ Resolve Deal by cuid → get hubspotDealId
  ├─ Save DealNote to DB (hubspotSyncStatus: PENDING, zuperSyncStatus: PENDING|SKIPPED)
  ├─ Invalidate SSE cache key deals:{hubspotDealId}  ← shows PENDING note to all viewers
  ├─ Return note to client immediately (optimistic)
  └─ Background via safeWaitUntil():
       ├─ HubSpot: createDealNote(hubspotDealId, noteBody)
       │    ├─ Success → update hubspotSyncStatus = "SYNCED"
       │    │    └─ Invalidate engagement cache: deal-engagements:{hubspotDealId}:recent + :all
       │    └─ Failure → update hubspotSyncStatus = "FAILED"
       ├─ Zuper: for each linked job in ZuperJobCache
       │    ├─ zuper.appendJobNote(jobUid, "[authorName] noteContent")
       │    ├─ Success → update zuperSyncStatus = "SYNCED"
       │    └─ Failure → update zuperSyncStatus = "FAILED"
       └─ After all syncs settle:
            └─ Invalidate SSE cache key deals:{hubspotDealId}  ← updates PENDING→SYNCED/FAILED
```

The second SSE invalidation after background work completes ensures all viewers (including the author) see the final sync status without a manual refresh. The engagement cache invalidation ensures the Communications tab picks up the newly created HubSpot note on its next fetch rather than serving stale data for up to five minutes.

No automatic retry. Notes always exist locally regardless of sync outcome.

## HubSpot Engagements Fetch

New function `getDealEngagements()` in `lib/hubspot.ts`:

- Uses existing `searchWithRetry()` rate-limit wrapper.
- Makes 4 parallel association lookups via HubSpot CRM v3: `GET /crm/v3/objects/deals/{hubspotDealId}/associations/emails`, `.../calls`, `.../notes`, `.../meetings`.
- Batch-reads returned IDs to get engagement properties.
- Extracts key fields per engagement type (subject, body, duration, attendees, etc.).
- Cached 5-min TTL in `lib/cache.ts`, keyed by `deal-engagements:{hubspotDealId}:recent` or `:all` depending on the time window requested.

## React Query Keys & SSE Invalidation

Add to `lib/query-keys.ts`:

```typescript
dealTimeline: {
  root: ["dealTimeline"] as const,
  events: (dealId: string) => ["dealTimeline", "events", dealId] as const,
},
dealCommunications: {
  root: ["dealCommunications"] as const,
  list: (dealId: string) => ["dealCommunications", "list", dealId] as const,
},
```

**SSE wiring:** The deal detail page subscribes to SSE with `cacheKeyFilter: deals:{hubspotDealId}`. Today `cacheKeyToQueryKeys()` maps `deals:*` only to `queryKeys.deals.root`, which does not cover the new timeline/communications queries. Two changes needed:

1. Update `cacheKeyToQueryKeys()` to also return `queryKeys.dealTimeline.root` and `queryKeys.dealCommunications.root` when the server key starts with `"deals"`. This ensures that when note creation invalidates `deals:{hubspotDealId}`, all viewers' timeline and communications queries refetch.

2. The `DealActivityPanel` component does NOT need its own SSE subscription — it piggybacks on the existing `useSSE` in `DealDetailView` which already listens on `deals:{hubspotDealId}`. The `cacheKeyToQueryKeys` expansion handles the fan-out.

## UI Components

### Layout

Full-width tabbed section at the bottom of the main pane in `DealDetailView`, below the photo gallery. Two tabs: **Activity** (default) and **Communications**.

### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `DealActivityPanel.tsx` | `components/deal-detail/` | Tabbed container (Activity / Communications) |
| `ActivityFeed.tsx` | `components/deal-detail/` | Timeline feed with note composer at top |
| `CommunicationsFeed.tsx` | `components/deal-detail/` | Read-only HubSpot engagements view |
| `TimelineEventRow.tsx` | `components/deal-detail/` | Single event renderer for all types |
| `NoteComposer.tsx` | `components/deal-detail/` | Text area + submit button + sync status indicators |

### Activity Tab

- **Note composer** at top: plain text area, "Add Note" button. Optimistic insert on submit.
- **Chronological feed** below, newest first:
  - Each event type has a distinct left icon and color accent:
    - Note (orange), Sync (blue), Zuper (green), Photo (purple), Email/Call/Meeting/HubSpot Note (cyan)
  - Timestamp shown as relative ("2h ago") with full date on hover.
  - Title line summarizes the event.
  - Expandable detail: note body, field diffs (old → new), photo thumbnail, email subject.
  - Author shown when applicable.
- **Notes** show sync status indicators: checkmark (synced), spinner (pending), X (failed) with tooltip.
- **90-day default.** "Show all history" button at bottom loads full timeline.
- **Pagination:** "Load more" button, 50 events per page.

### Communications Tab

- Read-only feed of HubSpot engagements.
- Emails: subject, from/to, timestamp, expandable body.
- Calls: duration, participants, outcome.
- Notes: body, timestamp.
- Meetings: title, attendees, time range.
- Same 90-day default with "Show all" option.

### Existing Components

- `ChangeLogCard` in sidebar **remains as-is** — serves as a quick-glance widget. The Activity tab is the detailed view.

## Integration Points

- `DealDetailView.tsx`: Add `DealActivityPanel` below the photo gallery in the main content pane. Pass `deal.id` (cuid) and `deal.hubspotDealId`.
- `page.tsx` (deal detail server page): No changes needed — timeline data is fetched client-side via React Query.
- `lib/hubspot.ts`: Add `createDealNote()` and `getDealEngagements()` functions.
- `lib/zuper.ts`: Uses existing `appendJobNote()` — no new methods needed.
- `lib/cache.ts`: Add `DEAL_ENGAGEMENTS` key function (with `:recent`/`:all` variants) to `CACHE_KEYS`.
- `lib/query-keys.ts`: Add `dealTimeline` and `dealCommunications` key factories. Update `cacheKeyToQueryKeys()` to include these roots when server key starts with `"deals"`.
- `prisma/schema.prisma`: Add `DealNote` model, add `notes DealNote[]` relation on `Deal` model. Requires migration.

## Data Flow

```
Deal Detail Page loads
  → DealActivityPanel renders with deal.id (cuid) + deal.hubspotDealId
  → Activity tab (default):
      → React Query fetches GET /api/deals/{cuid}/timeline (key: dealTimeline.events)
        → Route resolves Deal, gets hubspotDealId
        → API fans out: DealNote + DealSyncLog + ZuperJobCache snapshots + Photos + HubSpot Engagements
        → Merges, sorts by timestamp desc, returns TimelineEvent[] (page of 50)
      → NoteComposer shown at top
      → User submits note → POST /api/deals/{cuid}/notes
        → Optimistic insert into feed
        → SSE invalidation #1 on deals:{hubspotDealId} → viewers see PENDING note
        → Background sync to HubSpot + Zuper via safeWaitUntil()
          → On settle: SSE invalidation #2 → viewers see SYNCED/FAILED status
          → On HubSpot success: bust deal-engagements cache so Comms tab is fresh
  → Communications tab (on click):
      → React Query fetches GET /api/deals/{cuid}/communications
        → Route resolves Deal, gets hubspotDealId
        → API fetches HubSpot engagements via 4 association lookups (cached 5-min)
        → Returns typed engagement objects
```
