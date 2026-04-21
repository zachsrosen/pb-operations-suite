import { computeRetail } from "@/lib/estimator/pricing";

const DEFAULT_ADD_ON_PRICING = { evCharger: 1800, panelUpgrade: 3500 };

describe("pricing.computeRetail", () => {
  it("computes base system price with no add-ons", () => {
    const r = computeRetail({
      finalKwDc: 8.8,
      pricePerWatt: 3.0,
      addOns: { evCharger: false, panelUpgrade: false },
      addOnPricing: DEFAULT_ADD_ON_PRICING,
    });
    expect(r.baseSystemUsd).toBeCloseTo(26400, 5);
    expect(r.addOnsUsd).toBe(0);
    expect(r.retailUsd).toBeCloseTo(26400, 5);
  });

  it("includes EV charger add-on", () => {
    const r = computeRetail({
      finalKwDc: 8.8,
      pricePerWatt: 3.0,
      addOns: { evCharger: true, panelUpgrade: false },
      addOnPricing: DEFAULT_ADD_ON_PRICING,
    });
    expect(r.addOnsUsd).toBe(1800);
    expect(r.retailUsd).toBeCloseTo(28200, 5);
  });

  it("includes panel upgrade add-on", () => {
    const r = computeRetail({
      finalKwDc: 8.8,
      pricePerWatt: 3.0,
      addOns: { evCharger: false, panelUpgrade: true },
      addOnPricing: DEFAULT_ADD_ON_PRICING,
    });
    expect(r.addOnsUsd).toBe(3500);
    expect(r.retailUsd).toBeCloseTo(29900, 5);
  });

  it("includes both add-ons when both selected", () => {
    const r = computeRetail({
      finalKwDc: 8.8,
      pricePerWatt: 3.0,
      addOns: { evCharger: true, panelUpgrade: true },
      addOnPricing: DEFAULT_ADD_ON_PRICING,
    });
    expect(r.addOnsUsd).toBe(5300);
    expect(r.retailUsd).toBeCloseTo(31700, 5);
  });
});
