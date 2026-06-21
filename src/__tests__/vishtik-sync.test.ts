// src/__tests__/vishtik-sync.test.ts
// vishtik-sync.ts transitively imports @/lib/db (Task 2.3 live deps), whose
// generated Prisma client uses `import.meta` and fails Jest's transform. Mock it
// so the module loads; these are pure-logic / injected-dep tests that never touch
// the real client.
jest.mock("@/lib/db", () => ({ prisma: null }));

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
    const res = await syncVishtikIds({ dryRun: false, minProjects: 1 }, deps({ writeDeal }));
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
    const res = await syncVishtikIds({ dryRun: true, minProjects: 1 }, deps({ writeDeal }));
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
  it("advances the cursor to the last createdate when the per-run cap is hit with more pages pending", async () => {
    const cfg = fakeCfg();
    // First page carries an `after` token, so the set is NOT exhausted. With
    // perRunCap=1 the loop stops on the cap while `after` is still present, so
    // the cursor must ADVANCE to this page's last createdate (not wrap to "0").
    const search = pages(
      { results: [{ id: "d1", properties: { project_number: "PROJ-1", createdate: "2026-01-01T00:00:00Z" } }], paging: { next: { after: "100" } } },
    );
    const gen = makeCandidateIterator({ search, ...cfg, dryRun: false, perRunCap: 1 });
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
