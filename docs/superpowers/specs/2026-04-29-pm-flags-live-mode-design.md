# PM Flags — Live Mode

**Status**: Draft
**Date**: 2026-04-29
**Owner**: Zach Rosen
**Predecessor specs**: [`2026-04-28-pm-flag-criteria-design.md`](./2026-04-28-pm-flag-criteria-design.md)

## Context

The PM Flag System ships flags via a daily cron (`/api/cron/pm-flag-rules`, fires 13:00 UTC). PMs see yesterday's state when they open the queue. Zach wants the queue to be **live** — reflect HubSpot reality at the moment a PM looks.

This spec replaces cron-driven evaluation with **page-load evaluation**. When a PM (or admin) opens `/dashboards/pm-action-queue`, the server runs all 16 rules against the current Deal mirror and reconciles existing flags against the result before rendering.

## Decisions captured during brainstorming

1. **Trigger**: page-load (option B). Not webhook-driven, not cron, not hybrid. Simplest model.
2. **Auto-resolve**: when a flag's underlying condition no longer matches, status flips to `RESOLVED` automatically. `resolvedByUserId = null` is the canonical signal that a flag was auto-resolved (vs PM-resolved, which sets the field). This drives the future PM resolution metrics.
3. **Reconciliation scope**: only `source = ADMIN_WORKFLOW` flags are touched. Manual flags (`source = MANUAL`) and external integration flags (`source = HUBSPOT_WORKFLOW`) are NEVER auto-resolved by the engine — they're driven by humans only.
4. **No more weekly re-fire**: drop `{isoWeek}` from externalRef patterns. Live mode means the flag exists *while the condition matches* — no need to recreate weekly. One flag per `(rule, deal)` at a time.
5. **Recurrence handling**: if a flag was previously RESOLVED (auto or manual) and the condition recurs, re-open the existing flag (status flips back to OPEN) with a `REOPENED` event.

## Architecture

Live evaluation runs in **two phases** because R16 (compound-risk) depends on the reconciled state of every other rule's flags.

```
PM opens /dashboards/pm-action-queue
  ↓
Server component: evaluateLiveFlags()
  │
  ├─ Phase 1 — Reconcile R1–R15
  │    ├─ Run R1–R15 (dry-run) → collect current matches (specs)
  │    ├─ Capture evalStartedAt = now()
  │    ├─ Load existing OPEN+ACK+RESOLVED flags WHERE
  │    │    source=ADMIN_WORKFLOW AND raisedAt < evalStartedAt
  │    │    (the `raisedAt` guard prevents reconciliation from clobbering
  │    │    flags raised by another writer mid-eval)
  │    └─ Reconcile (per externalRef):
  │         ├─ match exists, no DB row → create (createFlag)
  │         ├─ match exists, DB row OPEN/ACK → no-op
  │         ├─ match exists, DB row RESOLVED → reopen + refresh assignee
  │         └─ match absent, DB row OPEN/ACK → auto-resolve
  │
  ├─ Phase 2 — Run R16 against fresh state
  │    └─ ruleCompoundRisk reads PmFlag table NOW — it sees the reconciled
  │       Phase 1 results, not stale flags.
  │       Reconcile R16 same as Phase 1.
  │
  └─ Return reconciled list
  ↓
Page renders queue from DB state
```

`evaluateLiveFlags()` is the **only new function**. The rules themselves don't change. The page server component awaits it before reading flags.

**Why two phases:** R16's match function counts existing flags. If we run all rules together and reconcile after, R16 sees flags that are *about to be* auto-resolved, producing false-positive compound-risk flags. Running R16 against the post-reconcile DB state gives correct counts.

## Data model changes

**None.** Existing schema supports everything:
- Recurrence tracked via `PmFlagEvent` rows (`REOPENED` already in the enum).
- Auto-resolve distinguishable via `resolvedByUserId IS NULL`.
- Reconciliation scope filterable via `source = ADMIN_WORKFLOW`.

Only behavioral change: drop `{isoWeek}` from `externalRef` strings in 8 rules. Pattern becomes `{ruleKind}:{dealId}` (one flag per rule per deal lifetime).

