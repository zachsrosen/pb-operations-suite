import { VALID_SHOPS, resolveShopPrice, isValidShop } from "@/lib/adders/pricing";
import type { AdderWithOverrides } from "@/lib/adders/types";

describe("VALID_SHOPS", () => {
  test("matches CrewMember.location strings", () => {
    expect(VALID_SHOPS).toEqual(["Westminster", "DTC", "Colorado Springs", "SLO", "Camarillo"]);
  });
});

describe("isValidShop", () => {
  test("accepts known shops", () => {
    for (const s of VALID_SHOPS) expect(isValidShop(s)).toBe(true);
  });
  test("rejects unknowns", () => {
    expect(isValidShop("DTCC")).toBe(false);
    expect(isValidShop("")).toBe(false);
  });
});

describe("resolveShopPrice", () => {
  const baseAdder: AdderWithOverrides = {
    id: "a1",
    code: "MPU_200A",
    name: "MPU to 200A",
    // ... minimal fields filled for typechecking
    basePrice: 500 as unknown as never,
    overrides: [],
  } as unknown as AdderWithOverrides;

  test("returns basePrice when no override", () => {
    expect(resolveShopPrice(baseAdder, "DTC")).toBe(500);
  });

  test("applies matching active override", () => {
    const adder = { ...baseAdder, overrides: [
      { id: "o1", adderId: "a1", shop: "SLO", priceDelta: 150 as unknown as never, active: true, createdAt: new Date(), updatedAt: new Date() },
    ] } as AdderWithOverrides;
    expect(resolveShopPrice(adder, "SLO")).toBe(650);
    expect(resolveShopPrice(adder, "DTC")).toBe(500); // no match
  });

  test("ignores inactive overrides", () => {
    const adder = { ...baseAdder, overrides: [
      { id: "o1", adderId: "a1", shop: "SLO", priceDelta: 150 as unknown as never, active: false, createdAt: new Date(), updatedAt: new Date() },
    ] } as AdderWithOverrides;
    expect(resolveShopPrice(adder, "SLO")).toBe(500);
  });

  test("throws on invalid shop", () => {
    expect(() => resolveShopPrice(baseAdder, "Nowhere")).toThrow();
  });
});
