# Pueblo Location Rename Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the "Colorado Springs" PB office to "Pueblo" across all live application code, with back-compat aliases so legacy data, URLs, and external-system strings keep resolving.

**Architecture:** `src/lib/locations.ts` is the canonical source; every other reference independently hardcodes the string, so this is a coordinated rename of the canonical value plus ~85 dependent files, grouped into clusters that are changed and verified serially. All external-system IDs stay the same (verified: HubSpot Location record 35236484623, Zuper team `1a914a0e-b633-4f12-8ed6-3348285d6b93`, and the Google install calendar were all renamed in place; `GOOGLE_INSTALL_CALENDAR_COSP_ID` == `GOOGLE_INSTALL_CALENDAR_PUEBLO_ID` in prod env). A standalone script migrates stored DB rows; Zach runs it manually.

**Tech Stack:** Next.js 16 / TypeScript 5 / Prisma 7 / Jest.

**Decisions (from Zach, 2026-07-20):**
1. **Address/coords:** keep the old Colorado Springs address (752 Clark Pl) and coords for now — labels change, pin does not move yet.
2. **Territory:** add zip prefixes `810`/`811` (Pueblo) alongside `808`/`809`; estimator service area extends to 80800–81199.
3. **Abbreviation:** `PBLO` replaces `COSP`/`CSP`/`COS`/`CO Spgs` in type unions and UI.
4. HubSpot data is already migrated (`pb_location` = "Pueblo" everywhere); this plan is app-code only.

**Global invariants (apply to every task):**
- Display label is exactly `Pueblo`. Abbreviation is exactly `PBLO`.
- Anywhere code *matches inbound strings* (calendar event text, Zoho warehouse names, Zuper team names, stored DB rows, URL slugs), it must accept BOTH the legacy Colorado Springs forms and the new Pueblo forms. Anywhere code *emits* strings, it emits only the new forms.
- Never touch: `src/lib/ec-qualifying-zips.ts` (federal tax-credit zip list), any `"Colorado Springs Utilities"` / `CSU` utility references, any `ahj` values (the city still exists), historical changelog entries in `src/lib/product-updates.ts`, `docs/**`, `data/**`, analysis artifacts in `scripts/`.
- `npx tsc --noEmit` project-wide must be clean by the END OF EACH CHUNK (Tasks 1–2 may be transiently broken between them; commit only on clean tsc). NOTE: most dependent maps are untyped `Record<string, …>`, so tsc will NOT surface them — the Task 8/11 rg gate is the real coverage net, not the compiler.
- Baseline: 38 test suites already fail on origin/main (list: scratchpad `baseline-failures.txt`, includes `office-performance.test.ts` + `office-performance-v2.test.ts`). Gate is "no NEW failures", not zero failures.

---

## Chunk 1: Canonical core

### Task 1: Canonical location module (`locations.ts`)

**Files:**
- Modify: `src/lib/locations.ts`
- Test: `src/__tests__/lib/locations.test.ts`

- [ ] **Step 1: Write failing tests** — extend the existing suite with, at minimum:

```ts
// canonical value renamed
expect(CANONICAL_LOCATIONS).toContain("Pueblo");
expect(CANONICAL_LOCATIONS).not.toContain("Colorado Springs");
// legacy aliases still resolve
expect(normalizeLocation("Colorado Springs")).toBe("Pueblo");
expect(normalizeLocation("COSP")).toBe("Pueblo");
expect(normalizeLocation("co springs")).toBe("Pueblo");
expect(normalizeLocation("PBLO")).toBe("Pueblo");
expect(normalizeLocation("pueblo")).toBe("Pueblo");
// slugs: new primary, legacy accepted
expect(LOCATION_SLUG_TO_CANONICAL["pueblo"]).toBe("Pueblo");
expect(LOCATION_SLUG_TO_CANONICAL["colorado-springs"]).toBe("Pueblo");
expect(CANONICAL_TO_LOCATION_SLUG["Pueblo"]).toBe("pueblo");
// zip routing: Springs metro AND Pueblo
expect(resolvePbLocationFromAddress("80915", "CO")).toBe("Pueblo");
expect(resolvePbLocationFromAddress("81001", "CO")).toBe("Pueblo");
expect(resolvePbLocationFromAddress("81101", "CO")).toBe("Pueblo"); // 811 prefix (Alamosa band — included per decision 2)
```

