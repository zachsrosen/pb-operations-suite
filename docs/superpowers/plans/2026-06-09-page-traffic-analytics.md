# Page Traffic Analytics Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an admin-only "Page Traffic" analytics view that shows per-page/per-suite views, unique users, clicks, real dwell time, dead-weight pages, and per-user usage — built on the existing `ActivityLog` table plus new dwell tracking.

**Architecture:** Live aggregation (query-on-read) over `ActivityLog`. A pure `lib/page-traffic.ts` module does path normalization, suite mapping, and aggregation (unit-tested with synthetic rows); a thin DB wrapper queries Prisma. New dwell tracking emits a `PAGE_DWELL` activity on page exit via `navigator.sendBeacon`. UI follows the existing admin-tooling pattern: a `"use client"` page at `/admin/page-traffic` using the `admin-shell` component family + a `GET /api/admin/page-traffic` route. One additive Prisma migration adds the `PAGE_DWELL` enum value and a `(type, createdAt)` composite index.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Prisma 7 (Postgres/Neon), Jest (ts-jest, jsdom), Tailwind v4 theme tokens, `admin-shell` components.

**Spec:** `docs/superpowers/specs/2026-06-09-page-traffic-analytics-design.md`

---

## File Structure

**Create:**
- `src/lib/page-traffic.ts` — path normalization, `PATH_TO_SUITE`/`KNOWN_PAGES`, pure `aggregatePageTraffic`, DB wrapper `getPageTraffic`, shared types
- `src/__tests__/page-traffic.test.ts` — unit tests for the pure functions + drift test
- `src/__tests__/page-traffic-aggregate.test.ts` — unit tests for `aggregatePageTraffic` against synthetic rows
- `src/app/api/admin/page-traffic/route.ts` — `GET` endpoint
- `src/app/admin/page-traffic/page.tsx` — admin UI page
- `prisma/migrations/<timestamp>_add_page_dwell_activity_and_index/migration.sql` — additive migration

**Modify:**
- `prisma/schema.prisma` — add `PAGE_DWELL` enum value; add `@@index([type, createdAt])`; update `durationMs` comment
- `src/hooks/useActivityTracking.ts` — add `trackPageDwell(path, durationMs)` (beacon)
- `src/components/PageViewTracker.tsx` — measure dwell on route change + tab hide, fire `trackPageDwell`
- `src/app/api/activity/log/route.ts` — `getActionActivityType` + POST `switch` handle `page_dwell`; skip anomaly scoring for it
- `src/components/admin-shell/nav.ts` — add "Page traffic" item to the Audit group

---

## Chunk 1: Data model + migration

> **Migration safety (project rule):** This migration is **additive/non-destructive** (new enum value + new index). It must be applied to the DB **before** the new code merges. The orchestrator runs it **only with explicit user approval**. Subagents may write the migration file but MUST NOT run `prisma migrate deploy` / `prisma db execute` / `scripts/migrate-prod.sh`.

### Task 1.1: Add `PAGE_DWELL` enum value + composite index + comment

**Files:**
- Modify: `prisma/schema.prisma` (ActivityType enum near `FEATURE_USED` ~line 186; ActivityLog `durationMs` ~line 407 and `@@index` block ~lines 50-55)

- [ ] **Step 1: Add the enum value.** In `enum ActivityType`, under the `// System` group right after `FEATURE_USED`, add:

```prisma
  FEATURE_USED
  PAGE_DWELL
```

- [ ] **Step 2: Update the `durationMs` comment** on `model ActivityLog`:

```prisma
  durationMs     Int? // Request duration in ms; for PAGE_DWELL rows, client-measured time-on-page in ms
```

- [ ] **Step 3: Add the composite index.** In the `@@index` block of `model ActivityLog`, add alongside the existing indexes:

```prisma
  @@index([type, createdAt])
```

- [ ] **Step 4: Regenerate the Prisma client and typecheck.**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: client regenerates; no type errors. (`ActivityType.PAGE_DWELL` now exists.)

- [ ] **Step 5: Create the migration file (do NOT apply).**

Run: `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` is unreliable here; instead create the file by hand:

Create `prisma/migrations/<YYYYMMDDHHMMSS>_add_page_dwell_activity_and_index/migration.sql` (use a timestamp later than the latest existing migration dir):

```sql
-- Add PAGE_DWELL to ActivityType enum (additive)
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'PAGE_DWELL';

-- Composite index to speed windowed type-filtered aggregation
CREATE INDEX IF NOT EXISTS "ActivityLog_type_createdAt_idx" ON "ActivityLog" ("type", "createdAt");
```

> Note: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction with other statements in some Postgres versions. If `prisma migrate` complains, split into two migration files (enum add first, index second). The index name must match Prisma's convention `ActivityLog_type_createdAt_idx` so the schema and DB stay in sync.

- [ ] **Step 6: Commit (schema + migration file only).**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): add PAGE_DWELL activity type + (type,createdAt) index"
```

- [ ] **Step 7: ORCHESTRATOR-ONLY checkpoint.** Surface to the user: "Migration `add_page_dwell_activity_and_index` is ready. It's additive (enum value + index). Approve running `npm run db:migrate` against the DB before merging?" Do not proceed to merge until applied.

---

## Chunk 2: Core library (`lib/page-traffic.ts`)

### Task 2.1: Types + path normalization

**Files:**
- Create: `src/lib/page-traffic.ts`
- Test: `src/__tests__/page-traffic.test.ts`

- [ ] **Step 1: Write the failing test** (`src/__tests__/page-traffic.test.ts`):

```ts
import { normalizePath } from "@/lib/page-traffic";