### Per-rule externalRef change

| Rule | Previous externalRef | New externalRef |
|---|---|---|
| construction-stage-stuck (R1) | `stage-stuck:{dealId}:{stage}:{isoWeek}` | `stage-stuck:{dealId}` |
| pre-construction-stage-stuck (R2) | `stage-stuck-pc:{dealId}:{stage}:{isoWeek}` | `stage-stuck-pc:{dealId}` |
| permit-rejection (R3) | `permit-reject:{dealId}:{isoWeek}` | `permit-reject:{dealId}` |
| ic-rejection (R4) | `ic-reject:{dealId}:{isoWeek}` | `ic-reject:{dealId}` |
| design-revisions (R5) | `design-revisions:{dealId}` | unchanged |
| install-overdue (R6) | `install-overdue:{dealId}:{date}` | unchanged (per-event key) |
| missing-ahj (R8) | `missing-ahj:{dealId}` | unchanged |
| missing-utility (R9) | `missing-utility:{dealId}` | unchanged |
| survey-outstanding (R10) | `survey-overdue:{dealId}:{isoWeek}` | `survey-overdue:{dealId}` |
| da-send-outstanding (R11) | `da-send-overdue:{dealId}:{isoWeek}` | `da-send-overdue:{dealId}` |
| da-approval-outstanding (R12) | `da-approval-overdue:{dealId}:{isoWeek}` | `da-approval-overdue:{dealId}` |
| change-order-pending (R13) | `pending-sales-change:{dealId}:{isoWeek}` | `pending-sales-change:{dealId}` |
| inspection-outstanding (R14) | `inspection-overdue:{dealId}:{isoWeek}` | `inspection-overdue:{dealId}` |
| shit-show-flagged (R15) | `shit-show:{itemId}` | unchanged |
| compound-risk (R16) | `compound-risk:{dealId}:{isoWeek}` | `compound-risk:{dealId}` |

### Migration impact (per rule class)

- **Rules with NEW externalRef pattern (10 rules — R1–R4, R10–R14, R16)**: existing OPEN flags from yesterday's cron run have isoWeek-suffixed externalRefs. They won't collide with new live-mode externalRefs (different keys).
  - On first page load post-deploy: the old isoWeek-suffixed flag sees no matching live-mode spec → auto-resolves silently with note "Auto-resolved during live-mode migration."
  - The corresponding live-mode flag is created fresh and assigned to the right PM.
- **Rules with UNCHANGED externalRef (6 rules — R5, R6, R8, R9, R15)**: existing OPEN flags pass through cleanly. `createFlag` sees the existing externalRef, returns `alreadyExisted: true`, no churn. If the rule still matches → flag stays OPEN. If the rule no longer matches → reconciliation auto-resolves.

This preserves audit history across the transition.

## Reconciliation semantics

| Existing PmFlag (source=ADMIN_WORKFLOW, raisedAt < evalStartedAt) | Rule still matches? | Action | Event written |
|---|---|---|---|
| OPEN | yes | no-op | none |
| OPEN | no | auto-resolve | `RESOLVED` (actorUserId=null, notes="Auto-resolved: rule no longer matches") |
| ACKNOWLEDGED | yes | no-op | none |
| ACKNOWLEDGED | no | auto-resolve | `RESOLVED` (actorUserId=null, notes="Auto-resolved after acknowledgment") |
| RESOLVED | yes | re-open + refresh assignee (see below) | `REOPENED` (actorUserId=null, notes="Condition recurred") + `REASSIGNED` if assignee changed |
| RESOLVED | no | no-op | none |
| CANCELLED | n/a | no-op | none — admin override sticky |

**Re-open also refreshes the assignee.** When a flag flips RESOLVED → OPEN, we re-resolve `Deal.projectManager → User.id` because the deal's PM may have changed since the flag was last open. Atomic update sets `assignedToUserId` to the freshly resolved PM, clears `resolvedAt` / `resolvedByUserId` / `resolvedNotes`, and writes a `REASSIGNED` event if the assignee actually changed.

