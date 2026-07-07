# PE HubSpot Task Auto-Completion - Design

Date: 2026-07-06
Status: Draft, pending Zach's sign-off before implementation
Author: Claude (with Zach)

## 1. Summary

Two classes of PE (Participate Energy) HubSpot tasks stay open after the work
they track is actually done, so they clutter owners' task lists and misrepresent
state:

- **Goal 1 (submission):** `Submit M1/M2 To Participate Energy` stays open after
  the milestone is submitted to PE.
- **Goal 2 (resubmission):** after PE rejects docs, the per-team rejection tasks
  and the milestone `Ready to Resubmit` task stay open after the rejected docs
  are actually resubmitted.

HubSpot workflows cannot natively complete a task. This design closes these tasks
from our own PE code as a **convergent reconciliation pass**, folded into the
existing `pe-rejection-advance` cron. It reuses the task-classification, ledger,
and dry-run patterns already proven by `pe-rejection-advance`, and the
resubmission-detection primitives merged in PR #1312. The HubSpot workflows remain
Zach's and are unchanged; this feature only reacts to the state they produce.

The reconciler is **task-first**: it searches open PE tasks directly by subject
token, classifies each, and completes only those whose completion condition
strictly holds. It never scans the full deal population and never reopens a task.

## 2. Goals and non-goals

**Goals**

- Auto-complete `Submit M{n} To Participate Energy` once milestone `n` is
  submitted to PE.
- Auto-complete a team's PE rejection task once that team's rejected docs are
  resubmitted; auto-complete the generic milestone rejection task and the
  `Ready to Resubmit` task once the whole milestone is resubmitted.
- Auto-complete onboarding rejection/resubmit tasks on the analogous PE signal.
- Internal-QC tasks are recognized by the classifier but **not completed in v1**
  (deferred to phase 2 - Section 6.3); they surface in the dry-run report only.
- Be idempotent, self-healing, fully observable, and reversible by a flag.

**Non-goals**

- No changes to any HubSpot workflow (task creation stays workflow-driven).
- No new task creation. This feature only completes existing tasks.
- No change to the PE doc/version/action-item sync itself.
- No reopening, reassigning, or editing of tasks. Only `open -> COMPLETED`.

## 3. Background: the systems this plugs into

### 3.1 Existing task infrastructure (reused as-is)

`src/lib/hubspot-tasks.ts` provides what we need:

- `markTaskComplete(taskId)` sets `hs_task_status = "COMPLETED"` (idempotent: a
  no-op on an already-completed task).
- Rate-limited access via `withHubSpotRetry`.
- The open-status set `["NOT_STARTED", "IN_PROGRESS", "WAITING"]` and the task
  property list including `hs_task_subject`, `hs_task_status`, `hs_createdate`.

The needed HubSpot call patterns already exist on `main`: `src/lib/idr-meeting.ts`
searches open tasks by `hs_task_subject CONTAINS_TOKEN`, and
`src/lib/pe-rejection-advance.ts` resolves task<->deal via `associations.v4` +
`tasks.batchApi.read`. The reconciler reuses both.

### 3.2 The adjacent poller we extend: `pe-rejection-advance`

`src/lib/pe-rejection-advance.ts` runs hourly (`/api/cron/pe-rejection-advance`)
and flips a milestone's status once its rejection tasks are all completed:

- `Rejected -> Ready to Resubmit` (PE flavor)
- `Onboarding Rejected -> Onboarding Ready to Resubmit`
- `Internally Rejected -> Ready to Submit`

Reusable pieces:

- `classifyRejectionTask(subject)` returns `{ milestone: "m1" | "m2", flavor:
  "pe" | "onboarding" | "internal" }` or `null`, matching on loose signal words
  (a `reject*` word plus a milestone / `onboarding` / `internal` token) so
  subjects stay freely renameable.
- Ledger pattern: `mergeAdvanceLedger` (pure) + `recordAdvanceLedger` persist a
  running tally to `SystemConfig` key `pe_rejection_advance_ledger`
  (`ADVANCE_LEDGER_KEY`).
