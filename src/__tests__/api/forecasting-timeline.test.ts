import { NextRequest } from "next/server";
import { GET } from "@/app/api/forecasting/timeline/route";

// ─── Mocks ────────────────────────────────────────────────────────

jest.mock("@/lib/hubspot", () => ({
  fetchAllProjects: jest.fn(),
}));

jest.mock("@/lib/cache", () => ({
  appCache: {
    getOrFetch: jest.fn(async (_key: string, fn: () => unknown) => ({ data: await fn() })),
  },
  CACHE_KEYS: { PROJECTS_ACTIVE: "projects:active" },
}));

jest.mock("@/lib/forecasting", () => ({
  getBaselineTable: jest.fn(),
  computeProjectForecasts: jest.fn(),
  MILESTONE_CHAIN: [
    "close", "designComplete", "permitSubmit", "permitApproval",
    "icSubmit", "icApproval", "rtb", "install", "inspection", "pto",
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
const { getBaselineTable, computeProjectForecasts } = jest.requireMock("@/lib/forecasting");

function makeRequest(): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/forecasting/timeline"));
}

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 1001,
    name: "Smith Residence",
    projectNumber: "PROJ-1001",
    pbLocation: "Westminster",
    stage: "Design & Engineering",
    closeDate: "2025-01-01",
    designCompletionDate: null,
    permitSubmitDate: null,
    permitIssueDate: null,
    interconnectionSubmitDate: null,
    interconnectionApprovalDate: null,
    readyToBuildDate: null,
    constructionCompleteDate: null,
    inspectionPassDate: null,
    ptoGrantedDate: null,
    ...overrides,
  };
}

function makeForecastSet(overrides: Record<string, { date: string | null; basis: string }> = {}) {
  const defaults: Record<string, { date: string | null; basis: string }> = {
    close: { date: "2025-01-01", basis: "actual" },
    designComplete: { date: "2025-01-20", basis: "segment" },
    permitSubmit: { date: "2025-02-05", basis: "segment" },
    permitApproval: { date: "2025-03-10", basis: "segment" },
    icSubmit: { date: "2025-03-15", basis: "location" },
    icApproval: { date: "2025-04-10", basis: "global" },
    rtb: { date: "2025-04-15", basis: "segment" },
    install: { date: "2025-05-01", basis: "segment" },
    inspection: { date: "2025-05-15", basis: "global" },
    pto: { date: "2025-06-01", basis: "segment" },
  };
  return { ...defaults, ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────

describe("GET /api/forecasting/timeline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getBaselineTable.mockResolvedValue({ data: {} });
  });

  it("returns 500 on error", async () => {
    getBaselineTable.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to compute forecast timeline");
  });

  it("handles empty project list gracefully", async () => {
    fetchAllProjects.mockResolvedValue([]);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toEqual([]);
    expect(body.summary).toEqual({ total: 0, onTrack: 0, atRisk: 0, behind: 0, noForecast: 0 });
  });

  it("excludes projects without closeDate", async () => {
    fetchAllProjects.mockResolvedValue([makeProject({ closeDate: null })]);
    computeProjectForecasts.mockReturnValue({ original: makeForecastSet(), live: makeForecastSet() });
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.projects).toHaveLength(0);
    expect(body.summary.total).toBe(0);
  });

  describe("variance bucketing", () => {
    it("classifies on-track (variance <= 7d)", async () => {
      fetchAllProjects.mockResolvedValue([makeProject()]);
      const origPto = "2025-06-01";
      const livePto = "2025-06-05"; // +4d
      computeProjectForecasts.mockReturnValue({
        original: makeForecastSet({ pto: { date: origPto, basis: "segment" } }),
        live: makeForecastSet({ pto: { date: livePto, basis: "segment" } }),
      });
      const res = await GET(makeRequest());
      const body = await res.json();
      expect(body.summary.onTrack).toBe(1);
      expect(body.projects[0].varianceDays).toBe(4);
    });

    it("classifies ahead-of-schedule (negative variance) as on-track", async () => {
      fetchAllProjects.mockResolvedValue([makeProject()]);
      computeProjectForecasts.mockReturnValue({
        original: makeForecastSet({ pto: { date: "2025-06-15", basis: "segment" } }),
        live: makeForecastSet({ pto: { date: "2025-06-01", basis: "segment" } }),
      });
      const res = await GET(makeRequest());
      const body = await res.json();
      expect(body.summary.onTrack).toBe(1);
      expect(body.projects[0].varianceDays).toBe(-14);
    });

    it("classifies at-risk (variance 8-14d)", async () => {
      fetchAllProjects.mockResolvedValue([makeProject()]);
      computeProjectForecasts.mockReturnValue({
        original: makeForecastSet({ pto: { date: "2025-06-01", basis: "segment" } }),
        live: makeForecastSet({ pto: { date: "2025-06-12", basis: "segment" } }),
      });
      const res = await GET(makeRequest());
      const body = await res.json();
      expect(body.summary.atRisk).toBe(1);
      expect(body.projects[0].varianceDays).toBe(11);
    });

    it("classifies behind (variance > 14d)", async () => {
      fetchAllProjects.mockResolvedValue([makeProject()]);
      computeProjectForecasts.mockReturnValue({
        original: makeForecastSet({ pto: { date: "2025-06-01", basis: "segment" } }),
        live: makeForecastSet({ pto: { date: "2025-07-01", basis: "segment" } }),
      });
      const res = await GET(makeRequest());
      const body = await res.json();
      expect(body.summary.behind).toBe(1);
      expect(body.projects[0].varianceDays).toBe(30);
    });

    it("classifies noForecast when PTO dates are null (insufficient data)", async () => {
      fetchAllProjects.mockResolvedValue([makeProject()]);
      computeProjectForecasts.mockReturnValue({
        original: makeForecastSet({ pto: { date: null, basis: "insufficient" } }),
        live: makeForecastSet({ pto: { date: null, basis: "insufficient" } }),
      });
      const res = await GET(makeRequest());
      const body = await res.json();
      expect(body.summary.noForecast).toBe(1);
      expect(body.projects[0].varianceDays).toBeNull();
    });
  });

  describe("next milestone selection", () => {
    it("selects first milestone without an actual date", async () => {
      const project = makeProject({
        designCompletionDate: "2025-01-20", // completed
        permitSubmitDate: null,             // next milestone
      });
      fetchAllProjects.mockResolvedValue([project]);
      computeProjectForecasts.mockReturnValue({
        original: makeForecastSet(),
        live: makeForecastSet({ permitSubmit: { date: "2025-02-10", basis: "segment" } }),
      });
      const res = await GET(makeRequest());
      const body = await res.json();
      expect(body.projects[0].nextMilestone.name).toBe("Permit Submit");
      expect(body.projects[0].nextMilestone.forecastDate).toBe("2025-02-10");
    });

    it("shows 'Complete' when all milestones have actual dates", async () => {
      const project = makeProject({
        designCompletionDate: "2025-01-20",
        permitSubmitDate: "2025-02-05",
        permitIssueDate: "2025-03-10",
        interconnectionSubmitDate: "2025-03-15",
        interconnectionApprovalDate: "2025-04-10",
        readyToBuildDate: "2025-04-15",
        constructionCompleteDate: "2025-05-01",
        inspectionPassDate: "2025-05-15",
        ptoGrantedDate: "2025-06-01",
      });
      fetchAllProjects.mockResolvedValue([project]);
      computeProjectForecasts.mockReturnValue({
        original: makeForecastSet(),
        live: makeForecastSet(),
      });
      const res = await GET(makeRequest());
      const body = await res.json();
      expect(body.projects[0].nextMilestone.name).toBe("Complete");
    });
  });

  describe("field mappings", () => {
    it("maps Project fields to TimelineProject correctly", async () => {
      const project = makeProject({ id: 42, name: "Garcia Solar", projectNumber: "PROJ-42", pbLocation: "Centennial", stage: "Permitting" });
      fetchAllProjects.mockResolvedValue([project]);
      computeProjectForecasts.mockReturnValue({
        original: makeForecastSet(),
        live: makeForecastSet(),
      });
      const res = await GET(makeRequest());
      const body = await res.json();
      const p = body.projects[0];
      expect(p.dealId).toBe("42");
      expect(p.customerName).toBe("Garcia Solar");
      expect(p.projectNumber).toBe("PROJ-42");
      expect(p.location).toBe("Centennial");
      expect(p.currentStage).toBe("Permitting");
      expect(p.milestones).toHaveLength(10);
    });
  });
});
