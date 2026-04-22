import { computeAnnualKwh, computeTargetKwh, sizeSystem } from "@/lib/estimator/sizing";

// Xcel-equivalent: factor 1300 × multiplier 0.78 = 1014 effective kWh/kW/yr
const XCEL = { annualProductionFactor: 1300, productionMultiplier: 0.78 };
// PG&E-equivalent: factor 1500 × multiplier 0.85 = 1275
const PGE = { annualProductionFactor: 1500, productionMultiplier: 0.85 };

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
  const none = {
    planningEv: false,
    planningHotTub: false,
    needsPanelUpgrade: false,
    mayNeedNewRoof: false,
  };

  it("returns baseline when no future load planned", () => {
    expect(computeTargetKwh(10000, none)).toBe(10000);
  });

  it("adds EV load when planning EV", () => {
    expect(computeTargetKwh(10000, { ...none, planningEv: true })).toBe(13500);
  });

  it("adds hot tub load when planning hot tub", () => {
    expect(computeTargetKwh(10000, { ...none, planningHotTub: true })).toBe(12500);
  });
});

describe("sizing.sizeSystem — utility-based production", () => {
  it("uses utility factor × multiplier for effective production", () => {
    // PG&E territory, 12000 kWh target, 440W panels, 30 kW cap
    // effective = 1275 → target kW = 12000/1275 = 9.41; panels = ceil(9411/440) = 22
    const r = sizeSystem({
      targetKwh: 12000,
      utility: PGE,
      panelWattage: 440,
      maxSystemSizeWatts: 30000,
    });
    expect(r.panelCount).toBe(22);
    expect(r.systemKwDc).toBeCloseTo(22 * 0.44, 5);
    expect(r.annualProductionKwh).toBeCloseTo(r.systemKwDc * 1275, 5);
  });

  it("Xcel territory sizes larger because of lower effective production", () => {
    const xcelResult = sizeSystem({
      targetKwh: 12000,
      utility: XCEL,
      panelWattage: 440,
      maxSystemSizeWatts: 30000,
    });
    const pgeResult = sizeSystem({
      targetKwh: 12000,
      utility: PGE,
      panelWattage: 440,
      maxSystemSizeWatts: 30000,
    });
    expect(xcelResult.panelCount).toBeGreaterThan(pgeResult.panelCount);
  });

  it("enforces maxSystemSizeWatts cap", () => {
    // Absurd target would need >30kW; should cap at 30000 / 440 = 68 panels
    const r = sizeSystem({
      targetKwh: 1_000_000,
      utility: PGE,
      panelWattage: 440,
      maxSystemSizeWatts: 30000,
    });
    expect(r.panelCount).toBe(Math.floor(30000 / 440));
  });

  it("returns zeros for invalid inputs", () => {
    expect(
      sizeSystem({ targetKwh: 0, utility: PGE, panelWattage: 440, maxSystemSizeWatts: 30000 }),
    ).toEqual({ panelCount: 0, systemKwDc: 0, annualProductionKwh: 0 });
  });
});
