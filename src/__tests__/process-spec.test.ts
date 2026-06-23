import {
  PROCESS_STAGES,
  CROSS_LINKS,
  STAGE_KEY_TO_STAGE_ID,
  allStepIds,
} from "@/components/workflow-map/process-spec";

describe("PROCESS_STAGES", () => {
  it("is well-formed: non-empty stages, each with at least one non-empty track", () => {
    expect(PROCESS_STAGES.length).toBeGreaterThan(0);
    for (const stage of PROCESS_STAGES) {
      expect(stage.key).toBeTruthy();
      expect(stage.label).toBeTruthy();
      expect(stage.tracks.length).toBeGreaterThan(0);
      for (const track of stage.tracks) {
        expect(track.steps.length).toBeGreaterThan(0);
        for (const step of track.steps) {
          expect(step.id).toBeTruthy();
          expect(step.label).toBeTruthy();
        }
      }
    }
  });

  it("has unique stage keys and unique step ids", () => {
    const keys = PROCESS_STAGES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);

    const allIds: string[] = [];
    for (const stage of PROCESS_STAGES) {
      for (const track of stage.tracks) {
        for (const step of track.steps) allIds.push(step.id);
      }
    }
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("names every track in a multi-track stage", () => {
    for (const stage of PROCESS_STAGES) {
      if (stage.tracks.length > 1) {
        for (const track of stage.tracks) {
          expect(track.name).toBeTruthy();
        }
      }
    }
  });
});

describe("CROSS_LINKS", () => {
  it("references only real step ids", () => {
    const ids = allStepIds();
    for (const link of CROSS_LINKS) {
      expect(ids.has(link.from)).toBe(true);
      expect(ids.has(link.to)).toBe(true);
    }
  });
});

describe("Design stage (parallel → gate → mainline → branch → converge)", () => {
  const design = PROCESS_STAGES.find((s) => s.key === "design");

  it("exists with an entry note and exit note", () => {
    expect(design).toBeTruthy();
    expect(design!.entryNote).toBeTruthy();
    expect(design!.exitNote).toBeTruthy();
  });

  it("starts two named parallel tracks (Design + Design Approval)", () => {
    expect(design!.tracks).toHaveLength(2);
    const names = design!.tracks.map((t) => t.name);
    expect(names).toEqual(["Design", "Design Approval"]);
    for (const track of design!.tracks) {
      expect(track.steps.length).toBeGreaterThan(0);
    }
  });

  it("has an AND-join gate", () => {
    expect(design!.gate).toBeTruthy();
    expect(design!.gate!.label).toMatch(/AND/);
  });

  it("has a mainline flowing out of the gate", () => {
    expect(design!.mainline).toBeTruthy();
    expect(design!.mainline!.length).toBeGreaterThan(0);
    for (const step of design!.mainline!) {
      expect(step.id).toBeTruthy();
      expect(step.label).toBeTruthy();
    }
  });

  it("has a well-formed stamps branch that re-converges", () => {
    const branch = design!.branch;
    expect(branch).toBeTruthy();
    expect(branch!.prompt).toBeTruthy();
    // Two paths: one empty pass-through, one with stamp steps.
    expect(branch!.paths).toHaveLength(2);
    const stampPath = branch!.paths.find((p) => p.steps.length > 0);
    const passThrough = branch!.paths.find((p) => p.steps.length === 0);
    expect(stampPath).toBeTruthy();
    expect(passThrough).toBeTruthy();
    for (const path of branch!.paths) {
      expect(path.label).toBeTruthy();
    }
    // Converge node is the Design-complete exit.
    expect(branch!.converge.id).toBeTruthy();
    expect(branch!.converge.label).toBeTruthy();
  });

  it("includes gate/mainline/branch/converge step ids in allStepIds()", () => {
    const ids = allStepIds();
    for (const step of design!.mainline!) {
      expect(ids.has(step.id)).toBe(true);
    }
    for (const path of design!.branch!.paths) {
      for (const step of path.steps) {
        expect(ids.has(step.id)).toBe(true);
      }
    }
    expect(ids.has(design!.branch!.converge.id)).toBe(true);
  });
});

describe("STAGE_KEY_TO_STAGE_ID", () => {
  it("maps only keys that exist in PROCESS_STAGES", () => {
    const keys = new Set(PROCESS_STAGES.map((s) => s.key));
    for (const key of Object.keys(STAGE_KEY_TO_STAGE_ID)) {
      expect(keys.has(key)).toBe(true);
    }
  });
});
