import {
  flowFamily,
  flowSortKey,
  layeredDepths,
  orderFamilies,
  partitionConnected,
  type HandoffEdge,
} from "@/components/workflow-map/flowchart-layout";

describe("flowFamily", () => {
  it("classifies the core process families by name", () => {
    expect(flowFamily("04. Design Flow - DA Approved")).toBe("Design Flow");
    expect(flowFamily("02. DA Flow - Send to Customer")).toBe("DA Flow");
    expect(flowFamily("01a. Permit Flow - Ready for Permitting")).toBe("Permit Flow");
    expect(flowFamily("Permitting Flow - Submitted")).toBe("Permit Flow");
    expect(flowFamily("Utility Flow - Interconnection App")).toBe("Utility Flow");
    expect(flowFamily("Interconnection Flow - Approved")).toBe("Interconnection Flow");
    expect(flowFamily("Site Survey Flow - Complete")).toBe("Site Survey Flow");
    expect(flowFamily("Construction Flow - Scheduled")).toBe("Construction Flow");
    expect(flowFamily("Inspection Flow - Passed")).toBe("Inspection Flow");
    expect(flowFamily("PTO Flow - Granted")).toBe("PTO Flow");
    expect(flowFamily("Quality Flow - QC Review")).toBe("Quality Flow");
  });

  it("classifies supporting families and bots", () => {
    expect(flowFamily("In Design for Revision")).toBe("Revisions");
    expect(flowFamily("Permit Revision Requested")).toBe("Revisions");
    expect(flowFamily("Transition from Construction back to RTB")).toBe("Transitions");
    expect(flowFamily("Bot Hook - notify scheduler")).toBe("Bots");
    expect(flowFamily("Bot Comms - daily digest")).toBe("Bots");
  });

  it("pins date-stamp plumbing to its own family", () => {
    expect(flowFamily("Date Stamp - Design Complete")).toBe("Date Stamp");
  });

  it("falls back to Other for unrecognized names", () => {
    expect(flowFamily("Some random workflow")).toBe("Other");
    expect(flowFamily("")).toBe("Other");
  });

  it("honors priority order: Revisions beats Design Flow when both could match", () => {
    // "Design Flow ... Revision" matches both /design flow/ and /revision/; the
    // Revisions check comes first so it wins.
    expect(flowFamily("Design Flow Revision - Rework")).toBe("Revisions");
    // Date Stamp is checked before everything, so a stamping flow named after a
    // family still lands in Date Stamp.
    expect(flowFamily("Date Stamp Design Flow date")).toBe("Date Stamp");
  });
});

describe("orderFamilies", () => {
  it("orders primary families first and pins Date Stamp last", () => {
    const ordered = orderFamilies([
      "Date Stamp",
      "Other",
      "Design Flow",
      "Revisions",
      "DA Flow",
    ]);
    expect(ordered[0]).toBe("Design Flow");
    expect(ordered[1]).toBe("DA Flow");
    expect(ordered[ordered.length - 1]).toBe("Date Stamp");
    // Revisions sorts ahead of Other per the fixed order.
    expect(ordered.indexOf("Revisions")).toBeLessThan(ordered.indexOf("Other"));
  });

  it("dedupes and only returns the families given", () => {
    const ordered = orderFamilies(["Design Flow", "Design Flow", "Bots"]);
    expect(ordered).toEqual(["Design Flow", "Bots"]);
  });
});

describe("flowSortKey", () => {
  it("orders by leading number then letter suffix", () => {
    const names = ["10. B", "01a. C", "01. A", "2. D"];
    const sorted = [...names].sort((a, b) => {
      const ka = flowSortKey(a);
      const kb = flowSortKey(b);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      if (ka[1] !== kb[1]) return ka[1].localeCompare(kb[1]);
      return ka[2].localeCompare(kb[2]);
    });
    expect(sorted).toEqual(["01. A", "01a. C", "2. D", "10. B"]);
  });

  it("sorts un-numbered names after numbered ones, then alpha", () => {
    const k1 = flowSortKey("Zebra workflow");
    const k2 = flowSortKey("05. Numbered");
    expect(k2[0]).toBeLessThan(k1[0]);
    expect(flowSortKey("apple")[0]).toBe(flowSortKey("banana")[0]);
  });
});

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
