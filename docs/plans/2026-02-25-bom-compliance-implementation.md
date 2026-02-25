# BOM Catalog & Zuper Compliance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the BOM tool with a standalone product catalog page and pricing fields, fix Zuper compliance data accuracy bugs, add roofing categories, and build a weekly ops email digest via Gmail API.

**Architecture:** Three independent workstreams that share no code dependencies. Workstream 2 (compliance audit) should be done before Workstream 3 (weekly email) since the email relies on accurate compliance data. Workstream 1 (BOM catalog) is fully independent.

**Tech Stack:** Next.js 16.1, React 19.2, Prisma 7.3, Tailwind v4, Google service account JWT (gmail send), Zuper API

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
- Modify: `src/app/api/zuper/compliance/route.ts:656-684`

**Step 1: Identify the bug**

At line 656, `effectiveCompletedTime` falls back to `scheduledEnd` when no real completion time exists:
```typescript
const effectiveCompletedTime = completedTime || scheduledEnd;
```

Then at line 682-684, when `scheduledEnd` exists but there's no real `completedTime`, the job is silently counted as on-time:
```typescript
} else {
  acc.onTimeCompletions++;  // BUG: no completion time, but counted as on-time
}
```

**Step 2: Add unknownCompletionTime tracking to UserAccumulator**

Add to the `UserAccumulator` interface (around line 550):
```typescript
unknownCompletionJobs: number;
unknownCompletionJobsList: JobEntry[];
```

Initialize both in the `userMap.set()` block (around line 623):
```typescript
unknownCompletionJobs: 0,
unknownCompletionJobsList: [],
```

**Step 3: Fix the fallback logic**

Replace the completed-job block (lines 662-728). The key change: when a job is completed but has no real `completedTime`, track it as unknown instead of silently counting on-time:

```typescript
if (COMPLETED_STATUSES.has(statusLower)) {
  acc.completedJobs++;

  let isLate = false;
  if (scheduledEnd && completedTime) {
    // Real completion time exists — normal on-time check
    const deadline = new Date(scheduledEnd.getTime() + GRACE_MS);
    if (completedTime <= deadline) {
      acc.onTimeCompletions++;
    } else {
      acc.lateCompletions++;
      isLate = true;
    }
    if (completedTime > scheduledEnd) {
      const diffMs = completedTime.getTime() - scheduledEnd.getTime();
      jobDaysLate = Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10;
      acc.daysLatePastEnd.push(jobDaysLate);
    }
  } else if (!completedTime) {
    // No real completion time — flag as unknown
    acc.unknownCompletionJobs++;
    acc.unknownCompletionJobsList.push({
      jobUid: job.job_uid || "",
      title: job.job_title || "",
      status: statusName,
      category: categoryName,
      scheduledStart: job.scheduled_start_time || null,
      scheduledEnd: job.scheduled_end_time || null,
      completedTime: null,
      daysToComplete: null,
      daysLate: null,
      onOurWayTime: onOurWayTime?.toISOString() || null,
      onOurWayOnTime: null,
    });
  } else {
    // Has completedTime but no scheduledEnd — count as on-time (can't measure)
    acc.onTimeCompletions++;
  }

  // Days to complete — only use real completedTime
  if (scheduledStart && completedTime && completedTime > scheduledStart) {
    const diffMs = completedTime.getTime() - scheduledStart.getTime();
    jobDaysToComplete = Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10;
    acc.completionDays.push(jobDaysToComplete);
  }
  // ... rest of OOW/Started tracking unchanged ...
```

**Step 4: Add unknownCompletionJobs to the UserMetrics output**

In the `users.push()` block (around line 825), add:
```typescript
unknownCompletionJobs: acc.unknownCompletionJobs,
unknownCompletionJobsList: acc.unknownCompletionJobsList,
```

Also add the field to the `UserMetrics` interface / type near the top of the file.

**Step 5: Apply the same fix to TeamAccumulator and CategoryAccumulator**

The team comparison (line 877+) and category comparison sections repeat the same `effectiveCompletedTime = completedTime || scheduledEnd` pattern. Apply the same fix: track `unknownCompletionJobs` count and don't silently count them as on-time.

**Step 6: Verify**

Run: `npx next build` — confirm no type errors. Test manually: `curl localhost:3000/api/zuper/compliance?days=7` and check that `unknownCompletionJobs` appears in the response.

**Step 7: Commit**

```bash
git add src/app/api/zuper/compliance/route.ts
git commit -m "fix(compliance): track unknown completion times instead of counting as on-time"
```

---

### Task 3: Fix OOW Metric — Compare Against Scheduled Start

**Files:**
- Modify: `src/app/api/zuper/compliance/route.ts:693-703` and team/category equivalents

**Step 1: Fix user-level OOW comparison**

