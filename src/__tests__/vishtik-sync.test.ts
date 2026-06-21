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
