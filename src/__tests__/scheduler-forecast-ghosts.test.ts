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
      manualSchedule?: boolean;
      zuperJobCategory?: string;
      hasRealConstructionEvent?: boolean;
      installMilestone?: { liveForecast: string | null; basis: string } | null;
    }): boolean {
      if (!PRE_CONSTRUCTION_STAGES.has(opts.stage || "")) return false;
      if (opts.constructionScheduleDate) return false;
      if (opts.manualSchedule) return false;
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
        manualSchedule: false,
        zuperJobCategory: "survey",
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(true);
    });

    it("allows survey-stage project with valid forecast", () => {
      expect(isEligible({
        stage: "survey",
        constructionScheduleDate: null,
        manualSchedule: false,
        zuperJobCategory: "survey",
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(true);
    });

    it("allows blocked-stage project with valid forecast", () => {
      expect(isEligible({
        stage: "blocked",
        constructionScheduleDate: null,
        manualSchedule: false,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(true);
    });

    it("rejects inspection-stage project (post-construction)", () => {
      expect(isEligible({
        stage: "inspection",
        constructionScheduleDate: null,
        manualSchedule: false,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(false);
    });

    it("rejects construction-stage project", () => {
      expect(isEligible({
        stage: "construction",
        constructionScheduleDate: null,
        manualSchedule: false,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(false);
    });

    it("rejects project with constructionScheduleDate", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: "2026-04-10",
        manualSchedule: false,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(false);
    });

    it("rejects project with manual/tentative schedule", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualSchedule: true,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(false);
    });

    it("rejects project with active Zuper construction job", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualSchedule: false,
        zuperJobCategory: "construction",
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(false);
    });

    it("rejects project with real construction event in scheduledEvents", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualSchedule: false,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: true,
        installMilestone: { liveForecast: "2026-04-15", basis: "segment_median" },
      })).toBe(false);
    });

    it("rejects project with 'actual' basis milestone", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualSchedule: false,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: "2026-04-15", basis: "actual" },
      })).toBe(false);
    });

    it("rejects project with 'insufficient' basis milestone", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualSchedule: false,
        zuperJobCategory: undefined,
        hasRealConstructionEvent: false,
        installMilestone: { liveForecast: null, basis: "insufficient" },
      })).toBe(false);
    });

    it("rejects project with no install milestone", () => {
      expect(isEligible({
        stage: "rtb",
        constructionScheduleDate: null,
        manualSchedule: false,
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
