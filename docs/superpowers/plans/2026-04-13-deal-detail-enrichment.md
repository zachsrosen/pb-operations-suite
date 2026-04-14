# Deal Detail Enrichment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the deal detail Activity and Communications tabs with 4 new timeline sources plus improvements to 2 existing sources, and remove 3 unused Project Details sections.

**Architecture:** Extend the existing fan-out pattern in `deal-timeline.ts` with new source fetchers (Zuper status history, BOM pipeline, schedule records, Zuper notes). Add HubSpot tasks to the engagement pipeline. Improve sync changelog labels and sanitize @mention markup.

**Tech Stack:** Next.js, React Query, Prisma, HubSpot API, Zuper API, sanitize-html

**Spec:** `docs/superpowers/specs/2026-04-13-deal-detail-enrichment-design.md`

---

## Chunk 1: Types, Section Cleanup, and Field Labels

### Task 1: Extend Type Definitions

**Files:**
- Modify: `src/components/deal-detail/types.ts:139-187`

- [ ] **Step 1: Add new TimelineEventType values**

In `src/components/deal-detail/types.ts`, replace the `TimelineEventType` union (lines 139-147):

```typescript
export type TimelineEventType =
  | "note"
  | "sync"
  | "zuper"
  | "zuper_status"
  | "zuper_note"
  | "bom"
  | "schedule"
  | "photo"
  | "email"
  | "call"
  | "meeting"
  | "hubspot_note"
  | "task";
```

- [ ] **Step 2: Add "task" to Engagement type**

In the same file, update the `Engagement` interface `type` field (line 177):

```typescript
type: "email" | "call" | "note" | "meeting" | "task";
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: Errors in `TimelineEventRow.tsx` EVENT_CONFIG (missing new keys in the Record). This is expected — the `Record<TimelineEventType, ...>` requires exhaustive keys. **Do not commit until Task 9 fixes EVENT_CONFIG. Tasks 2-8 should proceed in parallel with Task 9; combine the commits at the end if needed to keep a green build at each commit.**

- [ ] **Step 4: Commit**

```bash
git add src/components/deal-detail/types.ts
git commit -m "feat(deal-detail): extend TimelineEventType and Engagement types for enrichment"
```

---

### Task 2: Remove 3 Sections from Project Details

**Files:**
- Modify: `src/components/deal-detail/section-registry.ts:138-206`
- Modify: `src/app/dashboards/deals/[pipeline]/[dealId]/DealDetailView.tsx:39-41`

- [ ] **Step 1: Delete 3 section entries from section-registry.ts**

Remove the `"revision-counts"` entry (lines 138-154), `"qc-metrics"` entry (lines 155-187), and `"incentive-programs"` entry (lines 188-206) from the `SECTION_REGISTRY` array. Keep `"install-planning"` (lines 118-137).

After removal, the array should go: `"install-planning"` → `"service-details"` → `"roofing-details"`.

- [ ] **Step 2: Update OPERATIONAL_SECTIONS in DealDetailView.tsx**

In `src/app/dashboards/deals/[pipeline]/[dealId]/DealDetailView.tsx`, replace lines 39-41:

```typescript
// Sections hidden from non-operational roles
const OPERATIONAL_SECTIONS = new Set([
  "install-planning",
]);
```

(Removed `"qc-metrics"` and `"revision-counts"` since those sections no longer exist.)

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: Only the EVENT_CONFIG Record exhaustiveness errors from Task 1 (if any). No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/deal-detail/section-registry.ts src/app/dashboards/deals/[pipeline]/[dealId]/DealDetailView.tsx
git commit -m "feat(deal-detail): remove Revision Counts, QC Metrics, and Incentive Programs sections"
```

---

### Task 3: Export FIELD_LABELS from Section Registry

**Files:**
- Modify: `src/components/deal-detail/section-registry.ts`

The sync changelog (Task 8) needs human-readable labels for deal property names. The section registry already maps `_key` (column name) → `label` via the `f()` helper. We extract this into a reusable constant.

- [ ] **Step 1: Write the test**

Create `src/__tests__/deal-detail/field-labels.test.ts`:

```typescript
import { FIELD_LABELS } from "@/components/deal-detail/section-registry";

describe("FIELD_LABELS", () => {
  it("maps known column names to human-readable labels", () => {
    expect(FIELD_LABELS["address"]).toBe("Address");
    expect(FIELD_LABELS["siteSurveyScheduleDate"]).toBe("Survey Scheduled");
    expect(FIELD_LABELS["installCrew"]).toBe("Install Crew");
    expect(FIELD_LABELS["designCompletionDate"]).toBe("Design Completed");
  });

  it("includes fields from all remaining sections", () => {
    // Project Details, Milestone Dates, Status Details, Install Planning, Service, Roofing
    expect(Object.keys(FIELD_LABELS).length).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/deal-detail/field-labels.test.ts --no-coverage`

Expected: FAIL — `FIELD_LABELS` is not exported.

- [ ] **Step 3: Build the FIELD_LABELS map**

At the bottom of `src/components/deal-detail/section-registry.ts`, before the `getSectionsForPipeline` function, add:

```typescript
// --- Field label lookup (for sync changelog display) ---

/**
 * Maps deal column names (camelCase) to human-readable labels.
 * Built by extracting the (key, label) pairs from all section field definitions.
 */
export const FIELD_LABELS: Record<string, string> = buildFieldLabels();

function buildFieldLabels(): Record<string, string> {
  const labels: Record<string, string> = {};
  // Use a Proxy-based SerializedDeal that records which keys are accessed
  // by the field functions, paired with the labels from the returned FieldDefs.
  for (const section of SECTION_REGISTRY) {
    const accessed: string[] = [];
    const proxy = new Proxy({} as SerializedDeal, {
      get(_target, prop: string) {
        accessed.push(prop);
        return null;
      },
    });
    const defs = section.fields(proxy);
    // accessed[] and defs[] are parallel arrays (same order)
    for (let i = 0; i < defs.length; i++) {
      if (accessed[i]) {
        labels[accessed[i]] = defs[i].label;
      }
    }
  }
  return labels;
}
```

Note: The Proxy approach works because `resolveFields` iterates the field definition array sequentially, calling `deal[_key]` for each entry, so `accessed[]` and the returned `FieldDef[]` have matching indices.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/deal-detail/field-labels.test.ts --no-coverage`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/deal-detail/section-registry.ts src/__tests__/deal-detail/field-labels.test.ts
git commit -m "feat(deal-detail): export FIELD_LABELS map from section registry for sync changelog"
```

---

## Chunk 2: New Timeline Source Fetchers

### Task 4: Add Zuper Status History Fetcher

**Files:**
- Modify: `src/lib/deal-timeline.ts`

Replaces the single-event-per-job `fetchZuperEvents()` with a multi-event status history extracted from `rawData.job_status`.

- [ ] **Step 1: Write the test**

Create `src/__tests__/deal-detail/zuper-status-events.test.ts`:

```typescript
/**
 * Tests the Zuper status history parsing logic.
 * We test the pure mapping function, not the DB query.
 */

// We'll extract the mapping logic into a testable function.
// For now, test the shape of what we expect.
import { parseZuperStatusHistory } from "@/lib/deal-timeline";

describe("parseZuperStatusHistory", () => {
  it("returns empty array for null rawData", () => {
    expect(parseZuperStatusHistory("job-123", "Construction", null)).toEqual([]);
  });

  it("returns empty array when job_status is missing", () => {
    expect(parseZuperStatusHistory("job-123", "Construction", { some: "data" })).toEqual([]);
  });

  it("returns empty array when job_status is not an array", () => {
    expect(parseZuperStatusHistory("job-123", "Construction", { job_status: "bad" })).toEqual([]);
  });

  it("maps status transitions to timeline events", () => {
    const rawData = {
      job_status: [
        { status_name: "SCHEDULED", created_at: "2026-04-10T10:00:00Z" },
        { status_name: "STARTED", created_at: "2026-04-11T08:00:00Z" },
        { status_name: "COMPLETED", created_at: "2026-04-11T16:00:00Z" },
      ],
    };
    const events = parseZuperStatusHistory("job-abc", "Construction", rawData);

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      id: "zstatus-job-abc-20260410100000-SCHEDULED",
      type: "zuper_status",
      title: "Construction — SCHEDULED",
      timestamp: "2026-04-10T10:00:00Z",
    });
    expect(events[2]).toMatchObject({
      id: "zstatus-job-abc-20260411160000-COMPLETED",
      type: "zuper_status",
      title: "Construction — COMPLETED",
      timestamp: "2026-04-11T16:00:00Z",
    });
  });

  it("skips entries without a timestamp", () => {
    const rawData = {
      job_status: [
        { status_name: "SCHEDULED", created_at: "2026-04-10T10:00:00Z" },
        { status_name: "STARTED" }, // no timestamp
      ],
    };
    const events = parseZuperStatusHistory("job-abc", "Site Survey", rawData);
    expect(events).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/deal-detail/zuper-status-events.test.ts --no-coverage`

