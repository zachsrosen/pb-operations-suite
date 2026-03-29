/**
 * Scenario Logic — Unit Tests
 *
 * Tests scenario CRUD functions, delta computation, and mixed-quality detection.
 */

import {
  createScenario,
  duplicateScenario,
  renameScenario,
  deleteScenario,
  updateScenarioOverrides,
  setScenarioResult,
  computeDeltas,
  hasMixedQualityWarning,
  scenarioStats,
} from "@/lib/solar/scenarios/scenario-logic";
import type {
  ScenarioResult,
  ScenariosJson,
} from "@/lib/solar/scenarios/scenario-types";

// ── Fixtures ────────────────────────────────────────────────

const fullResult: ScenarioResult = {
  annualKwh: 11000,
  monthlyKwh: [600, 650, 800, 950, 1100, 1200, 1250, 1150, 1000, 850, 700, 650],
  panelCount: 20,
  systemSizeKw: 8.8,
  systemTsrf: 0.82,
  specificYield: 1250,
  mismatchLossPct: 2.3,
  clippingLossPct: null,
  hasBattery: false,
  isQuickEstimate: false,
  quality: "full",
  schemaVersion: 1,
};

const qeResult: ScenarioResult = {
  ...fullResult,
  annualKwh: 10500,
  specificYield: 1193,
  isQuickEstimate: true,
  quality: "quick_estimate",
};

const altResult: ScenarioResult = {
  ...fullResult,
  annualKwh: 12000,
  specificYield: 1364,
  systemSizeKw: 8.8,
};

// ── CRUD Tests ──────────────────────────────────────────────

describe("createScenario", () => {
  it("adds a scenario with given name", () => {
    const result = createScenario([], "Test Scenario");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Test Scenario");
    expect(result[0].result).toBeNull();
    expect(result[0].overrides).toEqual({});
    expect(result[0].id).toMatch(/^sc_/);
  });

  it("auto-names when empty string provided", () => {
    const result = createScenario([], "");
    expect(result[0].name).toBe("Scenario 1");
  });

  it("auto-names with correct index", () => {
    const existing = createScenario([], "First");
    const result = createScenario(existing, "");
    expect(result[1].name).toBe("Scenario 2");
  });

  it("preserves existing scenarios (immutable)", () => {
    const original: ScenariosJson = [];
    const result = createScenario(original, "New");
    expect(original).toHaveLength(0);
    expect(result).toHaveLength(1);
  });

  it("includes createdAt timestamp", () => {
    const result = createScenario([], "Timestamped");
    expect(result[0].createdAt).toBeTruthy();
    expect(() => new Date(result[0].createdAt)).not.toThrow();
  });
});

describe("duplicateScenario", () => {
  it("duplicates an existing scenario with modified name", () => {
    let scenarios = createScenario([], "Original");
    scenarios = duplicateScenario(scenarios, scenarios[0].id);

    expect(scenarios).toHaveLength(2);
    expect(scenarios[1].name).toBe("Original (copy)");
  });

  it("duplicates with custom name", () => {
    let scenarios = createScenario([], "Base");
    scenarios = duplicateScenario(scenarios, scenarios[0].id, "Custom Copy");

    expect(scenarios[1].name).toBe("Custom Copy");
  });

  it("clears result on duplicate (must re-run)", () => {
    let scenarios = createScenario([], "WithResult");
    scenarios = setScenarioResult(scenarios, scenarios[0].id, fullResult);
    expect(scenarios[0].result).not.toBeNull();

    scenarios = duplicateScenario(scenarios, scenarios[0].id);
    expect(scenarios[1].result).toBeNull();
  });

  it("returns unchanged array if source ID not found", () => {
    const scenarios = createScenario([], "Only");
    const result = duplicateScenario(scenarios, "nonexistent");
    expect(result).toHaveLength(1);
  });

  it("deep-clones overrides", () => {
    let scenarios = createScenario([], "WithOverrides", {
      panelKey: "REC_Alpha_Pure_440",
      lossProfile: { soiling: 5 },
    });
    scenarios = duplicateScenario(scenarios, scenarios[0].id);

    // Modify original overrides — clone should be unaffected
    scenarios[0].overrides.lossProfile!.soiling = 99;
    expect(scenarios[1].overrides.lossProfile!.soiling).toBe(5);
  });
});

