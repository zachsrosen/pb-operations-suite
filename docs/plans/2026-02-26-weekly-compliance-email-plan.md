# Weekly Compliance Email Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the weekly compliance email with dual-period comparison (week-over-week + 30-day baseline), per-user growth outlier tracking, and a POST API route to trigger test sends.

**Architecture:** Extend `ComplianceDigest` to fetch 3 parallel windows (7-day current, 7-day prior, 30-day). Add `baseline30Day` and `userGrowth` fields to the digest interface. Extend the HTML/text email templates to render dual trends on metric cards and a user growth table. Add `POST /api/compliance/email` route with auth gating.

**Tech Stack:** Next.js API routes, Zuper API, Resend email, next-auth session auth

---

### Task 1: Extend ComplianceDigest Interface

**Files:**
- Modify: `src/lib/compliance-digest.ts:24-66`

**Step 1: Add new types to the interface**

After the existing `callouts` field (line 65), add:

```typescript
// Add these to the ComplianceDigest interface, after callouts:

  baseline30Day: {
    completedJobs: number;
    onTimePercent: number;
    oowUsagePercent: number;
    stuckJobs: number;
  };
  userGrowth: {
    improvers: UserGrowthEntry[];
    decliners: UserGrowthEntry[];
    threshold: number;
  };
```

And add the `UserGrowthEntry` type before the `ComplianceDigest` interface:

```typescript
export interface UserGrowthEntry {
  name: string;
  team: string;
  currentScore: number;
  currentGrade: string;
  currentOnTimePercent: number;
  priorScore: number;
  priorGrade: string;
  priorOnTimePercent: number;
  scoreDelta: number;
}
```

**Step 2: Verify the file still has no TypeScript errors**

Run: `npx tsc --noEmit src/lib/compliance-digest.ts 2>&1 | head -20`

