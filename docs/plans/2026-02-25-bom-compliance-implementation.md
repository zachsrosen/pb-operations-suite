# BOM Catalog & Zuper Compliance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the BOM tool with pricing/vendor fields on the existing catalog page, fix Zuper compliance data accuracy bugs across ALL accumulator paths (user, team, category, crew), add roofing categories, and build a weekly ops email digest via the existing `sendEmailMessage()` transport.

**Architecture:** Three independent workstreams. Workstream 2 (compliance audit) must complete before Workstream 3 (weekly email) since the email relies on accurate compliance data. Workstream 1 (BOM catalog) is fully independent.

**Tech Stack:** Next.js 16.1, React 19.2, Prisma 7.3, Tailwind v4, existing `sendEmailMessage()` in `src/lib/email.ts` (Gmail API via service account + Resend fallback), Zuper API

**Review corrections applied:**
- P1-1: All compliance fixes applied to ALL FOUR accumulator loops (user, team, category, crew composition)
- P1-2: Extend existing `/dashboards/catalog` and `/api/inventory/skus` — NO new duplicate surfaces
- P1-3: Update BOTH `save/route.ts` AND `history/route.ts` for category sync
- P2-4: Null-guard `scheduledEnd` in started-on-time logic
- P2-5: Use existing `sendEmailMessage()` from `email.ts` — NO new Gmail helper
- P2-6: Use existing token-based matching from BOM page — NOT strict key matching
- P2-7: Use existing POST endpoint for reject — NOT PATCH

---

## Workstream 2: Zuper Compliance Data Accuracy Audit

> Do this FIRST — the weekly email depends on accurate data.

### Task 1: Discover Roofing Category UIDs from Zuper

**Files:**
- Modify: `src/lib/zuper.ts:171-194`

**Step 1: Query Zuper for all job categories**

Use the Zuper MCP tool `list_job_categories` to find roofing-related categories and their UIDs. Look for categories with "roof" in the name.

**Step 2: Add roofing UIDs to the constants**

In `src/lib/zuper.ts`, add the roofing category entries to both `JOB_CATEGORY_UIDS` and `JOB_CATEGORIES`:

```typescript
// In JOB_CATEGORY_UIDS — add after DNR_INSPECTION:
ROOFING: "<uid-from-zuper>",

// In JOB_CATEGORIES — add after DNR_INSPECTION:
ROOFING: "Roofing",
```

If there are multiple roofing categories (e.g., "Roofing Inspection", "Roofing Install"), add each one separately.

**Step 3: Verify**

Run: `npx next build` — ensure no type errors from the new entries. The compliance route iterates `Object.entries(JOB_CATEGORY_UIDS)` dynamically, so no changes needed there.

**Step 4: Commit**

```bash
git add src/lib/zuper.ts
git commit -m "feat(compliance): add roofing job categories to Zuper constants"
```

---

### Task 2: Fix Completion Time Fallback (Silent On-Time Bug)

**Files:**
- Modify: `src/app/api/zuper/compliance/route.ts` — ALL FOUR accumulator loops

**Critical context:** The `effectiveCompletedTime = completedTime || scheduledEnd` pattern and its downstream on-time counting appear in FOUR places:
1. **User accumulator** (~line 656-684)
2. **Team accumulator** (~line 920-954)
3. **Category accumulator** (similar section)
4. **Crew composition accumulator** (similar section)

ALL FOUR must be fixed together.

**Step 1: Add unknownCompletionJobs tracking to UserAccumulator**

Add to the `UserAccumulator` interface (around line 550):
```typescript
unknownCompletionJobs: number;
unknownCompletionJobsList: JobEntry[];
```

Initialize both in the `userMap.set()` block.

**Step 2: Fix ALL FOUR accumulator loops**

In each loop, replace the pattern:
```typescript
// OLD — in all four accumulators:
const effectiveCompletedTime = completedTime || scheduledEnd;
// ... later:
} else {
  acc.onTimeCompletions++;  // BUG: no completion time, counted as on-time
}
```

