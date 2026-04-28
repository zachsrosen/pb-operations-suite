# PM Accountability Tracker — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. Phase 2 (saves detector) is deferred to a follow-up plan.

**Goal:** Ship the metrics dashboard + weekly digest for PM accountability tracking. Audience: Zach only (`PM_TRACKER_AUDIENCE` config). Phase 2 saves detector deferred.

**Architecture:** Nightly cron computes per-PM metrics from `Deal` cache + HubSpot engagements + service tickets + 5-star reviews; persists to `PMSnapshot`. Dashboard reads snapshots through cached API routes. Monday digest emails the audience.

**Tech Stack:** Next.js 16 App Router, Prisma 7, Tailwind v4, React Query v5, React Email, existing dual-provider email (Google Workspace + Resend), existing `appCache`, existing HubSpot wrappers.

**Spec:** `docs/superpowers/specs/2026-04-28-pm-accountability-tracker-design.md`

---

## Property mapping (verified — Appendix A resolved)

| Spec field | Real source | Notes |
|---|---|---|
| `project_manager` | `Deal.projectManager` | string, populated from HubSpot |
| `closedate` | `Deal.closeDate` | DateTime |
| `install_date` | `Deal.installScheduleDate` | DateTime |
| `system_size_kw` | `Deal.systemSizeKwdc` | Decimal |
| `address_line_1` | `Deal.address` | single field |
| `permit_status` (D box 1) | `Deal.isPermitIssued` | boolean |
| `permit_submission_date` | `Deal.permitSubmitDate` | DateTime |
| `install_completed` | `Deal.constructionCompleteDate IS NOT NULL` | derived |
| `dealstage` | `Deal.stage` (label) + `Deal.stageId` (raw) | both available |
| `hs_date_entered_<stage>` | `Deal.rawProperties.hs_date_entered_<stageId>` | from cached JSON, no extra API calls |
| `hs_updated_by_user_id` | `Deal.rawProperties.hs_updated_by_user_id` | from cached JSON |
| service tickets | `HubSpotProjectCache` is unused; service tickets fetched via `lib/hubspot-tickets.ts` (existing) | |
| reviews | existing `FIVE_STAR_REVIEWS` cache | |
| equipment delivered | **no source — drop from D readiness checklist; reduces D to 3 boxes** | acceptable degradation; flagged in spec risks |
| install_confirmation_sent | **no source — rely on engagement-only signal** | |
| project_type | not on `Deal`; **drop from E required-fields list** | |

**Required-fields list for metric E (revised):** `closeDate`, `installScheduleDate`, `systemSizeKwdc`, `address`, `projectManager` (5 fields, was 6).

**Readiness boxes for metric D (revised):** permit obtained (`isPermitIssued`), BOM pushed (`BomHubSpotPushLog.status === "SUCCESS"` in last 30d), customer install-confirmation (outbound engagement of type `call` or `meeting` in last 7d). Three boxes, was four.

---

## Task 1: Prisma schema — `PMSnapshot` model

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_pm_accountability/migration.sql` (auto-generated)

- [ ] **Add `PMSnapshot` model to schema.prisma** (place near other cache models)

```prisma
model PMSnapshot {
  id          String   @id @default(cuid())
  pmName      String   // canonical (post-normalization)
  periodStart DateTime
  periodEnd   DateTime
  // Phase 1 metrics
  ghostRate                 Float
  medianDaysSinceLastTouch  Float
  touchFrequency30d         Float
  readinessScore            Float
  dayOfFailures90d          Int
  fieldPopulationScore      Float
  staleDataCount            Int
  stuckCountNow             Int
  medianTimeToUnstick90d    Float
  recoveryRate90d           Float
  reviewRate                Float
  avgReviewScore            Float
  complaintRatePer100       Float
  portfolioCount            Int
  // Phase 2 (nullable until added later)
  savesHigh         Int?
  savesMedium       Int?
  savesLow          Int?
  daysSavedEstimate Float?
  computedAt        DateTime @default(now())

  @@unique([pmName, periodStart, periodEnd])
  @@index([pmName, periodEnd])
}
```

- [ ] **Run** `npx prisma migrate dev --name pm_accountability_snapshot`
- [ ] **Verify** `prisma generate` ran (it does as part of dev migration)
- [ ] **Commit:** `feat(pm-tracker): add PMSnapshot model`

---

## Task 2: Library skeleton

**Files:**
- Create: `src/lib/pm-tracker/owners.ts`
- Create: `src/lib/pm-tracker/thresholds.ts`
- Create: `src/lib/pm-tracker/audience.ts`
- Create: `src/lib/pm-tracker/workflow-users.ts` (stub for Phase 2; export empty array now)
- Create: `src/lib/pm-tracker/types.ts`

- [ ] **owners.ts** — name normalization, alias map, canonical name list

```ts
// PM team identity. Update when team changes.
export const PM_NAMES = ["Natasha", "Alexis", "Kaitlyn"] as const;
export type PmName = (typeof PM_NAMES)[number];

