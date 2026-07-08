# IDR Meeting Hub: New Construction Review Type

**Date:** 2026-07-08
**Status:** Draft — pending review

## Problem

The IDR meeting page pulls projects for review based on a single design status:
`design_status = "Initial Review"` (plus flagged IDR re-reviews). The design team
also runs New Construction design reviews — deals whose `design_status` is
`"New Construction - Ready for Review"` — but those never appear in the meeting
queue, so they are tracked manually outside the tool.

New Construction (NC) reviews happen late in the process: after the home is
built and a site survey is completed, and usually after the project is already
permitted. The review itself works like an IDR (full detail panel applies), but
the HubSpot plumbing differs in task subject and revision destination.

## Decisions (confirmed with Zach, 2026-07-08)

1. **Scope:** Add New Construction as the only new review type for now.
   Final Review/Stamping, Final Design Review (DA Approved), and the Xcel track
   are out of scope.
2. **Layout:** NC deals auto-pull into the same meeting session as IDR deals,
   badged as their own review type in the queue. No separate tab or session type.
3. **Detail panel:** Full IDR detail panel unchanged (readiness checks, BOM
   extract, adders checklist, pricing, install planning). NC reviews come after
   a survey, so survey-based checks apply.
4. **Sync:** Mirror the IDR task flow — completing the review completes the
   deal's HubSpot review task, and an existing HubSpot workflow flips
   `design_status`.
5. **Revisions:** NC revisions land in the **as-built track**, identical to
   escalation revisions, because NC projects are usually already permitted —
   any post-review change is an as-built revision.

## Verified HubSpot plumbing (no HubSpot changes required)

Verified live on 2026-07-08 against the production portal:

- **Review task:** NC deals get a task titled `"New Construction Design Review - ZRS"`
  (subject prefix varies only in the location suffix, same pattern as the IDR
  task "Complete Initial Design Review - ZRS/WMS/…"). Task creation is currently
  manual/upstream — the old "08c" creation workflow is disabled.
- **Completion workflow:** "08d. Design Flow - New Construction Design Complete"
  (flow 1674143797, **enabled**) enrolls when a task with subject
  `"New Construction Design Review - ZRS"` is COMPLETED while `design_status` is
  `"Initial Review"` or `"New Construction - Ready for Review"`. It sets
  `design_status = "Draft Complete"` and stamps
  `new_construction_design_completion_date`. NC reviews therefore rejoin the
  normal design flow at the same status IDR reviews do.
- **Revision workflow:** "IDR Revision Needed" (flow 1824183154, **enabled**)
  waits 3 minutes after `idr_revision_requested = true`, then branches on
  `idr_revision_type`: `"design"` → `design_status = "IDR Revision Needed"`;
  `"escalation"` → `design_status = "Revision Needed - Rejected"` (labeled
  "Revision Needed - As-Built"). NC items reuse the `"escalation"` branch as-is.

## Design

### 1. Data model

Add `NEW_CONSTRUCTION` to the `IdrItemType` Prisma enum:

```prisma
enum IdrItemType {
  IDR
  ESCALATION
  NEW_CONSTRUCTION
}
```

Additive migration only. NC items reuse every existing `IdrMeetingItem`
snapshot/review/adder field. Per project convention, the migration file is
written but `prisma migrate deploy` is run manually by Zach before the code
merges (additive-before-code ordering).

### 2. Review-type registry (`src/lib/idr-meeting.ts`)

A code-defined config object replaces scattered `type === "ESCALATION"`
conditionals for the knobs that vary per review type:

```ts
export const REVIEW_TYPES = {
  IDR: {
    badgeLabel: null,                       // default, no badge
    noteLabel: "IDR",
    statusValue: "Initial Review",
    taskSubject: "Complete Initial Design Review",
    revisionType: "design",                 // → design_status "IDR Revision Needed"
    revisionReasonProperty: "idr_revision_reason",
  },
  NEW_CONSTRUCTION: {
    badgeLabel: "New Construction",
    noteLabel: "New Construction Review",
    statusValue: "New Construction - Ready for Review",
    taskSubject: "New Construction Design Review",
    revisionType: "escalation",             // → design_status "Revision Needed - Rejected" (As-Built)
    revisionReasonProperty: "inspection_rejection_reason",
  },
} as const;
```

`ESCALATION` stays outside the registry: it is queue-driven (via
`IdrEscalationQueue`), not status-driven, and already routes revisions to the
as-built track. Where behavior is shared with NC (revision type + reason
property), the sync code resolves ESCALATION to the same values it uses today.

### 3. Session creation

`fetchInitialReviewDeals()` gains a third filter group:

```
{ pipeline = Project, dealstage NOT IN terminal, design_status = "New Construction - Ready for Review" }
```

The search `limit: 200` stays: as of 2026-07-08 zero deals sit in the NC
status, and typical Initial Review volume leaves ample headroom.

One HubSpot search returns all matches mixed together, so each deal's item
type is derived from its snapshot `design_status`: the value
`"New Construction - Ready for Review"` → `NEW_CONSTRUCTION`, any other value →
`IDR`. Status wins over filter-group membership: a deal that matched via the
re-review filter group but currently sits in the NC status derives to
`NEW_CONSTRUCTION`. The sessions route passes the derived type into
`IdrMeetingItem.create`.