- `advancePeRejections({ dryRun })` previews without writing.

This feature adds a completion pass that runs **before** the advance step in the
same cron invocation (Section 10).

### 3.3 Resubmission-detection primitives (PR #1312, merged 2026-07-07)

PR #1312 (commit `367bbb3c` on `main`) added, in `pe-api-sync.ts`:

- `latestVersionUploadByDoc(versions)` -> `Map<"${dealId}::${docName}", Date>`.
- `selectSupersededItemIds(openItems, latestUploadByDoc)`: resolves action items
  predating a resubmission once a current-cycle item exists.

Each `pe-api-sync` run now auto-resolves (sets `resolvedAt`) an action item when
its doc is approved, leaves `ACTION_REQUIRED`, or is superseded by a
resubmission. So "a doc's team has no unresolved action items" is a reliable
"that team's rejection is handled" signal. `currentCycleActionItems` and
`PE_DOC_TO_TEAM_FIELD` (below) were already on `main` before #1312, so the only
#1312-specific dependency is `latestVersionUploadByDoc` (used in Section 7).

### 3.4 Canonical doc, team, and milestone maps

- **Docs:** `PE_DOC_HUBSPOT_MAP` in `src/lib/pe-hubspot-sync.ts` (currently
  includes `Bill of Materials`). This is the source of truth for canonical doc
  names, status props, and notes props. Note the exact canonical label
  `"Conditional Waiver — Final Payment"` uses an em dash.
- **Action-item label join:** `PeActionItem.docLabel` can arrive as
  `"Conditional Waiver/Release on Final Payment"`; normalize with
  `normalizeActionItemDocName` (`ACTION_ITEM_DOCLABEL_ALIASES`) in
  `pe-hubspot-sync.ts` before joining to canonical doc names.
- **Doc -> team field:** `PE_DOC_TO_TEAM_FIELD` in `pe-rejection-notes.ts` (teams:
  design, sales, ops, permitting, compliance, accounting, interconnection). PE's
  field is misspelled `pe_rejection_notes_for_intercocnnection`. This feature does
  not read the PE team-notes fields, so the typo matters only for the team
  canonicalization table (Section 5.1).
- **Doc -> milestone:** reuse `PE_M1_DOC_NAMES`, the canonical M1 doc list
  (including `Bill of Materials`) already exported from `src/lib/pe-analytics.ts`
  and used by several call sites. `PE_DOC_TO_MILESTONE` is *derived*, not
  hand-copied: any `PE_DOC_HUBSPOT_MAP` doc present in `PE_M1_DOC_NAMES` is M1;
  all others (Signed Interconnection Agreement, `Conditional Waiver — Final
  Payment`, Permission to Operate (PTO)) are M2. Deriving it avoids adding a
  fourth parallel copy of this list, which already drifted once when BOM was
  split out.
- **Internal-QC registry:** `INTERNAL_REJECTION_DOCS` in
  `src/lib/internal-rejection-notes.ts` gives, per doc, `{ checkbox, reasonField,
  teamField, milestone }`. Teams here are correctly spelled
  (`internal_rejection_notes_for_interconnection`). Helpers reused:
  `INTERNAL_REJECTION_DOCS`, `INTERNAL_REASON_FIELDS`, and the milestone field on
  each entry.

### 3.5 Evidence: real open PE task subjects (live HubSpot, task-first, 2026-07-06)

Searching open tasks by `hs_task_subject CONTAINS_TOKEN` for the three tokens the
reconciler uses confirmed the workflow-created subjects (all suffixed ` - ZRS`;
`#N` is a re-trigger counter):

Token `Participate`:

| Subject | Classify as |
| --- | --- |
| `Submit M1 To Participate Energy`, `Submit M2 To Participate Energy` | submit |
| `M1 Rejected by Participate Energy #N` | rejection, pe, generic |
| `Onboarding Rejected by Participate Energy` | rejection, onboarding |
| `Onboard Project To Participate Energy` (71 open) | null (no submit/reject/resubmit + milestone) |
| `Send Notice of Cancellation for Participate`, `Please Complete Participate Energy Contract & Notify PM`, `Share Monitoring with Participate` | null |
| `Participate Energy Rejected` (1) | null (reject word but no milestone token) - intentionally unmatched |

