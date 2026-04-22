import { parseAppliesTo, evaluateAppliesTo } from "@/lib/adders/applies-to";

describe("parseAppliesTo", () => {
  test.each([
    ["shop == 'DTC'", { lhs: "shop", op: "==", rhs: "DTC" }],
    ["deal.valueCents > 1000000", { lhs: "deal.valueCents", op: ">", rhs: 1_000_000 }],
    ["shop in ['SLO','Camarillo']", { lhs: "shop", op: "in", rhs: ["SLO", "Camarillo"] }],
    ["deal.dealType != 'PE'", { lhs: "deal.dealType", op: "!=", rhs: "PE" }],
    ["now < '2026-04-01'", { lhs: "now", op: "<", rhs: new Date("2026-04-01") }],
    // Bug 1: "not in" must be parsed correctly (not split as "in" with LHS "shop not")
    ["shop not in ['SLO','Camarillo']", { lhs: "shop", op: "not in", rhs: ["SLO", "Camarillo"] }],
    // Bug 2: empty list must parse to [] not [""]
    ["shop in []", { lhs: "shop", op: "in", rhs: [] }],
  ])("parses %s", (input, expected) => {
    expect(parseAppliesTo(input)).toEqual(expected);
  });

  test.each([
    "shop == 'DTC' && shop == 'WESTY'", // boolean combinator banned
    "shop === 'DTC'",                    // invalid op
    "unknown.field == 1",                // unknown identifier
    "'DTC' == shop",                     // LHS must be identifier
    "",                                  // empty
  ])("rejects invalid input: %s", (input) => {
    expect(() => parseAppliesTo(input)).toThrow();
  });
});

describe("evaluateAppliesTo", () => {
  test("shop == literal matches", () => {
    expect(evaluateAppliesTo("shop == 'DTC'", { shop: "DTC" })).toBe(true);
    expect(evaluateAppliesTo("shop == 'DTC'", { shop: "SLO" })).toBe(false);
  });

  test("shop in list matches any member", () => {
    expect(evaluateAppliesTo("shop in ['SLO','Camarillo']", { shop: "SLO" })).toBe(true);
    expect(evaluateAppliesTo("shop in ['SLO','Camarillo']", { shop: "DTC" })).toBe(false);
  });

  test("deal.valueCents numeric comparison", () => {
    expect(evaluateAppliesTo("deal.valueCents > 1000000", { deal: { valueCents: 1_500_000 } })).toBe(true);
    expect(evaluateAppliesTo("deal.valueCents > 1000000", { deal: { valueCents: 500_000 } })).toBe(false);
  });

  test("now date comparison", () => {
    expect(evaluateAppliesTo("now < '2026-04-01'", { now: new Date("2026-03-15") })).toBe(true);
    expect(evaluateAppliesTo("now < '2026-04-01'", { now: new Date("2026-05-01") })).toBe(false);
  });

  test("missing context value returns false (does not throw)", () => {
    expect(evaluateAppliesTo("shop == 'DTC'", {})).toBe(false);
  });

  test("null/empty expression always matches (unconditional)", () => {
    expect(evaluateAppliesTo(null, {})).toBe(true);
    expect(evaluateAppliesTo("", {})).toBe(true);
  });

  // Bug 1: "not in" evaluation
  test("shop not in list excludes listed members", () => {
    expect(evaluateAppliesTo("shop not in ['SLO','Camarillo']", { shop: "DTC" })).toBe(true);
    expect(evaluateAppliesTo("shop not in ['SLO','Camarillo']", { shop: "SLO" })).toBe(false);
  });

  // Bug 2: empty list evaluation
  test("shop in [] never matches anything, including empty string", () => {
    expect(evaluateAppliesTo("shop in []", { shop: "DTC" })).toBe(false);
    expect(evaluateAppliesTo("shop in []", { shop: "" })).toBe(false);
  });
});
