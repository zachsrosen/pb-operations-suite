# PM Accountability Tracker — Design Spec

**Date:** 2026-04-28
**Status:** Draft (pre-review)
**Author:** Zach Rosen
**Audience (initial):** Zach only — expand later

---

## Background & motivation

The Project Management team's position is under scrutiny from ownership and HR. The narrative against the role, in priority order:

1. **"Automations could do this"** — suspicion that HubSpot workflows + scheduling automations + the existing PB Ops Suite tooling already cover what PMs do, so the role is redundant
2. **"Deals don't move faster with them"** — cycle times, on-time install rates, and other deal-throughput signals don't appear better in PM-touched deals
3. **"They're not accountable for anything specific"** — fuzzy ownership of outcomes; no one can point to what a PM is supposed to deliver

The goal of this product is **not** to rank PMs against each other or to surface activity volume. It is to produce **evidence** that either justifies the role's existence or, if the data doesn't support the role, gives ownership a defensible basis to act. Activity-volume dashboards (calls made, emails sent, tasks completed) make a busy person look busy — they don't justify the role and would be a wasted product.

The PM team consists of four people, attributed via the existing HubSpot `project_manager` string property: **Natasha, Alexis, Kaitlyn, Katlyyn**. The `Kaitlyn` / `Katlyyn` spelling is unresolved (typo or two distinct people) — the design must handle name normalization.

PB has no clean before/after baseline (PMs have always existed at PB), so anti-narrative-#2 cannot rely on population-level cycle-time deltas. The argument must rest on **detected "saves"** (deals that hit a documented at-risk state and were rescued by a PM intervention) rather than aggregate throughput comparison.

PMs at PB own pre-construction outcomes, not the install calendar. Their declared responsibilities (per leadership):

- **B — Customer engagement during the wait:** keep customers informed across the 60-120 day pre-install window; no ghost periods
- **D — Pre-install readiness gate:** every install starts with permit, equipment, BOM, and customer confirmation in hand
- **E — Stage hygiene:** HubSpot deal data accurate, complete, and current
- **F — Stalled-deal rescue:** stuck deals get unstuck
- **G — Customer satisfaction:** reviews, complaints, escalations on portfolio

Sale-to-install cycle time, scheduling coordination, and issue triage / escalation were considered and excluded from PM scope by leadership.

## Goals