describe("normalizePath", () => {
  it("strips query string", () => {
    expect(normalizePath("/dashboards/deals?loc=Westminster")).toBe("/dashboards/deals");
  });
  it("collapses numeric id segments", () => {
    expect(normalizePath("/dashboards/catalog/edit/42")).toBe("/dashboards/catalog/edit/[id]");
  });
  it("collapses hubspot-style and uuid ids in reviews", () => {
    expect(normalizePath("/dashboards/reviews/12345678901")).toBe("/dashboards/reviews/[dealId]");
    expect(normalizePath("/dashboards/reviews/abc123-def")).toBe("/dashboards/reviews/[dealId]");
  });
  it("leaves static dashboard paths untouched", () => {
    expect(normalizePath("/dashboards/service-tickets")).toBe("/dashboards/service-tickets");
  });
  it("normalizes trailing slash", () => {
    expect(normalizePath("/dashboards/deals/")).toBe("/dashboards/deals");
  });
});
```

- [ ] **Step 2: Run it; verify it fails.** Run: `npx jest page-traffic.test -t normalizePath`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `normalizePath`** in `src/lib/page-traffic.ts`:

```ts
// Known dynamic-route patterns: prefix → param label. Order matters (longest prefix first).
const DYNAMIC_ROUTES: Array<{ prefix: string; param: string }> = [
  { prefix: "/dashboards/reviews", param: "[dealId]" },
  { prefix: "/dashboards/catalog/edit", param: "[id]" },
];

/** Strip query/hash, trailing slash, and collapse a trailing dynamic segment to its route pattern. */
export function normalizePath(raw: string): string {
  if (!raw) return raw;
  let path = raw.split("?")[0].split("#")[0];
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  for (const { prefix, param } of DYNAMIC_ROUTES) {
    if (path === prefix) return path;
    if (path.startsWith(`${prefix}/`)) {
      // collapse exactly one segment after the prefix
      const rest = path.slice(prefix.length + 1).split("/")[0];
      if (rest) return `${prefix}/${param}`;
    }
  }
  // Generic fallback: collapse a trailing all-numeric segment to [id]
  const segs = path.split("/");
  const last = segs[segs.length - 1];
  if (last && /^\d+$/.test(last) && segs.length > 2) {
    segs[segs.length - 1] = "[id]";
    return segs.join("/");
  }
  return path;
}
```

- [ ] **Step 4: Run the test; verify it passes.** Run: `npx jest page-traffic.test -t normalizePath`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/page-traffic.ts src/__tests__/page-traffic.test.ts
git commit -m "feat(page-traffic): path normalization"
```

### Task 2.2: Suite mapping + KNOWN_PAGES + drift test

**Files:**
- Modify: `src/lib/page-traffic.ts`
- Test: `src/__tests__/page-traffic.test.ts`

- [ ] **Step 1: Write the failing tests** (append):

```ts
import { suiteForPath, KNOWN_PAGES, PATH_TO_SUITE } from "@/lib/page-traffic";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

describe("suiteForPath", () => {
  it("maps a known dashboard to its suite", () => {
    expect(suiteForPath("/dashboards/scheduler")).toBe("Operations");
  });
  it("buckets unknown paths to Other", () => {
    expect(suiteForPath("/dashboards/this-page-does-not-exist")).toBe("Other");
  });
  it("KNOWN_PAGES includes suite landing routes", () => {
    expect(KNOWN_PAGES).toContain("/admin/page-traffic");
  });
});

// Drift guard: every /dashboards/* href referenced by a suite landing page
// must be represented in PATH_TO_SUITE, so the map can't silently go stale.
describe("PATH_TO_SUITE drift guard", () => {
  it("covers every dashboard href used in suite pages", () => {
    const suitesDir = join(process.cwd(), "src/app/suites");
    const missing: string[] = [];
    for (const suite of readdirSync(suitesDir)) {
      let src: string;
      try { src = readFileSync(join(suitesDir, suite, "page.tsx"), "utf8"); }
      catch { continue; }
      const hrefs = [...src.matchAll(/href:\s*["'](\/dashboards\/[^"'?#]+)["']/g)].map((m) => m[1]);
      for (const h of hrefs) {
        const norm = h.replace(/\/$/, "");
        if (!(norm in PATH_TO_SUITE)) missing.push(`${suite}: ${norm}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run; verify it fails.** Run: `npx jest page-traffic.test -t "suiteForPath|drift"`. Expected: FAIL.

- [ ] **Step 3: Build the map.** First, harvest the current hrefs to author `PATH_TO_SUITE` accurately:

Run (informational, to author the map — not committed):
```bash
# Confirm suite pages declare object-literal `href:` keys (verified: service/page.tsx uses `href: "/dashboards/..."`).
for d in src/app/suites/*/; do s=$(basename "$d"); echo "## $s"; grep -oE 'href:\s*"(/dashboards/[^"?#]+)"' "$d/page.tsx" 2>/dev/null | grep -oE '/dashboards/[^"?#]+'; done
```
If any suite instead uses JSX `<Link href="...">` (no `href:` key), the harvest + drift regex (`/href:\s*["']/`) will miss it — extend the regex to `/href[:=]\s*["']/` in both the map-authoring and the drift test if so.