describe("renameScenario", () => {
  it("renames a scenario", () => {
    let scenarios = createScenario([], "OldName");
    scenarios = renameScenario(scenarios, scenarios[0].id, "NewName");
    expect(scenarios[0].name).toBe("NewName");
  });

  it("trims whitespace", () => {
    let scenarios = createScenario([], "Name");
    scenarios = renameScenario(scenarios, scenarios[0].id, "  Trimmed  ");
    expect(scenarios[0].name).toBe("Trimmed");
  });

  it("keeps old name if empty string provided", () => {
    let scenarios = createScenario([], "KeepMe");
    scenarios = renameScenario(scenarios, scenarios[0].id, "");
    expect(scenarios[0].name).toBe("KeepMe");
  });
});

describe("deleteScenario", () => {
  it("removes a scenario by ID", () => {
    let scenarios = createScenario([], "First");
    scenarios = createScenario(scenarios, "Second");
    const idToDelete = scenarios[0].id;

    scenarios = deleteScenario(scenarios, idToDelete);
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].name).toBe("Second");
  });

  it("returns unchanged array if ID not found", () => {
    const scenarios = createScenario([], "Only");
    const result = deleteScenario(scenarios, "nonexistent");
    expect(result).toHaveLength(1);
  });
});

describe("updateScenarioOverrides", () => {
  it("updates overrides on a scenario", () => {
    let scenarios = createScenario([], "Test");
    scenarios = updateScenarioOverrides(scenarios, scenarios[0].id, {
      panelKey: "QCells_QPeak_420",
    });

    expect(scenarios[0].overrides.panelKey).toBe("QCells_QPeak_420");
  });

  it("clears cached result when overrides change", () => {
    let scenarios = createScenario([], "HasResult");
    scenarios = setScenarioResult(scenarios, scenarios[0].id, fullResult);
    expect(scenarios[0].result).not.toBeNull();

    scenarios = updateScenarioOverrides(scenarios, scenarios[0].id, {
      inverterKey: "SolarEdge_SE7600H",
    });
    expect(scenarios[0].result).toBeNull();
    expect(scenarios[0].lastRunAt).toBeNull();
  });
});

describe("setScenarioResult", () => {
  it("caches a result on a scenario", () => {
    let scenarios = createScenario([], "Test");
    scenarios = setScenarioResult(scenarios, scenarios[0].id, fullResult);

    expect(scenarios[0].result).toEqual(fullResult);
    expect(scenarios[0].lastRunAt).toBeTruthy();
  });
});

// ── Compare / Delta Tests ───────────────────────────────────

