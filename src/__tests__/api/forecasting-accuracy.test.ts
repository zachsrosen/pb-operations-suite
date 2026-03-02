import { NextRequest } from "next/server";
import { GET } from "@/app/api/forecasting/accuracy/route";

// ─── Mocks ────────────────────────────────────────────────────────

jest.mock("@/lib/hubspot", () => ({
  fetchAllProjects: jest.fn(),
}));

jest.mock("@/lib/cache", () => ({
  appCache: {
    getOrFetch: jest.fn((_key: string, fn: () => unknown) => fn()),
  },
  CACHE_KEYS: { PROJECTS_ALL: "projects:all" },
}));

jest.mock("@/lib/forecasting", () => ({
  getBaselineTable: jest.fn(),
  computeForecast: jest.fn(),
  MILESTONE_CHAIN: [
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
  ],
  MILESTONE_DATE_FIELD: {
    close: "closeDate",
    designComplete: "designCompletionDate",
    permitSubmit: "permitSubmitDate",
    permitApproval: "permitIssueDate",
    icSubmit: "interconnectionSubmitDate",
    icApproval: "interconnectionApprovalDate",
    rtb: "readyToBuildDate",
    install: "constructionCompleteDate",
    inspection: "inspectionPassDate",
    pto: "ptoGrantedDate",
  },
}));

const { fetchAllProjects } = jest.requireMock("@/lib/hubspot");
const { getBaselineTable, computeForecast } = jest.requireMock(
  "@/lib/forecasting",
);

function makeRequest(): NextRequest {
  return new NextRequest(
    new URL("http://localhost:3000/api/forecasting/accuracy"),
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Build a minimal project with closeDate + constructionCompleteDate (required to be analyzable) */
function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    closeDate: "2025-01-01",
    constructionCompleteDate: "2025-04-01",
    designCompletionDate: null,
    permitSubmitDate: null,
    permitIssueDate: null,
    interconnectionSubmitDate: null,
    interconnectionApprovalDate: null,
    readyToBuildDate: null,
    inspectionPassDate: null,
    ptoGrantedDate: null,
    ...overrides,
  };
}

/** Build a ForecastSet where every milestone has a date offset from a base */
function makeForecastSet(
  milestoneOverrides: Record<string, { date: string | null; basis: string }> = {},
) {
  const defaults: Record<string, { date: string | null; basis: string }> = {
    close: { date: "2025-01-01", basis: "actual" },
    designComplete: { date: null, basis: "insufficient" },
    permitSubmit: { date: null, basis: "insufficient" },
    permitApproval: { date: null, basis: "insufficient" },
    icSubmit: { date: null, basis: "insufficient" },
    icApproval: { date: null, basis: "insufficient" },
    rtb: { date: null, basis: "insufficient" },
    install: { date: null, basis: "insufficient" },
    inspection: { date: null, basis: "insufficient" },
    pto: { date: null, basis: "insufficient" },
  };
  return { ...defaults, ...milestoneOverrides };
}

// ─── Tests ────────────────────────────────────────────────────────

