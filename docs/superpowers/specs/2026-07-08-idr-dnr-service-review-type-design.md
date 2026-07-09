# IDR Meeting Hub: D&R/Service Design Review Type

**Date:** 2026-07-08
**Status:** Draft — pending review
**Builds on:** `2026-07-08-idr-new-construction-review-type-design.md` (shipped, PR #1336)

## Problem

Deals on the Service (23928924) and D&R (21997330) pipelines use the same
`design_status` lifecycle as solar projects, and their design reviews are
tracked in HubSpot with a combined "D&R/Service Design Review - ZRS" task.
But the IDR meeting queue filters to the Project pipeline only, so these
deals never appear — 3 Service deals sit in "Initial Review" today,
invisible to the meeting. The design team tracks them manually.

## Decisions (confirmed with Zach, 2026-07-08)

1. **One combined type**: `DNR_SERVICE`, matching HubSpot's model (shared
   task subject, shared completion workflow). The queue badge distinguishes
   the pipeline: **SVC** for Service deals, **D&R** for D&R deals.
2. **Revisions ride the IDR track**: `idr_revision_type = "design"` →
   `design_status = "IDR Revision Needed"`, reason in `idr_revision_reason`.
   Verified: all four IDR revision workflows have no pipeline filter, so
   this works for Service/D&R deals with zero HubSpot changes.
3. **No BOM auto-extract** for `DNR_SERVICE` items (not planset-driven);
   the on-demand extract in the detail panel remains available.
4. **Registry-driven queue construction** (Approach A): `fetchInitialReviewDeals`
   builds its HubSpot filter groups from the `REVIEW_TYPES` registry instead
   of hardcoded groups, and the re-review pull-back widens to all registry
   pipelines. Same session, full detail panel, escalation-wins precedence —
   all per the established pattern.

## Verified HubSpot plumbing (no HubSpot changes required)

Verified live on 2026-07-08 against the production portal:

- **Task:** "D&R/Service Design Review - ZRS" — 20 historical instances,
  1 open now; created upstream by the enabled "Design Flow - D&R/Service
  Design Needed" chain. Suffix varies by location (same ZRS/WMS pattern as
  the other review tasks).
- **Completion workflow:** "Design Flow - D&R Design Review Complete"
  (flow 1689120051, **enabled**): enrolls when a task with subject
  "D&R/Service Design Review - ZRS" *or* "Complete Initial Design Review - ZRS"
  is COMPLETED while `design_status = "Initial Review"` and pipeline ∈
  {21997330, 23928924}. Sets `design_status = "Complete"` (these reviews
  skip the Draft Complete / DA loop) and stamps `design_completion_date` +
  `design_draft_completion_date`.
- **Revision workflows:** "IDR Revision Needed" override (1824183154),
  "Design Flow - IDR Revision Needed" (1820376181), "IDR Revision In
  Progress" (1820413984), "IDR Revision Complete" (1820367966) — all
  enabled, all with **no pipeline enrollment filter**.
- **Status usage:** Service and D&R deals populate the standard
  `design_status` property (61 and 66 deals respectively), including
  "Initial Review".

## Design

### 1. Data model

Two additive changes:

- `IdrItemType` enum gains `DNR_SERVICE`.
- `IdrMeetingItem` gains `pipeline String?` — the deal's HubSpot pipeline ID,
  snapshotted at item creation. Drives the SVC/D&R badge split and is
  nullable so existing rows stay valid.

One migration file with both statements (`ALTER TYPE ... ADD VALUE` +
`ALTER TABLE ... ADD COLUMN`). Per convention, the migration is written on
the branch and applied to prod manually by Zach before merge; the new enum
value is not written by any code in the same transaction.

### 2. Registry changes (`src/lib/idr-meeting.ts`)

`REVIEW_TYPES` rows gain queue-construction and behavior fields; the
existing sync fields (noteLabel, taskSubject, revisionType,
revisionReasonProperty) are unchanged in shape:

