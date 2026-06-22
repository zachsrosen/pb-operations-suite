import {
  parseNumberPrefix,
  isHappyPathFlow,
  dedupeConsecutive,
  milestoneLabelForFlow,
  deriveStageMilestones,
  deriveProcess,
} from "@/components/workflow-map/process-derive";
import type { FlowEntry, FlowMapSnapshot } from "@/lib/flow-map/types";

describe("parseNumberPrefix", () => {
  it("parses a plain numbered prefix", () => {
    expect(parseNumberPrefix("04. Design Flow - DA Approved")).toEqual([4, ""]);
    expect(parseNumberPrefix("01. Design Flow - Design In Progress")).toEqual([
      1,
      "",
    ]);
  });

  it("parses an alpha-suffixed prefix", () => {
    expect(parseNumberPrefix("09b. Design Flow - Xcel Uploaded")).toEqual([
      9,
      "b",
    ]);
    expect(parseNumberPrefix("8a. Design Flow")).toEqual([8, "a"]);
  });

  it("returns null for names with no numbered prefix", () => {
    expect(parseNumberPrefix("Site Survey Flow - Complete")).toBeNull();
    expect(parseNumberPrefix("Bot Hook | Design")).toBeNull();
    expect(parseNumberPrefix("")).toBeNull();
  });

  it("does not match a number embedded mid-name", () => {
    expect(parseNumberPrefix("Design Flow - Q1 rebate")).toBeNull();
  });
});

describe("isHappyPathFlow", () => {
  it("keeps forward-step flows", () => {
    expect(isHappyPathFlow("04. Design Flow - DA Approved")).toBe(true);
    expect(isHappyPathFlow("01. Permit Flow - Ready for Permitting")).toBe(true);
  });

  it("drops revision and rejection branches", () => {
    expect(isHappyPathFlow("In Design for Revision")).toBe(false);
    expect(isHappyPathFlow("Permit Revision Requested")).toBe(false);
    expect(isHappyPathFlow("06. Design Flow - DA Rejected")).toBe(false);
  });
});

describe("dedupeConsecutive", () => {
  it("collapses runs of identical labels", () => {
    expect(dedupeConsecutive(["A", "A", "B", "B", "B", "A"])).toEqual([
      "A",
      "B",
      "A",
    ]);
  });

  it("leaves a distinct list untouched", () => {
    expect(dedupeConsecutive(["A", "B", "C"])).toEqual(["A", "B", "C"]);
  });

  it("handles empty input", () => {
    expect(dedupeConsecutive([])).toEqual([]);
  });
});

function makeFlow(partial: Partial<FlowEntry>): FlowEntry {
  return {
    id: partial.id ?? "1",
    name: partial.name ?? "flow",
    isEnabled: partial.isEnabled ?? true,
    objectTypeId: "0-3",
    enrollmentType: "EVENT_BASED",
    stageIds: partial.stageIds ?? [],
    trigger: "",
    triggerTechnical: "",
    actions: [],
    actionsTechnical: [],
    sets: partial.sets ?? [],
    reads: [],
    createsTasks: partial.createsTasks ?? [],
    firesOnTasks: [],
    cloneCount: 1,
    revisionId: "1",
    hubspotUrl: "",
  };
}

describe("milestoneLabelForFlow", () => {
  it("returns the owned status value it sets", () => {
    const flow = makeFlow({
      sets: [
        { property: "design_status", label: "Design Status", value: "DA Approved" },
      ],
    });
    expect(milestoneLabelForFlow(flow, ["design_status"])).toBe("DA Approved");
  });

  it("ignores status values for non-owned properties", () => {
    const flow = makeFlow({
      sets: [
        { property: "some_other_prop", label: "Other", value: "Whatever" },
      ],
    });
    expect(milestoneLabelForFlow(flow, ["design_status"])).toBeNull();
  });

  it("returns null when the flow sets nothing", () => {
    expect(milestoneLabelForFlow(makeFlow({}), ["design_status"])).toBeNull();
  });
});