Expected: FAIL — `parseZuperStatusHistory` not exported.

- [ ] **Step 3: Add parseZuperStatusHistory and replace fetchZuperEvents**

In `src/lib/deal-timeline.ts`, add the export and rewrite `fetchZuperEvents`:

```typescript
// Add to imports at top
import type { TimelineEvent, TimelinePage, Engagement } from "@/components/deal-detail/types";

/**
 * Parse Zuper job_status array from rawData into timeline events.
 * Exported for testing.
 */
export function parseZuperStatusHistory(
  jobUid: string,
  jobCategory: string,
  rawData: unknown,
): TimelineEvent[] {
  if (!rawData || typeof rawData !== "object") return [];
  const data = rawData as Record<string, unknown>;
  if (!Array.isArray(data.job_status)) return [];

  return data.job_status
    .map((entry: Record<string, unknown>) => {
      const statusName = String(entry?.status_name ?? "Unknown");
      const ts = entry?.created_at as string | undefined;
      if (!ts) return null;
      // Stable ID: derived from payload data, not array index.
      // Avoids cursor/key breakage if Zuper reorders or backfills entries.
      const tsSlug = ts.replace(/[^0-9]/g, "").slice(0, 14);
      return {
        id: `zstatus-${jobUid}-${tsSlug}-${statusName}`,
        type: "zuper_status" as const,
        timestamp: ts,
        title: `${jobCategory} — ${statusName}`,
        detail: null,
        author: null,
        metadata: { jobUid, statusName },
      };
    })
    .filter((e): e is TimelineEvent => e !== null);
}
```

Then replace the existing `fetchZuperEvents` function (lines 174-206) with:

```typescript
async function fetchZuperEvents(
  hubspotDealId: string,
  windowStart: Date | null,
  cursor: Cursor | null,
): Promise<TimelineEvent[]> {
  const jobs = await prisma.zuperJobCache.findMany({
    where: { hubspotDealId },
  });

  const events = jobs.flatMap((job) =>
    parseZuperStatusHistory(job.jobUid, job.jobCategory, job.rawData),
  );

  return events
    .filter((e) => isInWindow(e.timestamp, windowStart))
    .filter((e) => !cursor || isBeforeCursor(e.timestamp, e.id, cursor));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/deal-detail/zuper-status-events.test.ts --no-coverage`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/deal-timeline.ts src/__tests__/deal-detail/zuper-status-events.test.ts
git commit -m "feat(deal-detail): replace single Zuper event with full status history timeline"
```

---

### Task 5: Add BOM Pipeline and Schedule Record Fetchers

**Files:**
- Modify: `src/lib/deal-timeline.ts`

Two new DB-backed fetchers delegating to `fetchDbEvents()` — the same helper used by `fetchNoteEvents` and `fetchSyncEvents`. This preserves the cross-source split-query cursor strategy.

**Important:** `BomPipelineRun.dealId` stores the **HubSpot deal ID** (not the internal cuid), so this fetcher takes `hubspotDealId`.

- [ ] **Step 1: Add fetchBomEvents**

In `src/lib/deal-timeline.ts`, add after `fetchSyncEvents`:

```typescript
const BOM_STATUS_LABEL: Record<string, string> = {
  RUNNING: "started",
  SUCCEEDED: "completed",
  FAILED: "failed",
  PARTIAL: "partially completed",
};

async function fetchBomEvents(
  hubspotDealId: string,
  windowStart: Date | null,
  cursor: Cursor | null,
): Promise<TimelineEvent[]> {
  return fetchDbEvents({
    baseWhere: { dealId: hubspotDealId },
    windowStart,
    cursor,
    prefix: "bom",
    findMany: (args) => prisma.bomPipelineRun.findMany(args),
    toEvent: (run) => ({
      id: `bom-${run.id}`,
      type: "bom" as const,
      timestamp: run.createdAt.toISOString(),
      title: `BOM ${BOM_STATUS_LABEL[run.status] ?? run.status} — ${run.trigger.replace(/_/g, " ").toLowerCase()}`,
      detail: run.status === "FAILED" ? (run.errorMessage ?? run.failedStep ?? null) : null,
      author: null,
      metadata: {
        trigger: run.trigger,
        status: run.status,
        failedStep: run.failedStep,
        durationMs: run.durationMs,
        snapshotVersion: run.snapshotVersion,
      },
    }),
  });
}
```

- [ ] **Step 2: Add fetchScheduleEvents**

Add after `fetchBomEvents`:

```typescript
const SCHEDULE_TYPE_LABEL: Record<string, string> = {
  survey: "Survey",
  construction: "Install",
  inspection: "Inspection",
};