// Maps any spelling variant → canonical name.
// FLAG: Kaitlyn/Katlyyn assumed same person; confirm with leadership.
const ALIAS_MAP: Record<string, PmName> = {
  natasha: "Natasha",
  alexis: "Alexis",
  kaitlyn: "Kaitlyn",
  katlyyn: "Kaitlyn", // typo — treat as same person until told otherwise
  katelyn: "Kaitlyn",
  katelynn: "Kaitlyn",
};

export function normalizePmName(raw: string | null | undefined): PmName | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return ALIAS_MAP[key] ?? null;
}

export function isPmName(raw: string | null | undefined): boolean {
  return normalizePmName(raw) !== null;
}
```

- [ ] **thresholds.ts** — all tunable policy values

```ts
export const THRESHOLDS = {
  ghostDays: 14,
  stuckDays: 14,
  dayOfFailureHours: 48,
  permitSlaDays: 30,
  saveDebounceDays: 30,
  customerConfirmationLookbackDays: 7,
  bands: {
    ghostRate: { green: 0.05, yellow: 0.15 },
    readinessScore: { green: 0.95, yellow: 0.85 },
    fieldPopulationScore: { green: 0.95, yellow: 0.85 },
    recoveryRate90d: { green: 0.8, yellow: 0.6 },
    reviewRate: { green: 0.4, yellow: 0.25 },
  },
} as const;

export type ThresholdBand = keyof typeof THRESHOLDS.bands;

// Returns "green" | "yellow" | "red" based on metric value.
// "directionGood" indicates whether higher values are better (true) or worse (false).
export function bandFor(metric: ThresholdBand, value: number): "green" | "yellow" | "red" {
  const cfg = THRESHOLDS.bands[metric];
  // ghostRate: lower is better → invert comparison
  if (metric === "ghostRate") {
    if (value <= cfg.green) return "green";
    if (value <= cfg.yellow) return "yellow";
    return "red";
  }
  if (value >= cfg.green) return "green";
  if (value >= cfg.yellow) return "yellow";
  return "red";
}
```

- [ ] **audience.ts** — allowlist + check helper, ignores impersonation

```ts
import { auth } from "@/auth";

const PM_TRACKER_AUDIENCE: ReadonlyArray<string> = [
  "zach@photonbrothers.com",
  // Add ownership/HR emails here when expanding access.
];

export function isInAudience(email: string | null | undefined): boolean {
  if (!email) return false;
  return PM_TRACKER_AUDIENCE.includes(email.toLowerCase().trim());
}

// Resolves to true ONLY if the actual logged-in user (real email) is in the
// allowlist. Ignores impersonation cookies — sensitive HR data must not be
// accessible via role spoofing.
export async function checkAudienceAccess(): Promise<{
  ok: boolean;
  email: string | null;
}> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase().trim() ?? null;
  return { ok: isInAudience(email), email };
}

export function audienceList(): ReadonlyArray<string> {
  return PM_TRACKER_AUDIENCE;
}
```

- [ ] **workflow-users.ts** — stub list of HubSpot user IDs to attribute as workflow/automation rather than human PM

```ts
// HubSpot user IDs that represent workflows / integrations / service accounts.
// Bootstrap during Phase 2 by querying recent stage-change events for distinct
// hs_updated_by_user_id values, manually flagging non-human actors.
// Empty until Phase 2 lands.
export const WORKFLOW_USER_IDS: ReadonlyArray<string> = [];