Also update every existing assertion in the file that expects `"Colorado Springs"` as a *canonical output* to expect `"Pueblo"` (assertions that feed legacy strings as *inputs* keep those inputs).

- [ ] **Step 2: Run to verify failures** — `npx jest src/__tests__/lib/locations.test.ts` → FAIL.

- [ ] **Step 3: Implement** in `src/lib/locations.ts`:
  - `CANONICAL_LOCATIONS`: `"Colorado Springs"` → `"Pueblo"`.
  - Alias entry becomes: `["Pueblo", ["pblo", "pueblo", "cosp", "colorado springs", "co springs"]]`.
  - `LOCATION_SLUG_TO_CANONICAL`: change `"colorado-springs"` to map to `"Pueblo"` AND add `"pueblo": "Pueblo"` (legacy slug kept so old bookmarks/office-performance URLs keep working).
  - `CANONICAL_TO_LOCATION_SLUG`: `"Pueblo": "pueblo"`.
  - `ZIP_PREFIX_TO_LOCATION`: `"808"`, `"809"`, `"810"`, `"811"` all → `"Pueblo"`; update the section comment.

- [ ] **Step 4: Run test** → PASS. Then `npx tsc --noEmit` — EXPECT ERRORS in dependent files (type `CanonicalLocation` changed). Note the errors but do not treat them as the full worklist (untyped Records won't appear).

- [ ] **Step 5: Commit together with Task 2** (constants) once tsc is clean.

### Task 2: Constants + map core

**Files:**
- Modify: `src/lib/constants.ts`, `src/lib/map-types.ts`, `src/lib/map-offices.ts`, `src/lib/map-colors.ts`, `src/lib/map-aggregator.ts`, `src/lib/sop-sanitize.ts`
- Test: `src/__tests__/lib/constants.test.ts`, `src/__tests__/map-offices.test.ts`, `src/__tests__/map-colors.test.ts`, `src/__tests__/map-proximity.test.ts`

- [ ] **Step 1: Update tests first** (same pattern: canonical outputs become `Pueblo`/`pblo`/`PBLO`, legacy strings remain only as alias-resolution inputs). Run → FAIL.

- [ ] **Step 2: Implement:**
  - `constants.ts`:
    - `_WAREHOUSE_IDS`: key `"Colorado Springs"` → `"Pueblo"` (ID `5385454000000114101` unchanged). Alias keys `"co springs"`, `"cosp"` stay pointing at the same ID; add `"pueblo"`, `"pblo"`.
    - `LOCATION_COLORS`, `LOCATION_TIMEZONES`: key → `"Pueblo"` (amber color and `America/Denver` unchanged).
    - `TERRITORY_BOUNDARIES`: south-fallthrough logic unchanged; update any comment naming Colorado Springs.
  - `map-types.ts`: `CrewShopId` `"cosp"` → `"pblo"`.
  - `map-offices.ts`: `id: "pblo"`, label `"Pueblo"`, `pbLocation: "Pueblo"`; **keep** `lat: 38.8587, lng: -104.7362` and `address: "752 Clark Pl, Colorado Springs, CO 80915"` per decision 1, with a one-line comment that the physical move address is pending.
  - `map-colors.ts`: `cosp: "COSP"` → `pblo: "PBLO"`.
  - `map-aggregator.ts`: `cosp` key → `pblo`.
  - `sop-sanitize.ts`: allowlist BOTH `region-cosp` (existing served content) and `region-pblo`.

- [ ] **Step 3:** `npx jest src/__tests__/lib/constants.test.ts src/__tests__/map-offices.test.ts src/__tests__/map-colors.test.ts src/__tests__/map-proximity.test.ts` → PASS.

- [ ] **Step 4:** `npx tsc --noEmit` — remaining errors must only be in files scheduled for Tasks 3–8; if clean, great.

- [ ] **Step 5: Commit** `feat(locations): rename Colorado Springs office to Pueblo in canonical modules`

### Task 3: Calendar, email routing, digests

**Files:**
- Modify: `src/lib/google-calendar.ts`, `src/lib/install-calendar-location.ts`, `src/lib/email.ts`, `src/lib/goals-digest/audience.ts`, `src/lib/goals-digest/build-digest-data.ts`, `src/lib/page-traffic.ts`, `.env.example`
- Test: existing suites touching these (run `npx jest google-calendar install-calendar email goals-digest --listTests` to find them)

- [ ] **Step 1:** Update matching logic:
  - `google-calendar.ts`: bucket id follows `CrewShopId` → `pblo`. Bucket text-matching must accept `pueblo`, `pblo`, `cosp`, `colorado springs`, `co springs` (it already accepts `pueblo`). Env resolution order becomes `GOOGLE_INSTALL_CALENDAR_PUEBLO_ID || GOOGLE_INSTALL_CALENDAR_COSP_ID` (both set in prod, same value).
  - `install-calendar-location.ts`: type/canonical → `"Pueblo"`; matchers keep `rolando`, `cosp alpha` AND add `pueblo alpha` (calendar event titles in the wild still say "COSP Alpha").
  - `email.ts` recipient maps (lines 1735 and 1744): key → `"Pueblo"`, recipients unchanged.
  - `goals-digest/audience.ts`: slug key → `"pueblo"`, recipients unchanged. `build-digest-data.ts` slug passthrough → `"pueblo"`.
  - `page-traffic.ts`: route key → `"/dashboards/office-performance/pueblo"`.
  - `.env.example`: flip the comment so `_PUEBLO_ID` is primary and `_COSP_ID` is the legacy alias.

- [ ] **Step 2:** Run affected suites + `npx tsc --noEmit` → PASS/clean-for-scheduled-files.

- [ ] **Step 3: Commit** `feat(locations): pueblo calendar buckets, email routing, digest slugs`

## Chunk 2: Derived config and features

### Task 4: Derived config cluster

**Files (all Modify):**
- `src/lib/revenue-groups-config.ts` — group key `colorado_springs` → `pueblo`, label → `Pueblo`, `locationFilter: ["Pueblo"]`, target unchanged. Grep for consumers of the literal key (`rg -n "colorado_springs" src/`) and update them; if the key is persisted anywhere (SystemConfig, saved prefs), add legacy-key acceptance at the read site.
- `src/lib/goals-pipeline-types.ts` — `HUBSPOT_LOCATION_IDS` key → `"Pueblo"` (ID `35236484623` unchanged, verified renamed in place); goal-target maps re-keyed.
- `src/lib/dashboard-location-groups.ts` — slug `pueblo`, label `Pueblo`, canonicals `["Pueblo"]`.
- `src/lib/executive-shared.ts` — `CREWS_CONFIG` key → `"Pueblo"`, crew display name `"COS Crew"` → `"Pueblo Crew"`, capacity unchanged.
- `src/lib/schedule-optimizer.ts` — crew-count key → `"Pueblo"`.
- `src/lib/compliance-v2/scoring.ts` + `src/lib/compliance-compute.ts` — normalized key `"colorado springs"` → `"pueblo"`; the normalizer input side must map legacy `"Colorado Springs"` rows to the same bucket (route through `normalizeLocation` if not already).
- `src/lib/compliance-team-overrides.ts` — 7 Zuper-UID rows: location value → `"Pueblo"` (UIDs unchanged).
- `src/lib/portal-availability.ts` — `"Pueblo": ["Pueblo"]`.
- `src/lib/idr-meeting.ts` — CO list → `["Westminster", "Centennial", "Pueblo"]`.
- `src/app/api/zuper/compliance/route.ts`, `src/app/api/zuper/availability/route.ts` — location maps re-keyed to `"Pueblo"`; inbound matching accepts legacy strings.
- `src/app/api/inventory/sync-zoho/route.ts` — alias map: `"pueblo"`, `"pblo"`, `"colorado springs"`, `"co springs"`, `"cosp"` all → `"Pueblo"` (Zoho warehouse name unverified — API unreachable during planning — so both directions must be accepted).
- `src/lib/admin-workflows/actions/create-zuper-job.ts:52` — **URGENT, live-broken today**: `TEAM_UID_BY_PB_LOCATION` only has `"colorado springs"`, but HubSpot already sends `pb_location = "Pueblo"`, so workflow-created Zuper jobs currently get no team. Add `"pueblo"` (and `"pblo"`) keys → same UID; keep the legacy key.
- `src/app/api/office-performance/goals-pipeline/all/route.ts`, `src/app/api/cron/goals-digest/route.ts` — comment/label updates.

- [ ] **Step 1:** Make the edits. **Step 2:** `npx jest compliance office-performance-types zuper-property-sync goals --silent 2>&1 | tail -20` — compare against baseline (office-performance suites already fail). **Step 3:** `npx tsc --noEmit`. **Step 4: Commit** `feat(locations): pueblo across derived config (revenue, goals, compliance, zoho, zuper)`

### Task 5: Crew + scheduling cluster

**Files (all Modify):**
- `src/app/dashboards/scheduler/page.tsx` — crew config key `"Pueblo"`, crew `"COSP Alpha"` → `"Pueblo Alpha"`; Rolando's Zuper UIDs unchanged; **line ~695**: `r.includes("springs")` region detection must become `r.includes("springs") || r.includes("pueblo")` (legacy report rows still say Springs); display abbrevs `"CO Spgs"`/`"CO Springs"` → `"Pueblo"`.
- `src/app/dashboards/construction-scheduler/page.tsx` — same crew rename + display.
- `src/app/dashboards/optimizer/page.tsx` — `"Pueblo": ["Pueblo Alpha"]`.
- `src/app/api/admin/rebalance-crews/route.ts` — `"Pueblo": ["Pueblo Alpha"]`, and BOTH name rows: `"Rolando": "Pueblo"` and `"Lenny Uematsu": "Pueblo"` (line 44 area).
- `src/lib/scheduler-v2/constants.ts` — `CONSTRUCTION_DIRECTORS` key `"Colorado Springs"` → `"Pueblo"` (keep a `"Colorado Springs"` alias key pointing at the same entry), `LOCATIONS` array entry → `"Pueblo"` (line 56), director-note comment (line 8). Untyped Record — tsc will not catch this.
- `src/app/api/admin/crew/route.ts` — `ZUPER_TEAM_UIDS` key → `"Pueblo"` (UID `1a914a0e-…` unchanged — verified renamed in place in Zuper).
- `src/app/api/admin/crew-availability/seed/route.ts` — seed values → `"Pueblo"`.
- `src/app/api/zuper/assisted-scheduling/route.ts` — placeholder key → `"Pueblo"`.
- `src/lib/pricing-calculator.ts` — pricing-tier key → `"Pueblo"` (tier value `"base"` unchanged).
- `src/lib/adders/pricing.ts` — location list entry → `"Pueblo"`.

Where any of these *match* crew names from Zuper/calendar text, accept both `"COSP Alpha"` and `"Pueblo Alpha"` (Zuper crew display names may lag).

- [ ] **Step 1:** Edits. **Step 2:** `npx jest schedule-optimizer scheduler --silent` vs baseline. **Step 3:** `npx tsc --noEmit`. **Step 4: Commit** `feat(locations): pueblo crew + scheduling configs`

### Task 6: Estimator cluster

**Files:**
- Modify: `src/lib/estimator/types.ts`, `src/lib/estimator/validation.ts`, `src/lib/estimator/service-area.ts`
- Test: `src/__tests__/estimator/service-area.test.ts` (+ any other estimator suites: `npx jest estimator --listTests`)

**Constraint:** `EstimatorRun.location` persists `"COSP"` in the DB. Renaming the enum without input normalization breaks reads of old runs.

- [ ] **Step 1: Tests first:** service-area returns `"PBLO"` for zips 80800–81199; validation accepts legacy `"COSP"` input and normalizes to `"PBLO"`. Run → FAIL.
- [ ] **Step 2: Implement:** `Location` union `"COSP"` → `"PBLO"`. Zod: `z.enum([..., "PBLO"])` with a `z.preprocess` (or `.transform` on a union including `"COSP"`) that maps `"COSP"` → `"PBLO"` so stored runs and in-flight clients keep working. `service-area.ts`: `z >= 80800 && z <= 81199 → "PBLO"`.
- [ ] **Step 3:** Run estimator suites → PASS; `npx tsc --noEmit`. **Step 4: Commit** `feat(estimator): PBLO location code with COSP legacy normalization`

## Chunk 3: Surfaces

### Task 7: AI prompt cluster

**Files (all Modify):** `src/lib/chat-tools.ts`, `src/lib/ai.ts`, `src/lib/ai-nl-fallback.ts`, `src/lib/tech-ops-bot.ts`, `src/lib/tech-ops-bot-proactive.ts`, `src/lib/tech-ops-bot-tools.ts`, `src/app/api/chat/route.ts`, `src/app/api/territory-map/analyze/route.ts`

Uniform phrasing so the models still understand legacy user input: `Pueblo (PBLO; formerly Colorado Springs/COSP)` on first mention in each prompt, bare `Pueblo` thereafter. Territory-analyze prompt keeps the 2:2:1 ratio text with `Pueblo (south)`.

- [ ] Edits → `npx tsc --noEmit` → **Commit** `feat(locations): pueblo in AI prompts and bot tools`

### Task 8: UI label sweep

**Files (all Modify — display strings only, no logic):**
`src/app/dashboards/qc/page.tsx`, `de-overview`, `survey-metrics`, `site-survey-scheduler/page.tsx` + `my-availability.tsx`, `service-scheduler`, `roofing-scheduler`, `inspection-scheduler`, `inspection-metrics`, `dnr-scheduler`, `construction-metrics`, `inventory`, `design-engineering`, `payment-tracking/DealSection.tsx` (`"CSP"` → `"PBLO"`), `src/components/pe/DealsTab.tsx:136` (`"CSP"` → `"PBLO"`), `idr-meeting/SessionHeader.tsx` + `ProjectQueue.tsx` (sort-weight key), `office-performance/[location]/AllLocations{Goals,Category,Calendar}Section.tsx` (`"COS"` → `"PBLO"`), `src/app/suites/operations/page.tsx` + `src/app/suites/executive/page.tsx` (href → `/dashboards/office-performance/pueblo`, label → `Pueblo`), `src/app/triage/page.tsx`, `src/app/admin/crew-availability/page.tsx`, `src/app/admin/users/_UserDetailDrawer.tsx`, `src/app/guide/page.tsx`, `src/app/dashboards/territory-map/TerritoryMapView.tsx` + `territory-map/page.tsx` (labels + `assignTerritory` return `"Pueblo"`; coords unchanged per decision 1).

- [ ] **Step 1:** Sweep edits. **Step 2 (verification gate):**

```bash
rg -n 'Colorado Springs|COSP|CO Spr|CO Spgs|"CSP"|"COS"' src/ \
  --glob '!**/ec-qualifying-zips.ts' --glob '!**/__tests__/**' --glob '!**/generated/**'
```

Expected remnants ONLY: alias strings (`"cosp"`, `"colorado springs"`, `"co springs"` in matchers/normalizers), "formerly Colorado Springs/COSP" prompt phrasing, the pending-address comment + `752 Clark Pl` line in `map-offices.ts`, `region-cosp` sanitizer token + CSS legacy selector, `"COSP Alpha"`/`cosp alpha` legacy matcher strings, `"Colorado Springs Utilities"`, estimator `"COSP"` legacy normalization, historical `product-updates.ts` entries, `GOOGLE_INSTALL_CALENDAR_COSP_ID` env fallback, legacy alias keys in scheduler-v2/create-zuper-job Records. Anything else = missed edit.

Comment-only stale references must also be updated in this task (cheap, keeps the gate clean): `src/lib/permit-hub.ts:493`, `src/lib/pi-hub/detail.ts:146`, `src/lib/scheduler-v2/buildScheduleBody.ts:109`, `src/lib/scheduler-v2/conflicts.ts:42`, `src/lib/map-types.ts:44`, comment in `src/app/api/zuper/availability/route.ts:115`.

- [ ] **Step 3:** `npx tsc --noEmit` → **Commit** `feat(locations): pueblo UI labels across dashboards`

### Task 9: Seeds + served static content

**Files (all Modify):** `public/sop-guide.html` (region banner text, `.region-cosp` → add `.region-pblo` CSS rule keeping the old class as an alias selector, "🏔 Colorado Springs:" → "🏔 Pueblo:"), `src/app/sop/sop-content.css:1037–1049` (add `.region-pblo` rule with `content: "🏔 Pueblo: "`; keep `.region-cosp` for legacy stored SOP content), `scripts/seed-sop-scheduling.ts`, `scripts/seed-sop-drafts.ts` (calendar references; DO NOT touch the `CSU (Colorado Springs Utilities)` row), `scripts/seed-sop-reference.ts`, `scripts/seed-on-call-pools.ts` (`region: "Colorado — Pueblo + Service"`), `prisma/seed-goals.ts` (`location: "Pueblo"`), `prisma/schema.prisma` (comment examples only — NO schema/model changes, NO migration files), `scripts/compliance-shadow-compare.ts:17` + `scripts/snapshot-compliance-baseline.ts:17` (LOCATIONS list entry → `"Pueblo"`), `scripts/backfill-so-warehouses.ts:23` (key → `"Pueblo"`, keep legacy alias key, same warehouse ID).

- [ ] Edits → re-run gate grep from Task 8 (now also over `public/sop-guide.html`, `scripts/seed-*`, `prisma/`) → `npx tsc --noEmit` → **Commit** `feat(locations): pueblo in seeds and served SOP guide`

## Chunk 4: Data migration + verification

### Task 10: DB data-migration script (write only — NEVER execute)

**Files:**
- Create: `scripts/migrate-cosp-to-pueblo.ts`

Follows the repo's existing script conventions (see `scripts/backfill-so-warehouses.ts` for the pattern: tsx script, `--apply` flag, dry-run default, per-table counts). Updates, in one transaction per table, `"Colorado Springs"` → `"Pueblo"`:

| Table.column | Note |
|---|---|
| `ActivityLog.pbLocation`, `BookedSlot.location`, `CrewAvailability.location` + `.reportLocation`, `AvailabilityChangeRequest.location`, `InventoryStock.location`, `SurveyInvite.pbLocation`, `OfficeGoal.location`, `Deal.pbLocation`, `DealStatusSnapshot.pbLocation`, `ComplianceScoreShadow.location`, `GoalsDigestSnapshot.location`, `ZuperStatusDrift.pbLocation`, `ShopHealthBottleneck.location`, `HubSpotProjectCache.pbLocation`, `HubSpotPropertyCache.pbLocation` | direct string equality update |
| `User.allowedLocations`, `CrewMember.locations` | String[] — array element replace |
| `EstimatorRun.location` | `"COSP"` → `"PBLO"` |
| `CrewAvailability.location` legacy variants | also match `"COSP"`, `"CO Springs"` (schema comment shows mixed historical values) |

Dry-run prints would-change counts per column. `--apply` executes and prints updated counts.

- [x] **Step 1:** Write script. **Step 2:** `npx tsc --noEmit` (script type-checks). **Step 3:** Run DRY-RUN ONLY (`npx tsx scripts/migrate-cosp-to-pueblo.ts`) and record counts in the PR body. Do NOT pass `--apply` — Zach runs that after merge. **Step 4: Commit** `feat(locations): add cosp→pueblo data migration script (dry-run verified)`

**Dry-run results (2026-07-20, prod Neon, read-only):**

| Table.column | Would change |
|---|---|
| ActivityLog.pbLocation | 14 |
| BookedSlot.location | 0 |
| CrewAvailability.location (incl. COSP / CO Springs variants) | 5 |
| CrewAvailability.reportLocation (incl. COSP / CO Springs variants) | 5 |
| AvailabilityChangeRequest.location | 3 |
| InventoryStock.location | 0 |
| SurveyInvite.pbLocation | 14 |
| OfficeGoal.location | 63 |
| Deal.pbLocation | 0 |
| DealStatusSnapshot.pbLocation | 2701 |
| ComplianceScoreShadow.location | 0 |
| GoalsDigestSnapshot.location | 11 |
| ZuperStatusDrift.pbLocation | 51 |
| ShopHealthBottleneck.location | 0 |
| HubSpotProjectCache.pbLocation | 0 |
| HubSpotPropertyCache.pbLocation | 1395 |
| User.allowedLocations (array element) | 1 |
| CrewMember.locations (array element) | 4 |
| AdderShopOverride.shop | 0 |
| RevenueGoal.groupKey ("colorado_springs" → "pueblo") | 12 |
| EstimatorRun.location ("COSP" → "PBLO") | 0 |
| **Total** | **4279** |

### Task 11: Test sweep + full verification

**Files:** every failing suite introduced by Tasks 1–10 that wasn't already updated, likely: `src/__tests__/schedule-optimizer.test.ts` (26 refs), `src/__tests__/lib/service-priority.test.ts`, `src/__tests__/flow-*` equivalents, `compliance-compute.test.ts`, `office-performance-types.test.ts`, `zuper-property-sync.test.ts`, `eagleview-pipeline.test.ts`, others surfaced by the run.

Test-update rule: expectations of canonical *outputs* become `Pueblo`/`PBLO`/`pblo`; test *inputs* exercising legacy-alias handling keep their legacy strings (that coverage is now load-bearing).

- [ ] **Step 1:** `npm test 2>&1 | grep '^FAIL' | sort -u` → diff against `baseline-failures.txt`. Fix until the diff is empty (no new failures).
- [ ] **Step 2:** `npx tsc --noEmit` clean. `npm run lint` clean for changed files.
- [ ] **Step 3:** Re-run the Task 8 gate grep one final time across `src/ public/ scripts/ prisma/ .env.example` with `--glob '!**/_archive/**' --glob '!**/prototypes/**'` and excluding analysis artifacts (`scripts/4x10-*`, `scripts/classify-sos.ts`, `scripts/fetch-ops-sos.ts`, `scripts/test-goals-digest.ts`, `scripts/generate-dev-guide.cjs`, `scripts/*.json`, `scripts/*.csv`, `scripts/*.html`).
- [ ] **Step 4: Commit** `test: update location expectations for pueblo rename`

### Task 12: Review + PR

- [ ] **Step 1:** Dispatch `pb-code-reviewer` on the branch diff; fix findings.
- [ ] **Step 2:** PR to `main` titled `feat: rename Colorado Springs office to Pueblo (app code)`. Body must include: scope summary, the alias/back-compat strategy, dry-run counts from Task 10, the HUMAN ACTION list below.

**HUMAN ACTION REQUIRED (PR body + handoff):**
1. Run `npx tsx scripts/migrate-cosp-to-pueblo.ts --apply` against prod after merge (Zach only).
2. Verify Zoho warehouse `5385454000000114101` display name (API was unreachable during planning; alias map covers both names either way).
3. When the physical office address is final: update `map-offices.ts` coords/address + HubSpot Location record city/zip (still `Colorado Springs, 80915`).
4. Optionally rename the Zuper crew "COSP Alpha" → "Pueblo Alpha" in Zuper; matchers accept both.
5. HubSpot workflows (26) and reports (467) are a separate workstream, already scoped.
