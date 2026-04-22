import { computePricing } from "@/lib/estimator/pricing";
import type { PricingConfig } from "@/lib/estimator/types";

const PRICING: PricingConfig = {
  panelOutput: 440,
  maxSystemSizeWatts: 30000,
  base: 3700,
  perPanel: 1020,
  panelUpgrade: 4200,
  evWallConnector: 650,
  evInstall: 1600,
  battery: 13500,
  expansion: 9500,
  additionalConduit: 30,
  discountMultiplier: 0.7,
  apr: 0.07,
  termMonths: 300,
};

const NO_REBATE = { batteryRebate: 0 };

describe("pricing.computePricing — base + perPanel model", () => {
  it("computes base system with 20 panels and no add-ons", () => {
    const r = computePricing({
      panelCount: 20,
      addOns: { evCharger: false, panelUpgrade: false },
      pricing: PRICING,
      utility: NO_REBATE,
    });
    expect(r.retailUsd).toBe(24100);
    expect(r.addOnsUsd).toBe(0);
    expect(r.finalUsd).toBeCloseTo(16870, 2);
    expect(r.discountUsd).toBeCloseTo(7230, 2);
  });

  it("includes EV charger (wall connector + install)", () => {
    const r = computePricing({
      panelCount: 20,
      addOns: { evCharger: true, panelUpgrade: false },
      pricing: PRICING,
      utility: NO_REBATE,
    });
    expect(r.addOnsUsd).toBe(2250);
    expect(r.retailUsd).toBe(26350);
    expect(r.finalUsd).toBeCloseTo(18445, 2);
  });

  it("includes panel upgrade", () => {
    const r = computePricing({
      panelCount: 20,
      addOns: { evCharger: false, panelUpgrade: true },
      pricing: PRICING,
      utility: NO_REBATE,
    });
    expect(r.addOnsUsd).toBe(4200);
    expect(r.finalUsd).toBeCloseTo(19810, 2);
  });

  it("applies CA battery rebate when battery is included", () => {
    const r = computePricing({
      panelCount: 20,
      addOns: { evCharger: false, panelUpgrade: false },
      pricing: PRICING,
      utility: { batteryRebate: 3800 },
      includeBattery: true,
    });
    expect(r.retailUsd).toBe(37600);
    expect(r.batteryRebateUsd).toBe(3800);
    expect(r.finalUsd).toBeCloseTo(22520, 2);
  });

  it("skips battery rebate when battery is not included", () => {
    const r = computePricing({
      panelCount: 20,
      addOns: { evCharger: false, panelUpgrade: false },
      pricing: PRICING,
      utility: { batteryRebate: 3800 },
      includeBattery: false,
    });
    expect(r.batteryRebateUsd).toBe(0);
  });
});
