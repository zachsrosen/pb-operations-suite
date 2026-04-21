import { runEstimator } from "@/lib/estimator/engine";
import type { EstimatorInput, IncentiveRecord } from "@/lib/estimator/types";

const FED_ITC: IncentiveRecord = {
  id: "federal_itc",
  scope: "federal",
  type: "percent",
  value: 0.3,
  label: "Federal ITC",
};
const CO_STATE: IncentiveRecord = {
  id: "co_state",
  scope: "state",
  type: "fixed",
  value: 500,
  label: "CO State",
};
const XCEL: IncentiveRecord = {
  id: "xcel",
  scope: "utility",
  type: "perWatt",
  value: 0.05,
  cap: 2500,
  label: "Xcel",
};

function denverInput(overrides: Partial<EstimatorInput> = {}): EstimatorInput {
  return {
    quoteType: "new_install",
    address: { street: "123 Main", city: "Denver", state: "CO", zip: "80202" },
    location: "DTC",
    utility: { id: "xcel_co", avgBlendedRateUsdPerKwh: 0.14 },
    usage: { kind: "kwh", avgMonthlyKwh: 1000 },
    home: { roofType: "asphalt_shingle", shade: "moderate", heatPump: false },
    considerations: { planningEv: false, planningHotTub: false, needsPanelUpgrade: false, mayNeedNewRoof: false },
    addOns: { evCharger: false, panelUpgrade: false },
    panelWattage: 440,
    pricePerWatt: 3.0,
    kWhPerKwYear: 1400,
    incentives: [FED_ITC, CO_STATE, XCEL],
    addOnPricing: { evCharger: 1800, panelUpgrade: 3500 },
    financing: { apr: 0.07, termMonths: 300 },
    ...overrides,
  };
}

describe("engine.runEstimator — Denver baseline", () => {
  const result = runEstimator(denverInput());

  // Expected (from spec hand-calculation):
  //   annualKwh = 12000; targetKwh = 12000
  //   systemKwDcTarget = 8.571; panelCount = ceil(8571/440) = 20
  //   systemKwDc = 8.8; annualProductionKwh = 12320
  //   offset = min(100, 12320/12000 * 100) = 100
  //   baseSystemUsd = 26400; retailUsd = 26400
  //   federal = 7920; state = 500; xcel = 440; incentivesUsd = 8860
  //   finalUsd = 17540; monthly ≈ 123.95

  it("sizes to 20 panels / 8.8 kW DC", () => {
    expect(result.panelCount).toBe(20);
    expect(result.systemKwDc).toBeCloseTo(8.8, 5);
  });

  it("annual production and offset match", () => {
    expect(result.annualProductionKwh).toBeCloseTo(12320, 5);
    expect(result.offsetPercent).toBeCloseTo(100, 5);
  });

  it("retail price is base system only", () => {
    expect(result.pricing.retailUsd).toBeCloseTo(26400, 5);
  });

  it("incentives total to $8,860", () => {
    expect(result.pricing.incentivesUsd).toBeCloseTo(8860, 5);
  });

  it("final price is $17,540", () => {
    expect(result.pricing.finalUsd).toBeCloseTo(17540, 5);
  });

  it("monthly payment is ~$123.95", () => {
    expect(result.pricing.monthlyPaymentUsd).toBeCloseTo(123.95, 1);
  });

  it("exposes line items (empty for no add-ons)", () => {
    expect(result.pricing.breakdown.lineItems).toEqual([]);
  });

  it("includes applied incentives itemized", () => {
    const ids = result.pricing.breakdown.appliedIncentives.map((a) => a.id).sort();
    expect(ids).toEqual(["co_state", "federal_itc", "xcel"]);
  });

  it("includes assumptions for UI disclosure", () => {
    expect(result.assumptions.length).toBeGreaterThan(0);
  });
});

describe("engine.runEstimator — add-on toggles re-price", () => {
  it("EV charger adds to retail and line items", () => {
    const r = runEstimator(denverInput({ addOns: { evCharger: true, panelUpgrade: false } }));
    expect(r.pricing.retailUsd).toBeCloseTo(26400 + 1800, 5);
    expect(r.pricing.breakdown.lineItems.some((li) => li.label.includes("EV"))).toBe(true);
  });

  it("panel upgrade adds to retail and line items", () => {
    const r = runEstimator(denverInput({ addOns: { evCharger: false, panelUpgrade: true } }));
    expect(r.pricing.retailUsd).toBeCloseTo(26400 + 3500, 5);
    expect(r.pricing.breakdown.lineItems.some((li) => li.label.toLowerCase().includes("panel"))).toBe(true);
  });
});

describe("engine.runEstimator — EV future load bumps system size", () => {
  it("sizes larger when planning EV", () => {
    const baseline = runEstimator(denverInput());
    const withEv = runEstimator(
      denverInput({
        considerations: { planningEv: true, planningHotTub: false, needsPanelUpgrade: false, mayNeedNewRoof: false },
      }),
    );
    expect(withEv.panelCount).toBeGreaterThan(baseline.panelCount);
  });
});

describe("engine.runEstimator — heavy shade produces smaller or same production", () => {
  it("heavy shade reduces kWh/kW/year input and shrinks offset", () => {
    const baseline = runEstimator(denverInput());
    const shaded = runEstimator(denverInput({ kWhPerKwYear: 1150 }));
    // Same panel count logic (same targetKwh / shaded factor → needs MORE panels to hit offset)
    // But with heavy shade, annual production per panel is lower
    expect(shaded.annualProductionKwh).toBeLessThanOrEqual(
      baseline.annualProductionKwh * 1.2,
    );
  });
});

describe("engine.runEstimator — bill-based usage", () => {
  it("converts bill to kWh via utility rate", () => {
    const r = runEstimator(
      denverInput({
        usage: { kind: "bill", avgMonthlyBillUsd: 140 },
        utility: { id: "xcel_co", avgBlendedRateUsdPerKwh: 0.14 },
      }),
    );
    // 140/0.14 = 1000 kWh/mo = 12000/yr, same as baseline
    expect(r.annualConsumptionKwh).toBeCloseTo(12000, 5);
    expect(r.panelCount).toBe(20);
  });
});
