import { evaluateTriggerLogic, recommendAdders } from "@/lib/adders/triage";
import type { AdderWithOverrides } from "@/lib/adders/types";

describe("evaluateTriggerLogic", () => {
  test.each([
    [{ op: "lt", value: 200 }, 150, true],
    [{ op: "lt", value: 200 }, 200, false],
    [{ op: "lte", value: 200 }, 200, true],
    [{ op: "eq", value: "tile" }, "tile", true],
    [{ op: "gte", value: 8 }, 8, true],
    [{ op: "gt", value: 8 }, 8, false],
    [{ op: "contains", value: "MPU" }, "needs MPU", true],
    [{ op: "truthy" }, true, true],
    [{ op: "truthy" }, false, false],
  ])("op %j against %j → %j", (logic, answer, expected) => {
    expect(evaluateTriggerLogic(logic as never, answer)).toBe(expected);
  });

  test("numeric-string answer is coerced to number", () => {
    expect(evaluateTriggerLogic({ op: "lt", value: 200 }, "150")).toBe(true);
  });

  test("null answer returns false (does not throw)", () => {
    expect(evaluateTriggerLogic({ op: "lt", value: 200 }, null)).toBe(false);
  });

  test("undefined answer returns false", () => {
    expect(evaluateTriggerLogic({ op: "truthy" }, undefined)).toBe(false);
  });
});

describe("recommendAdders", () => {
  const mpu: AdderWithOverrides = {
    id: "a1",
    code: "MPU_200A",
    name: "Main Panel Upgrade 200A",
    category: "ELECTRICAL",
    type: "FIXED",
    direction: "ADD",
    unit: "FLAT",
    autoApply: false,
    appliesTo: null,
    triageQuestion: "panel amps?",
    triageAnswerType: "NUMBER",
    triageChoices: null,
    triggerCondition: null,
    triggerLogic: { op: "lt", value: 200, qtyFrom: "constant", qtyConstant: 1 },
    photosRequired: false,
    active: true,
    overrides: [],
    basePrice: 2500,
    baseCost: 1500,
    marginTarget: null,
    notes: null,
  } as unknown as AdderWithOverrides;

  test("returns matching adder with qty from qtyConstant", () => {
    const result = recommendAdders({
      answers: { a1: 150 },
      adders: [mpu],
      shop: "DTC",
    });
    expect(result).toEqual([
      expect.objectContaining({ code: "MPU_200A", qty: 1, unitPrice: 2500 }),
    ]);
  });

  test("qtyFrom=answer uses numeric answer as qty", () => {
    const trench = {
      ...mpu,
      id: "a2",
      code: "TRENCH_LF",
      triggerLogic: { op: "gt", value: 0, qtyFrom: "answer" },
    } as AdderWithOverrides;
    const result = recommendAdders({
      answers: { a2: 75 },
      adders: [trench],
      shop: "DTC",
    });
    expect(result[0].qty).toBe(75);
  });

  test("no match returns empty array", () => {
    const result = recommendAdders({
      answers: { a1: 200 },
      adders: [mpu],
      shop: "DTC",
    });
    expect(result).toEqual([]);
  });

  test("inactive adder skipped", () => {
    const inactive = { ...mpu, active: false } as AdderWithOverrides;
    expect(
      recommendAdders({ answers: { a1: 150 }, adders: [inactive], shop: "DTC" })
    ).toEqual([]);
  });

  test("missing answer for triage-driven adder returns no match", () => {
    const result = recommendAdders({
      answers: {},
      adders: [mpu],
      shop: "DTC",
    });
    expect(result).toEqual([]);
  });

  test("auto-apply adder evaluated via appliesTo, not triggerLogic", () => {
    const pe = {
      ...mpu,
      id: "a3",
      code: "PE_30",
      autoApply: true,
      appliesTo: "deal.dealType == 'PE'",
      triggerLogic: null,
      direction: "DISCOUNT",
      basePrice: 30,
      type: "PERCENTAGE",
    } as AdderWithOverrides;
    const result = recommendAdders({
      answers: {},
      adders: [pe],
      shop: "DTC",
      dealContext: { dealType: "PE" },
    });
    expect(result.map((r) => r.code)).toContain("PE_30");
  });

  test("auto-apply adder whose appliesTo fails is skipped", () => {
    const pe = {
      ...mpu,
      id: "a3",
      code: "PE_30",
      autoApply: true,
      appliesTo: "deal.dealType == 'PE'",
      triggerLogic: null,
    } as AdderWithOverrides;
    const result = recommendAdders({
      answers: {},
      adders: [pe],
      shop: "DTC",
      dealContext: { dealType: "STANDARD" },
    });
    expect(result).toEqual([]);
  });

  test("DISCOUNT direction produces negative amount", () => {
    const discount = {
      ...mpu,
      id: "a4",
      code: "DISC_10",
      autoApply: true,
      appliesTo: null,
      direction: "DISCOUNT",
      triggerLogic: null,
      basePrice: 100,
    } as AdderWithOverrides;
    const result = recommendAdders({
      answers: {},
      adders: [discount],
      shop: "DTC",
    });
    expect(result[0].amount).toBeLessThan(0);
    expect(result[0].unitPrice).toBe(100); // unit price stays positive
  });

  test("shop override is applied to unitPrice", () => {
    const withOverride = {
      ...mpu,
      overrides: [
        { shop: "DTC", priceDelta: 500, active: true },
      ],
    } as unknown as AdderWithOverrides;
    const result = recommendAdders({
      answers: { a1: 150 },
      adders: [withOverride],
      shop: "DTC",
    });
    expect(result[0].unitPrice).toBe(3000);
  });
});