Current code (line 694-702) compares OOW time to `scheduledEnd`:
```typescript
if (onOurWayTime && scheduledStart) {
  acc.onOurWayTotal++;
  if (scheduledEnd && onOurWayTime > scheduledEnd) {  // BUG: should be scheduledStart
    acc.onOurWayLate++;
```

Change to compare against `scheduledStart`:
```typescript
if (onOurWayTime && scheduledStart) {
  acc.onOurWayTotal++;
  if (onOurWayTime > scheduledStart) {
    // OOW sent after scheduled start = late notification
    acc.onOurWayLate++;
    jobOowOnTime = false;
  } else {
    acc.onOurWayOnTime++;
    jobOowOnTime = true;
  }
}
```

**Step 2: Apply same fix to team accumulator**

In the team comparison block (around line 959-964), change:
```typescript
if (onOurWayTime && scheduledStart) {
  if (onOurWayTime > scheduledStart) {
    tAcc.onOurWayLate++;
  } else {
    tAcc.onOurWayOnTime++;
  }
}
```

**Step 3: Apply same fix to category accumulator**

Find the equivalent section in the category comparison block and make the same change.

**Step 4: Verify and commit**

```bash
git add src/app/api/zuper/compliance/route.ts
git commit -m "fix(compliance): compare OOW time to scheduled start instead of end"
```

---

### Task 4: Extract Started Timestamp (Not Just Boolean)

**Files:**
- Modify: `src/app/api/zuper/compliance/route.ts:238-249` (helper) and accumulator logic

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

**Step 2: Update all call sites**

Replace `const usedStarted = hasStartedStatus(job);` with:
```typescript
const startedTime = getStartedTime(job);
const usedStarted = startedTime !== null;
```

This appears in three places:
1. User accumulator loop (~line 618)
2. Team accumulator loop (~line 922)
3. Category accumulator loop (similar location)

**Step 3: Add startedOnTime tracking**

Add to `UserAccumulator`:
```typescript
startedOnTime: number;   // started within scheduled window
startedLate: number;     // started after scheduled end
```

In the completed-job block, after OOW tracking:
```typescript
if (startedTime && scheduledStart) {
  if (startedTime <= scheduledEnd!) {
    acc.startedOnTime++;
  } else {
    acc.startedLate++;
  }
}
```

Add `startedOnTime` and `startedLate` to `UserMetrics` output and team/category accumulators.

**Step 4: Add startedTime to JobEntry**

Add `startedTime: string | null` to the `JobEntry` interface and populate it in all job entry construction.

**Step 5: Verify and commit**

