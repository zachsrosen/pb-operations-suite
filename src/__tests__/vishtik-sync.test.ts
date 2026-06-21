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
