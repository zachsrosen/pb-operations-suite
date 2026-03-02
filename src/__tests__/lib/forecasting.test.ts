import type { Project } from "@/lib/hubspot";
import {
  MILESTONE_CHAIN,
  type BaselineTable,
  type PairStats,
  buildBaselineTable,
  computeForecast,
  computeProjectForecasts,
} from "@/lib/forecasting";

/** Factory: a fully-completed project with realistic milestone dates */
function makeCompletedProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 1,
    name: "Test | Smith",
    projectNumber: "PROJ-0001",
    pbLocation: "Westminster",
    ahj: "Boulder County",
    utility: "Xcel",
    address: "123 Main St",
    city: "Westminster",
    state: "CO",
    postalCode: "80021",
    projectType: "Residential",
    stage: "PTO",
    stageId: "pto",
    amount: 50000,
    url: "https://hubspot.com/deal/1",
    tags: [],
    isParticipateEnergy: false,
    participateEnergyStatus: null,
    isSiteSurveyScheduled: true,
    isSiteSurveyCompleted: true,
    isDASent: true,
    isDesignApproved: true,
    isDesignDrafted: true,
    isDesignCompleted: true,
    isPermitSubmitted: true,
    isPermitIssued: true,
    isInterconnectionSubmitted: true,
    isInterconnectionApproved: true,
    threeceEvStatus: null,
    threeceBatteryStatus: null,
    sgipStatus: null,
    pbsrStatus: null,
    cpaStatus: null,
    closeDate: "2025-01-01",
    siteSurveyScheduleDate: null,
    siteSurveyCompletionDate: null,
    siteSurveyStatus: null,
    designCompletionDate: "2025-01-15",
    designApprovalDate: null,
    designDraftDate: null,
    designApprovalSentDate: null,
    designStartDate: null,
    dateReturnedFromDesigners: null,
    daRevisionCounter: null,
    asBuiltRevisionCounter: null,
    permitRevisionCounter: null,
    interconnectionRevisionCounter: null,
    totalRevisionCount: null,
    designStatus: null,
    layoutStatus: null,
    permitSubmitDate: "2025-01-20",
    permitIssueDate: "2025-02-10",
    permittingStatus: null,
    interconnectionSubmitDate: "2025-01-25",
    interconnectionApprovalDate: "2025-02-15",
    interconnectionStatus: null,
    readyToBuildDate: "2025-02-20",
    constructionScheduleDate: null,
    constructionCompleteDate: "2025-03-15",
    constructionStatus: null,
    inspectionScheduleDate: null,
    inspectionPassDate: "2025-03-25",
    finalInspectionStatus: null,
    ptoSubmitDate: null,
    ptoGrantedDate: "2025-04-10",
    ptoStatus: null,
    forecastedInstallDate: null,
    forecastedInspectionDate: null,
    forecastedPtoDate: null,
    daysToInstall: null,
    daysToInspection: null,
    daysToPto: null,
    daysSinceClose: 365,
    daysSinceStageMovement: 0,
    stagePriority: 0,
    isRtb: false,
    isSchedulable: false,
    isActive: false,
    isBlocked: false,
    priorityScore: 0,
    expectedDaysForInstall: 0,
    daysForInstallers: 0,
    daysForElectricians: 0,
    installCrew: "",
    installDifficulty: 0,
    installNotes: "",
    roofersCount: 0,
    electriciansCount: 0,
    equipment: {
      modules: { brand: "", model: "", count: 0, wattage: 0, productName: "" },
      inverter: { brand: "", model: "", count: 0, sizeKwac: 0, productName: "" },
      battery: {
        brand: "",
        model: "",
        count: 0,
        sizeKwh: 0,
        expansionCount: 0,
        productName: "",
        expansionProductName: "",
        expansionModel: "",
      },
      evCount: 0,
      systemSizeKwdc: 0,
      systemSizeKwac: 0,
    },
    projectManager: "",
    operationsManager: "",
    dealOwner: "",
    siteSurveyor: "",
    designLead: "",
    permitLead: "",
    interconnectionsLead: "",
    preconstructionLead: "",
    siteSurveyTurnaroundTime: null,
    timeDAReadyToSent: null,
    daTurnaroundTime: null,
    timeToSubmitPermit: null,
    timeToSubmitInterconnection: null,
    daToRtb: null,
    constructionTurnaroundTime: null,
    timeCcToPto: null,
    timeToCc: null,
    timeToDa: null,
    timeToPto: null,
    interconnectionTurnaroundTime: null,
    permitTurnaroundTime: null,
    timeRtbToConstructionSchedule: null,
    designTurnaroundTime: null,
    projectTurnaroundTime: null,
    timeToRtb: null,
    timeRtbToCc: null,
    daToCc: null,
    daToPermit: null,
    designFolderUrl: null,
    driveUrl: null,
    openSolarUrl: null,
    openSolarId: null,
    zuperUid: null,
    hubspotContactId: null,
    ...overrides,
  } as Project;
}

