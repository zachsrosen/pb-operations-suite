import { resolveAddersFromList } from "@/lib/adders/pricing";
import {
  AdderCategory,
  AdderDirection,
  AdderType,
  AdderUnit,
} from "@/generated/prisma/enums";
import type { AdderWithOverrides } from "@/lib/adders/types";

function makeAdder(overrides: Partial<AdderWithOverrides> = {}): AdderWithOverrides {
  const base: AdderWithOverrides = {
    id: "a1",
    code: "TEST",
    name: "Test Adder",
    category: AdderCategory.ELECTRICAL,
    type: AdderType.FIXED,
    direction: AdderDirection.ADD,
    unit: AdderUnit.FLAT,
    basePrice: 500 as unknown as never,
    baseCost: 0 as unknown as never,
    marginTarget: null,
    autoApply: true,
    appliesTo: null,
    triggerCondition: null,
    triageQuestion: null,
    triageAnswerType: null,
    triggerLogic: null,
    triageChoices: null,
    photosRequired: false,
    notes: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: "u",
    updatedBy: "u",
    overrides: [],
    ...overrides,
  } as unknown as AdderWithOverrides;
  return base;
}

describe("resolveAddersFromList", () => {
  test("skips non-auto-apply adders", () => {
    const adder = makeAdder({ autoApply: false });
    const result = resolveAddersFromList([adder], { shop: "DTC" });
    expect(result).toEqual([]);
  });

  test("includes auto-apply with no appliesTo (unconditional)", () => {
    const adder = makeAdder({ autoApply: true, appliesTo: null });
    const result = resolveAddersFromList([adder], { shop: "DTC" });
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe("TEST");
    expect(result[0].unitPrice).toBe(500);
    expect(result[0].qty).toBe(1);
    expect(result[0].amount).toBe(500);
  });

  test("signs DISCOUNT as negative amount", () => {
    const adder = makeAdder({
      direction: AdderDirection.DISCOUNT,
      basePrice: 1500 as unknown as never,
    });
    const result = resolveAddersFromList([adder], { shop: "DTC" });
    expect(result[0].amount).toBe(-1500);
    expect(result[0].unitPrice).toBe(1500); // unit price stays positive
  });

  test("applies shop override delta", () => {
    const adder = makeAdder({
      overrides: [
        {
          id: "o1",
          adderId: "a1",
          shop: "SLO",
          priceDelta: 150 as unknown as never,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as never,
    });
    expect(resolveAddersFromList([adder], { shop: "SLO" })[0].unitPrice).toBe(650);
    expect(resolveAddersFromList([adder], { shop: "DTC" })[0].unitPrice).toBe(500);
  });

  test("filters by appliesTo expression on shop", () => {
    const a1 = makeAdder({ code: "CA_ONLY", appliesTo: "shop == 'SLO'" });
    const a2 = makeAdder({ code: "CO_ONLY", appliesTo: "shop == 'DTC'" });
    const result = resolveAddersFromList([a1, a2], { shop: "DTC" });
    expect(result.map((r) => r.code)).toEqual(["CO_ONLY"]);
  });

  test("filters by appliesTo on deal.dealType", () => {
    const a1 = makeAdder({ code: "PE_DISC", appliesTo: "deal.dealType == 'PE'" });
    const ctxPE = { shop: "DTC", deal: { dealType: "PE" } };
    const ctxCash = { shop: "DTC", deal: { dealType: "CASH" } };
    expect(resolveAddersFromList([a1], ctxPE)).toHaveLength(1);
    expect(resolveAddersFromList([a1], ctxCash)).toHaveLength(0);
  });

  test("preserves order of input list", () => {
    const a1 = makeAdder({ code: "A" });
    const a2 = makeAdder({ code: "B" });
    const a3 = makeAdder({ code: "C" });
    const result = resolveAddersFromList([a1, a2, a3], { shop: "DTC" });
    expect(result.map((r) => r.code)).toEqual(["A", "B", "C"]);
  });
});

// DB-integration wrapper requires a live database + prisma client. Skip here
// and flag via @db-required convention if we add such a test later.
// @db-required tests for resolveAddersForCalc are tracked as follow-up.
