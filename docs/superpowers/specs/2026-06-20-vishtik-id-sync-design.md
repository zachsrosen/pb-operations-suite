# Vishtik Project ID Sync — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorming) — in spec review
**Branch:** `feat/vishtik-id-sync`

## Problem

HubSpot deals carry a `project_number` (format `PROJ-XXXX`) but have **no link to the corresponding Vishtik design project**. The HubSpot deal property `vishtik_project_id` already exists but is **0% populated** (0 of ~22,529 deals). There is no `vishtik_project_url` property at all.

This forces anyone closing out a design (e.g. the `design-project-closeout` skill) to reverse-engineer Vishtik's flaky list API to map `PROJ-XXXX → Vishtik internal id` every time. Storing the id (and a clickable URL) on the deal makes that lookup trivial and durable.

## Goal

1. Create a `vishtik_project_url` deal property.
2. Populate `vishtik_project_id` + `vishtik_project_url` on every deal that has a clean single Vishtik match (backfill).
3. Keep it current automatically (nightly), so future close-outs are direct lookups.

**Non-goals:**
- Changing Vishtik itself.
- Populating deals that legitimately have no Vishtik project (EV, roofing/Roofr, sales deals that never went to design).
- Auto-resolving ambiguous duplicate Vishtik projects.
- **Correcting a `vishtik_project_id` after it has been written.** Ids are treated as **immutable once set**; if a Vishtik project is recreated with a new internal id (the Brownell 9713↔9542 case shows this happens), the stale id is left for manual correction. The job never re-examines an already-populated deal.

## Key constraints (discovered)

- **Vishtik has no API and no API key.** Auth is cookie/session based (browser login; CSRF handled by a jQuery `ajaxPrefilter` for AJAX calls).
- **Login is automatable:** `POST /login-auth` with fields `username`, `password`, `back_url`, `timezone`. The login form has **no reCAPTCHA** (CAPTCHA is only on `/register-auth`). Headless server-side login is feasible.
- **Sessions are short-lived** (expired several times within ~1 hour during investigation) — the cron logs in fresh each run, and **re-logs-in on a mid-run 401** during the slow fetch.
- **The list endpoint `POST /Project/Project/Get-Project` is quirky** (see `design-project-closeout` skill reference + `reference-vishtik-list-api-quirks` memory):
  - `search` param is non-functional (returns 0 for any value).
  - `recorddata` is not page size; **`showtotal` is the page size** (max ~2000).
  - `cntr` (page number) can stick on a session-bound cursor; robust fallback is **`showtotal` tiling** — page-2-of-size-`S` returns rows `[S+1, 2S]`; a halving sequence of `S` covers the list, plus row 1 from a small request. The client tries normal `cntr` pagination first and falls back to tiling.
  - Row shape: `{ id (Vishtik internal id), customer_name ("PROJ-XXXX | Last, First", sometimes "D&R | PROJ-XXXX | ..."), status ("4"=Design Review, "16"=Approved) }`.
- **Vishtik detail URL** is deterministic: `https://project.vishtik.com/Project/Project/Project-Details?id={vishtikId}`.

## Architecture

### 1. `src/lib/vishtik.ts` — Vishtik server client

Self-contained module; depends only on `fetch` + env creds.

- `vishtikLogin(): Promise<CookieJar>` — GET `/login` (warm cookies), `POST /login-auth` with `VISHTIK_USERNAME`/`VISHTIK_PASSWORD`, `back_url=''`, `timezone='America/Denver'`. Captures Set-Cookie(s). Throws `VishtikAuthError` on failure (redirect back to `/login` or no session cookie).
- `fetchAllProjects(jar): Promise<{ projects: VishtikProject[]; complete: boolean }>` — returns `{ vishtikId, projNumber, customerName, status }[]`.
  - Strategy: try standard `cntr` pagination at `showtotal=100`, watching `current_page`/`total_page`; if the cursor proves stuck, fall back to `showtotal` tiling (halving cover sequence).
  - Parse `projNumber` via `/PROJ-\d+/`.
  - **Per-request retry with backoff** (Vishtik is slow and occasionally 5xx). On a **401 mid-fetch**, re-login once and resume.
  - **Completeness check:** verify the returned set covers the full row range (tiling gap detection) and that the row count is within a tolerance of `total_row`. If a tile permanently fails or coverage has gaps → return `complete: false`. De-dupe by `vishtikId`.