Token `Resubmit`:

| Subject | Classify as |
| --- | --- |
| `M1 Ready to Resubmit #N` | resubmit, pe |
| `Onboarding Ready to Resubmit` | resubmit, onboarding |
| `PTO Ready to Resubmit`, `Xcel PTO Photos Ready to Resubmit #N`, `Jeff Hirsch - Resubmit IA ...`, `Resubmit to AHJ if needed ...` | null (no milestone token; PTO/Xcel/AHJ are utility, not PE) - intentionally unmatched |

Token `Rejection`:

| Subject | Classify as |
| --- | --- |
| `M1 Sales Rejection`, `M1 Operations Rejection`, `M1 Design Rejection` | rejection, pe, team |
| `M1 Ops Internal Rejection`, `M1 Sales Internal Rejection` | rejection, internal, team |

Confirmed problem: `Submit M1` tasks remain open on deals already at
`pe_m2_status = Submitted`. Confirmed safety: high-volume near-miss subjects
(`Onboard Project To Participate Energy`, `PTO Ready to Resubmit`) must and do
classify to `null`.

**Coverage caveat:** all observed per-team rejection and resubmit subjects are
currently M1 (M2 rejections are rarer and none were open at sample time). The M2
forms (`M2 <Team> Rejection`, `M2 Ready to Resubmit`) are assumed by pattern and
the go-live dry-run (Section 13) must confirm them before enabling.

## 4. The design fork and decision

HubSpot workflows cannot complete a task, so the completion call comes from one of:

- **(a) Custom-code action inside Zach's workflow.** HubSpot sandbox: no Sentry,
  no queryable logs, no DB for idempotency, hard to unit-test, adds to the
  workflow-build plate. Worst observability.
- **(b) A webhook endpoint the workflow calls.** Better logs, but event-driven
  (a missed or duplicated fire yields wrong state), a new public endpoint with
  the `?token` auth and multi-hour retry-storm footguns already hit on
  `/pe-rejection`.
- **(c) Complete from our PE code as a convergent reconciler.** One module, one
  place to read logs, DB-backed idempotency, a `dryRun` preview, and an audit
  ledger. A missed or double run re-computes and self-heals.

**Decision: option (c), a task-first reconciliation pass.** Safest and most
observable, and the option Zach asked for. Goal 1's trigger is still the status
your "docs submitted" workflow sets (`pe_m{n}_status`), so the feature is tied
into that workflow through its output without living inside it.

## 5. Task taxonomy and classifier

`classifyPeTask(subject)` returns one of:

```
{ kind: "submit",    milestone }
{ kind: "rejection", milestone, flavor: "pe"|"onboarding"|"internal", team? }
{ kind: "resubmit",  milestone, flavor: "pe"|"onboarding" }
null   // not a PE lifecycle task -> never touched
```

Rules (case-insensitive; milestone token is `\bM1\b` or `\bM2\b`):

- **submit:** contains `submit`, contains `participate`, has a milestone token,
  no `reject*`, no `resubmit`. Excludes `Onboard Project To Participate Energy`
  (no `submit`, no milestone), `Submit As-Built Revision ...` (no `participate`).
- **resubmit:** contains `resubmit` and (a milestone token or `onboarding`); no
  `reject*`. Onboarding maps to M1. Excludes `PTO Ready to Resubmit`,
  `Xcel PTO Photos Ready to Resubmit`, `Jeff Hirsch - Resubmit IA ...` (no
  milestone token).
- **rejection:** delegates to the existing `classifyRejectionTask`, then extracts
  an optional team (Section 5.1). `Participate Energy Rejected` (no milestone) is
  intentionally unmatched.

`classifyRejectionTask` is unchanged (additive reuse); the new `submit` and
`resubmit` recognizers and team extraction live in the new module.

### 5.1 Team extraction and canonicalization

