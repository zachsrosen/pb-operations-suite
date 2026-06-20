# Vishtik Project ID Sync — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate HubSpot deal properties `vishtik_project_id` + a new `vishtik_project_url` by matching deals (`project_number` = `PROJ-XXXX`) to Vishtik portal projects, via a nightly cron that backfills then self-maintains.

**Architecture:** A server-side Vishtik client (`src/lib/vishtik.ts`) logs in headlessly and scrapes the full project list. A pure-logic sync module (`src/lib/vishtik-sync.ts`) matches each unpopulated deal to exactly one Vishtik project (by PROJ token) and writes both fields via HubSpot batch update, iterating deals by a `createdate` cursor to bypass HubSpot's 10k search window. A cron route drives it, gated by a `SystemConfig` flag and CRON_SECRET, recording each run in a `VishtikSyncRun` row.

**Tech Stack:** Next.js 16 (route handlers), TypeScript, Prisma 7 (Neon Postgres), HubSpot CRM v3 (`@hubspot/api-client`), Jest, Sentry, Vercel Cron.

**Spec:** `docs/superpowers/specs/2026-06-20-vishtik-id-sync-design.md`

**Conventions to follow:**
- Prisma client: `import { prisma } from "@/lib/db"`. It is typed non-null (`db.ts` uses `globalForPrisma.prisma!`) but is actually `null` at runtime when `DATABASE_URL` is unset — keep the `if (!prisma)` guards as defensive runtime checks even though TS sees it as always-defined.
- HubSpot helpers in `@/lib/hubspot`: `searchWithRetry(req)` (takes the `searchApi.doSearch` arg shape, returns `{ results, paging }`), `updateDealProperty(id, props)`. We read `project_number` directly off search results — no separate batch-read needed.
- Sentry: `import * as Sentry from "@sentry/nextjs"`.
- Cron pattern: see `src/app/api/cron/property-reconcile/route.ts`.
- Run a single test file: `npm test -- <path>`; full type check: `npm run build` is heavy — use `npx tsc --noEmit` for the worktree.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/vishtik.ts` | Vishtik HTTP client: headless login (cookie + CSRF), full project-list fetch (pagination + tiling fallback), `customer_name → projNumber` parse. Pure transport, injectable. |
| `src/lib/vishtik-sync.ts` | Pure sync logic: build PROJ index, match deals, write via HubSpot, cursor windowing, lock, sanity gate. All external calls injected for testing. |
| `src/app/api/cron/vishtik-id-sync/route.ts` | Cron entrypoint: auth, flag, invoke sync, persist `VishtikSyncRun`, Sentry alerts. |
| `prisma/schema.prisma` (+ migration) | `VishtikSyncRun` model (observability). |
| `scripts/create-vishtik-url-property.ts` | One-off: create `vishtik_project_url` deal property mirroring `vishtik_project_id`'s group. |
| `vercel.json` | Register nightly cron + `maxDuration`. |
| `.env.example` | Document `VISHTIK_USERNAME` / `VISHTIK_PASSWORD`. |
| `src/__tests__/vishtik-parse.test.ts` | Unit tests for parsing/index helpers. |
| `src/__tests__/vishtik-sync.test.ts` | Unit tests for the sync orchestration with fakes. |

---

## Chunk 1: Vishtik client + parsing helpers

### Task 1.1: Types + `customer_name` parsing

**Files:**
- Create: `src/lib/vishtik.ts`
- Test: `src/__tests__/vishtik-parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/vishtik-parse.test.ts
import { parseProjNumber, detailUrl } from "@/lib/vishtik";

describe("parseProjNumber", () => {
  it("extracts PROJ token from standard name", () => {
    expect(parseProjNumber("PROJ-9689 | Xu, Sarah")).toBe("PROJ-9689");
  });
  it("extracts PROJ token with D&R prefix", () => {
    expect(parseProjNumber("D&R | PROJ-8455 | Pine, Tim")).toBe("PROJ-8455");
  });
  it("returns null when no PROJ token", () => {
    expect(parseProjNumber("D&R | Mongait, Peter")).toBeNull();
  });
});