With:
```typescript
// NEW — use real completedTime only:
if (COMPLETED_STATUSES.has(statusLower)) {
  acc.completedJobs++;

  if (scheduledEnd && completedTime) {
    // Real completion time — normal on-time check
    const deadline = new Date(scheduledEnd.getTime() + GRACE_MS);
    if (completedTime <= deadline) {
      acc.onTimeCompletions++;
    } else {
      acc.lateCompletions++;
    }
    if (completedTime > scheduledEnd) {
      const diffMs = completedTime.getTime() - scheduledEnd.getTime();
      // push to daysLatePastEnd...
    }
  } else if (!completedTime) {
    // No real completion time — flag as unknown, do NOT count as on-time
    acc.unknownCompletionJobs++;
    // (user accumulator only: add to unknownCompletionJobsList)
  } else {
    // Has completedTime but no scheduledEnd — count as on-time (can't measure)
    acc.onTimeCompletions++;
  }

  // Days to complete — only use real completedTime
  if (scheduledStart && completedTime && completedTime > scheduledStart) {
    // push to completionDays...
  }
```

For team/category/crew accumulators: track `unknownCompletionJobs: number` (no job list needed, just the count).

**Step 3: Add unknownCompletionJobs to all output types**

- `UserMetrics`: add `unknownCompletionJobs` and `unknownCompletionJobsList`
- `GroupComparison` (used for team/category/crew): add `unknownCompletionJobs`
- `buildGroupFromAcc()` helper: compute and include the count
- Response `summary`: add `unknownCompletionJobs` total

**Step 4: Remove all `effectiveCompletedTime` references**

Search the entire route for remaining uses of `effectiveCompletedTime`. Replace with `completedTime` in all downstream logic (OOW tracking, job entry construction, etc.). The `completedTime` variable may be null — handle accordingly.

**Step 5: Verify**

Run: `npx next build` — confirm no type errors.

**Step 6: Commit**

```bash
git add src/app/api/zuper/compliance/route.ts
git commit -m "fix(compliance): track unknown completion times across all accumulators"
```

---

### Task 3: Fix OOW Metric — Compare Against Scheduled Start

**Files:**
- Modify: `src/app/api/zuper/compliance/route.ts` — ALL FOUR accumulator loops

**Critical context:** The OOW comparison appears in all four accumulators. Fix all of them.

**Step 1: Fix in ALL FOUR accumulator loops**

Current pattern (appears 4 times):
```typescript
if (onOurWayTime && scheduledStart) {
  acc.onOurWayTotal++;
  if (scheduledEnd && onOurWayTime > scheduledEnd) {  // BUG: compares to end
    acc.onOurWayLate++;
```

Replace with:
```typescript
if (onOurWayTime && scheduledStart) {
  acc.onOurWayTotal++;
  if (onOurWayTime > scheduledStart) {
    // OOW sent after scheduled start = late notification
    acc.onOurWayLate++;
    jobOowOnTime = false;  // (user accumulator only)
  } else {
    acc.onOurWayOnTime++;
    jobOowOnTime = true;   // (user accumulator only)
  }
}
```

For team/category/crew accumulators (no `jobOowOnTime` variable):
```typescript
if (onOurWayTime && scheduledStart) {
  if (onOurWayTime > scheduledStart) {
    tAcc.onOurWayLate++;
  } else {
    tAcc.onOurWayOnTime++;
  }
}
```

**Step 2: Verify and commit**

```bash
git add src/app/api/zuper/compliance/route.ts
git commit -m "fix(compliance): compare OOW time to scheduled start across all accumulators"
```

---

### Task 4: Extract Started Timestamp (Not Just Boolean)

**Files:**
- Modify: `src/app/api/zuper/compliance/route.ts:238-249` (helper) and ALL FOUR accumulator loops