Canonical team enum: `design | sales | ops | permitting | compliance |
accounting | interconnection`.

- **From a task subject:** parse `M{n} <Team> Rejection` (and the internal
  variant `M{n} <Team> Internal Rejection`); map the word via
  `{ sales, operations|ops -> ops, design, permitting, compliance, accounting,
  interconnection }`. A generic `M{n} Rejected by Participate Energy` yields no
  team (milestone-wide). Fall back to the task body's `rejected the <team>
  documents` phrase if the subject has no team word.
- **From a doc:** PE flavor via `PE_DOC_TO_TEAM_FIELD` (strip the
  `pe_rejection_notes_for_` prefix; normalize PE's `intercocnnection` typo to
  `interconnection`), plus one explicit override: `Bill of Materials -> ops`
  (BOM is absent from `PE_DOC_TO_TEAM_FIELD`; Zach routed it to Ops). Both
  adapters are pure and unit-tested.

## 6. Signal -> completion rules

All rules are convergent and complete-only. A task completes only when (1) it
classifies to a known kind and (2) its condition strictly holds against current
state. `hs_createdate` (call it C) is the task's creation time and is used as a
guard so a resubmission signal must post-date the specific task being closed
(Section 6.1). Statuses are `pe_m{n}_status`; doc state is from `PeActionItem`
(`resolvedAt`) and `PeDocVersion` (`uploadedAt`), both refreshed by `pe-api-sync`.

| Task kind | Completion condition |
| --- | --- |
| `submit` (M`n`) | `pe_m{n}_submission_date` is set (non-empty). (See 6.2.) |
| `rejection` flavor `pe`, team T | Team T has zero unresolved `PeActionItem` rows on milestone-`n` docs, AND at least one of T's milestone-`n` docs has a `PeDocVersion.uploadedAt > C` (proof of a resubmission after this task was created). |
| `rejection` flavor `pe`, generic | Zero unresolved `PeActionItem` rows on any milestone-`n` doc, AND some milestone-`n` doc has `uploadedAt > C`. |
| `resubmit` flavor `pe` (M`n`) | `pe_m{n}_status` is not `"Ready to Resubmit"` (the milestone moved on after resubmission). |
| `rejection`/`resubmit` flavor `onboarding` | As PE flavor, scoped to the four onboarding docs; resubmit completes when `pe_m1_status` is not `"Onboarding Ready to Resubmit"`. |
| `rejection` flavor `internal` | **Deferred to phase 2.** Classified (so it appears in the dry-run) but never completed in v1 (Section 6.3). |

### 6.1 The signal-after-creation guard (handles `#N`, races, re-rejection)

For `rejection` (PE/onboarding) tasks, completion requires a resubmission whose
`PeDocVersion.uploadedAt` is later than the task's `hs_createdate`. This resolves
three otherwise-hard cases at once:

- **`#N` duplicates** (retry-storm copies of one cycle): all share roughly the
  same creation time, all before the resubmission, so all complete together.
- **A new rejection cycle** creates a new task with a later `hs_createdate`; the
  prior cycle's resubmission predates it, so the new task stays open until the
  doc is resubmitted again.
- **Stale-read race** with `pe-api-sync`: a version row written but its action
  item not yet resolved simply fails clause 1 this run and converges next run.

`resubmit` tasks use status (not a version timestamp): a re-rejection returns the
milestone to `Rejected` (still "moved on from Ready to Resubmit", so the old
resubmit task correctly closes), while a fresh `Ready to Resubmit` only arises
after the new cycle's advance, at which point the new resubmit task's condition
is false. `submit` tasks use the submission-date signal (6.2).

### 6.2 Why the submission-date signal

The submit task completes when `pe_m{n}_submission_date` is set (non-empty). This
date is stamped by Zach's "docs submitted" workflow at the moment the milestone is
submitted to PE, so its presence is the most direct "this milestone was submitted"
signal - the feature keys off exactly the event the workflow already marks, rather
than inferring it from status. Chosen over a `pe_m{n}_status` allowlist (Zach,
2026-07-07): the status can sit at intermediate values (e.g. `Waiting on
Information`, `Onboarding *`) where "submitted or not" is ambiguous, whereas the
date is unambiguous and per-milestone.

