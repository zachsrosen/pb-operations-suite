import { applyIncentives } from "@/lib/estimator/incentives";
import type { IncentiveRecord } from "@/lib/estimator/types";

const percent30: IncentiveRecord = {
  id: "federal",
  scope: "federal",
  type: "percent",
  value: 0.3,
  label: "Federal ITC",
};

const fixed500: IncentiveRecord = {
  id: "state",
  scope: "state",
  type: "fixed",
  value: 500,
  label: "State rebate",
};

const perWatt5cap2500: IncentiveRecord = {
  id: "xcel",
  scope: "utility",
  type: "perWatt",
  value: 0.05,
  cap: 2500,
  label: "Xcel Solar Rewards",
};

describe("incentives.applyIncentives", () => {
  it("returns empty when no incentives", () => {
    const r = applyIncentives({ incentives: [], retailUsd: 26400, finalKwDc: 8.8 });
    expect(r.applied).toEqual([]);
    expect(r.totalUsd).toBe(0);
  });

  it("applies a percent incentive to retail", () => {
    const r = applyIncentives({ incentives: [percent30], retailUsd: 26400, finalKwDc: 8.8 });
    expect(r.applied[0].amountUsd).toBeCloseTo(7920, 5);
    expect(r.totalUsd).toBeCloseTo(7920, 5);
  });

  it("applies a fixed incentive", () => {
    const r = applyIncentives({ incentives: [fixed500], retailUsd: 26400, finalKwDc: 8.8 });
    expect(r.applied[0].amountUsd).toBe(500);
  });

  it("applies a perWatt incentive without hitting cap", () => {
    // 0.05 * 8800 = 440; cap 2500 not triggered
    const r = applyIncentives({ incentives: [perWatt5cap2500], retailUsd: 26400, finalKwDc: 8.8 });
    expect(r.applied[0].amountUsd).toBeCloseTo(440, 5);
  });

  it("enforces a cap when perWatt amount exceeds it", () => {
    // 0.05 * 60000 = 3000; cap 2500 enforced
    const r = applyIncentives({ incentives: [perWatt5cap2500], retailUsd: 180000, finalKwDc: 60 });
    expect(r.applied[0].amountUsd).toBe(2500);
  });

  it("stacks multiple incentives additively", () => {
    const r = applyIncentives({
      incentives: [percent30, fixed500, perWatt5cap2500],
      retailUsd: 26400,
      finalKwDc: 8.8,
    });
    expect(r.totalUsd).toBeCloseTo(7920 + 500 + 440, 2);
  });
});