The prep/preview endpoint (`/api/idr-meeting/preview`) calls the same
`fetchInitialReviewDeals()`, so NC deals intentionally appear on the prep page
too. The preview response includes the same derived type, and the prep page
shows the same "New Construction" badge as the session queue.

**BOM auto-extraction:** the sessions route currently auto-fires BOM extraction
for `type === "IDR"` items with a `designFolderUrl`. NC items get the same
treatment — auto-extract at session creation when `designFolderUrl` is present
(the filter becomes type `IDR` or `NEW_CONSTRUCTION`). Escalations stay
on-demand only, as today.

Manual add (AddProjectDialog → POST `/api/idr-meeting/items`) auto-detects the
type the same way from the freshly fetched deal's `design_status`, so users
never pick a type by hand. The explicit `type: "ESCALATION"` path is unchanged.

**Escalation precedence:** the sessions and preview routes upgrade an item to
`ESCALATION` when its deal is also in `IdrEscalationQueue`. That stays:
escalation wins over the status-derived type, including for NC-status deals.
Since escalations already route revisions to the as-built track, the HubSpot
outcome is the same; the deal simply carries the escalation badge and reason.

### 4. Queue UI

- `ProjectQueue.tsx`: NC items render inside the normal region grouping and
  sort order, with a "New Construction" badge (same pattern as the existing
  ESCALATION badge, distinct color).
- Detail panel (`ProjectDetail.tsx` and child forms): unchanged. All sections
  apply to NC items.
- Session summary / meeting notes: NC items are labeled "New Construction
  Review" wherever item types are surfaced. `buildHubSpotNoteBody` gains an
  item-type-aware header: NC items get "New Construction Review -- {date}";
  IDR **and ESCALATION** items keep today's "IDR Meeting -- {date}" header
  unchanged.

### 5. Sync (`syncItemToHubSpot`)

- **Task completion:** `completeInitialDesignReviewTask` is parameterized by
  subject prefix (from the registry) instead of the hardcoded
  "Complete Initial Design Review". Matching stays CONTAINS_TOKEN on open
  tasks associated with the deal. The subjects do not cross-match: the NC
  subject lacks the tokens "Complete"/"Initial", and the IDR subject lacks
  "Construction".
- **Happy path:** reviewed NC item → complete the NC task → workflow 08d flips
  `design_status` to "Draft Complete" (existing, enabled).
- **Revision path:** revision-flagged NC item → after task completion, push
  `idr_revision_requested = "true"`, `idr_revision_type = "escalation"`, and
  write the combined revision reason to `inspection_rejection_reason`
  (`buildHubSpotPropertyUpdates` resolves both from the registry).
- **Missing task:** the warning still surfaces ("No design review task found —
  design_status may need manual update"), and sync still pushes properties and
  notes. Note the combined revision *reason* already travels in the first,
  unconditional property push (`buildHubSpotPropertyUpdates`); only the
  `idr_revision_requested` + `idr_revision_type` pair is task-gated today.
  Because the 08c task-creation workflow is disabled, a missing task is an
  expected case for NC — so for `NEW_CONSTRUCTION` items that flag pair fires
  **even when the task is not found or task completion throws** (both the
  `!result.completed` and catch branches): the "IDR Revision Needed" workflow
  enrolls on the property, not the task, so the as-built routing still works;
  only the "Draft Complete" flip (which a revision would override anyway) is
  lost. IDR items keep today's behavior (flag pair only after task completion)
  — no behavior change for existing types.

### 6. Out of scope

- No new HubSpot workflows, properties, or status options.
- No changes to the escalation queue or the BOM extraction pipeline itself
  (only the session-creation filter for which items auto-extract widens).
- No admin-configurable review types (code-defined registry only; a future
  review type is one enum value + one registry row + its HubSpot task/workflow).

## Testing

- Registry: filter-group construction includes the NC status; type derivation
  from `design_status` (NC status → `NEW_CONSTRUCTION`, "Initial Review" and
  re-review matches → `IDR`).
- Items POST route: auto-detects NC type from fetched deal properties;
  explicit ESCALATION still honored.
- `buildHubSpotPropertyUpdates`: revision reason routes to
  `inspection_rejection_reason` for NC and ESCALATION, `idr_revision_reason`
  for IDR.
- Sync: task search uses the NC subject for NC items; revision push sends
  `idr_revision_type = "escalation"` for NC items; NC revision push fires even
  when no task is found, while IDR keeps task-gated behavior.
- Session creation: BOM auto-extract filter includes NC items with a
  `designFolderUrl`; escalations still excluded.
- Queue rendering: NC badge appears for `NEW_CONSTRUCTION` items.
- Note body: NC header is "New Construction Review"; IDR/ESCALATION headers
  unchanged.

## Rollout

1. Additive Prisma migration (enum value) — applied by Zach before merge.
2. Ship code. No feature flag: NC deals simply start appearing in newly
   created sessions. Existing sessions are unaffected (items are snapshots).
3. Verify on the next real session: NC deal appears badged, sync completes the
   NC task, 08d flips status to "Draft Complete".