Then add to `src/lib/page-traffic.ts` a `PATH_TO_SUITE: Record<string, string>` literal mapping each harvested `/dashboards/*` route (normalized, no trailing slash) to a human suite label (`"Operations"`, `"Service"`, `"Design & Engineering"`, `"Permitting & Interconnection"`, `"D&R + Roofing"`, `"Intelligence"`, `"Executive"`, `"Accounting"`, `"Sales & Marketing"`, `"Project Management"`, `"Admin"`, `"Testing"`). For a page that appears in more than one suite, pick its **primary** suite (documented inline). Then:

```ts
// Suite landing routes are also "known pages".
const SUITE_LANDING_ROUTES = [
  "/suites/operations", "/suites/service", "/suites/design-engineering",
  "/suites/permitting-interconnection", "/suites/dnr-roofing", "/suites/intelligence",
  "/suites/executive", "/suites/accounting", "/suites/sales-marketing",
  "/suites/project-management", "/suites/testing",
];
// Admin tooling pages worth tracking for dead-weight (extend as needed).
const ADMIN_PAGES = ["/admin/page-traffic", "/admin/activity", "/admin/audit", "/admin/security", "/admin/users", "/admin/roles"];

export function suiteForPath(path: string): string {
  const norm = normalizePath(path);
  if (norm in PATH_TO_SUITE) return PATH_TO_SUITE[norm];
  if (norm.startsWith("/suites/") || norm.startsWith("/admin")) return "Admin";
  return "Other";
}

export const KNOWN_PAGES: string[] = Array.from(
  new Set([...Object.keys(PATH_TO_SUITE), ...SUITE_LANDING_ROUTES, ...ADMIN_PAGES]),
);
```

> The drift test reads the real suite `.tsx` files, so when someone adds/removes a dashboard card the test fails until `PATH_TO_SUITE` is updated. This satisfies "harvest, don't hardcode a count."

- [ ] **Step 4: Run; verify pass.** Run: `npx jest page-traffic.test`. Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/page-traffic.ts src/__tests__/page-traffic.test.ts
git commit -m "feat(page-traffic): suite mapping + KNOWN_PAGES with drift guard"
```

### Task 2.3: Pure aggregation (`aggregatePageTraffic`)

**Files:**
- Modify: `src/lib/page-traffic.ts`
- Test: `src/__tests__/page-traffic-aggregate.test.ts`

- [ ] **Step 1: Define the row + result types** in `src/lib/page-traffic.ts`:

```ts
export type TrafficWindow = "7d" | "30d" | "90d" | "all";

/** Minimal shape of an ActivityLog row needed for aggregation. */
export interface TrafficRow {
  type: string;              // DASHBOARD_VIEWED | PAGE_DWELL | FEATURE_USED
  entityId: string | null;   // normalized or raw path
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  durationMs: number | null; // dwell ms for PAGE_DWELL
}

export interface PageRow {
  path: string;
  suite: string;
  views: number;
  uniqueUsers: number;
  clicks: number;
  avgDwellMs: number | null;
}
export interface SuiteRow { suite: string; views: number; uniqueUsers: number; }
export interface UserRow { userId: string | null; userEmail: string | null; userName: string | null; views: number; avgDwellMs: number | null; }
export interface PageTrafficResult {
  totals: { views: number; uniqueUsers: number; activePages: number; avgDwellMs: number | null };
  pages: PageRow[];
  suites: SuiteRow[];
  deadPages: { path: string; suite: string; views: number }[];
  users: UserRow[];
}
```

- [ ] **Step 2: Write the failing test** (`src/__tests__/page-traffic-aggregate.test.ts`):

```ts
import { aggregatePageTraffic, type TrafficRow } from "@/lib/page-traffic";

const rows: TrafficRow[] = [
  { type: "DASHBOARD_VIEWED", entityId: "/dashboards/scheduler", userId: "u1", userEmail: "a@x.com", userName: "A", durationMs: null },
  { type: "DASHBOARD_VIEWED", entityId: "/dashboards/scheduler", userId: "u2", userEmail: "b@x.com", userName: "B", durationMs: null },
  { type: "DASHBOARD_VIEWED", entityId: "/dashboards/scheduler", userId: "u1", userEmail: "a@x.com", userName: "A", durationMs: null },
  { type: "PAGE_DWELL", entityId: "/dashboards/scheduler", userId: "u1", userEmail: "a@x.com", userName: "A", durationMs: 10000 },
  { type: "PAGE_DWELL", entityId: "/dashboards/scheduler", userId: "u2", userEmail: "b@x.com", userName: "B", durationMs: 20000 },
  { type: "FEATURE_USED", entityId: "/dashboards/scheduler", userId: "u1", userEmail: "a@x.com", userName: "A", durationMs: null },
  { type: "DASHBOARD_VIEWED", entityId: "/dashboards/reviews/999", userId: "u1", userEmail: "a@x.com", userName: "A", durationMs: null },
];

