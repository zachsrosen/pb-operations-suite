import {
  REVENUE_GROUPS,
  getClosedMonthCount,
  computeEffectiveTargets,
  computePaceStatus,
  aggregateRevenue,
  type DealLike,
  type RevenueGroupConfig,
  type PaceStatus,
} from "@/lib/revenue-groups-config";

// ---------------------------------------------------------------------------
// REVENUE_GROUPS configuration
// ---------------------------------------------------------------------------
describe("REVENUE_GROUPS", () => {
  it("has exactly 6 groups", () => {
    expect(Object.keys(REVENUE_GROUPS)).toHaveLength(6);
  });

  it("has unique keys", () => {
    const keys = Object.keys(REVENUE_GROUPS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("sums annual targets to $52.5M", () => {
    const total = Object.values(REVENUE_GROUPS).reduce(
      (sum, g) => sum + g.annualTarget,
      0
    );
    expect(total).toBe(52_500_000);
  });

  it("dtc group filters on Centennial location", () => {
    const dtc = REVENUE_GROUPS.dtc;
    expect(dtc).toBeDefined();
    expect(dtc.locationFilter).toContain("Centennial");
  });

  it("california group filters on SLO + Camarillo", () => {
    const ca = REVENUE_GROUPS.california;
    expect(ca).toBeDefined();
    expect(ca.locationFilter).toEqual(
      expect.arrayContaining(["San Luis Obispo", "Camarillo"])
    );
    expect(ca.locationFilter).toHaveLength(2);
  });

  it("roofing_dnr has multi-strategy recognition", () => {
    const rd = REVENUE_GROUPS.roofing_dnr;
    expect(rd).toBeDefined();
    expect(rd.recognition).toHaveLength(2);
    // D&R should be first with 50/50 split
    const dnrStrat = rd.recognition.find((r) => r.pipelineId === "21997330");
    expect(dnrStrat).toBeDefined();
    expect(dnrStrat!.strategy).toBe("split");
    // Roofing should be gated
    const roofStrat = rd.recognition.find((r) => r.pipelineId === "765928545");
    expect(roofStrat).toBeDefined();
    expect(roofStrat!.strategy).toBe("gated");
  });

  it("service group uses gated strategy", () => {
    const svc = REVENUE_GROUPS.service;
    expect(svc).toBeDefined();
    expect(svc.recognition).toHaveLength(1);
    expect(svc.recognition[0].strategy).toBe("gated");
  });
});

// ---------------------------------------------------------------------------
// getClosedMonthCount
// ---------------------------------------------------------------------------
describe("getClosedMonthCount", () => {
  it("returns 0 for January", () => {
    // Jan 15 of 2026 — no months have closed yet
    const now = new Date("2026-01-15T12:00:00Z");
    expect(getClosedMonthCount(now)).toBe(0);
  });

  it("returns 2 for March (Jan + Feb are closed)", () => {
    const now = new Date("2026-03-10T12:00:00Z");
    expect(getClosedMonthCount(now)).toBe(2);
  });

  it("returns 11 for December", () => {
    const now = new Date("2026-12-01T12:00:00Z");
    expect(getClosedMonthCount(now)).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// computeEffectiveTargets
// ---------------------------------------------------------------------------
describe("computeEffectiveTargets", () => {
  const baseMonthly = 1_000_000; // $1M/month, $12M annual
  const baseTargets = Array(12).fill(baseMonthly);

  it("returns base targets when no months are closed (no shortfall)", () => {
    const actuals = Array(12).fill(0);
    const result = computeEffectiveTargets(baseTargets, actuals, 0);
    expect(result).toEqual(baseTargets);
  });

  it("redistributes shortfall from closed months to remaining months", () => {
    // 2 months closed, each with $800k actual vs $1M target = $200k shortfall each
    const actuals = [800_000, 800_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const result = computeEffectiveTargets(baseTargets, actuals, 2);

    // Months 0-1 frozen at base ($1M each)
    expect(result[0]).toBe(1_000_000);
    expect(result[1]).toBe(1_000_000);

    // Total shortfall = $400k, spread across 10 remaining months = $40k each
    const remaining = result.slice(2);
    remaining.forEach((t) => {
      expect(t).toBe(1_040_000);
    });
  });

  it("reduces remaining targets when ahead of pace (surplus)", () => {
    // 2 months closed, each with $1.2M actual vs $1M target = $200k surplus each
    const actuals = [1_200_000, 1_200_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const result = computeEffectiveTargets(baseTargets, actuals, 2);

    // Months 0-1 frozen at base
    expect(result[0]).toBe(1_000_000);
    expect(result[1]).toBe(1_000_000);

    // Surplus = $400k, spread across 10 remaining = -$40k each
    const remaining = result.slice(2);
    remaining.forEach((t) => {
      expect(t).toBe(960_000);
    });
  });

  it("returns base targets when all 12 months are closed", () => {
    const actuals = Array(12).fill(900_000);
    const result = computeEffectiveTargets(baseTargets, actuals, 12);
    // All frozen at base — no remaining months to redistribute
    expect(result).toEqual(baseTargets);
  });
});

// ---------------------------------------------------------------------------
// computePaceStatus
// ---------------------------------------------------------------------------
describe("computePaceStatus", () => {
  it("returns ahead when actual > 105% of expected", () => {
    // Expected $500k through this period, actual $600k = 120%
    const result = computePaceStatus(600_000, 500_000);
    expect(result).toBe("ahead");
  });

  it("returns on_pace when actual is 95-105% of expected", () => {
    const result = computePaceStatus(500_000, 500_000);
    expect(result).toBe("on_pace");

    // 98% -> still on_pace
    expect(computePaceStatus(490_000, 500_000)).toBe("on_pace");
    // 104% -> still on_pace
    expect(computePaceStatus(520_000, 500_000)).toBe("on_pace");
  });

  it("returns behind when actual < 95% of expected", () => {
    const result = computePaceStatus(400_000, 500_000);
    expect(result).toBe("behind");
  });

  it("returns on_pace when both actual and expected are zero", () => {
    const result = computePaceStatus(0, 0);
    expect(result).toBe("on_pace");
  });

  it("straight-line pace uses closedMonths/12 * annualTarget (not redistributed targets)", () => {
    // On March 18, closedMonths = 2 (Jan+Feb closed)
    // For a $12M annual target, expected pace = (2/12) * 12M = $2M
    const closedMonths = getClosedMonthCount(new Date(2026, 2, 18)); // March 18
    expect(closedMonths).toBe(2);
    const annualTarget = 12_000_000;
    const expectedPace = (closedMonths / 12) * annualTarget;
    expect(expectedPace).toBe(2_000_000);

    // Actual = $2.2M → ahead (110% of $2M, > 105% threshold)
    expect(computePaceStatus(2_200_000, expectedPace)).toBe("ahead");
    // Actual = $1.9M → on_pace (95-105% of $2M)
    expect(computePaceStatus(1_900_000, expectedPace)).toBe("on_pace");
    // Actual = $1.8M → behind (< 95% of $2M)
    expect(computePaceStatus(1_800_000, expectedPace)).toBe("behind");
  });
});

// ---------------------------------------------------------------------------
// aggregateRevenue
// ---------------------------------------------------------------------------
describe("aggregateRevenue", () => {
  const groups = REVENUE_GROUPS;

  function makeDeal(overrides: Partial<DealLike>): DealLike {
    return {
      hs_object_id: "1",
      dealname: "Test Deal",
      amount: "100000",
      pipeline: "6900017",
      dealstage: "20440343", // Project Complete
      pb_location: "Westminster",
      construction_complete_date: "2026-02-15",
      ...overrides,
    };
  }

  it("routes project pipeline deals to correct location group", () => {
    const deals: DealLike[] = [
      makeDeal({
        hs_object_id: "1",
        pb_location: "Westminster",
        amount: "100000",
        construction_complete_date: "2026-02-15",
      }),
      makeDeal({
        hs_object_id: "2",
        pb_location: "Centennial",
        amount: "200000",
        construction_complete_date: "2026-03-10",
      }),
      makeDeal({
        hs_object_id: "3",
        pb_location: "Colorado Springs",
        amount: "150000",
        construction_complete_date: "2026-01-20",
      }),
      makeDeal({
        hs_object_id: "4",
        pb_location: "San Luis Obispo",
        amount: "175000",
        construction_complete_date: "2026-04-05",
      }),
    ];

    const result = aggregateRevenue(deals, groups, 2026);

    // Westminster deal → westminster group, Feb
    expect(result.westminster.monthlyActuals[1]).toBe(100_000);
    // Centennial deal → dtc group, Mar
    expect(result.dtc.monthlyActuals[2]).toBe(200_000);
    // CO Springs deal → colorado_springs group, Jan
    expect(result.colorado_springs.monthlyActuals[0]).toBe(150_000);
    // SLO deal → california group, Apr
    expect(result.california.monthlyActuals[3]).toBe(175_000);
  });

  it("splits D&R deal revenue 50/50 between detach and reset months", () => {
    const deals: DealLike[] = [
      makeDeal({
        hs_object_id: "10",
        pipeline: "21997330", // D&R
        amount: "100000",
        pb_location: "Westminster",
        construction_complete_date: undefined,
        detach_completion_date: "2026-02-10",
        reset_completion_date: "2026-04-15",
      }),
    ];

    const result = aggregateRevenue(deals, groups, 2026);

    // $50k recognized in Feb (detach), $50k in Apr (reset)
    expect(result.roofing_dnr.monthlyActuals[1]).toBe(50_000);
    expect(result.roofing_dnr.monthlyActuals[3]).toBe(50_000);
  });

  it("excludes cancelled deals", () => {
    const deals: DealLike[] = [
      makeDeal({
        hs_object_id: "20",
        dealstage: "68229433", // Cancelled in project pipeline
        amount: "500000",
        construction_complete_date: "2026-03-01",
      }),
    ];

    const result = aggregateRevenue(deals, groups, 2026);
    expect(result.westminster.monthlyActuals[2]).toBe(0);
  });

  it("ignores deals with no recognition date", () => {
    const deals: DealLike[] = [
      makeDeal({
        hs_object_id: "30",
        amount: "500000",
        construction_complete_date: undefined,
      }),
    ];

    const result = aggregateRevenue(deals, groups, 2026);
    // All months should be 0
    expect(result.westminster.monthlyActuals.every((v) => v === 0)).toBe(true);
  });

  it("accumulates multiple deals in the same month", () => {
    const deals: DealLike[] = [
      makeDeal({
        hs_object_id: "40",
        amount: "100000",
        construction_complete_date: "2026-03-05",
      }),
      makeDeal({
        hs_object_id: "41",
        amount: "200000",
        construction_complete_date: "2026-03-20",
      }),
    ];

    const result = aggregateRevenue(deals, groups, 2026);
    expect(result.westminster.monthlyActuals[2]).toBe(300_000);
  });

  it("gated strategies produce $0 actuals (discovery-gated groups)", () => {
    // Service pipeline deal with a closedate — should NOT be counted
    // because service uses strategy: "gated"
    const deals: DealLike[] = [
      makeDeal({
        hs_object_id: "50",
        pipeline: "23928924", // Service pipeline
        amount: "50000",
        closedate: "2026-02-15",
        construction_complete_date: undefined,
        pb_location: undefined,
      }),
    ];

    const result = aggregateRevenue(deals, groups, 2026);
    // Service group should have $0 — gated strategy skips revenue
    expect(result.service.monthlyActuals.every((v) => v === 0)).toBe(true);
  });

  it("roofing pipeline deals produce $0 actuals (gated within roofing_dnr)", () => {
    // Roofing pipeline deal — should NOT be counted because roofing uses gated strategy
    const deals: DealLike[] = [
      makeDeal({
        hs_object_id: "51",
        pipeline: "765928545", // Roofing pipeline
        amount: "75000",
        closedate: "2026-03-10",
        construction_complete_date: undefined,
        pb_location: undefined,
      }),
    ];

    const result = aggregateRevenue(deals, groups, 2026);
    expect(result.roofing_dnr.monthlyActuals.every((v) => v === 0)).toBe(true);
  });
});
