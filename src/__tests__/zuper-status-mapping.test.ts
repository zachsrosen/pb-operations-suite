import {
  evaluateJobDrift,
  toMappingCategory,
  type DriftEvalDeal,
  type DriftEvalJob,
} from "@/lib/zuper-status-mapping";

const baseDeal: DriftEvalDeal = {
  dealId: "1",
  dealName: "PROJ-1234 Smith",
  pbLocation: "DTC",
  projectNumber: "PROJ-1234",
  siteSurveyStatus: null,
  constructionStatus: null,
  inspectionStatus: null,
  constructionCompleteDate: null,
  inspectionPassDate: null,
  inspectionFailDate: null,
};

function job(overrides: Partial<DriftEvalJob>): DriftEvalJob {
  return {
    jobUid: "j1",
    jobTitle: "Test Job",
    category: "construction",
    zuperStatus: "Scheduled",
    completedAt: null,
    ...overrides,
  };
}

describe("toMappingCategory", () => {
  it("collapses all construction sub-types to 'construction'", () => {
    expect(toMappingCategory("construction")).toBe("construction");
    expect(toMappingCategory("solar_install")).toBe("construction");
    expect(toMappingCategory("battery_install")).toBe("construction");
    expect(toMappingCategory("ev_install")).toBe("construction");
  });
  it("preserves site_survey and inspection", () => {
    expect(toMappingCategory("site_survey")).toBe("site_survey");
    expect(toMappingCategory("inspection")).toBe("inspection");
  });
});

describe("evaluateJobDrift — STATUS", () => {
  it("fires STATUS when zuper status doesn't map to hubspot status", () => {
    const j = job({ zuperStatus: "Construction Complete" });
    const d: DriftEvalDeal = { ...baseDeal, constructionStatus: "Scheduled" };
    expect(evaluateJobDrift(j, d)).toContain("STATUS");
  });

  it("does NOT fire STATUS when HubSpot is legitimately ahead (HS terminal, Zuper behind)", () => {
    const j = job({ zuperStatus: "Scheduled" });
    const d: DriftEvalDeal = { ...baseDeal, constructionStatus: "Construction Complete" };
    expect(evaluateJobDrift(j, d)).not.toContain("STATUS");
  });

  it("does NOT fire STATUS when statuses match per STATUS_MAPPING", () => {
    const j = job({ zuperStatus: "Construction Complete" });
    const d: DriftEvalDeal = { ...baseDeal, constructionStatus: "Construction Complete" };
    expect(evaluateJobDrift(j, d)).toEqual([]);
  });

  // Inspection re-inspection path: Zuper job stays in "Failed" status after the
  // team has moved on to a re-inspection (HS shows a post-failure status like
  // "Ready For Inspection" with a recorded fail date). This is HubSpot-legit-ahead
  // and STATUS must NOT fire — otherwise re-inspection rework would pollute the
  // drift list indefinitely. Note: FAIL_DISAGREEMENT does NOT apply here because
  // the HS status isn't "Passed".
  it("does NOT fire STATUS for inspection re-inspection (Zuper Failed, HS post-failure with fail date)", () => {
    const j = job({
      category: "inspection",
      zuperStatus: "Failed",
      completedAt: "2026-05-01T18:00:00Z",
    });
    const d: DriftEvalDeal = {
      ...baseDeal,
      inspectionStatus: "Ready For Inspection",
      inspectionFailDate: "2026-05-01",
    };
    expect(evaluateJobDrift(j, d)).not.toContain("STATUS");
    expect(evaluateJobDrift(j, d)).not.toContain("FAIL_DISAGREEMENT");
  });
});

describe("evaluateJobDrift — FAIL_DISAGREEMENT", () => {
  it("fires when Zuper Failed but HS Passed", () => {
    const j = job({ category: "inspection", zuperStatus: "Failed" });
    const d: DriftEvalDeal = { ...baseDeal, inspectionStatus: "Passed" };
    const drift = evaluateJobDrift(j, d);
    expect(drift).toContain("FAIL_DISAGREEMENT");
  });

  it("fires when Zuper Passed but HS Failed", () => {
    const j = job({ category: "inspection", zuperStatus: "Passed" });
    const d: DriftEvalDeal = { ...baseDeal, inspectionStatus: "Failed" };
    const drift = evaluateJobDrift(j, d);
    expect(drift).toContain("FAIL_DISAGREEMENT");
  });

  it("does NOT fire for non-inspection categories", () => {
    const j = job({ category: "construction", zuperStatus: "Failed" });
    const d: DriftEvalDeal = { ...baseDeal, constructionStatus: "Construction Complete" };
    expect(evaluateJobDrift(j, d)).not.toContain("FAIL_DISAGREEMENT");
  });
});

