import { describe, it, expect } from "@jest/globals";

/** Mirrors the validation logic from the PATCH handler */
function validateCustomAdders(input: unknown): string | null {
  if (!Array.isArray(input)) return "customAdders must be an array";
  if (input.length > 20) return "Maximum 20 custom adders";
  for (const adder of input) {
    if (adder == null || typeof adder !== "object") {
      return "Each custom adder must be an object";
    }
    if (!adder.name || typeof adder.name !== "string" || adder.name.trim().length === 0 || adder.name.length > 100) {
      return "Each custom adder must have a name (max 100 chars)";
    }
    if (typeof adder.amount !== "number" || !isFinite(adder.amount)) {
      return "Each custom adder must have a numeric amount";
    }
  }
  return null;
}

describe("customAdders validation", () => {
  it("accepts valid adders", () => {
    expect(validateCustomAdders([{ name: "Tree removal", amount: 800 }])).toBeNull();
  });

  it("accepts negative amounts (discounts)", () => {
    expect(validateCustomAdders([{ name: "Discount", amount: -500 }])).toBeNull();
  });

  it("rejects non-array", () => {
    expect(validateCustomAdders("not an array")).toBe("customAdders must be an array");
  });

  it("rejects more than 20 entries", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ name: `a${i}`, amount: 100 }));
    expect(validateCustomAdders(many)).toBe("Maximum 20 custom adders");
  });

  it("rejects empty name", () => {
    expect(validateCustomAdders([{ name: "", amount: 100 }])).toBe(
      "Each custom adder must have a name (max 100 chars)"
    );
  });

  it("rejects name over 100 chars", () => {
    expect(validateCustomAdders([{ name: "x".repeat(101), amount: 100 }])).toBe(
      "Each custom adder must have a name (max 100 chars)"
    );
  });

  it("rejects non-numeric amount", () => {
    expect(validateCustomAdders([{ name: "test", amount: "abc" }])).toBe(
      "Each custom adder must have a numeric amount"
    );
  });

  it("rejects Infinity", () => {
    expect(validateCustomAdders([{ name: "test", amount: Infinity }])).toBe(
      "Each custom adder must have a numeric amount"
    );
  });

  it("rejects null elements", () => {
    expect(validateCustomAdders([null])).toBe("Each custom adder must be an object");
  });

  it("rejects primitive elements", () => {
    expect(validateCustomAdders([123])).toBe("Each custom adder must be an object");
  });

  it("rejects whitespace-only name", () => {
    expect(validateCustomAdders([{ name: "   ", amount: 100 }])).toBe(
      "Each custom adder must have a name (max 100 chars)"
    );
  });
});
