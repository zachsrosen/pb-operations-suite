import { runEstimator } from "@/lib/estimator/engine";
import { loadPricing, loadUtilityById } from "@/lib/estimator/data-loader";
import type { EstimatorInput } from "@/lib/estimator/types";

function denverInput(overrides: Partial<EstimatorInput> = {}): EstimatorInput {
  const xcel = loadUtilityById("2460")!;
  return {
    quoteType: "new_install",
    address: { street: "123 Main", city: "Denver", state: "CO", zip: "80202" },
    location: "DTC",
    utility: xcel,
    usage: { kind: "kwh", avgMonthlyKwh: 1000 },
    home: { roofType: "asphalt_shingle", heatPump: false },
    considerations: {
      planningEv: false,
      planningHotTub: false,
      needsPanelUpgrade: false,
      mayNeedNewRoof: false,
    },
    addOns: { evCharger: false, panelUpgrade: false },
    pricing: loadPricing(),
    ...overrides,
  };
}

describe("engine.runEstimator — Denver / Xcel baseline", () => {
  const result = runEstimator(denverInput());

  it("sizes the system with utility-specific effective production", () => {
    // effective = 1300×0.78 = 1014; 12000/1014 = 11.834; ceil(11834/440) = 27
    expect(result.panelCount).toBe(27);
    expect(result.systemKwDc).toBeCloseTo(11.88, 2);
    expect(result.annualProductionKwh).toBeCloseTo(11.88 * 1014, 1);
    expect(result.offsetPercent).toBeCloseTo(100, 1);
  });

  it("retail is base + perPanel × panelCount", () => {
    // 3700 + 27 × 1020 = 31240
    expect(result.pricing.retailUsd).toBeCloseTo(31240, 2);
  });

  it("applies discountMultiplier 0.7 to retail", () => {
    expect(result.pricing.finalUsd).toBeCloseTo(21868, 2);
    expect(result.pricing.discountUsd).toBeCloseTo(31240 - 21868, 2);
  });

  it("financing at 7% / 300mo produces a plausible monthly payment", () => {
    expect(result.pricing.monthlyPaymentUsd).toBeGreaterThan(140);
    expect(result.pricing.monthlyPaymentUsd).toBeLessThan(170);
  });
});

describe("engine.runEstimator — add-ons", () => {
  it("EV charger adds $2,250 to retail", () => {
    const base = runEstimator(denverInput());
    const withEv = runEstimator(
      denverInput({ addOns: { evCharger: true, panelUpgrade: false } }),
    );
    expect(withEv.pricing.retailUsd - base.pricing.retailUsd).toBeCloseTo(2250, 2);
    expect(withEv.pricing.breakdown.lineItems.some((li) => li.label.startsWith("EV"))).toBe(true);
  });

  it("panel upgrade adds $4,200 to retail", () => {
    const base = runEstimator(denverInput());
    const withUpgrade = runEstimator(
      denverInput({ addOns: { evCharger: false, panelUpgrade: true } }),
    );
    expect(withUpgrade.pricing.retailUsd - base.pricing.retailUsd).toBeCloseTo(4200, 2);
  });
});

describe("engine.runEstimator — per-utility production differences", () => {
  it("PG&E territory needs fewer panels than Xcel for identical usage", () => {
    const pge = loadUtilityById("2468")!;
    const denver = runEstimator(denverInput());
    const ca = runEstimator(denverInput({ utility: pge }));
    expect(ca.panelCount).toBeLessThan(denver.panelCount);
  });
});