describe("evaluateJobDrift — COMPLETION_DATE (construction sub-types)", () => {
  it("fires for any construction sub-type when Zuper completed date differs from HubSpot >1 day", () => {
    for (const cat of ["construction", "solar_install", "battery_install", "ev_install"]) {
      const j = job({
        category: cat,
        zuperStatus: "Construction Complete",
        completedAt: "2026-05-01T18:00:00Z",
      });
      const d: DriftEvalDeal = {
        ...baseDeal,
        constructionStatus: "Construction Complete",
        constructionCompleteDate: "2026-05-05", // 4 days off
      };
      expect(evaluateJobDrift(j, d)).toContain("COMPLETION_DATE");
    }
  });

  it("does NOT fire if dates are within 1 day", () => {
    const j = job({
      category: "construction",
      zuperStatus: "Construction Complete",
      completedAt: "2026-05-01T18:00:00Z", // local: 2026-05-01
    });
    const d: DriftEvalDeal = {
      ...baseDeal,
      constructionStatus: "Construction Complete",
      constructionCompleteDate: "2026-05-01",
    };
    expect(evaluateJobDrift(j, d)).not.toContain("COMPLETION_DATE");
  });

  it("does NOT fire for site_survey or inspection categories", () => {
    const j = job({
      category: "inspection",
      zuperStatus: "Passed",
      completedAt: "2026-05-01T18:00:00Z",
    });
    const d: DriftEvalDeal = {
      ...baseDeal,
      inspectionStatus: "Passed",
      constructionCompleteDate: "2026-04-01", // would be drift if we checked
    };
    expect(evaluateJobDrift(j, d)).not.toContain("COMPLETION_DATE");
  });
});

describe("evaluateJobDrift — INSPECTION_PASS_DATE", () => {
  it("fires when inspection Passed and Zuper completedAt differs from HubSpot pass date >1 day", () => {
    const j = job({
      category: "inspection",
      zuperStatus: "Passed",
      completedAt: "2026-05-01T18:00:00Z",
    });
    const d: DriftEvalDeal = {
      ...baseDeal,
      inspectionStatus: "Passed",
      inspectionPassDate: "2026-05-10",
    };
    expect(evaluateJobDrift(j, d)).toContain("INSPECTION_PASS_DATE");
  });

  it("does NOT fire when inspection NOT passed", () => {
    const j = job({
      category: "inspection",
      zuperStatus: "Failed",
      completedAt: "2026-05-01T18:00:00Z",
    });
    const d: DriftEvalDeal = {
      ...baseDeal,
      inspectionStatus: "Failed",
      inspectionPassDate: "2026-05-10", // stale data; shouldn't fire pass-date drift
    };
    expect(evaluateJobDrift(j, d)).not.toContain("INSPECTION_PASS_DATE");
  });
});

describe("evaluateJobDrift — INSPECTION_FAIL_DATE", () => {
  it("fires when inspection Failed and Zuper completedAt differs from HubSpot fail date >1 day", () => {
    const j = job({
      category: "inspection",
      zuperStatus: "Failed",
      completedAt: "2026-05-01T18:00:00Z",
    });
    const d: DriftEvalDeal = {
      ...baseDeal,
      inspectionStatus: "Failed",
      inspectionFailDate: "2026-05-10",
    };
    expect(evaluateJobDrift(j, d)).toContain("INSPECTION_FAIL_DATE");
  });

  it("does NOT fire when inspection NOT failed", () => {
    const j = job({
      category: "inspection",
      zuperStatus: "Passed",
      completedAt: "2026-05-01T18:00:00Z",
    });
    const d: DriftEvalDeal = {
      ...baseDeal,
      inspectionStatus: "Passed",
      inspectionFailDate: "2026-05-10",
    };
    expect(evaluateJobDrift(j, d)).not.toContain("INSPECTION_FAIL_DATE");
  });
});

describe("evaluateJobDrift — combined", () => {
  it("can return multiple drift types simultaneously", () => {
    const j = job({
      category: "inspection",
      zuperStatus: "Failed",
      completedAt: "2026-05-01T18:00:00Z",
    });
    const d: DriftEvalDeal = {
      ...baseDeal,
      inspectionStatus: "Passed", // disagreement
      inspectionFailDate: "2026-05-10", // date drift
    };
    const drift = evaluateJobDrift(j, d);
    expect(drift).toEqual(expect.arrayContaining(["STATUS", "FAIL_DISAGREEMENT", "INSPECTION_FAIL_DATE"]));
  });

  it("returns empty array when fully in sync", () => {
    const j = job({
      category: "inspection",
      zuperStatus: "Passed",
      completedAt: "2026-05-10T18:00:00Z",
    });
    const d: DriftEvalDeal = {
      ...baseDeal,
      inspectionStatus: "Passed",
      inspectionPassDate: "2026-05-10",
    };
    expect(evaluateJobDrift(j, d)).toEqual([]);
  });
});