**Step 1: Convert `hasStartedStatus` to `getStartedTime`**

Replace the boolean helper:
```typescript
function getStartedTime(job: any): Date | null {
  const statusHistory = job.job_status;
  if (!Array.isArray(statusHistory)) return null;

  for (const entry of statusHistory) {
    if (!entry) continue;
    const name = (entry.status_name || entry.name || "").toLowerCase();
    if (name === "started" && (entry.created_at || entry.updated_at)) {
      return new Date(entry.created_at || entry.updated_at);
    }
  }
  return null;
}
```

**Step 2: Update ALL FOUR accumulator loops**

Replace `const usedStarted = hasStartedStatus(job);` with:
```typescript
const startedTime = getStartedTime(job);
const usedStarted = startedTime !== null;
```

This appears in:
1. User accumulator loop
2. Team accumulator loop
3. Category accumulator loop
4. Crew composition accumulator loop

**Step 3: Add startedOnTime tracking to ALL FOUR accumulators**

Add to each accumulator type:
```typescript
startedOnTime: number;
startedLate: number;
```

In each completed-job block, after OOW tracking:
```typescript
// Null-safe: guard BOTH scheduledStart AND scheduledEnd
if (startedTime && scheduledStart && scheduledEnd) {
  if (startedTime <= scheduledEnd) {
    acc.startedOnTime++;
  } else {
    acc.startedLate++;
  }
}
```

**Step 4: Add startedTime to JobEntry interface**

Add `startedTime: string | null` and populate in all job entry construction blocks.

**Step 5: Add to output types**

- `UserMetrics`: add `startedOnTime`, `startedLate`
- `GroupComparison`: add `startedOnTime`, `startedLate`
- `buildGroupFromAcc()`: compute and include

**Step 6: Verify and commit**

```bash
git add src/app/api/zuper/compliance/route.ts
git commit -m "feat(compliance): extract started timestamp and track on-time across all accumulators"
```

---

### Task 5: Investigate and Fix Service Team 15-User Bug

**Files:**
- Modify: `src/lib/compliance-team-overrides.ts` (likely)
- Modify: `src/app/api/zuper/compliance/route.ts` (possibly)

**Step 1: Query current data**

Hit the API: `curl "localhost:3000/api/zuper/compliance?days=30&team=Service"` and inspect the `users` array. List every user name and UID returned.

**Step 2: Cross-reference with overrides**

Check `compliance-team-overrides.ts` for which UIDs map to "Service" team. Count them. Compare against the API response.

**Step 3: Identify the discrepancy**

Possible causes:
- Users in `COMPLIANCE_TEAM_OVERRIDES` mapped to "Service" who shouldn't be (inactive, moved teams)
- Users not in the overrides file getting "Service" from Zuper's assignment-level team data
- The `crewTeamByUserUid` DB fallback pulling in stale CrewMember records

**Step 4: Fix**

Update `COMPLIANCE_TEAM_OVERRIDES` and/or `COMPLIANCE_EXCLUDED_USER_UIDS` based on findings.

**Step 5: Verify and commit**

```bash
git add src/lib/compliance-team-overrides.ts
git commit -m "fix(compliance): correct service team user mappings"
```

---

## Workstream 3: Weekly 7-Day Ops Email

### Task 6: Extract Compliance Digest Data Function

**Files:**
- Create: `src/lib/compliance-helpers.ts` (extracted shared helpers)
- Create: `src/lib/compliance-digest.ts` (digest function)
- Modify: `src/app/api/zuper/compliance/route.ts` (update imports)

**Step 1: Extract shared helpers**

