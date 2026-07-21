# Suite Legacy Sections Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suite landing pages automatically render pages with no team views in 60 days inside a collapsed, dulled "Legacy" section at the bottom.

**Architecture:** A new `getLegacyPaths(hrefs)` helper in `src/lib/page-traffic.ts` computes which of a set of hrefs have had no non-admin page views in the last 60 days (cached 1 hour, failing open to "nothing is legacy"). `SuitePageShell` becomes async, partitions its role-filtered cards with the helper, and renders legacy cards as a synthetic trailing "Legacy" section wrapped in a native `<details>` element. No routes, URLs, or access rules change.

**Tech Stack:** Next.js 16 server components, Prisma (ActivityLog), existing `lib/cache.ts` CacheStore, Jest.

**Spec:** `docs/superpowers/specs/2026-07-20-suite-legacy-sections-design.md`

---

## Chunk 1: Everything (single-chunk plan)

### File structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/lib/page-traffic.ts` | Modify | Add `LEGACY_THRESHOLD_DAYS`, `LEGACY_EXEMPT`, `computeLegacyPaths()` (pure), `fetchRecentTeamViewPaths()` (takes a prisma client, testable with a fake), `getLegacyPaths()` (cache + lazy DB import + retention guard + fail-open) |
| `src/lib/cache.ts` | Modify | Add `PAGE_TRAFFIC_LEGACY` cache key |
| `src/components/SuitePageShell.tsx` | Modify | Make async; export pure `partitionLegacyCards()`; render synthetic "Legacy" `<details>` section; add "Legacy" to `SECTION_COLORS` |
| `src/__tests__/page-traffic-legacy.test.ts` | Create | Unit tests for the three page-traffic units |
| `src/__tests__/components/suite-legacy-partition.test.ts` | Create | Unit tests for `partitionLegacyCards` |

Notes for the implementer:

- The repo's primary checkout has unrelated uncommitted changes. Work in a fresh worktree branched from `origin/main`. NEVER use `git stash` in this repo (50+ shared stashes; popping applies someone else's WIP).
- `page-traffic.ts` is imported by pure-function tests that must not need a DB. Keep the existing lazy `await import("@/lib/db")` pattern for anything touching prisma.
- Existing indexes on ActivityLog cover the queries: `@@index([type, createdAt])` and `@@index([entityType, entityId])` exist in `prisma/schema.prisma`. No migration needed (and subagents never run migrations anyway).
- Prisma note: `userId: { notIn: adminIds }` does NOT match rows where `userId IS NULL` (SQL NOT IN semantics), which is why the query uses `OR: [{ userId: null }, { userId: { notIn: adminIds } }]`. The spec requires null-user views to count as non-admin.

### Task 1: Worktree setup

**Files:** none (environment)

- [ ] **Step 1: Create worktree from origin/main**

```bash
cd "/Users/zach/Downloads/Dev Projects/PB-Operations-Suite"
git fetch origin main
git worktree add "../PB-worktrees/suite-legacy-sections" -b feat/suite-legacy-sections origin/main
cd "/Users/zach/Downloads/Dev Projects/PB-worktrees/suite-legacy-sections"
```

- [ ] **Step 2: Bring the spec and plan onto the feature branch**

```bash
mkdir -p docs/superpowers/specs docs/superpowers/plans
cp "/Users/zach/Downloads/Dev Projects/PB-Operations-Suite/docs/superpowers/specs/2026-07-20-suite-legacy-sections-design.md" docs/superpowers/specs/
cp "/Users/zach/Downloads/Dev Projects/PB-Operations-Suite/docs/superpowers/plans/2026-07-20-suite-legacy-sections.md" docs/superpowers/plans/
git add docs/superpowers
git commit -m "docs: spec and plan for suite legacy sections

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Install dependencies and generate the Prisma client**

```bash
npm install
npx prisma generate
```

Expected: install completes; client generated into `src/generated/prisma`.

- [ ] **Step 4: Baseline test run**

```bash
npx jest src/__tests__/page-traffic.test.ts src/__tests__/page-traffic-aggregate.test.ts
```

Expected: PASS.

Known pre-existing red: `src/__tests__/components/suite-map.test.ts` fails on origin/main with `SyntaxError: Cannot use import statement outside a module` because next-auth v5 beta is ESM-only and `jest.config.ts` has no `transformIgnorePatterns` override (the import chain DashboardShell → HeaderControls → next-auth/react). This plan does not fix it; it is excluded from baselines and gates. The quality bar for later test gates is "no NEW failures relative to this baseline".

### Task 2: Pure legacy computation in page-traffic.ts

**Files:**
- Modify: `src/lib/page-traffic.ts` (append near `normalizePath`)
- Test: `src/__tests__/page-traffic-legacy.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/page-traffic-legacy.test.ts`:

```ts
import {
  computeLegacyPaths,
  fetchRecentTeamViewPaths,
  LEGACY_EXEMPT,
  LEGACY_THRESHOLD_DAYS,
} from "@/lib/page-traffic";

