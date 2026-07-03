import { selectStalePreviewBranches, type NeonBranch } from "@/lib/neon-branch-sweep";

const NOW = Date.parse("2026-07-02T21:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

function branch(overrides: Partial<NeonBranch>): NeonBranch {
  return {
    id: overrides.id ?? "br_x",
    name: overrides.name ?? "preview/feat/x",
    created_at: overrides.created_at ?? daysAgo(30),
    default: overrides.default,
    protected: overrides.protected,
  };
}

describe("selectStalePreviewBranches", () => {
  const MAX_AGE = 14;

  it("selects old preview branches", () => {
    const b = branch({ id: "old", name: "preview/feat/stale", created_at: daysAgo(30) });
    expect(selectStalePreviewBranches([b], NOW, MAX_AGE)).toEqual([b]);
  });

  it("never selects the default (production) branch, even if old and named production", () => {
    const prod = branch({ name: "production", default: true, created_at: daysAgo(365) });
    expect(selectStalePreviewBranches([prod], NOW, MAX_AGE)).toEqual([]);
  });

  it("never selects a protected branch", () => {
    const p = branch({ name: "preview/feat/keepme", protected: true, created_at: daysAgo(365) });
    expect(selectStalePreviewBranches([p], NOW, MAX_AGE)).toEqual([]);
  });

  it("never selects non-preview branches", () => {
    const dev = branch({ name: "vercel-dev", created_at: daysAgo(365) });
    expect(selectStalePreviewBranches([dev], NOW, MAX_AGE)).toEqual([]);
  });

  it("does not select preview branches newer than the cutoff", () => {
    const recent = branch({ name: "preview/fix/active", created_at: daysAgo(2) });
    expect(selectStalePreviewBranches([recent], NOW, MAX_AGE)).toEqual([]);
  });

  it("does not select branches with an unparseable created_at", () => {
    const bad = branch({ name: "preview/feat/bad", created_at: "not-a-date" });
    expect(selectStalePreviewBranches([bad], NOW, MAX_AGE)).toEqual([]);
  });

  it("filters a mixed set to only the stale previews", () => {
    const branches: NeonBranch[] = [
      branch({ id: "prod", name: "production", default: true, created_at: daysAgo(365) }),
      branch({ id: "recent", name: "preview/feat/recent", created_at: daysAgo(1) }),
      branch({ id: "stale1", name: "preview/feat/stale1", created_at: daysAgo(20) }),
      branch({ id: "stale2", name: "preview/fix/stale2", created_at: daysAgo(60) }),
      branch({ id: "dev", name: "vercel-dev", created_at: daysAgo(120) }),
    ];
    const ids = selectStalePreviewBranches(branches, NOW, MAX_AGE).map((b) => b.id);
    expect(ids.sort()).toEqual(["stale1", "stale2"]);
  });
});