export function isWorkflowUser(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return WORKFLOW_USER_IDS.includes(userId);
}
```

- [ ] **types.ts** — shared types for the tracker

```ts
import type { PmName } from "./owners";

export interface PmScorecard {
  pmName: PmName;
  periodStart: string;
  periodEnd: string;
  metrics: {
    // B - engagement
    ghostRate: number;
    medianDaysSinceLastTouch: number;
    touchFrequency30d: number;
    // D - readiness
    readinessScore: number;
    dayOfFailures90d: number;
    // E - hygiene
    fieldPopulationScore: number;
    staleDataCount: number;
    // F - rescue
    stuckCountNow: number;
    medianTimeToUnstick90d: number;
    recoveryRate90d: number;
    // G - csat
    reviewRate: number;
    avgReviewScore: number;
    complaintRatePer100: number;
  };
  portfolioCount: number;
  computedAt: string;
}

export interface TeamSummary {
  scorecards: PmScorecard[];
  periodStart: string;
  periodEnd: string;
}

export interface AtRiskDeal {
  hubspotDealId: string;
  dealName: string;
  pmName: PmName;
  reason: "STUCK" | "GHOSTED" | "PERMIT_OVERDUE" | "READINESS_GAP";
  daysAtRisk: number;
  url: string;
}
```

- [ ] **Commit:** `feat(pm-tracker): library skeleton (owners, thresholds, audience, types)`

---

## Task 3: Deal-scoped engagement helper

**Files:**
- Modify: `src/lib/hubspot-engagements.ts`

The existing module exports `getContactLatestEngagement`. Add a deal-scoped variant for use in metrics computation.

- [ ] **Add `getDealEngagements`** to `hubspot-engagements.ts` — fetch all engagement types associated with a deal, with optional direction/since filter

Key signature:
```ts
export interface DealEngagementOptions {
  since?: Date;          // only return engagements at or after this timestamp
  outboundOnly?: boolean; // for emails/calls, filter to OUTGOING direction
  types?: Array<"email" | "call" | "note" | "meeting">; // default: all
}

