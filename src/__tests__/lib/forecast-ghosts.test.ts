import {
  mapStage,
  mapRawStage,
  PRE_CONSTRUCTION_STAGES,
  normalizeLocation,
  buildForecastGhosts,
  type TimelineProject,
  type RawProjectMinimal,
} from "@/lib/forecast-ghosts";

describe("forecast-ghosts", () => {
  // ── Stage helpers ──

  describe("mapStage", () => {
    it("maps standard HubSpot stage names", () => {
      expect(mapStage("Site Survey")).toBe("survey");
      expect(mapStage("Ready To Build")).toBe("rtb");
      expect(mapStage("RTB - Blocked")).toBe("blocked");
      expect(mapStage("Construction")).toBe("construction");
      expect(mapStage("Inspection")).toBe("inspection");
    });

    it("returns 'other' for unknown stages", () => {
      expect(mapStage("Close Out")).toBe("other");
      expect(mapStage("")).toBe("other");
      expect(mapStage(null)).toBe("other");
    });
  });

  describe("mapRawStage", () => {
    it("maps D&E variants to 'design'", () => {
      expect(mapRawStage("Design & Engineering")).toBe("design");
      expect(mapRawStage("D&E")).toBe("design");
    });

    it("maps P&I variants to 'permitting'", () => {
      expect(mapRawStage("Permitting & Interconnection")).toBe("permitting");
      expect(mapRawStage("P&I")).toBe("permitting");
    });

    it("falls through to mapStage for other stages", () => {
      expect(mapRawStage("Site Survey")).toBe("survey");
      expect(mapRawStage("Ready To Build")).toBe("rtb");
    });
  });

  describe("PRE_CONSTRUCTION_STAGES", () => {
    it("includes all five pre-construction stages", () => {
      expect(PRE_CONSTRUCTION_STAGES.has("survey")).toBe(true);
      expect(PRE_CONSTRUCTION_STAGES.has("rtb")).toBe(true);
      expect(PRE_CONSTRUCTION_STAGES.has("blocked")).toBe(true);
      expect(PRE_CONSTRUCTION_STAGES.has("design")).toBe(true);
      expect(PRE_CONSTRUCTION_STAGES.has("permitting")).toBe(true);
    });

    it("excludes post-construction stages", () => {
      expect(PRE_CONSTRUCTION_STAGES.has("construction")).toBe(false);
      expect(PRE_CONSTRUCTION_STAGES.has("inspection")).toBe(false);
      expect(PRE_CONSTRUCTION_STAGES.has("other")).toBe(false);
    });
  });

  describe("normalizeLocation", () => {
    it("returns the trimmed value", () => {
      expect(normalizeLocation("Denver")).toBe("Denver");
    });

    it("maps DTC to Centennial", () => {
      expect(normalizeLocation("DTC")).toBe("Centennial");
    });

    it("returns Unknown for empty/null", () => {
      expect(normalizeLocation("")).toBe("Unknown");
      expect(normalizeLocation(null)).toBe("Unknown");
      expect(normalizeLocation(undefined)).toBe("Unknown");
    });
  });

  // ── Builder ──

  describe("buildForecastGhosts", () => {
    const mkTimeline = (dealId: string, forecastDate: string | null, basis = "segment_median"): TimelineProject => ({
      dealId,
      projectNumber: `PROJ-${dealId}`,
      customerName: "Test",
      location: "Denver",
      currentStage: "RTB",
      milestones: [{ key: "install", liveForecast: forecastDate, basis, varianceDays: 5, name: "Install" }],
    });

    const mkRaw = (id: string, stage: string, overrides?: Partial<RawProjectMinimal>): RawProjectMinimal => ({
      id,
      name: `PROJ-${id} Test`,
      stage,
      amount: 50000,
      pbLocation: "Denver",
      address: "123 Main St",
      ...overrides,
    });

    it("generates ghost for eligible raw project", () => {
      const ghosts = buildForecastGhosts({
        timelineProjects: [mkTimeline("1", "2026-05-15")],
        rawProjects: [mkRaw("1", "Ready To Build")],
        scheduledEventIds: new Set(),
        manualInstallationIds: new Set(),
      });
      expect(ghosts).toHaveLength(1);
      expect(ghosts[0].date).toBe("2026-05-15");
      expect(ghosts[0].isForecast).toBe(true);
      expect(ghosts[0].stage).toBe("rtb");
    });

    it("skips project with constructionScheduleDate", () => {
      const ghosts = buildForecastGhosts({
        timelineProjects: [mkTimeline("1", "2026-05-15")],
        rawProjects: [mkRaw("1", "Ready To Build", { constructionScheduleDate: "2026-04-01" })],
        scheduledEventIds: new Set(),
        manualInstallationIds: new Set(),
      });
      expect(ghosts).toHaveLength(0);
    });

    it("generates ghost for D&E project", () => {
      const ghosts = buildForecastGhosts({
        timelineProjects: [mkTimeline("2", "2026-07-01")],
        rawProjects: [mkRaw("2", "Design & Engineering")],
        scheduledEventIds: new Set(),
        manualInstallationIds: new Set(),
      });
      expect(ghosts).toHaveLength(1);
      expect(ghosts[0].stage).toBe("design");
    });

    it("generates ghost for P&I project", () => {
      const ghosts = buildForecastGhosts({
        timelineProjects: [mkTimeline("3", "2026-08-01")],
        rawProjects: [mkRaw("3", "Permitting & Interconnection")],
        scheduledEventIds: new Set(),
        manualInstallationIds: new Set(),
      });
      expect(ghosts).toHaveLength(1);
      expect(ghosts[0].stage).toBe("permitting");
    });

    it("skips project with real construction event", () => {
      const ghosts = buildForecastGhosts({
        timelineProjects: [mkTimeline("1", "2026-05-15")],
        rawProjects: [mkRaw("1", "Ready To Build")],
        scheduledEventIds: new Set(["1"]),
        manualInstallationIds: new Set(),
      });
      expect(ghosts).toHaveLength(0);
    });

    it("skips project with manual installation schedule", () => {
      const ghosts = buildForecastGhosts({
        timelineProjects: [mkTimeline("1", "2026-05-15")],
        rawProjects: [mkRaw("1", "Ready To Build")],
        scheduledEventIds: new Set(),
        manualInstallationIds: new Set(["1"]),
      });
      expect(ghosts).toHaveLength(0);
    });

    it("skips project with actual basis milestone", () => {
      const ghosts = buildForecastGhosts({
        timelineProjects: [mkTimeline("1", "2026-05-15", "actual")],
        rawProjects: [mkRaw("1", "Ready To Build")],
        scheduledEventIds: new Set(),
        manualInstallationIds: new Set(),
      });
      expect(ghosts).toHaveLength(0);
    });

    it("skips project with no forecast date", () => {
      const ghosts = buildForecastGhosts({
        timelineProjects: [mkTimeline("1", null)],
        rawProjects: [mkRaw("1", "Ready To Build")],
        scheduledEventIds: new Set(),
        manualInstallationIds: new Set(),
      });
      expect(ghosts).toHaveLength(0);
    });

    it("populates all ForecastGhost fields from raw project", () => {
      const ghosts = buildForecastGhosts({
        timelineProjects: [mkTimeline("1", "2026-05-15")],
        rawProjects: [mkRaw("1", "RTB - Blocked", {
          amount: 75000,
          ahj: "Denver County",
          utility: "Xcel",
          installDifficulty: 4,
          installNotes: "Steep roof",
          equipment: { systemSizeKwdc: 10.5, modules: { count: 28 }, inverter: { count: 1 }, battery: { count: 2 } },
        })],
        scheduledEventIds: new Set(),
        manualInstallationIds: new Set(),
      });
      expect(ghosts).toHaveLength(1);
      const g = ghosts[0];
      expect(g.amount).toBe(75000);
      expect(g.ahj).toBe("Denver County");
      expect(g.utility).toBe("Xcel");
      expect(g.difficulty).toBe(4);
      expect(g.installNotes).toBe("Steep roof");
      expect(g.systemSize).toBe(10.5);
      expect(g.moduleCount).toBe(28);
      expect(g.batteries).toBe(2);
    });

    it("skips projects not in rawProjects", () => {
      const ghosts = buildForecastGhosts({
        timelineProjects: [mkTimeline("999", "2026-05-15")],
        rawProjects: [], // not present
        scheduledEventIds: new Set(),
        manualInstallationIds: new Set(),
      });
      expect(ghosts).toHaveLength(0);
    });
  });
});