Move these pure functions from the compliance route into `src/lib/compliance-helpers.ts`:
- `getCompletedTimeFromHistory()`
- `getOnOurWayTime()`
- `getStartedTime()`
- `extractAssignedUsers()` + its options type
- `getCategoryUid()`
- `getStatusName()`
- `isExcludedUser()` / `isExcludedTeam()`
- `computeGrade()`
- `fetchJobsForCategory()`
- Status sets: `COMPLETED_STATUSES`, `STUCK_STATUSES`, `NEVER_STARTED_STATUSES`
- Constants: `GRACE_MS`, `MAX_PAGES_PER_CATEGORY`, `EXCLUDED_USER_NAMES`, `EXCLUDED_TEAM_PREFIXES`

Update the compliance route to import from `compliance-helpers.ts`.

**Step 2: Create digest function**

`src/lib/compliance-digest.ts` — calls the same Zuper APIs and reuses helpers:

```typescript
export interface ComplianceDigest {
  period: { from: string; to: string; days: number };
  summary: {
    totalJobs: number;
    completedJobs: number;
    onTimePercent: number;
    oowUsagePercent: number;
    stuckJobs: number;
    unknownCompletionJobs: number;
  };
  priorPeriod: {
    completedJobs: number;
    onTimePercent: number;
    oowUsagePercent: number;
    stuckJobs: number;
  };
  teams: Array<{
    name: string; completedJobs: number; onTimePercent: number;
    avgDaysLate: number; stuckJobs: number; grade: string;
  }>;
  categories: Array<{
    name: string; completedJobs: number; onTimePercent: number;
    avgDaysLate: number; stuckJobs: number; grade: string;
  }>;
  notificationReliability: {
    oowBeforeStartPercent: number;
    startedOnTimePercent: number;
    lowOowUsers: Array<{ name: string; team: string; oowPercent: number }>;
  };
  callouts: {
    stuckOver3Days: Array<{ jobUid: string; title: string; team: string; daysPastEnd: number }>;
    failingUsers: Array<{ name: string; team: string; grade: string; score: number }>;
    unknownCompletionJobs: Array<{ jobUid: string; title: string; category: string }>;
  };
}

export async function getComplianceDigest(days: number): Promise<ComplianceDigest>
```

Fetches current + prior period for trend computation.

**Step 3: Verify and commit**

```bash
git add src/lib/compliance-helpers.ts src/lib/compliance-digest.ts src/app/api/zuper/compliance/route.ts
git commit -m "feat: extract compliance helpers and digest data function"
```

---

### Task 7: Build Weekly Compliance Email Function

**Files:**
- Modify: `src/lib/email.ts` (add new export function)

**Step 1: Add `sendWeeklyComplianceEmail()` to `email.ts`**

Follow the existing pattern of `sendWeeklyChangelogSimpleEmail()` and other exported functions. Use the existing `sendEmailMessage()` internal transport (Gmail API primary + Resend fallback). Do NOT create a separate Gmail helper.

```typescript
export async function sendWeeklyComplianceEmail(params: {
  to: string;
  bcc?: string[];
  digest: ComplianceDigest;
}): Promise<SendResult> {
  const weekLabel = `${params.digest.period.from} – ${params.digest.period.to}`;
  const html = buildComplianceEmailHtml(params.digest);
  const text = buildComplianceEmailText(params.digest); // plain text fallback

  return sendEmailMessage({
    to: params.to,
    bcc: params.bcc,
    subject: `Weekly Ops Report — ${weekLabel}`,
    html,
    text,
    debugFallbackTitle: "Weekly Compliance Report",
    debugFallbackBody: text,
  });
}
```

**Step 2: Build the HTML template inline (or as helper)**

Build `buildComplianceEmailHtml(digest)` as a private function in `email.ts` (same file, following existing patterns). Sections:

1. **Header** — "Weekly Operations Report — [date range]"
2. **4 key metrics** with trend arrows (green up if improving, red down if declining)
3. **Team table** — rows sorted by grade, highlight best (green) and worst (red)
4. **Category table** — same format
5. **Notification reliability** — OOW %, Started %, low-OOW user callouts
6. **Callouts** — stuck jobs, failing users, unknown completions
7. **Footer** — link to full compliance dashboard