// ─── MILESTONE_CHAIN ───────────────────────────────────────────────

describe("MILESTONE_CHAIN", () => {
  it("has 10 milestones in the correct order", () => {
    expect(MILESTONE_CHAIN).toEqual([
      "close",
      "designComplete",
      "permitSubmit",
      "permitApproval",
      "icSubmit",
      "icApproval",
      "rtb",
      "install",
      "inspection",
      "pto",
    ]);
  });
});

// ─── buildBaselineTable ────────────────────────────────────────────

describe("buildBaselineTable", () => {
  it("computes median days between milestones for a segment", () => {
    const projects = Array.from({ length: 5 }, (_, i) =>
      makeCompletedProject({ id: i + 1 }),
    );
    const table = buildBaselineTable(projects);
    const segKey = "Westminster|Boulder County|Xcel";
    const entry = table[segKey];

    expect(entry).toBeDefined();
    expect(entry.sampleCount).toBe(5);
    // Close (Jan 1) → Design Complete (Jan 15) = 14 days
    expect(entry.pairs.close_to_designComplete.median).toBe(14);
    // Design Complete (Jan 15) → Permit Submit (Jan 20) = 5 days
    expect(entry.pairs.designComplete_to_permitSubmit.median).toBe(5);
  });

  it("requires 5+ samples for full segment, 5+ for location, 3+ for global", () => {
    // 3 projects — below full/location threshold but above global
    const projects = Array.from({ length: 3 }, (_, i) =>
      makeCompletedProject({ id: i + 1 }),
    );
    const table = buildBaselineTable(projects);

    expect(table["Westminster|Boulder County|Xcel"]).toBeUndefined();
    expect(table["Westminster||"]).toBeUndefined();
    expect(table["global"]).toBeDefined();
    expect(table["global"].sampleCount).toBe(3);
  });

  it("includes p25 and p75 confidence bands", () => {
    const projects = Array.from({ length: 10 }, (_, i) => {
      const designDay = 10 + i * 2; // 10, 12, 14, ..., 28
      return makeCompletedProject({
        id: i + 1,
        designCompletionDate: `2025-01-${String(designDay).padStart(2, "0")}`,
      });
    });
    const table = buildBaselineTable(projects);
    const pair = table["Westminster|Boulder County|Xcel"].pairs.close_to_designComplete;

    expect(pair.p25).toBeDefined();
    expect(pair.p75).toBeDefined();
    expect(pair.p25!).toBeLessThanOrEqual(pair.median!);
    expect(pair.p75!).toBeGreaterThanOrEqual(pair.median!);
  });

  it("skips milestone pairs where either date is null", () => {
    const projects = Array.from({ length: 5 }, (_, i) =>
      makeCompletedProject({ id: i + 1, ptoGrantedDate: null }),
    );
    const table = buildBaselineTable(projects);
    const pair = table["Westminster|Boulder County|Xcel"]?.pairs.inspection_to_pto;

    expect(pair?.median).toBeNull();
    expect(pair?.sampleCount).toBe(0);
  });

  it("skips negative durations (data errors)", () => {
    const projects = Array.from({ length: 5 }, (_, i) =>
      makeCompletedProject({
        id: i + 1,
        // Design completion BEFORE close — data error
        designCompletionDate: "2024-12-25",
      }),
    );
    const table = buildBaselineTable(projects);
    const pair = table["Westminster|Boulder County|Xcel"].pairs.close_to_designComplete;

    expect(pair.sampleCount).toBe(0);
    expect(pair.median).toBeNull();
  });
});