describe("detailUrl", () => {
  it("builds the Vishtik detail URL", () => {
    expect(detailUrl("6947")).toBe(
      "https://project.vishtik.com/Project/Project/Project-Details?id=6947",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/vishtik-parse.test.ts`
Expected: FAIL — module/exports not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/vishtik.ts
export const VISHTIK_BASE = "https://project.vishtik.com";

export interface VishtikProject {
  vishtikId: string;
  projNumber: string | null;
  customerName: string;
  status: string;
}

export function parseProjNumber(customerName: string): string | null {
  const m = (customerName || "").match(/PROJ-\d+/);
  return m ? m[0] : null;
}

export function detailUrl(vishtikId: string): string {
  return `${VISHTIK_BASE}/Project/Project/Project-Details?id=${vishtikId}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/vishtik-parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vishtik.ts src/__tests__/vishtik-parse.test.ts
git commit -m "feat(vishtik): project name parsing + detail URL helpers"
```

### Task 1.2: Cookie jar + CSRF extraction helper

CodeIgniter requires the CSRF token (from a cookie) to be echoed as a POST field. The browser helper relied on jQuery's prefilter; server-side we extract it ourselves.

**Files:**
- Modify: `src/lib/vishtik.ts`
- Test: `src/__tests__/vishtik-parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/__tests__/vishtik-parse.test.ts
import { CookieJar } from "@/lib/vishtik";

describe("CookieJar", () => {
  it("stores cookies from set-cookie and serializes a Cookie header", () => {
    const jar = new CookieJar();
    jar.absorb(["ci_session=abc; Path=/; HttpOnly", "ci_csrf_token=tok123; Path=/"]);
    expect(jar.header()).toContain("ci_session=abc");
    expect(jar.header()).toContain("ci_csrf_token=tok123");
  });
  it("exposes the csrf token value by cookie name", () => {
    const jar = new CookieJar();
    jar.absorb(["ci_csrf_token=tok123; Path=/"]);
    expect(jar.value("ci_csrf_token")).toBe("tok123");
  });
  it("later cookies overwrite earlier ones of the same name", () => {
    const jar = new CookieJar();
    jar.absorb(["ci_session=old; Path=/"]);
    jar.absorb(["ci_session=new; Path=/"]);
    expect(jar.value("ci_session")).toBe("new");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/vishtik-parse.test.ts`
Expected: FAIL — `CookieJar` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to src/lib/vishtik.ts
export class CookieJar {
  private cookies = new Map<string, string>();
  /** Absorb an array of raw Set-Cookie header lines. */
  absorb(setCookies: string[]): void {
    for (const line of setCookies) {
      const first = line.split(";")[0];
      const eq = first.indexOf("=");
      if (eq === -1) continue;
      const name = first.slice(0, eq).trim();
      const val = first.slice(eq + 1).trim();
      if (name) this.cookies.set(name, val);
    }
  }
  value(name: string): string | undefined {
    return this.cookies.get(name);
  }
  /** First cookie whose name contains "csrf" (CI's token cookie name varies). */
  csrfToken(): string | undefined {
    for (const [name, val] of this.cookies) {
      if (/csrf/i.test(name)) return val;
    }
    return undefined;
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/vishtik-parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vishtik.ts src/__tests__/vishtik-parse.test.ts
git commit -m "feat(vishtik): cookie jar with CSRF token extraction"
```

### Task 1.3: Login + list fetch (transport-injected)

Login and fetch hit the live (slow, flaky) Vishtik server, so the network layer is injected (`VishtikTransport`) and these functions are exercised in tests with a fake transport. **Two empirical unknowns are confirmed in the dry-run rollout step, not CI:** (a) the exact CSRF cookie/param name, (b) whether `cntr` paginates or needs the `showtotal`-tiling fallback. The code supports both.

**Files:**
- Modify: `src/lib/vishtik.ts`
- Test: `src/__tests__/vishtik-parse.test.ts`

- [ ] **Step 1: Write the failing test** (fetch assembles projects across pages + tiling)

```ts
// add to src/__tests__/vishtik-parse.test.ts
import { fetchAllProjects, type VishtikTransport } from "@/lib/vishtik";

function fakeTransport(pages: Record<number, { data: { id: string; customer_name: string; status: string }[]; total_page: number; current_page: number; total_row: number }>): VishtikTransport {
  return {
    async login() {/* no-op */},
    async getProjectPage({ cntr }) {
      return pages[cntr] ?? { data: [], total_page: 1, current_page: cntr, total_row: 0 };
    },
  };
}

describe("fetchAllProjects", () => {
  it("collects projects across normal cntr pages and de-dupes by id", async () => {
    const t = fakeTransport({
      1: { data: [{ id: "1", customer_name: "PROJ-1 | A", status: "4" }], total_page: 2, current_page: 1, total_row: 2 },
      2: { data: [{ id: "2", customer_name: "PROJ-2 | B", status: "16" }], total_page: 2, current_page: 2, total_row: 2 },
    });
    const { projects, complete } = await fetchAllProjects(t);
    expect(complete).toBe(true);
    expect(projects.map((p) => p.vishtikId).sort()).toEqual(["1", "2"]);
    expect(projects.find((p) => p.vishtikId === "1")?.projNumber).toBe("PROJ-1");
  });

  it("marks complete:false when fetched rows fall well short of total_row", async () => {
    const t = fakeTransport({
      1: { data: [{ id: "1", customer_name: "PROJ-1 | A", status: "4" }], total_page: 1, current_page: 1, total_row: 1000 },
    });
    const { complete } = await fetchAllProjects(t);
    expect(complete).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/vishtik-parse.test.ts`
Expected: FAIL — `fetchAllProjects` / `VishtikTransport` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to src/lib/vishtik.ts
export class VishtikAuthError extends Error {}

export interface ProjectPage {
  data: { id: string; customer_name: string; status: string }[];
  total_page: number;
  current_page: number;
  total_row: number;
}

export interface VishtikTransport {
  login(): Promise<void>;
  /** One Get-Project call. `cntr` = page number, `showtotal` = page size. */
  getProjectPage(args: { cntr: number; showtotal: number }): Promise<ProjectPage>;
}

const COMPLETENESS_TOLERANCE = 0.95; // fetched must reach ≥95% of total_row

function toProjects(rows: ProjectPage["data"]): VishtikProject[] {
  return rows.map((r) => ({
    vishtikId: String(r.id),
    projNumber: parseProjNumber(r.customer_name),
    customerName: r.customer_name,
    status: String(r.status),
  }));
}

/**
 * Fetch the entire Vishtik project list. Strategy:
 *  1. Page through with cntr=1..total_page at showtotal=100.
 *  2. If the cursor is stuck (current_page stops advancing with cntr), fall
 *     back to showtotal tiling: page-2-of-size-S returns rows [S+1, 2S];
 *     a halving sequence of S covers the list, row 1 is grabbed separately.
 * Returns {complete:false} if coverage < tolerance of total_row (so the caller
 * suppresses writes rather than under-matching on a partial scrape).
 */
export async function fetchAllProjects(
  t: VishtikTransport,
): Promise<{ projects: VishtikProject[]; complete: boolean }> {
  await t.login();
  const byId = new Map<string, VishtikProject>();
  const ingest = (rows: ProjectPage["data"]) =>
    toProjects(rows).forEach((p) => byId.set(p.vishtikId, p));

  const first = await t.getProjectPage({ cntr: 1, showtotal: 100 });
  ingest(first.data);
  const totalRow = first.total_row;

  // Detect whether cntr paginates: fetch page 2 and see if it differs.
  let cursorWorks = true;
  if (first.total_page > 1) {
    const second = await t.getProjectPage({ cntr: 2, showtotal: 100 });
    const firstIds = new Set(first.data.map((r) => String(r.id)));
    const secondNew = second.data.some((r) => !firstIds.has(String(r.id)));
    cursorWorks = secondNew;
    ingest(second.data);
    if (cursorWorks) {
      for (let p = 3; p <= first.total_page; p++) {
        ingest((await t.getProjectPage({ cntr: p, showtotal: 100 })).data);
      }
    }
  }

  if (!cursorWorks) {
    // Tiling fallback: server is stuck returning "page 2"; window = [S+1, 2S].
    const sizes = [1140, 570, 285, 143, 72, 36, 18, 9, 5, 3, 2, 1];
    for (const S of sizes) {
      ingest((await t.getProjectPage({ cntr: 1, showtotal: S })).data);
    }
    // row 1 is only reachable from a fresh page-1 render (DOM in the browser
    // skill); server-side it is covered by the smallest tile when present.
  }

  const projects = [...byId.values()];
  const complete = totalRow === 0 ? projects.length === 0
    : projects.length >= Math.floor(totalRow * COMPLETENESS_TOLERANCE);
  return { projects, complete };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/vishtik-parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vishtik.ts src/__tests__/vishtik-parse.test.ts
git commit -m "feat(vishtik): fetchAllProjects with cntr pagination + tiling fallback"
```

### Task 1.4: Real HTTP transport (`fetchTransport`)

Concrete `VishtikTransport` using `fetch` + the `CookieJar`. Not unit-tested (network); validated in the dry-run rollout step.

**Files:**
- Modify: `src/lib/vishtik.ts`

- [ ] **Step 1: Implement**

```ts
// add to src/lib/vishtik.ts
const TIMEZONE = "America/Denver";

/** Live transport. Logs in with env creds; re-logins once on a mid-run 401. */
export function fetchTransport(): VishtikTransport {
  const jar = new CookieJar();
  let loggedIn = false;

  async function doLogin(): Promise<void> {
    const user = process.env.VISHTIK_USERNAME;
    const pass = process.env.VISHTIK_PASSWORD;
    if (!user || !pass) throw new VishtikAuthError("VISHTIK_USERNAME/PASSWORD not set");
    // Warm cookies (CI sets ci_session + csrf cookie on GET /login).
    const g = await fetch(`${VISHTIK_BASE}/login`, { redirect: "manual" });
    jar.absorb(g.headers.getSetCookie());
    const body = new URLSearchParams({
      back_url: "",
      timezone: TIMEZONE,
      username: user,
      password: pass,
    });
    const csrf = jar.csrfToken();
    if (csrf) body.set("ci_csrf_token", csrf); // exact field name confirmed in dry-run
    const r = await fetch(`${VISHTIK_BASE}/login-auth`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: jar.header(),
      },
      body,
    });
    jar.absorb(r.headers.getSetCookie());
    const location = r.headers.get("location") || "";
    if (location.includes("/login")) throw new VishtikAuthError("Vishtik login rejected");
    loggedIn = true;
  }

  return {
    async login() {
      if (!loggedIn) await doLogin();
    },
    async getProjectPage({ cntr, showtotal }) {
      const params = new URLSearchParams({
        cntr: String(cntr),
        recorddata: String(showtotal),
        showtotal: String(showtotal),
        search: "", status: "", servicetype: "",
        startdate: "", enddate: "", bylastdate: "", pe_stamp: "",
        allproject: "1", assigned_user: "", assigned_me: "0", created_user: "",
      });
      const csrf = jar.csrfToken();
      if (csrf) params.set("ci_csrf_token", csrf);
      const call = () =>
        fetch(`${VISHTIK_BASE}/Project/Project/Get-Project`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
            Cookie: jar.header(),
          },
          body: params,
        });
      let r = await call();
      if (r.status === 401 || r.status === 302) {
        loggedIn = false;
        await doLogin();
        r = await call();
      }
      const json = (await r.json()) as ProjectPage;
      jar.absorb(r.headers.getSetCookie());
      return json;
    },
  };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in `src/lib/vishtik.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/vishtik.ts
git commit -m "feat(vishtik): live fetch transport (headless login + CSRF + re-login)"
```

---

## Chunk 2: Sync core (matching + writing)

### Task 2.1: `buildProjIndex` + match classification

**Files:**
- Create: `src/lib/vishtik-sync.ts`
- Test: `src/__tests__/vishtik-sync.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/vishtik-sync.test.ts
import { buildProjIndex, classifyMatch } from "@/lib/vishtik-sync";
import type { VishtikProject } from "@/lib/vishtik";

const P = (id: string, name: string): VishtikProject => ({
  vishtikId: id, customerName: name, status: "4",
  projNumber: name.match(/PROJ-\d+/)?.[0] ?? null,
});

describe("buildProjIndex / classifyMatch", () => {
  const idx = buildProjIndex([
    P("100", "PROJ-1 | A"),
    P("200", "PROJ-2 | B"),
    P("201", "PROJ-2 | B dup"),
  ]);

  it("returns the single match", () => {
    expect(classifyMatch(idx, "PROJ-1")).toEqual({ kind: "single", vishtikId: "100" });
  });
  it("returns ambiguous for duplicate PROJ", () => {
    expect(classifyMatch(idx, "PROJ-2")).toEqual({ kind: "ambiguous", candidateIds: ["200", "201"] });
  });
  it("returns none for unknown PROJ", () => {
    expect(classifyMatch(idx, "PROJ-9")).toEqual({ kind: "none" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/vishtik-sync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/vishtik-sync.ts
import type { VishtikProject } from "@/lib/vishtik";

export type Match =
  | { kind: "single"; vishtikId: string }
  | { kind: "ambiguous"; candidateIds: string[] }
  | { kind: "none" };

export function buildProjIndex(projects: VishtikProject[]): Map<string, VishtikProject[]> {
  const idx = new Map<string, VishtikProject[]>();
  for (const p of projects) {
    if (!p.projNumber) continue;
    const arr = idx.get(p.projNumber) ?? [];
    arr.push(p);
    idx.set(p.projNumber, arr);
  }
  return idx;
}

export function classifyMatch(idx: Map<string, VishtikProject[]>, projNumber: string): Match {
  const hits = idx.get(projNumber) ?? [];
  if (hits.length === 1) return { kind: "single", vishtikId: hits[0].vishtikId };
  if (hits.length > 1) return { kind: "ambiguous", candidateIds: hits.map((h) => h.vishtikId) };
  return { kind: "none" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/vishtik-sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vishtik-sync.ts src/__tests__/vishtik-sync.test.ts
git commit -m "feat(vishtik): PROJ index + match classification"
```

### Task 2.2: `syncVishtikIds` orchestration (DI, dryRun, sanity gate, never-null)

**Files:**
- Modify: `src/lib/vishtik-sync.ts`
- Test: `src/__tests__/vishtik-sync.test.ts`

Injected dependencies (`SyncDeps`) keep the function pure/testable: Vishtik fetch, a deal iterator (yields batches of `{ id, projNumber }`), a writer, and a clock. The real cron supplies HubSpot-backed implementations (Task 2.3).

- [ ] **Step 1: Write the failing test**

```ts
// add to src/__tests__/vishtik-sync.test.ts
import { syncVishtikIds, type SyncDeps } from "@/lib/vishtik-sync";

function deps(over: Partial<SyncDeps>): SyncDeps {
  return {
    fetchProjects: async () => ({
      projects: [
        P("100", "PROJ-1 | A"),
        P("200", "PROJ-2 | B"),
        P("201", "PROJ-2 | B dup"),
      ],
      complete: true,
    }),
    iterateCandidates: async function* () {
      yield [
        { dealId: "d1", projNumber: "PROJ-1" }, // single -> write
        { dealId: "d2", projNumber: "PROJ-2" }, // ambiguous -> skip
        { dealId: "d3", projNumber: "PROJ-9" }, // none -> skip
      ];
    },
    writeDeal: jest.fn(async () => true),
    lastGoodCount: async () => 3,
    setLastGoodCount: async () => {},
    ...over,
  };
}

describe("syncVishtikIds", () => {
  it("writes only single matches with id + url, never null", async () => {
    const writeDeal = jest.fn(async () => true);
    const res = await syncVishtikIds({ dryRun: false }, deps({ writeDeal }));
    expect(res.written).toBe(1);
    expect(res.ambiguous).toHaveLength(1);
    expect(res.unmatchedCount).toBe(1);
    expect(writeDeal).toHaveBeenCalledTimes(1);
    expect(writeDeal).toHaveBeenCalledWith("d1", {
      vishtik_project_id: "100",
      vishtik_project_url: "https://project.vishtik.com/Project/Project/Project-Details?id=100",
    });
  });

  it("dryRun does the matching but writes nothing", async () => {
    const writeDeal = jest.fn(async () => true);
    const res = await syncVishtikIds({ dryRun: true }, deps({ writeDeal }));
    expect(res.written).toBe(1); // counted as would-write
    expect(writeDeal).not.toHaveBeenCalled();
  });

  it("aborts with no writes when fetch is incomplete", async () => {
    const writeDeal = jest.fn(async () => true);
    const res = await syncVishtikIds(
      { dryRun: false },
      deps({ fetchProjects: async () => ({ projects: [], complete: false }) }),
    );
    expect(res.aborted).toBe("incomplete-fetch");
    expect(writeDeal).not.toHaveBeenCalled();
  });

  it("aborts when fetched count drops >15% vs last good", async () => {
    const writeDeal = jest.fn(async () => true);
    const res = await syncVishtikIds(
      { dryRun: false },
      deps({
        fetchProjects: async () => ({ projects: [P("100", "PROJ-1 | A")], complete: true }),
        lastGoodCount: async () => 100,
      }),
    );
    expect(res.aborted).toBe("suspicious-count");
    expect(writeDeal).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/vishtik-sync.test.ts`
Expected: FAIL — `syncVishtikIds` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to src/lib/vishtik-sync.ts
import { detailUrl, type VishtikProject } from "@/lib/vishtik";

export interface Candidate { dealId: string; projNumber: string }

export interface SyncDeps {
  fetchProjects: () => Promise<{ projects: VishtikProject[]; complete: boolean }>;
  iterateCandidates: () => AsyncGenerator<Candidate[]>;
  writeDeal: (dealId: string, props: Record<string, string>) => Promise<boolean>;
  lastGoodCount: () => Promise<number | null>;
  setLastGoodCount: (n: number) => Promise<void>;
}

export interface SyncResult {
  totalScanned: number;
  written: number;
  ambiguous: { projNumber: string; candidateIds: string[] }[];
  unmatchedCount: number;
  writeFailures: number;
  fetchedCount: number;
  aborted?: "incomplete-fetch" | "suspicious-count";
  durationMs: number;
}

const ABS_FLOOR = 500;
const DROP_TOLERANCE = 0.85; // abort if fetched < 85% of last-good

export async function syncVishtikIds(
  opts: { dryRun: boolean },
  deps: SyncDeps,
): Promise<SyncResult> {
  const start = Date.now();
  const base: SyncResult = {
    totalScanned: 0, written: 0, ambiguous: [], unmatchedCount: 0,
    writeFailures: 0, fetchedCount: 0, durationMs: 0,
  };

  const { projects, complete } = await deps.fetchProjects();
  base.fetchedCount = projects.length;
  if (!complete) return { ...base, aborted: "incomplete-fetch", durationMs: Date.now() - start };

  const lastGood = await deps.lastGoodCount();
  const suspicious =
    projects.length < ABS_FLOOR ||
    (lastGood != null && lastGood > 0 && projects.length < lastGood * DROP_TOLERANCE);
  if (suspicious) return { ...base, aborted: "suspicious-count", durationMs: Date.now() - start };

  if (!opts.dryRun) await deps.setLastGoodCount(projects.length);

  const idx = buildProjIndex(projects);
  for await (const batch of deps.iterateCandidates()) {
    for (const c of batch) {
      base.totalScanned++;
      const m = classifyMatch(idx, c.projNumber);
      if (m.kind === "single") {
        base.written++;
        if (!opts.dryRun) {
          const ok = await deps.writeDeal(c.dealId, {
            vishtik_project_id: m.vishtikId,
            vishtik_project_url: detailUrl(m.vishtikId),
          });
          if (!ok) { base.written--; base.writeFailures++; }
        }
      } else if (m.kind === "ambiguous") {
        base.ambiguous.push({ projNumber: c.projNumber, candidateIds: m.candidateIds });
      } else {
        base.unmatchedCount++;
      }
    }
  }
  return { ...base, durationMs: Date.now() - start };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/vishtik-sync.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/vishtik-sync.ts src/__tests__/vishtik-sync.test.ts
git commit -m "feat(vishtik): syncVishtikIds orchestration with sanity gate + dryRun"
```

### Task 2.3: Candidate iterator (testable) + config/lock helpers

The candidate iterator is the trickiest logic (cursor windowing, dryRun no-persist, page-boundary safety), so it's extracted into a **pure, injectable** `makeCandidateIterator` and unit-tested in Task 2.4. It bypasses HubSpot's 10k search window by resuming from a `createdate` watermark across runs, and pages **within** a run by the `after` token (which has no same-millisecond boundary skip — unlike a `createdate + 1ms` jump).

**Files:**
- Modify: `src/lib/vishtik-sync.ts`

- [ ] **Step 1: Implement config helpers, the lock (with owner token), and the injectable iterator**

```ts
// add to src/lib/vishtik-sync.ts
import { prisma } from "@/lib/db";
import { searchWithRetry, updateDealProperty } from "@/lib/hubspot";
import { fetchAllProjects, fetchTransport } from "@/lib/vishtik";

const CURSOR_KEY = "vishtik_sync_cursor";       // createdate watermark (ms epoch as string)
const LAST_GOOD_KEY = "vishtik_last_good_count";
const LOCK_KEY = "vishtik_sync_running";        // value = owner token (ISO timestamp)
const LOCK_TTL_MS = 30 * 60 * 1000;
const PER_RUN_CAP = 4000;                        // deals processed per tick
const PAGE = 100;

async function cfgGet(key: string): Promise<string | null> {
  if (!prisma) return null;
  const row = await prisma.systemConfig.findUnique({ where: { key } });
  return row?.value ?? null;
}
async function cfgSet(key: string, value: string): Promise<void> {
  if (!prisma) return;
  await prisma.systemConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/**
 * Acquire the run lock. Returns an owner token on success, or null if a fresh
 * lock is already held. The token must be passed to releaseLock so a stale
 * takeover by a later run can't have its lock deleted by the original owner's
 * finally block.
 */
export async function acquireLock(now: Date): Promise<string | null> {
  const existing = await cfgGet(LOCK_KEY);
  if (existing) {
    const age = now.getTime() - new Date(existing).getTime();
    if (age >= 0 && age < LOCK_TTL_MS) return null; // held & fresh
  }
  const token = now.toISOString();
  await cfgSet(LOCK_KEY, token);
  return token;
}
export async function releaseLock(token: string): Promise<void> {
  // Only delete if we still own it (compare-and-delete).
  if (prisma) await prisma.systemConfig.deleteMany({ where: { key: LOCK_KEY, value: token } });
}

// Minimal shapes we depend on from the HubSpot search response.
export interface SearchPage {
  results: { id: string; properties?: Record<string, string> }[];
  paging?: { next?: { after?: string } };
}
export interface IteratorDeps {
  search: (args: { cursor: number; after?: string; limit: number }) => Promise<SearchPage>;
  cfgGet: (key: string) => Promise<string | null>;
  cfgSet: (key: string, value: string) => Promise<void>;
  dryRun: boolean;
  perRunCap?: number;
}

/**
 * Yields batches of candidates from the createdate watermark forward.
 * - Pages WITHIN a run via the `after` token (no same-ms boundary skip).
 * - Persists the watermark only when `!dryRun`. On reaching the end of the
 *   filtered set, wraps the watermark to "0" so the next run re-sweeps (heals
 *   previously-unmatched deals; already-written deals are excluded by the filter).
 * - Watermark is set to the LAST seen createdate (no +1) so a same-ms boundary
 *   straddling a run is re-read, not skipped (re-reads are cheap + idempotent).
 */
export function makeCandidateIterator(deps: IteratorDeps) {
  const cap = deps.perRunCap ?? PER_RUN_CAP;
  return async function* (): AsyncGenerator<Candidate[]> {
    const cursor = Number((await deps.cfgGet(CURSOR_KEY)) ?? "0");
    let after: string | undefined;
    let processed = 0;
    let lastCreate: number | null = null;
    let reachedEnd = false;

    while (processed < cap) {
      const page = await deps.search({ cursor, after, limit: PAGE });
      const results = page.results ?? [];
      if (results.length === 0) { reachedEnd = true; break; }

      const batch: Candidate[] = [];
      for (const d of results) {
        const projNumber = d.properties?.project_number;
        if (projNumber) batch.push({ dealId: d.id, projNumber });
      }
      if (batch.length) yield batch;

      processed += results.length;
      const lc = results[results.length - 1].properties?.createdate;
      if (lc) lastCreate = new Date(lc).getTime();
      after = page.paging?.next?.after;
      if (!after) { reachedEnd = true; break; } // exhausted the filtered set
    }

    if (!deps.dryRun) {
      if (reachedEnd) await deps.cfgSet(CURSOR_KEY, "0");      // wrap for next sweep
      else if (lastCreate != null) await deps.cfgSet(CURSOR_KEY, String(lastCreate));
    }
  };
}

/** Live deps: Vishtik fetch + HubSpot candidate iteration + writes. */
export function liveDeps(opts: { dryRun: boolean }): SyncDeps {
  const search = async ({ cursor, after, limit }: { cursor: number; after?: string; limit: number }) => {
    const res = await searchWithRetry({
      filterGroups: [{
        filters: [
          { propertyName: "project_number", operator: "HAS_PROPERTY" },
          { propertyName: "vishtik_project_id", operator: "NOT_HAS_PROPERTY" },
          { propertyName: "createdate", operator: "GTE", value: String(cursor) },
        ],
      }],
      sorts: [{ propertyName: "createdate", direction: "ASCENDING" }],
      properties: ["project_number", "createdate"],
      limit,
      ...(after ? { after } : {}),
    } as Parameters<typeof searchWithRetry>[0]);
    return res as unknown as SearchPage;
  };
  return {
    fetchProjects: () => fetchAllProjects(fetchTransport()),
    lastGoodCount: async () => {
      const v = await cfgGet(LAST_GOOD_KEY);
      return v ? Number(v) : null;
    },
    setLastGoodCount: (n) => cfgSet(LAST_GOOD_KEY, String(n)),
    writeDeal: (dealId, props) => updateDealProperty(dealId, props),
    iterateCandidates: makeCandidateIterator({ search, cfgGet, cfgSet, dryRun: opts.dryRun }),
  };
}
```

Note: writes go through `updateDealProperty` one deal at a time (already 3-tier retry/backoff). If first-run write volume hits rate limits, swap `writeDeal` for a batched `crm/v3/objects/deals/batch/update` — the `SyncDeps` interface is unchanged. One-at-a-time for v1 (YAGNI; the per-run cap bounds volume).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/vishtik-sync.ts
git commit -m "feat(vishtik): testable candidate iterator + token lock + live deps"
```

### Task 2.4: Iterator tests (dryRun no-persist, wrap, after-paging)

**Files:**
- Modify: `src/__tests__/vishtik-sync.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/__tests__/vishtik-sync.test.ts
import { makeCandidateIterator, type SearchPage } from "@/lib/vishtik-sync";

function fakeCfg(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    cfgGet: async (k: string) => store.get(k) ?? null,
    cfgSet: async (k: string, v: string) => { store.set(k, v); },
  };
}

function pages(...batches: SearchPage[]) {
  let i = 0;
  return async () => batches[i++] ?? { results: [] };
}

describe("makeCandidateIterator", () => {
  it("advances the cursor to the last createdate when !dryRun", async () => {
    const cfg = fakeCfg();
    const search = pages(
      { results: [{ id: "d1", properties: { project_number: "PROJ-1", createdate: "2026-01-01T00:00:00Z" } }], paging: {} },
    );
    const gen = makeCandidateIterator({ search, ...cfg, dryRun: false });
    const seen: string[] = [];
    for await (const b of gen()) b.forEach((c) => seen.push(c.dealId));
    expect(seen).toEqual(["d1"]);
    expect(cfg.store.get("vishtik_sync_cursor")).toBe(String(new Date("2026-01-01T00:00:00Z").getTime()));
  });

  it("does NOT persist the cursor under dryRun", async () => {
    const cfg = fakeCfg({ vishtik_sync_cursor: "12345" });
    const search = pages(
      { results: [{ id: "d1", properties: { project_number: "PROJ-1", createdate: "2026-01-01T00:00:00Z" } }], paging: {} },
    );
    const gen = makeCandidateIterator({ search, ...cfg, dryRun: true });
    for await (const _ of gen()) { /* drain */ }
    expect(cfg.store.get("vishtik_sync_cursor")).toBe("12345"); // unchanged
  });

  it("wraps the cursor to 0 when the filtered set is exhausted", async () => {
    const cfg = fakeCfg({ vishtik_sync_cursor: "999" });
    const search = pages({ results: [] });
    const gen = makeCandidateIterator({ search, ...cfg, dryRun: false });
    for await (const _ of gen()) { /* drain */ }
    expect(cfg.store.get("vishtik_sync_cursor")).toBe("0");
  });

  it("follows the after token across pages within a run", async () => {
    const cfg = fakeCfg();
    const search = pages(
      { results: [{ id: "d1", properties: { project_number: "PROJ-1", createdate: "2026-01-01T00:00:00Z" } }], paging: { next: { after: "100" } } },
      { results: [{ id: "d2", properties: { project_number: "PROJ-2", createdate: "2026-01-02T00:00:00Z" } }], paging: {} },
    );
    const gen = makeCandidateIterator({ search, ...cfg, dryRun: false });
    const seen: string[] = [];
    for await (const b of gen()) b.forEach((c) => seen.push(c.dealId));
    expect(seen).toEqual(["d1", "d2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/vishtik-sync.test.ts`
Expected: FAIL — `makeCandidateIterator` not exported (or assertions fail).

- [ ] **Step 3: Make it pass**

The implementation from Task 2.3 should satisfy these. If a test fails, fix `makeCandidateIterator` (not the test).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/vishtik-sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/vishtik-sync.test.ts
git commit -m "test(vishtik): candidate iterator dryRun/​wrap/​after-paging"
```

---

## Chunk 3: Persistence, cron route, schedule, property script

### Task 3.1: `VishtikSyncRun` model + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_vishtik_sync_run/migration.sql`

- [ ] **Step 1: Add the model** (after `HubSpotSyncRun`)

```prisma
model VishtikSyncRun {
  id             String    @id @default(cuid())
  startedAt      DateTime  @default(now())
  finishedAt     DateTime?
  written        Int       @default(0)
  unmatchedCount Int       @default(0)
  ambiguousCount Int       @default(0)
  writeFailures  Int       @default(0)
  fetchedCount   Int       @default(0)
  aborted        String?
  durationMs     Int       @default(0)

  @@index([startedAt])
}
```

- [ ] **Step 2: Generate the migration SQL (do NOT apply)**

Run: `npx prisma migrate dev --name add_vishtik_sync_run --create-only`
Expected: a new migration folder with `CREATE TABLE "VishtikSyncRun"`. (Applied to prod manually during rollout per the migration-ordering convention — additive, safe.)

- [ ] **Step 3: Regenerate the client**

Run: `npx prisma generate`
Expected: `VishtikSyncRun` available on the client type.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(vishtik): VishtikSyncRun observability model"
```

### Task 3.2: Cron route

**Files:**
- Create: `src/app/api/cron/vishtik-id-sync/route.ts`

- [ ] **Step 1: Implement** (mirror `property-reconcile` auth/flag pattern)

```ts
// src/app/api/cron/vishtik-id-sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { syncVishtikIds, liveDeps, acquireLock, releaseLock } from "@/lib/vishtik-sync";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Prod flag lives in SystemConfig (Vercel env cap workaround).
  const flag = prisma
    ? (await prisma.systemConfig.findUnique({ where: { key: "vishtik_sync_enabled" } }))?.value
    : undefined;
  if (flag !== "true") return NextResponse.json({ status: "disabled" });

  const now = new Date();
  const lockToken = await acquireLock(now);
  if (!lockToken) {
    return NextResponse.json({ status: "skipped", reason: "locked" });
  }

  let run: { id: string } | null = null;
  try {
    if (prisma) run = await prisma.vishtikSyncRun.create({ data: {} });
    const result = await syncVishtikIds({ dryRun: false }, liveDeps({ dryRun: false }));

    if (prisma && run) {
      await prisma.vishtikSyncRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          written: result.written,
          unmatchedCount: result.unmatchedCount,
          ambiguousCount: result.ambiguous.length,
          writeFailures: result.writeFailures,
          fetchedCount: result.fetchedCount,
          aborted: result.aborted ?? null,
          durationMs: result.durationMs,
        },
      });
    }
    if (result.aborted) {
      Sentry.captureMessage(`vishtik-id-sync aborted: ${result.aborted}`, "warning");
    } else if (result.writeFailures > 0) {
      Sentry.captureMessage(`vishtik-id-sync: ${result.writeFailures} write failures`, "warning");
    }
    return NextResponse.json({ status: "ok", timestamp: now.toISOString(), ...result });
  } catch (err) {
    Sentry.captureException(err);
    if (prisma && run) {
      await prisma.vishtikSyncRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), aborted: "error" },
      }).catch(() => {});
    }
    return NextResponse.json(
      { status: "error", error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  } finally {
    await releaseLock(lockToken); // compare-and-delete: only releases our own lock
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Add route to role allowlist if required**

Check `src/lib/roles.ts` — cron routes under `/api/cron/*` are covered by the existing public/cron prefix in `src/middleware.ts`; confirm `vishtik-id-sync` needs no per-role entry (other cron routes have none). Document the check in the commit.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/vishtik-id-sync/route.ts
git commit -m "feat(vishtik): nightly cron route with lock + run-log + Sentry"
```

### Task 3.3: Register cron in `vercel.json`

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Add to the `functions` maxDuration map**

```json
"src/app/api/cron/vishtik-id-sync/route.ts": { "maxDuration": 300 }
```

- [ ] **Step 2: Add to the `crons` array**

```json
{ "path": "/api/cron/vishtik-id-sync", "schedule": "0 8 * * *" }
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add vercel.json
git commit -m "chore(vishtik): schedule nightly vishtik-id-sync cron"
```

### Task 3.4: Property-creation script + env docs

**Files:**
- Create: `scripts/create-vishtik-url-property.ts`
- Modify: `.env.example`

- [ ] **Step 1: Implement the script** (mirror `scripts/create-hs-crosslink-props.ts`, but read the existing id property's group)

```ts
// scripts/create-vishtik-url-property.ts
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // fall back to .env

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function main() {
  // Mirror the existing vishtik_project_id property's group/fieldType.
  const idRes = await fetch("https://api.hubapi.com/crm/v3/properties/deals/vishtik_project_id", { headers: H });
  if (!idRes.ok) throw new Error(`vishtik_project_id lookup failed: ${idRes.status}`);
  const idProp = await idRes.json();
  const groupName = idProp.groupName as string;

  const name = "vishtik_project_url";
  const check = await fetch(`https://api.hubapi.com/crm/v3/properties/deals/${name}`, { headers: H });
  if (check.ok) { console.log(`✓ ${name} already exists`); return; }

  const res = await fetch("https://api.hubapi.com/crm/v3/properties/deals", {
    method: "POST", headers: H,
    body: JSON.stringify({
      name, label: "Vishtik Project URL", type: "string", fieldType: "text",
      groupName, description: "Deep link to the Vishtik design project for this deal.",
    }),
  });
  console.log(res.ok ? `✓ Created ${name} (group ${groupName})` : `✗ ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add env docs to `.env.example`**

```
# Vishtik portal (design project sync) — cookie-auth, no API key.
# Used by the nightly /api/cron/vishtik-id-sync job to scrape the project list.
VISHTIK_USERNAME=
VISHTIK_PASSWORD=
```

- [ ] **Step 3: Commit**

```bash
git add scripts/create-vishtik-url-property.ts .env.example
git commit -m "feat(vishtik): vishtik_project_url property script + env docs"
```

### Task 3.5: Full test + type-check gate

- [ ] **Step 1: Run the feature's tests**

Run: `npm test -- src/__tests__/vishtik-parse.test.ts src/__tests__/vishtik-sync.test.ts`
Expected: all PASS.

- [ ] **Step 2: Type-check the worktree**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint touched files**

Run: `npm run lint`
Expected: no new errors in `src/lib/vishtik*.ts`, the cron route, or the script.

---

## Rollout (operational — after code merges; not TDD steps)

These require approval and credentials; perform with the user.

- [ ] Apply the additive `VishtikSyncRun` migration to prod (`prisma migrate deploy`, with user approval — orchestrator only).
- [ ] Run `npx tsx scripts/create-vishtik-url-property.ts` to create `vishtik_project_url`.
- [ ] Add `VISHTIK_USERNAME` / `VISHTIK_PASSWORD` to Vercel **production** (`printf '%s' "<val>" | vercel env add ...`; verify with `vercel env pull`). Sync any other missing env per the pre-rollout convention. **Decision (2026-06-20): use Zach's personal Vishtik login.** Caveat to revisit later: the cron will break whenever that password changes — migrate to a dedicated service account if it becomes flaky.
- [ ] Deploy via GitHub PR → merge (no `vercel --prod`). Flag stays **off** (`vishtik_sync_enabled` unset).
- [ ] **Dry-run validation:** invoke `syncVishtikIds({ dryRun: true }, liveDeps({ dryRun: true }))` via a guarded one-off script (or local run with prod creds). Because `dryRun` is threaded through, this writes nothing AND does not persist the cursor/last-good-count. Confirm: (a) headless login succeeds (CSRF param name correct), (b) `complete: true` with a sane `fetchedCount` (~2,300), (c) `written`/`ambiguous`/`unmatchedCount` look right. **This is where the two empirical unknowns (CSRF field name, cntr-vs-tiling) are confirmed.**
- [ ] If login/CSRF needs adjustment, fix `fetchTransport`, redeploy, re-validate.
- [ ] Set `SystemConfig` `vishtik_sync_enabled = "true"`. First nightly runs sweep the backfill (PER_RUN_CAP=4000/run → ~6 runs for ~22.5k); steady state thereafter.
- [ ] Monitor `VishtikSyncRun` rows + Sentry for `aborted`/`writeFailures`.

---

## Notes / decisions carried from the spec

- **Never writes null/empty** — only sets values on a clean single match; unmatched (EV/roofing) and ambiguous deals are left untouched and reported.
- **Stale ids are NOT auto-corrected** (immutable once written) — declared non-goal; manual fix if a Vishtik id changes.
- **Sanity gate** suppresses all writes on an incomplete or implausibly-small fetch (guards against a partial scrape silently under-matching).
- **Rolling cursor** re-sweeps from epoch after reaching the present, so newly-appearing Vishtik projects heal previously-unmatched deals (but never revisit already-written deals).
