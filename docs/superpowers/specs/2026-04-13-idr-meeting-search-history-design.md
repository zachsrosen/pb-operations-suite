# IDR Meeting Search History

**Date:** 2026-04-13
**Status:** Draft

## Problem

The IDR Meeting Hub has comprehensive backend infrastructure for searching past meeting items and retrieving deal history (`/api/idr-meeting/search`, `/api/idr-meeting/deal-history/[dealId]`), plus an unused `NoteHistory.tsx` component. However, there is no UI that lets users search for a deal and view its past meeting notes, conclusions, and context. Users can only see history for deals that are already in the current session queue.

## Solution

Add a **Search History** mode to the IDR Meeting Hub as a third mode alongside Prep and Live Meeting. This reuses the existing two-panel layout pattern and backend APIs to provide deal-grouped search results with full session history expansion.

## Design

### Mode Integration

The IDR Meeting Hub gains a third mode state: `"search"`. The `IdrMeetingClient` component tracks this via the existing mode logic (currently `isPreview` boolean becomes a three-way: `"prep" | "meeting" | "search"`).

**Entry point:** A "Search History" button in the `SessionHeader` component (visible in both Prep and Live modes). Clicking it switches to search mode.

**Exit:** A "Prep Mode" button in the search mode header returns to prep mode.

### Header Banner

Purple-themed banner (distinct from blue Prep and orange Live) containing:

- **"Search History" badge** — purple pill, matches existing badge pattern
- **Search input** — text field searching deal names, regions, notes, conclusions, escalation reasons (maps to existing `searchMeetingItems` API)
- **Date range filters** — optional "From" and "To" date inputs to narrow results
- **"Prep Mode" button** — returns to prep view

### Left Panel: Deal-Grouped Results

Search results from `/api/idr-meeting/search` are grouped by `dealId`. Each deal card shows:

- **Deal name** (e.g., "PROJ-4821 Smith Residence")
- **Meeting count** badge
- **Context line** — region, system size, project type
- **Inline conclusion previews** — orange left-border timeline showing each session date + truncated conclusion

Clicking a deal selects it and loads the right panel. Selected deal gets an orange border highlight (matching existing selection pattern in `ProjectQueue`).

Pagination via "Load more" button at bottom, using the existing `skip` parameter from the search API.

### Right Panel: Full Deal History

When a deal is selected, the right panel shows its complete meeting history via `/api/idr-meeting/deal-history/[dealId]` (enhanced — see API Changes below). Content is chronological (newest first):

**Deal header:**
- Deal name, address, region, system size, project type
- HubSpot quick link

**Session cards** (one per meeting appearance):
- Session date + type badge (IDR / ESCALATION)
- Snapshot context grid: design status, deal owner, system size, equipment at that time
- All note fields: conclusion (green label), customer notes, ops notes, design notes
- Escalation reason (if type is ESCALATION, orange label)

**Standalone note cards** (between-meeting notes from `IdrMeetingNote`):
- Date + "Note" badge (purple accent) + author email
- Note content
- Left purple border to distinguish from session cards

### Empty States

- **No search yet:** "Search for a deal to view its meeting history"
- **No results:** "No deals found matching your search"
- **No deal selected:** "Select a deal from the results to view its history"

## API Changes

### Enhanced `/api/idr-meeting/deal-history/[dealId]`

The existing endpoint returns items and notes but doesn't include full meeting note fields or snapshot context in a structured way. The `IdrMeetingItem` model already stores all these fields — the endpoint just needs to return them. Currently it returns all fields via `findMany` without a `select`, so the data is already there. No schema changes needed.

The response shape is already sufficient:
```ts
{
  items: IdrMeetingItem[]  // includes all note fields, snapshot fields, session date/status
  notes: IdrMeetingNote[]  // standalone notes with author, content, date
}
```

### Updated `/api/idr-meeting/search`

The existing `searchMeetingItems` function rejects queries under 2 characters. Update it to allow **date-range-only queries** (empty `q` with `from`/`to` set). When `q` is empty and at least one date param is provided, skip the text filter and return all items within the date range. This lets users browse "all meetings from last month" without typing a search term.

The client groups results by `dealId` — no structural API changes needed since the response already includes `dealId`, `dealName`, `region`, `systemSizeKw`, `projectType`, and `conclusion` on each item.

## New Components

### `MeetingSearch.tsx`

Top-level component rendered by `IdrMeetingClient` when in search mode. Contains the two-panel layout:

- Left: `SearchResultsList` — search input state, debounced query, grouped results
- Right: `DealHistoryDetail` — selected deal's full timeline

### `SearchResultsList.tsx`

Handles:
- Search text input with 300ms debounce (matching existing `AddProjectDialog` pattern)
- Date range filter state
- React Query call to `/api/idr-meeting/search`
- Client-side grouping of results by `dealId`
- Rendering deal cards with inline conclusion previews
- Selection callback to parent

### `DealHistoryDetail.tsx`

Handles:
- React Query call to `/api/idr-meeting/deal-history/[dealId]`
- Merging items and notes into a single chronological list (similar merge approach as `NoteHistory.tsx` but rendering substantially more fields — snapshot context, all note types, escalation reasons)
- Rendering session cards with snapshot context + all note fields
- Rendering standalone note cards with purple accent
- Deal header with quick links

### `SessionHeader` changes

- Add "Search History" button (visible in prep and live modes)
- Accept `onSearchHistory` callback prop
- In search mode: render purple banner with search input, date filters, back button

### `IdrMeetingClient` changes

- Replace `isPreview` boolean with a `mode: "prep" | "meeting" | "search"` state
- Derive `isPreview` and `isSearch` from mode for backward compatibility
- `ProjectQueue` and `ProjectDetail` continue receiving `isPreview` as a prop — they are only rendered in prep/meeting modes, never in search mode
- Render `MeetingSearch` when mode is `"search"`
- Existing prep/meeting rendering unchanged
- **Presence:** In search mode, presence heartbeats send `{ sessionId: null, selectedItemId: null, mode: "search" }`. The presence API and display can ignore search-mode users from the prep/meeting presence lists (they're just browsing history, not actively in a session)

## Query Keys

Add to `queryKeys.idrMeeting`:
- `meetingSearch: (q: string, from?: string, to?: string) => [...root, "meeting-search", q, from ?? "", to ?? ""]` — includes all filter params for proper cache isolation. Distinct from existing `dealSearch` which queries HubSpot.
- `dealHistory(dealId)` — already exists in the query keys

## Styling

- Purple theme for search mode: `border-purple-500/40 bg-purple-500/5` banner (matching the blue/orange pattern)
- Deal cards: same `border-t-border bg-surface-2` pattern as `ProjectQueue`
- Selected deal: `border-orange-500 bg-orange-500/8` (matches existing)
- Session cards: `border-t-border bg-surface-2/50` (matches `Section` in `ProjectDetail`)
- Standalone notes: left `border-purple-500` accent
- Conclusion label: `text-emerald-500` (green)
- Escalation label: `text-orange-500`
- All using theme tokens — no hardcoded colors

## Scope Exclusions

- No editing of past notes from search mode (read-only view)
- No adding standalone notes from search mode (use the meeting or prep mode for that)
- No export/print of meeting history
- No full-text search within the right panel detail view
- `NoteHistory.tsx` remains unused for now — the new `DealHistoryDetail` component supersedes it with a richer layout. `NoteHistory` can be removed in a follow-up cleanup.
