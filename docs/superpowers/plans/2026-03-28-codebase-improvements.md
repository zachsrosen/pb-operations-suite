# Codebase Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address security, performance, and DX issues identified in the March 2026 codebase review — prioritizing performance wins.

**Architecture:** Incremental fixes organized into 4 independent chunks. No structural refactors — each task is a targeted edit to existing files. Performance fixes focus on parallelizing API calls, tuning refetch intervals, adding missing DB indexes, and memoizing expensive render-path computations.

**Tech Stack:** Next.js 16, React 19, Prisma 7, TypeScript 5, React Query v5

---

## Chunk 1: Security Fixes

### Task 1: Redact private key in debug endpoint

The debug notifications endpoint truncates sensitive env vars to show the first 6 characters. For private keys this could leak material. Note: the existing `val.length > 50` guard on line 36 already prevents the leak for long keys, but adding an explicit `PRIVATE_KEY` check is defense-in-depth against future changes to that guard.

**Files:**
- Modify: `src/app/api/debug/notifications/route.ts:38-39`

- [ ] **Step 1: Edit the `checkEnv` function to fully redact private keys**

In `src/app/api/debug/notifications/route.ts`, replace lines 38-39:

```typescript
// Before:
    if (name.includes("KEY") || name.includes("SECRET") || name.includes("PRIVATE")) {
      return `�� set (${val.length} chars, starts with "${val.slice(0, 6)}…")`;
    }

// After:
    if (name.includes("PRIVATE_KEY")) {
      return `✅ set (${val.length} chars)`;
    }
    if (name.includes("KEY") || name.includes("SECRET") || name.includes("PRIVATE")) {
      return `✅ set (${val.length} chars, starts with "${val.slice(0, 6)}…")`;
    }
```

The new guard catches `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (line 47) and omits the prefix entirely. Other keys/secrets still show the 6-char prefix for debugging convenience.

- [ ] **Step 2: Verify the fix**

Run: `grep -n "PRIVATE_KEY" src/app/api/debug/notifications/route.ts`
Expected: The new `name.includes("PRIVATE_KEY")` guard appears before the general KEY/SECRET guard.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/debug/notifications/route.ts
git commit -m "fix(security): fully redact private key values in debug endpoint"
```

---

### Task 2: Provision a dedicated auth secret and remove unsafe fallbacks

The `getSecretKey()` function in `lib/auth.ts` falls back through 4 env vars including `RESEND_API_KEY` and `SITE_PASSWORD`. These are unrelated secrets and should not be used for token encryption. However, the current workspace `.env` contains `RESEND_API_KEY`/`SITE_PASSWORD` but **not** `AUTH_TOKEN_SECRET` or `NEXTAUTH_SECRET`. Removing the fallback without provisioning a real secret first would break verification-token flows and invalidate in-flight tokens.

**Files:**
- Modify: `.env` (local) and Vercel env vars
- Modify: `src/lib/auth.ts:6-15`

- [ ] **Step 1: Generate and provision AUTH_TOKEN_SECRET in all environments**

Generate a secure random secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add the output to:
1. **Local `.env`**: `AUTH_TOKEN_SECRET=<generated>`
2. **Vercel production + preview**: `vercel env add AUTH_TOKEN_SECRET` (or via Vercel dashboard)

**IMPORTANT:** The derived key will change when `AUTH_TOKEN_SECRET` is used instead of `RESEND_API_KEY`. Any in-flight verification codes minted with the old key will fail validation. Coordinate this deploy during low-traffic hours or accept that a handful of active login codes may need to be re-sent.

- [ ] **Step 2: Verify the new secret resolves before changing code**

Run: `node -e "require('dotenv').config(); console.log(!!process.env.AUTH_TOKEN_SECRET)"`
Expected: `true`

- [ ] **Step 3: Remove the unsafe fallbacks from the code**

In `src/lib/auth.ts`, replace lines 6-15:

```typescript
// Before:
const getSecretKey = (): Buffer => {
  const base =
    process.env.AUTH_TOKEN_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.RESEND_API_KEY ||
    process.env.SITE_PASSWORD;
  if (!base) {
    throw new Error("Missing auth secret. Set AUTH_TOKEN_SECRET (recommended) or NEXTAUTH_SECRET.");
  }
  return crypto.createHash("sha256").update(base + "-pb-auth-secret-v2").digest();

// After:
const getSecretKey = (): Buffer => {
  const base =
    process.env.AUTH_TOKEN_SECRET ||
    process.env.NEXTAUTH_SECRET;
  if (!base) {
    throw new Error("Missing auth secret. Set AUTH_TOKEN_SECRET (recommended) or NEXTAUTH_SECRET.");
  }
  return crypto.createHash("sha256").update(base + "-pb-auth-secret-v2").digest();
```

