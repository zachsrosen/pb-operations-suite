import {
  layeredDepths,
  partitionConnected,
  type HandoffEdge,
} from "@/components/workflow-map/flowchart-layout";

describe("layeredDepths", () => {
  it("places roots at depth 0 and targets one column deeper", () => {
    const edges: HandoffEdge[] = [{ source: "a", target: "b" }];
    const depths = layeredDepths(["a", "b"], edges);
    expect(depths.a).toBe(0);
    expect(depths.b).toBe(1);
  });

  it("uses longest-path depth when a node has multiple incoming paths", () => {
    // a -> b -> c, and a -> c directly. c should land past b (longest path).
    const edges: HandoffEdge[] = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "a", target: "c" },
    ];
    const depths = layeredDepths(["a", "b", "c"], edges);
    expect(depths.a).toBe(0);
    expect(depths.b).toBe(1);
    expect(depths.c).toBe(2);
  });

  it("gives isolated nodes depth 0", () => {
    const depths = layeredDepths(["x", "y"], []);
    expect(depths.x).toBe(0);
    expect(depths.y).toBe(0);
  });

  it("is deterministic regardless of edge order", () => {
    const ids = ["a", "b", "c", "d"];
    const e1: HandoffEdge[] = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "c", target: "d" },
    ];
    const e2 = [...e1].reverse();
    expect(layeredDepths(ids, e1)).toEqual(layeredDepths(ids, e2));
  });

  it("ignores edges whose endpoints are not in the node set", () => {
    const edges: HandoffEdge[] = [
      { source: "a", target: "ghost" },
      { source: "phantom", target: "b" },
    ];
    const depths = layeredDepths(["a", "b"], edges);
    expect(depths.a).toBe(0);
    expect(depths.b).toBe(0);
  });

  it("tolerates a cycle without looping forever", () => {
    const edges: HandoffEdge[] = [
      { source: "a", target: "b" },
      { source: "b", target: "a" },
    ];
    const depths = layeredDepths(["a", "b"], edges);
    expect(Number.isFinite(depths.a)).toBe(true);
    expect(Number.isFinite(depths.b)).toBe(true);
  });
});

describe("partitionConnected", () => {
  it("splits nodes touched by valid edges from isolated ones", () => {
    const edges: HandoffEdge[] = [{ source: "a", target: "b" }];
    const { connected, isolated } = partitionConnected(["a", "b", "c"], edges);
    expect(connected.sort()).toEqual(["a", "b"]);
    expect(isolated).toEqual(["c"]);
  });

  it("treats edges to unknown nodes as not connecting", () => {
    const edges: HandoffEdge[] = [{ source: "a", target: "ghost" }];
    const { connected, isolated } = partitionConnected(["a", "b"], edges);
    expect(connected).toEqual([]);
    expect(isolated.sort()).toEqual(["a", "b"]);
  });
});
