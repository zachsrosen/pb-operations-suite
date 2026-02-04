import { transformProject, avg, MS_PER_DAY, FORECAST_OFFSETS } from "@/lib/transforms";
import type { RawProject } from "@/lib/types";

function makeRawProject(overrides: Partial<RawProject> = {}): RawProject {
  return {
    id: "123",
    name: "Test Project | Smith",
    pbLocation: "Westminster",
    ahj: "Boulder County",
    utility: "Xcel",
    projectType: "Residential",
    stage: "Construction",
    amount: 50000,
    url: "https://hubspot.com/deal/123",
    closeDate: "2024-06-01",
    ...overrides,
  };
}

describe("transformProject", () => {
  it("transforms a raw project with all fields", () => {
    const raw = makeRawProject();
    const result = transformProject(raw);

    expect(result.id).toBe("123");
    expect(result.name).toBe("Test Project | Smith");
    expect(result.pb_location).toBe("Westminster");
    expect(result.ahj).toBe("Boulder County");
    expect(result.utility).toBe("Xcel");
    expect(result.stage).toBe("Construction");
    expect(result.amount).toBe(50000);
    expect(result.url).toBe("https://hubspot.com/deal/123");
    expect(result.close_date).toBe("2024-06-01");
  });

  it("defaults missing location to Unknown", () => {
    const raw = makeRawProject({ pbLocation: undefined });
    const result = transformProject(raw);
    expect(result.pb_location).toBe("Unknown");
  });

  it("defaults missing amount to 0", () => {
    const raw = makeRawProject({ amount: undefined });
    const result = transformProject(raw);
    expect(result.amount).toBe(0);
  });

  it("computes days_since_close from close date", () => {
    const daysAgo = 30;
    const closeDate = new Date(Date.now() - daysAgo * MS_PER_DAY).toISOString().split("T")[0];
    const raw = makeRawProject({ closeDate });
    const result = transformProject(raw);

    // Allow ±1 day tolerance for timezone edge cases
    expect(Math.abs(result.days_since_close - daysAgo)).toBeLessThanOrEqual(1);
  });

  it("computes forecast dates from close date when not provided", () => {
    const closeDate = "2024-06-01";
    const raw = makeRawProject({ closeDate });
    const result = transformProject(raw);

    // Should compute forecast_install as closeDate + 90 days
    const expectedInstall = new Date(
      new Date(closeDate).getTime() + FORECAST_OFFSETS.install * MS_PER_DAY
    ).toISOString().split("T")[0];
    expect(result.forecast_install).toBe(expectedInstall);

    // Should compute forecast_inspection as closeDate + 120 days
    const expectedInspection = new Date(
      new Date(closeDate).getTime() + FORECAST_OFFSETS.inspection * MS_PER_DAY
    ).toISOString().split("T")[0];
    expect(result.forecast_inspection).toBe(expectedInspection);

    // Should compute forecast_pto as closeDate + 150 days
    const expectedPto = new Date(
      new Date(closeDate).getTime() + FORECAST_OFFSETS.pto * MS_PER_DAY
    ).toISOString().split("T")[0];
    expect(result.forecast_pto).toBe(expectedPto);
  });

  it("uses explicit forecast dates when provided", () => {
    const raw = makeRawProject({
      forecastedInstallDate: "2025-01-15",
      forecastedInspectionDate: "2025-02-15",
      forecastedPtoDate: "2025-03-15",
    });
    const result = transformProject(raw);

    expect(result.forecast_install).toBe("2025-01-15");
    expect(result.forecast_inspection).toBe("2025-02-15");
    expect(result.forecast_pto).toBe("2025-03-15");
  });

  it("prefers constructionScheduleDate over computed forecast for install", () => {
    const raw = makeRawProject({
      constructionScheduleDate: "2025-01-20",
    });
    const result = transformProject(raw);
    expect(result.forecast_install).toBe("2025-01-20");
  });

  it("returns null forecasts and day deltas when no close date", () => {
    const raw = makeRawProject({ closeDate: undefined });
    const result = transformProject(raw);

    expect(result.forecast_install).toBeNull();
    expect(result.forecast_inspection).toBeNull();
    expect(result.forecast_pto).toBeNull();
    expect(result.days_since_close).toBe(0);
  });

  it("computes negative days_to_install for overdue projects", () => {
    // Set forecast install to 10 days ago
    const pastDate = new Date(Date.now() - 10 * MS_PER_DAY).toISOString().split("T")[0];
    const raw = makeRawProject({ forecastedInstallDate: pastDate });
    const result = transformProject(raw);

    expect(result.days_to_install).not.toBeNull();
    expect(result.days_to_install!).toBeLessThan(0);
  });

  it("computes positive days_to_install for future projects", () => {
    const futureDate = new Date(Date.now() + 30 * MS_PER_DAY).toISOString().split("T")[0];
    const raw = makeRawProject({ forecastedInstallDate: futureDate });
    const result = transformProject(raw);

    expect(result.days_to_install).not.toBeNull();
    expect(result.days_to_install!).toBeGreaterThan(0);
  });

  it("passes through milestone dates", () => {
    const raw = makeRawProject({
      constructionCompleteDate: "2025-01-10",
      inspectionPassDate: "2025-02-10",
      ptoGrantedDate: "2025-03-10",
      permitSubmitDate: "2024-08-01",
      permitIssueDate: "2024-09-01",
    });
    const result = transformProject(raw);

    expect(result.construction_complete).toBe("2025-01-10");
    expect(result.inspection_pass).toBe("2025-02-10");
    expect(result.pto_granted).toBe("2025-03-10");
    expect(result.permit_submit).toBe("2024-08-01");
    expect(result.permit_issued).toBe("2024-09-01");
  });
});

describe("avg", () => {
  it("returns the average of an array", () => {
    expect(avg([10, 20, 30])).toBe(20);
  });

  it("rounds to nearest integer", () => {
    expect(avg([10, 20, 31])).toBe(20); // 20.33 -> 20
    expect(avg([10, 20, 32])).toBe(21); // 20.67 -> 21
  });

  it("returns null for empty array", () => {
    expect(avg([])).toBeNull();
  });

  it("handles single element", () => {
    expect(avg([42])).toBe(42);
  });
});
