import { computeAnnualKwh, computeTargetKwh, sizeSystem } from "@/lib/estimator/sizing";

describe("sizing.computeAnnualKwh", () => {
  it("converts monthly bill using utility rate", () => {
    expect(computeAnnualKwh({ kind: "bill", avgMonthlyBillUsd: 140 }, 0.14)).toBeCloseTo(12000, 5);
  });

  it("converts monthly kWh directly", () => {
    expect(computeAnnualKwh({ kind: "kwh", avgMonthlyKwh: 1000 }, 0.14)).toBe(12000);
  });

  it("returns 0 for zero utility rate (prevents div-by-zero)", () => {
    expect(computeAnnualKwh({ kind: "bill", avgMonthlyBillUsd: 100 }, 0)).toBe(0);
  });
});

describe("sizing.computeTargetKwh", () => {
  const none = { planningEv: false, planningHotTub: false, needsPanelUpgrade: false, mayNeedNewRoof: false };

  it("returns baseline when no future load planned", () => {
    expect(computeTargetKwh(10000, none)).toBe(10000);
  });

  it("adds EV load when planning EV", () => {
    expect(computeTargetKwh(10000, { ...none, planningEv: true })).toBe(13500);
  });

  it("adds hot tub load when planning hot tub", () => {
    expect(computeTargetKwh(10000, { ...none, planningHotTub: true })).toBe(12500);
  });

  it("adds both EV and hot tub when both set", () => {
    expect(computeTargetKwh(10000, { ...none, planningEv: true, planningHotTub: true })).toBe(16000);
  });

  it("ignores panel upgrade and new roof (not load-affecting)", () => {
    expect(computeTargetKwh(10000, { ...none, needsPanelUpgrade: true, mayNeedNewRoof: true })).toBe(10000);
  });
});

describe("sizing.sizeSystem", () => {
  it("sizes to meet target within one-panel granularity", () => {
    const result = sizeSystem({ targetKwh: 12000, kWhPerKwYear: 1400, panelWattage: 440 });
    // 12000 / 1400 = 8.571 kW; 8571/440 = 19.48 -> ceil 20 panels
    expect(result.panelCount).toBe(20);
    expect(result.systemKwDc).toBeCloseTo(8.8, 5);
    expect(result.annualProductionKwh).toBeCloseTo(8.8 * 1400, 5);
  });

  it("returns zeros for invalid inputs", () => {
    expect(sizeSystem({ targetKwh: 0, kWhPerKwYear: 1400, panelWattage: 440 })).toEqual({
      panelCount: 0,
      systemKwDc: 0,
      annualProductionKwh: 0,
    });
    expect(sizeSystem({ targetKwh: 12000, kWhPerKwYear: 0, panelWattage: 440 })).toEqual({
      panelCount: 0,
      systemKwDc: 0,
      annualProductionKwh: 0,
    });
  });
});