**`raisedAt < evalStartedAt` guard**: prevents the reconciler from auto-resolving flags raised by *another* writer mid-eval (e.g., a manual `RaiseFlagButton` POST that races with our reconciliation). Auto-resolve only touches flags that existed when this eval started.

**Manual + HUBSPOT_WORKFLOW source flags** are NEVER touched by reconciliation, regardless of state. They're driven by humans / external integrations and stay open until a human resolves them.

## Atomic update guards

Concurrent page loads can race. Each reconciliation operation must be atomic against status:

```ts
// auto-resolve — only if currently OPEN or ACKNOWLEDGED
prisma.pmFlag.updateMany({
  where: { id, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
  data: { status: "RESOLVED", resolvedAt: now, resolvedByUserId: null, resolvedNotes: "..." }
})
// returns { count: 0 } if another writer already resolved → idempotent
```

Same `updateMany` pattern for re-open. Create path uses existing `createFlag` which is already idempotent on `(source, externalRef)`.

## Performance

Local dry-run on real data: ~1.5s (16 rules × ~22 active deals). Production cost is higher because:
- `daysInCurrentStage` issues 2 queries per deal for R1+R2 (~88 sequential queries against ~44 deal-iterations).
- R3, R4, R10–R14 each do their own queries.
- Vercel cold-starts add 200–500ms; Neon round-trips add ~50ms each.

Realistic production estimate: **3–5s** on cold start, **1.5–2.5s** on warm. Re-measure with `scripts/dry-run-pm-flags.ts` against prod data before final ship.

Page-load impact:
- **Foreground await**: page server component awaits `evaluateLiveFlags()` with a 30s upper-bound timeout. On timeout, render queue from existing flags + log Sentry warning (graceful degradation).
- **Streaming SSR**: page header (title, counter row, tab bar) renders immediately. The flag list section is wrapped in `<Suspense>` so the eval cost doesn't delay first paint.

**No module-level cache.** Vercel autoscales horizontally — module-level state would be per-lambda and stale across instances after mutations in sibling lambdas. The right TTL/cache layer would be `unstable_cache` with tag-based revalidation, but at the current scale (1.5–5s eval, low concurrent PM count) the added complexity isn't worth it. Each page load runs eval. Revisit if the active book grows past ~200 deals.

## Cron disposition

- **Remove** the cron schedule from `vercel.json`. Daily cron stops firing.
- **Keep** the route handler at `/api/cron/pm-flag-rules` so manual `curl` triggers still work for debugging. The route returns `{status: "live mode active — eval runs on /dashboards/pm-action-queue page load"}` unless the legacy `PM_FLAG_RULES_ENABLED=true` env is still set, in which case it does a full eval as before (forensic fallback).
- The `PM_FLAG_RULES_ENABLED` and `PM_FLAG_RULES_DRY_RUN` env vars stay live in Vercel — useful as kill switches if live-mode page-load eval breaks.

## What changes in code

| File | Change |
|---|---|
| `src/lib/pm-flag-rules.ts` | Drop `{isoWeek}` from externalRef constructions in 8 rules. Add `evaluateLiveFlags()` that wraps `runAllRules({dryRun:true})` + reconciliation. |
| `src/lib/pm-flags.ts` | Add `reopenFlag(id, notes)` lib helper using `updateMany` for atomicity. |
| `src/app/dashboards/pm-action-queue/page.tsx` | Server component awaits `evaluateLiveFlags()` before fetching the queue. Wrap list in Suspense. |
| `src/app/dashboards/pm-action-queue/PmActionQueueClient.tsx` | No change (still fetches from `/api/pm-flags`). |
| `src/app/api/cron/pm-flag-rules/route.ts` | Default behavior changes to `{status: "live mode active"}`; fallback eval only if `PM_FLAG_RULES_ENABLED=true`. |
| `vercel.json` | Remove `pm-flag-rules` cron entry. |
| `scripts/dry-run-pm-flags.ts` | No change — local diagnostic still useful. |

Total LOC delta: ~150 add, ~50 remove. Tightly scoped.

## Failure modes