describe("aggregatePageTraffic", () => {
  const res = aggregatePageTraffic(rows);

  it("counts views, unique users, clicks, avg dwell per page (normalized)", () => {
    const sched = res.pages.find((p) => p.path === "/dashboards/scheduler")!;
    expect(sched.views).toBe(3);
    expect(sched.uniqueUsers).toBe(2);
    expect(sched.clicks).toBe(1);
    expect(sched.avgDwellMs).toBe(15000);
    expect(sched.suite).toBe("Operations");
  });

  it("normalizes dynamic review path", () => {
    expect(res.pages.some((p) => p.path === "/dashboards/reviews/[dealId]")).toBe(true);
  });

  it("totals reflect distinct users across all pages", () => {
    expect(res.totals.uniqueUsers).toBe(2);
    expect(res.totals.activePages).toBe(2);
    expect(res.totals.views).toBe(4);
  });

  it("rolls up suites", () => {
    const ops = res.suites.find((s) => s.suite === "Operations")!;
    expect(ops.views).toBe(3);
  });

  it("flags known pages with zero traffic as dead", () => {
    expect(res.deadPages.some((d) => d.path === "/dashboards/service-tickets")).toBe(true);
    expect(res.deadPages.some((d) => d.path === "/dashboards/scheduler")).toBe(false);
  });
});
```

- [ ] **Step 3: Run; verify it fails.** Run: `npx jest page-traffic-aggregate`. Expected: FAIL.

- [ ] **Step 4: Implement `aggregatePageTraffic`** in `src/lib/page-traffic.ts`. It must: normalize each row's `entityId`; bucket by path; count `DASHBOARD_VIEWED` as views, `FEATURE_USED` as clicks; track distinct `userId` per page and globally; average `durationMs` over `PAGE_DWELL` rows; roll up suites; compute `deadPages = KNOWN_PAGES` whose view count is 0 (or below a `DEAD_VIEW_FLOOR = 1`), each with its suite; build per-user view counts + avg dwell. Sort `pages` by views desc, `deadPages` by views asc, `users` by views desc. Round `avgDwellMs` to an integer; `null` when no dwell rows.

```ts
const DEAD_VIEW_FLOOR = 1;

export function aggregatePageTraffic(rows: TrafficRow[]): PageTrafficResult {
  type Acc = { views: number; clicks: number; users: Set<string>; dwellSum: number; dwellN: number };
  const byPath = new Map<string, Acc>();
  const globalUsers = new Set<string>();
  type UAcc = { userEmail: string | null; userName: string | null; views: number; dwellSum: number; dwellN: number };
  const byUser = new Map<string, UAcc>();

  const acc = (m: Map<string, Acc>, k: string): Acc => {
    let a = m.get(k); if (!a) { a = { views: 0, clicks: 0, users: new Set(), dwellSum: 0, dwellN: 0 }; m.set(k, a); } return a;
  };

  for (const r of rows) {
    const path = normalizePath(r.entityId || "");
    if (!path) continue;
    const a = acc(byPath, path);
    const uid = r.userId || r.userEmail || "";
    if (r.type === "DASHBOARD_VIEWED") {
      a.views++; if (uid) { a.users.add(uid); globalUsers.add(uid); }
      const ukey = r.userId || r.userEmail || "unknown";
      let u = byUser.get(ukey); if (!u) { u = { userEmail: r.userEmail, userName: r.userName, views: 0, dwellSum: 0, dwellN: 0 }; byUser.set(ukey, u); }
      u.views++;
    } else if (r.type === "FEATURE_USED") {
      a.clicks++;
    } else if (r.type === "PAGE_DWELL" && typeof r.durationMs === "number") {
      a.dwellSum += r.durationMs; a.dwellN++;
      const ukey = r.userId || r.userEmail || "unknown";
      const u = byUser.get(ukey); if (u) { u.dwellSum += r.durationMs; u.dwellN++; }
    }
  }

  const pages: PageRow[] = [...byPath.entries()]
    .filter(([, a]) => a.views > 0 || a.clicks > 0 || a.dwellN > 0)
    .map(([path, a]) => ({
      path, suite: suiteForPath(path), views: a.views, uniqueUsers: a.users.size,
      clicks: a.clicks, avgDwellMs: a.dwellN ? Math.round(a.dwellSum / a.dwellN) : null,
    }))
    .sort((x, y) => y.views - x.views);

  const suiteMap = new Map<string, { views: number; users: Set<string> }>();
  for (const [path, a] of byPath) {
    const s = suiteForPath(path);
    let sa = suiteMap.get(s); if (!sa) { sa = { views: 0, users: new Set() }; suiteMap.set(s, sa); }
    sa.views += a.views; a.users.forEach((u) => sa!.users.add(u));
  }
  const suites: SuiteRow[] = [...suiteMap.entries()]
    .map(([suite, v]) => ({ suite, views: v.views, uniqueUsers: v.users.size }))
    .sort((x, y) => y.views - x.views);

  const deadPages = KNOWN_PAGES
    .filter((p) => (byPath.get(p)?.views ?? 0) < DEAD_VIEW_FLOOR)
    .map((p) => ({ path: p, suite: suiteForPath(p), views: byPath.get(p)?.views ?? 0 }))
    .sort((x, y) => x.views - y.views);

  const users: UserRow[] = [...byUser.entries()]
    .map(([userId, u]) => ({ userId: userId === "unknown" ? null : userId, userEmail: u.userEmail, userName: u.userName, views: u.views, avgDwellMs: u.dwellN ? Math.round(u.dwellSum / u.dwellN) : null }))
    .sort((x, y) => y.views - x.views);

  const totalDwellRows = rows.filter((r) => r.type === "PAGE_DWELL" && typeof r.durationMs === "number");
  const avgDwellMs = totalDwellRows.length ? Math.round(totalDwellRows.reduce((s, r) => s + (r.durationMs || 0), 0) / totalDwellRows.length) : null;

  return {
    totals: { views: pages.reduce((s, p) => s + p.views, 0), uniqueUsers: globalUsers.size, activePages: pages.filter((p) => p.views > 0).length, avgDwellMs },
    pages, suites, deadPages, users,
  };
}
```

- [ ] **Step 5: Run; verify pass.** Run: `npx jest page-traffic-aggregate`. Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/page-traffic.ts src/__tests__/page-traffic-aggregate.test.ts
git commit -m "feat(page-traffic): pure aggregation with dead-weight + per-user"
```

