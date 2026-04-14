# Deal Detail Enrichment — Activity & Communications

**Date:** 2026-04-13
**Scope:** Enrich the deal detail Activity and Communications tabs with additional data sources; remove 3 unused sections from the Project Details tab.

## Background

The deal detail page has a 3-tab layout (Project Details / Activity / Communications) with a sidebar. The Activity tab aggregates 5 sources into a paginated timeline via `deal-timeline.ts`. The Communications tab shows HubSpot engagements (emails, calls, notes, meetings) via `hubspot-engagements.ts`.

Several data sources available in the system are not yet surfaced in these tabs. Additionally, 3 rarely-used collapsible sections in Project Details add clutter without providing actionable information during deal reviews.

## Part 1: Remove 3 Sections from Project Details

Delete these entries from `SECTION_REGISTRY` in `section-registry.ts`:
- `"revision-counts"` (lines 138-154)
- `"qc-metrics"` (lines 155-187)
- `"incentive-programs"` (lines 188-206)

Also remove `"revision-counts"` and `"qc-metrics"` from the `OPERATIONAL_SECTIONS` set in `DealDetailView.tsx` (line 40-41). `"install-planning"` stays.

No database or API changes. The fields remain in the Deal model for other dashboards that use them.

## Part 2: Enrich Activity Tab — New Timeline Sources

The existing fan-out pattern in `getDealTimeline()` runs all source fetchers in parallel and merges results. We add 3 new fetchers to this fan-out.

### 2A. Zuper Status History (`zuper_status` events)

**Source:** `ZuperJobCache.rawData` — the full Zuper API response stored as JSON. The `job_status` array contains the complete status transition history with timestamps.

**Implementation:**
- New function `fetchZuperStatusEvents()` in `deal-timeline.ts`
- For each `ZuperJobCache` row linked to the deal, parse `rawData.job_status` array
- Each entry has `status_name` and a timestamp (verify exact field name from sample `rawData` — likely `created_at` or `updated_at`)
- Guard with `Array.isArray((rawData as Record<string, unknown>)?.job_status)` since `rawData` is `Json?` (nullable)
- Emit one `TimelineEvent` per transition: `{ id: "zstatus-{jobUid}-{index}", type: "zuper_status", title: "{category} — {status_name}", timestamp: created_at }`
- Replace the existing `fetchZuperEvents()` which emits a single event per job with only the current status. The new function supersedes it.

**Cursor/pagination:** Snapshot source — apply `isInWindow()` + `isBeforeCursor()` in-memory (same pattern as existing `fetchZuperEvents`).

### 2B. BOM Pipeline Events (`bom` events)

**Source:** `BomPipelineRun` Prisma model — has `dealId`, `trigger`, `status`, `failedStep`, `createdAt`, `durationMs`.

**Implementation:**
- New function `fetchBomEvents()` using `fetchDbEvents()` pattern with cursor support
- Query: `prisma.bomPipelineRun.findMany({ where: { dealId }, orderBy, take: PAGE_SIZE })`
- Map to events: `{ id: "bom-{id}", type: "bom", title: "BOM {status} — {trigger}", detail: failedStep on failure }`
- Status values per `BomPipelineStatus` enum: RUNNING, SUCCEEDED, FAILED, PARTIAL

### 2C. Schedule Events (`schedule` events)

**Source:** `ScheduleRecord` Prisma model — has `projectId` (= HubSpot deal ID), `scheduleType`, `scheduledDate`, `status`, `assignedUser`.

**Implementation:**
- New function `fetchScheduleEvents()` using cursor pattern
- Query by `projectId` = `hubspotDealId`
- Map to events: `{ id: "sched-{id}", type: "schedule", title: "{type} {status} — {date}", detail: assignedUser }`
- Schedule types: survey, construction, inspection

## Part 3: Improve Existing Sources

### 3A. Richer Sync Changelog Labels

The sync events currently show raw property names in the diff viewer (e.g., `layout_approved`, `site_survey_schedule_date`).

**Implementation:**
- Build a label map by extracting `{ _key → label }` pairs from `section-registry.ts` field definitions (the `f()` helper already pairs keys with labels for every deal field rendered in the UI). Export a `FIELD_LABELS: Record<string, string>` constant from `section-registry.ts`.
- In `fetchSyncEvents()`, when building the `changes` metadata, map field names to human-readable labels using `FIELD_LABELS[key] ?? key` as fallback
- Add a `displayChanges` field to metadata: `Record<string, { label: string; old: unknown; new: unknown }>`
- Filter out noise fields: `lastmodifieddate`, `hs_lastmodifieddate`, `notes_last_updated`, `hs_object_id`
- Update `SyncChangesDiff` in `TimelineEventRow.tsx` to use `displayChanges` when present

### 3B. HubSpot Tasks in Communications

**Source:** HubSpot Tasks API — associated to deals like emails/calls/notes/meetings.