- [ ] **Step 4: Commit (do NOT commit .env)**

```bash
git add src/lib/auth.ts
git commit -m "fix(security): remove non-auth secrets from token key fallback chain

BREAKING: Requires AUTH_TOKEN_SECRET or NEXTAUTH_SECRET in all environments.
In-flight verification codes minted with the old derived key will be invalidated."
```

---

### Task 3: Add recovery code to admin fix-role endpoint

The `/api/admin/fix-role` endpoint only requires an env flag + hardcoded email. Add a second factor via a recovery code in the request body.

**Files:**
- Modify: `src/app/api/admin/fix-role/route.ts:10-14`

- [ ] **Step 1: Add recovery code validation after the kill-switch check**

In `src/app/api/admin/fix-role/route.ts`, after line 14 (`}`), add:

```typescript
  // Require a recovery code as a second factor
  const recoveryCode = process.env.ADMIN_RECOVERY_CODE;
  if (!recoveryCode) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
```

Then modify the POST function signature to accept the request:

```typescript
// Before (line 10):
export async function POST() {

// After:
export async function POST(request: Request) {
```

And after the email whitelist check (after line 31, the `adminEmails.includes` block), add:

```typescript
  const body = await request.json().catch(() => ({}));
  if (body.recoveryCode !== recoveryCode) {
    return NextResponse.json({ error: "Invalid recovery code" }, { status: 403 });
  }
```

This ordering ensures: kill switch → auth → email whitelist → recovery code. The body is only parsed for whitelisted users.

- [ ] **Step 2: Commit**

```bash
git add src/app/api/admin/fix-role/route.ts
git commit -m "fix(security): require ADMIN_RECOVERY_CODE for role recovery endpoint"
```

---

## Chunk 2: Performance — API & Database

### Task 4: Parallelize HubSpot pipeline searches in deal-import

The deal-import route searches 3 pipelines sequentially. Wrap in `Promise.allSettled()` for ~3x latency reduction.

**Files:**
- Modify: `src/app/api/accounting/pricing-calculator/deal-import/route.ts:35-76`

- [ ] **Step 1: Replace the sequential for-loop with parallel execution**

In `src/app/api/accounting/pricing-calculator/deal-import/route.ts`, replace the loop at lines 35-76 with:

```typescript
  const searchPromises = pipelineKeys
    .filter((pKey) => PIPELINE_IDS[pKey])
    .map(async (pKey) => {
      const pipelineId = PIPELINE_IDS[pKey];
      const response = await searchWithRetry({
        filterGroups: [
          {
            filters: [
              {
                propertyName: "dealname",
                operator: FilterOperatorEnum.ContainsToken,
                value: `*${query}*`,
              },
              {
                propertyName: "pipeline",
                operator: FilterOperatorEnum.Eq,
                value: pipelineId,
              },
            ],
          },
        ],
        properties: SEARCH_PROPERTIES,
        sorts: [
          { propertyName: "dealname", direction: "ASCENDING" },
        ] as unknown as string[],
        limit: 10,
      });

      const stageMap = stageMaps[pKey] || {};
      return response.results.map((deal) => {
        const props = deal.properties;
        return {
          dealId: String(props.hs_object_id),
          dealName: String(props.dealname || ""),
          amount: props.amount ? parseFloat(String(props.amount)) : null,
          location: normalizeLocation(String(props.pb_location || "")),
          stageLabel:
            stageMap[String(props.dealstage || "")] ||
            String(props.dealstage || ""),
          pipeline: pKey,
        };
      });
    });

  const results = await Promise.allSettled(searchPromises);
  for (const result of results) {
    if (result.status === "fulfilled") {
      allResults.push(...result.value);
    }
  }
```