- Produce a **defensible** answer to "does the PM role justify itself" using existing data, not self-reporting
- Make PM responsibilities **legible and tracked** (anti-narrative-#3)
- Quantify **PM-unique contributions** via the saves detector (anti-narratives-#1 and #2)
- Stay within the existing PB Ops Suite tech stack — Next.js 16 / Prisma / Tailwind / React Query / SSE / HubSpot wrappers
- Tunable thresholds — exact policy values (14d ghost, 14d stuck, etc.) will be adjusted post-rollout, so threshold values must be config-driven rather than hardcoded

## Non-goals

- Activity-volume dashboards (calls/emails/tasks counted as raw totals)
- Ranking / leaderboards as the primary frame
- PM self-reported intervention logs
- Surfacing the dashboard to PMs themselves in v1
- Industry-benchmark comparisons (no reliable solar-PM industry data)
- Modifying any HubSpot property or workflow

## Audience & access

**Initial rollout:** Zach (`zach@photonbrothers.com`) only, regardless of role.

Expansion path is a config constant `PM_TRACKER_AUDIENCE` — a list of email addresses with read access. Adding ownership / HR / PMs themselves is a one-line config change once data quality is validated.

Access enforced at three layers:
1. Middleware route allowlist (`ADMIN` role gate via `roles.ts`)
2. Page-level email check against `PM_TRACKER_AUDIENCE`
3. API route email check against `PM_TRACKER_AUDIENCE`

## Phased rollout

| Phase | Scope | Build time |
|---|---|---|
| **Phase 1** | Metrics dashboard + weekly digest, no saves detection | ~1 week |
| **Phase 2** | Saves detector with confidence scoring | ~1-2 weeks after Phase 1 |
| **Phase 3** *(optional)* | ROI calculator (saves × $-impact estimate) | ~2 days, only if requested |

Each phase ships behind a feature flag, gated to Zach for QA before any audience change.

## Architecture

### Data sources (all existing)

- **`HubSpotProjectCache`** — deal stage, dates, `projectManager` string, location, amount, address, system size
- **`ActivityLog`** — captures scheduling actions, dashboard usage, deal views per `userId`. Joined to `User` to filter by PMs (matched by name)
- **HubSpot engagements API** — emails / calls / notes / meetings per deal. Wrapped by `getContactLatestEngagement` (already exists from prior work). New deal-scoped variant required: `getDealEngagements(dealId, options)` with direction/type filters
- **`HubSpotProjectCache`** dealstage history — sampled via HubSpot's `hs_date_entered_<stage>` properties already on each deal. Avoids a new `DealStageHistory` table
- **`SERVICE_TICKETS` cache** — for complaint and escalation metrics
- **`FIVE_STAR_REVIEWS` cache** — for CSAT
- **`ZuperJobCache`** — for install-day readiness checks
- **`BomHubSpotPushLog`** — to verify BOM has been pushed for upcoming installs

### New DB models (Prisma)

```prisma
model PMSnapshot {
  id              String   @id @default(cuid())
  pmName          String   // canonical (post-normalization)
  periodStart     DateTime
  periodEnd       DateTime
  // Phase 1 metrics (raw values; UI computes display formatting)
  ghostRate                Float
  medianDaysSinceLastTouch Float
  touchFrequency30d        Float
  readinessScore           Float
  dayOfFailures90d         Int
  fieldPopulationScore     Float
  staleDataCount           Int
  stuckCountNow            Int
  medianTimeToUnstick90d   Float
  recoveryRate90d          Float
  reviewRate               Float
  avgReviewScore           Float
  complaintRatePer100      Float
  // Phase 2 (nullable until Phase 2 lands)
  savesHigh   Int?
  savesMedium Int?
  savesLow    Int?
  daysSavedEstimate Float?
  computedAt  DateTime @default(now())

  @@unique([pmName, periodStart, periodEnd])
  @@index([pmName, periodEnd])
}

model PMSave {
  id                  String   @id @default(cuid())
  hubspotDealId       String
  pmName              String   // canonical
  atRiskTriggeredAt   DateTime
  atRiskReason        String   // "STUCK" | "GHOSTED" | "PERMIT_OVERDUE" | "READINESS_GAP" | "ESCALATION"
  interventionAt      DateTime?
  interventionType    String?  // "ENGAGEMENT" | "PROPERTY_UPDATE" | "TASK_CREATED" | "DASHBOARD_ACTION"
  interventionUserId  String?  // FK to User; null if not in our audit log
  resolvedAt          DateTime?
  resolutionType      String?  // "STAGE_CHANGED" | "ENGAGEMENT_LOGGED" | "PERMIT_APPROVED" | "INSTALL_COMPLETED" | "TICKET_RESOLVED"
  daysSavedEstimate   Float?
  confidence          String   // "HIGH" | "MEDIUM" | "LOW"
  workflowAttribution Boolean  @default(false) // true if a HubSpot workflow likely caused resolution
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@unique([hubspotDealId, atRiskTriggeredAt, atRiskReason])
  @@index([pmName, resolvedAt])
  @@index([resolvedAt])
}
```

### New library modules

```
src/lib/pm-tracker/
├── owners.ts            # PM_NAMES + normalization (handles Kaitlyn/Katlyyn)
├── thresholds.ts        # Tunable policy values (14d ghost, 14d stuck, etc.)
├── audience.ts          # PM_TRACKER_AUDIENCE allowlist + check helper
├── metrics/
│   ├── engagement.ts    # B
│   ├── readiness.ts     # D
│   ├── hygiene.ts       # E
│   ├── rescue.ts        # F
│   └── csat.ts          # G
├── saves/               # Phase 2
│   ├── triggers.ts      # at-risk detection
│   ├── interventions.ts # PM action detection
│   ├── resolutions.ts   # exit-from-at-risk detection
│   └── scoring.ts       # confidence + days-saved
└── snapshot.ts          # nightly compute → PMSnapshot writer
```

### New API routes

| Route | Purpose | Cache key | TTL |
|---|---|---|---|
| `GET /api/pm/scorecard?pm=<name>&period=<30d\|90d\|365d>` | Per-PM metrics | `pm:scorecard:<name>:<period>` | 15min |
| `GET /api/pm/team-summary?period=<period>` | Team aggregate | `pm:team-summary:<period>` | 15min |
| `GET /api/pm/at-risk?pm=<name>` | Currently-at-risk deals on PM portfolio | `pm:at-risk:<name>` | 15min |
| `GET /api/pm/saves?pm=<name>&period=<period>` | Saves list (Phase 2) | `pm:saves:<name>:<period>` | 15min |
| `GET /api/cron/pm-snapshot` | Nightly snapshot rebuild | n/a | n/a |
| `GET /api/cron/pm-weekly-digest` | Monday 8am MT digest | n/a | n/a |

All API routes added to `roles.ts` ADMIN allowlist (per project memory rule: new `/api/*` paths must be allowlisted or middleware silently 403s). Plus the `audience.ts` email-check layer on top.

Cache cascade: `pm:*` keys invalidate when `deals:*`, `service-tickets:*`, or `five-star-reviews:*` invalidate (subscribe via `appCache.subscribe`).

### Cron schedule

- **`/api/cron/pm-snapshot`** — runs nightly at 02:00 MT. Recomputes 30d / 90d / 365d windows for each PM. Writes `PMSnapshot` rows with `(pmName, periodEnd-day-truncated)` upsert
- **`/api/cron/pm-weekly-digest`** — runs Mondays at 08:00 MT. Reads latest snapshot, emails `PM_TRACKER_AUDIENCE`

### Dashboard surface

Route: `/dashboards/pm-accountability`
Suite: Executive (with link from Admin)
Shell: `<DashboardShell title="PM Accountability" accentColor="purple" />`

**Layout:**
1. **Top: team comparison table.** PMs as columns, metrics as rows. Color-coded green/yellow/red against thresholds in `thresholds.ts`. Sortable.
2. **Tabs per PM** — drill-in scorecard:
   - Top KPI strip (the 5 responsibility headlines)
   - Ghosted deals list (clickable to HubSpot)
   - Stuck deals list
   - Readiness-gap upcoming installs
   - Stale-data deals (data hygiene)
   - Reviews + complaints feed
3. **Trend section** — 90-day rolling line chart per metric. One chart per metric, all PMs overlaid.
4. **Phase 2 — Saves panel** (added to per-PM tab):
   - Headline: `<count> saves this <period> (HIGH: <n>, MED: <n>, LOW: <n>)`
   - Estimated days-saved aggregate
   - Filterable list — deal link, at-risk reason, intervention timeline, resolution
5. **Phase 3 — ROI block** (toggle, default off): `<saves> × <avg deal $> × <delay-cost%> × <days saved> ≈ $<value> protected`

Live updates via existing SSE infrastructure (`useSSE` with `cacheKeyFilter: "pm:"`).

### Weekly digest email

Template: `src/emails/PMWeeklyDigest.tsx` (React Email)

Content:
- Headline: per-PM week-over-week deltas on 5 metrics
- Watch list — at-risk deals by PM (link to dashboard)
- Phase 2: top 5 new saves of the week as narrative ("Natasha unstuck deal #1234 after 18 days in Permitting; install on time")
- Footer: link to dashboard

Sent via the existing dual-provider email system (Google Workspace primary, Resend fallback).

## Phase 1 metric definitions

All metrics are computed per PM, scoped to deals where `projectManager` matches a normalized PM name.

### B — Customer engagement *(scope: pre-install deals)*

- `ghostRate` = count(portfolio deals with no outbound engagement in last `THRESHOLDS.ghostDays`) / count(portfolio deals)
- `medianDaysSinceLastTouch` = median(days since last outbound engagement) across portfolio
- `touchFrequency30d` = total outbound engagements in last 30d / count(portfolio deals)

"Outbound engagement" = HubSpot engagement of type email/call/meeting where `direction === "OUTGOING"` (or equivalent), associated to a deal contact. Notes are excluded from engagement count (they're not customer-facing).

### D — Pre-install readiness *(scope: deals with `install_date` in next 14d)*

- `readinessScore` = count(upcoming installs where all 4 boxes ticked) / count(upcoming installs)
  - Box 1: permit obtained — `permit_status === "approved"` or equivalent
  - Box 2: equipment delivered — Zoho SO line items received OR `equipment_delivered === true`
  - Box 3: BOM pushed — `BomHubSpotPushLog` has SUCCESS row for deal in last 30d
  - Box 4: customer install-confirmation — outbound engagement of type call/meeting in last 7d, OR `install_confirmation_sent === true`
- `dayOfFailures90d` = count of installs in last 90d that were rescheduled within 48h of scheduled date due to readiness gap
  - Reschedule reason inferred from Zuper job updates + reschedule reason field; if reason is null, only counts if dealstage moved backward in same window

### E — Stage hygiene *(scope: all PM-owned active deals)*

- `fieldPopulationScore` = avg(% of required fields filled) across portfolio
  - Required fields: `closedate`, `install_date` (if past DA), `system_size_kw`, `project_type`, `address_line_1`, `project_manager`
- `staleDataCount` = count of deals where ANY of:
  - `closedate` is in the past AND dealstage is not closed
  - `install_date` is more than 30 days past AND no `INSTALL_COMPLETED` activity log

### F — Stalled-deal rescue *(scope: PM-owned active deals)*

- `stuckCountNow` = count(deals where `(now - hs_date_entered_<current_stage>) > THRESHOLDS.stuckDays` AND not in terminal stage)
- `medianTimeToUnstick90d` = median(days between stuck-trigger fire and next stage change) across deals that hit stuck and resolved in last 90d
- `recoveryRate90d` = count(deals that hit stuck-trigger in last 90d AND moved within 30d) / count(deals that hit stuck-trigger in last 90d)

### G — Customer satisfaction *(scope: deals at `INSTALLED` or later)*

- `reviewRate` = count(installed deals with a Google review collected) / count(installed deals)
- `avgReviewScore` = mean(stars) on portfolio reviews
- `complaintRatePer100` = count(service tickets opened on portfolio in last 90d) × 100 / count(installed deals on portfolio)

## Phase 2 saves detector

### Pipeline (runs nightly inside `/api/cron/pm-snapshot`)

For each active PM-owned deal:

1. **Trigger detection** — evaluate the 5 at-risk conditions against current state. If any condition is true and there is no open `PMSave` row for `(dealId, atRiskReason)`, create a new `PMSave` row with `atRiskTriggeredAt = now`
2. **Intervention detection** — for each open `PMSave` (atRiskTriggeredAt set, resolvedAt null), check whether a PM intervention has occurred since `atRiskTriggeredAt`:
   - HubSpot engagement logged on the deal by a user matching `pmName`
   - HubSpot property mutation on the deal (stage / dates / notes)
   - HubSpot task created
   - `ActivityLog` row from a `User` whose name canonicalizes to `pmName`, on this deal
   - If intervention found: set `interventionAt`, `interventionType`, `interventionUserId`
3. **Resolution detection** — check whether the at-risk condition is no longer true:
   - STUCK → dealstage changed
   - GHOSTED → outbound engagement happened
   - PERMIT_OVERDUE → permit approved
   - READINESS_GAP → all 4 boxes ticked OR install completed
   - ESCALATION → all related tickets closed
   - If resolved: set `resolvedAt`, `resolutionType`
4. **Confidence scoring** — once `resolvedAt` is set, compute `confidence` and `daysSavedEstimate`:

| Tier | Pattern | Days-saved estimate |
|---|---|---|
| HIGH | atRisk → intervention <72h → resolution <14d AND no workflow attribution | (resolvedAt - atRiskTriggeredAt) × 0.7 |
| MEDIUM | atRisk → intervention <7d → resolution <30d AND no workflow attribution | × 0.4 |
| LOW | resolution happened, intervention ambiguous OR workflow attribution detected | × 0.2 |

5. **Workflow attribution check** — if a HubSpot workflow likely caused resolution, set `workflowAttribution = true` and force confidence to LOW. Detection heuristic: stage change occurred without a corresponding ActivityLog row for any user, OR engagement was sent by a service-account user.

### At-risk trigger definitions

| Trigger | Condition | Notes |
|---|---|---|
| `STUCK` | `(now - hs_date_entered_<current_stage>) > THRESHOLDS.stuckDays` AND deal not in terminal stage | Excludes deals waiting on customer (e.g. "Awaiting Customer Decision" stage) |
| `GHOSTED` | No outbound engagement on deal in last `THRESHOLDS.ghostDays` AND deal in pre-install AND not in customer-blocked stage | Outbound only — receiving a customer email doesn't count |
| `PERMIT_OVERDUE` | `permit_submission_date < now - THRESHOLDS.permitSlaDays(ahj)` AND `permit_status !== "approved"` | SLA varies by AHJ; needs lookup table or default |
| `READINESS_GAP` | `(install_date - now) < 7 days` AND any of 4 readiness boxes unchecked | Same 4 boxes as the readinessScore metric |
| `ESCALATION` | New service ticket on portfolio with `priority IN ("HIGH", "URGENT")` | One save credit per ticket |

### Intervention attribution

A save is credited to the PM only if:
- Intervention came from a user whose name canonicalizes to the deal's current `project_manager`
- That user has `User.roles` including `PROJECT_MANAGER`
- Intervention occurred between `atRiskTriggeredAt` and `resolvedAt`

If the intervention was done by a different user (designer, sales, OpsManager, automation), the save still gets recorded but with `pmName = null` and `confidence = LOW` — these are for system-level saves analysis, not credited to any PM.

### False-positive guards

- **Workflow attribution:** if a HubSpot workflow likely caused the stage change → confidence drops to LOW
- **Cross-attribution:** if a non-PM user did the intervention → no PM credit, save logged as system-level
- **No double-counting:** unique constraint on `(dealId, atRiskTriggeredAt, atRiskReason)` prevents the same trigger event creating multiple saves
- **Idle re-trigger debounce:** if a deal exits at-risk and re-enters within `THRESHOLDS.saveDebounceDays` (default 30), it does not create a new save

## Name normalization

`src/lib/pm-tracker/owners.ts`:

```ts
export const PM_NAMES = ["Natasha", "Alexis", "Kaitlyn", "Katlyyn"] as const;

// Maps any spelling variant → canonical name.
// Confirm with leadership whether Kaitlyn and Katlyyn are the same person.
const ALIAS_MAP: Record<string, string> = {
  "kaitlyn": "Kaitlyn",
  "katlyyn": "Kaitlyn",  // assume typo — flag for confirmation
  "katelyn": "Kaitlyn",
  "katelynn": "Kaitlyn",
  "natasha": "Natasha",
  "alexis": "Alexis",
};

export function normalizePmName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return ALIAS_MAP[key] ?? null;
}
```

**Open question:** confirm with leadership whether `Kaitlyn` and `Katlyyn` are one person or two. If two, split the alias map. Until confirmed, the design assumes one person and merges them.

## Thresholds (config-driven)

`src/lib/pm-tracker/thresholds.ts`:

```ts
export const THRESHOLDS = {
  ghostDays: 14,           // B
  stuckDays: 14,           // F
  dayOfFailureHours: 48,   // D
  permitSlaDays: 30,       // default; overridable per AHJ
  saveDebounceDays: 30,    // F2 false-positive guard
  // Color bands for table cell coloring
  bands: {
    ghostRate: { green: 0.05, yellow: 0.15 },         // <5% green, <15% yellow, else red
    readinessScore: { green: 0.95, yellow: 0.85 },
    fieldPopulationScore: { green: 0.95, yellow: 0.85 },
    recoveryRate90d: { green: 0.80, yellow: 0.60 },
    reviewRate: { green: 0.40, yellow: 0.25 },
  },
} as const;
```

All values are starting guesses. Per leadership: "we will adjust later when it's set up." Spec assumes thresholds.ts is the single source of truth and gets tuned during Phase 1 rollout.

## Caching

- All `pm:*` cache keys: 15-min TTL, 30-min stale window (existing `appCache` defaults)
- Cascade subscriptions: invalidate `pm:*` when `deals:*`, `service-tickets:*`, or `five-star-reviews:*` invalidate (debounced 500ms)
- Snapshot rows are the canonical persistence; cache is read-through

## Error handling

- API routes: 401 if not authenticated, 403 if email not in `PM_TRACKER_AUDIENCE` even with ADMIN role, 500 wrapped in Sentry
- Cron jobs: idempotent — re-running a snapshot for a date that already has a row should overwrite, not duplicate (upsert with `(pmName, periodEnd-truncated)` unique key)
- Saves detector: failures on individual deals logged to Sentry but do not abort the batch — one bad deal must not lose the night's data
- Email digest: send failure logs to Sentry; no retry (next Monday will catch up)

## Testing

Unit tests live in `src/__tests__/lib/pm-tracker/`:
- One test file per metric module — known-input → expected-output assertions, mocking the cache row shapes
- Saves detector — full pipeline test with synthetic at-risk → intervention → resolution sequences across HIGH/MED/LOW patterns
- Name normalizer — every alias resolves correctly
- Audience check — only emails in `PM_TRACKER_AUDIENCE` pass

Integration: a single end-to-end test that seeds 4 PMs × 5 deals with known stuck/ghosted/healthy mix, runs the snapshot job, asserts the resulting `PMSnapshot` row matches expected metrics.

## Risks & open questions

1. **Kaitlyn/Katlyyn ambiguity** — design assumes one person, may be two. Need to confirm.
2. **Permit SLA per AHJ** — design uses 30-day default. Real SLAs vary 14-90 days by AHJ. May need an `AhjPermitSla` cache table — out of scope for v1; flagged as Phase 2 polish.
3. **Workflow attribution detection** — heuristic-based. Will produce false positives (PM intervention misclassified as workflow) and false negatives (workflow misclassified as PM intervention). Plan: log all intervention sources in `PMSave.interventionType` raw, manual review of edge cases during Phase 2 tuning.
4. **HubSpot engagement direction filter** — outbound vs inbound is reliable for emails, partial for calls (depends on logger). Need to verify field availability before relying on `direction === "OUTGOING"`. May need to fall back to "any engagement" for calls and document the looser semantic.
5. **Threshold values are guesses** — explicitly. The product needs Zach-only Phase 1 rollout to calibrate before broader audience.
6. **No before/after baseline** — by design. Anti-narrative-#2 rests entirely on saves count, not throughput delta. If saves count is low, the data may not defend the role — that itself is a useful finding.

## Out of scope (for explicit non-confusion)

- Modifying any HubSpot property, workflow, or pipeline
- A PM-facing self-service log
- Cross-PM ranking as the primary frame (comparison table is descriptive, not normative)
- Industry benchmarks
- Sales / Permit / Design / Operations performance tracking — this is PM-only
- Modifying the existing `/dashboards/project-management` page (different surface, different audience)

## Implementation order *(plan-skill input)*

Suggested commit / PR sequence:

1. Schema migration + `PMSnapshot` model (no app code yet)
2. `pm-tracker` lib skeleton — `owners.ts`, `thresholds.ts`, `audience.ts`
3. Each metric module + unit tests (5 small PRs or one combined)
4. `/api/pm/scorecard` + `/api/pm/team-summary` + role allowlist + audience gate
5. Dashboard page (skeleton, then per-PM tabs, then trend section)
6. `/api/cron/pm-snapshot` cron + nightly snapshot writes
7. `PMWeeklyDigest.tsx` email template + `/api/cron/pm-weekly-digest`
8. **Phase 1 ship behind flag — Zach-only QA**
9. Phase 2: `PMSave` schema + saves detector pipeline + dashboard saves panel
10. Phase 3 (optional): ROI calculator toggle

Each PR includes the role-allowlist update for any new `/api/*` routes (per project memory rule).