Use inline CSS for email compatibility. PB brand orange `#f97316` for accents.

**Step 3: Verify and commit**

```bash
git add src/lib/email.ts
git commit -m "feat: add weekly compliance email template and send function"
```

---

### Task 8: Create Weekly Compliance Send Script

**Files:**
- Create: `scripts/send-weekly-compliance.ts`

**Step 1: Create the script**

Follow the exact pattern of `scripts/send-weekly-review.ts`:
- Load `.env` / `.env.local`
- Parse CLI args for recipient override
- Call `getComplianceDigest(7)`
- Call `sendWeeklyComplianceEmail()` with recipients from `COMPLIANCE_REPORT_RECIPIENTS` env var

```typescript
async function main() {
  const recipients = process.argv[2]
    || process.env.COMPLIANCE_REPORT_RECIPIENTS
    || "zach@photonbrothers.com";

  console.log(`Sending weekly compliance report to: ${recipients}`);

  const digest = await getComplianceDigest(7);

  const result = await sendWeeklyComplianceEmail({
    to: recipients,
    digest,
  });

  if (result.success) {
    console.log("Sent successfully.");
  } else {
    console.error("Send failed:", result.error);
    process.exit(1);
  }
}
```

**Step 2: Test locally**

Run: `npx tsx scripts/send-weekly-compliance.ts zach@photonbrothers.com`

**Step 3: Commit**

```bash
git add scripts/send-weekly-compliance.ts
git commit -m "feat: add weekly compliance email send script"
```

---

## Workstream 1: BOM Product Catalog

### Task 9: Extend Prisma Schema

**Files:**
- Modify: `prisma/schema.prisma:571-605`

**Step 1: Add new enum values**

```prisma
enum EquipmentCategory {
  MODULE
  INVERTER
  BATTERY
  EV_CHARGER
  RAPID_SHUTDOWN
  RACKING
  ELECTRICAL_BOS
  MONITORING
}
```

**Step 2: Add new fields to EquipmentSku**

```prisma
model EquipmentSku {
  id                String            @id @default(cuid())
  category          EquipmentCategory
  brand             String
  model             String
  description       String?
  unitSpec          Float?
  unitLabel         String?
  vendorName        String?
  vendorPartNumber  String?
  unitCost          Float?
  sellPrice         Float?
  isActive          Boolean           @default(true)
  zohoItemId        String?
  hubspotProductId  String?
  zuperItemId       String?

  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  stockLevels InventoryStock[]

  @@unique([category, brand, model])
  @@index([category])
  @@index([isActive])
}
```

**Step 3: Generate and migrate**

```bash
npx prisma generate
npx prisma migrate dev --name add-catalog-pricing-fields
```

**Step 4: Verify and commit**

```bash
git add prisma/
git commit -m "feat(bom): extend EquipmentSku with pricing, vendor, and new categories"
```

---

### Task 10: Extend Existing Catalog API with Pricing/Vendor Fields

**Files:**
- Modify: `src/app/api/inventory/skus/route.ts` (extend existing — do NOT create new /api/catalog/)

**Step 1: Update GET to return new fields**

The existing `GET /api/inventory/skus` already queries `EquipmentSku`. Update the Prisma select/include to return the new fields: `description`, `vendorName`, `vendorPartNumber`, `unitCost`, `sellPrice`, `hubspotProductId`, `zuperItemId`.

**Step 2: Update POST to accept new fields**

Extend the create/upsert body parsing to accept the new fields. No new validation needed — all are optional.

**Step 3: Add PATCH support for inline editing**

Add a PATCH handler (or extend existing) that accepts partial updates to an existing SKU. This is needed for inline price editing on the catalog page.

**Step 4: Add sync health stats endpoint**

Create `src/app/api/inventory/skus/stats/route.ts` — count SKUs by category and report how many have `zohoItemId`, `hubspotProductId`, `zuperItemId` populated.

