import {
  CANONICAL_LOCATIONS,
  isCanonicalLocation,
  normalizeLocation,
  normalizeLocationOrUnknown,
} from "@/lib/locations";

describe("locations", () => {
  it("exposes the canonical PB locations", () => {
    expect(CANONICAL_LOCATIONS).toEqual([
      "Westminster",
      "Centennial",
      "Colorado Springs",
      "San Luis Obispo",
      "Camarillo",
    ]);
  });

  it.each([
    ["DTC", "Centennial"],
    ["denver tech center", "Centennial"],
    ["westy", "Westminster"],
    ["Westminster", "Westminster"],
    ["camarillo", "Camarillo"],
    ["SLO", "San Luis Obispo"],
    ["san luis", "San Luis Obispo"],
    ["California", "San Luis Obispo"],
    ["co springs", "Colorado Springs"],
    ["Pueblo", "Colorado Springs"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeLocation(input)).toBe(expected);
  });

  it("returns null for empty or unmapped locations", () => {
    expect(normalizeLocation("")).toBeNull();
    expect(normalizeLocation(null)).toBeNull();
    expect(normalizeLocation(undefined)).toBeNull();
    expect(normalizeLocation("Denver")).toBeNull();
  });

  it("returns Unknown for empty or unmapped values in the fallback helper", () => {
    expect(normalizeLocationOrUnknown("")).toBe("Unknown");
    expect(normalizeLocationOrUnknown("Denver")).toBe("Unknown");
  });

  it("is case-insensitive and does not misclassify Camarillo as California", () => {
    expect(normalizeLocation("CaMaRiLlO warehouse")).toBe("Camarillo");
    expect(normalizeLocationOrUnknown("CaMaRiLlO warehouse")).toBe("Camarillo");
  });

  it("supports type-guard checks for canonical values", () => {
    expect(isCanonicalLocation("Centennial")).toBe(true);
    expect(isCanonicalLocation("Denver")).toBe(false);
  });
});