describe("deriveStageMilestones", () => {
  // Synthetic snapshot scoped to the Design & Engineering stage (20461937),
  // whose primary families are Design Flow + DA Flow and owning statuses are
  // design_status / layout_status.
  const STAGE = "20461937";

  function snapshotWith(flows: FlowEntry[]): FlowMapSnapshot {
    const map: Record<string, FlowEntry> = {};
    for (const f of flows) map[f.id] = f;
    return {
      generatedAt: "now",
      portalId: "x",
      pipelines: [],
      stageLookup: {},
      flows: map,
      links: [],
    };
  }

  it("orders milestones by number prefix and dedupes consecutive labels", () => {
    const snap = snapshotWith([
      makeFlow({
        id: "a",
        name: "03. Design Flow - Initial Review Complete",
        stageIds: [STAGE],
        sets: [{ property: "design_status", label: "Design Status", value: "Draft Complete" }],
      }),
      makeFlow({
        id: "b",
        name: "01. Design Flow - Design In Progress",
        stageIds: [STAGE],
        sets: [{ property: "design_status", label: "Design Status", value: "In Progress" }],
        createsTasks: ["Upload Completed Design - ZRS"],
      }),
      makeFlow({
        id: "c",
        name: "02. Design Flow - Design Uploaded",
        stageIds: [STAGE],
        sets: [{ property: "design_status", label: "Design Status", value: "Initial Review" }],
      }),
      // Duplicate of #2's status from a clone — should collapse.
      makeFlow({
        id: "c2",
        name: "02. Design Flow - Design Uploaded (#2)",
        stageIds: [STAGE],
        sets: [{ property: "design_status", label: "Design Status", value: "Initial Review" }],
      }),
    ]);

    const { milestones } = deriveStageMilestones(snap, STAGE);
    expect(milestones.map((m) => m.label)).toEqual([
      "In Progress",
      "Initial Review",
      "Draft Complete",
    ]);
    expect(milestones[0].detail).toBe("creates task: Upload Completed Design - ZRS");
  });

  it("excludes non-primary-family flows even if mapped + setting the status", () => {
    const snap = snapshotWith([
      makeFlow({
        id: "transition",
        name: "03. Transition | Site Survey to Design & Engineering",
        stageIds: [STAGE],
        sets: [{ property: "design_status", label: "Design Status", value: "Ready for Design" }],
      }),
      makeFlow({
        id: "design",
        name: "04. Design Flow - DA Approved",
        stageIds: [STAGE],
        sets: [{ property: "design_status", label: "Design Status", value: "DA Approved" }],
      }),
    ]);

    const { milestones } = deriveStageMilestones(snap, STAGE);
    expect(milestones.map((m) => m.label)).toEqual(["DA Approved"]);
  });

  it("skips alpha-suffixed sub-track flows", () => {
    const snap = snapshotWith([
      makeFlow({
        id: "main",
        name: "08. Design Flow - Main",
        stageIds: [STAGE],
        sets: [{ property: "design_status", label: "Design Status", value: "Complete" }],
      }),
      makeFlow({
        id: "sub",
        name: "09a. Design Flow - Xcel Design Needed",
        stageIds: [STAGE],
        sets: [{ property: "design_status", label: "Design Status", value: "Xcel - Design Needed" }],
      }),
    ]);

    const { milestones } = deriveStageMilestones(snap, STAGE);
    expect(milestones.map((m) => m.label)).toEqual(["Complete"]);
  });

  it("excludes disabled flows but still requires a numbered prefix + owned set", () => {
    const snap = snapshotWith([
      makeFlow({
        id: "off",
        name: "01. Design Flow - Off",
        isEnabled: false,
        stageIds: [STAGE],
        sets: [{ property: "design_status", label: "Design Status", value: "In Progress" }],
      }),
      makeFlow({
        id: "noset",
        name: "02. Design Flow - No status set",
        stageIds: [STAGE],
        sets: [],
      }),
    ]);
    const { milestones } = deriveStageMilestones(snap, STAGE);
    expect(milestones).toHaveLength(0);
  });

  it("counts ON primary-family happy-path flows as automating the stage", () => {
    const snap = snapshotWith([
      makeFlow({ id: "1", name: "01. Design Flow - A", stageIds: [STAGE], sets: [{ property: "design_status", label: "x", value: "In Progress" }] }),
      makeFlow({ id: "2", name: "DA Flow - Reminder (no number)", stageIds: [STAGE] }),
      makeFlow({ id: "3", name: "Bot Hook | Design", stageIds: [STAGE] }),
    ]);
    const { workflowCount } = deriveStageMilestones(snap, STAGE);
    // Two primary-family flows (Design Flow + DA Flow); Bot excluded.
    expect(workflowCount).toBe(2);
  });
});

describe("deriveProcess", () => {
  it("returns forward Project-pipeline stages in order, excluding terminal stages, with fallback milestones", () => {
    const snapshot: FlowMapSnapshot = {
      generatedAt: "now",
      portalId: "x",
      pipelines: [
        {
          id: "6900017",
          label: "Project Pipeline",
          objectTypeId: "0-3",
          stages: [
            { id: "20440344", label: "On-Hold", order: 0 },
            { id: "20461936", label: "Site Survey", order: 2 },
            { id: "71052436", label: "RTB - Blocked", order: 5 },
            { id: "20440343", label: "Project Complete", order: 11 },
          ],
        },
      ],
      stageLookup: {},
      flows: {},
      links: [],
    };

    const proc = deriveProcess(snapshot);
    expect(proc.map((s) => s.stageLabel)).toEqual([
      "Site Survey",
      "Project Complete",
    ]);
    // No flows → each stage falls back to a single milestone = stage label.
    expect(proc[0].milestones).toEqual([{ label: "Site Survey" }]);
  });

  it("returns empty when the Project pipeline is absent", () => {
    const snapshot: FlowMapSnapshot = {
      generatedAt: "now",
      portalId: "x",
      pipelines: [],
      stageLookup: {},
      flows: {},
      links: [],
    };
    expect(deriveProcess(snapshot)).toEqual([]);
  });
});