Expected: Errors about the return type of `getComplianceDigest` missing the new fields (this is expected — we'll fix in Task 2).

**Step 3: Commit**

```bash
git add src/lib/compliance-digest.ts
git commit -m "feat: extend ComplianceDigest with baseline30Day and userGrowth types"
```

---

### Task 2: Add 30-Day Window + User Growth to getComplianceDigest

**Files:**
- Modify: `src/lib/compliance-digest.ts:534-613`

**Step 1: Update getComplianceDigest to accept options**

Replace the function signature and body. Key changes:

1. Add a `threshold` parameter (default 5)
2. Build a 30-day window alongside the existing current + prior windows
3. Fetch all 3 windows in parallel
4. Analyze all 3 in parallel
5. Match users across current and prior by UID for growth calculation
6. Filter users by threshold and minimum jobs

```typescript
export async function getComplianceDigest(
  days: number,
  options?: { threshold?: number }
): Promise<ComplianceDigest> {
  if (!zuper.isConfigured()) {
    throw new Error("Zuper integration not configured");
  }

  const now = new Date();
  const safeDays = Math.max(1, Math.min(days, 90));
  const threshold = options?.threshold ?? 5;

  // Build 3 windows: current, prior (same-length), and 30-day baseline
  const currentPeriod = buildPeriod(safeDays, now);
  const priorEnd = new Date(currentPeriod.fromDate);
  priorEnd.setDate(priorEnd.getDate() - 1);
  const priorPeriod = buildPeriod(safeDays, priorEnd);
  const baselinePeriod = buildPeriod(30, now);

  // Fetch all 3 windows in parallel
  // If current window IS 30 days, reuse it for the baseline
  const is30Day = safeDays === 30;
  const [currentJobs, priorJobs, baselineJobs] = await Promise.all([
    fetchAllJobs(currentPeriod.from, currentPeriod.to),
    fetchAllJobs(priorPeriod.from, priorPeriod.to),
    is30Day ? Promise.resolve([]) : fetchAllJobs(baselinePeriod.from, baselinePeriod.to),
  ]);

  const [current, prior, baseline] = await Promise.all([
    analyzeJobs(currentJobs),
    analyzeJobs(priorJobs),
    is30Day ? Promise.resolve(null) : analyzeJobs(baselineJobs),
  ]);

  // 30-day baseline summary (reuse current if days===30)
  const baselineSummary = is30Day ? current.summary : baseline!.summary;

  // --- existing lowOowUsers logic (lines 557-566, unchanged) ---
  const lowOowUsers = current.users
    .filter((u) => u.completedJobs >= 3)
    .filter((u) => u.oowPercent < 50)
    .sort((a, b) => a.oowPercent - b.oowPercent)
    .slice(0, 10)
    .map((u) => ({ name: u.name, team: u.team, oowPercent: u.oowPercent }));

  // --- existing failingUsers logic (lines 568-578, unchanged) ---
  const failingUsers = current.users
    .filter((u) => u.totalJobs >= 3)
    .filter((u) => u.grade === "D" || u.grade === "F")
    .sort((a, b) => a.score - b.score)
    .slice(0, 10)
    .map((u) => ({ name: u.name, team: u.team, grade: u.grade, score: u.score }));

  // --- NEW: user growth calculation ---
  const priorUserMap = new Map(prior.users.map((u) => [u.uid, u]));
  const growthEntries: UserGrowthEntry[] = [];

  for (const cu of current.users) {
    if (cu.totalJobs < 3) continue;
    const pu = priorUserMap.get(cu.uid);
    if (!pu || pu.totalJobs < 3) continue;

    const scoreDelta = Math.round((cu.score - pu.score) * 10) / 10;
    if (Math.abs(scoreDelta) < threshold) continue;

    growthEntries.push({
      name: cu.name,
      team: cu.team,
      currentScore: cu.score,
      currentGrade: cu.grade,
      currentOnTimePercent:
        cu.completedJobs > 0
          ? Math.round(((cu.oowUsed / cu.completedJobs) * 100 + cu.score) / 2 * 10) / 10
          : 0,
      priorScore: pu.score,
      priorGrade: pu.grade,
      priorOnTimePercent:
        pu.completedJobs > 0
          ? Math.round(((pu.oowUsed / pu.completedJobs) * 100 + pu.score) / 2 * 10) / 10
          : 0,
      scoreDelta,
    });
  }

  // NOTE: The on-time percent for users isn't directly on the user object from analyzeJobs.
  // analyzeJobs returns score, grade, oowPercent, completedJobs, totalJobs.
  // We need to get on-time percent per user. Let's fix this in the actual implementation
  // by pulling it from the summarizeAccumulator stats that are already computed.
  // For the growth entries, we should compute on-time % from the user accumulators.
  // The simplest approach: extend the `users` array returned by analyzeJobs to include onTimePercent.

  const improvers = growthEntries
    .filter((e) => e.scoreDelta > 0)
    .sort((a, b) => b.scoreDelta - a.scoreDelta)
    .slice(0, 10);

  const decliners = growthEntries
    .filter((e) => e.scoreDelta < 0)
    .sort((a, b) => a.scoreDelta - b.scoreDelta)
    .slice(0, 10);

  return {
    period: { from: currentPeriod.from, to: currentPeriod.to, days: safeDays },
    summary: {
      totalJobs: current.summary.totalJobs,
      completedJobs: current.summary.completedJobs,
      onTimePercent: current.summary.onTimePercent,
      oowUsagePercent: current.summary.oowUsagePercent,
      stuckJobs: current.summary.stuckJobs,
      unknownCompletionJobs: current.summary.unknownCompletionJobs,
    },
    priorPeriod: {
      completedJobs: prior.summary.completedJobs,
      onTimePercent: prior.summary.onTimePercent,
      oowUsagePercent: prior.summary.oowUsagePercent,
      stuckJobs: prior.summary.stuckJobs,
    },
    baseline30Day: {
      completedJobs: baselineSummary.completedJobs,
      onTimePercent: baselineSummary.onTimePercent,
      oowUsagePercent: baselineSummary.oowUsagePercent,
      stuckJobs: baselineSummary.stuckJobs,
    },
    teams: current.teams,
    categories: current.categories,
    notificationReliability: {
      oowBeforeStartPercent: current.summary.oowBeforeStartPercent,
      startedOnTimePercent: current.summary.startedOnTimePercent,
      lowOowUsers,
    },
    callouts: {
      stuckOver3Days: current.callouts.stuckOver3Days,
      failingUsers,
      unknownCompletionJobs: current.callouts.unknownCompletionJobs,
    },
    userGrowth: { improvers, decliners, threshold },
  };
}
```

**Step 2: Add `onTimePercent` to the user object returned by `analyzeJobs`**

In the `analyzeJobs` function (around line 477-492), the `users` array construction already calls `summarizeAccumulator(acc)` which returns `onTimePercent`. Add it to the returned shape:

In `analyzeJobs`, modify the users mapping (line ~477-492) to include `onTimePercent`:

```typescript
  const users = Array.from(userMap.entries())
    .map(([uid, acc]) => {
      const stats = summarizeAccumulator(acc);
      return {
        uid,
        name: acc.name,
        team: acc.teamNames.size > 0 ? Array.from(acc.teamNames).sort().join(", ") : "Unassigned",
        completedJobs: acc.completedJobs,
        onTimePercent: stats.onTimePercent,  // ADD THIS LINE
        oowUsed: acc.oowUsed,
        oowPercent: stats.oowUsagePercent,
        score: stats.score,
        grade: stats.grade,
        totalJobs: acc.totalJobs,
      };
    })
    .sort((a, b) => b.score - a.score);
```

Then in the growth calculation, use `cu.onTimePercent` and `pu.onTimePercent` directly instead of the approximation.

**Step 3: Verify no TypeScript errors**

Run: `npx tsc --noEmit 2>&1 | grep compliance-digest | head -20`

Expected: Clean (no errors from compliance-digest.ts). There may be errors in email.ts since we haven't updated the template yet.

**Step 4: Commit**

```bash
git add src/lib/compliance-digest.ts
git commit -m "feat: fetch 3 parallel windows and compute user growth in digest"
```

---

### Task 3: Extend Email HTML Template with Dual Trends

**Files:**
- Modify: `src/lib/email.ts:1239-1452` (buildWeeklyComplianceEmailHtml)

**Step 1: Add baseline trend calculations**

After line 1249 (where `completedTrend` is computed), add baseline trends:

```typescript
  // 30-day baseline trends
  const onTimeBaseline = getTrend(digest.summary.onTimePercent, digest.baseline30Day.onTimePercent, true);
  const oowBaseline = getTrend(digest.summary.oowUsagePercent, digest.baseline30Day.oowUsagePercent, true);
  const stuckBaseline = getTrend(digest.summary.stuckJobs, digest.baseline30Day.stuckJobs, false);
  const completedBaseline = getTrend(digest.summary.completedJobs, digest.baseline30Day.completedJobs, true);
```

**Step 2: Update metricCard helper to show dual trends**

Replace the `metricCard` function (lines 1277-1285) to accept a second trend:

```typescript
  const metricCard = (
    label: string,
    value: string,
    trend: { arrow: string; color: string; deltaLabel: string },
    baseline: { arrow: string; color: string; deltaLabel: string }
  ) => `
    <td style="width: 25%; padding: 10px;">
      <div style="background:#12121a; border:1px solid #1e1e2e; border-radius:10px; padding:12px;">
        <div style="color:#a1a1aa; font-size:12px; margin-bottom:6px;">${label}</div>
        <div style="color:#ffffff; font-size:24px; font-weight:700; margin-bottom:4px;">${value}</div>
        <div style="font-size:12px; color:${trend.color};">${trend.arrow} ${trend.deltaLabel} vs prior week</div>
        <div style="font-size:11px; color:${baseline.color}; margin-top:2px;">${baseline.arrow} ${baseline.deltaLabel} vs 30-day avg</div>
      </div>
    </td>
  `;
```

**Step 3: Update metricCard calls to pass baseline**

Update the 4 metric card calls (around line 1386-1389) to include baseline as second arg:

```typescript
  ${metricCard("On-Time Completion", formatCompliancePercent(digest.summary.onTimePercent), onTimeTrend, onTimeBaseline)}
  ${metricCard("OOW Usage", formatCompliancePercent(digest.summary.oowUsagePercent), oowTrend, oowBaseline)}
  ${metricCard("Stuck Jobs", `${digest.summary.stuckJobs}`, stuckTrend, stuckBaseline)}
  ${metricCard("Completed Jobs", `${digest.summary.completedJobs}`, completedTrend, completedBaseline)}
```

**Step 4: Commit**

```bash
git add src/lib/email.ts
git commit -m "feat: add 30-day baseline trend line to email metric cards"
```

---

### Task 4: Add User Growth Section to HTML Email

**Files:**
- Modify: `src/lib/email.ts:1434-1447` (insert before the CTA button)

**Step 1: Build user growth HTML**

Insert the following BEFORE the CTA button link (before line 1444 `<a href="`):

```typescript
  const growthTableRow = (entry: ComplianceDigest["userGrowth"]["improvers"][0], isImprover: boolean) => {
    const deltaColor = isImprover ? "#22c55e" : "#ef4444";
    const deltaSign = entry.scoreDelta > 0 ? "+" : "";
    return `
      <tr>
        <td style="padding:8px; border-top:1px solid #1e1e2e;">${escapeHtml(entry.name)}</td>
        <td style="padding:8px; border-top:1px solid #1e1e2e;">${escapeHtml(entry.team)}</td>
        <td style="padding:8px; border-top:1px solid #1e1e2e;">${entry.priorGrade} → ${entry.currentGrade}</td>
        <td style="padding:8px; border-top:1px solid #1e1e2e;">${formatCompliancePercent(entry.priorOnTimePercent)} → ${formatCompliancePercent(entry.currentOnTimePercent)}</td>
        <td style="padding:8px; border-top:1px solid #1e1e2e; color:${deltaColor}; font-weight:700;">${deltaSign}${entry.scoreDelta}</td>
      </tr>
    `;
  };

  const growthTableHeaders = `
    <thead style="background:#12121a; color:#a1a1aa;">
      <tr>
        <th align="left" style="padding:8px;">Name</th>
        <th align="left" style="padding:8px;">Team</th>
        <th align="left" style="padding:8px;">Grade</th>
        <th align="left" style="padding:8px;">On-Time %</th>
        <th align="left" style="padding:8px;">Score Δ</th>
      </tr>
    </thead>
  `;

  const improversHtml = digest.userGrowth.improvers.length === 0
    ? `<p style="color:#a1a1aa; font-size:13px;">No significant improvements this period.</p>`
    : `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #1e1e2e; border-radius:8px; overflow:hidden; font-size:13px;">
        ${growthTableHeaders}
        <tbody>${digest.userGrowth.improvers.map((e) => growthTableRow(e, true)).join("")}</tbody>
      </table>`;

  const declinersHtml = digest.userGrowth.decliners.length === 0
    ? `<p style="color:#a1a1aa; font-size:13px;">No significant declines this period.</p>`
    : `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #1e1e2e; border-radius:8px; overflow:hidden; font-size:13px;">
        ${growthTableHeaders}
        <tbody>${digest.userGrowth.decliners.map((e) => growthTableRow(e, false)).join("")}</tbody>
      </table>`;

  const userGrowthSection = `
    <h2 style="font-size:16px; margin:18px 0 8px;">User Growth (≥${digest.userGrowth.threshold}pt change)</h2>
    <p style="margin:0 0 6px 0; color:#22c55e; font-size:13px;">Most Improved</p>
    ${improversHtml}
    <p style="margin:14px 0 6px 0; color:#ef4444; font-size:13px;">Biggest Declines</p>
    ${declinersHtml}
  `;
```

Then insert `${userGrowthSection}` into the HTML template string just before the CTA button.

**Step 2: Commit**

```bash
git add src/lib/email.ts
git commit -m "feat: add user growth section to compliance email HTML"
```

---

### Task 5: Update Plain Text Email with Baseline + Growth

**Files:**
- Modify: `src/lib/email.ts:1454-1512` (buildWeeklyComplianceEmailText)

**Step 1: Add baseline comparison lines to the summary section**

After the existing summary metrics (around line 1463), add:

```typescript
  lines.push("");
  lines.push("30-Day Baseline Comparison:");
  lines.push(`  On-Time: ${formatCompliancePercent(digest.summary.onTimePercent)} (current) vs ${formatCompliancePercent(digest.baseline30Day.onTimePercent)} (30-day avg)`);
  lines.push(`  OOW Usage: ${formatCompliancePercent(digest.summary.oowUsagePercent)} vs ${formatCompliancePercent(digest.baseline30Day.oowUsagePercent)}`);
  lines.push(`  Stuck Jobs: ${digest.summary.stuckJobs} vs ${digest.baseline30Day.stuckJobs}`);
  lines.push(`  Completed: ${digest.summary.completedJobs} vs ${digest.baseline30Day.completedJobs}`);
```

**Step 2: Add user growth section to the text email**

Before the final dashboard link, add:

```typescript
  if (digest.userGrowth.improvers.length > 0 || digest.userGrowth.decliners.length > 0) {
    lines.push("");
    lines.push(`User Growth (>=${digest.userGrowth.threshold}pt change):`);
    if (digest.userGrowth.improvers.length > 0) {
      lines.push("  Most Improved:");
      for (const u of digest.userGrowth.improvers) {
        lines.push(`  - ${u.name} (${u.team}): ${u.priorGrade} → ${u.currentGrade}, score +${u.scoreDelta}`);
      }
    }
    if (digest.userGrowth.decliners.length > 0) {
      lines.push("  Biggest Declines:");
      for (const u of digest.userGrowth.decliners) {
        lines.push(`  - ${u.name} (${u.team}): ${u.priorGrade} → ${u.currentGrade}, score ${u.scoreDelta}`);
      }
    }
  }
```

**Step 3: Commit**

```bash
git add src/lib/email.ts
git commit -m "feat: add baseline comparison and user growth to plain text email"
```

---

### Task 6: Create POST /api/compliance/email Route

**Files:**
- Create: `src/app/api/compliance/email/route.ts`

**Step 1: Create the route file**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { getComplianceDigest } from "@/lib/compliance-digest";
import { sendWeeklyComplianceEmail } from "@/lib/email";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const user = await getUserByEmail(session.user.email);
  if (!user || !["ADMIN", "OWNER"].includes(user.role)) {
    return NextResponse.json({ error: "Admin or Owner access required" }, { status: 403 });
  }

  let body: { to?: string; days?: number; threshold?: number } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const to = body.to?.trim();
  if (!to || !to.includes("@")) {
    return NextResponse.json({ error: "Valid 'to' email address required" }, { status: 400 });
  }

  const days = Math.max(1, Math.min(90, Math.floor(Number(body.days) || 7)));
  const threshold = Math.max(1, Math.min(50, Math.floor(Number(body.threshold) || 5)));

  try {
    const digest = await getComplianceDigest(days, { threshold });
    const result = await sendWeeklyComplianceEmail({ to, digest });

    return NextResponse.json({
      success: result.success,
      error: result.error,
      period: digest.period,
      summary: digest.summary,
      baseline30Day: digest.baseline30Day,
      userGrowth: {
        improvers: digest.userGrowth.improvers.length,
        decliners: digest.userGrowth.decliners.length,
        threshold: digest.userGrowth.threshold,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/compliance/email/route.ts
git commit -m "feat: add POST /api/compliance/email route for triggering test sends"
```

---

### Task 7: Update send-weekly-compliance.ts Script

**Files:**
- Modify: `scripts/send-weekly-compliance.ts:60`

**Step 1: Pass threshold option to getComplianceDigest**

The script currently calls `getComplianceDigest(days)`. Update to pass threshold:

```typescript
  const threshold = Number(process.env.COMPLIANCE_REPORT_THRESHOLD || "5");
  const digest = await getComplianceDigest(days, { threshold });
```

**Step 2: Commit**

```bash
git add scripts/send-weekly-compliance.ts
git commit -m "feat: pass threshold option to compliance digest in CLI script"
```

---

### Task 8: Build Check + Test Send

**Step 1: Run the build to catch any TypeScript/compilation errors**

Run: `npx next build 2>&1 | tail -30`

Expected: Build succeeds. Fix any errors.

**Step 2: Test the API route by sending an email**

Start the dev server, then hit the endpoint:

```bash
curl -X POST http://localhost:3000/api/compliance/email \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{"to":"zach@photonbrothers.com","days":7,"threshold":5}'
```

Or use the browser console while logged in:
```javascript
fetch('/api/compliance/email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ to: 'zach@photonbrothers.com', days: 7, threshold: 5 })
}).then(r => r.json()).then(console.log)
```

Expected: `{ success: true, period: {...}, summary: {...}, baseline30Day: {...}, userGrowth: {...} }`

**Step 3: Check the email in inbox**

Verify:
- 4 metric cards show dual trend lines (week-over-week + 30-day baseline)
- User Growth section appears with improvers/decliners tables
- All existing sections (teams, categories, callouts) still render correctly

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address any issues from build/test"
```
