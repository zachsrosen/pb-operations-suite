import {
  CANONICAL_LOCATIONS,
  CANONICAL_TO_LOCATION_SLUG,
  LOCATION_SLUG_TO_CANONICAL,
  isCanonicalLocation,
  normalizeLocation,
  normalizeLocationOrUnknown,
  resolvePbLocationFromAddress,
} from "@/lib/locations";

describe("locations", () => {
  it("exposes the canonical PB locations", () => {
    expect(CANONICAL_LOCATIONS).toEqual([
      "Westminster",
      "Centennial",
      "Pueblo",
      "San Luis Obispo",
      "Camarillo",
    ]);
    expect(CANONICAL_LOCATIONS).toContain("Pueblo");
    expect(CANONICAL_LOCATIONS).not.toContain("Colorado Springs");
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
    // legacy Colorado Springs aliases resolve to Pueblo
    ["co springs", "Pueblo"],
    ["Colorado Springs", "Pueblo"],
    ["COSP", "Pueblo"],
    // new Pueblo forms
    ["PBLO", "Pueblo"],
    ["pueblo", "Pueblo"],
    ["Pueblo", "Pueblo"],
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
    expect(isCanonicalLocation("Pueblo")).toBe(true);
    expect(isCanonicalLocation("Colorado Springs")).toBe(false);
    expect(isCanonicalLocation("Denver")).toBe(false);
  });

  it("maps slugs to canonical locations with the legacy slug kept as an alias", () => {
    expect(LOCATION_SLUG_TO_CANONICAL["pueblo"]).toBe("Pueblo");
    expect(LOCATION_SLUG_TO_CANONICAL["colorado-springs"]).toBe("Pueblo");
    expect(CANONICAL_TO_LOCATION_SLUG["Pueblo"]).toBe("pueblo");
  });

  it("routes Springs metro AND Pueblo zips to Pueblo", () => {
    expect(resolvePbLocationFromAddress("80915", "CO")).toBe("Pueblo");
    expect(resolvePbLocationFromAddress("81001", "CO")).toBe("Pueblo");
    expect(resolvePbLocationFromAddress("81101", "CO")).toBe("Pueblo"); // 811 prefix (Alamosa band — included per decision 2)
  });
});