// ─── computeForecast ───────────────────────────────────────────────

describe("computeForecast", () => {
  function makeBasicTable(): BaselineTable {
    const pairs: Record<string, PairStats> = {};
    for (let i = 0; i < MILESTONE_CHAIN.length - 1; i++) {
      const from = MILESTONE_CHAIN[i];
      const to = MILESTONE_CHAIN[i + 1];
      pairs[`${from}_to_${to}`] = {
        median: 14,
        p25: 10,
        p75: 18,
        sampleCount: 10,
      };
    }
    return {
      "Westminster|Boulder County|Xcel": { sampleCount: 10, pairs },
      global: { sampleCount: 100, pairs },
    };
  }

  it("chains forecast dates from closeDate using segment data", () => {
    const table = makeBasicTable();
    const project = makeCompletedProject({
      closeDate: "2025-06-01",
      designCompletionDate: null,
      permitSubmitDate: null,
      permitIssueDate: null,
      interconnectionSubmitDate: null,
      interconnectionApprovalDate: null,
      readyToBuildDate: null,
      constructionCompleteDate: null,
      inspectionPassDate: null,
      ptoGrantedDate: null,
    });

    const forecast = computeForecast(project, table);

    expect(forecast.close.date).toBe("2025-06-01");
    expect(forecast.close.basis).toBe("actual");
    expect(forecast.designComplete.date).toBe("2025-06-15");
    expect(forecast.designComplete.basis).toBe("segment");
    // Install = close + (14 * 7) = 98 days = Sep 7
    expect(forecast.install.date).toBe("2025-09-07");
    expect(forecast.install.basis).toBe("segment");
    // PTO = close + (14 * 9) = 126 days = Oct 5
    expect(forecast.pto.date).toBe("2025-10-05");
    expect(forecast.pto.basis).toBe("segment");
  });

  it("uses actual dates when milestones are completed", () => {
    const table = makeBasicTable();
    const project = makeCompletedProject({
      closeDate: "2025-06-01",
      designCompletionDate: "2025-06-10", // completed early
      permitSubmitDate: null,
      permitIssueDate: null,
      interconnectionSubmitDate: null,
      interconnectionApprovalDate: null,
      readyToBuildDate: null,
      constructionCompleteDate: null,
      inspectionPassDate: null,
      ptoGrantedDate: null,
    });

    const forecast = computeForecast(project, table);

    expect(forecast.designComplete.date).toBe("2025-06-10");
    expect(forecast.designComplete.basis).toBe("actual");
    // Chains from actual: Jun 10 + 14 = Jun 24
    expect(forecast.permitSubmit.date).toBe("2025-06-24");
    expect(forecast.permitSubmit.basis).toBe("segment");
  });

  it("falls back to location segment when full segment unavailable", () => {
    const pairs: Record<string, PairStats> = {};
    for (let i = 0; i < MILESTONE_CHAIN.length - 1; i++) {
      const from = MILESTONE_CHAIN[i];
      const to = MILESTONE_CHAIN[i + 1];
      pairs[`${from}_to_${to}`] = {
        median: 20,
        p25: 15,
        p75: 25,
        sampleCount: 8,
      };
    }
    const table: BaselineTable = {
      "Westminster||": { sampleCount: 8, pairs },
      global: { sampleCount: 100, pairs },
    };

    const project = makeCompletedProject({
      closeDate: "2025-06-01",
      designCompletionDate: null,
      permitSubmitDate: null,
      permitIssueDate: null,
      interconnectionSubmitDate: null,
      interconnectionApprovalDate: null,
      readyToBuildDate: null,
      constructionCompleteDate: null,
      inspectionPassDate: null,
      ptoGrantedDate: null,
    });

    const forecast = computeForecast(project, table);
    expect(forecast.designComplete.basis).toBe("location");
    expect(forecast.designComplete.date).toBe("2025-06-21"); // Jun 1 + 20
  });

  it("returns insufficient when no baseline data exists", () => {
    const table: BaselineTable = {};
    const project = makeCompletedProject({
      closeDate: "2025-06-01",
      designCompletionDate: null,
      permitSubmitDate: null,
      permitIssueDate: null,
      interconnectionSubmitDate: null,
      interconnectionApprovalDate: null,
      readyToBuildDate: null,
      constructionCompleteDate: null,
      inspectionPassDate: null,
      ptoGrantedDate: null,
    });

    const forecast = computeForecast(project, table);
    expect(forecast.designComplete.basis).toBe("insufficient");
    expect(forecast.designComplete.date).toBeNull();
  });

  it("returns insufficient for all milestones when no closeDate", () => {
    const table: BaselineTable = {
      global: {
        sampleCount: 100,
        pairs: {
          close_to_designComplete: { median: 14, p25: 10, p75: 18, sampleCount: 10 },
        },
      },
    };
    const project = makeCompletedProject({
      closeDate: null,
      designCompletionDate: null,
    });

    const forecast = computeForecast(project, table);
    expect(forecast.close.basis).toBe("insufficient");
    expect(forecast.designComplete.basis).toBe("insufficient");
  });
});