Because a stamped date persists (dates are not un-stamped in normal operation), the
submit task stays closed through later rework cycles, satisfying the
close-and-stays-closed decision (Section 14 Q1). Caveat (from
`reference_pe_submission_date_workflow`): the forward stamp can fire slightly early
(at core-completion, ahead of the last gating doc), and a historical bug had M2
submission stamping clobber M1. Neither affects correctness here - both concern the
date's exact *value*, not its *presence*, and the task should close as soon as a
submission is recorded. The reconciler treats any non-empty value as "submitted".

### 6.3 Internal-QC completion (DEFERRED to phase 2)

Zach deferred internal-QC auto-completion out of v1 because its signal is the
weakest. The classifier still recognizes internal tasks (`flavor: "internal"`) so
they appear in the dry-run report, but `decideCompletion` returns "do not
complete" for them in v1. The analysis below is retained for the phase-2 design.

Internal QC happens before PE submission, so there is no PE version upload to key
on. The `internal-rejection-notes.ts` webhook overwrites the team notes fields on
each fire, but those fields are per-team spanning both milestones (accounting owns
an M1 and an M2 doc), so they cannot scope by milestone. Therefore the internal
signal keys on the per-doc `internal_reason_*` fields, which are milestone-scoped
via `INTERNAL_REJECTION_DOCS[].milestone`: complete team T's internal rejection
task on milestone `n` when every `reasonField` for `{ team T, milestone n }` docs
is empty. This has no post-C timestamp guard (a field-clear is not timestamped).
Critically, **nothing in the codebase clears these fields** - the
internal-rejection webhook only reads `internal_reason_*`; the emptiness signal
depends entirely on a human blanking the field after re-QC. So this is a *manual*
signal with no system enforcement or timestamp, relying on emptiness plus
self-protection (a re-rejection refills the field, making the condition false).
This is the softest signal and the most in need of Zach's confirmation and test
coverage. Fallback if unreliable: drop only the internal flavor from v1, leaving
PE-facing behavior intact (Section 14 Q2).

## 7. Resubmission detection detail (Goal 2, PE flavor)

Per milestone `n` and team T:

1. Determine T's milestone-`n` docs: canonical docs where
   `PE_DOC_TO_TEAM_FIELD` -> T and `PE_DOC_TO_MILESTONE` -> `n`.
2. Unresolved action items: `PeActionItem` rows with `dealId = deal`,
   `resolvedAt = null`, and `normalizeActionItemDocName(docLabel)` in T's
   milestone-`n` doc set. Clause 1 of the rule requires this set to be empty.
3. Resubmission proof: the latest `PeDocVersion.uploadedAt` for any of T's
   milestone-`n` docs (via `latestVersionUploadByDoc`) is later than the task's
   `hs_createdate`.