### Task 2.4: DB wrapper `getPageTraffic`

**Files:**
- Modify: `src/lib/page-traffic.ts`

- [ ] **Step 1: Implement the thin wrapper** (no new test — it's a thin Prisma query; covered indirectly + by typecheck). Append:

```ts
import { prisma } from "@/lib/db";

const WINDOW_DAYS: Record<Exclude<TrafficWindow, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };

export interface GetPageTrafficOpts { window: TrafficWindow; roles?: string[]; locations?: string[]; }

export async function getPageTraffic(opts: GetPageTrafficOpts): Promise<PageTrafficResult> {
  if (!prisma) return aggregatePageTraffic([]);
  const since = opts.window === "all" ? undefined : new Date(Date.now() - WINDOW_DAYS[opts.window] * 86_400_000);

  // Optional role filter → resolve to userIds.
  let userIdFilter: string[] | undefined;
  if (opts.roles?.length) {
    const users = await prisma.user.findMany({ where: { roles: { hasSome: opts.roles as never } }, select: { id: true } });
    userIdFilter = users.map((u) => u.id);
    if (userIdFilter.length === 0) return aggregatePageTraffic([]); // no matching users → empty
  }

  const rows = await prisma.activityLog.findMany({
    where: {
      type: { in: ["DASHBOARD_VIEWED", "PAGE_DWELL", "FEATURE_USED"] as never },
      ...(since ? { createdAt: { gte: since } } : {}),
      ...(opts.locations?.length ? { pbLocation: { in: opts.locations } } : {}),
      ...(userIdFilter ? { userId: { in: userIdFilter } } : {}),
    },
    select: { type: true, entityId: true, userId: true, userEmail: true, userName: true, durationMs: true },
    take: 200_000, // safety cap; admin-only, low cardinality windows
  });

  return aggregatePageTraffic(rows as unknown as TrafficRow[]);
}
```

> `Date.now()` is fine in app code (the no-`Date.now()` rule applies only to Workflow scripts, not the app).

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`. Expected: no errors. (Confirm `User.roles` filter syntax compiles; if `hasSome` typing fights, narrow with `as never` as shown or fetch all users and filter in JS.)

- [ ] **Step 3: Commit.**

```bash
git add src/lib/page-traffic.ts
git commit -m "feat(page-traffic): getPageTraffic DB wrapper"
```

---

## Chunk 3: Write-side dwell tracking

### Task 3.1: `trackPageDwell` in the hook

**Files:**
- Modify: `src/hooks/useActivityTracking.ts` (add to the `ActivityTracker` interface ~line 50, and add the method + return it)

- [ ] **Step 1: Add to the `ActivityTracker` interface:**

```ts
  trackPageDwell: (path: string, durationMs: number) => void;
```

- [ ] **Step 2: Implement the method** (beacon-based; falls back to fetch keepalive). Add near `trackPageView`:

```ts
  const trackPageDwell = useCallback((path: string, durationMs: number) => {
    if (status !== "authenticated") return;
    if (!path || durationMs < 1000) return;            // ignore sub-1s bounces
    const ms = Math.min(durationMs, 30 * 60 * 1000);   // clamp 30 min
    const payload = JSON.stringify({
      action: "page_dwell",
      sessionId: sessionId.current,
      deviceFingerprint: getDeviceFingerprint(),
      path,
      durationMs: Math.round(ms),
    });
    try {
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon("/api/activity/log", new Blob([payload], { type: "application/json" }));
      } else {
        void fetch("/api/activity/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true });
      }
    } catch { /* analytics must never break the app */ }
  }, [status]);
```

- [ ] **Step 3: Return it** from the hook's returned object: add `trackPageDwell,`.

- [ ] **Step 4: Typecheck.** Run: `npx tsc --noEmit`. Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add src/hooks/useActivityTracking.ts
git commit -m "feat(activity): trackPageDwell via sendBeacon"
```

### Task 3.2: Measure + emit dwell in `PageViewTracker`

**Files:**
- Modify: `src/components/PageViewTracker.tsx`

- [ ] **Step 1: Rewrite the component** to also measure dwell. Track the current page's entry time + path in refs; on path change emit dwell for the *previous* page, then record the new one; add `visibilitychange`/`pagehide` listeners that emit dwell for the current page (and reset the entry clock on return to visible):

```tsx
"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useActivityTracking } from "@/hooks/useActivityTracking";

export default function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { status } = useSession();
  const { trackPageView, trackPageDwell } = useActivityTracking();
  const lastTrackedPath = useRef<string | null>(null);
  const currentPath = useRef<string | null>(null);
  const enteredAt = useRef<number>(0);

  // Page-view + dwell-on-navigation
  useEffect(() => {
    if (!pathname || status !== "authenticated") return;
    const qs = searchParams?.toString();
    const fullPath = qs ? `${pathname}?${qs}` : pathname;
    if (lastTrackedPath.current === fullPath) return;

    // emit dwell for the page we're leaving
    if (currentPath.current && enteredAt.current) {
      trackPageDwell(currentPath.current, performance.now() - enteredAt.current);
    }
    lastTrackedPath.current = fullPath;
    currentPath.current = pathname; // dwell keyed on pathname (no query) to match aggregation
    enteredAt.current = performance.now();
    trackPageView(fullPath, typeof document !== "undefined" ? document.title : undefined);
  }, [pathname, searchParams, status, trackPageView, trackPageDwell]);

  // Dwell-on-hide/close
  useEffect(() => {
    if (status !== "authenticated") return;
    const flush = () => {
      if (currentPath.current && enteredAt.current) {
        trackPageDwell(currentPath.current, performance.now() - enteredAt.current);
        enteredAt.current = performance.now(); // avoid double-counting if it returns
      }
    };
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", flush);
    };
  }, [status, trackPageDwell]);

  return null;
}
```

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`. Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add src/components/PageViewTracker.tsx
git commit -m "feat(activity): measure + emit page dwell on nav and tab-hide"
```

### Task 3.3: Handle `page_dwell` in the activity-log endpoint

**Files:**
- Modify: `src/app/api/activity/log/route.ts` (`getActionActivityType` ~line 19; risk block ~line 94; POST `switch` ~line 100; anomaly block ~line 264)

- [ ] **Step 1: Map the action type.** In `getActionActivityType`, add:

```ts
    case "page_dwell": return "PAGE_DWELL";
```

- [ ] **Step 2: Declare `isDwell` + skip anomaly scoring for dwell.** Immediately after the existing risk computation (`const risk = getActivityRiskLevel(...)` ~line 95), add the declaration. It MUST be declared here because both this step and Step 4 (the anomaly block ~line 265) reference it:

```ts
    const isDwell = action === "page_dwell";
    if (isDwell) { activityRiskLevel = "LOW"; activityRiskScore = 1; }
```

> Note: `LOW`/`1` are already the initialized defaults, so this line is belt-and-suspenders — the load-bearing change is Step 4 (skipping the anomaly check). Keep it for clarity.

- [ ] **Step 3: Add the `page_dwell` case** to the POST `switch` (mirrors `page_view`, persists `durationMs`):

```ts
      case "page_dwell":
        await logActivity({
          type: "PAGE_DWELL",
          description: `Dwell ${Math.round(Number(data.durationMs) || 0)}ms on ${data.path || "unknown"}`,
          userId: userIdForLog,
          userEmail,
          userName,
          entityType: "page",
          entityId: data.path,
          entityName: data.path,
          durationMs: Math.round(Number(data.durationMs) || 0),
          ipAddress,
          userAgent,
          sessionId: data.sessionId,
          auditSessionId,
          riskLevel: activityRiskLevel,
          riskScore: activityRiskScore,
        });
        break;
```

- [ ] **Step 4: Skip the anomaly check for dwell.** Wrap the existing `runSessionAnomalyChecks(...)` call so it doesn't run when `isDwell`:

```ts
    if (!isDwell && auditSessionData && prisma) {
      runSessionAnomalyChecks(auditSessionData, activityRiskScore, prisma).catch((e: unknown) => console.error("Anomaly check failed:", e));
    }
```

- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit`. Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add src/app/api/activity/log/route.ts
git commit -m "feat(activity): persist PAGE_DWELL events, skip anomaly scoring"
```

---

## Chunk 4: API route

### Task 4.1: `GET /api/admin/page-traffic`

**Files:**
- Create: `src/app/api/admin/page-traffic/route.ts`

- [ ] **Step 1: Implement the route** (mirror `src/app/api/admin/activity/route.ts` auth shape):

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPageTraffic, type TrafficWindow } from "@/lib/page-traffic";