**Implementation in `hubspot-engagements.ts`:**
- Add `TASK_PROPERTIES`: `hs_task_subject`, `hs_task_body`, `hs_task_status`, `hs_timestamp`, `hs_task_priority`, `hs_task_type`
- Add `mapTask()` mapper producing `Engagement` with `type: "task"`
- Add to the parallel fetch in `getDealEngagements()`
- Tasks surface in Communications tab and cross into Activity tab via `engagementToTimelineEvents()`
- Update `engagementToTimelineEvents()` type-label mapping to add a `"task"` branch (currently falls through to "HubSpot Note" for unknown types)

### 3C. Zuper Job Notes in Activity

**Source:** Zuper API `GET /jobs/{job_uid}/notes` — returns notes with author, content, attachments, timestamps.

**Implementation:**
- New function `fetchZuperNoteEvents()` in `deal-timeline.ts`
- For each linked job, call `zuper.getJobNotes(jobUid)` (already exists in zuper.ts)
- Cache per deal+job for 5 min (same pattern as photo caching)
- Handle `ZuperApiResponse` error case with try/catch returning empty array (same pattern as `fetchPhotoEvents`)
- Author name: `[note.created_by?.first_name, note.created_by?.last_name].filter(Boolean).join(" ") || "Unknown"`
- Map to events: `{ id: "znote-{note_uid}", type: "zuper_note", title: "Zuper Note by {author}", detail: note text }`

### 3D. Strip @mention Markup from Notes

HubSpot notes contain `<a data-type="mention" ...>@Name</a>` markup that renders as clickable links to nowhere.

**Implementation in `sanitize-engagement-html.ts`:**
- Add a `transformTags` rule for `a` tags: if `attribs["data-type"] === "mention"`, replace the tag with a plain `span` containing just the text content
- This applies everywhere the sanitizer is used (both tabs)

## Type Changes

### `types.ts`

```typescript
export type TimelineEventType =
  | "note"
  | "sync"
  | "zuper"
  | "zuper_status"   // NEW — Zuper job status transitions
  | "zuper_note"     // NEW — Zuper job notes
  | "bom"            // NEW — BOM pipeline runs
  | "schedule"       // NEW — Schedule records
  | "photo"
  | "email"
  | "call"
  | "meeting"
  | "hubspot_note"
  | "task";          // NEW — HubSpot tasks

export interface Engagement {
  // ... existing fields ...
  type: "email" | "call" | "note" | "meeting" | "task"; // add "task"
}
```

### `TimelineEventRow.tsx`

Add entries to `EVENT_CONFIG`:
```typescript
zuper_status: { icon: "🔄", color: "text-green-500",  label: "Job Status" },
zuper_note:   { icon: "🔧", color: "text-green-500",  label: "Zuper Note" },
bom:          { icon: "📦", color: "text-purple-500", label: "BOM" },
schedule:     { icon: "📅", color: "text-blue-500",   label: "Scheduled" },
task:         { icon: "☑️",  color: "text-yellow-500", label: "Task" },
```

Add `"task"` and `"zuper_note"` to `HTML_BODY_TYPES` set (their bodies may contain HTML).

### `CommunicationsFeed.tsx`

Add to `TYPE_CONFIG`:
```typescript
task: { icon: "☑️", label: "Task" },
```

## File Change Summary

| File | Change |
|------|--------|
| `src/components/deal-detail/section-registry.ts` | Remove 3 section entries, export FIELD_LABELS map |
| `src/app/dashboards/deals/[pipeline]/[dealId]/DealDetailView.tsx` | Update OPERATIONAL_SECTIONS set |
| `src/lib/deal-timeline.ts` | Add 4 new fetchers, update fan-out, improve sync labels |
| `src/lib/hubspot-engagements.ts` | Add task type, properties, mapper |
| `src/components/deal-detail/types.ts` | Extend TimelineEventType union, Engagement type |
| `src/components/deal-detail/TimelineEventRow.tsx` | Add EVENT_CONFIG entries, update HTML_BODY_TYPES |
| `src/components/deal-detail/CommunicationsFeed.tsx` | Add task to TYPE_CONFIG |
| `src/lib/sanitize-engagement-html.ts` | Strip @mention markup |

## Performance Notes

- New DB fetchers (BOM, Schedule) use cursor-pushed queries — same O(page_size) as existing fetchers
- Zuper status history is parsed from already-cached `rawData` — no additional API calls
- Zuper notes use 5-min cache per deal+job — same pattern as photos, max ~3 API calls per deal
- HubSpot tasks add one more parallel association fetch — marginal impact within existing rate-limit retry

## Out of Scope

- HubSpot `propertiesWithHistory` API — DealSyncLog already captures diffs locally
- HubSpot form submissions — rare on deal records, low value
- ActivityLog integration — too noisy; specific models (BOM, Schedule) are better
- Zuper service task checklists — inspection form completions are niche; can add later
- Zuper note attachments rendering — just show note text for now; attachments can be a follow-up