`pe-api-sync` is what sets `resolvedAt` (on approve, on leaving `ACTION_REQUIRED`,
or via #1312 supersession) and inserts version rows, so this reads a state that
sync maintains. The generic (teamless) rule is the same with T's doc set widened
to all milestone-`n` docs.

**Bill of Materials:** BOM is in `PE_DOC_HUBSPOT_MAP` and `PE_DOC_TO_MILESTONE`
(M1) but absent from `PE_DOC_TO_TEAM_FIELD`. Per Zach's decision, the doc->team
adapter overrides `Bill of Materials -> ops` (Section 5.1), so a BOM rejection
counts toward the `M1 Operations Rejection` task as well as the generic milestone
task.

## 8. Architecture and files

- **New:** `src/lib/pe-task-autocomplete.ts`
  - `classifyPeTask(subject)`, `PE_DOC_TO_MILESTONE`, and the team adapters
    (pure, exported for tests).
  - `decideCompletion(task, dealState)` (pure): given a classified task (with
    `hs_createdate`) and the deal's status + doc/action-item/version state, return
    whether to complete and a reason string. Internal-flavor tasks always return
    "skip" in v1 (Section 6.3).
  - `autocompletePeTasks({ dryRun })`:
    1. Search open tasks for tokens `Participate`, `Resubmit`, `Rejection`
       (`hs_task_subject CONTAINS_TOKEN`, `hs_task_status IN` open set); dedupe by
       task id; keep those `classifyPeTask` accepts.
    2. Resolve task -> deal (`associations.v4`), batch-read deal properties
       (`pe_m1_status`, `pe_m2_status`, `pe_m1_submission_date`,
       `pe_m2_submission_date`), and load `PeActionItem` (unresolved) +
       `PeDocVersion` (latest per doc) for those deals from the DB. (Internal
       `internal_reason_*` fields are only needed when the phase-2 internal flavor
       is enabled.)
    3. `decideCompletion` per task; `markTaskComplete` the winners (skip on
       `dryRun`); append each to the ledger.
  - Ledger helpers mirroring `mergeAdvanceLedger` / `recordAdvanceLedger` with
    key `pe_task_autocomplete_ledger`.
- **Changed:** `src/app/api/cron/pe-rejection-advance/route.ts` calls
  `autocompletePeTasks()` before `advancePeRejections()`, returning both summaries.
- **Reused unchanged:** `hubspot-tasks.ts` (`markTaskComplete`),
  `pe-rejection-advance.ts` (`classifyRejectionTask`), `pe-rejection-notes.ts`
  (`PE_DOC_TO_TEAM_FIELD`), `pe-api-sync.ts` (`latestVersionUploadByDoc`),
  `pe-hubspot-sync.ts` (`normalizeActionItemDocName`, `PE_DOC_HUBSPOT_MAP`),
  `internal-rejection-notes.ts` (`INTERNAL_REJECTION_DOCS`).

No Prisma schema changes. The only persisted state is the `SystemConfig` ledger
row (same table `pe-rejection-advance` already uses).

## 9. Idempotency and safety guarantees

- **Complete-only.** Only `markTaskComplete` is called; a no-op on an already
  completed task. No reopen, reassign, or body edit.
- **Strict multi-signal classifiers.** Every kind requires two or more signal
  words including a milestone (or `onboarding`) token; `null` is skipped. The
  high-volume near-misses in Section 3.5 are structurally excluded.
- **Condition-gated + creation-guarded.** A task completes only when its Section 6
  condition holds; rejection tasks additionally require a resubmission dated after
  the task's own `hs_createdate` (6.1).
- **Convergent.** Completion is derived from current state, so a missed run is
  caught next hour and a duplicate run is a no-op.
- **Ledger + dedupe.** Each completion appends to `pe_task_autocomplete_ledger`
  (task id, deal id, kind, milestone, team, reason, timestamp); keyed by task id.
- **Flagged.** `PE_TASK_AUTOCOMPLETE_ENABLED` kill-switch; off = pass skipped.
- **Bounded work.** Task-first scanning touches only the ~350 open tasks matching
  the three tokens and their deals, not the full PE deal population. All HubSpot
  calls go through `withHubSpotRetry` and batch reads.

## 10. Interaction with `pe-rejection-advance` and ordering

Within the cron invocation the order is **autocomplete -> advance**, in one
process with sequential awaits, so completions are visible to the advance step in
the same run: auto-closing rejection tasks (Goal 2) lets advance flip
`Rejected -> Ready to Resubmit` immediately. Intended synergy: status now advances
on actual resubmission rather than on a human remembering to close the task.

The reconciler reads `PeActionItem` / `PeDocVersion` state that the separate
`pe-api-sync` cron maintains; the two crons are not ordered relative to each
other, so a run may read a slightly stale doc state. This is acceptable because
the pass is convergent (next run heals) and the creation-guard (6.1) prevents a
stale read from closing a new cycle's task. No feedback loop exists: autocomplete
only completes tasks, advance only changes status, neither writes the fields that
trigger task creation.

## 11. Dependencies and sequencing

- PR #1312 is merged to `main` (commit `367bbb3c`), so `latestVersionUploadByDoc`
  is available. `PE_DOC_TO_TEAM_FIELD` and `currentCycleActionItems` were already
  on `main`. No further sequencing constraint.
- Branch this work off `origin/main`.

## 12. Observability and rollout

1. **Dry-run backlog.** Ship behind `PE_TASK_AUTOCOMPLETE_ENABLED=false`. Run
   `autocompletePeTasks({ dryRun: true })` and review, with Zach, every task that
   would complete and why. The report enumerates counts by kind (submit /
   rejection-pe / rejection-onboarding / rejection-internal / resubmit) so a zero
   `submit` count is caught as a scan-coverage bug rather than mistaken for
   "nothing to do", and so the assumed M2 subject forms (Section 3.5 caveat) are
   confirmed against live data.
2. **Enable.** Flip the flag; the hourly cron completes tasks and appends to the
   ledger. Per-run `console.warn` summaries; the ledger row holds the full tally.
3. **Watch.** For the first days, spot-check the ledger against a few deals and
   confirm no unrelated task was completed and none was completed prematurely.

## 13. Testing plan

Pure functions carry the correctness load and are unit-tested:

- `classifyPeTask`: every real subject in Section 3.5 (positive) and every
  near-miss (`Onboard Project To Participate Energy`, `PTO Ready to Resubmit`,
  `Xcel PTO Photos Ready to Resubmit`, `Participate Energy Rejected`,
  `Send Notice of Cancellation for Participate`, `Submit As-Built Revision ...`,
  `Jeff Hirsch - Resubmit IA ...`) returning `null`.
- team adapters: doc -> team over every canonical doc (PE typo ->
  `interconnection`; the `Bill of Materials -> ops` override); subject-word ->
  team over observed team words.
- `PE_DOC_TO_MILESTONE` (derived from `PE_M1_DOC_NAMES`): every canonical doc
  mapped; accounting M1 vs M2
  (`Conditional Progress Lien Waiver` = M1, `Conditional Waiver — Final Payment`
  = M2) resolve to different milestones.
- `decideCompletion`: submit closes when `pe_m{n}_submission_date` is set and not
  while it is empty (per milestone, independently);
  per-team rejection closes only when that team's unresolved items are gone and a
  post-`C` resubmission exists, and an accounting/sales cross-milestone
  resubmission never closes the other milestone's task; generic waits for all;
  resubmit closes on leaving `Ready to Resubmit`; internal tasks classify but are
  never completed in v1; a `Bill of Materials` rejection counts toward the Ops
  team task; the `#N`/new-cycle creation-guard cases in 6.1.
- version <-> action-item join uses `normalizeActionItemDocName` (the
  `Conditional Waiver/Release on Final Payment` alias resolves).

Integration: the non-destructive prod dry-run (Section 12.1) is the acceptance
gate rather than a live E2E write, consistent with recent PE launches.

## 14. Resolved decisions (Zach, 2026-07-06, updated 2026-07-07)

1. **Submit-task close signal — submission-date-based (updated 2026-07-07).** The
   submit task closes when `pe_m{n}_submission_date` is set (non-empty), the date
   the docs-submitted workflow stamps at submission. This supersedes the earlier
   status-allowlist approach. It stays closed through later rework because the date
   persists (Section 6.2).
2. **Internal-QC — deferred to phase 2.** v1 recognizes internal tasks but never
   completes them. Reason: the "reason field empty" signal is a manual human
   action with no system enforcement (Section 6.3). Revisit once a firmer signal
   is defined.
3. **Bill of Materials — routed to Ops.** The doc->team adapter overrides
   `Bill of Materials -> ops` (Sections 5.1, 7).
4. **Non-standard subjects — left unmatched.** A milestone token is required to
   act; rare oddly-named tasks (`Participate Energy Rejected`, `PTO Ready to
   Resubmit`) stay open for a human, rather than risk mis-closing.

## 15. Out of scope

- Creating, renaming, reassigning, or reprioritizing tasks.
- Any HubSpot workflow edits.
- Changing PE sync, status stamping, or the rejection-notes webhooks.
- Non-PE tasks of any kind.
