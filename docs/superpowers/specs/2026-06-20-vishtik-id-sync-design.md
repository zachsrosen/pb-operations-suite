# Vishtik Project ID Sync — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorming) — pending spec review
**Branch:** `feat/vishtik-id-sync`

## Problem

HubSpot deals carry a `project_number` (format `PROJ-XXXX`) but have **no link to the corresponding Vishtik design project**. The HubSpot deal property `vishtik_project_id` already exists but is **0% populated** (0 of ~22,529 deals). There is no `vishtik_project_url` property at all.

This forces anyone closing out a design (e.g. the `design-project-closeout` skill) to reverse-engineer Vishtik's flaky list API to map `PROJ-XXXX → Vishtik internal id` every time. Storing the id (and a clickable URL) on the deal makes that lookup trivial and durable.

## Goal

1. Create a `vishtik_project_url` deal property.
2. Populate `vishtik_project_id` + `vishtik_project_url` on every deal that has a clean single Vishtik match (one-time backfill).
3. Keep it current automatically (nightly), so future close-outs are direct lookups.

Non-goals: changing Vishtik itself, populating deals that legitimately have no Vishtik project (EV, roofing/Roofr, etc.), or resolving ambiguous duplicates automatically.

## Key constraints (discovered)

- **Vishtik has no API and no API key.** Auth is cookie/session based (browser login; CSRF handled by a jQuery `ajaxPrefilter` on page loads for AJAX calls).
- **Login is automatable:** `POST /login-auth` with fields `username`, `password`, `back_url`, `timezone`. The login form has **no reCAPTCHA** (the CAPTCHA is only on the `/register-auth` form). So a headless server-side login is feasible.
- **Sessions are short-lived** (expired several times within ~1 hour during investigation) — so the cron logs in fresh each run rather than persisting a session.
- **The list endpoint `POST /Project/Project/Get-Project` is quirky** (see `design-project-closeout` skill's reference and the `reference-vishtik-list-api-quirks` memory):
  - `search` param is non-functional (returns 0 for any value).
  - `recorddata` is not page size; **`showtotal` is the page size** (max ~2000).
  - `cntr` (page number) can get stuck on a session-bound cursor; a robust fallback is **`showtotal` tiling** — page-2-of-size-`S` returns rows `[S+1, 2S]`; a halving sequence of `S` covers the full list, plus row 1 from a small request. A fresh server session may paginate normally via `cntr`; the client tries that first and falls back to tiling.
  - Row shape: `{ id (Vishtik internal id), customer_name ("PROJ-XXXX | Last, First", sometimes "D&R | PROJ-XXXX | ..."), status ("4"=Design Review, "16"=Approved), project_number (Vishtik's own number, NOT the PB PROJ) }`.
- **Vishtik detail URL** is deterministic: `https://project.vishtik.com/Project/Project/Project-Details?id={vishtikId}`.

## Architecture

### 1. `src/lib/vishtik.ts` — Vishtik server client

Self-contained module that talks to Vishtik. Depends only on `fetch` + env creds.

- `vishtikLogin(): Promise<CookieJar>` — GET `/login` (warm cookies), then `POST /login-auth` with `VISHTIK_USERNAME`/`VISHTIK_PASSWORD` (from env), `back_url=''`, `timezone='America/Denver'`. Captures Set-Cookie(s) into an in-memory jar. Throws `VishtikAuthError` on failure (detected by redirect back to `/login` or missing session cookie).
- `fetchAllProjects(jar): Promise<VishtikProject[]>` — returns `{ vishtikId, projNumber, customerName, status }[]`. Strategy:
  1. Try standard pagination (`cntr` 1..N at `showtotal=100`), watching `current_page`/`total_page`.
  2. If the cursor proves stuck (current_page doesn't track cntr), fall back to `showtotal` tiling (halving sequence) to cover all rows.
  3. Parse `projNumber` from `customer_name` via `/PROJ-\d+/`. Rows with no PROJ token are kept but flagged (not matchable).
  - De-dupe rows by `vishtikId`.
- `VishtikProject`, `VishtikAuthError`, `CookieJar` types exported.

The HTTP transport (login + list fetch) is injectable so `vishtik-sync.ts` and tests can pass a fake.

### 2. `src/lib/vishtik-sync.ts` — matching + writing

- `buildProjIndex(projects): Map<projNumber, VishtikProject[]>` — groups by PROJ token.
- `syncVishtikIds({ dryRun, fetchProjects?, ... }): Promise<SyncResult>`:
  1. Fetch the Vishtik project list (via injected `fetchProjects`, default = real client).
  2. **Sanity gate:** if the list is empty or implausibly short (< a configured floor, e.g. 500), abort with `aborted: true` and **write nothing** (guards against auth/parse failures silently clearing data).
  3. Read HubSpot deals that have `project_number` set AND `vishtik_project_id` empty (paged CRM search, `NOT_HAS_PROPERTY` on `vishtik_project_id` + `HAS_PROPERTY` on `project_number`).
  4. For each deal: look up its PROJ token in the index.
     - Exactly one Vishtik match → write `{ vishtik_project_id: id, vishtik_project_url: detailUrl(id) }`.
     - Zero matches → count as `unmatched` (no write).
     - 2+ matches (duplicate Vishtik projects) → count as `ambiguous`, record `{ projNumber, candidateIds }`, no write.
  5. Writes via `updateDealProperty(dealId, props)` (existing `src/lib/hubspot.ts` helper). **Never writes null/empty** — only sets values on a clean single match.
- `SyncResult`: `{ totalDeals, written, ambiguous: [...], unmatchedCount, writeFailures, aborted, durationMs }`.
- `detailUrl(id)` helper.

### 3. `src/app/api/cron/vishtik-id-sync/route.ts` — cron entrypoint

- `Bearer ${process.env.CRON_SECRET}` auth (matches existing cron routes).
- Gated by **SystemConfig flag** `vishtik_sync_enabled` (read via the existing `prisma.systemConfig.findUnique` pattern). Off → `{ status: "disabled" }`. (Prod flags live in SystemConfig per the Vercel-env-cap learning.)
- Calls `syncVishtikIds({ dryRun: false })`, returns the `SyncResult` JSON with timestamp.
- `export const maxDuration` set high enough for the slow list fetch (see Open Risk).

### 4. `scripts/create-vishtik-url-property.ts` — one-off property creation

- Creates the `vishtik_project_url` deal property (group `dealinformation` or matching the existing `vishtik_project_id`'s group; type `string`, fieldType `text`). Idempotent (skip if exists). Run once before enabling.

### 5. `vercel.json` — schedule

- Add `{ "path": "/api/cron/vishtik-id-sync", "schedule": "0 8 * * *" }` (nightly 08:00 UTC / ~02:00 MT). Schedule TBD-fine in plan.

### 6. Env

- `VISHTIK_USERNAME`, `VISHTIK_PASSWORD` added to `.env.example` and to Vercel **production** (via `printf | vercel env add`, verified with `vercel env pull` — per the no-echo learning). Credentials never handled in plaintext by the assistant; the user sets them.

## Data flow

```
nightly cron tick
  └─ auth: CRON_SECRET  ──► flag check (SystemConfig vishtik_sync_enabled)
       └─ vishtikLogin() ── env creds ──► cookie jar
            └─ fetchAllProjects() ──► VishtikProject[]  (sanity-gated)
                 └─ buildProjIndex()
                      └─ HubSpot search: deals with project_number & no vishtik_project_id (paged)
                           └─ match by PROJ token
                                ├─ single  → updateDealProperty(id, {vishtik_project_id, vishtik_project_url})
                                ├─ none    → unmatched (no write)
                                └─ 2+      → ambiguous (no write, reported)
  └─ return { written, ambiguous[], unmatchedCount, writeFailures, aborted }
```

Backfill is just the first nightly run (it processes everything missing); the same job maintains steady state thereafter. No separate backfill script.

## Error handling

- **Login failure** → throw `VishtikAuthError`; route returns 500, writes nothing.
- **Short/empty list** → `aborted: true`, no writes (mass-mismatch guard).
- **Per-deal write failure** → increment `writeFailures`, continue.
- **Ambiguous / unmatched** → never guessed; surfaced in the response for visibility (and for spotting Vishtik data issues like duplicate projects or PROJ mismatches such as Brownell 9713↔9542).

## Testing

- Unit tests (`src/__tests__/vishtik-sync.test.ts`) for the pure matcher with a mock `fetchProjects` and a fake HubSpot writer:
  - PROJ extraction incl. `D&R | PROJ-XXXX | ...` prefix.
  - single match → writes both props with correct URL.
  - duplicate PROJ → ambiguous, no write.
  - no match (e.g. EV deal) → unmatched, no write.
  - empty list → aborted, no writes.
  - never writes null/empty.
- Vishtik client login/fetch behind an interface; a thin parsing unit test for `customer_name → projNumber` and the tiling cover sequence. Live login/fetch validated manually via a `dryRun` run after env creds are set (not in CI).

## Rollout

1. Branch from `main` (worktree `feat/vishtik-id-sync`). ✔
2. Create `vishtik_project_url` property (script).
3. Add `VISHTIK_USERNAME`/`VISHTIK_PASSWORD` to Vercel prod + `.env.example`.
4. Deploy with flag **off** (`vishtik_sync_enabled` unset/false).
5. Run once with `dryRun: true` (manual invoke) → eyeball `written`/`ambiguous`/`unmatched` counts and confirm headless login actually works.
6. Flip `vishtik_sync_enabled = true` → first real run backfills; nightly thereafter.

## Open risk — cron timeout

The full Vishtik list fetch is slow (~1–3 min for ~2,300 projects; the server itself is slow). Vercel function `maxDuration` must cover it. If it can't fit a single tick:
- **Fallback:** split into (a) fetch-list-and-cache (to a `SystemConfig`/DB blob or short-lived cache) on one tick, then (b) match-and-write HubSpot deals in batches across subsequent ticks. The matching/writing is the cheap part; only the Vishtik fetch is slow.
- Resolved concretely in the implementation plan once `maxDuration` limits on the current Vercel plan are confirmed.
