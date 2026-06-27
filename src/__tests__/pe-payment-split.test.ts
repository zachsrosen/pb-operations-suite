import { computePeSplit, currencyStr, currencyPropStr } from "@/lib/pe-payment-split";
import { PE_LEASE, calcLeaseFactorAdjustment } from "@/lib/pricing-calculator";

describe("computePeSplit", () => {
  it("returns null payment fields when amount is missing or non-positive", () => {
    const split = computePeSplit({ project_type: "solar", postal_code: "80027" });
    expect(split.epcPrice).toBeNull();
    expect(split.ic).toBeNull();
    expect(split.pc).toBeNull();
    expect(split.customerPays).toBeNull();
    expect(split.totalPbRevenue).toBeNull();
    // Non-payment fields still derived
    expect(split.systemType).toBe("solar");

    expect(computePeSplit({ amount: "0", project_type: "solar" }).ic).toBeNull();
  });

  it("computes the solar (no-DC, non-energy-community) split correctly", () => {
    const amount = 10000;
    // Module brands list is empty by design, so solarDC is false; zip 00000 is not an EC zip.
    const split = computePeSplit({ amount: String(amount), project_type: "solar", postal_code: "00000" });

    const expectedLease = PE_LEASE.baselineFactor + calcLeaseFactorAdjustment("solar", false, false, false);
    const expectedTotal = amount - amount / expectedLease;

    expect(split.systemType).toBe("solar");
    expect(split.solarDC).toBe(false);
    expect(split.energyCommunity).toBe(false);
    expect(split.leaseFactor).toBeCloseTo(expectedLease, 6);
    expect(split.customerPays).toBeCloseTo(amount * 0.7, 6);
    expect(split.pePaymentTotal).toBeCloseTo(expectedTotal, 4);
    expect(split.ic).toBeCloseTo(expectedTotal * (2 / 3), 4);
    expect(split.pc).toBeCloseTo(expectedTotal * (1 / 3), 4);
    // M1 + M2 reconstruct the total; total revenue = customer + PE total
    expect(split.ic! + split.pc!).toBeCloseTo(split.pePaymentTotal!, 6);
    expect(split.totalPbRevenue).toBeCloseTo(split.customerPays! + split.pePaymentTotal!, 6);
  });

  it("classifies system type from project_type and battery_count", () => {
    expect(computePeSplit({ amount: "1", project_type: "Solar + Battery" }).systemType).toBe("solar+battery");
    // project_type "Battery" with no battery count → treated as solar+battery
    expect(computePeSplit({ amount: "1", project_type: "Battery" }).systemType).toBe("solar+battery");
    // battery_count > 0 with no project_type → battery-only
    expect(computePeSplit({ amount: "1", battery_count: "2" }).systemType).toBe("battery");
    expect(computePeSplit({ amount: "1", project_type: "Solar" }).systemType).toBe("solar");
  });
});

describe("currency helpers", () => {
  it("currencyStr serialises to 2dp or null", () => {
    expect(currencyStr(1234.5)).toBe("1234.50");
    expect(currencyStr(null)).toBeNull();
  });

  it("currencyPropStr normalises stored values to 2dp strings", () => {
    expect(currencyPropStr("1234.5")).toBe("1234.50");
    expect(currencyPropStr(1234.5)).toBe("1234.50");
    expect(currencyPropStr("")).toBeNull();
    expect(currencyPropStr(null)).toBeNull();
    expect(currencyPropStr(undefined)).toBeNull();
    expect(currencyPropStr("not-a-number")).toBeNull();
  });
});