1. **DB unreachable during eval** — page server component throws → page returns 500 → PM sees error. Mitigation: wrap eval in try/catch, log Sentry, render queue from existing flags only (graceful degradation: stale data is better than no page).

2. **Eval slow (e.g., > 5s under heavy load)** — page hangs. Mitigation: 30s upper-bound timeout on eval; on timeout, render queue from existing flags + log Sentry warning.

3. **A rule throws** — already handled in `runAllRules` (per-rule try/catch, errors collected in summary). Other rules continue. The throwing rule's flags neither create nor auto-resolve that cycle.

4. **Schema drift on Deal mirror** — same as today; already covered by per-rule error isolation.

## Testing

- `scripts/dry-run-pm-flags.ts` — already exists, no change needed for the rules-eval part.
- New `scripts/dry-run-live-mode.ts` — runs `evaluateLiveFlags()` against current data and prints what *would* be created/resolved/reopened. Doesn't write.
- Manual: open `/dashboards/pm-action-queue` and confirm flag list reflects current data; resolve a flag in HubSpot manually (e.g., set siteSurveyCompletionDate), reload, confirm flag auto-resolves.
- Existing unit-style tests around `pm-flag-rules.ts` keep working — the rule functions don't change.

## Future extensions (out of scope)

- **Real-time UI updates** via SSE/WebSocket. Today PMs reload to see updates. Live UI push is a separate spec.
- **Webhook-driven incremental eval** — if page-load latency becomes a problem at scale, evaluate only the deal that changed via the deal-sync webhook.
- **PM resolution metrics page** — dedicated `/dashboards/pm-metrics` view. The data is now structured to support it (manual vs auto split via `resolvedByUserId IS NULL`).
- **Customer-reach-out signal** — still deferred until the data source is identified.
- **Per-deal eval** — for now, every page load evals all deals. As the active book grows, optimize.

## Concurrency notes

- **`/api/pm-flags` GET races with reconciliation**: a PM hitting the page and a refetch from React Query might briefly see a flag in OPEN status that's about to flip to RESOLVED in the same eval cycle. This is acceptable — UI will reconcile on next refetch. No flicker is permanent. Spec calls this out explicitly so reviewers don't chase phantom bugs.
- **Manual flag POST mid-eval**: handled by the `raisedAt < evalStartedAt` guard on the reconciler.
- **Concurrent page loads**: each runs a full eval. `createFlag` idempotent on `(source, externalRef)` — second writer's create no-ops via `alreadyExisted: true`. Auto-resolve uses `updateMany WHERE status IN (OPEN, ACKNOWLEDGED)` — second writer affects 0 rows, also idempotent.

## Verification checklist (post-deploy)

- [ ] Visit `/dashboards/pm-action-queue` while logged in as a PM; queue renders within 5s.
- [ ] Existing flags from yesterday's cron run that no longer match are auto-resolved on first hit.
- [ ] New flags appear with correct PM assignment.
- [ ] `npx tsx scripts/check-pm-flags.ts` shows distribution.
- [ ] Manually trigger a condition change (e.g., set `siteSurveyCompletionDate` on a deal); reload page; confirm corresponding `survey-outstanding` flag auto-resolves with `resolvedByUserId = null`.
- [ ] Confirm `PmFlagEvent` rows show `REOPENED` events when a previously-resolved condition recurs.
- [ ] **R16 compound-risk does NOT fire spuriously on first post-deploy reload.** Specifically: confirm a deal that had ≥3 OPEN flags yesterday but had several auto-resolved during today's reconciliation does not get a fresh compound-risk flag created in the same eval. (Phase 2 of `evaluateLiveFlags` should see the reconciled state.)
- [ ] **Cancelled flags stay cancelled** even when the rule still matches — confirm by manually cancelling a flag, hitting page reload, verifying status remains `CANCELLED`.
- [ ] **PM reassignment on reopen** — confirm by: resolve a flag manually, change `Deal.projectManager` in HubSpot, reload page so condition recurs, verify the reopened flag is now assigned to the new PM with a `REASSIGNED` event.
- [ ] No errors in Sentry.
