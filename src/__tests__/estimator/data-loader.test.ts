import {
  loadAllUtilities,
  loadUtilityById,
  loadUtilitiesForState,
  loadUtilityForZip,
  loadPricing,
  effectiveKwhPerKwYear,
} from "@/lib/estimator/data-loader";

describe("data-loader / utilities", () => {
  it("loads all 33 ported utilities", () => {
    const all = loadAllUtilities();
    expect(all.length).toBe(33);
  });

  it("filters by state", () => {
    const co = loadUtilitiesForState("CO");
    expect(co.length).toBeGreaterThan(0);
    expect(co.every((u) => u.state === "CO")).toBe(true);
    const ca = loadUtilitiesForState("CA");
    expect(ca.length).toBeGreaterThan(0);
    expect(ca.every((u) => u.state === "CA")).toBe(true);
  });

  it("prioritizes zip-matching utilities first", () => {
    const utilities = loadUtilitiesForState("CO", "80918");
    expect(utilities[0].id).toBe("2427"); // CSU
  });

  it("de-prioritizes 'Other' fallback utility", () => {
    const list = loadUtilitiesForState("CO");
    expect(list[list.length - 1].name).toBe("Other");
  });

  it("loads by id", () => {
    expect(loadUtilityById("2460")?.name).toBe("Xcel Energy");
    expect(loadUtilityById("2468")?.name).toBe("PG&E");
    expect(loadUtilityById("doesnotexist")).toBeNull();
  });

  it("finds utility for a specific zip", () => {
    expect(loadUtilityForZip("80202")?.name).toBe("Xcel Energy");
    expect(loadUtilityForZip("80918")?.name).toBe("CSU");
    expect(loadUtilityForZip("93401")?.name).toBe("PG&E");
    expect(loadUtilityForZip("93010")?.name).toBe("SCE");
    expect(loadUtilityForZip("99999")).toBeNull();
  });

  it("PG&E and SCE carry a $3,800 battery rebate", () => {
    expect(loadUtilityById("2468")?.batteryRebate).toBe(3800);
    expect(loadUtilityById("2477")?.batteryRebate).toBe(3800);
  });

  it("Colorado utilities carry a $0 battery rebate", () => {
    expect(loadUtilityById("2460")?.batteryRebate).toBe(0);
  });
});

describe("data-loader / pricing", () => {
  it("loads the ported pricing config", () => {
    const p = loadPricing();
    expect(p.panelOutput).toBe(440);
    expect(p.maxSystemSizeWatts).toBe(30000);
    expect(p.base).toBe(3700);
    expect(p.perPanel).toBe(1020);
    expect(p.discountMultiplier).toBe(0.7);
    expect(p.apr).toBe(0.07);
    expect(p.termMonths).toBe(300);
  });
});

describe("data-loader / effectiveKwhPerKwYear", () => {
  it("multiplies factor × multiplier", () => {
    expect(effectiveKwhPerKwYear({ annualProductionFactor: 1300, productionMultiplier: 0.78 })).toBe(1014);
    expect(effectiveKwhPerKwYear({ annualProductionFactor: 1500, productionMultiplier: 0.85 })).toBeCloseTo(1275, 5);
  });
});