```bash
git add src/app/api/zuper/compliance/route.ts
git commit -m "feat(compliance): extract started timestamp and track started-on-time metric"
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

Update `COMPLIANCE_TEAM_OVERRIDES` and/or `COMPLIANCE_EXCLUDED_USER_UIDS` based on findings. If users have moved teams, update their UID mapping. If users are no longer active, add them to the exclusion set.

**Step 5: Verify and commit**

```bash
git add src/lib/compliance-team-overrides.ts
git commit -m "fix(compliance): correct service team user mappings"
```

---

## Workstream 3: Weekly 7-Day Ops Email via Gmail

### Task 6: Create Gmail Send Helper

**Files:**
- Modify: `src/lib/google-auth.ts` (add Gmail send function)

**Step 1: Add sendGmailMessage function**

The existing `getServiceAccountToken()` in `google-auth.ts` handles JWT auth with impersonation. Add a Gmail send helper that uses it:

```typescript
export async function sendGmailMessage(options: {
  to: string | string[];
  subject: string;
  htmlBody: string;
  from?: string; // defaults to GOOGLE_ADMIN_EMAIL
}): Promise<{ id: string; threadId: string }> {
  const fromEmail = options.from || process.env.GOOGLE_ADMIN_EMAIL;
  if (!fromEmail) throw new Error("GOOGLE_ADMIN_EMAIL not configured");

  const token = await getServiceAccountToken(
    ["https://www.googleapis.com/auth/gmail.send"],
    fromEmail
  );

  const toList = Array.isArray(options.to) ? options.to.join(", ") : options.to;
  const rawEmail = [
    `From: ${fromEmail}`,
    `To: ${toList}`,
    `Subject: ${options.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    options.htmlBody,
  ].join("\r\n");

  const encodedMessage = Buffer.from(rawEmail)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encodedMessage }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail send failed (${res.status}): ${err}`);
  }

  return res.json() as Promise<{ id: string; threadId: string }>;
}
```

**Step 2: Verify**

Run: `npx next build` — confirm no type errors.

**Step 3: Commit**

```bash
git add src/lib/google-auth.ts
git commit -m "feat: add Gmail API send helper via service account"
```

---

### Task 7: Extract Compliance Digest Data Function

**Files:**
- Create: `src/lib/compliance-digest.ts`

**Step 1: Create the shared data function**

This function calls the same Zuper APIs and calculation logic as the compliance route, but returns a structured digest object instead of a full API response. It should import and reuse helpers from the compliance route.

First, refactor the compliance route to export its helper functions (`getCompletedTimeFromHistory`, `getOnOurWayTime`, `getStartedTime`, `extractAssignedUsers`, `fetchJobsForCategory`, `buildGroupFromAcc`, etc.) from a shared module, OR duplicate the minimal set needed.

**Recommended approach:** Extract the pure calculation helpers into `src/lib/compliance-helpers.ts` and import them in both the route and the digest function. This avoids duplicating ~200 lines of logic.

The digest function signature:

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
    name: string;
    completedJobs: number;
    onTimePercent: number;
    avgDaysLate: number;
    stuckJobs: number;
    grade: string;
  }>;
  categories: Array<{
    name: string;
    completedJobs: number;
    onTimePercent: number;
    avgDaysLate: number;
    stuckJobs: number;
    grade: string;
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

The function fetches two periods (current N days + prior N days) to compute trend data.

**Step 2: Verify**

Import the function in a test or script and confirm it returns valid data.

**Step 3: Commit**

```bash
git add src/lib/compliance-helpers.ts src/lib/compliance-digest.ts
git add src/app/api/zuper/compliance/route.ts  # updated imports
git commit -m "feat: extract compliance digest data function for email reports"
```

---

### Task 8: Build Weekly Compliance Email Template

**Files:**
- Create: `src/lib/compliance-email.ts`

**Step 1: Create the HTML email builder**

Build a function that takes a `ComplianceDigest` and returns an HTML string. Follow the existing email patterns in `src/lib/email.ts` for styling.

```typescript
export function buildComplianceEmailHtml(digest: ComplianceDigest): string
```

Sections:
1. **Header** — "Weekly Operations Report — [date range]"
2. **4 key metrics** with trend arrows (up arrow green if improving, red if declining)
3. **Team table** — rows sorted by grade, highlight best (green) and worst (red)
4. **Category table** — same format
5. **Notification reliability** — OOW %, Started %, low-OOW user callouts
6. **Callouts** — stuck jobs, failing users, unknown completions
7. **Footer** — link to full compliance dashboard

Use inline CSS for email compatibility. Keep it clean — dark header, white body, minimal color (match PB brand orange `#f97316` for accents).

**Step 2: Verify**

Write the HTML to a temp file and open in browser to visually inspect.

**Step 3: Commit**

```bash
git add src/lib/compliance-email.ts
git commit -m "feat: build weekly compliance email HTML template"
```

---

### Task 9: Create Weekly Compliance Send Script

**Files:**
- Create: `scripts/send-weekly-compliance.ts`

**Step 1: Create the script**

Follow the pattern of `scripts/send-weekly-review.ts`:
- Load `.env` / `.env.local`
- Parse CLI args for recipient override
- Call `getComplianceDigest(7)`
- Call `buildComplianceEmailHtml(digest)`
- Call `sendGmailMessage()` with recipients from `COMPLIANCE_REPORT_RECIPIENTS` env var

```typescript
async function main() {
  const recipients = process.argv[2]
    || process.env.COMPLIANCE_REPORT_RECIPIENTS
    || "zach@photonbrothers.com";

  console.log(`Sending weekly compliance report to: ${recipients}`);

  const digest = await getComplianceDigest(7);
  const html = buildComplianceEmailHtml(digest);
  const weekLabel = formatDateRange(digest.period.from, digest.period.to);

  await sendGmailMessage({
    to: recipients.split(",").map(s => s.trim()),
    subject: `Weekly Ops Report — ${weekLabel}`,
    htmlBody: html,
  });

  console.log("Sent successfully.");
}
```

**Step 2: Test locally**

Run: `npx tsx scripts/send-weekly-compliance.ts zach@photonbrothers.com`
Verify email arrives from the Google Workspace account.

**Step 3: Commit**

```bash
git add scripts/send-weekly-compliance.ts
git commit -m "feat: add weekly compliance email send script"
```

---

## Workstream 1: BOM Product Catalog

### Task 10: Extend Prisma Schema

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

**Step 4: Verify**

Run: `npx next build` — confirm no type errors from the new enum values or fields.

**Step 5: Commit**

```bash
git add prisma/
git commit -m "feat(bom): extend EquipmentSku with pricing, vendor, and new categories"
```

---

### Task 11: Build Product Catalog API Routes

**Files:**
- Create: `src/app/api/catalog/route.ts` (GET list, POST create)
- Create: `src/app/api/catalog/[id]/route.ts` (GET single, PATCH update)
- Create: `src/app/api/catalog/stats/route.ts` (GET sync health stats)