export async function getDealEngagements(
  dealId: string,
  options: DealEngagementOptions = {},
): Promise<Engagement[]>
```

Implementation reuses the generalized `fetchAssociatedObjects` helper that's already in the file (was generalized in the prior PR with `fromObjectType` parameter — pass `"deals"`).

- [ ] **Filtering:**
  - `outboundOnly` = true: drop emails where `hs_email_direction !== "EMAIL"` (HubSpot sets this for outbound from PB) and calls where `hs_call_direction !== "OUTBOUND"`. Notes and meetings are always included regardless of `outboundOnly` since they don't have a direction concept (notes are internal, meetings are by nature interactions). For ghost-rate metric we pass `types: ["email", "call", "meeting"]` and `outboundOnly: true`, then post-filter (notes excluded by `types`).
  - `since` filter applied client-side after fetch (HubSpot search complicates dynamic timestamp filters; ~50 engagements per deal per quarter is fine)

- [ ] **Cache key:** `deal-engagements-pm:<dealId>:<sinceISO>` with 30-min TTL via `appCache`

- [ ] **Commit:** `feat(pm-tracker): add getDealEngagements deal-scoped helper`

---

## Task 4: 5 metric modules + unit tests

Each metric module exports a single function `compute<X>ForPM(pmName: PmName): Promise<MetricResult>` plus internal helpers. Tests live in `src/__tests__/lib/pm-tracker/metrics/`.

### 4a. Engagement metric (B)

**Files:**
- Create: `src/lib/pm-tracker/metrics/engagement.ts`
- Create: `src/__tests__/lib/pm-tracker/metrics/engagement.test.ts`

- [ ] **engagement.ts** — computes ghostRate, medianDaysSinceLastTouch, touchFrequency30d

Approach:
1. Query `Deal` rows where `normalizePmName(d.projectManager) === pmName` AND `stage` is pre-install (use `Deal.installScheduleDate IS NULL OR > now`)
2. For each deal, call `getDealEngagements(dealId, { since: 30 days ago, outboundOnly: true, types: ["email","call","meeting"] })`
3. Compute:
   - `ghostRate` = count(deals with no engagement in last `THRESHOLDS.ghostDays`) / portfolioCount
   - `medianDaysSinceLastTouch` = median across portfolio (Infinity → max value 365 for sortability)
   - `touchFrequency30d` = total engagements / portfolioCount

- [ ] **Test:** seed 4 mock deals with known engagement timestamps; assert ghost rate, median, frequency

### 4b. Readiness metric (D)

**Files:**
- Create: `src/lib/pm-tracker/metrics/readiness.ts`
- Create: `src/__tests__/lib/pm-tracker/metrics/readiness.test.ts`

- [ ] **readiness.ts** — readinessScore + dayOfFailures90d

Approach:
1. **Scope:** deals where `installScheduleDate` is in next 14 days
2. For each: check 3 boxes
   - `isPermitIssued === true`
   - BOM pushed: query `BomHubSpotPushLog` for SUCCESS row in last 30 days for `dealId`
   - Customer confirmation: outbound call/meeting engagement in last 7 days
3. `readinessScore` = (deals with all 3 boxes) / (upcoming installs)
4. `dayOfFailures90d`: query `Deal` where `installScheduleDate` was rescheduled within 48h of original date in last 90 days. Detect via raw `Deal.rawProperties.hs_date_entered_<X>` if reschedule timestamps available, otherwise fall back to: any deal where the install date moved by ≥1 day within 48h of the prior scheduled date. Conservative — if attribution is unclear, count.

- [ ] **Test:** seed deals with mix of complete/incomplete readiness; assert score

### 4c. Hygiene metric (E)

**Files:**
- Create: `src/lib/pm-tracker/metrics/hygiene.ts`
- Create: `src/__tests__/lib/pm-tracker/metrics/hygiene.test.ts`

- [ ] **hygiene.ts** — fieldPopulationScore, staleDataCount

Approach:
1. **Scope:** all PM-owned active deals (not in `closedwon`/`closedlost` stage)
2. Required fields: `closeDate`, `installScheduleDate` (only required if past DA stage — `Deal.layoutApprovalDate IS NOT NULL`), `systemSizeKwdc`, `address`, `projectManager`
3. `fieldPopulationScore` = avg(% required fields filled) across portfolio
4. `staleDataCount` = count of deals where:
   - `closeDate < now` AND deal not in closed stage, OR
   - `installScheduleDate < (now - 30 days)` AND `constructionCompleteDate IS NULL`

- [ ] **Test:** seed 3 deals, one fully populated, one partial, one stale-date; assert score

### 4d. Rescue metric (F)

**Files:**
- Create: `src/lib/pm-tracker/metrics/rescue.ts`
- Create: `src/__tests__/lib/pm-tracker/metrics/rescue.test.ts`

- [ ] **rescue.ts** — stuckCountNow, medianTimeToUnstick90d, recoveryRate90d

Approach:
1. **Scope:** PM-owned active deals (not closed)
2. `stuckCountNow`: for each deal, read `rawProperties.hs_date_entered_<stageId>` (cached). If `(now - that timestamp) > THRESHOLDS.stuckDays`, count it
3. `medianTimeToUnstick90d` and `recoveryRate90d` are harder without history table — for Phase 1 we approximate using `lastSyncedAt` and current stage entry timestamps:
   - **Phase 1 simplification:** report `null` (UI shows "—") for these two metrics in Phase 1; full history-based computation deferred to Phase 2 alongside `PMSave`. Document this in the dashboard tooltip.
4. Alternative for Phase 1: `medianTimeToUnstick90d` = median of `(now - hs_date_entered_<stageId>)` across currently-stuck deals. Not "time to unstick" but "how long they've been stuck." Label accordingly in UI ("median age of stuck deals").

- [ ] **Decision:** ship Phase 1 with `stuckCountNow` only; report `null` for unstick-time metrics. Update UI to show only `stuckCountNow`. Phase 2 adds the historical metrics.

- [ ] **Test:** seed deals with various stage-entry timestamps, assert stuckCount

### 4e. CSAT metric (G)

**Files:**
- Create: `src/lib/pm-tracker/metrics/csat.ts`
- Create: `src/__tests__/lib/pm-tracker/metrics/csat.test.ts`

- [ ] **csat.ts** — reviewRate, avgReviewScore, complaintRatePer100

Approach:
1. **Scope:** PM-owned deals where `constructionCompleteDate IS NOT NULL` (installed)
2. `reviewRate`: query `FIVE_STAR_REVIEWS` cache for reviews tied to portfolio deal IDs (or contacts). Rate = matched / portfolioCount
3. `avgReviewScore`: mean star rating across matched reviews
4. `complaintRatePer100`: count service tickets opened in last 90 days where the deal is in PM's portfolio. Rate = (count × 100) / installedDeals

- [ ] **Test:** seed mock review + ticket data, assert rates

### 4f. Commit each metric module separately

- [ ] **Commits** (5):
  - `feat(pm-tracker): metric B - customer engagement`
  - `feat(pm-tracker): metric D - pre-install readiness`
  - `feat(pm-tracker): metric E - data hygiene`
  - `feat(pm-tracker): metric F - stalled-deal rescue (Phase 1: stuck count only)`
  - `feat(pm-tracker): metric G - customer satisfaction`

---

## Task 5: Snapshot orchestrator

**Files:**
- Create: `src/lib/pm-tracker/snapshot.ts`
- Create: `src/__tests__/lib/pm-tracker/snapshot.test.ts`

- [ ] **snapshot.ts** — runs all 5 metrics for each PM and persists to `PMSnapshot`

```ts
import { prisma } from "@/lib/db";
import { PM_NAMES, type PmName } from "./owners";
import { computeEngagementForPM } from "./metrics/engagement";
import { computeReadinessForPM } from "./metrics/readiness";
import { computeHygieneForPM } from "./metrics/hygiene";
import { computeRescueForPM } from "./metrics/rescue";
import { computeCsatForPM } from "./metrics/csat";

