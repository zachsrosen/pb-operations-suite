import { describe, it, expect } from "@jest/globals";

// Mock runtime dependencies pulled in transitively by idr-meeting.ts
jest.mock("@/lib/db", () => ({ prisma: null }));
jest.mock("@/lib/hubspot", () => ({
  hubspotClient: { crm: { deals: { basicApi: {} }, objects: { notes: { basicApi: {} } } } },
  searchWithRetry: jest.fn(),
  resolveHubSpotOwnerContact: jest.fn(),
}));

import { serializeAdderSummary } from "@/lib/idr-meeting";
import { calcPrice, matchLineItemToEquipment, LOCATION_SCHEME } from "@/lib/pricing-calculator";
import { normalizeLocation } from "@/lib/locations";

describe("serializeAdderSummary", () => {
  const base = {
    adderTileRoof: false, adderMetalRoof: false, adderFlatFoamRoof: false,
    adderShakeRoof: false, adderSteepPitch: false, adderTwoStorey: false,
    adderTrenching: false, adderGroundMount: false, adderMpuUpgrade: false,
    adderEvCharger: false, customAdders: [],
  };

  it("returns null when no adders selected", () => {
    expect(serializeAdderSummary(base)).toBeNull();
  });

  it("serializes checkbox adders", () => {
    expect(serializeAdderSummary({ ...base, adderTileRoof: true, adderTrenching: true }))
      .toBe("Tile roof, Trenching");
  });

  it("includes custom adders with amounts", () => {
    expect(serializeAdderSummary({ ...base, customAdders: [{ name: "Tree removal", amount: 800 }] }))
      .toBe("Tree removal ($800)");
  });

  it("combines checkbox and custom adders", () => {
    const result = serializeAdderSummary({
      ...base,
      adderMpuUpgrade: true,
      customAdders: [{ name: "Discount", amount: -500 }],
    });
    expect(result).toBe("MPU/svc upgrade, Discount (-$500)");
  });
});

describe("pricing scheme resolution", () => {
  it("resolves canonical location to scheme", () => {
    const norm = normalizeLocation("Westminster");
    expect(norm).toBe("Westminster");
    expect(LOCATION_SCHEME[norm!]).toBe("base");
  });

  it("resolves alias to scheme", () => {
    const norm = normalizeLocation("westy");
    expect(norm).toBe("Westminster");
    expect(LOCATION_SCHEME[norm!]).toBe("base");
  });

  it("resolves SLO alias", () => {
    const norm = normalizeLocation("slo");
    expect(norm).toBe("San Luis Obispo");
    expect(LOCATION_SCHEME[norm!]).toBe("ventura");
  });

  it("returns null for unknown location", () => {
    expect(normalizeLocation("Mars")).toBeNull();
  });
});

describe("equipment matching", () => {
  it("matches Hyundai 440W module by name", () => {
    const code = matchLineItemToEquipment("Hyundai 440W Black", "", "module", "Hyundai");
    expect(code).toBe("HiN-T440NF(BK)");
  });

  it("matches Tesla Powerwall 3 by name", () => {
    const code = matchLineItemToEquipment("Tesla Powerwall 3", "", "battery", "Tesla");
    expect(code).toBe("Tesla Powerwall 3");
  });

  it("returns null for unrecognized equipment", () => {
    const code = matchLineItemToEquipment("Unknown Widget 9000", "", "other", "AcmeCorp");
    expect(code).toBeNull();
  });
});

describe("calcPrice with IDR-style inputs", () => {
  it("computes a basic solar system", () => {
    const result = calcPrice({
      modules: [{ code: "HiN-T440NF(BK)", qty: 20 }],
      inverters: [{ code: "IQ8MC-72-x-ACM-US", qty: 20 }],
      batteries: [],
      otherEquip: [],
      pricingSchemeId: "base",
      roofTypeId: "comp",
      storeyId: "1",
      pitchId: "none",
      activeAdderIds: [],
      customFixedAdder: 0,
    });

    expect(result.totalWatts).toBe(8800);
    expect(result.cogs).toBeGreaterThan(0);
    expect(result.finalPrice).toBeGreaterThan(result.totalCosts);
    expect(result.markupPct).toBe(40);
  });

  it("tile roof adder increases price", () => {
    const base = {
      modules: [{ code: "HiN-T440NF(BK)", qty: 20 }],
      inverters: [{ code: "IQ8MC-72-x-ACM-US", qty: 20 }],
      batteries: [],
      otherEquip: [],
      pricingSchemeId: "base",
      storeyId: "1",
      pitchId: "none",
      activeAdderIds: [],
      customFixedAdder: 0,
    };
    const noRoof = calcPrice({ ...base, roofTypeId: "comp" });
    const tileRoof = calcPrice({ ...base, roofTypeId: "tile" });
    expect(tileRoof.finalPrice).toBeGreaterThan(noRoof.finalPrice);
    expect(tileRoof.roofAdder).toBeGreaterThan(0);
  });

  it("custom adder adjusts final price", () => {
    const base = {
      modules: [{ code: "HiN-T440NF(BK)", qty: 20 }],
      inverters: [{ code: "IQ8MC-72-x-ACM-US", qty: 20 }],
      batteries: [],
      otherEquip: [],
      pricingSchemeId: "base",
      roofTypeId: "comp",
      storeyId: "1",
      pitchId: "none",
      activeAdderIds: [],
    };
    const noAdder = calcPrice({ ...base, customFixedAdder: 0 });
    const withDiscount = calcPrice({ ...base, customFixedAdder: -500 });
    expect(withDiscount.finalPrice).toBe(noAdder.finalPrice - 500);
  });
});
