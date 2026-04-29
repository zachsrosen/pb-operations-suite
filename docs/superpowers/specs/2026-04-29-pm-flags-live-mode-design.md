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

```
PM opens /dashboards/pm-action-queue
  ↓
Server component: evaluateLiveFlags()
  ├─ runAllRules({dryRun:true}) — collect current matches
  ├─ Load existing OPEN+ACK+RESOLVED flags with source=ADMIN_WORKFLOW
  └─ Reconcile (per externalRef):
       ├─ match exists, no DB row → create (createFlag)
       ├─ match exists, DB row OPEN/ACK → no-op
       ├─ match exists, DB row RESOLVED → reopen (REOPENED event)
       └─ match absent, DB row OPEN/ACK → auto-resolve (RESOLVED, actorUserId=null)
  ↓
Page renders queue from reconciled DB state
```

`evaluateLiveFlags()` is the **only new function**. The rules themselves don't change. The page server component awaits it before reading flags.

## Data model changes

**None.** Existing schema supports everything:
- Recurrence tracked via `PmFlagEvent` rows (`REOPENED` already in the enum).
- Auto-resolve distinguishable via `resolvedByUserId IS NULL`.
- Reconciliation scope filterable via `source = ADMIN_WORKFLOW`.

Only behavioral change: drop `{isoWeek}` from rule `externalRef` strings. Pattern becomes `{ruleKind}:{dealId}` (one flag per rule per deal lifetime).

**Migration impact**: existing OPEN flags from yesterday's cron run have isoWeek-suffixed externalRefs. They won't collide with new live-mode externalRefs (different keys). On first page load post-deploy:
- The old isoWeek-suffixed flag sees no matching live-mode spec → auto-resolves silently with note "Auto-resolved during live-mode migration."
- The corresponding live-mode flag is created fresh (different externalRef) and assigned to the right PM.

This preserves audit history while transitioning cleanly.

## Reconciliation semantics

| Existing PmFlag (source=ADMIN_WORKFLOW) | Rule still matches? | Action | Event written |
|---|---|---|---|
| OPEN | yes | no-op | none |
| OPEN | no | auto-resolve | `RESOLVED` (actorUserId=null, notes="Auto-resolved: rule no longer matches") |
| ACKNOWLEDGED | yes | no-op | none |
| ACKNOWLEDGED | no | auto-resolve | `RESOLVED` (actorUserId=null, notes="Auto-resolved after acknowledgment") |
| RESOLVED | yes | re-open | `REOPENED` (actorUserId=null, notes="Condition recurred") |
| RESOLVED | no | no-op | none |
| CANCELLED | n/a | no-op | none — admin override sticky |

Manual + HUBSPOT_WORKFLOW source flags are NEVER touched by reconciliation, regardless of state.

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

Current `runAllRules({dryRun:true})` cost on real data: **~1.5s** (16 rules × ~22 active deals + per-deal stage-history queries).

Page-load impact:
- **Foreground await**: PM sees a 1.5s delay before queue renders. Acceptable for v1.
- **Streaming SSR**: page header renders immediately; the flag list streams via Suspense after eval completes. PM sees the page is alive even while eval runs.
- **Light caching**: `evaluateLiveFlags()` results cached for 15 seconds in module-level Map. Concurrent page loads within that window reuse the same result. Single-process per Vercel function, so cache is per-function-instance — fine for our scale.

Cache key: `"global-eval"` (single-tenant). On invalidation: cache cleared on every flag mutation in the API routes.

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

## Verification checklist (post-deploy)

- [ ] Visit `/dashboards/pm-action-queue` while logged in as a PM; queue renders within 3s.
- [ ] Existing flags from yesterday's cron run that no longer match are auto-resolved on first hit.
- [ ] New flags appear with correct PM assignment.
- [ ] `npx tsx scripts/check-pm-flags.ts` shows distribution.
- [ ] Manually trigger a condition change in HubSpot (e.g., set a `siteSurveyCompletionDate`); reload page; confirm corresponding `survey-outstanding` flag auto-resolves with `resolvedByUserId = null`.
- [ ] Confirm `PmFlagEvent` rows show `REOPENED` events when a previously-resolved condition recurs.
- [ ] No errors in Sentry.