export async function buildSnapshot(pmName: PmName, periodEnd: Date): Promise<void> {
  const periodStart = new Date(periodEnd.getTime() - 90 * 24 * 60 * 60 * 1000);
  const [eng, ready, hyg, res, csat] = await Promise.all([
    computeEngagementForPM(pmName),
    computeReadinessForPM(pmName),
    computeHygieneForPM(pmName),
    computeRescueForPM(pmName),
    computeCsatForPM(pmName),
  ]);
  await prisma.pMSnapshot.upsert({
    where: { pmName_periodStart_periodEnd: { pmName, periodStart, periodEnd } },
    create: {
      pmName, periodStart, periodEnd,
      ghostRate: eng.ghostRate,
      medianDaysSinceLastTouch: eng.medianDaysSinceLastTouch,
      touchFrequency30d: eng.touchFrequency30d,
      readinessScore: ready.readinessScore,
      dayOfFailures90d: ready.dayOfFailures90d,
      fieldPopulationScore: hyg.fieldPopulationScore,
      staleDataCount: hyg.staleDataCount,
      stuckCountNow: res.stuckCountNow,
      medianTimeToUnstick90d: res.medianTimeToUnstick90d ?? 0,
      recoveryRate90d: res.recoveryRate90d ?? 0,
      reviewRate: csat.reviewRate,
      avgReviewScore: csat.avgReviewScore,
      complaintRatePer100: csat.complaintRatePer100,
      portfolioCount: eng.portfolioCount,
    },
    update: { /* same fields */ }
  });
}

