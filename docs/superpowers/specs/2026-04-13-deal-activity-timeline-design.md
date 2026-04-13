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
  6. Fire-and-forget background sync (does not block response):
     - **HubSpot:** Call new `createDealNote()` in `lib/hubspot.ts` (see Note Sync Pipeline). Takes `hubspotDealId` and `noteBody`. On success update to `"SYNCED"`, on failure `"FAILED"`.
     - **Zuper:** For each linked job, call `zuper.appendJobNote(jobUid, noteText)` (existing method). On success `"SYNCED"`, on failure `"FAILED"`.
  7. Invalidate SSE cache key `deals:{hubspotDealId}` so other viewers see the new note.
- **Returns:** `{ note: DealNote }`

### `GET /api/deals/[dealId]/timeline`

- **Auth:** Any authenticated user.
- **Query params:**
  - `all=true` — full history (default: 90 days)
  - `cursor=<timestamp>` — ISO timestamp cursor for pagination
- **Behavior:** Look up Deal by cuid, then fan-out parallel queries across 5 sources:

| Source | Table/API | Filter |
|--------|-----------|--------|
| Notes | `DealNote` | by `dealId` (cuid) |
| Sync changes | `DealSyncLog` | by `dealId` (cuid), status != SKIPPED |
| Zuper jobs | `ZuperJobCache` | by `deal.hubspotDealId` |
| Photos | `zuper.getJobPhotos()` | via ZuperJobCache job UIDs, cached 5-min |
| HubSpot engagements | HubSpot API (cached) | by `deal.hubspotDealId` associations |

- **Pagination strategy:** All DB sources (DealNote, DealSyncLog, ZuperJobCache) are queried with a `createdAt < cursor` filter and combined with cached HubSpot engagements and photos. The merged list is sorted by timestamp desc and truncated to 50 items. The `nextCursor` is the timestamp of the 50th event. This avoids per-source cursor tracking.

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

- **Returns:** `{ events: TimelineEvent[], nextCursor: string | null }`
- **Pagination:** 50 events per page, sorted by timestamp descending.

### `GET /api/deals/[dealId]/communications`

- **Auth:** Any authenticated user.
- **Query params:** `all=true` (default: 90 days)
- **Behavior:** Look up Deal by cuid, then fetch HubSpot engagements associated with the deal. Four object types queried separately via HubSpot CRM v3 associations API:

| Object Type | Association Endpoint | Key Fields |
|-------------|---------------------|-----------|
| `emails` | `deals/{id}/associations/emails` | subject, from, to, body (HTML stripped), timestamp |
| `calls` | `deals/{id}/associations/calls` | disposition, duration, notes, timestamp |
| `notes` | `deals/{id}/associations/notes` | body, timestamp, createdBy |
| `meetings` | `deals/{id}/associations/meetings` | title, attendees, startTime, endTime |

Each association lookup returns IDs, which are then batch-read for properties.

- **Caching:** 5-minute in-memory TTL via `lib/cache.ts`. Key: `deal-engagements:{hubspotDealId}`. Add to `CACHE_KEYS` in cache.ts. Invalidated on manual deal sync.
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
  ├─ Invalidate SSE cache key deals:{hubspotDealId}
  ├─ Return note to client immediately (optimistic)
  └─ Background (fire-and-forget):
       ├─ HubSpot: createDealNote(hubspotDealId, noteBody)
       │    ├─ Success → update hubspotSyncStatus = "SYNCED"
       │    └─ Failure → update hubspotSyncStatus = "FAILED"
       └─ Zuper: for each linked job in ZuperJobCache
            ├─ zuper.appendJobNote(jobUid, "[authorName] noteContent")
            ├─ Success → update zuperSyncStatus = "SYNCED"
            └─ Failure → update zuperSyncStatus = "FAILED"
```

No automatic retry. Notes always exist locally regardless of sync outcome.

## HubSpot Engagements Fetch

New function `getDealEngagements()` in `lib/hubspot.ts`:

- Uses existing `searchWithRetry()` rate-limit wrapper.
- Makes 4 parallel association lookups via HubSpot CRM v3: `GET /crm/v3/objects/deals/{hubspotDealId}/associations/emails`, `.../calls`, `.../notes`, `.../meetings`.
- Batch-reads returned IDs to get engagement properties.
- Extracts key fields per engagement type (subject, body, duration, attendees, etc.).
- Cached 5-min TTL in `lib/cache.ts`, key: `deal-engagements:{hubspotDealId}`.

## React Query Keys

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
- `lib/cache.ts`: Add `DEAL_ENGAGEMENTS` key function to `CACHE_KEYS`.
- `lib/query-keys.ts`: Add `dealTimeline` and `dealCommunications` key factories.
- `prisma/schema.prisma`: Add `DealNote` model, add `notes DealNote[]` relation on `Deal` model. Requires migration.

## Data Flow

```
Deal Detail Page loads
  → DealActivityPanel renders with deal.id (cuid) + deal.hubspotDealId
  → Activity tab (default):
      → React Query fetches GET /api/deals/{cuid}/timeline
        → Route resolves Deal, gets hubspotDealId
        → API fans out: DealNote + DealSyncLog + ZuperJobCache + Photos + HubSpot Engagements
        → Merges, sorts by timestamp desc, returns TimelineEvent[] (page of 50)
      → NoteComposer shown at top
      → User submits note → POST /api/deals/{cuid}/notes
        → Optimistic insert into feed
        → SSE invalidation notifies other viewers
        → Background sync to HubSpot + Zuper
  → Communications tab (on click):
      → React Query fetches GET /api/deals/{cuid}/communications
        → Route resolves Deal, gets hubspotDealId
        → API fetches HubSpot engagements via 4 association lookups (cached 5-min)
        → Returns typed engagement objects
```