const DAY = 86_400_000;

describe("computeLegacyPaths", () => {
  const fresh = new Set(["/dashboards/scheduler", "/dashboards/bom"]);

  it("flags hrefs with no recent team views", () => {
    const out = computeLegacyPaths(["/dashboards/scheduler", "/dashboards/capacity"], fresh);
    expect(out.has("/dashboards/capacity")).toBe(true);
    expect(out.has("/dashboards/scheduler")).toBe(false);
  });

  it("normalizes hrefs before matching (query strings fold onto the route)", () => {
    const out = computeLegacyPaths(["/dashboards/scheduler?loc=Westminster"], fresh);
    expect(out.size).toBe(0);
  });

  it("never flags exempt paths", () => {
    for (const p of LEGACY_EXEMPT) {
      expect(computeLegacyPaths([p], new Set()).has(p)).toBe(false);
    }
  });

  it("never flags estimator, portal, or suite-landing paths", () => {
    const out = computeLegacyPaths(
      ["/estimator/battery", "/portal/survey/abc", "/suites/operations"],
      new Set(),
    );
    expect(out.size).toBe(0);
  });

  it("ignores non-path hrefs", () => {
    expect(computeLegacyPaths(["https://example.com/x"], new Set()).size).toBe(0);
  });
});

describe("fetchRecentTeamViewPaths", () => {
  const now = Date.now();
  const cutoffDays = LEGACY_THRESHOLD_DAYS;

  function fakePrisma(opts: {
    oldestView: Date | null;
    admins: { id: string }[];
    recentRows: { entityId: string | null }[];
  }) {
    return {
      activityLog: {
        aggregate: jest.fn().mockResolvedValue({ _min: { createdAt: opts.oldestView } }),
        groupBy: jest.fn().mockResolvedValue(opts.recentRows),
      },
      user: {
        findMany: jest.fn().mockResolvedValue(opts.admins),
      },
    };
  }

  it("returns normalized paths with recent non-admin views", async () => {
    const prisma = fakePrisma({
      oldestView: new Date(now - 150 * DAY),
      admins: [{ id: "admin1" }],
      recentRows: [{ entityId: "/dashboards/scheduler?x=1" }, { entityId: null }],
    });
    const out = await fetchRecentTeamViewPaths(prisma as never);
    expect(out).toEqual(new Set(["/dashboards/scheduler"]));
  });

  it("excludes admin userIds but keeps null userIds, with a ~60-day cutoff (query shape)", async () => {
    const prisma = fakePrisma({
      oldestView: new Date(now - 150 * DAY),
      admins: [{ id: "admin1" }],
      recentRows: [],
    });
    await fetchRecentTeamViewPaths(prisma as never);
    const where = (prisma.activityLog.groupBy as jest.Mock).mock.calls[0][0].where;
    expect(where.OR).toEqual([{ userId: null }, { userId: { notIn: ["admin1"] } }]);
    const gte: Date = where.createdAt.gte;
    expect(Math.abs(gte.getTime() - (now - LEGACY_THRESHOLD_DAYS * DAY))).toBeLessThan(60_000);
  });

  it("returns null (guard tripped) when retained history is younger than the threshold", async () => {
    const prisma = fakePrisma({
      oldestView: new Date(now - (cutoffDays - 5) * DAY),
      admins: [],
      recentRows: [{ entityId: "/dashboards/scheduler" }],
    });
    expect(await fetchRecentTeamViewPaths(prisma as never)).toBeNull();
  });

  it("returns null when the log is empty", async () => {
    const prisma = fakePrisma({ oldestView: null, admins: [], recentRows: [] });
    expect(await fetchRecentTeamViewPaths(prisma as never)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/__tests__/page-traffic-legacy.test.ts
```

Expected: FAIL, `computeLegacyPaths` is not exported.

- [ ] **Step 3: Implement in `src/lib/page-traffic.ts`**

Append after the `normalizePath` function (keep the file's existing section-comment style):

```ts
// ─── LEGACY PAGES ───────────────────────────────────────────────────────────────
// Pages with no non-admin views in the last LEGACY_THRESHOLD_DAYS are demoted to
// a collapsed "Legacy" section on suite landing pages (see SuitePageShell).
// Spec: docs/superpowers/specs/2026-07-20-suite-legacy-sections-design.md

export const LEGACY_THRESHOLD_DAYS = 60;

// New tools awaiting team adoption. Prune an entry once its page has real
// team traffic (it stops mattering the moment the team uses it monthly).
export const LEGACY_EXEMPT: string[] = [
  "/dashboards/bottlenecks",      // live 2026-07-07, adoption pending
  "/dashboards/ops-scorecard",    // built for Matt 2026-07
  "/dashboards/scheduler-v2",     // behind feature flag
  "/dashboards/pe-photo-builder", // shipped, E2E validation pending
  "/dashboards/workflow-map",     // new
  "/dashboards/revenue-goals",    // $50M tracker, launch pending
];

// Public or untracked surfaces: activity tracking only logs signed-in staff,
// so absence of views is meaningless for these.
const LEGACY_EXEMPT_PREFIXES = ["/estimator", "/portal", "/suites"];

/** Pure core: which of these hrefs are legacy, given the set of recently-team-viewed paths. */
export function computeLegacyPaths(hrefs: string[], recentTeamViewPaths: Set<string>): Set<string> {
  const legacy = new Set<string>();
  for (const href of hrefs) {
    if (!href.startsWith("/")) continue;
    const norm = normalizePath(href);
    if (LEGACY_EXEMPT.includes(norm)) continue;
    if (LEGACY_EXEMPT_PREFIXES.some((p) => norm === p || norm.startsWith(`${p}/`))) continue;
    if (!recentTeamViewPaths.has(norm)) legacy.add(href);
  }
  return legacy;
}

/**
 * Paths with at least one page view by a non-ADMIN user in the threshold window.
 * Returns null when the retained log history is too short to judge (fail open).
 * Takes the prisma client as a parameter so tests can pass a fake.
 */
export async function fetchRecentTeamViewPaths(
  prisma: import("@/generated/prisma/client").PrismaClient,
): Promise<Set<string> | null> {
  const cutoff = new Date(Date.now() - LEGACY_THRESHOLD_DAYS * 86_400_000);

  // Retention guard, over ALL page views regardless of viewer role.
  const oldest = await prisma.activityLog.aggregate({
    where: { type: "DASHBOARD_VIEWED", entityType: "page" },
    _min: { createdAt: true },
  });
  if (!oldest._min.createdAt || oldest._min.createdAt > cutoff) {
    console.warn("[page-traffic] legacy: retained history shorter than threshold; failing open");
    return null;
  }

  const admins = await prisma.user.findMany({
    where: { roles: { has: "ADMIN" } },
    select: { id: true },
  });
  const adminIds = admins.map((a) => a.id);

  // Distinct paths viewed by a non-admin (or userless log row) within the window.
  // groupBy runs GROUP BY in the database, so result cardinality is bounded by the
  // number of distinct paths. Do NOT use findMany({ distinct, take }): without the
  // nativeDistinct preview feature Prisma dedupes in memory while `take` LIMITs raw
  // rows, silently dropping paths and falsely demoting actively-used pages.
  const rows = await prisma.activityLog.groupBy({
    by: ["entityId"],
    where: {
      type: "DASHBOARD_VIEWED",
      entityType: "page",
      entityId: { not: null },
      createdAt: { gte: cutoff },
      OR: [{ userId: null }, { userId: { notIn: adminIds } }],
    },
  });

  const paths = new Set<string>();
  for (const r of rows) {
    if (r.entityId) paths.add(normalizePath(r.entityId));
  }
  return paths;
}

/**
 * Which of the given hrefs are legacy. Cached 1 hour. Fails open: on DB error,
 * short retention, or missing prisma, returns the empty set (nothing dulled).
 */
export async function getLegacyPaths(hrefs: string[]): Promise<Set<string>> {
  try {
    const { appCache, CACHE_KEYS } = await import("@/lib/cache");
    const cached = appCache.get<string[]>(CACHE_KEYS.PAGE_TRAFFIC_LEGACY);
    let recent: Set<string> | null = null;
    if (cached.hit && cached.data) {
      recent = new Set(cached.data);
    } else {
      const { prisma } = await import("@/lib/db");
      if (!prisma) return new Set();
      recent = await fetchRecentTeamViewPaths(prisma);
      if (recent === null) return new Set(); // guard tripped; never cache a failure
      appCache.set(CACHE_KEYS.PAGE_TRAFFIC_LEGACY, [...recent], {
        ttl: 60 * 60 * 1000,
        staleTtl: 60 * 60 * 1000,
      });
    }
    return computeLegacyPaths(hrefs, recent);
  } catch (e) {
    console.error("[page-traffic] getLegacyPaths failed open:", e);
    return new Set();
  }
}
```

Type note: if `import("@/generated/prisma/client").PrismaClient` does not resolve, check how `src/lib/db.ts` types its export and reuse that type. Do not fight it; `Parameters`-free structural typing via the db module's exported client type is fine.

- [ ] **Step 4: Add the cache key to `src/lib/cache.ts`**

In the `CACHE_KEYS` object, add:

```ts
  PAGE_TRAFFIC_LEGACY: "page-traffic:legacy-paths",
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest src/__tests__/page-traffic-legacy.test.ts src/__tests__/page-traffic.test.ts
```

Expected: PASS. The pre-existing page-traffic tests still pass (no DB import at module load).

- [ ] **Step 6: Commit**

```bash
git add src/lib/page-traffic.ts src/lib/cache.ts src/__tests__/page-traffic-legacy.test.ts
git commit -m "feat(page-traffic): legacy-path computation with retention guard and 1h cache

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 3: Card partition helper

**Files:**
- Modify: `src/components/SuitePageShell.tsx`
- Test: `src/__tests__/components/suite-legacy-partition.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/components/suite-legacy-partition.test.ts`. IMPORTANT: SuitePageShell's import chain reaches `next-auth/react` (via UserMenu and HeaderControls), which is ESM-only and unparseable by this repo's Jest config. Mock it up front, exactly like `src/__tests__/components/admin-shell/AdminShell.test.tsx` does:

```ts
// next-auth v5 beta is ESM-only; Jest cannot parse it. Mock before importing
// anything that transitively imports next-auth/react.
jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: null }),
  signOut: jest.fn(),
  SessionProvider: ({ children }: { children: unknown }) => children,
}));

import { partitionLegacyCards, type SuitePageCard } from "@/components/SuitePageShell";

const card = (href: string, section = "Tools"): SuitePageCard => ({
  href,
  title: href,
  description: "",
  tag: "T",
  section,
});

describe("partitionLegacyCards", () => {
  it("splits cards by legacy-set membership, preserving order and section", () => {
    const cards = [card("/a", "S1"), card("/b", "S1"), card("/c", "S2")];
    const { fresh, legacy } = partitionLegacyCards(cards, new Set(["/b"]));
    expect(fresh.map((c) => c.href)).toEqual(["/a", "/c"]);
    expect(legacy.map((c) => c.href)).toEqual(["/b"]);
    expect(legacy[0].section).toBe("S1"); // original section kept for accent color
  });

  it("returns empty legacy list for empty set", () => {
    const { fresh, legacy } = partitionLegacyCards([card("/a")], new Set());
    expect(fresh).toHaveLength(1);
    expect(legacy).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/__tests__/components/suite-legacy-partition.test.ts
```

Expected: FAIL. With the next-auth mock in place the module loads, and the failure is `partitionLegacyCards` is undefined / not exported. If instead you see `SyntaxError: Cannot use import statement outside a module` pointing at next-auth, the mock is missing or placed after the import.

- [ ] **Step 3: Implement the helper in SuitePageShell.tsx**

Add above the `SuitePageShell` component (uses the legacy set keyed by raw `card.href`, matching what `getLegacyPaths` was given):

```ts
/** Partition cards into fresh and legacy by membership of card.href in the legacy set. */
export function partitionLegacyCards(
  cards: SuitePageCard[],
  legacyPaths: Set<string>,
): { fresh: SuitePageCard[]; legacy: SuitePageCard[] } {
  const fresh: SuitePageCard[] = [];
  const legacy: SuitePageCard[] = [];
  for (const c of cards) {
    (legacyPaths.has(c.href) ? legacy : fresh).push(c);
  }
  return { fresh, legacy };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest src/__tests__/components/suite-legacy-partition.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/SuitePageShell.tsx src/__tests__/components/suite-legacy-partition.test.ts
git commit -m "feat(suites): partitionLegacyCards helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 4: Render the Legacy section in SuitePageShell

**Files:**
- Modify: `src/components/SuitePageShell.tsx`

No new unit test for JSX. This is a deliberate deviation from the spec's Testing section (which asks for a SuitePageShell partition-rendering test and a 59/60/61-day boundary test): rendering an async server component under this repo's Jest setup is blocked by the next-auth ESM constraint, and the day-boundary now lives inside the SQL `createdAt: { gte: cutoff }` filter, which the Task 2 query-shape test pins to ~60 days. Partition logic is covered by Task 3; rendering is verified live in Task 5. Reference the spec's Rendering section while working.

- [ ] **Step 1: Make the component async and partition cards**

1. Add the import:

```ts
import { getLegacyPaths } from "@/lib/page-traffic";
```

2. Change the signature:

```ts
export default async function SuitePageShell({ ... }: SuitePageShellProps) {
```

3. Replace the current `const sections = groupCards(visibleCards);` with:

```ts
  const legacyPaths = await getLegacyPaths(visibleCards.map((c) => c.href));
  const { fresh: freshCards, legacy: legacyCards } = partitionLegacyCards(visibleCards, legacyPaths);
  const sections = groupCards(freshCards);
```

- [ ] **Step 2: Add the section color**

In `SECTION_COLORS`, add:

```ts
  "Legacy": "#64748b",
```

- [ ] **Step 3: Render the Legacy details section**

The card-grid JSX lives inside `sections.map(({ section, cards: sectionCards }) => ...)`. Extract the body of that callback into a local render helper so the Legacy section reuses it without duplication. Inside the component, above the `return`:

```tsx
  const renderSectionBody = (sectionCards: SuitePageCard[], dulled: boolean) => {
    const rows = getGridRows(sectionCards, columnsClassName);
    return rows.map((row, rowIdx) => (
      /* existing rows.map JSX moved here verbatim, with ONE change:
         the enabled-card variant of cardClass gains
         `dulled ? " opacity-60 hover:opacity-100 transition-opacity" : ""`;
         the disabled-card variant gains `dulled ? " transition-opacity" : ""` only
         (disabled cards already render at opacity-60 and should not brighten on
         hover since they are not clickable). */
    ));
  };
```

The moved JSX closes over `accent`, `columnsClassName`, and `hexToRgb`, so `renderSectionBody` must remain inside the component body (as shown), not become a module-level function.

Then the existing sections render becomes:

```tsx
        {sections.map(({ section, cards: sectionCards }) => (
          <section key={section} className="mb-8">
            {/* existing section heading JSX unchanged */}
            {renderSectionBody(sectionCards, false)}
          </section>
        ))}

        {legacyCards.length > 0 && (
          <details className="mb-8 group/legacy">
            <summary className="flex cursor-pointer list-none items-center gap-2 mb-4 select-none">
              <div
                className="w-1 h-4 rounded-sm"
                style={{ background: `linear-gradient(to bottom, ${SECTION_COLORS["Legacy"]}, transparent)` }}
              />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                Legacy
              </h2>
              <span className="text-xs text-muted opacity-60">
                {legacyCards.length} rarely-used page{legacyCards.length === 1 ? "" : "s"}
                <span className="ml-1 inline-block transition-transform group-open/legacy:rotate-90">›</span>
              </span>
            </summary>
            {renderSectionBody(legacyCards, true)}
          </details>
        )}
```

Implementation notes:

- Move the existing rows/cards JSX into `renderSectionBody` verbatim; do not restyle anything else. The per-card accent color still reads `SECTION_COLORS[item.section || ""]`, so legacy cards keep their original section's accent (cards' `section` fields are untouched).
- `<details>`/`<summary>` needs no client JS; this stays a server component.
- Legacy cards remain fully clickable links; only opacity changes.

- [ ] **Step 4: Typecheck and lint the whole project**

```bash
npx tsc --noEmit && npm run lint
```

Expected: clean. (`tsc` project-wide, not per-file.) All 11 suite pages already `await`-render server components, and Next.js accepts async components without call-site changes, so no suite page edits are expected. If `tsc` flags any caller, fix it minimally and note it in the commit message.

- [ ] **Step 5: Run the full test suite**

```bash
npx jest
```

Expected: no NEW failures relative to the Task 1 baseline. `suite-map.test.ts` (and any other pre-existing reds recorded in Task 1) remain red for the same next-auth ESM reason; that is not a gate failure. The page-traffic tests and both new test files must pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/SuitePageShell.tsx
git commit -m "feat(suites): auto-dulled collapsed Legacy section on suite landing pages

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 5: Live verification

**Files:** none

- [ ] **Step 1: Run the dev server from the worktree and load the Operations suite**

Use the Browser pane (`preview_start` with a launch.json entry pointing at the worktree, or the existing dev config run from the worktree directory). Sign in and open `/suites/operations`.

- [ ] **Step 2: Verify expected behavior**

Expected-outcome checklist (production-data claims; verify shape, not exact membership):

- A collapsed "Legacy" section appears at the bottom listing roughly: catalog, comms, construction, equipment-backlog, forecast-schedule, inspection-metrics, map, pipeline-tracker, product-requests-review, survey-metrics.
- Daily tools (scheduler, crew-schedule, site-survey, bom, my-tasks) remain in their normal sections at full opacity.
- Expanding the section shows dulled cards that brighten on hover and navigate on click.
- `/suites/executive` shows its own Legacy section; a suite with no stale cards shows no section.
- Server logs show no `getLegacyPaths failed open` errors.

Take a screenshot of the expanded Legacy section for the PR.

- [ ] **Step 3: Confirm fail-open behavior once**

Temporarily point `DATABASE_URL` in the worktree's `.env` at an unreachable host (e.g. change the hostname to `db.invalid`), restart dev, reload `/suites/operations`. Expected: the page renders normally with NO Legacy section, and the server log shows `getLegacyPaths failed open`. (Do not just unset the variable: that takes the `prisma = null` early-return path in `src/lib/db.ts` and never exercises the catch.) If the page errors for an unrelated DB reason (e.g. session or role lookups also need the DB), that is not a feature failure; the check that matters is that the `getLegacyPaths failed open` log line appears and the Legacy section is absent rather than the shell crashing. Restore `.env` afterward and re-verify normal rendering.

### Task 6: PR

**Files:** none

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/suite-legacy-sections
gh pr create --title "Auto-dulled Legacy sections on suite landing pages" --body "$(cat <<'EOF'
## Summary
- Suite landing pages now demote pages with no non-admin views in 60 days into a collapsed, dulled "Legacy" section (spec: docs/superpowers/specs/2026-07-20-suite-legacy-sections-design.md)
- New getLegacyPaths() in lib/page-traffic.ts: 1h cached, retention-guarded, fails open
- SuitePageShell made async; native <details>, no client JS; no routing/access changes

## Test plan
- [x] Unit tests: computeLegacyPaths, fetchRecentTeamViewPaths (fake prisma), partitionLegacyCards
- [x] Full jest suite, tsc, lint
- [x] Live-verified /suites/operations and /suites/executive (screenshot attached)
- [x] Fail-open verified with DB unreachable

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Report back**

Deploys go through GitHub (push, PR, merge). Do not merge; Zach reviews and merges. Attach the verification screenshot to the PR.
