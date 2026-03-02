# BOM Pipeline Auto-Retry with Claude Escalation

**Date:** 2026-03-02
**Status:** Design

## Problem

BOM pipeline failures from transient API errors (Anthropic 500/502/529, Google Drive rate limits, Zoho 503) require manual intervention — someone has to read the failure email, decide it's transient, and trigger `/api/bom/pipeline-retry`. This happened three times today alone.

## Design: Two-Layer Retry

### Layer 1: Built-in Step Retry

Add retry logic directly in `bom-pipeline.ts`. When a step throws, classify the error and retry once with a 5-second delay before escalating.

**Retryable errors** (pattern match on error message + HTTP status):
- Anthropic API: 500, 502, 503, 529 (overloaded), rate limit, timeout
- Google Drive: 500, 503, rate limit
- Zoho API: 500, 503, rate limit
- Network: ECONNRESET, ETIMEDOUT, fetch failed

**Non-retryable errors** (skip to escalation immediately):
- Missing data (no folder URL, no PDFs, no BOM returned)
- Auth failures (401, 403)
- Validation/schema errors
- Business logic failures (no customer match)

**Implementation:** Wrap each step's execution in a `withRetry()` helper:

```typescript
async function withRetry<T>(
  stepName: BomPipelineStep,
  fn: () => Promise<T>,
  opts?: { delayMs?: number }
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isRetryableError(err)) throw err;
    console.warn(`[bom-pipeline] ${stepName} failed with retryable error, retrying in ${opts?.delayMs ?? 5000}ms...`);
    await sleep(opts?.delayMs ?? 5000);
    return await fn(); // Second attempt throws to caller on failure
  }
}
```

### Layer 2: Claude Escalation

When a step fails after exhausting Layer 1 retry, call Claude Sonnet to analyze the error and decide whether a full pipeline retry is warranted.

**New internal function:** `escalateToClaudeAnalysis()` in `bom-pipeline.ts` — no separate route needed, runs in-process before `fail()` is called.

**Flow:**
```
Step fails after auto-retry
  → escalateToClaudeAnalysis({ dealId, dealName, failedStep, error, attemptCount })
  → Claude Sonnet classifies: { shouldRetry: boolean, reasoning: string }
  → If shouldRetry:
      - Log "claude_escalation_retry" activity
      - Call runDesignCompletePipeline() with a fresh runId (new lock)
      - Original run marked FAILED with metadata noting Claude triggered a retry
      - Email includes: "🔄 Auto-retried after AI analysis: {reasoning}"
  → If !shouldRetry:
      - Proceed to normal fail() flow
      - Email includes: "🤖 AI analysis: {reasoning}. Manual action needed."
```

**Claude's system prompt context:**
- List of known transient vs permanent error patterns
- All pipeline steps are idempotent (safe to re-run from scratch)
- Cost of retry is low (~$0.10 extraction, $0.003 analysis)
- Err on the side of retrying — false retry is cheap, missed retry costs human time

**Guard rails:**
- Max 1 Claude-initiated retry per deal per 30 minutes (prevent loops)
- `BomPipelineRun.metadata` tracks `{ claudeEscalation: { reasoning, shouldRetry, triggeredRunId? } }`
- Feature-gated via `PIPELINE_CLAUDE_ESCALATION_ENABLED=true` env var

### Updated Pipeline Flow

```
                     ┌─────────────────┐
                     │   Step Executes  │
                     └────────┬────────┘
                              │
                         fails?
                        ╱         ╲
                      no           yes
                      │            │
                      ▼       retryable?
                 next step    ╱         ╲
                            yes          no
                             │            │
                             ▼            │
                     wait 5s + retry      │
                             │            │
                        still fails?      │
                       ╱         ╲        │
                     no           yes     │
                      │            │      │
                      ▼            ▼      ▼
                 next step   Claude escalation
                              ╱         ╲
                         retry?        don't retry
                            │              │
                            ▼              ▼
                    new pipeline run    fail() + email
                    + email "retried"  "AI: not retried"
```

### Email Notifications — Enhanced

The failure email template gains a new section when Claude escalation runs:

```
🤖 AI Analysis
Decision: Retried / Not retried
Reasoning: "Anthropic API returned 500 (internal server error).
This is a known transient issue. Triggered automatic retry."
```

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/bom-pipeline.ts` | Add `withRetry()`, `isRetryableError()`, `escalateToClaudeAnalysis()`. Wrap steps in `withRetry()`. Call escalation before `fail()`. |
| `src/lib/bom-pipeline-lock.ts` | Add check: skip lock if Claude-initiated retry within 30 min of last attempt for same deal. |
| `src/lib/email.ts` | Add `claudeAnalysis?: { reasoning: string; shouldRetry: boolean }` to notification params. Render AI analysis section in email template. |
| `prisma/schema.prisma` | No changes — `BomPipelineRun.metadata` (Json) already exists for storing escalation data. |

### Cost

- Layer 1 retry: $0 (just re-runs the step)
- Layer 2 Claude analysis: ~$0.003 per call (Sonnet, ~500 input tokens + 100 output)
- Layer 2 retry: ~$0.10 (full extraction re-run)
- At current volume (~5 failures/week), total added cost: ~$0.50/week

### Rollout

1. Deploy Layer 1 (built-in retry) first — immediate value, zero risk
2. Deploy Layer 2 behind `PIPELINE_CLAUDE_ESCALATION_ENABLED` flag
3. Monitor escalation decisions for 1-2 weeks via activity logs
4. If accuracy is good, enable by default

---

## Implementation Plan

### Step 1: Add retry utilities to bom-pipeline.ts

**Files:** `src/lib/bom-pipeline.ts`

Add at the top of the file:

1. `sleep(ms)` helper
2. `isRetryableError(err)` — pattern match on error message/status for transient errors
3. `withRetry(stepName, fn, opts)` — try once, if retryable error wait and try again

### Step 2: Wrap pipeline steps with withRetry

**Files:** `src/lib/bom-pipeline.ts`

Wrap the step executions that hit external APIs:
- `FETCH_DEAL` — HubSpot API call
- `LIST_PDFS` — Google Drive API call
- `EXTRACT_BOM` — Anthropic Files API + Claude extraction
- `SAVE_SNAPSHOT` — Prisma DB (unlikely transient, but covers Neon connection blips)
- `RESOLVE_CUSTOMER` — Zoho API (via cache, less likely)
- `CREATE_SO` — Zoho Inventory API

Leave the classification logic (`isRetryableError`) strict initially — only retry well-known transient patterns.

### Step 3: Add Claude escalation function

**Files:** `src/lib/bom-pipeline.ts`

Add `escalateToClaudeAnalysis()`:
- Takes `{ dealId, dealName, failedStep, errorMessage, runId }`
- Calls Anthropic API (Claude Sonnet) with structured output
- Returns `{ shouldRetry: boolean; reasoning: string }`
- Gated by `PIPELINE_CLAUDE_ESCALATION_ENABLED` env var
- Includes 30-minute cooldown check (query `BomPipelineRun` for recent Claude-retries on same deal)

### Step 4: Integrate escalation into fail() path

**Files:** `src/lib/bom-pipeline.ts`

Before the current `fail()` sends the notification:
1. If escalation enabled, call `escalateToClaudeAnalysis()`
2. If Claude says retry:
   - Acquire new pipeline lock with trigger `"MANUAL"` (reuses existing enum)
   - Fire `runDesignCompletePipeline()` via `waitUntil()` (same as pipeline-retry route)
   - Update current run's metadata with escalation info
   - Send "retried" notification instead of "failed"
3. If Claude says don't retry (or escalation disabled):
   - Proceed with existing fail() flow
   - Include Claude's reasoning in the email if escalation ran

### Step 5: Enhance email template

**Files:** `src/lib/email.ts`

Add optional `claudeAnalysis` field to `sendPipelineNotification()` params. When present, render an "AI Analysis" section in the email showing the decision and reasoning.

### Step 6: Build, test, deploy

1. `npm run build` — verify compilation
2. Test Layer 1 locally by simulating a retryable error
3. Deploy to production
4. Set `PIPELINE_CLAUDE_ESCALATION_ENABLED=true` in Vercel env
5. Monitor via activity logs and notification emails