// ─── computeProjectForecasts ───────────────────────────────────────

describe("computeProjectForecasts", () => {
  function makeBasicTable(): BaselineTable {
    const pairs: Record<string, PairStats> = {};
    for (let i = 0; i < MILESTONE_CHAIN.length - 1; i++) {
      const from = MILESTONE_CHAIN[i];
      const to = MILESTONE_CHAIN[i + 1];
      pairs[`${from}_to_${to}`] = {
        median: 14,
        p25: 10,
        p75: 18,
        sampleCount: 10,
      };
    }
    return {
      "Westminster|Boulder County|Xcel": { sampleCount: 10, pairs },
      global: { sampleCount: 100, pairs },
    };
  }

  it("original forecast ignores actuals, live forecast uses them", () => {
    const table = makeBasicTable();
    const project = makeCompletedProject({
      closeDate: "2025-06-01",
      designCompletionDate: "2025-06-10", // completed early
      permitSubmitDate: null,
      permitIssueDate: null,
      interconnectionSubmitDate: null,
      interconnectionApprovalDate: null,
      readyToBuildDate: null,
      constructionCompleteDate: null,
      inspectionPassDate: null,
      ptoGrantedDate: null,
    });

    const { original, live } = computeProjectForecasts(project, table);

    // Original: designComplete forecasted from close + 14 = Jun 15
    expect(original.designComplete.date).toBe("2025-06-15");
    expect(original.designComplete.basis).toBe("segment");

    // Live: designComplete is actual Jun 10
    expect(live.designComplete.date).toBe("2025-06-10");
    expect(live.designComplete.basis).toBe("actual");

    // Original: permitSubmit = Jun 15 + 14 = Jun 29
    expect(original.permitSubmit.date).toBe("2025-06-29");
    // Live: permitSubmit = Jun 10 + 14 = Jun 24
    expect(live.permitSubmit.date).toBe("2025-06-24");
  });

  it("both are identical when no actuals exist", () => {
    const table = makeBasicTable();
    const project = makeCompletedProject({
      closeDate: "2025-06-01",
      designCompletionDate: null,
      permitSubmitDate: null,
      permitIssueDate: null,
      interconnectionSubmitDate: null,
      interconnectionApprovalDate: null,
      readyToBuildDate: null,
      constructionCompleteDate: null,
      inspectionPassDate: null,
      ptoGrantedDate: null,
    });

    const { original, live } = computeProjectForecasts(project, table);

    for (const key of MILESTONE_CHAIN) {
      if (key === "close") continue;
      expect(original[key].date).toBe(live[key].date);
    }
  });
});
