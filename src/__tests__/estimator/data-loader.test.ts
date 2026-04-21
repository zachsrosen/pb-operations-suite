import {
  loadUtilitiesForState,
  loadUtilityById,
  loadKwhPerKwYear,
  loadPricePerWatt,
  loadAddOnPricing,
  loadFinancingDefaults,
  loadApplicableIncentives,
} from "@/lib/estimator/data-loader";

describe("data-loader / utilities", () => {
  it("filters utilities by state", () => {
    const utilities = loadUtilitiesForState("CO");
    expect(utilities.length).toBeGreaterThan(0);
    expect(utilities.every((u) => u.states.includes("CO"))).toBe(true);
  });

  it("is case-insensitive on state", () => {
    const upper = loadUtilitiesForState("CO");
    const lower = loadUtilitiesForState("co");
    expect(lower.map((u) => u.id).sort()).toEqual(upper.map((u) => u.id).sort());
  });

  it("prioritizes zip-specific utilities first", () => {
    const utilities = loadUtilitiesForState("CO", "80920");
    expect(utilities[0].id).toBe("colorado_springs_utilities");
  });

  it("loads a utility by id", () => {
    const utility = loadUtilityById("xcel_co");
    expect(utility?.displayName).toBe("Xcel Energy (CO)");
  });

  it("returns null for unknown id", () => {
    expect(loadUtilityById("nope")).toBeNull();
  });
});

describe("data-loader / production", () => {
  it("returns kWh/kW/year for known state + shade", () => {
    expect(loadKwhPerKwYear("CO", "moderate")).toBe(1400);
    expect(loadKwhPerKwYear("CA", "light")).toBe(1600);
  });

  it("falls back for unknown state", () => {
    expect(loadKwhPerKwYear("XX", "moderate")).toBe(1400);
  });
});

describe("data-loader / pricing", () => {
  it("returns $/W per location", () => {
    expect(loadPricePerWatt("DTC")).toBe(3.0);
    expect(loadPricePerWatt("CA")).toBe(3.5);
  });

  it("falls back for unknown location", () => {
    expect(loadPricePerWatt("UNKNOWN")).toBe(3.2);
  });

  it("returns add-on pricing", () => {
    const a = loadAddOnPricing();
    expect(a.evCharger).toBeGreaterThan(0);
    expect(a.panelUpgrade).toBeGreaterThan(0);
  });

  it("returns financing defaults", () => {
    const f = loadFinancingDefaults();
    expect(f.apr).toBe(0.07);
    expect(f.termMonths).toBe(300);
  });
});

describe("data-loader / incentives", () => {
  it("applies federal incentive everywhere", () => {
    const list = loadApplicableIncentives({ state: "CO", zip: "80202", utilityId: "xcel_co" });
    expect(list.some((i) => i.id === "federal_itc_2026")).toBe(true);
  });

  it("applies state incentive only for matching state", () => {
    const coList = loadApplicableIncentives({ state: "CO", zip: "80202", utilityId: "xcel_co" });
    const caList = loadApplicableIncentives({ state: "CA", zip: "94110", utilityId: "pge" });
    expect(coList.some((i) => i.id === "co_state_rebate_2026")).toBe(true);
    expect(caList.some((i) => i.id === "co_state_rebate_2026")).toBe(false);
  });

  it("applies utility incentive only for matching utility", () => {
    const xcelList = loadApplicableIncentives({ state: "CO", zip: "80202", utilityId: "xcel_co" });
    const bhList = loadApplicableIncentives({ state: "CO", zip: "80203", utilityId: "black_hills" });
    expect(xcelList.some((i) => i.id === "xcel_solar_rewards")).toBe(true);
    expect(bhList.some((i) => i.id === "xcel_solar_rewards")).toBe(false);
  });
});