describe("computeDeltas", () => {
  it("returns empty array when no scenarios have results", () => {
    const scenarios = createScenario([], "NoResult");
    const deltas = computeDeltas(scenarios, fullResult);
    expect(deltas).toHaveLength(0);
  });

  it("computes correct deltas from baseline", () => {
    let scenarios = createScenario([], "Alt");
    scenarios = setScenarioResult(scenarios, scenarios[0].id, altResult);

    const deltas = computeDeltas(scenarios, fullResult);
    expect(deltas).toHaveLength(1);

    const d = deltas[0];
    expect(d.scenarioName).toBe("Alt");
    expect(d.annualKwh).toBe(12000);
    expect(d.deltaAnnualKwh).toBe(1000); // 12000 - 11000
    expect(d.pctChangeAnnualKwh).toBeCloseTo(9.09, 1); // (1000/11000)*100
    expect(d.deltaSpecificYield).toBe(114); // 1364 - 1250
    expect(d.quality).toBe("full");
    expect(d.isMixedQuality).toBe(false);
  });

  it("computes negative deltas correctly", () => {
    const lowerResult: ScenarioResult = {
      ...fullResult,
      annualKwh: 9000,
      specificYield: 1023,
    };

    let scenarios = createScenario([], "Lower");
    scenarios = setScenarioResult(scenarios, scenarios[0].id, lowerResult);

    const deltas = computeDeltas(scenarios, fullResult);
    expect(deltas[0].deltaAnnualKwh).toBe(-2000);
    expect(deltas[0].pctChangeAnnualKwh).toBeCloseTo(-18.18, 1);
  });

  it("marks mixed quality when QE vs full", () => {
    let scenarios = createScenario([], "QE");
    scenarios = setScenarioResult(scenarios, scenarios[0].id, qeResult);

    const deltas = computeDeltas(scenarios, fullResult);
    expect(deltas[0].isMixedQuality).toBe(true);
    expect(deltas[0].quality).toBe("quick_estimate");
  });

  it("skips scenarios without results", () => {
    let scenarios = createScenario([], "HasResult");
    scenarios = createScenario(scenarios, "NoResult");
    scenarios = setScenarioResult(scenarios, scenarios[0].id, altResult);

    const deltas = computeDeltas(scenarios, fullResult);
    expect(deltas).toHaveLength(1);
    expect(deltas[0].scenarioName).toBe("HasResult");
  });

  it("handles zero baseline gracefully (no divide-by-zero)", () => {
    const zeroBaseline: ScenarioResult = {
      ...fullResult,
      annualKwh: 0,
      specificYield: 0,
    };

    let scenarios = createScenario([], "Test");
    scenarios = setScenarioResult(scenarios, scenarios[0].id, altResult);

    const deltas = computeDeltas(scenarios, zeroBaseline);
    expect(deltas[0].pctChangeAnnualKwh).toBe(0);
    expect(deltas[0].pctChangeSpecificYield).toBe(0);
  });

  it("preserves scenario creation order in deltas", () => {
    let scenarios = createScenario([], "C");
    scenarios = createScenario(scenarios, "A");
    scenarios = createScenario(scenarios, "B");

    scenarios = setScenarioResult(scenarios, scenarios[0].id, altResult);
    scenarios = setScenarioResult(scenarios, scenarios[1].id, altResult);
    scenarios = setScenarioResult(scenarios, scenarios[2].id, altResult);

    const deltas = computeDeltas(scenarios, fullResult);
    expect(deltas.map((d) => d.scenarioName)).toEqual(["C", "A", "B"]);
  });
});

// ── Mixed Quality Warning ───────────────────────────────────

describe("hasMixedQualityWarning", () => {
  it("returns false when all same quality", () => {
    let scenarios = createScenario([], "A");
    scenarios = setScenarioResult(scenarios, scenarios[0].id, fullResult);

    expect(hasMixedQualityWarning(scenarios, false)).toBe(false);
  });

  it("returns true when QE scenario vs full baseline", () => {
    let scenarios = createScenario([], "QE");
    scenarios = setScenarioResult(scenarios, scenarios[0].id, qeResult);

    expect(hasMixedQualityWarning(scenarios, false)).toBe(true);
  });

  it("returns true when full scenario vs QE baseline", () => {
    let scenarios = createScenario([], "Full");
    scenarios = setScenarioResult(scenarios, scenarios[0].id, fullResult);

    expect(hasMixedQualityWarning(scenarios, true)).toBe(true);
  });

  it("ignores scenarios without results", () => {
    const scenarios = createScenario([], "NoResult");
    expect(hasMixedQualityWarning(scenarios, false)).toBe(false);
  });
});

// ── Scenario Stats ──────────────────────────────────────────

describe("scenarioStats", () => {
  it("returns zeroes for empty array", () => {
    expect(scenarioStats([])).toEqual({
      total: 0,
      withResults: 0,
      pending: 0,
    });
  });

  it("counts correctly with mixed results", () => {
    let scenarios = createScenario([], "A");
    scenarios = createScenario(scenarios, "B");
    scenarios = createScenario(scenarios, "C");
    scenarios = setScenarioResult(scenarios, scenarios[0].id, fullResult);

    const stats = scenarioStats(scenarios);
    expect(stats.total).toBe(3);
    expect(stats.withResults).toBe(1);
    expect(stats.pending).toBe(2);
  });
});