- Transport (login + list fetch) is injectable so `vishtik-sync.ts` and tests pass a fake.

### 2. `src/lib/vishtik-sync.ts` — matching + writing

- `buildProjIndex(projects): Map<projNumber, VishtikProject[]>`.
- `detailUrl(id): string`.
- `syncVishtikIds({ dryRun, fetchProjects?, now? }): Promise<SyncResult>`:
  1. **Acquire lock** (SystemConfig `vishtik_sync_running` = ISO timestamp; if present and < 30 min old → return `{ skipped: "locked" }`; else take over). Released in `finally`.
  2. Fetch the Vishtik list once (injected `fetchProjects`).
  3. **Sanity gate (write-suppression):**
     - `complete === false` → `aborted: "incomplete-fetch"`, no writes.
     - `projects.length` below an absolute floor (e.g. 500) **or** dropped > 15% vs. the last-good count stored in SystemConfig (`vishtik_last_good_count`) → `aborted: "suspicious-count"`, no writes.
     - On a clean run, update `vishtik_last_good_count`.
  4. Build the index.
  5. **Iterate candidate deals with createdate windowing to bypass HubSpot's 10k search window:** search deals where `project_number HAS_PROPERTY` AND `vishtik_project_id NOT_HAS_PROPERTY` AND `createdate >= cursor`, sorted `createdate ASC`. Read via `batchReadDealsWithRetry`. Process up to a per-run cap (deal count or wall-clock budget); advance a persisted cursor (SystemConfig `vishtik_sync_cursor`) to the last-seen `createdate`. When the sweep reaches the present, reset the cursor to epoch (rolling sweep — re-checks still-unmatched deals cheaply in-memory and auto-heals ones whose Vishtik project appeared later; already-written deals are excluded by the filter so they're never revisited).
  6. Per deal, match by PROJ token:
     - exactly one → write `{ vishtik_project_id, vishtik_project_url }`.
     - zero → `unmatched` (no write).
     - 2+ → `ambiguous` (record `{ projNumber, candidateIds }`, no write).
  7. Writes are **batched + throttled** via HubSpot's deal `batch/update` endpoint (reusing the retry/backoff pattern in `src/lib/hubspot.ts`), not one call per deal. **Never writes null/empty.**
- `SyncResult`: `{ totalScanned, written, ambiguous: [...], unmatchedCount, writeFailures, aborted?: string, skipped?: string, fetchedCount, cursorBefore, cursorAfter, durationMs }`.
- `dryRun: true` still does the full fetch + read + match (to produce real counts) and **only skips the writes** and cursor advance.

### 3. `src/app/api/cron/vishtik-id-sync/route.ts` — cron entrypoint

- `Bearer ${process.env.CRON_SECRET}` auth.
- Gated by **SystemConfig flag** `vishtik_sync_enabled` (read via `prisma.systemConfig.findUnique`). Off → `{ status: "disabled" }`.
- Calls `syncVishtikIds({ dryRun: false })`, persists a `VishtikSyncRun` row, returns the `SyncResult` JSON.
- `export const maxDuration` sized for the slow fetch (see Open Risk).
- Emits a **Sentry** event on `aborted`, `skipped: "locked"` recurring, `VishtikAuthError`, or `writeFailures > 0`.

### 4. `prisma/schema.prisma` — `VishtikSyncRun` (observability)

Additive model mirroring `HubSpotSyncRun`: `{ id, startedAt, finishedAt, written, unmatchedCount, ambiguousCount, writeFailures, fetchedCount, aborted (String?), durationMs }`. Additive migration committed; **applied before code merges** (per migration-ordering convention). Lets ops see run history instead of relying on the cron's (un-stored) HTTP response.

### 5. `scripts/create-vishtik-url-property.ts` — one-off property creation

Creates `vishtik_project_url`. **Reads the existing `vishtik_project_id` property's `groupName`/`fieldType` at runtime and mirrors them** so the URL lands beside the id (type `string`). Idempotent (skip if exists). Run once before enabling.