async function fetchScheduleEvents(
  hubspotDealId: string,
  windowStart: Date | null,
  cursor: Cursor | null,
): Promise<TimelineEvent[]> {
  return fetchDbEvents({
    baseWhere: { projectId: hubspotDealId },
    windowStart,
    cursor,
    prefix: "sched",
    findMany: (args) => prisma.scheduleRecord.findMany(args),
    toEvent: (rec) => ({
      id: `sched-${rec.id}`,
      type: "schedule" as const,
      timestamp: rec.createdAt.toISOString(),
      title: `${SCHEDULE_TYPE_LABEL[rec.scheduleType] ?? rec.scheduleType} ${rec.status} — ${rec.scheduledDate}`,
      detail: rec.assignedUser ? `Assigned to ${rec.assignedUser}` : null,
      author: rec.scheduledBy ?? null,
      metadata: {
        scheduleType: rec.scheduleType,
        scheduledDate: rec.scheduledDate,
        status: rec.status,
        assignedUser: rec.assignedUser,
        zuperSynced: rec.zuperSynced,
      },
    }),
  });
}
```

- [ ] **Step 3: Wire into getDealTimeline fan-out**

Update the `getDealTimeline` function. Replace the existing `Promise.all` (lines 319-326) and merge (lines 331-341):

```typescript
  // Fan-out: all sources in parallel
  const [noteEvents, syncEvents, zuperEvents, photoEvents, bomEvents, scheduleEvents, engagements] =
    await Promise.all([
      fetchNoteEvents(dealId, windowStart, cursor),
      fetchSyncEvents(dealId, windowStart, cursor),
      fetchZuperEvents(hubspotDealId, windowStart, cursor),
      fetchPhotoEvents(hubspotDealId, windowStart, cursor),
      fetchBomEvents(hubspotDealId, windowStart, cursor),
      fetchScheduleEvents(hubspotDealId, windowStart, cursor),
      getDealEngagements(hubspotDealId, options.all ?? false),
    ]);

  const engagementEvents = engagementToTimelineEvents(engagements, windowStart, cursor);

  // Merge, sort by (timestamp DESC, id DESC), paginate
  const allEvents = [
    ...noteEvents,
    ...syncEvents,
    ...zuperEvents,
    ...photoEvents,
    ...bomEvents,
    ...scheduleEvents,
    ...engagementEvents,
  ].sort((a, b) => {
    const timeDiff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    if (timeDiff !== 0) return timeDiff;
    return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
  });
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: Only EVENT_CONFIG Record errors from Task 1 (fixed in Task 6).

- [ ] **Step 5: Commit**

```bash
git add src/lib/deal-timeline.ts
git commit -m "feat(deal-detail): add BOM pipeline and schedule record fetchers to timeline"
```

---

## Chunk 3: Zuper Notes, HubSpot Tasks, and Improved Sources

### Task 6: Add Zuper Job Notes Fetcher

**Files:**
- Modify: `src/lib/deal-timeline.ts`

- [ ] **Step 1: Add fetchZuperNoteEvents**

In `src/lib/deal-timeline.ts`, add after `fetchPhotoEvents`:

```typescript
async function fetchZuperNoteEvents(
  hubspotDealId: string,
  windowStart: Date | null,
  cursor: Cursor | null,
): Promise<TimelineEvent[]> {
  if (!zuper.isConfigured()) return [];

  const jobs = await prisma.zuperJobCache.findMany({
    where: { hubspotDealId },
    select: { jobUid: true, jobCategory: true, lastSyncedAt: true },
  });
  if (jobs.length === 0) return [];

  const noteArrays = await Promise.all(
    jobs.map(async (job) => {
      try {
        const cacheKey = `deal-zuper-notes:${hubspotDealId}:${job.jobUid}`;
        const cached = await appCache.getOrFetch(cacheKey, () =>
          zuper.getJobNotes(job.jobUid),
        );
        if (cached.data.type === "error") return [];
        const notes = cached.data.data?.notes ?? [];
        return notes
          .filter((n) => !!n.created_at) // Skip notes without timestamps — unstable for pagination
          .map((n) => {
          const author = [n.created_by?.first_name, n.created_by?.last_name]
            .filter(Boolean)
            .join(" ") || "Unknown";
          return {
            id: `znote-${n.note_uid}`,
            type: "zuper_note" as const,
            timestamp: n.created_at!,
            title: `Zuper Note by ${author} (${job.jobCategory})`,
            detail: n.note ?? null,
            author,
            metadata: {
              jobUid: job.jobUid,
              jobCategory: job.jobCategory,
              noteUid: n.note_uid,
            },
          };
        });
      } catch {
        return [];
      }
    }),
  );

  return noteArrays
    .flat()
    .filter((e) => isInWindow(e.timestamp, windowStart))
    .filter((e) => !cursor || isBeforeCursor(e.timestamp, e.id, cursor));
}
```

**Important:** The `appCache.getOrFetch` caches the full `ZuperApiResponse` wrapper. The inner check `cached.data.type === "error"` handles API failures gracefully.

- [ ] **Step 2: Wire into getDealTimeline fan-out**

Add `fetchZuperNoteEvents` to the `Promise.all` array and spread into `allEvents`:

In the destructuring:
```typescript
  const [noteEvents, syncEvents, zuperEvents, photoEvents, bomEvents, scheduleEvents, zuperNoteEvents, engagements] =
    await Promise.all([
      fetchNoteEvents(dealId, windowStart, cursor),
      fetchSyncEvents(dealId, windowStart, cursor),
      fetchZuperEvents(hubspotDealId, windowStart, cursor),
      fetchPhotoEvents(hubspotDealId, windowStart, cursor),
      fetchBomEvents(hubspotDealId, windowStart, cursor),
      fetchScheduleEvents(hubspotDealId, windowStart, cursor),
      fetchZuperNoteEvents(hubspotDealId, windowStart, cursor),
      getDealEngagements(hubspotDealId, options.all ?? false),
    ]);
```