```ts
export const SERVICE_PIPELINE_ID = process.env.HUBSPOT_PIPELINE_SERVICE ?? "23928924";
export const DNR_PIPELINE_ID = process.env.HUBSPOT_PIPELINE_DNR ?? "21997330";

// Per-type queue config. ESCALATION (queue-driven, no status pull) carries
// explicit autoBomExtract: false / pushRevisionFlagsWithoutTask: false and no
// pipelines/statusValue, keeping the consumed fields non-optional:
//   pipelines        — HubSpot pipeline IDs this type watches
//   statusValue      — design_status that pulls a deal into the queue
//   terminalStages   — dealstage IDs excluded from the pull
//   autoBomExtract   — fire BOM extraction at session creation
//   pushRevisionFlagsWithoutTask — NC-only resilience behavior (replaces the
//                                  hardcoded item.type === "NEW_CONSTRUCTION")
```

| field | IDR | NEW_CONSTRUCTION | DNR_SERVICE | ESCALATION |
|---|---|---|---|---|
| pipelines | [PROJECT] | [PROJECT] | [SERVICE, DNR] | — |
| statusValue | Initial Review | NC - Ready for Review | Initial Review | — |
| terminalStages (flat array; DNR_SERVICE holds the SVC+D&R union) | 68229433, 20440343, 20440344 | same as IDR | 56217769 (SVC Cancelled), 76979603 (SVC Completed), 52474745 (D&R Cancelled), 68245827 (D&R Complete), 72700977 (D&R On-hold) | — |
| autoBomExtract | true | true | **false** | false |
| pushRevisionFlagsWithoutTask | false | **true** | false | false |
| taskSubject | Complete Initial Design Review | New Construction Design Review | **D&R/Service Design Review** | Complete Initial Design Review |
| revisionType | design | escalation | **design** | escalation |
| revisionReasonProperty | idr_revision_reason | inspection_rejection_reason | **idr_revision_reason** | inspection_rejection_reason |
| noteLabel | IDR Meeting | New Construction Review | **D&R/Service Design Review** | IDR Meeting |

**Type derivation** becomes pipeline-first:

```ts
deriveItemType(pipeline, designStatus):
  pipeline ∈ {SERVICE, DNR}          → DNR_SERVICE
  designStatus == NC ready-for-review → NEW_CONSTRUCTION
  otherwise                           → IDR
```

Pipeline wins so a manually-added Service/D&R deal is always `DNR_SERVICE`
regardless of its current status (its review plumbing is determined by
pipeline). Escalation-wins precedence is unchanged and sits above this.

### 3. Queue construction

`fetchInitialReviewDeals` builds filter groups from the registry: **one group
per type** — `{pipeline IN type.pipelines, dealstage NotIn type.terminalStages,
design_status = statusValue}` — plus the existing re-review group. That's 4
groups total (IDR, NC, DNR_SERVICE, re-review), leaving headroom under
HubSpot's 5-filterGroup search cap. `terminalStages` is a **flat array per
registry row** (for DNR_SERVICE, the union of the Service and D&R terminal
stage IDs — safe because stage IDs are pipeline-scoped, so a `NotIn` union
never over-excludes).

The re-review group widens from `pipeline = PROJECT` to
`pipeline IN {union of all registry pipelines}` with `dealstage NotIn {union
of all registry terminal stages}`, so re-review-flagged Service/D&R deals
return to the queue and cancelled/completed ones don't. `limit: 200` stays
(current combined volume: ~a few dozen).

`SNAPSHOT_PROPERTIES` gains `"pipeline"`, and `snapshotDealProperties` maps
it to the new `pipeline` column. Snapshot-refresh paths (session refresh,
preview, escalation creation) spread `...snapshot`, so `pipeline` backfills
onto existing rows for free on their next refresh; item `type` is
intentionally never re-derived on refresh (snapshot semantics: type is fixed
at creation). Existing null-pipeline rows are all IDR/NC/ESCALATION, whose
badges never read `pipeline`.

**Deal search widens too:** `/api/idr-meeting/deal-search` currently
hard-filters `pipeline = PROJECT`, which would make manual add of
Service/D&R deals impossible. It changes to `pipeline IN {union of all
registry pipelines}` and returns each deal's `pipeline` so AddProjectDialog
can show an SVC/D&R marker in the picker (type is still derived server-side
on add). (This also means a Service/D&R deal can be manually
escalated; that combination keeps today's escalation behavior — the
IDR-subject task likely won't exist on such deals, so sync warns and the
task-gated revision flags don't push. Accepted and documented, not specially
handled.)