const WINDOWS: TrafficWindow[] = ["7d", "30d", "90d", "all"];

/** GET /api/admin/page-traffic?window=30d&roles=ADMIN,SALES&locations=Westminster */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const sp = request.nextUrl.searchParams;
  const windowParam = (sp.get("window") || "30d") as TrafficWindow;
  const window: TrafficWindow = WINDOWS.includes(windowParam) ? windowParam : "30d";
  const roles = sp.get("roles")?.split(",").map((s) => s.trim()).filter(Boolean);
  const locations = sp.get("locations")?.split(",").map((s) => s.trim()).filter(Boolean);

  try {
    const data = await getPageTraffic({ window, roles, locations });
    return NextResponse.json({ ...data, window, generatedAt: new Date().toISOString() });
  } catch (e) {
    console.error("page-traffic aggregation failed:", e);
    return NextResponse.json({ error: "Failed to compute page traffic" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`. Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add src/app/api/admin/page-traffic/route.ts
git commit -m "feat(api): GET /api/admin/page-traffic"
```

---

## Chunk 5: Admin UI page + nav

### Task 5.1: Register the sidebar nav item

**Files:**
- Modify: `src/components/admin-shell/nav.ts` (Audit group)

- [ ] **Step 1: Add to the Audit group's `items`:**

```ts
      { label: "Page traffic", href: "/admin/page-traffic", iconName: "eye" },
```

- [ ] **Step 2: Commit.**

```bash
git add src/components/admin-shell/nav.ts
git commit -m "feat(admin): add Page traffic to admin sidebar (Audit)"
```

### Task 5.2: The page

**Files:**
- Create: `src/app/admin/page-traffic/page.tsx`

- [ ] **Step 1: Implement the page.** Create `src/app/admin/page-traffic/page.tsx` with the COMPLETE component below. Notes that make it compile against the real components:
  - `MultiSelectFilter` requires `options: FilterOption[]` (`{ value, label }`) — the role/location string arrays are mapped to that shape (do NOT pass raw `string[]`).
  - `AdminTable<T>` requires `rows`, `rowKey`, `columns` (`AdminTableColumn<T> = { key, label, render?, align?, sortable?, width? }`), and `caption`.
  - Role option values are REAL `UserRole` enum members (so the `roles: { hasSome }` filter in Task 2.4 matches users). The list below excludes legacy aliases (`OWNER`, `MANAGER`, `DESIGNER`, `PERMITTING`). Source of truth: `enum UserRole` in `prisma/schema.prisma`.
  - `AdminFilterBar` props (from `src/app/admin/activity/page.tsx`): `hasActiveFilters`, `onClearAll`, children. `DateRangeChip` props: `label`, `selected`, `options` (`{value,label}[]`), `onChange`.

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
import { AdminFilterBar, DateRangeChip } from "@/components/admin-shell/AdminFilterBar";
import { AdminTable, type AdminTableColumn } from "@/components/admin-shell/AdminTable";
import { AdminError } from "@/components/admin-shell/AdminError";
import { CANONICAL_LOCATIONS } from "@/lib/locations";
import type { PageTrafficResult, PageRow, UserRow, TrafficWindow } from "@/lib/page-traffic";

// Real UserRole enum members (no legacy aliases) — must match prisma enum so the
// API's `roles: { hasSome }` filter resolves to actual users.
const USER_ROLES = ["ADMIN", "EXECUTIVE", "OPERATIONS", "OPERATIONS_MANAGER", "SERVICE", "PROJECT_MANAGER", "SALES_MANAGER", "TECH_OPS", "DESIGN", "PERMIT", "INTERCONNECT", "INTELLIGENCE", "ROOFING", "MARKETING", "VIEWER", "SALES", "ACCOUNTING"] as const;
const WINDOW_OPTS = [{ value: "7d", label: "7d" }, { value: "30d", label: "30d" }, { value: "90d", label: "90d" }, { value: "all", label: "All" }];
const ROLE_OPTIONS = USER_ROLES.map((r) => ({ value: r, label: r }));
const LOCATION_OPTIONS = CANONICAL_LOCATIONS.map((l) => ({ value: l, label: l }));

function fmtDwell(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
function fmtNum(n: number): string { return n.toLocaleString(); }

function toCSV(pages: PageRow[]): string {
  const head = ["Path", "Suite", "Views", "Unique Users", "Clicks", "Avg Dwell (s)"];
  const lines = pages.map((p) => [p.path, p.suite, p.views, p.uniqueUsers, p.clicks, p.avgDwellMs == null ? "" : Math.round(p.avgDwellMs / 1000)]
    .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  return [head.join(","), ...lines].join("\n");
}

export default function PageTrafficPage() {
  const [window, setWindow] = useState<TrafficWindow>("30d");
  const [roleFilters, setRoleFilters] = useState<string[]>([]);
  const [locationFilters, setLocationFilters] = useState<string[]>([]);
  const [data, setData] = useState<(PageTrafficResult & { generatedAt: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ window });
      if (roleFilters.length) qs.set("roles", roleFilters.join(","));
      if (locationFilters.length) qs.set("locations", locationFilters.join(","));
      const res = await fetch(`/api/admin/page-traffic?${qs}`, { signal: ac.signal });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setData(await res.json());
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [window, roleFilters, locationFilters]);

  useEffect(() => { void fetchData(); return () => abortRef.current?.abort(); }, [fetchData]);

  const hasActiveFilters = roleFilters.length > 0 || locationFilters.length > 0 || window !== "30d";
  const clearAll = () => { setWindow("30d"); setRoleFilters([]); setLocationFilters([]); };

  const exportCSV = () => {
    if (!data) return;
    const blob = new Blob([toCSV(data.pages)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `page-traffic-${window}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const pageColumns: AdminTableColumn<PageRow>[] = useMemo(() => [
    { key: "path", label: "Page", render: (r) => <span className="font-mono text-xs text-foreground">{r.path}</span> },
    { key: "suite", label: "Suite", render: (r) => <span className="text-muted">{r.suite}</span> },
    { key: "views", label: "Views", align: "right", sortable: true, render: (r) => fmtNum(r.views) },
    { key: "uniqueUsers", label: "Users", align: "right", sortable: true, render: (r) => fmtNum(r.uniqueUsers) },
    { key: "clicks", label: "Clicks", align: "right", render: (r) => fmtNum(r.clicks) },
    { key: "avgDwellMs", label: "Avg dwell", align: "right", render: (r) => fmtDwell(r.avgDwellMs) },
  ], []);

  const userColumns: AdminTableColumn<UserRow>[] = useMemo(() => [
    { key: "user", label: "User", render: (r) => <span className="text-foreground">{r.userName || r.userEmail || r.userId || "Unknown"}</span> },
    { key: "views", label: "Views", align: "right", sortable: true, render: (r) => fmtNum(r.views) },
    { key: "avgDwellMs", label: "Avg dwell", align: "right", render: (r) => fmtDwell(r.avgDwellMs) },
  ], []);

  const maxSuiteViews = Math.max(1, ...(data?.suites.map((s) => s.views) ?? [1]));

  return (
    <div>
      <AdminPageHeader
        title="Page Traffic"
        breadcrumb={["Admin", "Audit", "Page traffic"]}
        subtitle={data ? `${fmtNum(data.totals.views)} views · ${fmtNum(data.totals.uniqueUsers)} users` : undefined}
      />

      <div className="px-4 py-3">
        <AdminFilterBar hasActiveFilters={hasActiveFilters} onClearAll={clearAll}>
          <DateRangeChip label="Window" selected={window} options={WINDOW_OPTS} onChange={(v) => setWindow(v as TrafficWindow)} />
          <MultiSelectFilter label="Role" options={ROLE_OPTIONS} selected={roleFilters} onChange={setRoleFilters} />
          <MultiSelectFilter label="Location" options={LOCATION_OPTIONS} selected={locationFilters} onChange={setLocationFilters} />
          <button type="button" onClick={exportCSV} className="rounded px-2 py-1 text-xs text-muted hover:text-foreground hover:bg-surface-2 transition-colors">CSV</button>
        </AdminFilterBar>
      </div>

      {error ? (
        <AdminError message={error} onRetry={fetchData} />
      ) : (
        <div className="space-y-6 px-4 pb-8">
          {/* Summary tiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Views", value: fmtNum(data?.totals.views ?? 0) },
              { label: "Unique users", value: fmtNum(data?.totals.uniqueUsers ?? 0) },
              { label: "Active pages", value: fmtNum(data?.totals.activePages ?? 0) },
              { label: "Avg dwell", value: fmtDwell(data?.totals.avgDwellMs ?? null) },
            ].map((t) => (
              <div key={t.label} className="rounded-lg border border-t-border bg-surface p-3">
                <div className="text-xs text-muted">{t.label}</div>
                <div className="mt-1 text-xl font-semibold text-foreground">{t.value}</div>
              </div>
            ))}
          </div>

          {/* Suite breakdown bars */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-foreground">By suite</h2>
            <div className="space-y-1.5">
              {(data?.suites ?? []).map((s) => (
                <div key={s.suite} className="flex items-center gap-2">
                  <div className="w-40 shrink-0 truncate text-xs text-muted">{s.suite}</div>
                  <div className="h-4 flex-1 rounded bg-surface-2">
                    <div className="h-4 rounded bg-purple-500/60" style={{ width: `${(s.views / maxSuiteViews) * 100}%` }} />
                  </div>
                  <div className="w-16 shrink-0 text-right text-xs text-foreground">{fmtNum(s.views)}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Top pages */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-foreground">Top pages</h2>
            <AdminTable<PageRow>
              caption="Top pages by traffic"
              rows={data?.pages ?? []}
              rowKey={(r) => r.path}
              columns={pageColumns}
              loading={loading && !data}
            />
          </section>

          {/* Dead weight */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-foreground">Dead weight (little/no traffic)</h2>
            <AdminTable<PageRow>
              caption="Pages with little or no traffic"
              rows={(data?.deadPages ?? []).map((d) => ({ ...d, uniqueUsers: 0, clicks: 0, avgDwellMs: null }))}
              rowKey={(r) => r.path}
              columns={[pageColumns[0], pageColumns[1], pageColumns[2]]}
              loading={loading && !data}
            />
          </section>

          {/* Per-user */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-foreground">By user</h2>
            <AdminTable<UserRow>
              caption="Usage by user"
              rows={data?.users ?? []}
              rowKey={(r) => r.userId || r.userEmail || "unknown"}
              columns={userColumns}
              loading={loading && !data}
            />
          </section>
        </div>
      )}
    </div>
  );
}
```

> Before writing, confirm `AdminError` and `AdminFilterBar`/`DateRangeChip` prop names by opening `src/app/admin/activity/page.tsx` (the canonical usage) and `src/components/admin-shell/AdminError.tsx`. If `AdminError` expects different props (e.g. `error` instead of `message`/`onRetry`), match the real signature. Likewise verify `AdminTable` accepts `loading` (it does per `AdminTableProps`). These are mechanical prop-name confirmations, not design changes.

- [ ] **Step 2: Typecheck + lint.** Run: `npx tsc --noEmit && npm run lint`. Expected: no errors/warnings. Fix any prop-name mismatches surfaced against the real admin-shell components.

- [ ] **Step 3: Commit.**

```bash
git add src/app/admin/page-traffic/page.tsx
git commit -m "feat(admin): Page Traffic analytics view"
```

---

## Chunk 6: Verification

### Task 6.1: Full verification pass

- [ ] **Step 1: Run the page-traffic unit tests.** Run: `npx jest page-traffic`. Expected: all PASS.
- [ ] **Step 2: Typecheck the whole project.** Run: `npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 3: Lint touched files.** Run: `npx eslint src/lib/page-traffic.ts src/app/admin/page-traffic/page.tsx src/app/api/admin/page-traffic/route.ts src/components/PageViewTracker.tsx src/hooks/useActivityTracking.ts src/app/api/activity/log/route.ts src/components/admin-shell/nav.ts`. Expected: clean.
- [ ] **Step 4: Build (disk permitting).** Run: `npm run build`. Expected: success. If disk is too tight for `.next`, skip and note it; `tsc --noEmit` + lint already cover correctness.
- [ ] **Step 5: Manual smoke (orchestrator, after migration applied).** Start dev server, visit `/admin/page-traffic` as an admin, confirm the table renders, filters change the data, CSV exports, and navigating around the app produces `PAGE_DWELL` rows (check `/admin/activity` filtered to type — note PAGE_DWELL will appear once the enum migration is applied).
- [ ] **Step 6: requesting-code-review** before merge (see subagent-driven-development / requesting-code-review skill).

---

## Notes / Gotchas

- **Migration before merge** (additive enum + index). Orchestrator runs `npm run db:migrate` with user approval; the code that writes/reads `PAGE_DWELL` must not be live before the enum exists in the DB. Subagents never run migrations.
- **`ALTER TYPE ... ADD VALUE`** may need to be its own migration (can't always run in a txn with other DDL). Split if `prisma migrate` errors.
- **Dwell keyed on `pathname`** (no query string) so it matches `normalizePath` buckets; views are logged with full path but aggregation normalizes both.
- **`PATH_TO_SUITE` drift** is guarded by a test that reads the suite `.tsx` files — keep the map current or the test fails.
- **No new env vars, no feature flag** — this is read-only admin analytics over data we already collect; gating adds no value (per YAGNI).
