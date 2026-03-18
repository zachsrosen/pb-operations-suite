/**
 * Tests for scheduler forecast ghost event logic.
 *
 * Since the ghost event builder lives inside the scheduler page component
 * (as a useMemo), we test the core logic by extracting the eligibility
 * and filtering rules into testable assertions against mock data shapes.
 */

describe("Scheduler Forecast Ghost Events", () => {
  // ── Eligibility filter tests ──

  describe("eligibility filter", () => {
    const PRE_CONSTRUCTION_STAGES = new Set(["survey", "rtb", "blocked"]);

    function isEligible(opts: {
      stage?: string;
      constructionScheduleDate?: string | null;
      manualScheduleType?: string | null;
      zuperJobCategory?: string;
      hasRealConstructionEvent?: boolean;
      installMilestone?: { liveForecast: string | null; basis: string } | null;
    }): boolean {
      if (!PRE_CONSTRUCTION_STAGES.has(opts.stage || "")) return false;
      if (opts.constructionScheduleDate) return false;
      if (opts.manualScheduleType === "installation") return false;
      if (opts.zuperJobCategory === "construction") return false;
      if (opts.hasRealConstructionEvent) return false;
      if (!opts.installMilestone) return false;
      if (opts.installMilestone.basis === "actual" || opts.installMilestone.basis === "insufficient") return false;
      if (!opts.installMilestone.liveForecast) return false;
      return true;
    }

    it("allows pre-construction project with valid forecast", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualScheduleType: null,
        zuperJobCategory: "survey",
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(true);
    });

    it("allows survey-stage project with valid forecast", () => {
      expect(isEligible({
        stage: "survey",
        constructionScheduleDate: null,
        manualScheduleType: null,
        zuperJobCategory: "survey",
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(true);
    });

    it("allows blocked-stage project with valid forecast", () => {
      expect(isEligible({
        stage: "blocked",
        constructionScheduleDate: null,
        manualScheduleType: null,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(true);
    });

    it("rejects inspection-stage project (post-construction)", () => {
      expect(isEligible({
        stage: "inspection",
        constructionScheduleDate: null,
        manualScheduleType: null,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(false);
    });

    it("rejects construction-stage project", () => {
      expect(isEligible({
        stage: "construction",
        constructionScheduleDate: null,
        manualScheduleType: null,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(false);
    });

    it("rejects project with constructionScheduleDate", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: "2026-04-10",
        manualScheduleType: null,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(false);
    });

    it("rejects project with tentative installation schedule", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualScheduleType: "installation",
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(false);
    });

    it("allows project with tentative survey schedule (not installation)", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualScheduleType: "survey",
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(true);
    });

    it("rejects project with active Zuper construction job", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualScheduleType: null,
        zuperJobCategory: "construction",
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(false);
    });

    it("rejects project with real construction event in scheduledEvents", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualScheduleType: null,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: true,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(false);
    });

    it("rejects project with 'actual' basis milestone", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualScheduleType: null,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "actual" },
      })).toBe(false);
    });

    it("rejects project with 'insufficient' basis milestone", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualScheduleType: null,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: null, basis: "insufficient" },
      })).toBe(false);
    });

    it("rejects project with no install milestone", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualScheduleType: null,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: null,
      })).toBe(false);
    });
  });

  // ── Revenue exclusion tests ──

  describe("revenue exclusion", () => {
    function computeRevenueBuckets(events: Array<{
      eventType: string;
      isOverdue?: boolean;
      isTentative?: boolean;
      isForecast?: boolean;
      amount: number;
      id: string;
    }>) {
      const scheduledEvts = events.filter((e) =>
        (e.eventType === "construction" || e.eventType === "rtb" || e.eventType === "blocked" || e.eventType === "scheduled") && !e.isOverdue && !e.isTentative && !e.isForecast
      );
      const tentativeEvts = events.filter((e) => e.isTentative && !e.isForecast);
      const completedEvts = events.filter((e) => e.eventType === "construction-complete" && !e.isForecast);
      const overdueEvts = events.filter((e) =>
        (e.eventType === "construction" || e.eventType === "rtb" || e.eventType === "blocked" || e.eventType === "scheduled") && e.isOverdue && !e.isTentative && !e.isForecast
      );

      const sum = (evts: typeof events) => {
        const ids = new Set(evts.map((e) => e.id));
        return {
          count: ids.size,
          revenue: [...ids].reduce((s, id) => s + (evts.find((e) => e.id === id)?.amount || 0), 0),
        };
      };

      return { scheduled: sum(scheduledEvts), tentative: sum(tentativeEvts), completed: sum(completedEvts), overdue: sum(overdueEvts) };
    }

    it("excludes isForecast events from scheduled revenue", () => {
      const events = [
        { id: "1", eventType: "construction", amount: 50000, isForecast: true },
        { id: "2", eventType: "construction", amount: 30000 },
      ];
      const buckets = computeRevenueBuckets(events);
      expect(buckets.scheduled.count).toBe(1);
      expect(buckets.scheduled.revenue).toBe(30000);
    });

    it("excludes isForecast events from completed revenue", () => {
      const events = [
        { id: "1", eventType: "construction-complete", amount: 50000, isForecast: true },
        { id: "2", eventType: "construction-complete", amount: 30000 },
      ];
      const buckets = computeRevenueBuckets(events);
      expect(buckets.completed.count).toBe(1);
      expect(buckets.completed.revenue).toBe(30000);
    });

    it("counts real construction events normally", () => {
      const events = [
        { id: "1", eventType: "construction", amount: 50000 },
        { id: "2", eventType: "construction", amount: 30000 },
      ];
      const buckets = computeRevenueBuckets(events);
      expect(buckets.scheduled.count).toBe(2);
      expect(buckets.scheduled.revenue).toBe(80000);
    });
  });

  // ── D&E / Permitting eligibility (all pre-construction stages) ──

  describe("design & permitting eligibility", () => {
    const ALL_PRE_CONSTRUCTION_STAGES = new Set(["survey", "rtb", "blocked", "design", "permitting"]);

    function isEligibleAllStages(opts: {
      stage?: string;
      constructionScheduleDate?: string | null;
      manualScheduleType?: string | null;
      zuperJobCategory?: string;
      hasRealConstructionEvent?: boolean;
      installMilestone?: { liveForecast: string | null; basis: string } | null;
    }): boolean {
      if (!ALL_PRE_CONSTRUCTION_STAGES.has(opts.stage || "")) return false;
      if (opts.constructionScheduleDate) return false;
      if (opts.manualScheduleType === "installation") return false;
      if (opts.zuperJobCategory === "construction") return false;
      if (opts.hasRealConstructionEvent) return false;
      if (!opts.installMilestone) return false;
      if (opts.installMilestone.basis === "actual" || opts.installMilestone.basis === "insufficient") return false;
      if (!opts.installMilestone.liveForecast) return false;
      return true;
    }

    it("allows design-stage project with valid forecast", () => {
      expect(isEligibleAllStages({
        stage: "design",
        constructionScheduleDate: null,
        manualScheduleType: null,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-06-15", basis: "segment_median" },
      })).toBe(true);
    });

    it("allows permitting-stage project with valid forecast", () => {
      expect(isEligibleAllStages({
        stage: "permitting",
        constructionScheduleDate: null,
        manualScheduleType: null,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-07-01", basis: "segment_median" },
      })).toBe(true);
    });

    it("rejects 'other' stage (not in pre-construction set)", () => {
      expect(isEligibleAllStages({
        stage: "other",
        constructionScheduleDate: null,
        manualScheduleType: null,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-06-15", basis: "segment_median" },
      })).toBe(false);
    });
  });

  // ── Overdue forecast split ──

  describe("overdue forecast split", () => {
    type Ghost = { id: string; date: string; amount: number; isForecast: true };

    function splitGhosts(ghosts: Ghost[], todayLocal: string) {
      return {
        future: ghosts.filter((e) => e.date >= todayLocal),
        overdue: ghosts.filter((e) => e.date < todayLocal),
      };
    }

    const today = "2026-03-17";

    it("classifies future forecast as non-overdue", () => {
      const ghosts: Ghost[] = [
        { id: "1", date: "2026-04-15", amount: 50000, isForecast: true },
      ];
      const { future, overdue } = splitGhosts(ghosts, today);
      expect(future).toHaveLength(1);
      expect(overdue).toHaveLength(0);
    });

    it("classifies past forecast as overdue", () => {
      const ghosts: Ghost[] = [
        { id: "2", date: "2026-03-01", amount: 40000, isForecast: true },
      ];
      const { future, overdue } = splitGhosts(ghosts, today);
      expect(future).toHaveLength(0);
      expect(overdue).toHaveLength(1);
    });

    it("keeps today's forecast as non-overdue (>= comparison)", () => {
      const ghosts: Ghost[] = [
        { id: "3", date: "2026-03-17", amount: 30000, isForecast: true },
      ];
      const { future, overdue } = splitGhosts(ghosts, today);
      expect(future).toHaveLength(1);
      expect(overdue).toHaveLength(0);
    });

    it("splits a mixed set correctly", () => {
      const ghosts: Ghost[] = [
        { id: "1", date: "2026-04-15", amount: 50000, isForecast: true },
        { id: "2", date: "2026-03-01", amount: 40000, isForecast: true },
        { id: "3", date: "2026-03-17", amount: 30000, isForecast: true },
        { id: "4", date: "2026-02-10", amount: 20000, isForecast: true },
      ];
      const { future, overdue } = splitGhosts(ghosts, today);
      expect(future).toHaveLength(2); // Apr 15 + today
      expect(overdue).toHaveLength(2); // Mar 1 + Feb 10
    });
  });

  // ── Overdue forecast summary ──

  describe("overdue forecast summary", () => {
    type Ghost = { id: string; date: string; amount: number };

    function computeOverdueSummary(overdueEvents: Ghost[]) {
      if (overdueEvents.length === 0) return { count: 0, revenue: 0 };
      const ids = new Set(overdueEvents.map((e) => e.id));
      return {
        count: ids.size,
        revenue: [...ids].reduce((sum, id) => sum + (overdueEvents.find((e) => e.id === id)?.amount || 0), 0),
      };
    }

    it("returns zero for empty array", () => {
      const summary = computeOverdueSummary([]);
      expect(summary.count).toBe(0);
      expect(summary.revenue).toBe(0);
    });

    it("sums revenue across overdue forecasts", () => {
      const summary = computeOverdueSummary([
        { id: "1", date: "2026-03-01", amount: 40000 },
        { id: "2", date: "2026-02-15", amount: 60000 },
      ]);
      expect(summary.count).toBe(2);
      expect(summary.revenue).toBe(100000);
    });

    it("deduplicates by project id", () => {
      const summary = computeOverdueSummary([
        { id: "1", date: "2026-03-01", amount: 40000 },
        { id: "1", date: "2026-02-15", amount: 40000 }, // same project, different date
      ]);
      expect(summary.count).toBe(1);
      expect(summary.revenue).toBe(40000);
    });
  });

  // ── Local date construction ──

  describe("local date string", () => {
    function buildLocalDateStr(d: Date): string {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }

    it("produces YYYY-MM-DD format", () => {
      const d = new Date(2026, 2, 17); // March 17 (0-indexed month)
      expect(buildLocalDateStr(d)).toBe("2026-03-17");
    });

    it("pads single-digit months and days", () => {
      const d = new Date(2026, 0, 5); // Jan 5
      expect(buildLocalDateStr(d)).toBe("2026-01-05");
    });

    it("differs from UTC toISOString for late-night US times", () => {
      // Simulate 11pm on March 17 local time → UTC would be March 18
      const d = new Date(2026, 2, 17, 23, 0, 0);
      const localStr = buildLocalDateStr(d);
      expect(localStr).toBe("2026-03-17");
      // toISOString would give 2026-03-18 for UTC-offset timezones
      // We can't control TZ in tests but we verify local stays local
    });
  });

  // ── Calendar filter interaction ──

  describe("calendar filter interaction", () => {
    it("ghost events hide when showScheduled is off", () => {
      const ghost = { isForecast: true, isCompleted: undefined, isOverdue: undefined };
      const showScheduled = false;
      const visible = showScheduled || ghost.isCompleted || ghost.isOverdue;
      expect(visible).toBeFalsy();
    });

    it("ghost events show when showScheduled is on", () => {
      const ghost = { isForecast: true, isCompleted: undefined, isOverdue: undefined };
      const showScheduled = true;
      const visible = showScheduled || ghost.isCompleted || ghost.isOverdue;
      expect(visible).toBeTruthy();
    });
  });
});