### 4. Item creation (sessions, preview, manual add)

All three routes replace `deriveItemTypeFromStatus(designStatus)` with
`deriveItemType(pipeline, designStatus)`. The BOM auto-extract filter in the
sessions route becomes registry-driven:
`REVIEW_TYPES[item.type].autoBomExtract && item.designFolderUrl`.

### 5. Sync

No structural changes — the registry already drives task subject, revision
type, reason property, and note label. `DNR_SERVICE` resolves to the
combined task subject and the IDR revision branch. The NC-only
push-without-task behavior moves from the `item.type === "NEW_CONSTRUCTION"`
check to the registry's `pushRevisionFlagsWithoutTask` flag (D&R/Service
task creation is active in HubSpot, so it stays task-gated like IDR).

Token cross-match check for the new subject: CONTAINS_TOKEN tokenizes on
`&` and `/`, so "D&R/Service Design Review" requires (among others) the
token "Service", which no other review-task subject contains; conversely it
lacks "Complete"/"Initial"/"Construction". The
completion workflow also accepts a completed "Complete Initial Design
Review - ZRS" task on these pipelines, so even a mis-created IDR-style task
would still advance the deal — but sync always targets the combined subject.

### 6. UI

- `ReviewItemType` in `idr-meeting.ts` widens to include `"DNR_SERVICE"` —
  this is what keeps `items/[id]/sync` and `sync-unsynced` (which pass whole
  Prisma rows into `syncItemToHubSpot`) typechecking.
- UI type unions widen to include `"DNR_SERVICE"` (IdrMeetingClient,
  NoteHistory, DealHistoryDetail); `IdrItem` **and** the local item
  interfaces in NoteHistory/DealHistoryDetail gain `pipeline: string | null`
  (the deal-history API returns full Prisma rows, so the data already flows).
- Queue badge: `DNR_SERVICE` items show **SVC** (Service pipeline) or
  **D&R** (D&R pipeline), amber, same compact style as the NC badge.
  History pills map `DNR_SERVICE` → "SVC"/"D&R" by pipeline (falling back
  to "D&R/SVC" when pipeline is null on old rows).
- Detail panel: unchanged, full panel.

### 7. Out of scope

- No HubSpot workflow/property/status changes.
- Roofing pipeline (765928545): excluded — 1 deal with design_status, value
  "No Design Needed"; nothing to review.
- No admin-configurable types.

## Testing

- Registry: DNR_SERVICE row values (task subject, revision routing, no
  auto-extract, task-gated).
- `deriveItemType`: pipeline-first precedence (Service/D&R pipeline → DNR_SERVICE
  even in NC or other statuses; Project + NC status → NEW_CONSTRUCTION;
  Project + else → IDR; unknown/null pipeline → status rules).
- Filter-group construction: one group per type (DNR_SERVICE uses
  `pipeline IN [SVC, DNR]` with the union terminal exclusions); re-review
  group spans all registry pipelines.
- Sync: DNR_SERVICE task search uses the combined subject; revision push is
  task-gated (no push when task missing) and sends `idr_revision_type = "design"`;
  NC keeps push-without-task via the registry flag (regression).
- Reason routing: DNR_SERVICE → `idr_revision_reason`.
- Note header: "D&R/Service Design Review -- {date}".
- Badge/pill mapping by pipeline.

## Rollout

1. Additive migration (enum value + pipeline column) — applied by Zach
   before merge.
2. Ship code. No feature flag. On day one the queue gains the current
   Service deals in Initial Review (~3, one of which is a test deal Zach
   may want to clean up).
3. Location-bucket note: bucketed sessions filter by `pb_location`; all 3
   current Service Initial Review deals have it populated (verified live).
   A blank-location Service/D&R deal would only appear in an "all" session —
   pre-existing mechanics, accepted.
4. Verify on the next session: SVC-badged items appear, sync completes the
   combined task, flow 1689120051 flips design_status to "Complete".