This preserves the existing error-tolerance behavior (one pipeline failing doesn't block others) while running all searches concurrently.

- [ ] **Step 2: Verify the route still compiles**

Run: `npx tsc --noEmit 2>&1 | grep -i "deal-import" | head -10`
Expected: No errors referencing deal-import. (Do not pass a single file to `tsc` — it ignores tsconfig paths.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/accounting/pricing-calculator/deal-import/route.ts
git commit -m "perf: parallelize HubSpot pipeline searches in deal-import route"
```

---

### Task 5: Add missing database index on SolarFeedback.status

The `SolarFeedback` model is filtered by `status` in API queries but has no index on that column, causing full table scans.

**Files:**
- Modify: `prisma/schema.prisma` (SolarFeedback model, line ~1595)

- [ ] **Step 1: Add compound index on [status, createdAt]**

In `prisma/schema.prisma`, in the `SolarFeedback` model after line 1595 (`@@index([createdAt])`), add:

```prisma
  @@index([status, createdAt])
```

This supports both `WHERE status = X` filtering and `ORDER BY createdAt` sorting in a single index.

- [ ] **Step 2: Generate migration**

Run: `npx prisma migrate dev --name add-solar-feedback-status-index`
Expected: Migration created successfully.

- [ ] **Step 3: Verify Prisma client regenerates**

Run: `npx prisma generate`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "perf: add index on SolarFeedback(status, createdAt) for filtered queries"
```

---

### Task 6: Add safety cap with warning to equipment query

The solar equipment route fetches all non-archived custom equipment with no `take` limit. The endpoint is documented as "List all equipment" and callers expect the full set, so a silent `take: 200` would be a correctness regression. Instead, add a high safety cap (1000) with a `hasMore` flag so callers know if they're seeing a truncated set.

**Files:**
- Modify: `src/app/api/solar/equipment/route.ts:46-49`

- [ ] **Step 1: Add safety cap with overflow indicator**

In `src/app/api/solar/equipment/route.ts`, change lines 46-49:

```typescript
// Before:
  const custom = await prisma.solarCustomEquipment.findMany({
    where: { isArchived: false },
    orderBy: { createdAt: "desc" },
  });

// After:
  const SAFETY_CAP = 1000;
  const custom = await prisma.solarCustomEquipment.findMany({
    where: { isArchived: false },
    orderBy: { createdAt: "desc" },
    take: SAFETY_CAP + 1,
  });
  const hasMore = custom.length > SAFETY_CAP;
  if (hasMore) custom.pop();
```

Then in the JSON response for this route, add `hasMore` to the returned payload alongside the existing `custom` array. Find the `NextResponse.json(...)` call that returns custom equipment and add `hasMore`:

```typescript
// Add hasMore to the response object alongside existing fields
return NextResponse.json({ ..., custom, hasMore });
```

This fetches N+1 to detect overflow, pops the extra, and signals to callers. The table is unlikely to hit 1000 custom equipment entries, but the guard prevents unbounded memory growth without silently dropping data.

- [ ] **Step 2: Commit**

```bash
git add src/app/api/solar/equipment/route.ts
git commit -m "perf: add safety cap with hasMore flag to equipment query"
```

---

### Task 7: Tier refetch intervals by data volatility

12+ dashboards poll every 5 minutes regardless of how often their data changes. Tiering these reduces API load by ~60% without degrading UX.

**Files:**
- Modify: Multiple dashboard pages (see list below)

- [ ] **Step 1: Reduce interval for low-volatility dashboards to 15 minutes**

These dashboards show aggregate/historical data that rarely changes within 5 minutes:

| File | Line | Current | New |
|------|------|---------|-----|
| `src/app/dashboards/forecast-schedule/page.tsx` | 84 | `5 * 60 * 1000` | `15 * 60 * 1000` |
| `src/app/dashboards/qc/page.tsx` | 94 | `5 * 60 * 1000` | `15 * 60 * 1000` |
| `src/app/dashboards/optimizer/page.tsx` | 413 | `5 * 60 * 1000` | `15 * 60 * 1000` |
| `src/app/dashboards/survey-metrics/page.tsx` | 175 | `5 * 60 * 1000` | `15 * 60 * 1000` |
| `src/app/dashboards/construction-metrics/page.tsx` | 108 | `5 * 60 * 1000` | `15 * 60 * 1000` |
| `src/app/dashboards/inspection-metrics/page.tsx` | 202 | `5 * 60 * 1000` | `15 * 60 * 1000` |

In each file, replace `refetchInterval: 5 * 60 * 1000` with `refetchInterval: 15 * 60 * 1000`.

- [ ] **Step 2: Keep 5-minute interval for active scheduling dashboards**

These dashboards show real-time scheduling state and should stay at 5 minutes (no change needed):

- `src/app/dashboards/scheduler/page.tsx` (lines 942, 1008)
- `src/app/dashboards/construction-scheduler/page.tsx` (lines 485, 547)
- `src/app/dashboards/inspection-scheduler/page.tsx` (line 425)
- `src/app/dashboards/availability-approvals/page.tsx` (already 30s — active approvals)
- `src/app/dashboards/inventory/page.tsx` (4 queries at 5 min — active stock tracking)

No changes to these files.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/forecast-schedule/page.tsx \
        src/app/dashboards/qc/page.tsx \
        src/app/dashboards/optimizer/page.tsx \
        src/app/dashboards/survey-metrics/page.tsx \
        src/app/dashboards/construction-metrics/page.tsx \
        src/app/dashboards/inspection-metrics/page.tsx
git commit -m "perf: tier refetch intervals — 15 min for low-volatility dashboards"
```

---

## Chunk 3: Performance — Client-Side Rendering

### Task 8: Memoize sales funnel stage-value computation

The Sales Funnel chart filters and reduces `activeDeals` per stage on every render — O(deals * stages). Pre-compute a map in `useMemo`.

**Files:**
- Modify: `src/app/dashboards/sales/page.tsx:264-268`

- [ ] **Step 1: Add a useMemo for stage values above the JSX**

Find the `ACTIVE_STAGES.map` block (around line 264). Above it, add a memoized lookup:

```typescript
  const stageValues = useMemo(() => {
    const map = new Map<string, number>();
    for (const deal of activeDeals) {
      map.set(deal.stage, (map.get(deal.stage) || 0) + deal.amount);
    }
    return map;
  }, [activeDeals]);
```

Then in the `.map()` callback, replace lines 266-268:

```typescript
// Before:
            const value = activeDeals
              .filter((d) => d.stage === stage)
              .reduce((sum, d) => sum + d.amount, 0);

// After:
            const value = stageValues.get(stage) || 0;
```

Ensure `useMemo` is imported from React at the top of the file.

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/sales/page.tsx
git commit -m "perf: memoize sales funnel stage-value computation"
```

---

### Task 9: Extract relativeTime as a stable function in inventory dashboard

The `relativeTime` function is recreated on every render inside the component. Since it only depends on `nowMs` (which is stable per render), extract it outside or wrap in `useCallback`.

**Note:** This file contains TWO different `relativeTime` functions:
1. **Line ~155** (`SortOverviewTab`): Returns `{ text: string; isStale: boolean }` with day granularity
2. **Line ~500** (`ReceiveAdjustTab`): Returns `string` with minute/hour granularity and different signature `(dateStr: string) => string`

Only extract the first one (line ~155). The second has a different purpose and signature — leave it as-is.

**Files:**
- Modify: `src/app/dashboards/inventory/page.tsx:155-163`

- [ ] **Step 1: Move the first relativeTime (line ~155) outside its component**

Extract the function above the `SortOverviewTab` component definition as a pure utility:

```typescript
function relativeTime(dateStr: string | null, nowMs: number): { text: string; isStale: boolean } {
  if (!dateStr) return { text: "Never", isStale: true };
  const diff = nowMs - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days > 30) return { text: "30+ days", isStale: true };
  if (days === 0) return { text: "Today", isStale: false };
  if (days === 1) return { text: "1 day ago", isStale: false };
  return { text: `${days} days ago`, isStale: false };
}
```

Then update call sites inside `SortOverviewTab` to pass `nowMs` explicitly:

```typescript
// Before:
const counted = relativeTime(row.lastCountedAt);

// After:
const counted = relativeTime(row.lastCountedAt, nowMs);
```

Do NOT touch the second `relativeTime` function in `ReceiveAdjustTab` (~line 500).

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/inventory/page.tsx
git commit -m "perf: extract relativeTime as pure function in inventory dashboard"
```

---

## Chunk 4: DX Improvements

### Task 10: Ratchet Jest coverage thresholds

The global coverage threshold is 10% — too low to catch regressions. Raise to match current actual coverage so it acts as a ratchet.

**Prerequisite:** The test suite must be fully passing before this task can produce trustworthy numbers. If `npm run test` has unrelated failures, **skip this task entirely** — setting thresholds from a broken run produces incorrect floors. Fix the red tests first (separate effort), then return here.

**Files:**
- Modify: `jest.config.ts:27-34`

- [ ] **Step 1: Verify test suite is green**

Run: `npm run test 2>&1 | tail -5`

If there are failures, **STOP — do not proceed with this task.** Move to Task 11.

- [ ] **Step 2: Run coverage to measure current levels**

Run: `npm run test -- --coverage 2>&1 | tail -20`

Note the actual values for branches, functions, lines, and statements.

- [ ] **Step 3: Set thresholds to floor of measured values**

In `jest.config.ts`, replace lines 27-34. Set each threshold to `floor(measured_value)`:

```typescript
  coverageThreshold: {
    global: {
      branches: <floor of measured branches>,
      functions: <floor of measured functions>,
      lines: <floor of measured lines>,
      statements: <floor of measured statements>,
    },
  },
```

For example, if measured: Lines 13.17%, Branches 8.74%, Functions 8.55%, Statements 12.65% → use `branches: 8, functions: 8, lines: 13, statements: 12`.

- [ ] **Step 4: Verify tests pass with new thresholds**

Run: `npm run test -- --coverage 2>&1 | tail -20`
Expected: All thresholds met.

- [ ] **Step 5: Commit**

```bash
git add jest.config.ts
git commit -m "chore: ratchet Jest coverage thresholds to prevent regression"
```

---

### Task 11: Enable noUnusedLocals in tsconfig

Catches dead local variables at compile time. Starting with `noUnusedLocals` only — `noUnusedParameters` produces ~96 additional violations across 50+ files and should be a separate effort.

**Files:**
- Modify: `tsconfig.json`
- Modify: Multiple source files (violation fixes)

- [ ] **Step 1: Add noUnusedLocals flag**

In `tsconfig.json`, after `"strict": true` (line 7), add:

```json
    "noUnusedLocals": true,
```

- [ ] **Step 2: Run type check to see existing violations**

Run: `npx tsc --noEmit 2>&1 | grep "TS6133\|TS6196" | wc -l`

This shows the count of unused-local errors. Expect 20-40 violations. If the count exceeds 50, consider scoping to `src/lib/` and `src/app/api/` only via a separate tsconfig.

- [ ] **Step 3: Fix violations found**

For each violation, choose the minimal fix:
- Unused local variable → remove it
- Unused import → remove it
- Variable used only for side effects → prefix with `_`

Do NOT add `noUnusedParameters` in this task — that is a larger effort for a future plan.

- [ ] **Step 4: Verify clean compile**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: No errors (or only pre-existing non-unused errors).

- [ ] **Step 5: Commit**

```bash
git add tsconfig.json
git add -u  # Stage all tracked modified files
git commit -m "chore: enable noUnusedLocals, fix violations"
```

---

### Task 12: Extend ESLint config with practical rules

The current config only extends Next.js defaults. Add rules that catch real bugs.

**Files:**
- Modify: `eslint.config.mjs`

- [ ] **Step 1: Add custom rules**

Replace the contents of `eslint.config.mjs`:

```javascript
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Catch unused variables (allow underscore-prefixed)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Warn on console.log left in production code (allow warn/error)
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
```

- [ ] **Step 2: Run lint to see current violations**

Run: `npm run lint 2>&1 | tail -30`

**Expect a large volume of `no-console` warnings** — the codebase uses `console.log` extensively in `zuper.ts` (30+), `bom-pipeline.ts`, and many API routes. These are intentionally set as warnings (not errors) so they don't block builds or CI. They serve as a backlog indicator for future cleanup. Do NOT attempt to fix all warnings in this task.

- [ ] **Step 3: Commit**

```bash
git add eslint.config.mjs
git commit -m "chore: extend ESLint with no-unused-vars and no-console rules"
```

---

## Post-Plan: Deferred Items (Future Plans)

These items from the review are significant but too large for this plan. Each should get its own dedicated plan:

1. **Split `lib/hubspot.ts` (~2600 lines)** into `hubspot-client`, `hubspot-deals`, `hubspot-line-items`, `hubspot-products`
2. **Split `lib/zuper.ts` (~1800 lines)** into `zuper-api`, `zuper-jobs`, `zuper-scheduling`, `zuper-transforms`
3. **Extract shared API error handler** — centralize the try/catch → 500 pattern across 30+ routes
4. **Add proper TypeScript interfaces** for Zuper and HubSpot API responses (eliminate 15+ `as any` casts)
5. **Add test coverage** for `bom-extract.ts`, `bom-history.ts`, `bom-customer-resolve.ts`
6. **Scope machine token access** — replace blanket ADMIN role for `API_SECRET_TOKEN` with per-route permissions
7. **Enable `noUnusedParameters`** in tsconfig — ~96 violations across 50+ files, needs systematic file-by-file cleanup
8. **Clean up `console.log` in production code** — replace with structured logging (Sentry breadcrumbs or Pino), especially in `zuper.ts` and `bom-pipeline.ts`

---

## Final Verification

After all tasks are complete:

- [ ] Run full type check: `npx tsc --noEmit`
- [ ] Run tests: `npm run test`
- [ ] Run lint: `npm run lint`
- [ ] Run build: `npm run build`