export async function buildAllSnapshots(periodEnd: Date = new Date()): Promise<void> {
  for (const pmName of PM_NAMES) {
    try {
      await buildSnapshot(pmName, periodEnd);
    } catch (err) {
      console.error(`[pm-tracker] snapshot failed for ${pmName}:`, err);
      // Continue with next PM — one failure must not abort the batch
    }
  }
}
```

- [ ] **Test:** mock all 5 metric functions, assert correct upsert call

- [ ] **Commit:** `feat(pm-tracker): snapshot orchestrator`

---

## Task 6: API routes

**Files:**
- Create: `src/app/api/pm/scorecard/route.ts`
- Create: `src/app/api/pm/team-summary/route.ts`
- Create: `src/app/api/pm/at-risk/route.ts`
- Modify: `src/lib/roles.ts` (allowlist new routes for ADMIN)

### 6a. `/api/pm/scorecard`

- [ ] **route.ts** — `GET /api/pm/scorecard?pm=<name>&period=<30d|90d|365d>`

```ts
export async function GET(request: NextRequest) {
  const { ok, email } = await checkAudienceAccess();
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  
  const url = new URL(request.url);
  const pmRaw = url.searchParams.get("pm");
  const pmName = normalizePmName(pmRaw);
  if (!pmName) return NextResponse.json({ error: "Invalid PM name" }, { status: 400 });
  
  // Read most recent snapshot
  const snapshot = await prisma.pMSnapshot.findFirst({
    where: { pmName },
    orderBy: { periodEnd: "desc" },
  });
  if (!snapshot) return NextResponse.json({ error: "No snapshot yet" }, { status: 404 });
  
  return NextResponse.json(toScorecardResponse(snapshot));
}
```

### 6b. `/api/pm/team-summary`

- [ ] Reads latest snapshot for each PM, returns array

### 6c. `/api/pm/at-risk`

- [ ] Computes at-risk deals on-demand (cache 15min). Reasons: STUCK (using `hs_date_entered_<stage>`), GHOSTED (no outbound engagement in 21d), PERMIT_OVERDUE (`permitSubmitDate < now - 30d` AND `!isPermitIssued`), READINESS_GAP (install in next 7d, missing one of 3 boxes)

### 6d. Roles allowlist

- [ ] **Modify** `src/lib/roles.ts`: add `/api/pm/scorecard`, `/api/pm/team-summary`, `/api/pm/at-risk`, `/api/cron/pm-snapshot`, `/api/cron/pm-weekly-digest`, and `/dashboards/pm-accountability` to ADMIN's `allowedRoutes` array. Per memory rule, every role that should access these gets the entry — for now, ADMIN only.

- [ ] **Commit:** `feat(pm-tracker): API routes + role allowlist`

---

## Task 7: Snapshot cron

**Files:**
- Create: `src/app/api/cron/pm-snapshot/route.ts`

- [ ] **route.ts** — invokes `buildAllSnapshots(new Date())`

Vercel cron protection: existing pattern uses `request.headers.get("authorization")` matching `CRON_SECRET`. Mirror that.

- [ ] **Update** `vercel.json` cron config: add `{ "path": "/api/cron/pm-snapshot", "schedule": "0 8 * * *" }` (08:00 UTC = 02:00 MT during DST; close enough for a nightly job)

- [ ] **Commit:** `feat(pm-tracker): nightly snapshot cron`

---

## Task 8: Weekly digest email template

**Files:**
- Create: `src/emails/PMWeeklyDigest.tsx`
- Create: `src/emails/PMWeeklyDigest.test.tsx` (snapshot test only — verify it renders)

- [ ] **Template** — React Email template, uses theme tokens via inline styles. Sections:
  - Headline: portfolio counts + week-over-week delta on 5 KPIs per PM
  - Watch list: at-risk deals by PM (table)
  - Footer: link to `/dashboards/pm-accountability`

- [ ] **Commit:** `feat(pm-tracker): weekly digest email template`

---

## Task 9: Weekly digest cron

**Files:**
- Create: `src/app/api/cron/pm-weekly-digest/route.ts`
- Modify: `vercel.json`

- [ ] **route.ts**:
  - Authorization check via `CRON_SECRET`
  - Idempotency check via `IdempotencyKey` model on key `pm-weekly-digest:<iso-week>` — skip if a row exists from past 24h
  - Read latest snapshots for all PMs
  - Read week-prior snapshots (for delta)
  - Read at-risk deals
  - Render `PMWeeklyDigest` template
  - Send to each email in `audienceList()` via existing email infrastructure
  - Insert `IdempotencyKey` row on success

- [ ] **vercel.json**: add `{ "path": "/api/cron/pm-weekly-digest", "schedule": "0 14 * * 1" }` (14:00 UTC Monday = 08:00 MT)

- [ ] **Commit:** `feat(pm-tracker): weekly digest cron`

---

## Task 10: Dashboard page

**Files:**
- Create: `src/app/dashboards/pm-accountability/page.tsx`
- Create: `src/app/dashboards/pm-accountability/TeamComparisonTable.tsx`
- Create: `src/app/dashboards/pm-accountability/PmScorecardTab.tsx`
- Create: `src/app/dashboards/pm-accountability/AtRiskList.tsx`

### 10a. `page.tsx`

- [ ] Server component does audience check via `checkAudienceAccess()`. If not allowed, render minimal "Not authorized" page.
- [ ] If authorized, render `<DashboardShell>` with client components inside.
- [ ] Client components fetch via React Query.

### 10b. `TeamComparisonTable.tsx`

- [ ] Client component. Fetches `/api/pm/team-summary`. Renders table with PMs as columns, metrics as rows. Color-coded cells via `bandFor()`. Default sort by `ghostRate` ascending.

### 10c. `PmScorecardTab.tsx`

- [ ] Per-PM tab content. Top: KPI strip with the 5 metric headlines using `<StatCard>` + `<MiniStat>` from `src/components/ui/MetricCard.tsx`. Below: `<AtRiskList pm={pmName} />`.

### 10d. `AtRiskList.tsx`

- [ ] Fetches `/api/pm/at-risk?pm=<name>`. Renders list of at-risk deals grouped by reason (STUCK / GHOSTED / PERMIT_OVERDUE / READINESS_GAP). Each row has deal name, days at risk, link to HubSpot.

- [ ] **Commit:** `feat(pm-tracker): dashboard page + components`

---

## Task 11: Suite nav entry

**Files:**
- Modify: `src/lib/suite-nav.ts`

- [ ] Add entry to Executive suite (visible to ADMIN/OWNER) and Admin suite (ADMIN only):
```ts
{
  href: "/dashboards/pm-accountability",
  label: "PM Accountability",
  description: "Project Manager activity, outcomes, and saves.",
  // Hidden for non-audience members; route still gated server-side.
}
```

Note: suite-nav visibility is by role; the audience email gate is enforced server-side. So the card may be visible to other ADMINs but the page itself will deny them. Acceptable for v1 (only ADMINs see Executive/Admin suites anyway, and only Zach is ADMIN currently? Verify).

- [ ] **Verify** which users currently have ADMIN role. If others do, the dashboard card will appear for them but the page will deny — surface a clean "not in audience" message rather than crash.

- [ ] **Commit:** `feat(pm-tracker): suite nav entry`

---

## Task 12: Manual smoke test (local)

- [ ] **Run dev server** (`npm run dev`)
- [ ] **Trigger snapshot once** by hitting `/api/cron/pm-snapshot` with the cron secret header (or temporarily relax the auth check for one local run)
- [ ] **Visit** `/dashboards/pm-accountability` — verify table renders for the 4 PMs without errors
- [ ] **Visit** `/api/pm/scorecard?pm=Natasha&period=90d` — verify JSON response
- [ ] **Test audience gate:** sign in as a non-allowlisted user and verify 403 / "Not authorized" page

If anything is broken: fix before review.

---

## Task 13: Self-review

- [ ] **Dispatch** `feature-dev:code-reviewer` subagent on the diff vs `origin/main`. Brief it on what the spec is for and what to look for (security on audience gate, name normalization edge cases, snapshot upsert safety, cron idempotency).
- [ ] Address any HIGH-confidence issues. Re-dispatch if needed.

---

## Task 14: PR + merge

- [ ] Push branch
- [ ] `gh pr create` with summary + test plan
- [ ] Wait for CI (CodeQL + Vercel deploy + Vercel Agent Review)
- [ ] If clean, `gh pr merge --squash --auto --delete-branch`
- [ ] Confirm prod deploy
- [ ] Report PR URL to user

---

## Out of scope for Phase 1 (deferred to Phase 2 plan)

- `PMSave` model + saves detector pipeline
- `medianTimeToUnstick90d` and `recoveryRate90d` (need stage history; Phase 1 reports nulls)
- Saves panel on dashboard
- Top-5-saves section in weekly digest
- Workflow-user-list bootstrap
- ROI calculator (Phase 3)

These get a follow-up plan + PR after Phase 1 is in prod and Zach has validated the metrics.