describe("GET /api/forecasting/accuracy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getBaselineTable.mockResolvedValue({ data: {} });
  });

  it("returns 500 on error", async () => {
    getBaselineTable.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to compute forecast accuracy");
  });

  it("handles empty project list gracefully", async () => {
    fetchAllProjects.mockResolvedValue({ data: [] });
    computeForecast.mockReturnValue(makeForecastSet());

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.overallAccuracy.totalProjectsAnalyzed).toBe(0);
    expect(body.overallAccuracy.medianError).toBeNull();
    expect(body.monthlyTrend).toEqual([]);
  });

  it("excludes projects without closeDate or constructionCompleteDate", async () => {
    fetchAllProjects.mockResolvedValue({
      data: [
        makeProject({ closeDate: null }), // no closeDate
        makeProject({ constructionCompleteDate: null }), // no cc date
      ],
    });
    computeForecast.mockReturnValue(makeForecastSet());

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.overallAccuracy.totalProjectsAnalyzed).toBe(0);
  });

  describe("signed error direction", () => {
    it("reports positive error when forecast is LATE (forecast > actual)", async () => {
      // Project with actual install on 2025-04-01
      const project = makeProject({
        constructionCompleteDate: "2025-04-01",
      });
      fetchAllProjects.mockResolvedValue({ data: [project] });

      // computeForecast called twice: once for milestoneAccuracy (blanked), once for basisDistribution (full)
      computeForecast.mockImplementation((p: Record<string, unknown>) => {
        // Blanked project (milestoneAccuracy) — forecast install as April 11 (10 days late)
        if (p.constructionCompleteDate === null) {
          return makeForecastSet({
            install: { date: "2025-04-11", basis: "segment" },
          });
        }
        // Full project (basisDistribution)
        return makeForecastSet({
          install: { date: "2025-04-01", basis: "actual" },
        });
      });

      const res = await GET(makeRequest());
      const body = await res.json();

      // Forecast was 10 days late → positive medianError
      expect(body.milestoneAccuracy.install.medianError).toBe(10);
      expect(body.overallAccuracy.medianError).toBe(10);
    });

    it("reports negative error when forecast is EARLY (forecast < actual)", async () => {
      const project = makeProject({
        constructionCompleteDate: "2025-04-01",
      });
      fetchAllProjects.mockResolvedValue({ data: [project] });

      computeForecast.mockImplementation((p: Record<string, unknown>) => {
        if (p.constructionCompleteDate === null) {
          // Forecast install as March 25 (7 days early)
          return makeForecastSet({
            install: { date: "2025-03-25", basis: "location" },
          });
        }
        return makeForecastSet({
          install: { date: "2025-04-01", basis: "actual" },
        });
      });

      const res = await GET(makeRequest());
      const body = await res.json();

      // Forecast was 7 days early → negative medianError
      expect(body.milestoneAccuracy.install.medianError).toBe(-7);
      expect(body.overallAccuracy.medianError).toBe(-7);
    });
  });

  describe("accuracy bucketing", () => {
    it("computes withinOneWeek and withinTwoWeeks percentages correctly", async () => {
      // 4 projects with different error magnitudes
      const projects = [
        makeProject({ constructionCompleteDate: "2025-04-01" }), // will be 3d error
        makeProject({ constructionCompleteDate: "2025-04-10" }), // will be 5d error
        makeProject({ constructionCompleteDate: "2025-05-01" }), // will be 10d error
        makeProject({ constructionCompleteDate: "2025-06-01" }), // will be 20d error
      ];
      fetchAllProjects.mockResolvedValue({ data: projects });

      computeForecast.mockImplementation((p: Record<string, unknown>) => {
        if (p.constructionCompleteDate === null) {
          // All forecasts are 2025-04-04 — so errors vary by actual date
          return makeForecastSet({
            install: { date: "2025-04-04", basis: "segment" },
          });
        }
        return makeForecastSet({
          install: { date: p.constructionCompleteDate as string, basis: "actual" },
        });
      });

      const res = await GET(makeRequest());
      const body = await res.json();
      const install = body.milestoneAccuracy.install;

      // Errors: |Apr4-Apr1|=3, |Apr4-Apr10|=6, |Apr4-May1|=27, |Apr4-Jun1|=58
      // Within 7d: 3, 6 → 2/4 = 50%
      // Within 14d: 3, 6 → 2/4 = 50%
      expect(install.sampleCount).toBe(4);
      expect(install.withinOneWeek).toBe(50);
      expect(install.withinTwoWeeks).toBe(50);
    });
  });

  describe("totalProjectsAnalyzed uses sample count", () => {
    it("reflects install sampleCount, not total analyzable projects", async () => {
      // 2 projects analyzable, but only 1 produces a forecast for install
      const projects = [
        makeProject({ constructionCompleteDate: "2025-04-01" }),
        makeProject({ constructionCompleteDate: "2025-05-01" }),
      ];
      fetchAllProjects.mockResolvedValue({ data: projects });

      let callCount = 0;
      computeForecast.mockImplementation((p: Record<string, unknown>) => {
        if (p.constructionCompleteDate === null) {
          callCount++;
          // First blank project gets a forecast, second doesn't
          if (callCount <= 1) {
            return makeForecastSet({
              install: { date: "2025-04-05", basis: "segment" },
            });
          }
          return makeForecastSet(); // no install forecast
        }
        return makeForecastSet({
          install: { date: p.constructionCompleteDate as string, basis: "actual" },
        });
      });

      const res = await GET(makeRequest());
      const body = await res.json();

      // Only 1 project produced a usable forecast for install
      expect(body.overallAccuracy.totalProjectsAnalyzed).toBe(1);
      expect(body.milestoneAccuracy.install.sampleCount).toBe(1);
    });
  });

  describe("basis distribution", () => {
    it("computes percentages across all milestones", async () => {
      const project = makeProject();
      fetchAllProjects.mockResolvedValue({ data: [project] });

      // Full project forecast: 5 segment, 3 global, 1 actual, 1 location
      computeForecast.mockImplementation((p: Record<string, unknown>) => {
        if (p.constructionCompleteDate === null) {
          return makeForecastSet(); // blanked — used for accuracy, not basis
        }
        return {
          close: { date: "2025-01-01", basis: "actual" },
          designComplete: { date: "2025-02-01", basis: "segment" },
          permitSubmit: { date: "2025-02-15", basis: "segment" },
          permitApproval: { date: "2025-03-01", basis: "segment" },
          icSubmit: { date: "2025-03-10", basis: "global" },
          icApproval: { date: "2025-03-20", basis: "global" },
          rtb: { date: "2025-03-25", basis: "global" },
          install: { date: "2025-04-01", basis: "segment" },
          inspection: { date: "2025-04-10", basis: "location" },
          pto: { date: "2025-04-20", basis: "segment" },
        };
      });

      const res = await GET(makeRequest());
      const body = await res.json();

      // 10 milestones: 5 segment, 3 global, 1 actual, 1 location, 0 insufficient
      expect(body.basisDistribution.segment).toBe(50);
      expect(body.basisDistribution.global).toBe(30);
      expect(body.basisDistribution.actual).toBe(10);
      expect(body.basisDistribution.location).toBe(10);
      expect(body.basisDistribution.insufficient).toBe(0);
    });
  });

  describe("monthly trend", () => {
    it("groups by constructionCompleteDate month and computes mean abs error", async () => {
      const projects = [
        makeProject({ constructionCompleteDate: "2025-04-05" }),
        makeProject({ constructionCompleteDate: "2025-04-20" }),
        makeProject({ constructionCompleteDate: "2025-05-10" }),
      ];
      fetchAllProjects.mockResolvedValue({ data: projects });

      computeForecast.mockImplementation((p: Record<string, unknown>) => {
        if (p.constructionCompleteDate === null) {
          // All blanked forecasts predict install on April 10
          return makeForecastSet({
            install: { date: "2025-04-10", basis: "segment" },
          });
        }
        return makeForecastSet({
          install: { date: p.constructionCompleteDate as string, basis: "actual" },
        });
      });

      const res = await GET(makeRequest());
      const body = await res.json();

      // April: |Apr10-Apr5|=5, |Apr10-Apr20|=10 → mean=7.5
      // May: |Apr10-May10|=30 → mean=30
      expect(body.monthlyTrend).toHaveLength(2);
      expect(body.monthlyTrend[0].month).toBe("2025-04");
      expect(body.monthlyTrend[0].meanAbsError).toBe(7.5);
      expect(body.monthlyTrend[0].sampleCount).toBe(2);
      expect(body.monthlyTrend[1].month).toBe("2025-05");
      expect(body.monthlyTrend[1].meanAbsError).toBe(30);
      expect(body.monthlyTrend[1].sampleCount).toBe(1);
    });
  });
});