**Step 5: Verify and commit**

```bash
git add src/app/api/inventory/skus/
git commit -m "feat(bom): extend inventory SKU API with pricing, vendor, and sync health stats"
```

---

### Task 11: Extend Existing Catalog Dashboard with Pricing & Sync Health

**Files:**
- Modify: `src/app/dashboards/catalog/page.tsx` (extend existing — do NOT create new page)

**Step 1: Add pricing columns to catalog table**

Add columns: unit cost, sell price, margin % (derived), vendor name. Make unit cost and sell price inline-editable (click to edit, blur to PATCH).

**Step 2: Add Sync Health tab**

Add a third tab alongside existing Catalog and Pending Approvals tabs. Fetch from `GET /api/inventory/skus/stats`. Show per-category cards with sync completion counts and a list of SKUs missing external IDs.

**Step 3: Enhance the product creation form**

Add the new fields to the existing creation modal or form: description, vendor name, vendor part number, unit cost, sell price. Update the dropdown to include all 8 categories.

**Step 4: Verify and commit**

```bash
git add src/app/dashboards/catalog/
git commit -m "feat(bom): add pricing, vendor, and sync health to existing catalog dashboard"
```

---

### Task 12: Add Pricing Columns to BOM Table

**Files:**
- Modify: `src/app/dashboards/bom/page.tsx`

**Step 1: Use existing token-based matching**

The BOM page already has a catalog comparison mechanism that uses token-based matching (normalize text, tokenize, similarity >= 0.5). Reuse this existing matching to link BOM items to catalog SKUs. Do NOT introduce strict `category-brand-model` key matching.

**Step 2: Add columns to the BOM table**

For each BOM item, when it matches a catalog SKU via the existing matcher:
- Show `unitCost` column
- Show `extendedCost` column (qty x unitCost)
- Show `sellPrice` column

Unmatched items show "—" with a link to `/dashboards/catalog` with query params pre-filling the creation form.

**Step 3: Add a totals row**

Bottom of the table: sum of all extended costs and extended sell prices for matched items.

**Step 4: Verify and commit**

```bash
git add src/app/dashboards/bom/page.tsx
git commit -m "feat(bom): add pricing columns to BOM table using existing token matching"
```

---

### Task 13: Update BOTH BOM Save Routes to Sync All Categories

**Files:**
- Modify: `src/app/api/bom/save/route.ts`
- Modify: `src/app/api/bom/history/route.ts` (POST handler)

**Critical context:** Both routes independently sync BOM items to `EquipmentSku`. Both must be updated together to avoid inconsistent catalog data depending on which save path is used.

**Step 1: Identify the sync logic in both routes**

Find the filter that restricts sync to MODULE/INVERTER/BATTERY/EV_CHARGER in each route.

**Step 2: Expand to all 8 categories**

In BOTH routes, update the category filter to include: RAPID_SHUTDOWN, RACKING, ELECTRICAL_BOS, MONITORING.

**Step 3: Add category string-to-enum mapping**

Create a shared helper (can live in `src/lib/bom-helpers.ts` or similar) that maps BOM category strings to `EquipmentCategory` enum values, handling case insensitivity:

```typescript
const BOM_CATEGORY_TO_ENUM: Record<string, EquipmentCategory> = {
  MODULE: "MODULE",
  INVERTER: "INVERTER",
  BATTERY: "BATTERY",
  EV_CHARGER: "EV_CHARGER",
  RAPID_SHUTDOWN: "RAPID_SHUTDOWN",
  RACKING: "RACKING",
  ELECTRICAL_BOS: "ELECTRICAL_BOS",
  MONITORING: "MONITORING",
};
```

Import and use in both routes.

**Step 4: Verify and commit**

```bash
git add src/app/api/bom/save/route.ts src/app/api/bom/history/route.ts
git commit -m "feat(bom): sync all 8 equipment categories in both save paths"
```
