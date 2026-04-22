# Inngest spike — BOM design-complete pipeline

**Status:** Dormant. Code is merged but feature flag is off by default.
**Date:** 2026-04-22
**Scope:** Prove Inngest as a workflow engine on ONE pipeline. No other flows touched.

## What this replaces (when flag is on)

Today the `design-complete` webhook runs the BOM pipeline via `waitUntil(runDesignCompletePipeline(...))`. That works but has three pain points that will multiply as we add more pipelines:

1. **300s hard ceiling** — one slow Claude extraction truncates the run.
2. **Hand-rolled concurrency** — partial unique index on `BomPipelineRun(dealId) WHERE status='RUNNING'` plus stale-lock recovery. Every new pipeline will reinvent it.
3. **No run graph** — observability lives in `BomPipelineRun` rows and Vercel logs.

Inngest addresses 2 and 3 today; 1 requires a phase 2 rewrite (splitting internal stages into separate `step.run()` calls).

## What's in this spike

| File | Purpose |
| --- | --- |
| `src/lib/inngest-client.ts` | Inngest client + `isInngestBomEnabled()` flag helper. Typed event schema. |
| `src/inngest/functions/bom-design-complete.ts` | Single function wrapping `runDesignCompletePipeline()` in one `step.run()` with `concurrency.key = event.data.dealId`, `retries: 2`. |
| `src/app/api/inngest/route.ts` | Inngest serve handler (GET/POST/PUT). Listed in `PUBLIC_API_ROUTES`. |
| `src/app/api/webhooks/hubspot/design-complete/route.ts` | Forks on `INNGEST_BOM_ENABLED`: flag on → `inngest.send()`, flag off → existing `waitUntil()` path. Inngest-send failures fall back to `waitUntil`. |
| `src/middleware.ts` | `/api/inngest` added to `PUBLIC_API_ROUTES`. |

Nothing else changes. `BomPipelineRun`, `acquirePipelineLock`, `withRetry`, Claude escalation, PO creation, notifications — all untouched.

## Turning it on

### 1. Create the Inngest app
- Sign up at https://inngest.com, create an app named `pb-tech-ops` (matches the client `id`).
- Grab the **Event Key** and **Signing Key** from the app settings.

### 2. Set env vars in Vercel (production)
```
INNGEST_EVENT_KEY=...       # from Inngest dashboard
INNGEST_SIGNING_KEY=...     # from Inngest dashboard
INNGEST_BOM_ENABLED=true    # the kill switch
```
Per memory note `feedback_vercel_env_sync.md`, verify with `vercel env ls production` before flipping.

### 3. Sync the app
- Inngest dashboard → Apps → Sync → point at `https://www.pbtechops.com/api/inngest`.
- Confirm `bom-design-complete-pipeline` shows up in the Functions list.

### 4. Test on a preview deploy first
- Merge this branch; Vercel builds a preview.
- Set `INNGEST_BOM_ENABLED=true` only on the preview environment.
- Trigger a test deal (existing BOM pipeline test procedure).
- Check:
  - Inngest dashboard shows the run.
  - `BomPipelineRun` row is written as usual.
  - Slack/email notification fires as usual.
  - `waitUntil` path is NOT used (check Vercel logs).

### 5. Flip production
Set `INNGEST_BOM_ENABLED=true` in production. Watch Inngest dashboard + Sentry for the first day.

## Turning it off

Set `INNGEST_BOM_ENABLED=false` (or delete the var) in Vercel. Next webhook invocation uses `waitUntil` again. No code deploy needed.

## What to watch

- **In-flight runs during a bad deploy.** Inngest workers run off your Vercel deploy. A broken deploy that can't load `runDesignCompletePipeline` will fail all in-flight BOM runs. Inngest will retry 2× on its own — if still broken, the runs dead-letter. HubSpot workflows don't have this coupling.
- **Duplicate dedupe layers.** The webhook still calls `acquirePipelineLock()` before `inngest.send()`. Inngest's `concurrency: {key, limit: 1}` then enforces at-most-one execution. This is intentional defense-in-depth.
- **Cost.** Inngest's free tier is 50k function runs/mo. Today we do ≤200 BOM pipeline runs/mo — well within free.
- **Failure mode when Inngest is down.** If `inngest.send()` throws (network or auth failure), the webhook falls back to `waitUntil`. You'll see `${dealId}:started_fallback` in the response and a `console.error`.

## Decision criteria — is this worth expanding?

After ~2 weeks on the flag, evaluate:

- [ ] Did the Inngest dashboard make any pipeline failures easier to investigate than scrolling Vercel logs?
- [ ] Did we hit a case where the auto-retry saved a manual re-trigger?
- [ ] Did concurrency control catch a real duplicate that the DB lock would have let through?
- [ ] Any production incidents caused by Inngest itself?

If yes to 1–3 and no to 4 → **phase 2:** split `runDesignCompletePipeline()` into 7 `step.run()` calls for resumable execution + migrate `OutboxEvent` + migrate crons.

If no → **revert:** delete the spike files, remove the env vars.

## Phase 2 preview (not in this PR)

- Split `runDesignCompletePipeline` internal stages into `step.run("fetch-deal", …)`, `step.run("list-pdfs", …)`, etc. Each step persists its output via Inngest; retrying stage 7 reuses stages 1–6.
- Replace `withRetry` with per-step Inngest retries (declarative policy).
- Replace `acquirePipelineLock` partial index with Inngest concurrency key alone.
- Migrate `OutboxEvent`-backed flows (survey invites, Zuper job creation) to Inngest functions.
- Shard `property-reconcile` cron: 1 trigger event → N per-page events, processed in parallel.

Each of these is its own PR after the spike proves out.