**Step 1: GET /api/catalog — List all SKUs**

Query `EquipmentSku` with optional filters: `?category=MODULE&active=true&search=tesla`. Return paginated results with all fields including the new pricing/vendor fields.

**Step 2: POST /api/catalog — Create a new SKU**

Accept all `EquipmentSku` fields. Validate required fields (category, brand, model). Check for duplicate `[category, brand, model]` before creating.

**Step 3: PATCH /api/catalog/[id] — Update a SKU**

Accept partial updates. Support updating cost, price, vendor info, sync IDs, active status.

**Step 4: GET /api/catalog/stats — Sync health**

Count SKUs by category. For each category, count how many have `zohoItemId`, `hubspotProductId`, `zuperItemId` populated vs null. Return summary stats.

**Step 5: Verify**

Run: `npx next build`

**Step 6: Commit**

```bash
git add src/app/api/catalog/
git commit -m "feat(bom): add product catalog CRUD API routes"
```

---

### Task 12: Build Product Catalog Dashboard Page

**Files:**
- Create: `src/app/dashboards/product-catalog/page.tsx`

**Step 1: Create the page**

Three-tab layout inside `<DashboardShell>`:

**Catalog Tab:**
- Fetch from `GET /api/catalog`
- Searchable table with columns: category, brand, model, description, unit cost, sell price, margin %, vendor, sync dots
- Inline editing for unitCost and sellPrice (click to edit, blur to save via PATCH)
- "Add Product" button opens creation form
- Bulk activate/deactivate via checkboxes
- Category and active/inactive filter dropdowns

**Approval Queue Tab:**
- Fetch from `GET /api/catalog/push-requests?status=PENDING`
- Table of pending requests with requester, deal context, proposed data
- Approve: opens product form pre-filled with request data
- Reject: opens reason textarea, then PATCH status to REJECTED

**Sync Health Tab:**
- Fetch from `GET /api/catalog/stats`
- Per-category cards showing: total SKUs, linked to Zoho (count + %), linked to HubSpot, linked to Zuper
- List of SKUs missing external IDs (filterable by category)

**Step 2: Add product creation form**

Either a modal or expandable form section. Fields: brand, model, description, category (dropdown with all 8 values), unit spec, unit label, vendor name, vendor part number, unit cost, sell price, target systems checkboxes.

Submit calls `POST /api/catalog` for direct creation (admin) or `POST /api/catalog/push-requests` for approval flow.

**Step 3: Verify**

Run dev server, navigate to `/dashboards/product-catalog`, verify all three tabs render.

**Step 4: Commit**

```bash
git add src/app/dashboards/product-catalog/
git commit -m "feat(bom): add product catalog dashboard with approval queue and sync health"
```

---

### Task 13: Add Pricing Columns to BOM Table

**Files:**
- Modify: `src/app/dashboards/bom/page.tsx` (the BOM table component)

**Step 1: Fetch catalog data alongside BOM**

When a BOM is loaded, also fetch `GET /api/catalog?active=true` and build a lookup map: `Map<string, EquipmentSku>` keyed by normalized `${category}-${brand}-${model}`.

**Step 2: Add columns to the BOM table**

For each BOM item, if it matches a catalog SKU:
- Show `unitCost` column
- Show `extendedCost` column (qty x unitCost)
- Show `sellPrice` column

Unmatched items show "—" with a small link/button "Add to catalog" that navigates to `/dashboards/product-catalog` with query params pre-filling the form.

**Step 3: Add a totals row**

Bottom of the table: sum of all extended costs and extended sell prices for matched items.

**Step 4: Verify and commit**

```bash
git add src/app/dashboards/bom/page.tsx
git commit -m "feat(bom): add pricing columns to BOM table with catalog matching"
```

---

### Task 14: Update BOM Extraction to Save All Categories

**Files:**
- Modify: `src/app/api/bom/save/route.ts` (or `history` route — wherever SKU sync happens)

**Step 1: Expand category sync**

Currently only syncs MODULE, INVERTER, BATTERY, EV_CHARGER to `EquipmentSku`. Update the filter to include all 8 `EquipmentCategory` values so that RAPID_SHUTDOWN, RACKING, ELECTRICAL_BOS, and MONITORING items also get persisted.

**Step 2: Map BOM category strings to enum values**

The BOM extraction uses string categories like `"RAPID_SHUTDOWN"`. Add a mapping function that converts these to the Prisma `EquipmentCategory` enum, handling any case mismatches.

**Step 3: Verify and commit**

```bash
git add src/app/api/bom/
git commit -m "feat(bom): sync all 8 equipment categories to catalog on BOM save"
```