### 6. `vercel.json` — schedule

Add `{ "path": "/api/cron/vishtik-id-sync", "schedule": "0 8 * * *" }` (nightly ~02:00 MT). Finalized in plan.

### 7. Env

`VISHTIK_USERNAME`, `VISHTIK_PASSWORD` → `.env.example` + Vercel **production** (via `printf | vercel env add`, verified with `vercel env pull` — per the no-echo learning). The user sets the values; the assistant never handles them in plaintext.

## Data flow

```
nightly cron tick
  └─ CRON_SECRET ─► flag (SystemConfig vishtik_sync_enabled)
       └─ acquire lock (vishtik_sync_running, stale-takeover 30m)
            └─ vishtikLogin() ─ env creds ─► cookie jar  (re-login on mid-run 401)
                 └─ fetchAllProjects() ─► {projects, complete}
                      └─ sanity gate (complete? floor? >15% drop vs last-good?) ─ fail ─► abort, no writes
                           └─ buildProjIndex()
                                └─ HubSpot deals (project_number set, vishtik_project_id empty,
                                   createdate ≥ cursor, ASC) via batchReadDealsWithRetry, per-run cap
                                     └─ match by PROJ token
                                          ├─ single → queue write {id, url}
                                          ├─ none   → unmatched
                                          └─ 2+     → ambiguous (reported)
                                └─ batch/update writes (throttled, never null)
                                └─ advance cursor (wrap at present)
       └─ persist VishtikSyncRun + return SyncResult; Sentry on abort/auth-fail/writeFailures
```

Backfill is the cron sweeping forward across several nightly runs (or faster via a manual `dryRun:false` invoke loop); the same job maintains steady state. No separate backfill script.

## Error handling

- **Login failure** → `VishtikAuthError`; route 500; no writes; Sentry.
- **Incomplete/short/suspicious fetch** → `aborted`, no writes; Sentry.
- **Concurrent run** → `skipped: "locked"`.
- **Per-deal/batch write failure** → counted in `writeFailures`, continue.
- **Ambiguous / unmatched** → never guessed; surfaced in `SyncResult` (also useful for spotting Vishtik duplicates / PROJ mismatches).

## Testing

Unit tests (`src/__tests__/vishtik-sync.test.ts`) for the pure matcher + sync orchestration with a fake `fetchProjects` and a fake HubSpot read/write:
- PROJ extraction incl. `D&R | PROJ-XXXX | ...` prefix.
- single → writes both props with correct URL.
- duplicate PROJ → ambiguous, no write.
- no match (EV deal) → unmatched, no write.
- `complete:false` and >15% count drop → aborted, no writes.
- never writes null/empty.
- lock held → skipped.
- cursor advances and wraps correctly; dryRun skips writes + cursor advance.

A thin parsing test for the `customer_name → projNumber` regex and the tiling cover-sequence/gap-detection. Live login/fetch validated manually via a `dryRun` after env creds are set (not in CI).

## Rollout

1. Branch from `main` (worktree `feat/vishtik-id-sync`). ✔
2. Apply additive `VishtikSyncRun` migration to prod.
3. Create `vishtik_project_url` property (script).
4. Add `VISHTIK_USERNAME`/`VISHTIK_PASSWORD` to Vercel prod + `.env.example`.
5. Deploy with flag **off**.
6. Manual `dryRun: true` run → confirm headless login works and eyeball `written`/`ambiguous`/`unmatched`/`fetchedCount`.
7. Flip `vishtik_sync_enabled = true` → sweeps backfill over the next runs; nightly thereafter.

## Open risk — cron timeout

The full Vishtik list fetch is slow (~1–3 min for ~2,300 projects). Vercel function `maxDuration` must cover it. The createdate-windowed per-run **deal cap** already bounds the HubSpot side; the fetch is the fixed cost. If a single tick can't fit even fetch + a small write batch:
- **Fallback:** cache the fetched Vishtik list (short-TTL `SystemConfig`/DB blob keyed by date) on one tick, then match-and-write deal windows on subsequent ticks without re-fetching.
- Resolved concretely in the implementation plan once `maxDuration` limits on the current Vercel plan are confirmed.