In the merge array, add `...zuperNoteEvents,` after `...scheduleEvents,`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/deal-timeline.ts
git commit -m "feat(deal-detail): add Zuper job notes to activity timeline"
```

---

### Task 7: Add HubSpot Tasks to Engagements

**Files:**
- Modify: `src/lib/hubspot-engagements.ts`
- Modify: `src/lib/deal-timeline.ts` (engagementToTimelineEvents)

- [ ] **Step 1: Add task properties and mapper in hubspot-engagements.ts**

After `MEETING_PROPERTIES` (line 65), add:

```typescript
const TASK_PROPERTIES = [
  "hs_task_subject", "hs_task_body", "hs_task_status",
  "hs_timestamp", "hs_task_priority", "hs_task_type",
];
```

After `mapMeeting` (line 176), add:

```typescript
function mapTask(p: Record<string, string | null>, id: string): Engagement {
  return {
    id: `task-${id}`,
    type: "task",
    timestamp: p.hs_timestamp ?? new Date(0).toISOString(),
    subject: p.hs_task_subject ?? null,
    body: p.hs_task_body ?? null,
    from: null,
    to: null,
    duration: null,
    disposition: p.hs_task_status ?? null, // reuse disposition for task status
    attendees: null,
    createdBy: null,
  };
}
```

- [ ] **Step 2: Add tasks to the parallel fetch**

In `getDealEngagements` (line 199), add tasks to the `Promise.all`:

```typescript
    const [emails, calls, notes, meetings, tasks] = await Promise.all([
      fetchAssociatedObjects(hubspotDealId, "emails", EMAIL_PROPERTIES, mapEmail),
      fetchAssociatedObjects(hubspotDealId, "calls", CALL_PROPERTIES, mapCall),
      fetchAssociatedObjects(hubspotDealId, "notes", NOTE_PROPERTIES, mapNote),
      fetchAssociatedObjects(hubspotDealId, "meetings", MEETING_PROPERTIES, mapMeeting),
      fetchAssociatedObjects(hubspotDealId, "tasks", TASK_PROPERTIES, mapTask),
    ]);

    return [...emails, ...calls, ...notes, ...meetings, ...tasks].sort(
```

- [ ] **Step 3: Update engagementToTimelineEvents in deal-timeline.ts**

In `src/lib/deal-timeline.ts`, update the `engagementToTimelineEvents` function. Replace the type-label logic (lines 266-273):

```typescript
    const typeLabel = eng.type === "email" ? "Email"
      : eng.type === "call" ? "Call"
      : eng.type === "meeting" ? "Meeting"
      : eng.type === "task" ? "Task"
      : "HubSpot Note";
    const titleParts: string[] = [typeLabel];
    if (eng.type === "email" && eng.subject) titleParts.push(`— ${eng.subject}`);
    if (eng.type === "call" && eng.disposition) titleParts.push(`— ${eng.disposition}`);
    if (eng.type === "meeting" && eng.subject) titleParts.push(`— ${eng.subject}`);
    if (eng.type === "task" && eng.subject) titleParts.push(`— ${eng.subject}`);
```

And update the type mapping (line 278):

```typescript
      type: eng.type === "note" ? "hubspot_note" : eng.type,
```

This already works — `"task"` passes through as `"task"`, which is now a valid `TimelineEventType`.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: Still the EVENT_CONFIG Record errors (fixed next task).

- [ ] **Step 5: Commit**

```bash
git add src/lib/hubspot-engagements.ts src/lib/deal-timeline.ts
git commit -m "feat(deal-detail): add HubSpot tasks to engagement pipeline"
```

---

### Task 8: Improve Sync Changelog Labels

**Files:**
- Modify: `src/lib/deal-timeline.ts` (fetchSyncEvents)
- Modify: `src/components/deal-detail/TimelineEventRow.tsx` (SyncChangesDiff)

- [ ] **Step 1: Import FIELD_LABELS and update fetchSyncEvents toEvent callback**

In `src/lib/deal-timeline.ts`, add to imports:

```typescript
import { FIELD_LABELS } from "@/components/deal-detail/section-registry";
```

Add a noise filter constant near the top of the file (after `NINETY_DAYS_MS`):

```typescript
const SYNC_NOISE_FIELDS = new Set([
  "lastmodifieddate", "hs_lastmodifieddate", "notes_last_updated",
  "hs_object_id", "hs_all_owner_ids", "hs_updated_by_user_id",
]);
```

In `fetchSyncEvents`, the function delegates to `fetchDbEvents()` with a `toEvent` callback. Update that `toEvent` callback to add noise filtering, FIELD_LABELS lookup, and `displayChanges` metadata. Replace the existing `toEvent: (log) => { ... }` callback:

```typescript
    toEvent: (log) => {
      const rawChanges = log.changesDetected as Record<string, [unknown, unknown]> | null;
      // Filter out noise fields
      const changes = rawChanges
        ? Object.fromEntries(
            Object.entries(rawChanges).filter(([key]) => !SYNC_NOISE_FIELDS.has(key)),
          )
        : null;
      const fieldCount = changes ? Object.keys(changes).length : 0;
      const sourceLabel = log.source.replace(/^(batch|single):/, "");

      // Build display-friendly changes with human labels
      const displayChanges = changes
        ? Object.fromEntries(
            Object.entries(changes).map(([key, pair]) => [
              key,
              {
                label: FIELD_LABELS[key] ?? key,
                old: (pair as [unknown, unknown])[0],
                new: (pair as [unknown, unknown])[1],
              },
            ]),
          )
        : null;

      return {
        id: `sync-${log.id}`,
        type: "sync" as const,
        timestamp: log.createdAt.toISOString(),
        title: fieldCount > 0
          ? `${fieldCount} field${fieldCount === 1 ? "" : "s"} updated via ${sourceLabel}`
          : `Sync (${log.syncType.toLowerCase()}) — no changes`,
        detail: null,
        author: null,
        metadata: { changes, displayChanges, syncType: log.syncType, source: log.source },
      };
    },
```

Note: This replaces only the `toEvent` callback inside the existing `fetchDbEvents()` call — the cursor/pagination logic in `fetchDbEvents()` is untouched.

- [ ] **Step 2: Update SyncChangesDiff to use displayChanges**

In `src/components/deal-detail/TimelineEventRow.tsx`, replace the `SyncChangesDiff` component (lines 37-53):

```typescript
function SyncChangesDiff({ changes }: { changes: Record<string, unknown> }) {
  // Prefer displayChanges (with human-readable labels) over raw changes
  const entries = Object.entries(changes);
  return (
    <div className="mt-1 space-y-0.5">
      {entries.map(([field, pair]) => {
        // displayChanges format: { label, old, new }
        const isDisplayFormat = pair && typeof pair === "object" && "label" in (pair as object);
        let label: string;
        let oldVal: unknown;
        let newVal: unknown;

        if (isDisplayFormat) {
          const d = pair as { label: string; old: unknown; new: unknown };
          label = d.label;
          oldVal = d.old;
          newVal = d.new;
        } else {
          // Fallback: raw [old, new] tuple
          label = field;
          oldVal = (pair as [unknown, unknown])[0];
          newVal = (pair as [unknown, unknown])[1];
        }

        return (
          <div key={field} className="text-[10px]">
            <span className="font-medium text-muted">{label}:</span>{" "}
            <span className="text-red-400 line-through">{String(oldVal ?? "\u2014")}</span>{" "}
            <span className="text-emerald-400">{String(newVal ?? "\u2014")}</span>
          </div>
        );
      })}
    </div>
  );
}
```

Also update the `hasSyncChanges` check and the prop passed to `SyncChangesDiff`. In the `TimelineEventRow` component body (around line 73), update:

```typescript
  // Sync change detail — prefer displayChanges (labeled) over raw changes
  const displayChanges = meta.displayChanges as Record<string, unknown> | undefined;
  const rawChanges = meta.changes as Record<string, [unknown, unknown]> | undefined;
  const syncChanges = displayChanges ?? rawChanges;
  const hasSyncChanges = event.type === "sync" && !!syncChanges && Object.keys(syncChanges).length > 0;
```

And update the render (around line 144):

```typescript
        {expanded && hasSyncChanges && (
          <SyncChangesDiff changes={syncChanges!} />
        )}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/deal-timeline.ts src/components/deal-detail/TimelineEventRow.tsx
git commit -m "feat(deal-detail): show human-readable labels in sync changelog and filter noise fields"
```

---

## Chunk 4: UI Config Updates and Sanitizer

### Task 9: Update EVENT_CONFIG, TYPE_CONFIG, HTML_BODY_TYPES

**Files:**
- Modify: `src/components/deal-detail/TimelineEventRow.tsx:7-16,56,59`
- Modify: `src/components/deal-detail/CommunicationsFeed.tsx:13-18`

- [ ] **Step 1: Update EVENT_CONFIG in TimelineEventRow.tsx**

Replace EVENT_CONFIG (lines 7-16):

```typescript
const EVENT_CONFIG: Record<TimelineEventType, { icon: string; color: string; label: string }> = {
  note:         { icon: "\u{1F4DD}", color: "text-orange-500", label: "Note" },
  sync:         { icon: "\u{1F504}", color: "text-blue-500",   label: "Sync" },
  zuper:        { icon: "\u{1F527}", color: "text-green-500",  label: "Zuper" },
  zuper_status: { icon: "\u{1F504}", color: "text-green-500",  label: "Job Status" },
  zuper_note:   { icon: "\u{1F527}", color: "text-green-500",  label: "Zuper Note" },
  bom:          { icon: "\u{1F4E6}", color: "text-purple-500", label: "BOM" },
  schedule:     { icon: "\u{1F4C5}", color: "text-blue-500",   label: "Scheduled" },
  photo:        { icon: "\u{1F4F7}", color: "text-purple-500", label: "Photo" },
  email:        { icon: "\u2709\uFE0F",  color: "text-cyan-500",   label: "Email" },
  call:         { icon: "\u{1F4DE}", color: "text-cyan-500",   label: "Call" },
  meeting:      { icon: "\u{1F4C5}", color: "text-cyan-500",   label: "Meeting" },
  hubspot_note: { icon: "\u{1F4CB}", color: "text-cyan-500",   label: "HubSpot Note" },
  task:         { icon: "\u2611\uFE0F",  color: "text-yellow-500", label: "Task" },
};
```

- [ ] **Step 2: Update HTML_BODY_TYPES and AUTO_EXPAND_TYPES**

Replace line 56:

```typescript
const HTML_BODY_TYPES = new Set<TimelineEventType>(["email", "call", "meeting", "hubspot_note", "task"]);
```

Replace line 59:

```typescript
const AUTO_EXPAND_TYPES = new Set<TimelineEventType>(["note", "hubspot_note", "zuper_note"]);
```

- [ ] **Step 3: Update TYPE_CONFIG in CommunicationsFeed.tsx**

In `src/components/deal-detail/CommunicationsFeed.tsx`, replace TYPE_CONFIG (lines 13-18):

```typescript
const TYPE_CONFIG: Record<string, { icon: string; label: string }> = {
  email:   { icon: "\u2709\uFE0F",  label: "Email" },
  call:    { icon: "\u{1F4DE}", label: "Call" },
  note:    { icon: "\u{1F4CB}", label: "Note" },
  meeting: { icon: "\u{1F4C5}", label: "Meeting" },
  task:    { icon: "\u2611\uFE0F",  label: "Task" },
};
```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: No errors. All EVENT_CONFIG Record keys now match the full TimelineEventType union.

- [ ] **Step 5: Commit**

```bash
git add src/components/deal-detail/TimelineEventRow.tsx src/components/deal-detail/CommunicationsFeed.tsx
git commit -m "feat(deal-detail): update EVENT_CONFIG and TYPE_CONFIG for all new timeline event types"
```

---

### Task 10: Strip @mention Markup from Sanitized HTML

**Files:**
- Modify: `src/lib/sanitize-engagement-html.ts`

- [ ] **Step 1: Write the test**

Create `src/__tests__/deal-detail/sanitize-mentions.test.ts`:

```typescript
import { sanitizeEngagementHtml } from "@/lib/sanitize-engagement-html";

describe("sanitizeEngagementHtml @mention handling", () => {
  it("strips @mention links to plain text", () => {
    const input = '<p>Hey <a href="/contacts/123" data-type="mention">@John Smith</a>, can you review?</p>';
    const result = sanitizeEngagementHtml(input);
    expect(result).toContain("@John Smith");
    expect(result).not.toContain("data-type");
    expect(result).not.toContain('href="/contacts');
    // Should be wrapped in a span, not an anchor
    expect(result).toContain("<span>");
  });

  it("preserves normal links", () => {
    const input = '<p>See <a href="https://example.com">this link</a></p>';
    const result = sanitizeEngagementHtml(input);
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain("target=\"_blank\"");
  });

  it("handles null/undefined input", () => {
    expect(sanitizeEngagementHtml(null)).toBe("");
    expect(sanitizeEngagementHtml(undefined)).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/deal-detail/sanitize-mentions.test.ts --no-coverage`

Expected: FAIL — @mention link still rendered as `<a>` tag.

- [ ] **Step 3: Update the sanitizer transformTags**

In `src/lib/sanitize-engagement-html.ts`, update the `transformTags` section in `ENGAGEMENT_SANITIZE_OPTIONS`:

```typescript
  transformTags: {
    a: (tagName, attribs) => {
      // Strip @mention links — replace with plain <span>
      if (attribs["data-type"] === "mention") {
        return {
          tagName: "span",
          attribs: {},
        };
      }
      // Normal links: open in new tab
      return {
        tagName,
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      };
    },
  },
```

Also add `"data-type"` to the allowed attributes for `a` tags so the sanitizer doesn't strip it before the transform can see it:

```typescript
  allowedAttributes: {
    a: ["href", "target", "rel", "data-type"],
    img: ["src", "alt", "width", "height"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/deal-detail/sanitize-mentions.test.ts --no-coverage`

Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx jest --no-coverage 2>&1 | tail -20`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sanitize-engagement-html.ts src/__tests__/deal-detail/sanitize-mentions.test.ts
git commit -m "feat(deal-detail): strip @mention markup from HubSpot engagement HTML"
```

---

### Task 11: Final Verification and Integration Test

- [ ] **Step 1: Run TypeScript compilation**

Run: `npx tsc --noEmit`

Expected: Clean — no errors.

- [ ] **Step 2: Run full test suite**

Run: `npx jest --no-coverage`

Expected: All tests pass.

- [ ] **Step 3: Run linter**

Run: `npx next lint`

Expected: No errors.

- [ ] **Step 4: Test dev server loads deal detail page**

Run: `npm run dev` and navigate to a deal detail page. Verify:
- Activity tab shows new event types (Zuper status transitions, BOM events, schedule events, Zuper notes)
- Communications tab shows tasks alongside emails/calls/notes/meetings
- Sync events show human-readable field names in the diff viewer
- @mention markup renders as plain text
- Project Details tab no longer shows Revision Counts, QC Metrics, or Incentive Programs
- Install Planning section still present

- [ ] **Step 5: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix(deal-detail): integration fixups for enrichment"
```
