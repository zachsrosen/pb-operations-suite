import { amortize } from "@/lib/estimator/financing";

describe("financing.amortize", () => {
  it("returns 0 for zero principal", () => {
    expect(amortize(0, 0.07, 300)).toBe(0);
  });

  it("returns 0 for zero months", () => {
    expect(amortize(10000, 0.07, 0)).toBe(0);
  });

  it("returns principal/months for 0 APR", () => {
    expect(amortize(12000, 0, 24)).toBe(500);
  });

  it("computes a standard amortized payment", () => {
    // $17,540 @ 7% / 300mo ≈ $123.95
    const payment = amortize(17540, 0.07, 300);
    expect(payment).toBeCloseTo(123.95, 1);
  });

  it("higher APR produces higher payment", () => {
    const low = amortize(20000, 0.05, 240);
    const high = amortize(20000, 0.12, 240);
    expect(high).toBeGreaterThan(low);
  });
});
