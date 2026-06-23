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
    expect(CROSS_LINKS.length).toBeGreaterThan(0);
    for (const link of CROSS_LINKS) {
      expect(ids.has(link.from)).toBe(true);
      expect(ids.has(link.to)).toBe(true);
    }
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
