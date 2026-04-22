/**
 * @jest-environment node
 *
 * Unit tests for pure helpers exported by the Adders UI components.
 * The helpers are pure strings/arrays in and out — no DOM needed.
 */
import {
  triggerLogicPreview,
  coerceValueInput,
} from "@/app/dashboards/adders/TriggerLogicBuilder";
import {
  hydrateRows,
  normalizeOverrides,
} from "@/app/dashboards/adders/ShopOverrideGrid";

describe("triggerLogicPreview", () => {
  test("null yields 'null'", () => {
    expect(triggerLogicPreview(null)).toBe("null");
  });

  test("serializes full predicate with constant qty", () => {
    const out = triggerLogicPreview({
      op: "lt",
      value: 200,
      qtyFrom: "constant",
      qtyConstant: 1,
    });
    expect(JSON.parse(out)).toEqual({
      op: "lt",
      value: 200,
      qtyFrom: "constant",
      qtyConstant: 1,
    });
  });

  test("truthy op omits value", () => {
    const out = triggerLogicPreview({ op: "truthy" });
    expect(JSON.parse(out)).toEqual({ op: "truthy" });
  });
});

describe("coerceValueInput", () => {
  test("numeric string coerced to number for NUMERIC type", () => {
    expect(coerceValueInput("150", "NUMERIC")).toBe(150);
  });

  test("non-numeric string falls through for NUMERIC type", () => {
    expect(coerceValueInput("abc", "NUMERIC")).toBe("abc");
  });

  test("boolean type maps 'true'/'false' correctly", () => {
    expect(coerceValueInput("true", "BOOLEAN")).toBe(true);
    expect(coerceValueInput("false", "BOOLEAN")).toBe(false);
  });

  test("text type passes through as string", () => {
    expect(coerceValueInput("tile", "CHOICE")).toBe("tile");
  });

  test("empty string returns empty string", () => {
    expect(coerceValueInput("", "NUMERIC")).toBe("");
  });
});

describe("hydrateRows", () => {
  test("produces one row per VALID_SHOPS, filling missing with defaults", () => {
    const result = hydrateRows([{ shop: "DTC", priceDelta: "50", active: true }]);
    expect(result.map((r) => r.shop)).toEqual([
      "Westminster",
      "DTC",
      "Colorado Springs",
      "SLO",
      "Camarillo",
    ]);
    const dtc = result.find((r) => r.shop === "DTC")!;
    expect(dtc.priceDelta).toBe(50);
    expect(dtc.active).toBe(true);
    const slo = result.find((r) => r.shop === "SLO")!;
    expect(slo.priceDelta).toBe(0);
    expect(slo.active).toBe(false);
  });

  test("coerces numeric string priceDelta to number", () => {
    const result = hydrateRows([{ shop: "SLO", priceDelta: "-25", active: false }]);
    const slo = result.find((r) => r.shop === "SLO")!;
    expect(slo.priceDelta).toBe(-25);
  });
});

describe("normalizeOverrides", () => {
  test("drops rows with delta=0 and active=false", () => {
    const rows = [
      { shop: "DTC", priceDelta: 50, active: true },
      { shop: "SLO", priceDelta: 0, active: false },
      { shop: "Camarillo", priceDelta: -10, active: true },
    ];
    expect(normalizeOverrides(rows)).toEqual([
      { shop: "DTC", priceDelta: 50, active: true },
      { shop: "Camarillo", priceDelta: -10, active: true },
    ]);
  });

  test("keeps active rows even when delta is 0", () => {
    const rows = [{ shop: "DTC", priceDelta: 0, active: true }];
    expect(normalizeOverrides(rows)).toEqual(rows);
  });

  test("keeps inactive rows with non-zero delta (preserves temp-disabled overrides)", () => {
    const rows = [{ shop: "DTC", priceDelta: 50, active: false }];
    expect(normalizeOverrides(rows)).toEqual(rows);
  });
});
